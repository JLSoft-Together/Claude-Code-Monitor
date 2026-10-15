import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { PtyPreset } from '@ccm/shared'
import { clipboardImage, clipboardImageFile } from '../lib/preview'
import {
  cursorToken,
  eraseKeys,
  fileMention,
  needsLeadSpace,
  promptCaret,
  scanPrompt,
  shellPath,
  type Cell,
  type EraseKeys,
  type PromptScan,
} from '../lib/promptAttachments'
import { useAttachmentsStore, type Attachment, type NewAttachment } from '../stores/attachments'

export interface PaneScreen {
  rows: string[]
  /** Cursor, `y` as an index into `rows`. */
  cursor: Cell
  /** Inverse-video cells near the bottom: Claude Code draws its input caret as one (lib/promptAttachments promptCaret). */
  inverse?: Cell[]
}

interface Options {
  paneKey: () => string
  preset: () => PtyPreset
  cwd: () => string | undefined
  running: () => boolean
  visible: () => boolean
  /** Raw bytes to the PTY (keys). */
  write: (data: string) => void
  /** Text through xterm's paste (bracketed paste when the app asked for it): never submits. */
  paste: (text: string) => void
  screen: () => PaneScreen | null
  /** xterm DECCKM: the app asked for application cursor keys (ESC O D) instead of ESC [ D. */
  appCursorKeys: () => boolean
  win: boolean
}

/**
 * Key that makes the agent read an image from the system clipboard. Verified on Claude Code 2.1.299 and 2.1.294 (§11p):
 * Windows = Alt+V (ESC v), ^V does nothing there; macOS / Linux = Ctrl+V. Codex: unverified, its own ^V is
 * left alone and the tray adds no images to Codex panes.
 */
export function imagePasteKey(preset: PtyPreset, win: boolean): string | null {
  if (preset === 'claude') return win ? '\x1bv' : '\x16'
  if (preset === 'codex') return '\x16'
  return null
}

const SCAN_MS = 150
const AWAIT_MS = 8000
const PASTE_MS = 8000
const KEY_GAP_MS = 12
/** Ceiling for the agent to redraw the prompt without the erased token; slower than this counts as failed. */
const ERASE_MS = 1000
const ERASE_POLL_MS = 40
/** How long one caret move may take to show on screen. */
const CARET_MS = 250
const CARET_POLL_MS = 15
const NO_CARET: Cell = { x: -1, y: -1 }
const sleep = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms))

