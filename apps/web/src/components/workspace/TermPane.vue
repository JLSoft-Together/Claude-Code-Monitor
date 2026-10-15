<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert, CircleCheck, CircleDot, Columns2, GitBranch, LoaderCircle, Paperclip, Play, RotateCw, X } from 'lucide-vue-next'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import type { IBufferCell, IDisposable } from '@xterm/xterm'
import type { PtyServerMessage } from '@ccm/shared'
import { DevServerDetector, rememberDevUrl } from '../../lib/devServer'
import { createFileLinkProvider, type LinkOpenOptions, type LinkTarget } from '../../lib/fileLinks'
import { fontEntry, fontStack, SYSTEM_MONO } from '../../lib/fonts'
import { shortPath } from '../../lib/format'
import { contextPctOf } from '../../lib/provider'
import { retireOverlay } from '../../lib/motion'
import { registerSnapshot } from '../../lib/paneSnapshots'
import { isMac } from '../../lib/platform'
import { PtyConnection, type PtyStart } from '../../lib/ptyClient'
import { imagePasteKey, usePaneAttachments, type PaneScreen } from '../../composables/usePaneAttachments'
import { SCAN_ROWS } from '../../lib/promptAttachments'
import { desktop } from '../../lib/desktop'
import { clipboardImageBlob, imageData } from '../../lib/imageData'
import { dragPaths, hasDragPath } from '../../lib/explorer/dragPath'
import { hasAttachments, pathForFile } from '../../lib/preview'
import { useAgentsStore } from '../../stores/agents'
import { fromPath, useAttachmentsStore, type NewAttachment } from '../../stores/attachments'
import { useSettingsStore } from '../../stores/settings'
import { useTerminalsStore } from '../../stores/terminals'
import { useTipsStore } from '../../stores/tips'
import { parseOsc7, parseOsc9 } from '../../lib/shellCwd'
import { hasScripts } from '../../lib/projects'
import { useWorkspaceStore, workCwd, type Pane, type SplitChoice } from '../../stores/workspace'
import ContextGauge from '../ContextGauge.vue'
import AttachmentsPanel from './AttachmentsPanel.vue'
import DevServerChip from './DevServerChip.vue'
import TermFind from './TermFind.vue'
import StatusBadge from '../StatusBadge.vue'
import PresetIcon from './PresetIcon.vue'
import SplitMenu from './SplitMenu.vue'
import WorktreeMenu from './WorktreeMenu.vue'

const props = defineProps<{ pane: Pane; visible: boolean; focused: boolean; multi: boolean }>()
const emit = defineEmits<{ split: [choice: SplitChoice]; close: []; openLink: [target: LinkTarget, opts: Partial<LinkOpenOptions>]; scripts: [] }>()

const { t } = useI18n()
const workspace = useWorkspaceStore()
const settings = useSettingsStore()
const terminals = useTerminalsStore()
const agents = useAgentsStore()
const tips = useTipsStore()

const host = ref<HTMLElement | null>(null)
let term: Terminal | null = null
let fit: FitAddon | null = null
let webgl: WebglAddon | null = null
let conn: PtyConnection | null = null
let search: SearchAddon | null = null
let linkProvider: IDisposable | null = null
let resizeObserver: ResizeObserver | null = null
let restoredOnMount = false
const findOpen = ref(false)
const find = ref<InstanceType<typeof TermFind> | null>(null)
const searchAddon = ref<SearchAddon | null>(null)
const devUrls = ref<string[]>([])
const linkHint = ref<string | undefined>(undefined)
const dev = new DevServerDetector()
const decoder = new TextDecoder('utf-8')
// Bulk output (cat of a big file, replay) is never a dev server banner.
const DEV_CHUNK_MAX = 64 * 1024

// The sidebar age needs 'recently active', not every chunk: one store write per pane every few seconds at most.
const TOUCH_MS = 5000
let touchedAt = 0
function touch(): void {
  const at = Date.now()
  if (at - touchedAt < TOUCH_MS) return
  touchedAt = at
  workspace.touch(props.pane.key, at)
}

