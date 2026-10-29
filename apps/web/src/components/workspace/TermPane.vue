<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Columns2, FileText, GitBranch, Globe, ListOrdered, LoaderCircle, Mail, Maximize2, Minimize2, Moon, Network, Paperclip, Play, RotateCw, ScanSearch, TriangleAlert, X } from 'lucide-vue-next'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes'
import { SearchAddon } from '@xterm/addon-search'
import '@xterm/xterm/css/xterm.css'
import type { IBufferCell, IDisposable } from '@xterm/xterm'
import type { PtyServerMessage } from '@ccm/shared'
import { DevServerDetector, devUrlLabel, rememberDevUrl } from '../../lib/devServer'
import { createFileLinkProvider, inLinks, joinWrappedLinks, oscLinkUri, selectionText, type LinkOpenOptions, type LinkTarget } from '../../lib/fileLinks'
import { fontEntry, termFontStack } from '../../lib/fonts'
import { duration, now, shortPath } from '../../lib/format'
import type { MenuEntry } from '../../lib/menu'
import { newlineFor } from '../../lib/termKeys'
import { isHeadBlank, processChip, STATE_BADGE, suggestCompact, zoomKeys } from '../../lib/paneHead'
import { contextPctOf } from '../../lib/provider'
import { retireOverlay } from '../../lib/motion'
import { registerSnapshot } from '../../lib/paneSnapshots'
import { isMac } from '../../lib/platform'
import { PtyConnection, type PtyStart } from '../../lib/ptyClient'
import { spawnQueue, type SpawnTicket } from '../../lib/spawnQueue'
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
import { bufferLines, parseTerminalProblems } from '../../lib/terminalProblems'
import { useChecksStore } from '../../stores/checks'
import { presetOf, useWorkspaceStore, workCwd, type Pane, type SplitChoice } from '../../stores/workspace'
import ContextGauge from '../ContextGauge.vue'
import AttachmentsPanel from './AttachmentsPanel.vue'
import DevServerChip from './DevServerChip.vue'
import TermFind from './TermFind.vue'
import StatusIcon from '../StatusIcon.vue'
import { statusMeta } from '../../lib/status'
import { usePaneInfo, usePeerSweep } from '../../composables/usePaneInfo'
import { useCompact } from '../../composables/useCompact'
import { needsUser } from '../../lib/rail/railModel'
import { leaves } from '../../lib/splitLayout'
import PaneMore from './PaneMore.vue'
import PresetIcon from './PresetIcon.vue'
import SplitMenu from './SplitMenu.vue'
import WorktreeMenu from './WorktreeMenu.vue'
import OverlapChip from './OverlapChip.vue'
import PromptQueueButton from './PromptQueueButton.vue'
import LimitResumeChip from './LimitResumeChip.vue'
import { shouldAutoFill } from '../../lib/promptQueue'
import { usePromptQueueStore } from '../../stores/promptQueue'
import { useResumeScheduleStore } from '../../stores/resumeSchedule'
import { useShellMarks } from '../../composables/useShellMarks'
import ContextMenu from '../ui/ContextMenu.vue'

const props = defineProps<{ pane: Pane; visible: boolean; focused: boolean; multi: boolean; zoomed: boolean; hiddenCount: number; dim: boolean }>()
const emit = defineEmits<{ split: [choice: SplitChoice]; close: []; openLink: [target: LinkTarget, opts: Partial<LinkOpenOptions>]; scripts: []; zoom: [] }>()

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
let refitTimer: ReturnType<typeof setTimeout> | null = null
let restoredOnMount = false
let ticket: SpawnTicket | null = null
const queued = ref(false)
const findOpen = ref(false)
const find = ref<InstanceType<typeof TermFind> | null>(null)
const searchAddon = ref<SearchAddon | null>(null)
const devUrls = ref<string[]>([])
const linkHint = ref<string | undefined>(undefined)
// OSC 8 links the program printed (newest last): a selection across a wrapped one copies as one line.
const OSC_LINKS_MAX = 50
const oscLinks: string[] = []
// Full text of the link under the mouse; right-click copies it.
let hoveredLink: string | null = null
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

function rememberLink(uri: string | null): void {
  if (!uri) return
  const at = oscLinks.indexOf(uri)
  if (at >= 0) oscLinks.splice(at, 1)
  oscLinks.push(uri)
  if (oscLinks.length > OSC_LINKS_MAX) oscLinks.shift()
}

function hoverLink(text: string): void {
  hoveredLink = text
  linkHint.value = t('workspace.open.linkHint', { key: isMac ? '⌘' : 'Ctrl' })
}

function leaveLink(): void {
  hoveredLink = null
  linkHint.value = undefined
}

function copyText(text: string): void {
  void navigator.clipboard.writeText(text).catch(() => undefined)
}

function copySelection(): void {
  if (!term) return
  copyText(selectionText(term, oscLinks))
  term.clearSelection()
}

// Edit menu / ⌘C reaching xterm's textarea: same text as the Ctrl+C path (xterm's own handler would copy the raw rows).
function onCopy(e: ClipboardEvent): void {
  if (!term?.hasSelection() || !e.clipboardData) return
  e.preventDefault()
  e.stopPropagation()
  e.clipboardData.setData('text/plain', selectionText(term, oscLinks))
}

// OSC 52: full-screen TUIs (Claude Code /tui fullscreen) select with the mouse themselves and copy through the terminal. Write only; a read request ('?') is ignored.
const OSC52_MAX = 1_000_000
function onOsc52(data: string): boolean {
  const b64 = data.slice(data.indexOf(';') + 1)
  if (!b64 || b64 === '?' || b64.length > OSC52_MAX) return true
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    copyText(joinWrappedLinks(new TextDecoder().decode(bytes), inLinks(oscLinks)))
  } catch {
    // not base64
  }
  return true
}