/** The tray side of one terminal pane: runs inserts (it owns the PTY) and reads the prompt back from the screen. */
export function usePaneAttachments(o: Options) {
  const store = useAttachmentsStore()
  const lastScan = ref<PromptScan | null>(null)
  const lastScreen = ref<PaneScreen | null>(null)
  let submitted = false
  let pendingPaste: { item: NewAttachment; at: number } | null = null
  let scanTimer = 0
  let busy = false
  let disposed = false
  /**
   * Inserts and erases share one queue: each erase starts from a fresh screen read after everything before it
   * finished, so neither two quick clicks nor an in-flight paste leave it typing at stale positions.
   */
  let queue: Promise<unknown> = Promise.resolve()

  let pending = 0

  function enqueue<T>(job: () => Promise<T>, fallback: T): Promise<T> {
    pending++
    const p = queue
      .then(() => (disposed ? fallback : job()))
      .catch(() => fallback)
      .finally(() => pending--)
    queue = p
    return p
  }

  const agent = computed(() => o.preset() !== 'shell')
  const imagesSupported = computed(() => o.preset() === 'claude')

  /** The screen with `cursor` = the agent's input caret, or off-screen when unsure (nothing is erased then). */
  function read(): PaneScreen | null {
    const s = o.screen()
    return s && { rows: s.rows, cursor: promptCaret(s.rows, s.cursor, s.inverse) ?? NO_CARET }
  }

  function scan(): void {
    scanTimer = 0
    if (disposed || !agent.value || !o.visible()) return
    const s = read()
    if (!s) return
    const result = scanPrompt(s.rows)
    lastScreen.value = s
    lastScan.value = result
    if (!result.found) return
    if (pendingPaste && Date.now() - pendingPaste.at > PASTE_MS) pendingPaste = null
    const { boundPaste } = store.reconcile(o.paneKey(), result, submitted, pendingPaste?.item ?? null, cursorToken(s.rows, s.cursor))
    if (boundPaste) pendingPaste = null
    submitted = false
    // An image whose paste key went out but never showed up: say so instead of waiting forever.
    for (const a of store.list(o.paneKey())) {
      if (a.awaiting && !a.token && Date.now() - a.awaiting > AWAIT_MS) store.patch(o.paneKey(), a.id, { state: 'failed', error: 'timeout', awaiting: undefined })
    }
  }

  function schedule(): void {
    if (!scanTimer && !disposed) scanTimer = window.setTimeout(scan, SCAN_MS)
  }

  /** Enter went to the agent: tokens leaving the prompt now were sent. */
  function noteSubmit(): void {
    submitted = true
    schedule()
  }

  /** A plain Ctrl/⌘+V of an image in the pane: the next new `[Image #N]` is this one. */
  function notePaste(item: NewAttachment): void {
    pendingPaste = { item, at: Date.now() }
    schedule()
  }

  /** Resolves when `ok()` holds (checked on store changes, and every `pollMs` when given) or after `ms`. */
  const waitFor = (ok: () => boolean, ms: number, pollMs = 0): Promise<void> =>
    new Promise((resolve) => {
      const stop = watch(
        () => store.byPane[o.paneKey()],
        () => ok() && done(),
      )
      const timer = window.setTimeout(done, ms)
      const poll = pollMs ? window.setInterval(() => (disposed || ok()) && done(), pollMs) : 0
      function done(): void {
        stop()
        window.clearTimeout(timer)
        window.clearInterval(poll)
        resolve()
      }
      if (ok()) done()
    })

  /** Times `token` shows in the prompt now, -1 when the box is not on screen. Counted, as a mention may be typed twice. */
  function tokenCount(token: string): number {
    const s = o.screen()
    const r = s ? scanPrompt(s.rows) : null
    return r?.found ? r.text.split(token).length - 1 : -1
  }

  async function insertOne(a: Attachment): Promise<void> {
    const key = o.paneKey()
    if (a.kind === 'file' || !imagesSupported.value) {
      if (a.kind === 'image' && !a.path) return store.patch(key, a.id, { state: 'failed', error: 'unsupported' })
      const screen = read()
      const lead = screen && needsLeadSpace(screen.rows, screen.cursor) ? ' ' : ''
      if (!agent.value) {
        o.paste(`${lead}${shellPath(a.path!, o.win)} `)
        return store.remove(key, a.id)
      }
      const token = fileMention(a.path!, o.cwd(), o.win)
      o.paste(`${lead}${token} `)
      store.patch(key, a.id, { state: 'inserted', token })
      return
    }
    const ok = a.path ? await clipboardImageFile(a.path) : a.data ? await clipboardImage(a.data) : false
    const pasteKey = imagePasteKey(o.preset(), o.win)
    if (!ok || !pasteKey) return store.patch(key, a.id, { state: 'failed', error: 'clipboard' })
    store.patch(key, a.id, { awaiting: Date.now() })
    o.write(pasteKey)
    schedule()
    // One image at a time: the clipboard holds a single image and the token binds in order.
    await waitFor(() => {
      const now = store.list(key).find((x) => x.id === a.id)
      return !now || !!now.token || now.state === 'failed'
    }, AWAIT_MS + 500)
    scan()
  }

  function run(): Promise<void> {
    if (busy || disposed || !o.running()) return Promise.resolve()
    busy = true
    return enqueue(async () => {
      try {
        for (;;) {
          if (disposed || !o.running()) break
          const next = store.list(o.paneKey()).find((a) => a.state === 'inserting' && !a.awaiting && !a.token)
          if (!next) break
          await insertOne(next)
        }
      } finally {
        busy = false
      }
    }, undefined)
  }

  watch(() => store.insertSeq, () => void run())
  watch(o.running, (on) => on && void run())

  /** Keys that erase an inserted item right now (it sits before the cursor on the cursor's row), or null. */
  function eraseFor(a: Attachment): EraseKeys | null {
    const s = lastScreen.value
    if (!s || a.state !== 'inserted' || !a.token) return null
    return eraseKeys(s.rows, s.cursor, a.token)
  }

  /** One key per write: the agent's input parser sees separate presses. */
  async function press(key: string, n: number): Promise<boolean> {
    for (let i = 0; i < n; i++) {
      if (disposed || !o.running()) return false
      o.write(key)
      await sleep(KEY_GAP_MS)
    }
    return true
  }

  const same = (a: Cell | null, b: Cell | null): boolean => !!a && !!b && a.x === b.x && a.y === b.y

  /** The caret once it shows at `at` (or, after a single press from `moved`, has left it and held still); else after CARET_MS. null = not found. */
  async function caretAt(at: Cell, moved?: Cell): Promise<Cell | null> {
    const until = Date.now() + CARET_MS
    let last: Cell | null = null
    for (;;) {
      const c = read()?.cursor
      if (!c || c.y < 0) return null
      const settled = !!moved && !same(c, moved) && same(c, last)
      if (same(c, at) || settled || Date.now() >= until || disposed) return c
      last = c
      await sleep(CARET_POLL_MS)
    }
  }

  /**
   * Brings the caret to `at`, nudging with ← / → when the agent moved it by another amount than counted (it may
   * step over a placeholder as one unit). false = lost it, or not there within `budget` extra presses.
   */
  async function caretTo(at: Cell, keys: readonly [string, string], budget: number): Promise<boolean> {
    let moved: Cell | undefined
    for (let i = 0; ; i++) {
      const c = await caretAt(at, moved)
      if (!c || c.y !== at.y) return false
      if (c.x === at.x) return true
      if (i >= budget || !(await press(c.x > at.x ? keys[0] : keys[1], 1))) return false
      moved = c
    }
  }

  /**
   * true once the prompt is redrawn with one `token` fewer. false = typed nothing (moved / gone / caret unsure), or
   * stopped before Backspace because the caret did not land right after the token, or no redraw in time.
   */
  async function eraseNow(token: string): Promise<boolean> {
    if (!o.running()) return false
    const s = read()
    const k = s ? eraseKeys(s.rows, s.cursor, token) : null
    // Moved since the click (or already gone): type nothing; the next scan keeps the tray honest.
    if (!s || !k) return false
    const before = tokenCount(token)
    const keys = o.appCursorKeys() ? (['\x1bOD', '\x1bOC'] as const) : (['\x1b[D', '\x1b[C'] as const)
    const from = s.cursor
    if (!(await press(keys[0], k.left)) || !(await caretTo({ x: from.x - k.left, y: from.y }, keys, k.left + 4))) return false
    // Backspace only with the token right before the caret, exactly as counted.
    const here = read()
    const now = here ? eraseKeys(here.rows, here.cursor, token) : null
    if (!now || now.left !== 0 || now.back !== k.back) return false
    if (!(await press('\x7f', k.back))) return false
    const cells = k.back - (token.startsWith('[Image #') ? 1 : token.length) + token.length
    if (!(await press(keys[1], k.right))) return false
    await caretTo({ x: from.x - cells, y: from.y }, keys, k.right + 4)
    const erased = (): boolean => {
      const n = tokenCount(token)
      return n >= 0 && n < before
    }
    await waitFor(erased, ERASE_MS, ERASE_POLL_MS)
    schedule()
    return erased()
  }

  /** false = cannot be erased from here (or the erase did not take): the tray asks to remove it in the terminal. */
  function remove(a: Attachment): Promise<boolean> {
    if (a.state !== 'inserted') {
      store.remove(o.paneKey(), a.id)
      return Promise.resolve(true)
    }
    // Mid-erase / mid-insert the screen is in flux (caret moved, text shifting): skip the pre-check, the queued erase reads a settled screen.
    if (!pending && !eraseFor(a)) return Promise.resolve(false)
    const token = a.token!
    return enqueue(() => eraseNow(token), false)
  }

  /** Resolves once the insert / erase queue is empty: a paste typed mid-erase would land between the ← / Backspace keys. */
  async function idle(): Promise<void> {
    let p: Promise<unknown>
    do {
      p = queue
      await p
    } while (p !== queue)
  }

  onBeforeUnmount(() => {
    disposed = true
    window.clearTimeout(scanTimer)
    scanTimer = 0
  })

  return { lastScan, schedule, noteSubmit, notePaste, remove, eraseFor, idle, imagesSupported, agent, run }
}