function feedDev(bytes: Uint8Array): void {
  if (bytes.length > DEV_CHUNK_MAX) return
  const found = dev.feed(decoder.decode(bytes, { stream: true }))
  if (!found.length) return
  devUrls.value = [...devUrls.value, ...found]
  for (const url of found) rememberDevUrl(cwd.value ?? '', url)
}

function resetDev(): void {
  dev.reset()
  devUrls.value = []
}

async function openFind(): Promise<void> {
  findOpen.value = true
  await nextTick()
  find.value?.focus()
}

function closeFind(): void {
  findOpen.value = false
  term?.focus()
}

const status = computed(() => {
  switch (props.pane.state) {
    case 'starting':
      return { icon: LoaderCircle, label: t('workspace.state.starting'), cls: 'text-ink-faint', spin: true }
    case 'running':
      return { icon: CircleDot, label: t('workspace.state.running'), cls: 'text-ink-muted', spin: false }
    case 'exited':
      return { icon: CircleCheck, label: t('workspace.state.exited', { code: props.pane.exitCode ?? 0 }), cls: 'text-st-idle', spin: false }
    default:
      return { icon: CircleAlert, label: props.pane.error ?? t('workspace.state.error'), cls: 'text-st-error', spin: false }
  }
})

const session = computed(() => {
  const term = props.pane.terminalId ? terminals.byId[props.pane.terminalId] : undefined
  return term && term.status !== 'stale' ? term : undefined
})
const mainAgent = computed(() => (session.value ? agents.mainOf(session.value.id) : undefined))
const context = computed(() => {
  const a = mainAgent.value
  return a?.contextTokens && a.contextWindow ? { tokens: a.contextTokens, window: a.contextWindow, pct: contextPctOf(a) } : null
})
const branch = computed(() => session.value?.gitBranch || props.pane.branch)
const wtAnchor = ref<DOMRect | null>(null)
const wtButton = ref<HTMLButtonElement | null>(null)

function toggleWorktrees(): void {
  wtAnchor.value = wtAnchor.value ? null : (wtButton.value?.getBoundingClientRect() ?? null)
}

function closeWorktrees(): void {
  wtAnchor.value = null
  wtButton.value?.focus()
}

const splitAnchor = ref<DOMRect | null>(null)
const splitButton = ref<HTMLButtonElement | null>(null)

// Clicking into another pane has a chord (Alt+Arrows): counted for the shortcut tip.
function onPointerDown(): void {
  if (props.multi && !props.focused) tips.mouse('focus')
  workspace.activate(props.pane.key)
}

function toggleSplit(): void {
  splitAnchor.value = splitAnchor.value ? null : (splitButton.value?.getBoundingClientRect() ?? null)
}

// Menus are placed from a rect taken at open time: a hidden pane or a resized window would leave them floating.
function dropMenus(): void {
  splitAnchor.value = null
  wtAnchor.value = null
}

const ended = computed(() => props.pane.state === 'exited' || props.pane.state === 'error' || props.pane.state === 'gone')
const chipKey = computed(() => (session.value && props.pane.state === 'running' ? `s:${session.value.status}` : `p:${props.pane.state}`))

const cwd = computed(() => workCwd(props.pane))
let reportedCwd: string | null = null

/** The host validates (real, existing folder) and answers with `cwd`; each prompt repeats it, so send changes only. */
function onShellCwd(dir: string | null): void {
  sendPending()
  if (!dir || dir === reportedCwd) return
  reportedCwd = dir
  conn?.reportCwd(dir)
}