function onContextMenu(e: MouseEvent): void {
  if (!hoveredLink) return
  e.preventDefault()
  copyText(hoveredLink)
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

const procChip = computed(() => {
  const kind = processChip(props.pane.state)
  if (kind === 'parked') return { kind, label: t('workspace.rail.state.parked'), title: t('workspace.parked.hint'), status: 'stale', cls: 'bg-fill text-ink-muted' }
  if (kind === 'starting' && queued.value) return { kind, label: t('workspace.queued.label'), title: t('workspace.queued.hint'), status: null, cls: 'bg-fill text-ink-muted' }
  if (kind === 'starting') return { kind, label: t('workspace.rail.state.starting'), title: undefined, status: null, cls: 'bg-fill text-ink-muted' }
  if (kind === 'exited') {
    const meta = statusMeta('completed')
    return { kind, label: t('workspace.rail.state.ended'), title: t('workspace.state.exited', { code: props.pane.exitCode ?? 0 }), status: 'completed', cls: `${meta.text} ${meta.soft}` }
  }
  if (kind === 'error') {
    const text = props.pane.error ?? t('workspace.state.error')
    const meta = statusMeta('error')
    return { kind, label: text, title: text, status: 'error', cls: `${meta.text} ${meta.soft}` }
  }
  return null
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
  more.value?.close()
  marks.closeMenu()
}

const ended = computed(() => props.pane.state === 'exited' || props.pane.state === 'error' || props.pane.state === 'gone')
const parked = computed(() => props.pane.state === 'parked')
const info = usePaneInfo()
const sessionChip = computed(() => {
  const s = session.value
  const state = info.railStateOf(props.pane)
  if (!s || !state || props.pane.state !== 'running') return null
  const badge = STATE_BADGE[state]
  return { state, badge, status: info.statusOf(props.pane) ?? s.status, label: info.stateText(props.pane) ?? '', subagents: info.subagentsOf(props.pane), meta: statusMeta(badge) }
})
const chipKey = computed(() => (sessionChip.value ? `s:${sessionChip.value.state}:${sessionChip.value.label}` : `p:${procChip.value?.kind ?? ''}:${procChip.value?.label ?? ''}`))

const peer = computed(() => (props.pane.state === 'running' ? info.peerOf(props.pane) : null))
const peerBadge = computed(() => !!sessionChip.value && needsUser(sessionChip.value.state))
const coordinating = computed(() => (props.pane.state === 'running' ? info.coordinatingOf(props.pane) : null))
const peerTip = computed(() => [...new Set([peer.value?.label ?? '', ...info.peerLines(props.pane), peer.value?.action ?? ''].filter(Boolean))].join('\n'))
const peerAria = computed(() => (peer.value ? (peer.value.action ? t('peerWs.chipLabel', { text: peer.value.label, action: peer.value.action }) : peer.value.label) : ''))
const peerSweep = usePeerSweep(() => peer.value)
const hiddenNews = computed(() => {
  if (!props.zoomed || props.hiddenCount <= 0) return null
  const tab = workspace.tabOf(props.pane.key)
  return tab ? info.peerNewsOf(leaves(tab.root).filter((k) => k !== props.pane.key).map((k) => workspace.panes.find((p) => p.key === k))) : null
})
const hiddenLabel = computed(() =>
  [t('workspace.paneHead.hidden', { n: props.hiddenCount }, props.hiddenCount), hiddenNews.value?.label].filter(Boolean).join(' · '),
)

const activity = computed(() => info.activityOf(props.pane))
const activityText = computed(() => {
  const tool = activity.value?.tool
  if (!tool) return null
  const time = duration(activity.value?.since, now.value)
  return time ? t('workspace.activity.tool', { tool, time }) : tool
})
const diff = computed(() => {
  const d = activity.value?.diff
  return d && d.files > 0 ? d : null
})

const compactFlow = useCompact()
const compactSuggested = computed(() => props.pane.state === 'running' && !!context.value && suggestCompact(context.value.pct, compactFlow.stateOf(props.pane)))
const compactPct = computed(() => Math.round(context.value?.pct ?? 0))

const zoomLabel = computed(() => t(props.zoomed ? 'workspace.paneHead.unzoom' : 'workspace.paneHead.zoom', { key: zoomKeys(isMac) }))

function onHeadDblClick(e: MouseEvent): void {
  if (!(props.multi || props.zoomed) || !isHeadBlank(e.target, e.currentTarget as Element)) return
  e.preventDefault()
  emit('zoom')
}

const more = ref<InstanceType<typeof PaneMore> | null>(null)
const reconnectable = computed(() => props.pane.state === 'error' && !!props.pane.sessionId)
const moreEntries = computed<MenuEntry[]>(() => {
  const out: MenuEntry[] = []
  const url = devUrls.value[devUrls.value.length - 1]
  if (url) out.push({ id: 'dev', label: t('workspace.devServer.open', { host: devUrlLabel(url) }), icon: Globe })
  if (compactSuggested.value) out.push({ id: 'compact', label: t('workspace.paneHead.compact.label', { pct: compactPct.value }), icon: TriangleAlert, hint: t('workspace.compact.hint') })
  out.push({ separator: true })
  if (canAttach.value)
    out.push({ id: 'attach', label: attachCount.value ? t('workspace.paneHead.attachCount', { label: t('attach.button'), n: attachCount.value }) : t('attach.button'), icon: Paperclip })
  if (hasScripts && cwd.value) out.push({ id: 'scripts', label: t('workspace.scripts.open'), icon: Play })
  if (isShell.value) out.push({ id: 'scan', label: t('workspace.termScan.button'), icon: ScanSearch, hint: t('workspace.termScan.hint') })
  else {
    const n = queueCount.value
    out.push({ id: 'queue', label: n ? t('workspace.promptQueue.count', { n }, n) : t('workspace.promptQueue.title'), icon: ListOrdered })
  }
  out.push({ id: 'restart', label: t(reconnectable.value ? 'workspace.reconnect' : 'workspace.restart'), icon: RotateCw })
  return out
})

function pickMore(id: string): void {
  if (id === 'dev') {
    const url = devUrls.value[devUrls.value.length - 1]
    if (url) emit('openLink', { kind: 'url', url }, {})
  } else if (id === 'compact') compactFlow.start(props.pane.key)
  else if (id === 'attach') attachments.toggle(props.pane.key)
  else if (id === 'scripts') emit('scripts')
  else if (id === 'scan') scanErrors()
  else if (id === 'queue') queueButton.value?.open((more.value?.$el as HTMLElement | undefined)?.getBoundingClientRect())
  else if (id === 'restart') {
    if (reconnectable.value) reconnect()
    else restart()
  }
}

const cwd = computed(() => workCwd(props.pane))
// What runs in the pane now (a shell can be running `claude`); spawn and restart keep `pane.preset`.
const preset = computed(() => presetOf(props.pane))
let reportedCwd: string | null = null

const isShell = computed(() => preset.value === 'shell')
const checks = useChecksStore()
const scanNotice = ref<string | null>(null)
let scanTimer: ReturnType<typeof setTimeout> | null = null
/** One-off read of the scrollback on click (no monitoring); results feed FilePane problems as source `terminal`. */
function scanErrors(): void {
  if (!term) return
  const scan = parseTerminalProblems(bufferLines(term.buffer.active), cwd.value ?? null)
  checks.setTerminal(props.pane.key, t('workspace.termScan.source', { name: props.pane.title || shortPath(cwd.value ?? '') || t('workspace.preset.shell') }), scan.errors)
  const n = scan.errors.length
  showNotice(n ? t('workspace.termScan.found', { n, files: t('workspace.termScan.files', { n: scan.files }, scan.files) }, n) : t('workspace.termScan.none'))
}
function showNotice(text: string): void {
  scanNotice.value = text
  if (scanTimer) clearTimeout(scanTimer)
  scanTimer = setTimeout(() => (scanNotice.value = null), 4000)
}
onBeforeUnmount(() => scanTimer && clearTimeout(scanTimer))

const marks = useShellMarks({
  paneKey: () => props.pane.key,
  paneTitle: () => props.pane.title || shortPath(cwd.value ?? '') || t('workspace.preset.shell'),
  cwd: () => cwd.value,
  running: () => props.pane.state === 'running',
  visible: () => props.visible,
  focused: () => props.focused,
  write: (data) => conn?.write(data),
  notice: showNotice,
})
const { active: marksOn, menu: markMenu, entries: markEntries } = marks

const queues = usePromptQueueStore()
const queueButton = ref<InstanceType<typeof PromptQueueButton> | null>(null)
const queueCount = computed(() => queues.queues[props.pane.key]?.items.length ?? 0)
const canFillQueue = computed(() => props.pane.state === 'running')

/** Prefills the next queued prompt (never Enter); pasted here so a background pane does not take focus. */
async function fillQueued(): Promise<void> {
  if (props.pane.state !== 'running' || !term) return
  await att.idle()
  if (props.pane.state !== 'running' || !term || !conn?.isOpen) return
  const item = queues.take(props.pane.key)
  if (!item) return
  term.paste(item.text)
  const left = queues.get(props.pane.key).items.length
  showNotice(left ? t('workspace.promptQueue.filledLeft', { n: left }, left) : t('workspace.promptQueue.filled'))
}

watch(
  () => session.value?.status,
  (now, prev) => {
    if (isShell.value || props.pane.state !== 'running') return
    if (shouldAutoFill(queues.get(props.pane.key), prev, now)) void fillQueued()
  },
)

const resume = useResumeScheduleStore()
const limitHit = computed(() => (isShell.value ? undefined : session.value?.limitHit))
// A real reply clears the hit (Claude Code continued by itself, or the owner typed): the prefill would only get in the way.
watch(limitHit, (hit) => {
  if (hit || !session.value || !resume.get(props.pane.key)) return
  resume.cancel(props.pane.key)
  showNotice(t('limitResume.cancelledResumed'))
})
watch(
  () => resume.fired,
  (f) => f?.keys.includes(props.pane.key) && showNotice(t('limitResume.filled')),
)

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

const PREFILL_FALLBACK_MS = 20_000
const SUBMIT_DELAY_MS = 200
let prefillTimer: ReturnType<typeof setTimeout> | null = null
let prefillLate = false
let prefilling = false

function stopPrefill(): void {
  if (prefillTimer) clearTimeout(prefillTimer)
  prefillTimer = null
}

function armPrefill(): void {
  stopPrefill()
  prefillLate = false
  prefillTimer = setTimeout(() => {
    prefillTimer = null
    prefillLate = true
    void sendPrefill()
  }, PREFILL_FALLBACK_MS)
  void sendPrefill()
}

function prefillReady(): boolean {
  const status = session.value?.status
  return status === 'idle' || (prefillLate && status !== 'working' && status !== 'waiting')
}

async function sendPrefill(): Promise<void> {
  if (prefilling || !props.pane.prefill || props.pane.state !== 'running' || !prefillReady()) return
  prefilling = true
  await att.idle()
  prefilling = false
  const text = props.pane.prefill
  const submit = props.pane.prefillSubmit
  if (!text || !term || !conn?.isOpen || props.pane.state !== 'running' || !prefillReady()) return
  stopPrefill()
  workspace.update(props.pane.key, { prefill: undefined, prefillSubmit: undefined })
  if (text.startsWith('/') && !text.includes('\n')) conn.write(text)
  else term.paste(term.modes.bracketedPasteMode ? text : text.replace(/\s*\n\s*/g, ' '))
  if (submit)
    setTimeout(() => {
      if (conn?.isOpen && props.pane.state === 'running') conn.write('\r')
    }, SUBMIT_DELAY_MS)
}

const compactStep = computed(() => {
  const flow = props.pane.compact
  if (!flow) return null
  return flow.step === 'compact' ? 'compact' : flow.missing ? 'missing' : 'writing'
})
const COMPACT_TONE = { writing: 'bg-fill text-ink-muted', missing: 'bg-warning-soft text-warning', compact: 'bg-accent-soft text-accent-ink' } as const

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
  const family = termFontStack(entry)
  if (term.options.fontFamily === family && term.options.fontSize === size) return
  term.options.fontFamily = family
  term.options.fontSize = size
  term.clearTextureAtlas()
  refit()
}

function refit(): void {
  if (!props.visible || !fit || !host.value?.offsetWidth) return
  try {
    const dims = fit.proposeDimensions()
    if (term && conn && dims && dims.cols < term.cols && term.buffer.active.type === 'normal') {
      conn.resize(dims.cols, dims.rows)
      if (refitTimer) clearTimeout(refitTimer)
      refitTimer = setTimeout(() => {
        refitTimer = null
        try {
          fit?.fit()
        } catch {
          // pane closed meanwhile
        }
      }, 100)
      return
    }
    fit.fit()
  } catch {
    // container not laid out yet
  }
}

// Attachments tray (agent panes): inserts go through this pane's PTY, the prompt is read back from the screen.
const attachments = useAttachmentsStore()
const isWin = desktop?.platform === 'win32'
const canAttach = computed(() => hasAttachments && preset.value !== 'shell')
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
  preset: () => preset.value,
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
  const key = textOnly ? null : imagePasteKey(preset.value, isWin)
  const blob = key ? await clipboardImageBlob() : null
  if (key && blob) {
    conn?.write(key)
    const img = await imageData(blob)
    att.notePaste({ kind: 'image', name: t('attach.clipboard'), source: 'paste', thumb: img?.thumb, view: img?.view })
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
  if (parked.value) {
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) wake()
    return false
  }
  const newline = newlineFor(e, preset.value)
  if (newline) {
    e.preventDefault()
    conn?.write(newline)
    return false
  }
  // Plain Ctrl+F stays with the shell (readline forward-char).
  if (e.code === 'KeyF' && !e.altKey && (isMac ? e.metaKey && !e.ctrlKey && !e.shiftKey : e.ctrlKey && e.shiftKey && !e.metaKey)) {
    e.preventDefault()
    void openFind()
    return false
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) att.noteSubmit()
  if (marksOn.value && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.altKey && !e.shiftKey && (isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey)) {
    if (marks.jump(e.key === 'ArrowUp' ? -1 : 1)) {
      e.preventDefault()
      return false
    }
  }
  // ⌘V is image-aware too (xterm's own paste only knows text).
  if (isMac && e.metaKey && !e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'v') {
    e.preventDefault()
    void paste(e.shiftKey)
    return false
  }
  const key = e.key.toLowerCase()
  if (key === 'c' && !e.altKey && (isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey) && term?.hasSelection()) {
    e.preventDefault()
    copySelection()
    return false
  }
  if (isMac) return true
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
      marks.attach(msg.si, msg.replay)
      ticket?.release()
      if (term) conn?.resize(term.cols, term.rows)
      if (props.pane.pendingCommand && !msg.replay) pendingTimer = setTimeout(sendPending, PENDING_GRACE_MS)
      if (!msg.replay && props.pane.openTicket) workspace.update(key, { openTicket: undefined })
      if (!msg.replay && props.pane.prefill) armPrefill()
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
      ticket?.release(false)
      workspace.update(key, { state: 'exited', exitCode: msg.code })
      break
    case 'gone':
      // A new app run has a new PTY host: a pane restored from a previous run has nothing to attach to.
      if (restoredOnMount) workspace.remove(key)
      else workspace.update(key, { state: 'gone', error: t('workspace.state.gone') })
      break
    case 'error':
      ticket?.release(false)
      if (msg.message === 'cwd' && props.pane.cwd) workspace.forget(props.pane.cwd)
      workspace.update(key, { state: 'error', error: t(`workspace.error.${msg.message}`) })
      break
  }
}

