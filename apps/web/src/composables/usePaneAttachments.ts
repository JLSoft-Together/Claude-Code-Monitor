import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { PtyPreset } from '@ccm/shared'
import { clipboardImage, clipboardImageFile } from '../lib/preview'
import { eraseCount, fileMention, needsLeadSpace, scanPrompt, shellPath, type PromptScan } from '../lib/promptAttachments'
import { useAttachmentsStore, type Attachment, type NewAttachment } from '../stores/attachments'

export interface PaneScreen {
  rows: string[]
  /** Cursor, `y` as an index into `rows`. */
  cursor: { x: number; y: number }
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
  win: boolean
}

/**
 * Key that makes the agent read an image from the system clipboard. Verified on Claude Code 2.1.299 (§11p):
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

/** The tray side of one terminal pane: runs inserts (it owns the PTY) and reads the prompt back from the screen. */
export function usePaneAttachments(o: Options) {
  const store = useAttachmentsStore()
  const lastScan = ref<PromptScan | null>(null)
  const lastScreen = ref<PaneScreen | null>(null)
  let submitted = false
  let pendingPaste: { item: NewAttachment; at: number } | null = null
  let scanTimer = 0
  let busy = false

  const agent = computed(() => o.preset() !== 'shell')
  const imagesSupported = computed(() => o.preset() === 'claude')

  function scan(): void {
    scanTimer = 0
    if (!agent.value || !o.visible()) return
    const s = o.screen()
    if (!s) return
    const result = scanPrompt(s.rows)
    lastScreen.value = s
    lastScan.value = result
    if (!result.found) return
    if (pendingPaste && Date.now() - pendingPaste.at > PASTE_MS) pendingPaste = null
    const { boundPaste } = store.reconcile(o.paneKey(), result, submitted, pendingPaste?.item ?? null)
    if (boundPaste) pendingPaste = null
    submitted = false
    // An image whose paste key went out but never showed up: say so instead of waiting forever.
    for (const a of store.list(o.paneKey())) {
      if (a.awaiting && !a.token && Date.now() - a.awaiting > AWAIT_MS) store.patch(o.paneKey(), a.id, { state: 'failed', error: 'timeout', awaiting: undefined })
    }
  }

  function schedule(): void {
    if (!scanTimer) scanTimer = window.setTimeout(scan, SCAN_MS)
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

  const waitFor = (ok: () => boolean, ms: number): Promise<void> =>
    new Promise((resolve) => {
      const stop = watch(
        () => store.byPane[o.paneKey()],
        () => ok() && done(),
      )
      const timer = window.setTimeout(done, ms)
      function done(): void {
        stop()
        window.clearTimeout(timer)
        resolve()
      }
      if (ok()) done()
    })

  async function insertOne(a: Attachment): Promise<void> {
    const key = o.paneKey()
    if (a.kind === 'file' || !imagesSupported.value) {
      if (a.kind === 'image' && !a.path) return store.patch(key, a.id, { state: 'failed', error: 'unsupported' })
      const screen = o.screen()
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

  async function run(): Promise<void> {
    if (busy || !o.running()) return
    busy = true
    try {
      for (;;) {
        const next = store.list(o.paneKey()).find((a) => a.state === 'inserting' && !a.awaiting && !a.token)
        if (!next || !o.running()) break
        await insertOne(next)
      }
    } finally {
      busy = false
    }
  }

  watch(() => store.insertSeq, () => void run())
  watch(o.running, (on) => on && void run())

  /** Backspaces that erase an inserted item right now, or null (not last in the prompt / cursor moved). */
  function eraseFor(a: Attachment): number | null {
    const s = lastScreen.value
    if (!s || a.state !== 'inserted' || !a.token) return null
    return eraseCount(s.rows, s.cursor, a.token)
  }

  function remove(a: Attachment): boolean {
    if (a.state !== 'inserted') {
      store.remove(o.paneKey(), a.id)
      return true
    }
    const n = eraseFor(a)
    if (n === null) return false
    o.write('\x7f'.repeat(n))
    schedule()
    return true
  }

  onBeforeUnmount(() => window.clearTimeout(scanTimer))

  return { lastScan, schedule, noteSubmit, notePaste, remove, eraseFor, imagesSupported, agent, run }
}