// Typed at the first prompt (its cwd report), or after a grace period for shells without the prompt hook.
const PENDING_GRACE_MS = 4000
let pendingTimer: ReturnType<typeof setTimeout> | null = null
function sendPending(): void {
  if (pendingTimer) clearTimeout(pendingTimer)
  pendingTimer = null
  const cmd = props.pane.pendingCommand
  if (!cmd || !conn?.isOpen || props.pane.state !== 'running') return
  workspace.update(props.pane.key, { pendingCommand: undefined, ranCommand: true })
  conn.write(`${cmd}\r`)
}

const sessionTitle = computed(() => session.value?.alias || session.value?.title || '')

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const

function theme(): Terminal['options']['theme'] {
  const ansi: Record<string, string> = {}
  ANSI.forEach((name, i) => {
    ansi[name] = cssVar(`--ccm-ansi-${i}`)
    ansi[`bright${name.charAt(0).toUpperCase()}${name.slice(1)}`] = cssVar(`--ccm-ansi-${i + 8}`)
  })
  return {
    ...ansi,
    background: cssVar('--ccm-well'),
    foreground: cssVar('--ccm-well-ink'),
    cursor: cssVar('--ccm-accent'),
    cursorAccent: cssVar('--ccm-well'),
    selectionBackground: cssVar('--ccm-well-selection'),
    selectionInactiveBackground: cssVar('--ccm-well-selection'),
  }
}

// WebGL contexts are scarce (browsers cap ~16) and heavy; only the pane on screen holds one.
function setRenderer(on: boolean): void {
  if (!term) return
  if (on && !webgl) {
    try {
      webgl = new WebglAddon()
      webgl.onContextLoss(() => setRenderer(false))
      term.loadAddon(webgl)
    } catch {
      webgl = null
    }
  } else if (!on && webgl) {
    webgl.dispose()
    webgl = null
  }
}

// xterm measures the cell when the option changes: the face has to be loaded first or it measures the fallback.
async function applyCodeFont(): Promise<void> {
  const { codeFont: id, codeFontSize: size } = settings
  const entry = fontEntry('code', id)
  if (entry.family) await document.fonts.load(`${size}px '${entry.family}'`).catch(() => undefined)
  if (!term || id !== settings.codeFont || size !== settings.codeFontSize) return
  const family = fontStack(entry)
  if (term.options.fontFamily === family && term.options.fontSize === size) return
  term.options.fontFamily = family
  term.options.fontSize = size
  term.clearTextureAtlas()
  refit()
}

function refit(): void {
  if (!props.visible || !fit || !host.value?.offsetWidth) return
  try {
    fit.fit()
  } catch {
    // container not laid out yet
  }
}

// Attachments tray (agent panes): inserts go through this pane's PTY, the prompt is read back from the screen.
const attachments = useAttachmentsStore()
const isWin = desktop?.platform === 'win32'
const canAttach = computed(() => hasAttachments && props.pane.preset !== 'shell')
const attachOpen = computed(() => canAttach.value && !!attachments.open[props.pane.key])
const attachCount = computed(() => attachments.live(props.pane.key).length)
const dropping = ref(false)
let dragDepth = 0

function readScreen(): PaneScreen | null {
  if (!term) return null
  const b = term.buffer.active
  const rows: string[] = []
  const inverse: { x: number; y: number }[] = []
  let cell: IBufferCell | undefined
  for (let y = 0; y < term.rows; y++) {
    const line = b.getLine(b.baseY + y)
    rows.push(line?.translateToString(true) ?? '')
    if (!line || y < term.rows - SCAN_ROWS) continue
    for (let x = 0; x < line.length; x++) {
      cell = line.getCell(x, cell)
      if (cell?.isInverse()) inverse.push({ x, y })
    }
  }
  return { rows, cursor: { x: b.cursorX, y: b.cursorY }, inverse }
}

const offSnapshot = registerSnapshot(props.pane.key, (n) => {
  const b = term?.buffer.active
  if (!b) return []
  // A margin above the cursor row so trailing blank screen rows can be trimmed.
  const end = b.baseY + b.cursorY + 1
  const out: string[] = []
  for (let y = Math.max(0, end - n - 8); y < end; y++) out.push(b.getLine(y)?.translateToString(true) ?? '')
  return out
})
onBeforeUnmount(offSnapshot)