async function connect(start: PtyStart): Promise<void> {
  const own = ticket
  conn?.close()
  conn = new PtyConnection({
    onOutput: (bytes) => {
      term?.write(bytes)
      touch()
      feedDev(bytes)
    },
    onMessage,
    onClose: () => {
      own?.release(false)
      if (props.pane.state === 'running' || props.pane.state === 'starting')
        workspace.update(props.pane.key, { state: 'error', error: t('workspace.state.disconnected') })
    },
  })
  try {
    await conn.open(start, term?.cols ?? 80, term?.rows ?? 24)
  } catch {
    own?.release(false)
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
  marks.reset()
  term?.reset()
  resetDev()
  oscLinks.length = 0
  reportedCwd = null
  workspace.update(props.pane.key, { state: 'starting', sessionId: undefined, pid: undefined, terminalId: undefined, agent: undefined, branch: undefined, liveCwd: undefined, exitCode: undefined, error: undefined, ranCommand: undefined })
  void spawn()
}

async function spawn(): Promise<void> {
  ticket?.release(false)
  const mine = spawnQueue.enter(props.visible)
  ticket = mine
  queued.value = true
  const ok = await mine.started
  if (ticket !== mine) return
  queued.value = false
  if (ok) void connect(spawnStart())
}

function spawnStart(): PtyStart {
  const integrate = props.pane.preset === 'shell' && settings.shellIntegration
  return { spawn: { preset: props.pane.preset, cwd: props.pane.cwd, resume: props.pane.resume, open: props.pane.openTicket, integrate } }
}

function wake(): void {
  workspace.wake([props.pane.key])
  term?.focus()
}

function reconnect(): void {
  if (!props.pane.sessionId) return restart()
  restoredOnMount = false
  marks.reset()
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
    fontFamily: termFontStack(fontEntry('code', 'system')),
    fontSize: settings.codeFontSize,
    lineHeight: 1.25,
    scrollback: 5000,
    smoothScrollDuration: 0,
    // CLIs paint with ANSI black/dim colours that vanish on the dark well; xterm lifts them per cell.
    minimumContrastRatio: 4.5,
    // Apps that track the mouse (full-screen TUIs) get drags; Shift-drag (xterm default) / Option-drag on macOS still selects.
    macOptionClickForcesSelection: true,
    theme: theme(),
    // OSC 8 links (Claude Code prints sign-in URLs this way): xterm's default handler opens about:blank, which the app denies.
    linkHandler: {
      activate: (event, uri) => {
        if (!(isMac ? event.metaKey : event.ctrlKey) || !/^https?:\/\//i.test(uri)) return
        emit('openLink', { kind: 'url', url: uri }, {})
      },
      hover: (_event, uri) => hoverLink(uri),
      leave: leaveLink,
    },
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
  // Not consumed (false): xterm still turns the sequence into a link.
  term.parser.registerOscHandler(8, (data) => (rememberLink(oscLinkUri(data)), false))
  term.parser.registerOscHandler(52, onOsc52)
  term.parser.registerOscHandler(9, (data) => {
    const dir = parseOsc9(data)
    if (dir) onShellCwd(dir)
    return !!dir
  })
  marks.install(term)
  linkProvider = term.registerLinkProvider(
    createFileLinkProvider(term, {
      cwd: () => cwd.value,
      isMac,
      onOpen: (target, opts) => emit('openLink', target, opts),
      onHover: (target) => hoverLink(target.kind === 'url' ? target.url : target.path),
      onLeave: leaveLink,
    }),
  )
  term.onData((data) => {
    conn?.write(data)
    touch()
    if (preset.value === 'shell' && !props.pane.ranCommand && data.includes('\r')) workspace.update(props.pane.key, { ranCommand: true })
  })
  term.onBinary((data) => conn?.writeBinary(data))
  term.onResize(({ cols, rows }) => conn?.resize(cols, rows))
  term.textarea?.addEventListener('focus', () => workspace.activate(props.pane.key))
  host.value!.addEventListener('contextmenu', onContextMenu)
  host.value!.addEventListener('copy', onCopy, true)
  setRenderer(props.visible)
  refit()
  void applyCodeFont()
  search = new SearchAddon({ highlightLimit: 1000 })
  term.loadAddon(search)
  searchAddon.value = search
  resizeObserver = new ResizeObserver(() => {
    if (refitTimer) clearTimeout(refitTimer)
    refitTimer = setTimeout(() => {
      refitTimer = null
      refit()
    }, 150)
  })
  resizeObserver.observe(host.value!)
  window.addEventListener('resize', dropMenus)

  restoredOnMount = !!props.pane.sessionId
  if (props.pane.state === 'parked') return
  if (props.pane.sessionId) void connect({ attach: props.pane.sessionId })
  else void spawn()
})

watch(
  () => props.pane.state,
  (state, was) => {
    if (was === 'parked' && state === 'starting' && !conn) void spawn()
  },
)

watch(
  () => props.visible,
  async (visible) => {
    setRenderer(visible)
    if (visible) ticket?.promote()
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
      const key = imagePasteKey(preset.value, isWin)
      if (key) {
        conn?.write(key)
        att.notePaste({ kind: 'image', name: t('attach.screenshot'), source: 'paste' })
      }
    } else term?.paste(req.text)
    term?.focus()
  },
)