const att = usePaneAttachments({
  paneKey: () => props.pane.key,
  preset: () => props.pane.preset,
  cwd: () => cwd.value,
  running: () => props.pane.state === 'running',
  visible: () => props.visible,
  write: (data) => conn?.write(data),
  paste: (text) => {
    term?.paste(text)
    term?.focus()
  },
  screen: readScreen,
  appCursorKeys: () => !!term?.modes.applicationCursorKeysMode,
  win: isWin,
})

watch(
  () => props.visible,
  (shown) => shown && att.schedule(),
)

/** Files from the OS, or paths dragged out of the Explorer. */
const canDrop = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes('Files') || hasDragPath(e.dataTransfer)

function onDragEnter(e: DragEvent): void {
  if (!hasAttachments || !canDrop(e) || props.pane.state !== 'running') return
  e.preventDefault()
  dragDepth++
  dropping.value = true
}

function onDragOver(e: DragEvent): void {
  if (!dropping.value) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
}

function onDragLeave(): void {
  if (dragDepth && --dragDepth === 0) dropping.value = false
}

/** Files carry a path (desktop); images dragged out of a web page have none and travel as pixels. */
async function onDrop(e: DragEvent): Promise<void> {
  if (!dropping.value) return
  e.preventDefault()
  dragDepth = 0
  dropping.value = false
  workspace.activate(props.pane.key)
  const items: NewAttachment[] = []
  const keep = (it: NewAttachment): boolean => it.kind === 'file' || att.imagesSupported.value || !att.agent.value
  const paths = dragPaths(e.dataTransfer)
  for (const path of paths) {
    const it = fromPath(path, 'drop')
    if (keep(it)) items.push(it)
  }
  for (const file of paths.length ? [] : Array.from(e.dataTransfer?.files ?? [])) {
    const path = pathForFile(file)
    if (path) {
      const it = fromPath(path, 'drop')
      if (keep(it)) items.push(it)
    } else if (file.type.startsWith('image/') && att.imagesSupported.value) {
      const img = await imageData(file)
      if (img) items.push({ kind: 'image', name: file.name || t('attach.image'), source: 'drop', ...img })
    }
  }
  if (!items.length) return
  // Shell panes: the path is typed at the prompt, no tray.
  attachments.add(props.pane.key, items, att.agent.value ? undefined : true)
  if (!att.agent.value) attachments.toggle(props.pane.key, false)
}

async function paste(textOnly: boolean): Promise<void> {
  // Agents read clipboard images themselves on their paste key (Alt+V on Windows for Claude Code, §11p).
  const key = textOnly ? null : imagePasteKey(props.pane.preset, isWin)
  const blob = key ? await clipboardImageBlob() : null
  if (key && blob) {
    conn?.write(key)
    const img = await imageData(blob)
    att.notePaste({ kind: 'image', name: t('attach.clipboard'), source: 'paste', thumb: img?.thumb })
    return
  }
  try {
    const text = await navigator.clipboard.readText()
    if (text) term?.paste(text)
  } catch {
    // clipboard permission denied or empty
  }
}

function onKey(e: KeyboardEvent): boolean {
  if (e.type !== 'keydown') return true
  // Ink (Claude Code) reads ESC+CR as a newline inside the prompt instead of submit.
  if (e.key === 'Enter' && e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
    conn?.write('\x1b\r')
    return false
  }
  // Plain Ctrl+F stays with the shell (readline forward-char).
  if (e.code === 'KeyF' && !e.altKey && (isMac ? e.metaKey && !e.ctrlKey && !e.shiftKey : e.ctrlKey && e.shiftKey && !e.metaKey)) {
    e.preventDefault()
    void openFind()
    return false
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) att.noteSubmit()
  // ⌘V is image-aware too (xterm's own paste only knows text).
  if (isMac && e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'v') {
    e.preventDefault()
    void paste(e.shiftKey)
    return false
  }
  if (isMac) return true
  const key = e.key.toLowerCase()
  if (e.ctrlKey && !e.altKey && key === 'c' && term?.hasSelection()) {
    void navigator.clipboard.writeText(term.getSelection())
    term.clearSelection()
    return false
  }
  if (e.ctrlKey && !e.altKey && key === 'v') {
    e.preventDefault()
    void paste(e.shiftKey)
    return false
  }
  return true
}

function onMessage(msg: PtyServerMessage): void {
  const key = props.pane.key
  switch (msg.t) {
    case 'ready':
      // Only folders the user picked go to the recent list; the home default is always one click away.
      if (props.pane.cwd && !msg.replay) workspace.remember(msg.cwd)
      workspace.update(key, { sessionId: msg.id, pid: msg.pid || undefined, cwd: msg.cwd, state: 'running', error: undefined })
      if (term) conn?.resize(term.cols, term.rows)
      if (props.pane.pendingCommand && !msg.replay) pendingTimer = setTimeout(sendPending, PENDING_GRACE_MS)
      if (props.visible && props.focused) term?.focus()
      break
    case 'pid':
      workspace.update(key, { pid: msg.pid })
      break
    case 'branch':
      workspace.update(key, { branch: msg.branch ?? undefined })
      break
    case 'cwd':
      if (msg.cwd) workspace.update(key, { liveCwd: msg.cwd })
      break
    case 'exit':
      resetDev()
      workspace.update(key, { state: 'exited', exitCode: msg.code })
      break
    case 'gone':
      // A new app run has a new PTY host: a pane restored from a previous run has nothing to attach to.
      if (restoredOnMount) workspace.remove(key)
      else workspace.update(key, { state: 'gone', error: t('workspace.state.gone') })
      break
    case 'error':
      if (msg.message === 'cwd' && props.pane.cwd) workspace.forget(props.pane.cwd)
      workspace.update(key, { state: 'error', error: t(`workspace.error.${msg.message}`) })
      break
  }
}

async function connect(start: PtyStart): Promise<void> {
  conn?.close()
  conn = new PtyConnection({
    onOutput: (bytes) => {
      term?.write(bytes)
      touch()
      feedDev(bytes)
    },
    onMessage,
    onClose: () => {
      if (props.pane.state === 'running' || props.pane.state === 'starting')
        workspace.update(props.pane.key, { state: 'error', error: t('workspace.state.disconnected') })
    },
  })
  try {
    await conn.open(start, term?.cols ?? 80, term?.rows ?? 24)
  } catch {
    workspace.update(props.pane.key, { state: 'error', error: t('workspace.state.unavailable') })
  }
}

function killSession(): void {
  const id = props.pane.sessionId
  if (conn?.isOpen) conn.kill()
  else if (id) void PtyConnection.killById(id)
}

function restart(): void {
  killSession()
  restoredOnMount = false
  term?.reset()
  resetDev()
  reportedCwd = null
  workspace.update(props.pane.key, { state: 'starting', sessionId: undefined, pid: undefined, terminalId: undefined, branch: undefined, liveCwd: undefined, exitCode: undefined, error: undefined, ranCommand: undefined })
  void connect({ spawn: { preset: props.pane.preset, cwd: props.pane.cwd, resume: props.pane.resume } })
}

function reconnect(): void {
  if (!props.pane.sessionId) return restart()
  restoredOnMount = false
  term?.reset()
  workspace.update(props.pane.key, { state: 'starting', error: undefined })
  void connect({ attach: props.pane.sessionId })
}

function close(): void {
  emit('close')
}