watch(
  () => [props.pane.prefill, props.pane.state, session.value?.status] as const,
  () => void sendPrefill(),
)

watch(
  () => props.pane.state,
  (state) => {
    if (state !== 'exited' && state !== 'error' && state !== 'gone') return
    stopPrefill()
    if (props.pane.prefill || props.pane.openTicket) workspace.update(props.pane.key, { prefill: undefined, openTicket: undefined })
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
  if (refitTimer) clearTimeout(refitTimer)
  if (pendingTimer) clearTimeout(pendingTimer)
  ticket?.release(false)
  stopPrefill()
  window.removeEventListener('resize', dropMenus)
  linkProvider?.dispose()
  if (!workspace.panes.some((p) => p.key === props.pane.key)) {
    killSession()
    attachments.drop(props.pane.key)
  }
  conn?.close()
  marks.dispose()
  webgl?.dispose()
  term?.dispose()
})
</script>

<template>
  <section
    class="@container flex min-h-0 min-w-0 flex-col gap-1.5"
    :data-pane="pane.key"
    :style="visible ? `view-transition-name: ccm-pane-${pane.key}; view-transition-class: ccm-pane` : undefined"
    :aria-label="t(`workspace.preset.${preset}`)"
    @pointerdown="onPointerDown"
  >
    <header
      class="relative flex h-7 min-w-0 items-center gap-2 px-1 text-xs select-none @max-[420px]:gap-1"
      :class="multi ? 'cursor-grab' : ''"
      :title="multi ? t('workspace.drag.paneHint', { key: isMac ? '⌘' : 'Ctrl' }) : undefined"
      :data-pane-grip="multi || undefined"
      :data-tour="focused ? 'ws-pane' : undefined"
      data-pane-head
      @dblclick="onHeadDblClick"
    >
      <span v-if="peerSweep" :key="peerSweep" class="ccm-peer-sweep-x absolute inset-x-1 top-0 h-0.5" aria-hidden="true" data-pane-peer-sweep />
      <PresetIcon :preset="preset" :size="15" class="shrink-0" />
      <span class="shrink-0 font-semibold transition-colors duration-(--ccm-dur-fast) ease-out-quint @max-[420px]:sr-only" :class="multi && !focused ? 'text-ink-muted' : 'text-ink'">{{
        t(`workspace.preset.${preset}`)
      }}</span>
      <span v-if="cwd" class="min-w-0 shrink-[100] truncate text-ink-faint @max-[380px]:hidden" :title="cwd" data-cwd>{{ shortPath(cwd) }}</span>
      <DevServerChip
        v-if="devUrls.length"
        class="min-w-0 shrink @max-[600px]:[&>span]:hidden @max-[420px]:hidden"
        data-more="dev"
        :urls="devUrls"
        @open="(url) => emit('openLink', { kind: 'url', url }, {})"
      />
      <button
        v-if="cwd && pane.state === 'running'"
        ref="wtButton"
        type="button"
        class="inline-flex h-6 shrink-[10] cursor-pointer items-center gap-1 rounded-[5px] px-1.5 text-ink-faint transition-colors duration-(--ccm-dur-fast) hover:bg-fill hover:text-ink aria-expanded:bg-fill aria-expanded:text-ink"
        :title="branch ? t('workspace.paneHead.branch', { branch }) : t('workspace.wt.title')"
        aria-haspopup="dialog"
        :aria-expanded="!!wtAnchor"
        data-pane-worktrees
        @click="toggleWorktrees"
      >
        <GitBranch :size="12" class="shrink-0" aria-hidden="true" />
        <span v-if="branch" class="max-w-[16ch] min-w-[4ch] truncate @max-[440px]:sr-only @max-[440px]:min-w-0">{{ branch }}</span>
        <span v-else class="sr-only">{{ t('workspace.wt.title') }}</span>
      </button>
      <Transition name="ccm-fade">
        <span
          v-if="diff"
          class="inline-flex shrink-0 items-center gap-1 text-2xs font-medium tabular-nums @max-[480px]:hidden"
          :title="t('workspace.activity.diffTitle', { files: diff.files, ins: diff.insertions, del: diff.deletions }, diff.files)"
          data-pane-diff
          data-pane-chip
        >
          <span class="text-diff-add">+{{ diff.insertions }}</span>
          <span class="text-diff-del">−{{ diff.deletions }}</span>
        </span>
      </Transition>
      <OverlapChip v-if="cwd && preset !== 'shell'" :cwd="cwd" :branch="branch" data-pane-chip />
      <Teleport to="body">
        <Transition name="ccm-menu" @before-leave="retireOverlay">
          <WorktreeMenu v-if="wtAnchor && cwd" :cwd="cwd" :anchor="wtAnchor" :trigger="wtButton" @close="closeWorktrees" />
        </Transition>
      </Teleport>
      <span class="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)] text-ink-muted *:[grid-area:1/1] @max-[640px]:hidden">
        <Transition name="ccm-fade">
          <span v-if="activityText" :key="`a:${activity?.tool}`" class="truncate tabular-nums" :title="activityText" data-pane-activity>{{ activityText }}</span>
          <span v-else-if="session && sessionTitle" :key="`t:${sessionTitle}`" class="truncate" :title="sessionTitle">{{ sessionTitle }}</span>
        </Transition>
      </span>
      <div class="ml-auto flex min-w-0 items-center gap-1">
        <ContextGauge v-if="context" class="w-24 shrink-0 @max-[600px]:hidden" :tokens="context.tokens" :window="context.window" :pct="context.pct" compact data-pane-chip />
        <span class="grid min-w-6 justify-items-end empty:hidden *:[grid-area:1/1] @max-[300px]:hidden" data-more="compact" data-pane-chip>
          <Transition name="ccm-fade">
            <button
              v-if="compactSuggested"
              type="button"
              class="inline-flex h-5 max-w-full min-w-6 cursor-pointer items-center gap-1 rounded-inner bg-warning-soft px-1.5 text-2xs font-medium whitespace-nowrap text-warning transition-colors duration-(--ccm-dur-fast) ease-out-quint hover:text-ink"
              :title="t('workspace.paneHead.compact.title', { pct: compactPct })"
              :aria-label="t('workspace.paneHead.compact.label', { pct: compactPct })"
              data-compact-suggest
              @click="compactFlow.start(pane.key)"
            >
              <TriangleAlert :size="12" class="shrink-0" aria-hidden="true" />
              <span class="min-w-0 truncate @max-[460px]:hidden">{{ t('workspace.paneHead.compact.label', { pct: compactPct }) }}</span>
            </button>
          </Transition>
        </span>
        <span class="grid min-w-6 justify-items-end empty:hidden *:[grid-area:1/1]" data-pane-chip>
          <Transition name="ccm-fade">
            <span
              v-if="compactStep && pane.state === 'running'"
              :key="compactStep"
              class="inline-flex h-5 max-w-full min-w-6 items-center gap-1 rounded-inner px-1.5 text-2xs font-medium whitespace-nowrap"
              :class="COMPACT_TONE[compactStep]"
              :title="pane.compact?.file"
              :data-compact-step="compactStep"
            >
              <LoaderCircle v-if="compactStep === 'writing'" :size="12" class="ccm-spin shrink-0" aria-hidden="true" />
              <FileText v-else :size="12" class="shrink-0" aria-hidden="true" />
              <span class="min-w-0 truncate @max-[460px]:sr-only">{{ t(`workspace.compact.step.${compactStep}`) }}</span>
            </span>
          </Transition>
        </span>
        <!-- One grid cell: the old chip fades out under the new one instead of the header reflowing twice. -->
        <span class="grid min-w-6 justify-items-end empty:hidden *:[grid-area:1/1]" data-pane-chip>
          <Transition name="ccm-fade">
            <span
              v-if="sessionChip"
              :key="chipKey"
              class="inline-flex h-5 max-w-full min-w-6 items-center gap-1 rounded-inner px-1.5 text-2xs font-medium whitespace-nowrap"
              :class="[sessionChip.meta.text, sessionChip.meta.soft]"
              :title="peerBadge && peer ? `${sessionChip.label}\n${peerTip}` : sessionChip.label"
              :data-pane-status="sessionChip.status"
              :data-subagents="sessionChip.subagents || undefined"
            >
              <span class="relative inline-flex shrink-0">
                <StatusIcon :status="sessionChip.badge" :size="12" />
                <Transition name="ccm-fade">
                  <span v-if="peerBadge && peer" class="absolute -top-1 -right-1 inline-flex rounded-full bg-surface p-px" aria-hidden="true" :data-pane-peer-badge="peer.dir">
                    <component :is="peer.glyph" :size="8" :class="peer.tone" />
                  </span>
                </Transition>
              </span>
              <span class="min-w-0 truncate @max-[460px]:sr-only">{{ sessionChip.label }}</span>
              <span v-if="peerBadge && peer" class="sr-only">, {{ peer.label }}</span>
            </span>
            <span
              v-else-if="procChip"
              :key="chipKey"
              class="inline-flex h-5 max-w-full min-w-6 items-center gap-1 rounded-inner px-1.5 text-2xs font-medium whitespace-nowrap"
              :class="procChip.cls"
              :title="procChip.title"
              :data-pane-process="procChip.kind"
            >
              <LoaderCircle v-if="!procChip.status" :size="12" class="ccm-spin shrink-0" aria-hidden="true" />
              <StatusIcon v-else :status="procChip.status" :size="12" class="shrink-0" />
              <span class="min-w-0 truncate @max-[460px]:sr-only">{{ procChip.label }}</span>
            </span>
          </Transition>
        </span>
        <span class="grid min-w-5 shrink-[1000] justify-items-end empty:hidden *:[grid-area:1/1]" data-pane-chip data-pane-peer-cell>
          <Transition name="ccm-fade">
            <button
              v-if="peer && !peerBadge"
              :key="`p:${peer.kind}:${peer.dir}:${peer.text}`"
              type="button"
              class="inline-flex h-5 max-w-full min-w-5 cursor-pointer items-center justify-center gap-1 rounded-inner px-1 text-2xs font-medium whitespace-nowrap text-ink transition-colors duration-(--ccm-dur-fast) ease-out-quint hover:bg-fill disabled:cursor-default disabled:hover:bg-transparent"
              :disabled="!peer.other"
              :title="peerTip"
              :aria-label="peerAria"
              :data-pane-peer="peer.dir"
              :data-peer-kind="peer.kind"
              data-no-drag
              @click="info.goToPeer(peer.other)"
            >
              <component :is="peer.glyph" :size="12" class="shrink-0" :class="peer.tone" aria-hidden="true" />
              <span class="max-w-[17ch] min-w-0 truncate @max-[720px]:hidden" data-pane-peer-text>{{ peer.text }}</span>
            </button>
            <span
              v-else-if="coordinating && !peerBadge"
              key="coordinating"
              role="img"
              class="inline-flex h-5 min-w-5 items-center justify-center text-ink-faint"
              :title="peerTip || coordinating.label"
              :aria-label="coordinating.label"
              :data-pane-coordinating="coordinating.n"
            >
              <Network :size="12" aria-hidden="true" />
            </span>
          </Transition>
        </span>
        <LimitResumeChip v-if="!isShell && pane.state === 'running'" :pane-key="pane.key" :hit="limitHit" data-pane-chip />
        <PromptQueueButton v-if="!isShell" ref="queueButton" :pane-key="pane.key" :can-fill="canFillQueue" @fill="fillQueued" />
        <button
          v-if="canAttach"
          type="button"
          class="ccm-btn-plain shrink-0 gap-1 @max-[420px]:hidden"
          :aria-pressed="attachOpen"
          :aria-label="t('attach.button')"
          :title="`${t('attach.button')}: ${t('attach.hint')}`"
          :data-tour="focused ? 'ws-attach' : undefined"
          data-attach-toggle
          data-more="attach"
          @click="attachments.toggle(pane.key)"
        >
          <Paperclip :size="14" aria-hidden="true" />
          <span v-if="attachCount" class="text-2xs tabular" data-attach-count>{{ attachCount }}</span>
        </button>
        <button
          v-if="reconnectable"
          type="button"
          class="ccm-btn-plain shrink-0 @max-[420px]:hidden"
          :title="t('workspace.reconnect')"
          :aria-label="t('workspace.reconnect')"
          data-more="restart"
          @click="reconnect"
        >
          <RotateCw :size="14" aria-hidden="true" />
        </button>
        <button
          v-else
          type="button"
          class="ccm-btn-plain shrink-0 @max-[420px]:hidden"
          :title="t('workspace.restart')"
          :aria-label="t('workspace.restart')"
          data-more="restart"
          @click="restart"
        >
          <RotateCw :size="14" aria-hidden="true" />
        </button>
        <button
          v-if="isShell"
          type="button"
          class="ccm-btn-plain shrink-0 @max-[420px]:hidden"
          data-term-scan
          data-more="scan"
          :title="t('workspace.termScan.hint')"
          :aria-label="t('workspace.termScan.button')"
          @click="scanErrors"
        >
          <ScanSearch :size="14" aria-hidden="true" />
        </button>
        <button
          v-if="hasScripts && cwd"
          type="button"
          class="ccm-btn-plain shrink-0 @max-[420px]:hidden"
          data-scripts
          data-more="scripts"
          :title="t('workspace.scripts.open')"
          :aria-label="t('workspace.scripts.open')"
          aria-haspopup="dialog"
          @click="emit('scripts')"
        >
          <Play :size="14" aria-hidden="true" />
        </button>
        <PaneMore
          ref="more"
          class="hidden @max-[420px]:inline-flex @max-[300px]:min-w-6 @max-[300px]:px-1"
          :entries="moreEntries"
          :label="t('workspace.paneHead.more')"
          @pick="pickMore"
        />
        <Transition name="ccm-fade">
          <button
            v-if="zoomed && hiddenCount > 0"
            type="button"
            class="inline-flex h-5 shrink-0 cursor-pointer items-center rounded-inner bg-accent-soft px-1.5 text-2xs font-medium text-accent-ink tabular-nums transition-colors duration-(--ccm-dur-fast) ease-out-quint hover:text-ink @max-[300px]:hidden"
            :title="hiddenLabel"
            :aria-label="hiddenLabel"
            data-pane-hidden
            @click="emit('zoom')"
          >
            <Transition name="ccm-fade">
              <Mail v-if="hiddenNews" :size="10" class="mr-1 shrink-0 text-peer" aria-hidden="true" data-pane-hidden-peer />
            </Transition>
            +{{ hiddenCount }}
          </button>
        </Transition>
        <button
          v-if="multi || zoomed"
          type="button"
          class="ccm-btn-plain shrink-0 @max-[300px]:min-w-6 @max-[300px]:px-1"
          :aria-pressed="zoomed"
          :title="zoomLabel"
          :aria-label="zoomLabel"
          data-pane-zoom
          @click="emit('zoom')"
        >
          <span class="grid *:[grid-area:1/1]">
            <Transition name="ccm-fade">
              <Minimize2 v-if="zoomed" :size="14" aria-hidden="true" />
              <Maximize2 v-else :size="14" aria-hidden="true" />
            </Transition>
          </span>
        </button>
        <button
          ref="splitButton"
          type="button"
          class="ccm-btn-plain shrink-0 aria-expanded:bg-fill @max-[300px]:min-w-6 @max-[300px]:px-1"
          :title="t('workspace.splitPane')"
          :aria-label="t('workspace.splitPane')"
          aria-haspopup="menu"
          data-pane-split
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
        <button
          type="button"
          class="ccm-btn-plain shrink-0 @max-[300px]:min-w-6 @max-[300px]:px-1"
          :title="t('workspace.close')"
          :aria-label="t('workspace.close')"
          data-pane-close
          @click="close"
        >
          <X :size="14" aria-hidden="true" />
        </button>
      </div>
    </header>
    <div class="flex min-h-0 flex-1 gap-1.5" @dragenter="onDragEnter" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
    <div
      class="relative min-h-0 min-w-0 flex-1 rounded-card bg-well shadow-card outline-2 -outline-offset-2 transition-[outline-color] duration-(--ccm-dur-fast) ease-out-quint"
      :class="multi && focused ? 'outline-focus' : 'outline-transparent'"
    >
      <!-- Dimmed when the process has ended; the well fades, the terminal text itself never animates. -->
      <!-- Shell command marks sit in the left padding, outside the cell grid. -->
      <div class="size-full overflow-hidden rounded-card p-2 pr-0 transition-opacity duration-(--ccm-dur-slow) ease-out-quint" :class="[ended ? 'opacity-60' : '', marksOn ? 'pl-4' : '']">
        <div ref="host" class="size-full" data-code-zoom :title="linkHint" />
      </div>
      <Transition name="ccm-fade">
        <div v-if="parked" class="absolute inset-0 z-11 flex items-center justify-center rounded-card bg-well p-4" data-pane-parked>
          <div class="flex max-w-80 flex-col items-center gap-2 text-center">
            <Moon :size="20" class="text-ink-faint" aria-hidden="true" />
            <p class="text-sm font-semibold text-ink">{{ t('workspace.parked.title') }}</p>
            <p class="text-xs text-ink-muted">{{ t('workspace.parked.hint') }}</p>
            <button type="button" class="ccm-btn ccm-btn-primary mt-1" data-pane-wake @click="wake">
              <Play :size="14" aria-hidden="true" />{{ pane.resume ? t('workspace.parked.resume') : t('workspace.parked.start') }}
            </button>
          </div>
        </div>
      </Transition>
      <div
        class="pointer-events-none absolute inset-0 z-12 rounded-card bg-well transition-opacity duration-(--ccm-dur-base) ease-out-quint"
        :class="dim ? 'opacity-45' : 'opacity-0'"
        :data-on="dim || undefined"
        data-pane-dim
        aria-hidden="true"
      />
      <Transition name="ccm-fade">
        <p v-if="scanNotice" class="ccm-sheet pointer-events-none absolute bottom-3 left-1/2 z-13 max-w-[90%] -translate-x-1/2 truncate px-3 py-1.5 text-xs text-ink" role="status" data-term-scan-notice>
          {{ scanNotice }}
        </p>
      </Transition>
      <ContextMenu v-if="markMenu" :at="markMenu.at" :entries="markEntries" :label="t('shellMarks.menuLabel')" :trigger="markMenu.trigger" @pick="marks.pick" @close="marks.closeMenu" />
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
      @open="(path) => emit('openLink', { kind: 'file', path }, {})"
    />
    </div>
  </section>
</template>