onMounted(() => {
  term = new Terminal({
    allowProposedApi: true,
    cursorBlink: true,
    cursorStyle: 'bar',
    // The chosen face may still be loading; applyCodeFont swaps it in once it is.
    fontFamily: SYSTEM_MONO,
    fontSize: settings.codeFontSize,
    lineHeight: 1.25,
    scrollback: 5000,
    smoothScrollDuration: 0,
    // CLIs paint with ANSI black/dim colours that vanish on the dark well; xterm lifts them per cell.
    minimumContrastRatio: 4.5,
    theme: theme(),
  })
  fit = new FitAddon()
  term.loadAddon(fit)
  // Graphemes, not unicode11: Vietnamese NFD output from Claude otherwise drifts the cursor.
  term.loadAddon(new UnicodeGraphemesAddon())
  term.unicode.activeVersion = '15-graphemes'
  term.open(host.value!)
  term.attachCustomKeyEventHandler(onKey)
  term.onWriteParsed(() => att.schedule())
  term.parser.registerOscHandler(7, (data) => (onShellCwd(parseOsc7(data)), true))
  term.parser.registerOscHandler(9, (data) => {
    const dir = parseOsc9(data)
    if (dir) onShellCwd(dir)
    return !!dir
  })
  linkProvider = term.registerLinkProvider(
    createFileLinkProvider(term, {
      cwd: () => cwd.value,
      isMac,
      onOpen: (target, opts) => emit('openLink', target, opts),
      onHover: () => (linkHint.value = t('workspace.open.linkHint', { key: isMac ? '⌘' : 'Ctrl' })),
      onLeave: () => (linkHint.value = undefined),
    }),
  )
  term.onData((data) => {
    conn?.write(data)
    touch()
    if (props.pane.preset === 'shell' && !props.pane.ranCommand && data.includes('\r')) workspace.update(props.pane.key, { ranCommand: true })
  })
  term.onBinary((data) => conn?.writeBinary(data))
  term.onResize(({ cols, rows }) => conn?.resize(cols, rows))
  term.textarea?.addEventListener('focus', () => workspace.activate(props.pane.key))
  setRenderer(props.visible)
  refit()
  void applyCodeFont()
  search = new SearchAddon({ highlightLimit: 1000 })
  term.loadAddon(search)
  searchAddon.value = search
  resizeObserver = new ResizeObserver(() => refit())
  resizeObserver.observe(host.value!)
  window.addEventListener('resize', dropMenus)

  restoredOnMount = !!props.pane.sessionId
  void connect(props.pane.sessionId ? { attach: props.pane.sessionId } : { spawn: { preset: props.pane.preset, cwd: props.pane.cwd, resume: props.pane.resume } })
})

watch(
  () => props.visible,
  async (visible) => {
    setRenderer(visible)
    if (!visible) return dropMenus()
    await nextTick()
    refit()
    if (props.focused) term?.focus()
  },
)

// Browser → agent: lands in the input line only; the user presses Enter.
watch(
  () => workspace.insertRequest,
  async (req) => {
    if (!req || req.paneKey !== props.pane.key || props.pane.state !== 'running') return
    await att.idle()
    if (props.pane.state !== 'running') return
    if (req.image) {
      const key = imagePasteKey(props.pane.preset, isWin)
      if (key) {
        conn?.write(key)
        att.notePaste({ kind: 'image', name: t('attach.screenshot'), source: 'paste' })
      }
    } else term?.paste(req.text)
    term?.focus()
  },
)

watch(
  () => props.focused,
  (focused) => {
    if (focused && props.visible) term?.focus()
  },
)

watch(
  () => settings.theme,
  async () => {
    await nextTick()
    if (term) term.options.theme = theme()
  },
)

watch(() => [settings.codeFont, settings.codeFontSize] as const, () => void applyCodeFont())

// Leaving the view only detaches; a pane gone from the store was closed, so its process goes too.
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  if (pendingTimer) clearTimeout(pendingTimer)
  window.removeEventListener('resize', dropMenus)
  linkProvider?.dispose()
  if (!workspace.panes.some((p) => p.key === props.pane.key)) {
    killSession()
    attachments.drop(props.pane.key)
  }
  conn?.close()
  webgl?.dispose()
  term?.dispose()
})
</script>

<template>
  <section
    class="flex min-h-0 min-w-0 flex-col gap-1.5"
    :data-pane="pane.key"
    :style="visible ? `view-transition-name: ccm-pane-${pane.key}; view-transition-class: ccm-pane` : undefined"
    :aria-label="t(`workspace.preset.${pane.preset}`)"
    @pointerdown="onPointerDown"
  >
    <header
      class="flex h-7 min-w-0 items-center gap-2 px-1 text-xs"
      :class="multi ? 'cursor-grab' : ''"
      :title="multi ? t('workspace.drag.paneHint', { key: isMac ? '⌘' : 'Ctrl' }) : undefined"
      :data-pane-grip="multi || undefined"
      :data-tour="focused ? 'ws-pane' : undefined"
    >
      <PresetIcon :preset="pane.preset" :size="15" class="shrink-0" />
      <span class="shrink-0 font-semibold text-ink">{{ t(`workspace.preset.${pane.preset}`) }}</span>
      <span v-if="cwd" class="min-w-0 shrink truncate text-ink-faint" :title="cwd" data-cwd>{{ shortPath(cwd) }}</span>
      <DevServerChip v-if="devUrls.length" class="min-w-0 shrink" :urls="devUrls" @open="(url) => emit('openLink', { kind: 'url', url }, {})" />
      <button
        v-if="cwd && pane.state === 'running'"
        ref="wtButton"
        type="button"
        class="inline-flex h-6 min-w-0 shrink cursor-pointer items-center gap-1 rounded-[5px] px-1.5 text-ink-faint hover:bg-fill hover:text-ink aria-expanded:bg-fill aria-expanded:text-ink"
        :title="t('workspace.wt.title')"
        aria-haspopup="dialog"
        :aria-expanded="!!wtAnchor"
        @click="toggleWorktrees"
      >
        <GitBranch :size="12" class="shrink-0" aria-hidden="true" />
        <span v-if="branch" class="max-w-[16ch] truncate">{{ branch }}</span>
        <span v-else class="sr-only">{{ t('workspace.wt.title') }}</span>
      </button>
      <Teleport to="body">
        <Transition name="ccm-menu" @before-leave="retireOverlay">
          <WorktreeMenu v-if="wtAnchor && cwd" :cwd="cwd" :anchor="wtAnchor" :trigger="wtButton" @close="closeWorktrees" />
        </Transition>
      </Teleport>
      <span v-if="session && sessionTitle" class="hidden min-w-0 flex-1 truncate text-ink-muted lg:inline" :title="sessionTitle">{{ sessionTitle }}</span>
      <span class="ml-auto" aria-hidden="true" />
      <ContextGauge v-if="context" class="hidden w-24 shrink-0 sm:block" :tokens="context.tokens" :window="context.window" :pct="context.pct" compact />
      <!-- One grid cell: the old chip fades out under the new one instead of the header reflowing twice. -->
      <span class="grid shrink-0 justify-items-end *:[grid-area:1/1]">
        <Transition name="ccm-fade">
          <StatusBadge v-if="session && pane.state === 'running'" :key="chipKey" :status="session.status" />
          <span v-else :key="chipKey" class="inline-flex shrink-0 items-center gap-1" :class="status.cls">
            <component :is="status.icon" :size="13" :class="status.spin ? 'ccm-spin' : ''" aria-hidden="true" />
            <span>{{ status.label }}</span>
          </span>
        </Transition>
      </span>
      <button
        v-if="canAttach"
        type="button"
        class="ccm-btn-plain shrink-0 gap-1"
        :aria-pressed="attachOpen"
        :aria-label="t('attach.button')"
        :title="`${t('attach.button')}: ${t('attach.hint')}`"
        :data-tour="focused ? 'ws-attach' : undefined"
        data-attach-toggle
        @click="attachments.toggle(pane.key)"
      >
        <Paperclip :size="14" aria-hidden="true" />
        <span v-if="attachCount" class="text-2xs tabular" data-attach-count>{{ attachCount }}</span>
      </button>
      <button
        v-if="pane.state === 'error' && pane.sessionId"
        type="button"
        class="ccm-btn-plain shrink-0"
        :title="t('workspace.reconnect')"
        :aria-label="t('workspace.reconnect')"
        @click="reconnect"
      >
        <RotateCw :size="14" aria-hidden="true" />
      </button>
      <button v-else type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.restart')" :aria-label="t('workspace.restart')" @click="restart">
        <RotateCw :size="14" aria-hidden="true" />
      </button>
      <button
        v-if="hasScripts && cwd"
        type="button"
        class="ccm-btn-plain shrink-0"
        data-scripts
        :title="t('workspace.scripts.open')"
        :aria-label="t('workspace.scripts.open')"
        aria-haspopup="dialog"
        @click="emit('scripts')"
      >
        <Play :size="14" aria-hidden="true" />
      </button>
      <button
        ref="splitButton"
        type="button"
        class="ccm-btn-plain shrink-0 aria-expanded:bg-fill"
        :title="t('workspace.splitPane')"
        :aria-label="t('workspace.splitPane')"
        aria-haspopup="menu"
        :aria-expanded="!!splitAnchor"
        :data-tour="focused ? 'ws-split' : undefined"
        @click="toggleSplit"
      >
        <Columns2 :size="14" aria-hidden="true" />
      </button>
      <Teleport to="body">
        <Transition name="ccm-menu" @before-leave="retireOverlay">
          <SplitMenu v-if="splitAnchor" :anchor="splitAnchor" :current="pane.preset" :trigger="splitButton" @pick="(p) => emit('split', p)" @close="splitAnchor = null" />
        </Transition>
      </Teleport>
      <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.close')" :aria-label="t('workspace.close')" @click="close">
        <X :size="14" aria-hidden="true" />
      </button>
    </header>
    <div class="flex min-h-0 flex-1 gap-1.5" @dragenter="onDragEnter" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
    <div
      class="relative min-h-0 min-w-0 flex-1 rounded-card bg-well shadow-card outline-1 -outline-offset-1 transition-[outline-color] duration-(--ccm-dur-fast)"
      :class="multi && focused ? 'outline-focus' : 'outline-transparent'"
    >
      <!-- Dimmed when the process has ended; the well fades, the terminal text itself never animates. -->
      <div class="size-full overflow-hidden rounded-card p-2 transition-opacity duration-(--ccm-dur-slow) ease-out-quint" :class="ended ? 'opacity-60' : ''">
        <div ref="host" class="size-full" data-code-zoom :title="linkHint" />
      </div>
      <TermFind v-if="findOpen" ref="find" :addon="searchAddon" class="absolute top-1 right-2 z-10" @close="closeFind" />
      <span
        v-if="pane.attention"
        :key="`${pane.attention}:${visible}`"
        class="ccm-flash pointer-events-none absolute inset-0 rounded-card"
        :class="pane.attention === 'waiting' ? 'text-st-waiting' : 'text-st-done'"
        aria-hidden="true"
      />
      <Transition name="ccm-fade">
        <div
          v-if="dropping"
          class="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-card bg-accent-soft outline-2 -outline-offset-2 outline-focus outline-dashed"
          data-drop-overlay
        >
          <span class="ccm-sheet inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-ink"><Paperclip :size="15" aria-hidden="true" />{{ t('attach.drop') }}</span>
        </div>
      </Transition>
    </div>
    <AttachmentsPanel
      v-if="attachOpen"
      :pane-key="pane.key"
      :images-supported="att.imagesSupported.value"
      :erase-for="att.eraseFor"
      :remove="att.remove"
      @close="attachments.toggle(pane.key, false)"
    />
    </div>
  </section>
</template>
