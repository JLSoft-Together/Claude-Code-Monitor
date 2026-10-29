<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { BellRing, CircleHelp, FolderOpen, GraduationCap, Keyboard, LayoutTemplate, Mail, Maximize2, PanelLeft, PanelRight, Play, Plus, X } from 'lucide-vue-next'
import type { TerminalStatus } from '@ccm/shared'
import { useCompact } from '../../composables/useCompact'
import { usePaneInfo } from '../../composables/usePaneInfo'
import { useWorkspaceLinks } from '../../composables/useWorkspaceLinks'
import { useProjectRoots } from '../../composables/useProjectRoots'
import { captureLayout } from '../../lib/layouts'
import { renamedPanePatches, trashedPaneKeys } from '../../lib/explorer/tree'
import { hasLayouts, hasScripts, listLayouts, rememberScript, type SavedLayout } from '../../lib/projects'
import { folderName, projectOf } from '../../lib/sidebarRows'
import { createStartGuard } from '../../lib/startGuard'
import { dirKey } from '../../stores/favorites'
import { isLoopbackUrl, type LinkOpenOptions, type LinkTarget } from '../../lib/fileLinks'
import { baseName, changesStatus, fullAccess, hasFullAccess, hasPreview, openExternal, pickFile, previewUrl, readFile, requestAccess, type SearchQuery } from '../../lib/preview'
import { motionMs, pinLeaving, retireOverlay, withViewTransition } from '../../lib/motion'
import { dropKept, dustIn, dustOn, dustOutAll, hasKept, onDustLeave } from '../../lib/dust'
import type { MenuEntry } from '../../lib/menu'
import { isMac } from '../../lib/platform'
import { boxes, clampRatio, dividers, leaves, MIN_PANE, type Box, type Divider, type Edge, type SplitDir } from '../../lib/splitLayout'
import { DROP_TERM_KEYS, workspaceAction } from '../../lib/workspaceKeys'
import { editorKeepsKey, inEditor, onSaveAllRequest, reportDirty } from '../../lib/fileEditor'
import { isTyping, keyCombo, shortcutText } from '../../lib/shortcuts'
import { moveTargetOf, tabMenu } from '../../lib/tabMenu'
import { flashKind, stepSlot, tabMoveIndex, type FlashKind, type TabSignal } from '../../lib/tabStrip'
import { isMenuKey } from '../../lib/rail/railMenu'
import type { TipAction } from '../../lib/tips'
import { useTipsStore } from '../../stores/tips'
import { usePeersStore } from '../../stores/peers'
import { usePromptsStore } from '../../stores/prompts'
import { useNavigationStore } from '../../stores/navigation'
import { useTerminalsStore } from '../../stores/terminals'
import { displayTitle } from '../../lib/title'
import { useUiStore } from '../../stores/ui'
import { useSettingsStore } from '../../stores/settings'
import { closedPanes, isTerm, presetOf, primaryPaneKey, tabProject, useWorkspaceStore, workCwd, type ClosedEntry, type Pane, type PaneSpec, type SplitChoice, type Tab } from '../../stores/workspace'
import StatusIcon from '../StatusIcon.vue'
import LaunchPicker from './LaunchPicker.vue'
import BrowserPane from './BrowserPane.vue'
import ChangesPane from './ChangesPane.vue'
import ExplorerPanel from './ExplorerPanel.vue'
import FilePane from './FilePane.vue'
import LayoutsDialog from './LayoutsDialog.vue'
import LogPane from './log/LogPane.vue'
import ScriptsDialog from './ScriptsDialog.vue'
import PaneIcon from './PaneIcon.vue'
import PresetIcon from './PresetIcon.vue'
import QuickOpen from './QuickOpen.vue'

const PromptPicker = defineAsyncComponent(() => import('./PromptPicker.vue'))
const NavPicker = defineAsyncComponent(() => import('./NavPicker.vue'))
const NotesPanel = defineAsyncComponent(() => import('./NotesPanel.vue'))
const DropTerminal = defineAsyncComponent(() => import('./DropTerminal.vue'))
const PlanBoard = defineAsyncComponent(() => import('./PlanBoard.vue'))
const EnvCheckDialog = defineAsyncComponent(() => import('./EnvCheckDialog.vue'))
const I18nScanDialog = defineAsyncComponent(() => import('./I18nScanDialog.vue'))
const PermAdvisorDialog = defineAsyncComponent(() => import('./PermAdvisorDialog.vue'))
import RunPane from './RunPane.vue'
import ShortcutTip from './ShortcutTip.vue'
import TermPane from './TermPane.vue'
import RestorePicker from './RestorePicker.vue'
import ViewPaneControls from './ViewPaneControls.vue'
import WorkspaceSidebar from './WorkspaceSidebar.vue'
import SideResizer from './SideResizer.vue'
import RailColumn from './rail/RailColumn.vue'
import MissionControl from './MissionControl.vue'
import AttentionPopover from './AttentionPopover.vue'
import TabRenameInput from './TabRenameInput.vue'
import UndoToast, { type UndoInfo } from './UndoToast.vue'
import DimToggle from './DimToggle.vue'
import ContextMenu from '../ui/ContextMenu.vue'
import { clampSideWidth, EXPLORER_DEFAULT, EXPLORER_WIDTH_KEY, readSideWidth, SIDE_DEFAULT, SIDE_MAX, SIDE_MIN, writeSideWidth } from '../../lib/sideWidth'
import { hasRun } from '../../lib/desktop'
import { latestPeer, type RailCluster } from '../../lib/rail/railModel'
import { projectTabKeys, spaceIndexes, spaceLabel } from '../../lib/rail/spaces'
import { buildAttentionList } from '../../lib/rail/attentionList'
import { useRail } from '../../composables/useRail'
import { useRunStore } from '../../stores/run'
import { useExplorerStore } from '../../stores/explorer'
import { usePaneDrag, type PaneDragSource, type PaneDropAction } from '../../composables/usePaneDrag'

/** The view is on screen: App hides it with v-show for other views and in compact mode. */
const props = defineProps<{ visible: boolean }>()

const { t } = useI18n()
const workspace = useWorkspaceStore()
useWorkspaceLinks(() => props.visible)
const info = usePaneInfo()
const { describe, isBusy, viewDetail } = info
const settings = useSettingsStore()
workspace.setClosedNamer((pane) => info.titleOf(pane))

const SIDEBAR_KEY = 'ccm.workspace.sidebar'
const sidebarOpen = ref(readSidebar())
function readSidebar(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== '0'
  } catch {
    return true
  }
}
function toggleSidebar(): void {
  withViewTransition(() => (sidebarOpen.value = !sidebarOpen.value))
}
watch(sidebarOpen, (open) => {
  try {
    localStorage.setItem(SIDEBAR_KEY, open ? '1' : '0')
  } catch {
    // preference only
  }
})

/** File Explorer of the focused pane's project, in its own panel right of the stage. */
const EXPLORER_KEY = 'ccm.workspace.explorerOpen'
const explorerOpen = ref(readExplorerOpen())
function readExplorerOpen(): boolean {
  try {
    return localStorage.getItem(EXPLORER_KEY) !== '0'
  } catch {
    return true
  }
}
function toggleExplorer(): void {
  withViewTransition(() => (explorerOpen.value = !explorerOpen.value))
}
// The panel is on screen from the start, so it can ask for a new terminal's folder before main allows it.
const explorer = useExplorerStore()
watch(
  () => workspace.active?.state,
  (state) => {
    if (state === 'running' && explorerOpen.value) void explorer.retryFailed()
  },
)
watch(explorerOpen, (open) => {
  try {
    localStorage.setItem(EXPLORER_KEY, open ? '1' : '0')
  } catch {
    // preference only
  }
})

// Stored preferences; what is drawn is clamped to the current window so a narrow window never hides the stage.
// The left panel leaves room for the Explorer at its minimum; the Explorer takes what the left panel left.
const sideWidthPref = ref(readSideWidth())
const explorerWidthPref = ref(readSideWidth(EXPLORER_WIDTH_KEY, EXPLORER_DEFAULT))
const viewportW = ref(window.innerWidth)
const sideRoom = computed(() => viewportW.value - (explorerOpen.value ? SIDE_MIN : 0))
const sideWidth = computed(() => clampSideWidth(sideWidthPref.value, sideRoom.value))
const sideMax = computed(() => clampSideWidth(SIDE_MAX, sideRoom.value))
const explorerRoom = computed(() => viewportW.value - (sidebarOpen.value ? sideWidth.value : RAIL_COLUMN_W))
const explorerWidth = computed(() => clampSideWidth(explorerWidthPref.value, explorerRoom.value))
const explorerMax = computed(() => clampSideWidth(SIDE_MAX, explorerRoom.value))
const sideDragging = ref(false)
const explorerDragging = ref(false)
function onViewportResize(): void {
  viewportW.value = window.innerWidth
}
function resizeSide(px: number): void {
  sideWidthPref.value = clampSideWidth(px, sideRoom.value)
}
function resetSide(): void {
  sideWidthPref.value = SIDE_DEFAULT
  writeSideWidth(SIDE_DEFAULT)
}
function resizeExplorer(px: number): void {
  explorerWidthPref.value = clampSideWidth(px, explorerRoom.value)
}
function resetExplorer(): void {
  explorerWidthPref.value = EXPLORER_DEFAULT
  writeSideWidth(EXPLORER_DEFAULT, EXPLORER_WIDTH_KEY)
}

// Opened without a view transition: the tree must exist on the next tick to take focus.
const explorerPanel = ref<{ showSearch: (query?: SearchQuery) => Promise<void> } | null>(null)
async function showSearch(query?: SearchQuery): Promise<void> {
  explorerOpen.value = true
  await nextTick()
  await explorerPanel.value?.showSearch(query)
}
watch(
  () => workspace.searchRequest,
  (req) => {
    if (!req) return
    if (req.root) explorer.setRoot(req.root)
    void showSearch(req.query)
  },
)

async function showExplorer(): Promise<void> {
  explorerOpen.value = true
  await nextTick()
  ;(document.querySelector<HTMLElement>('[data-explorer-tree] [tabindex="0"]') ?? document.querySelector<HTMLElement>('[data-explorer] [role="tab"][tabindex="0"]'))?.focus()
}

/** Closed sidebar = the rail's avatar column; below SIDE_NARROW run badges in project headers shrink to icons. */
const RAIL_COLUMN_W = 52
const SIDE_NARROW = 264

const sideEvents = {
  scripts: (root: string) => void openScripts([root]),
  run: (root: string) => withViewTransition(() => workspace.openRun(root)),
  saveLayout: (root: string, name: string) => showLayouts(root, name, 'save'),
  manageLayouts: (root: string, name: string) => showLayouts(root, name, 'manage'),
  openLayout: (layout: SavedLayout) => openLayout(layout),
  close: (keys: string[]) => closePanes(keys),
  closeProject: (cluster: RailCluster) => closeProject(cluster),
  split: (key: string, dir: SplitDir, choice: SplitChoice) => {
    workspace.activate(key)
    void nextTick(() => splitActive(dir, choice, key))
  },
  explorer: (key: string) => {
    workspace.activate(key)
    void showExplorer()
  },
  mission: () => toggleMission(),
}

const rail = useRail()
/** Spaces: the strip, Ctrl+Alt+1–9 and Ctrl+Tab cover only the active tab's project (Mission Control shows all). */
const visibleTabKeys = computed(() => projectTabKeys(rail.clusters.value, workspace.tabs, workspace.activeTab?.key ?? null))
const visibleTabs = computed(() => visibleTabKeys.value.map((k) => workspace.tabs.find((t) => t.key === k)).filter((t): t is Tab => !!t))
const tabSpaces = computed(() => spaceIndexes(workspace.tabs, (t) => tabProject(t, paneOf)))
const activeCluster = computed(() => rail.clusters.value.find((c) => c.active) ?? null)
const otherNeeds = computed(() => rail.clusters.value.filter((c) => !c.active).reduce((n, c) => n + c.needs, 0))
const otherFailed = computed(() => rail.clusters.value.some((c) => !c.active && c.failed > 0))
const otherNews = computed(() => {
  const latest = latestPeer(rail.clusters.value.filter((c) => !c.active))
  return latest ? t('peerWs.projectNews', { text: info.peerView(latest).label }) : null
})

const missionOpen = ref(false)
const missionOpener = ref<HTMLElement | null>(null)
let missionReturn: HTMLElement | null = null

function toggleMission(): void {
  if (missionOpen.value) return closeMission(true)
  if (!workspace.tabs.length) return
  missionReturn = document.activeElement as HTMLElement | null
  missionOpen.value = true
}

function closeMission(focusOpener: boolean): void {
  if (!missionOpen.value) return
  missionOpen.value = false
  const back = missionReturn ?? missionOpener.value
  missionReturn = null
  void nextTick(() => {
    if (focusOpener && back?.isConnected && back.getClientRects().length) back.focus()
    else focusActivePane()
  })
}

function paneRect(key: string): DOMRect | null {
  return canvas.value?.querySelector<HTMLElement>(`[data-pane="${CSS.escape(key)}"]`)?.getBoundingClientRect() ?? null
}

const runs = useRunStore()
/** Close project while one of its apps still builds / runs: asks, then stops the runs before closing. */
const runClose = ref<{ cluster: RailCluster; ids: string[] } | null>(null)
const runCloseButton = ref<HTMLButtonElement | null>(null)
const runCloseBusy = ref(false)

function closeProject(cluster: RailCluster): void {
  const dirs = new Set(cluster.checkouts.map((k) => k.path).filter((d): d is string => !!d))
  for (const tabKey of cluster.tabKeys) {
    const tab = workspace.tabs.find((x) => x.key === tabKey)
    for (const key of tab ? leaves(tab.root) : []) {
      const pane = paneOf(key)
      if (pane?.kind === 'run' && pane.cwd) dirs.add(pane.cwd)
    }
  }
  const ids = hasRun ? [...new Set([...dirs].flatMap((d) => runs.liveSessionsFor(d).map((s) => s.id)))] : []
  if (ids.length) {
    runClose.value = { cluster, ids }
    void nextTick(() => runCloseButton.value?.focus())
  } else finishCloseProject(cluster)
}

function finishCloseProject(cluster: RailCluster): void {
  const keys = cluster.tabKeys.flatMap((k) => {
    const tab = workspace.tabs.find((x) => x.key === k)
    return tab ? leaves(tab.root) : []
  })
  const forget = (): void => {
    for (const dir of cluster.history) workspace.forget(dir)
  }
  if (keys.length) closePanes(keys)
  if (!workspace.pendingClose) return forget()
  // A busy pane opened the close confirm: forget the history only if the user went through with it.
  const stop = watch(
    () => workspace.pendingClose,
    (now) => {
      if (now) return
      stop()
      if (keys.every((k) => !paneOf(k))) forget()
    },
  )
}

function trapTab(e: KeyboardEvent): void {
  if (e.key !== 'Tab') return
  const buttons = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button:not([disabled])')]
  const at = buttons.indexOf(document.activeElement as HTMLElement)
  e.preventDefault()
  buttons[(at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus()
}

async function confirmRunClose(): Promise<void> {
  const pending = runClose.value
  if (!pending || runCloseBusy.value) return
  runCloseBusy.value = true
  try {
    await Promise.allSettled(pending.ids.map((id) => runs.stop(id)))
  } finally {
    runCloseBusy.value = false
    runClose.value = null
  }
  finishCloseProject(pending.cluster)
}

const closing = computed(() => (workspace.pendingClose ?? []).map((k) => workspace.panes.find((p) => p.key === k)).filter((p): p is Pane => !!p))
const confirmButton = ref<HTMLButtonElement | null>(null)
const confirmSheet = ref<HTMLElement | null>(null)
let confirmReturn: HTMLElement | null = null
// v42 unsaved file editors in the close sheet: Save (then close) / Don't save / Cancel.
const closingDirty = computed(() => closing.value.filter((p) => p.dirty))
const closingBusy = computed(() => closing.value.filter((p) => isBusy(p)))
const closeSaving = ref(false)
const closeErrors = ref<string[]>([])
async function saveAndClose(): Promise<void> {
  if (closeSaving.value) return
  closeSaving.value = true
  const failed = await workspace.saveFiles(closingDirty.value.map((p) => p.key))
  closeSaving.value = false
  closeErrors.value = failed.map((f) => t('editor.close.failed', { name: baseName(paneOf(f.key)?.path ?? f.key), reason: f.error }))
  if (!failed.length) await confirmPending()
}
// Quit (main process): it lists unsaved editors and may ask the page to save them all first.
watch(
  () => [workspace.dirtyPanes.map((p) => `${p.key}\n${p.path}`).join('\n'), settings.autoSave],
  () => reportDirty(
    workspace.dirtyPanes.map((p) => ({ name: baseName(p.path ?? ''), path: p.path ?? '' })),
    settings.autoSave !== 'off',
  ),
  { immediate: true },
)
onSaveAllRequest(async () => (await workspace.saveFiles(workspace.dirtyPanes.map((p) => p.key))).length === 0)
watch(
  () => workspace.pendingClose,
  async (keys, before) => {
    closeErrors.value = []
    if (keys && !before) confirmReturn = document.activeElement as HTMLElement | null
    await nextTick()
    if (keys) return confirmButton.value?.focus()
    if (!before) return
    const back = confirmReturn
    confirmReturn = null
    if (back?.isConnected && back.getClientRects().length) back.focus()
    else focusActivePane()
  },
)

function trapConfirm(e: KeyboardEvent): void {
  if (e.key !== 'Tab' || !confirmSheet.value) return
  const buttons = [...confirmSheet.value.querySelectorAll<HTMLElement>('button:not([disabled])')]
  const at = buttons.indexOf(document.activeElement as HTMLElement)
  const next = buttons[(at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]
  e.preventDefault()
  next?.focus()
}

function focusActivePane(): void {
  const key = workspace.activeKey
  if (key) canvas.value?.querySelector<HTMLElement>(`[data-pane="${CSS.escape(key)}"] .xterm-helper-textarea`)?.focus()
}

/** Folder the focused pane works in: Changes, Quick open and "Open file…" start from it. */
const contextCwd = computed(() => (workspace.active ? workCwd(workspace.active) : undefined))

const HTML = /\.html?$/i

/** A path outside every allowed folder asks for every folder at once (one native confirm), not that folder alone. */
async function ensureReadable(path: string, html: boolean): Promise<void> {
  const ok = html ? !!(await previewUrl(path)) : (await readFile(path))?.kind !== 'denied'
  if (ok) return
  if (hasFullAccess) await fullAccess(true)
  else await requestAccess(path)
}

/** Ctrl/⌘+click in a terminal. Each target opens in its own tab, reusing one already showing it; remote URLs (sign-in pages) go to the system browser. */
async function openLink(from: Pane, target: LinkTarget, opts: Partial<LinkOpenOptions>): Promise<void> {
  if (target.kind === 'url') {
    if (!isLoopbackUrl(target.url)) return void openExternal(target.url)
    withViewTransition(() => workspace.openBrowser(target.url, { cwd: workCwd(from) }))
    return
  }
  const html = HTML.test(target.path) && !opts.shift
  await ensureReadable(target.path, html)
  withViewTransition(() => {
    if (html) workspace.openBrowser(target.path, { cwd: workCwd(from) })
    else workspace.openFile(target.path, opts.line ?? target.line, { cwd: workCwd(from) })
  })
}

function openBrowserTab(url: string): void {
  closeMenu(false)
  workspace.openBrowser(url, { cwd: contextCwd.value })
}

async function openFileTab(): Promise<void> {
  closeMenu(false)
  const path = await pickFile('any', contextCwd.value ?? workspace.recentDirs[0])
  if (!path) return
  if (HTML.test(path)) workspace.openBrowser(path, { cwd: contextCwd.value })
  else workspace.openFile(path)
}

function openChangesTab(): void {
  closeMenu(false)
  if (contextCwd.value) workspace.openChanges(contextCwd.value)
}

function openLogTab(): void {
  closeMenu(false)
  if (contextCwd.value) workspace.openLog(contextCwd.value)
}

const quickOpen = ref(false)
const quickRoot = ref<string | null>(null)
// Focus before Quick open: `>` hands over to Scripts, whose own opener (the Quick open input) is gone when it closes.
let quickReturn: HTMLElement | null = null
const scriptsReturn = ref<HTMLElement | null>(null)

/** Root = git toplevel of the focused pane's folder (ls-files from a sub-folder lists only that sub-folder). */
async function openQuick(): Promise<void> {
  const pane = workspace.active
  const cwd = pane?.kind === 'changes' || pane?.kind === 'log' ? (pane.root ?? pane.cwd) : pane && workCwd(pane)
  quickRoot.value = cwd ?? null
  if (!quickOpen.value) quickReturn = document.activeElement as HTMLElement | null
  quickOpen.value = true
  if (!cwd) return
  const status = await changesStatus(cwd)
  if (status.ok && quickRoot.value === cwd) quickRoot.value = status.root
}

function onQuickPick(target: { path: string; line?: number; split: boolean }): void {
  const key = workspace.activeKey
  const cwd = quickRoot.value ?? undefined
  withViewTransition(() => workspace.openFile(target.path, target.line, target.split && key ? { cwd, split: { key, dir: 'row' } } : { cwd }))
}

/** Browser → agent target; several candidates in other tabs → a picker, none → a notice. */
const agentChoices = ref<{ from: string; text: string | null; panes: Pane[] } | null>(null)
const agentNotice = ref<string | null>(null)
let noticeTimer: ReturnType<typeof setTimeout> | null = null

function insertFromBrowser(browserKey: string, text: string | null): void {
  const res = workspace.resolveAgentPane(browserKey)
  if ('pane' in res) return deliver(res.pane.key, text)
  if (res.choices.length === 1) return deliver(res.choices[0]!.key, text)
  if (!res.choices.length) return showNotice(t('workspace.handoff.noTarget'))
  agentChoices.value = { from: browserKey, text, panes: res.choices }
}

function showNotice(text: string): void {
  agentNotice.value = text
  if (noticeTimer) clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => (agentNotice.value = null), 4000)
}

const { rootOf, resolve } = useProjectRoots()

/** Checkout a pane works in: git toplevel of its tab's project (a worktree stays itself), else that folder. */
function paneProject(pane: Pane): string | null {
  const tab = workspace.tabOf(pane.key)
  const dir = (tab && tabProject(tab, paneOf)) ?? pane.cwd
  return dir ? (rootOf(dir) ?? dir) : null
}

const activeProject = computed(() => (workspace.active ? paneProject(workspace.active) : null))

/** File shown by the focused viewer: the Explorer marks and reveals it. */
const activeFile = computed(() => (workspace.active?.kind === 'file' ? (workspace.active.path ?? null) : null))

/** Every file opened from the Explorer gets its own viewer, kept in the project. */
function openFromExplorer(path: string, _keep?: boolean, line?: number): void {
  const cwd = activeProject.value ?? undefined
  withViewTransition(() => workspace.openFile(path, line, { cwd }))
}

function openSplitFromExplorer(path: string): void {
  const cwd = activeProject.value ?? undefined
  const key = workspace.activeKey
  withViewTransition(() => workspace.openFile(path, undefined, key ? { cwd, split: { key, dir: 'row' } } : { cwd }))
}

function onExplorerTrashed(path: string): void {
  const keys = trashedPaneKeys(workspace.panes, path)
  if (keys.length) closePanes(keys, { record: false })
}

function onExplorerRenamed(from: string, to: string): void {
  for (const { key, patch } of renamedPanePatches(workspace.panes, from, to)) workspace.update(key, patch)
}

const scripts = ref<{ dirs: string[]; query?: string } | null>(null)
let scriptsSeq = 0

/** Pane's current folder first (a sub-package), then its project root. */
async function openScripts(dirs: string[], query?: string): Promise<void> {
  const given = dirs.filter(Boolean)
  const run = ++scriptsSeq
  scripts.value = { dirs: given, query }
  const roots = await Promise.all(given.map((d) => resolve(d)))
  if (run === scriptsSeq && scripts.value && roots.some((r) => !given.some((d) => dirKey(d) === dirKey(r)))) scripts.value = { dirs: [...given, ...roots], query }
}

function openScriptsForActive(query?: string): void {
  closeMenu(false)
  const pane = workspace.active
  const dir = pane ? workCwd(pane) : undefined
  void openScripts(dir ? [dir] : [], query)
}

function scriptsFromQuick(query: string): void {
  scriptsReturn.value = quickReturn
  openScriptsForActive(query)
}

function closeScripts(): void {
  scripts.value = null
  scriptsReturn.value = null
}

function runScript(target: { dir: string; run: string; split: boolean }): void {
  rememberScript(target.dir, target.run)
  const key = workspace.activeKey
  withViewTransition(() => workspace.runScript(target.dir, target.run, target.split && key ? { split: { key, dir: 'row' } } : {}))
}

type LayoutsTarget = { root: string; name: string; mode: 'save' | 'manage' }
const layoutsFor = ref<LayoutsTarget | null>(null)
// Kept while the dialog animates out.
const lastLayouts = ref<LayoutsTarget>({ root: '', name: '', mode: 'save' })

function showLayouts(root: string, name: string, mode: 'save' | 'manage'): void {
  closeMenu(false)
  layoutsFor.value = lastLayouts.value = { root, name, mode }
}

function captureFor(opts: { name: string; resume: boolean; id?: string; openOnStart?: boolean }) {
  const root = lastLayouts.value.root
  if (!root) return null
  const key = dirKey(root)
  const inProject = (p: Pane): boolean => {
    const project = paneProject(p)
    return !!project && dirKey(project) === key
  }
  return captureLayout(workspace.tabs, workspace.panes, inProject, { ...opts, project: root })
}

function openLayout(layout: SavedLayout): void {
  withViewTransition(() => {
    const added = adoptNew(() => workspace.openLayout(layout))
    showNotice(added ? t('workspace.layouts.opened', { name: layout.name }) : t('workspace.layouts.alreadyOpen', { name: layout.name }))
  })
}

function restoreLast(run?: ReadonlySet<string>): void {
  adoptNew(() => workspace.restoreLast(run))
}

// "Open on start": the first terminal opened in a project during this window's life brings its start layout along.
const START_KEY = 'ccm.workspace.startedProjects'
const startGuard = createStartGuard(readStarted(), (list) => {
  try {
    sessionStorage.setItem(START_KEY, JSON.stringify(list.slice(-200)))
  } catch {
    // per window only
  }
})
function readStarted(): string[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(START_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : []
  } catch {
    return []
  }
}

/** Panes made by `change` (restore, a layout) are not anyone's first terminal, and their projects count as started. */
function adoptNew<T>(change: () => T): T {
  const before = new Set(workspace.panes.map((p) => p.key))
  const result = change()
  const made = workspace.panes.filter((p) => !before.has(p.key))
  startGuard.adopt(made.map((p) => p.key))
  const dirs = new Set(made.filter(isTerm).map((p) => p.cwd).filter((d): d is string => !!d))
  for (const dir of dirs)
    void resolve(dir).then((root) => {
      const project = projectOf(root)
      if (project) startGuard.mark(dirKey(project))
    })
  return result
}

startGuard.adopt(workspace.panes.map((p) => p.key))
watch(
  () => workspace.panes.filter((p) => isTerm(p) && p.state === 'running').map((p) => p.key),
  (keys) => {
    for (const key of keys) if (startGuard.take(key)) void checkStart(key)
  },
)

async function checkStart(paneKey: string): Promise<void> {
  const pane = paneOf(paneKey)
  if (!hasLayouts || !pane?.cwd) return
  const root = projectOf(await resolve(pane.cwd))
  if (!root || !startGuard.claim(dirKey(root))) return
  const start = (await listLayouts(root)).find((l) => l.openOnStart)
  if (start && paneOf(paneKey)) openLayout(start)
}

function deliver(paneKey: string, text: string | null): void {
  agentChoices.value = null
  if (text === null) workspace.insertImage(paneKey)
  else workspace.insertInto(paneKey, text)
}

const choiceList = ref<HTMLElement | null>(null)
watch(agentChoices, async (c) => {
  if (!c) return
  await nextTick()
  choiceList.value?.querySelector<HTMLElement>('button')?.focus()
})

function onChoiceKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    agentChoices.value = null
    return
  }
  const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
  if (!step || !choiceList.value) return
  e.preventDefault()
  const items = [...choiceList.value.querySelectorAll<HTMLElement>('button')]
  const at = items.indexOf(document.activeElement as HTMLElement)
  items[(at + step + items.length) % items.length]?.focus()
}

/** Panes that close without asking morph away; a confirmation sheet opens without one. */
function closePanes(keys: string[], opts: { record?: boolean } = {}): void {
  // v62: with auto save on, dirty file panes save first; only the ones that fail still ask.
  if (settings.autoSave !== 'off' && keys.some((k) => paneOf(k)?.dirty)) {
    void workspace.saveFiles(keys).then(() => closeNow(keys, opts))
    return
  }
  closeNow(keys, opts)
}

function closeNow(keys: string[], opts: { record?: boolean }): void {
  // v42: a file pane with unsaved edits asks too (Save / Don't save / Cancel in the same sheet).
  const asksFor = (pane: Pane): boolean => isBusy(pane) || !!pane.dirty
  const open = keys.filter((k) => !dusting.has(k))
  if (!open.length) return
  const asks = open.some((k) => {
    const pane = paneOf(k)
    return !!pane && asksFor(pane)
  })
  if (asks) return workspace.requestClose(open, asksFor, opts)
  if (!canDust() || !open.some((k) => shownPane(k))) return removePanes(open, asksFor, opts)
  void dustPanes(open, opts.record !== false).then((els) => {
    removePanes(open, asksFor, opts, false)
    if (workspace.pendingClose) revive(els)
  })
}

function removePanes(keys: string[], asksFor: (pane: Pane) => boolean, opts: { record?: boolean }, morph = true): void {
  markClosingTabs(keys)
  if (morph) withViewTransition(() => workspace.requestClose(keys, asksFor, opts))
  else workspace.requestClose(keys, asksFor, opts)
}

const dusting = new Set<string>()
const closingTabs = new Set<string>()
const closeOut = ref(false)
const canDust = dustOn

function shownPane(key: string): HTMLElement | null {
  if (!props.visible || !tabBoxes.value.has(key)) return null
  return canvas.value?.querySelector<HTMLElement>(`[data-pane="${CSS.escape(key)}"]`) ?? null
}

function markClosingTabs(keys: readonly string[]): void {
  const gone = new Set(keys)
  for (const tab of workspace.tabs) {
    if (!leaves(tab.root).every((k) => gone.has(k))) continue
    const key = tab.key
    closingTabs.add(key)
    setTimeout(() => closingTabs.delete(key), 2000)
  }
}

function leavingChrome(keys: readonly string[]): Element[] {
  const gone = new Set(keys)
  const tabs = workspace.tabs.filter((tab) => leaves(tab.root).every((k) => gone.has(k))).map((tab) => tab.key)
  const pick = (sel: string): Element[] => [...document.querySelectorAll(sel)]
  return [
    ...tabs.flatMap((k) => pick(`[data-tab-item="${CSS.escape(k)}"], li[data-leave-tab="${CSS.escape(k)}"]`)),
    ...keys.flatMap((k) => pick(`li[data-leave-pane="${CSS.escape(k)}"]`)),
  ].filter((el) => el.getClientRects().length > 0)
}

async function dustPanes(keys: readonly string[], keep = true): Promise<HTMLElement[]> {
  const els = keys.map((k) => shownPane(k)).filter((el): el is HTMLElement => !!el)
  for (const k of keys) dusting.add(k)
  try {
    await dustOutAll(els, leavingChrome(keys), keep ? { keep: (el) => el.dataset.pane } : undefined)
  } finally {
    for (const k of keys) dusting.delete(k)
  }
  return els
}

const undoShown = ref<number | null>(null)
let undoSeen = 0
watch(
  () => workspace.closedStack.at(-1)?.id ?? 0,
  (id) => {
    if (id > undoSeen) {
      undoSeen = id
      undoShown.value = id
    } else if (undoShown.value !== null && !workspace.closedStack.some((e) => e.id === undoShown.value)) undoShown.value = null
  },
)
watch(
  () => props.visible,
  (shown) => {
    if (!shown) undoShown.value = null
  },
)

function closedText(entry: ClosedEntry, word: 'closed' | 'reopened'): string {
  const list = closedPanes(entry)
  return list.length === 1 ? t(`workspace.undo.${word}`, { name: list[0]!.name }) : t(`workspace.undo.${word}Many`, { n: list.length }, list.length)
}

const undoInfo = computed<UndoInfo | null>(() => {
  const entry = workspace.closedStack.find((e) => e.id === undoShown.value)
  if (!entry) return null
  return { id: entry.id, text: closedText(entry, 'closed'), shells: closedPanes(entry).filter((p) => isTerm(p) && p.preset === 'shell').length }
})
const undoKeys = shortcutText('wsReopen', isMac)

function dismissUndo(refocus: boolean): void {
  undoShown.value = null
  if (refocus) focusActivePane()
}

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

function fadeIn(el: HTMLElement): void {
  const ms = motionMs(Number.parseFloat(cssVar('--ccm-dur-base', '220')) || 220)
  if (!ms) return
  el.animate([{ opacity: 0, transform: 'scale(0.98)' }, { opacity: 1, transform: 'none' }], { duration: ms, easing: cssVar('--ease-out-quint', 'ease-out') })
}

let reopening = false

async function reopenLast(): Promise<void> {
  const entry = workspace.closedStack.at(-1)
  if (!entry || reopening) return
  reopening = true
  try {
    const said = closedText(entry, 'reopened')
    if (!canDust() || !props.visible || !closedPanes(entry).some((p) => hasKept(p.key))) {
      withViewTransition(() => {
        adoptNew(() => workspace.reopenClosed())
        void nextTick(focusActivePane)
      })
      announce(said)
      return
    }
    const res = adoptNew(() => workspace.reopenClosed())
    announce(said)
    if (!res?.keys.length) return
    await nextTick()
    const back = res.keys.map((key, i) => ({ el: shownPane(key), from: res.from[i]! }))
    const holds = back.map(({ el }) => el?.animate({ opacity: [0, 0] }, { duration: 4000, fill: 'both' }))
    focusActivePane()
    await nextFrame()
    await Promise.all(
      back.map(async ({ el, from }, i) => {
        if (!el) return dropKept(from)
        const played = await dustIn(el, from).catch(() => false)
        holds[i]?.cancel()
        if (played) return
        dropKept(from)
        fadeIn(el)
      }),
    )
  } finally {
    reopening = false
  }
}

function revive(els: readonly HTMLElement[]): void {
  for (const el of els) Object.assign(el.style, { visibility: '', opacity: '', transition: '', animation: '' })
}

const wait = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms))
const nextFrame = (): Promise<void> => new Promise((done) => requestAnimationFrame(() => done()))

async function confirmPending(): Promise<void> {
  const keys = [...(workspace.pendingClose ?? [])]
  if (!keys.length || closeOut.value) return
  const shown = keys.filter((k) => shownPane(k))
  if (!shown.length) {
    markClosingTabs(keys)
    workspace.confirmClose()
    return
  }
  const dust = canDust()
  closeOut.value = true
  await wait(motionMs(180))
  await nextFrame()
  if (dust) await dustPanes(shown)
  markClosingTabs(keys)
  if (dust) workspace.confirmClose()
  else withViewTransition(() => workspace.confirmClose())
  closeOut.value = false
}

function onTabLeave(el: Element, done: () => void): void {
  const key = (el as HTMLElement).dataset.tabItem
  if (key && closingTabs.delete(key) && canDust()) return onDustLeave(el, done)
  setTimeout(done, motionMs(150))
}

function closeTab(tab: Tab): void {
  if (leaves(tab.root).length === 1) tips.mouse('closePane')
  closePanes(leaves(tab.root))
}

// Mouse paths of actions that have a chord: counted for the shortcut tip (stores/tips.ts).
const tips = useTipsStore()
const prompts = usePromptsStore()
const nav = useNavigationStore()
const ui = useUiStore()
/** Project whose notes are open (undefined = closed); taken when opened so a focus change does not swap notes. */
const notesRoot = ref<string | null | undefined>(undefined)
// Ctrl+` terminal: mounted on first use, then only shown / hidden so its shell keeps running.
const dropMounted = ref(false)
const dropOpen = ref(false)
const dropCwd = ref<string | null>(null)
function toggleDropTerm(): void {
  if (!dropOpen.value) {
    dropCwd.value = activeProject.value ?? null
    dropMounted.value = true
  }
  dropOpen.value = !dropOpen.value
}
const planRoot = ref<string | null>(null)
watch(
  () => ui.planBoard,
  (open) => {
    if (!open) return
    const dir = open.dir ?? activeProject.value ?? workspace.recentDirs[0] ?? null
    planRoot.value = dir ? (rootOf(dir) ?? dir) : null
  },
  { immediate: true },
)
const envRoot = ref<string | null>(null)
watch(
  () => ui.envCheck,
  (open) => {
    if (!open) return
    const dir = open.dir ?? activeProject.value ?? workspace.recentDirs[0] ?? null
    envRoot.value = dir ? (rootOf(dir) ?? dir) : null
  },
  { immediate: true },
)
const i18nRoot = ref<string | null>(null)
watch(
  () => ui.i18nScan,
  (open) => {
    if (!open) return
    const dir = open.dir ?? activeProject.value ?? workspace.recentDirs[0] ?? null
    i18nRoot.value = dir ? (rootOf(dir) ?? dir) : null
  },
  { immediate: true },
)
const permRoot = ref<string | null>(null)
watch(
  () => ui.permAdvisor,
  (open) => {
    if (!open) return
    const dir = open.dir ?? activeProject.value ?? workspace.recentDirs[0] ?? null
    permRoot.value = dir ? (rootOf(dir) ?? dir) : null
  },
  { immediate: true },
)

function mouseSplit(choice: SplitChoice, key: string): void {
  tips.mouse('split')
  splitActive(undefined, choice, key)
}

function mouseClose(key: string): void {
  tips.mouse('closePane')
  closePanes([key])
}

function mouseFocus(key: string): void {
  if (multiPane.value && workspace.activeKey !== key) tips.mouse('focus')
  workspace.activate(key)
}

function onTabClick(tab: Tab): void {
  if (tab !== workspace.activeTab) tips.mouse('tab')
  workspace.activateTab(tab.key)
}

function onPlusClick(): void {
  if (menuOpen.value) return closeMenu()
  tips.mouse('newTab')
  void openMenu()
}

/** Needs-you list: failed then asked, oldest first, every project. The chord still jumps straight to the next one. */
const needs = computed(() => buildAttentionList(rail.clusters.value))
const chipCount = computed(() => needs.value.entries.length)
const attentionChip = ref<HTMLButtonElement | null>(null)
const needsAnchor = ref<DOMRect | null>(null)

function onAttentionClick(): void {
  tips.mouse('attention')
  needsAnchor.value = needsAnchor.value ? null : (attentionChip.value?.getBoundingClientRect() ?? null)
}

function closeNeeds(refocus: boolean): void {
  needsAnchor.value = null
  if (refocus) attentionChip.value?.focus()
}
watch(chipCount, (n) => {
  if (!n) needsAnchor.value = null
})
watch(
  () => props.visible,
  (shown) => {
    if (shown) return
    needsAnchor.value = null
    missionOpen.value = false
  },
)
// Not closeMission: refocusing the pane would pull focus out of the dialog that just opened.
watch(
  () => quickOpen.value || ui.settingsOpen,
  (covered) => {
    if (!covered || !missionOpen.value) return
    missionOpen.value = false
    missionReturn = null
  },
)

const KEY_TIP: Partial<Record<string, TipAction>> = { newTab: 'newTab', split: 'split', closePane: 'closePane', attention: 'attention', cycleTab: 'tab', tab: 'tab', focus: 'focus' }

// Help: shortcuts list + this view's guide (ShortcutsDialog / OnboardingTour live in App.vue).
const helpOpen = ref(false)
const helpButton = ref<HTMLButtonElement | null>(null)
const helpMenu = ref<HTMLElement | null>(null)

function closeHelp(focusButton = false): void {
  helpOpen.value = false
  if (focusButton) helpButton.value?.focus()
}

async function toggleHelp(): Promise<void> {
  if (helpOpen.value) return closeHelp()
  helpOpen.value = true
  await nextTick()
  helpMenu.value?.querySelector<HTMLElement>('[role=menuitem]')?.focus()
}

function helpAction(run: () => void): void {
  closeHelp()
  run()
}

function onHelpKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' || e.key === 'Tab') {
    if (e.key === 'Escape') e.preventDefault()
    e.stopPropagation()
    closeHelp(e.key === 'Escape')
    return
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  e.preventDefault()
  const items = [...(helpMenu.value?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])]
  const at = items.indexOf(document.activeElement as HTMLElement)
  items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
}

function onHelpOutside(e: PointerEvent): void {
  const target = e.target as Node
  if (!helpMenu.value?.contains(target) && !helpButton.value?.contains(target)) closeHelp()
}

watch(helpOpen, (open) => {
  if (open) document.addEventListener('pointerdown', onHelpOutside, true)
  else document.removeEventListener('pointerdown', onHelpOutside, true)
})

function clearSeenAttention(): void {
  const pane = workspace.active
  if (pane?.attention && props.visible && document.hasFocus()) workspace.update(pane.key, { attention: undefined })
}
watch(() => [props.visible, workspace.activeKey, workspace.active?.attention], clearSeenAttention)

const MENU_ROW =
  'group/row flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-inner px-2 text-left text-sm text-ink hover:bg-fill focus-visible:bg-accent focus-visible:text-on-accent focus-visible:outline-none'

const GAP = 8
const MIN_PANE_PX = MIN_PANE.w
const MIN_PANE_H_PX = MIN_PANE.h

const canvas = ref<HTMLElement | null>(null)
const canvasSize = ref({ w: 0, h: 0 })
let canvasObserver: ResizeObserver | null = null

const menuOpen = ref(false)
const menuAlignRight = ref(false)
const menuTrigger = ref<HTMLButtonElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const menuPicker = ref<InstanceType<typeof LaunchPicker> | null>(null)
const emptyPicker = ref<InstanceType<typeof LaunchPicker> | null>(null)

const tabZoom = (tab: Tab | null | undefined): string | null => {
  if (!tab?.zoom) return null
  const keys = leaves(tab.root)
  return keys.length > 1 && keys.includes(tab.zoom) ? tab.zoom : null
}
const zoomedKey = computed(() => tabZoom(workspace.activeTab))
const layoutBoxes = computed(() => (workspace.activeTab ? boxes(workspace.activeTab.root) : new Map<string, Box>()))
const tabBoxes = computed(() => (zoomedKey.value ? new Map<string, Box>([[zoomedKey.value, { x: 0, y: 0, w: 1, h: 1 }]]) : layoutBoxes.value))
const tabDividers = computed(() => (workspace.activeTab && !zoomedKey.value ? dividers(workspace.activeTab.root) : []))
const multiPane = computed(() => tabBoxes.value.size > 1)
const hiddenCount = computed(() => (zoomedKey.value ? layoutBoxes.value.size - 1 : 0))
const isZoomed = (key: string): boolean => key === zoomedKey.value
const hiddenOf = (key: string): number => (isZoomed(key) ? hiddenCount.value : 0)
const paneDim = (key: string): boolean => settings.dimInactive && multiPane.value && key !== workspace.activeKey

function toggleZoom(key = workspace.activeKey): void {
  const tab = key ? workspace.tabOf(key) : undefined
  if (!key || !tab) return
  const n = leaves(tab.root).length
  const on = tab.zoom !== key
  if (on && n < 2) return
  const pane = paneOf(key)
  withViewTransition(() => {
    workspace.toggleZoom(key)
    void nextTick(() => {
      const focused = document.activeElement
      if (!focused || focused === document.body || !focused.isConnected) focusActivePane()
    })
  })
  announce(on ? t('workspace.zoom.said.on', { name: pane ? info.titleOf(pane) : '', n: n - 1 }, n - 1) : t('workspace.zoom.said.off', { n }))
}

function unzoomTab(tab: Tab): void {
  if (!tabZoom(tab)) return
  withViewTransition(() => workspace.clearZoom(tab.key))
  announce(t('workspace.zoom.said.off', { n: leaves(tab.root).length }))
}

function toggleDim(): void {
  settings.dimInactive = !settings.dimInactive
  announce(t(settings.dimInactive ? 'workspace.dim.said.on' : 'workspace.dim.said.off'))
}

function launch(cwd: string | undefined): void {
  closeMenu(false)
  workspace.open(workspace.preset, cwd)
}

async function openMenu(): Promise<void> {
  // No tabs: the picker is already on screen, inline in the empty state.
  if (!workspace.tabs.length) return emptyPicker.value?.focusFirst()
  // Left-aligned under the "+" like a browser, unless that would run off the right edge.
  const r = menuTrigger.value?.getBoundingClientRect()
  menuAlignRight.value = !!r && r.left + 380 > window.innerWidth - 12
  menuOpen.value = true
  await nextTick()
  menuPicker.value?.focusFirst()
}

/** Double-click on the empty strip after the "+" opens a new tab, as in a browser. */
function onStripDblClick(e: MouseEvent): void {
  if (e.target === e.currentTarget) void openMenu()
}

function closeMenu(focusTrigger = true): void {
  if (!menuOpen.value) return
  menuOpen.value = false
  if (focusTrigger) menuTrigger.value?.focus()
}

function onFocusOut(e: FocusEvent): void {
  const next = e.relatedTarget as Node | null
  if (next && !menu.value?.contains(next) && !menuTrigger.value?.contains(next)) closeMenu(false)
}

function onOutside(e: PointerEvent): void {
  const target = e.target as Node
  if (!menu.value?.contains(target) && !menuTrigger.value?.contains(target)) closeMenu(false)
}

watch(menuOpen, (open) => {
  if (open) document.addEventListener('pointerdown', onOutside, true)
  else document.removeEventListener('pointerdown', onOutside, true)
})
watch(
  () => workspace.tabs.length,
  (n) => {
    if (!n) menuOpen.value = false
  },
)
watch(
  () => props.visible,
  (shown) => {
    if (!shown) menuOpen.value = false
  },
)

const paneOf = (key: string): Pane | undefined => workspace.panes.find((p) => p.key === key)

// The tab shows whoever needs the user most: a waiting agent beats a working one.
const RANK: Record<string, number> = { waiting: 4, error: 3, working: 2, idle: 1 }
interface TabState {
  status: TerminalStatus
  subagents: number
}
function computeTabState(tab: Tab): TabState | null {
  const primary = primaryPaneKey(tab.root, paneOf)
  let best: (TabState & { rank: number }) | null = null
  for (const key of [primary, ...leaves(tab.root).filter((k) => k !== primary)]) {
    const pane = paneOf(key)
    const status = info.statusOf(pane)
    if (!status) continue
    const rank = RANK[status] ?? 0
    if (!best || rank > best.rank) best = { status, subagents: info.subagentsOf(pane), rank }
  }
  return best && { status: best.status, subagents: best.subagents }
}

function tabAttention(tab: Tab): Pane['attention'] {
  const kinds = leaves(tab.root).map((k) => paneOf(k)?.attention)
  return kinds.includes('waiting') ? 'waiting' : kinds.includes('done') ? 'done' : undefined
}

function tabEnded(tab: Tab): boolean {
  return leaves(tab.root).every((k) => {
    const s = paneOf(k)?.state
    return s === 'exited' || s === 'error' || s === 'gone'
  })
}

function boxStyle(box: Box): Record<string, string> {
  const edge = (v: number): boolean => v < 1e-6 || v > 1 - 1e-6
  const left = edge(box.x) ? 0 : GAP / 2
  const right = edge(box.x + box.w) ? 0 : GAP / 2
  const top = edge(box.y) ? 0 : GAP / 2
  const bottom = edge(box.y + box.h) ? 0 : GAP / 2
  return {
    left: `calc(${box.x * 100}% + ${left}px)`,
    top: `calc(${box.y * 100}% + ${top}px)`,
    width: `calc(${box.w * 100}% - ${left + right}px)`,
    height: `calc(${box.h * 100}% - ${top + bottom}px)`,
  }
}

function dividerStyle(d: Divider): Record<string, string> {
  if (d.dir === 'row') {
    const x = d.box.x + d.box.w * d.ratio
    return { left: `calc(${x * 100}% - ${GAP / 2}px)`, top: `${d.box.y * 100}%`, width: `${GAP}px`, height: `${d.box.h * 100}%` }
  }
  const y = d.box.y + d.box.h * d.ratio
  return { top: `calc(${y * 100}% - ${GAP / 2}px)`, left: `${d.box.x * 100}%`, height: `${GAP}px`, width: `${d.box.w * 100}%` }
}

/** Ratio bounds that keep both sides of a split at least the minimum pane size. */
function ratioBounds(d: Divider): [number, number] {
  const span = d.dir === 'row' ? d.box.w * canvasSize.value.w : d.box.h * canvasSize.value.h
  const min = d.dir === 'row' ? MIN_PANE_PX : MIN_PANE_H_PX
  const lo = span > 0 ? Math.max(clampRatio(0), min / span) : clampRatio(0)
  const hi = span > 0 ? Math.min(clampRatio(1), 1 - min / span) : clampRatio(1)
  return lo <= hi ? [lo, hi] : [0.5, 0.5]
}

function setDivider(d: Divider, ratio: number): void {
  const tab = workspace.activeTab
  if (!tab) return
  const [lo, hi] = ratioBounds(d)
  workspace.setRatio(tab.key, d.path, Math.min(hi, Math.max(lo, ratio)))
}

function startDrag(d: Divider, e: PointerEvent): void {
  const el = canvas.value
  if (!el) return
  const handle = e.currentTarget as HTMLElement
  handle.setPointerCapture(e.pointerId)
  const rect = el.getBoundingClientRect()
  let frame = 0
  const move = (ev: PointerEvent): void => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      const r = d.dir === 'row' ? ((ev.clientX - rect.left) / rect.width - d.box.x) / d.box.w : ((ev.clientY - rect.top) / rect.height - d.box.y) / d.box.h
      setDivider(d, r)
    })
  }
  const end = (): void => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', end)
    handle.removeEventListener('pointercancel', end)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
}

function onDividerKey(d: Divider, e: KeyboardEvent): void {
  const back = d.dir === 'row' ? 'ArrowLeft' : 'ArrowUp'
  const fwd = d.dir === 'row' ? 'ArrowRight' : 'ArrowDown'
  if (e.key !== back && e.key !== fwd) return
  e.preventDefault()
  setDivider(d, d.ratio + (e.key === fwd ? 0.05 : -0.05))
}

/** Splits along the longer side unless told otherwise; refuses when the halves would be too small to use. */
function splitActive(dir?: SplitDir, choice?: SplitChoice, key = workspace.activeKey): void {
  const box = key ? layoutBoxes.value.get(key) : undefined
  if (!key || !box) return
  const w = box.w * canvasSize.value.w
  const h = box.h * canvasSize.value.h
  const fits = (d: SplitDir): boolean => (d === 'row' ? w / 2 >= MIN_PANE_PX : h / 2 >= MIN_PANE_H_PX)
  const want: SplitDir = dir ?? (w >= h * 1.4 ? 'row' : 'col')
  const other: SplitDir = want === 'row' ? 'col' : 'row'
  const chosen = fits(want) ? want : !dir && fits(other) ? other : null
  const spec: PaneSpec | undefined = !choice ? undefined : choice === 'browser' ? { kind: 'browser', url: '' } : { kind: 'term', preset: choice }
  if (chosen) withViewTransition(() => workspace.split(key, chosen, spec))
}

function onGlobalKey(e: KeyboardEvent): void {
  if (!props.visible || e.defaultPrevented) return
  // Alt+↑/↓ on a rail project header reorders projects (WorkspaceSidebar), not pane focus.
  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && (e.target as Element | null)?.closest?.('[data-side-head]')) return
  if (inEditor(e.target) && editorKeepsKey(e, isMac)) return
  const action = workspaceAction(e, isMac, multiPane.value)
  if (!action) return
  // The drop-down terminal floats over the active pane: chords aimed at that pane stay with the shell.
  if (!DROP_TERM_KEYS.has(action.t) && (e.target as Element | null)?.closest?.('[data-drop-term]')) return
  // ⌃- is readline undo in a macOS terminal.
  if ((action.t === 'navBack' || action.t === 'navForward') && isMac && (e.target as Element | null)?.closest?.('.xterm')) return
  if (action.t === 'reopen' && !isMac && (inEditor(e.target) || (isTyping(e.target) && !(e.target as Element).closest?.('.xterm')))) return
  e.preventDefault()
  e.stopPropagation()
  const tip = KEY_TIP[action.t]
  if (tip) tips.key(tip)
  switch (action.t) {
    case 'newTab':
      void openMenu()
      break
    case 'split':
      splitActive(action.dir)
      break
    case 'closePane':
      if (workspace.activeKey) closePanes([workspace.activeKey])
      break
    case 'attention':
      workspace.nextAttention()
      break
    case 'cycleTab':
      workspace.cycleTab(action.step, visibleTabKeys.value)
      break
    case 'tab': {
      const tab = visibleTabs.value[action.index]
      if (tab) workspace.activateTab(tab.key)
      break
    }
    case 'focus':
      workspace.moveFocus(action.dir)
      break
    case 'swap':
      withViewTransition(() => workspace.swapWith(action.dir))
      break
    case 'quickOpen':
      if (quickOpen.value) quickOpen.value = false
      else if (hasPreview) void openQuick()
      break
    case 'explorer':
      void showExplorer()
      break
    case 'search':
      void showSearch()
      break
    case 'mission':
      toggleMission()
      break
    case 'moveTab':
      moveActiveTab(action.step)
      break
    case 'zoom':
      toggleZoom()
      break
    case 'reopen':
      void reopenLast()
      break
    case 'prompts':
      prompts.open = !prompts.open
      break
    case 'recent':
    case 'bookmarks':
      nav.picker = nav.picker ? null : action.t
      break
    case 'navBack':
    case 'navForward':
      nav.step(action.t === 'navBack' ? -1 : 1)
      break
    case 'notes':
      notesRoot.value = notesRoot.value === undefined ? activeProject.value : undefined
      break
    case 'dropTerm':
      toggleDropTerm()
      break
  }
}

function onTabKey(e: KeyboardEvent, tab: Tab, index: number): void {
  if (isMenuKey(e)) {
    e.preventDefault()
    e.stopPropagation()
    openTabMenuFromKey(tab)
    return
  }
  if (e.key === 'F2' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
    e.preventDefault()
    startRename(tab)
    return
  }
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
  e.preventDefault()
  const n = visibleTabs.value.length
  const next = visibleTabs.value[(index + (e.key === 'ArrowRight' ? 1 : -1) + n) % n]
  if (!next) return
  workspace.activateTab(next.key)
  ;(e.currentTarget as HTMLElement).parentElement?.parentElement?.querySelector<HTMLElement>(`[data-tab="${next.key}"]`)?.focus()
}

const lastSummary = computed(() => {
  const snap = workspace.last
  if (!snap) return null
  return {
    tabs: snap.tabs.length,
    panes: snap.panes.length,
    agents: snap.panes.filter((p) => p.resume).length,
  }
})

// One highlight slides between tabs (as in SessionTabs) instead of each tab switching its own background.
const tabStrip = ref<HTMLElement | null>(null)
const tabPill = ref<{ x: number; w: number } | null>(null)
const pillReady = ref(false)
let pillTarget: HTMLElement | null = null
const pillObserver = new ResizeObserver(() => measurePill())
function measurePill(): void {
  const el = tabStrip.value?.querySelector<HTMLElement>('[data-selected]') ?? null
  if (el !== pillTarget) {
    if (pillTarget) pillObserver.unobserve(pillTarget)
    if (el) pillObserver.observe(el)
    pillTarget = el
  }
  if (el && !el.offsetWidth) return
  tabPill.value = el ? { x: el.offsetLeft, w: el.offsetWidth } : null
  if (tabPill.value && !pillReady.value) requestAnimationFrame(() => (pillReady.value = true))
}
watch(() => [workspace.activeTab?.key, visibleTabKeys.value.join(), props.visible], measurePill, { flush: 'post' })

// A plain mouse wheel only sends deltaY; the strip scrolls sideways. Trackpad sideways swipes keep their native path.
function onStripWheel(e: WheelEvent): void {
  const el = tabStrip.value
  if (!el || e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY) || el.scrollWidth <= el.clientWidth) return
  const step = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? e.deltaY * el.clientWidth : e.deltaY
  const before = el.scrollLeft
  el.scrollLeft += step
  if (el.scrollLeft !== before) e.preventDefault()
}

const stripFade = ref({ start: false, end: false })
let fadeFrame = 0
function measureFade(): void {
  cancelAnimationFrame(fadeFrame)
  fadeFrame = requestAnimationFrame(() => {
    const el = tabStrip.value
    const max = el ? el.scrollWidth - el.clientWidth : 0
    const start = !!el && max > 1 && el.scrollLeft > 1
    const end = !!el && max > 1 && el.scrollLeft < max - 1
    if (start !== stripFade.value.start || end !== stripFade.value.end) stripFade.value = { start, end }
  })
}
const stripObserver = new ResizeObserver(measureFade)
watch(
  tabStrip,
  (el) => {
    stripObserver.disconnect()
    if (el) {
      stripObserver.observe(el)
      const list = el.querySelector(':scope > [role="presentation"]')
      if (list) stripObserver.observe(list)
    }
    measureFade()
  },
  { flush: 'post' },
)

const tabPrimary = (tab: Tab): Pane | undefined => paneOf(primaryPaneKey(tab.root, paneOf))

const tabNames = computed(() => new Map(visibleTabs.value.map((tab) => [tab.key, info.tabTitle(tab)] as const)))
const tabName = (tab: Tab): string => tabNames.value.get(tab.key) ?? info.tabTitle(tab)
const tabStates = computed(() => new Map(visibleTabs.value.map((tab) => [tab.key, computeTabState(tab)] as const)))
const tabState = (tab: Tab): TabState | null => tabStates.value.get(tab.key) ?? null
const tabNews = computed(
  () => new Map(visibleTabs.value.filter((tab) => tab !== workspace.activeTab).map((tab) => [tab.key, info.peerNewsOf(leaves(tab.root).map(paneOf))] as const)),
)
const tabNewsOf = (tab: Tab) => tabNews.value.get(tab.key) ?? null
const tabPeerLines = (tab: Tab): string[] => [...new Set(leaves(tab.root).flatMap((k) => info.peerLines(paneOf(k))))]

const peers = usePeersStore()
const terminals = useTerminalsStore()
let heardKey = peers.pulses.at(-1)?.key ?? 0
watch(
  () => peers.pulses,
  (list) => {
    const fresh = list.filter((p) => p.key > heardKey)
    heardKey = list.at(-1)?.key ?? heardKey
    const last = [...fresh].reverse().find((p) => p.kind === 'message' && workspace.paneByTerminal.has(p.to))
    if (!last || !props.visible) return
    const name = (id: string): string => displayTitle(terminals.byId[id]) || t('peerWs.someone')
    announce(t('peer.live', { to: name(last.to), from: name(last.from), n: last.n }, last.n))
  },
)

function tabStatusText(tab: Tab): string {
  const s = tabState(tab)
  if (!s) return tabEnded(tab) ? t('workspace.ended') : ''
  const status = t(`status.${s.status}`)
  return s.subagents ? `${status}, ${t('workspace.subagentState.count', { n: s.subagents }, s.subagents)}` : status
}

const tabRow = ref<HTMLElement | null>(null)
const dragAnnounce = ref('')
const swapKeyName = isMac ? '⌘' : 'Ctrl'
const tabDraggable = (): boolean => visibleTabs.value.length > 1

function announce(text: string): void {
  dragAnnounce.value = ''
  void nextTick(() => (dragAnnounce.value = text))
}

const tabButton = (key: string): HTMLElement | null => tabStrip.value?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(key)}"]`) ?? null

const LABEL_FLASH_MS = 1700
const TAB_FLASH_MS = 1000

function settle<V>(map: { value: Record<string, V> }, key: string, value: V, ms: number): void {
  map.value = { ...map.value, [key]: value }
  setTimeout(() => {
    if (toRaw(map.value[key]) !== value) return
    const rest = { ...map.value }
    delete rest[key]
    map.value = rest
  }, ms)
}

const labelFlash = ref<Record<string, number>>({})
function highlightLabel(key: string): void {
  settle(labelFlash, key, (labelFlash.value[key] ?? 0) + 1, LABEL_FLASH_MS)
}
watch(
  () => [...tabNames.value],
  (now, before) => {
    const prev = new Map(before ?? [])
    for (const [key, name] of now) if (prev.has(key) && prev.get(key) !== name) highlightLabel(key)
  },
)

const FLASH_GAP_MS = 1500
const FLASH_CLASS: Record<FlashKind, string> = { waiting: 'text-st-waiting', done: 'text-st-done', error: 'text-st-error' }
const tabFlash = ref<Record<string, { n: number; kind: FlashKind }>>({})
const lastFlash = new Map<string, { kind: FlashKind; at: number }>()
watch(
  () => visibleTabs.value.map((tab): [string, TabSignal] => [tab.key, { status: tabState(tab)?.status, attention: tabAttention(tab) }]),
  (now, before) => {
    const prev = new Map(before ?? [])
    const at = performance.now()
    for (const [key, signal] of now) {
      const old = prev.get(key)
      const kind = old ? flashKind(old, signal) : null
      if (!kind) continue
      const last = lastFlash.get(key)
      if (last?.kind === kind && at - last.at < FLASH_GAP_MS) continue
      lastFlash.set(key, { kind, at })
      settle(tabFlash, key, { n: (tabFlash.value[key]?.n ?? 0) + 1, kind }, TAB_FLASH_MS)
    }
  },
)

const renaming = ref<string | null>(null)
const renameWidth = ref(160)
let renameFrom: { key: string; name?: string } | null = null

function startRename(tab: Tab): void {
  if (renaming.value === tab.key) return
  renameWidth.value = Math.min(260, Math.max(140, tabButton(tab.key)?.offsetWidth ?? 0))
  renameFrom = { key: tab.key, name: tab.name }
  renaming.value = tab.key
}

async function onRenameDone(key: string, saved: boolean): Promise<void> {
  const from = renameFrom?.key === key ? renameFrom : null
  renameFrom = null
  renaming.value = null
  const tab = workspace.tabs.find((x) => x.key === key)
  if (saved && tab && from) {
    if (tab.name !== from.name) announce(t(tab.name ? 'workspace.tabName.renamed' : 'workspace.tabName.reset', { name: info.tabTitle(tab) }))
    highlightLabel(key)
  }
  await nextTick()
  const focused = document.activeElement
  if (!focused || focused === document.body) tabButton(key)?.focus()
}

watch(visibleTabKeys, (keys) => {
  if (!renaming.value || keys.includes(renaming.value)) return
  renaming.value = null
  renameFrom = null
})

const tabCtx = ref<{ at: DOMRect; trigger: HTMLElement | null; label: string; entries: MenuEntry[]; pick: (id: string) => void } | null>(null)
const KEY_MENU_ECHO_MS = 300
let keyMenuAt = 0

const projectMates = (tab: Tab): Tab[] => visibleTabs.value.filter((x) => x.key !== tab.key && rail.sameProject(tab.key, x.key))

const compactFlow = useCompact()
watch(
  () => compactFlow.notice.value?.n,
  () => compactFlow.notice.value && announce(compactFlow.notice.value.text),
)

function agentPaneOf(tab: Tab): Pane | undefined {
  const agents = leaves(tab.root)
    .map((k) => paneOf(k))
    .filter((p): p is Pane => !!p && isTerm(p) && presetOf(p) !== 'shell')
  return agents.find((p) => p.key === tab.focus) ?? agents[0]
}

function parkedIn(tab: Tab): string[] {
  return leaves(tab.root).filter((k) => paneOf(k)?.state === 'parked')
}

function openTabMenu(tab: Tab, at: DOMRect): void {
  const mates = projectMates(tab)
  const entries = tabMenu(
    {
      active: tab === workspace.activeTab,
      panes: leaves(tab.root).length,
      targets: mates.map((x) => ({ key: x.key, name: tabName(x) })),
      others: mates.length,
      compact: compactFlow.stateOf(agentPaneOf(tab)),
      zoomed: !!tabZoom(tab),
      zoomKeys: shortcutText('wsZoom', isMac),
      dim: settings.dimInactive,
      parked: parkedIn(tab).length,
    },
    t,
  )
  const key = tab.key
  tabCtx.value = { at, trigger: tabButton(key), label: t('workspace.tabActions.label', { name: tabName(tab) }), entries, pick: (id) => pickTabAction(id, key) }
}

function onTabContext(tab: Tab, e: MouseEvent): void {
  e.preventDefault()
  if (renaming.value === tab.key || (tabCtx.value && performance.now() - keyMenuAt < KEY_MENU_ECHO_MS)) return
  openTabMenu(tab, new DOMRect(e.clientX, e.clientY, 0, 0))
}

function openTabMenuFromKey(tab: Tab): void {
  const r = tabButton(tab.key)?.getBoundingClientRect()
  if (!r) return
  keyMenuAt = performance.now()
  openTabMenu(tab, new DOMRect(r.left + 12, r.bottom, 0, 0))
}

function pickTabAction(id: string, key: string): void {
  const tab = workspace.tabs.find((x) => x.key === key)
  if (!tab) return
  const target = moveTargetOf(id)
  if (target) return mergeTabInto(tab, target)
  switch (id) {
    case 'wake':
      workspace.wake(parkedIn(tab))
      break
    case 'open':
      workspace.activateTab(tab.key)
      break
    case 'rename':
      startRename(tab)
      break
    case 'zoom':
      toggleZoom(tab.focus)
      break
    case 'unzoom':
      unzoomTab(tab)
      break
    case 'dim':
      toggleDim()
      break
    case 'compact':
    case 'compact-cancel': {
      const agent = agentPaneOf(tab)
      if (agent && id === 'compact') compactFlow.start(agent.key)
      else if (agent) compactFlow.cancel(agent.key)
      break
    }
    case 'ungroup': {
      const name = tabName(tab)
      const n = leaves(tab.root).length
      withViewTransition(() => workspace.ungroup(tab.key))
      announce(t('workspace.paneDrop.ungrouped', { tab: name, n }))
      break
    }
    case 'close':
      closeTab(tab)
      break
    case 'close-others': {
      const keys = projectMates(tab).flatMap((x) => leaves(x.root))
      if (keys.length) closePanes(keys)
      break
    }
  }
}

function mergeTabInto(tab: Tab, targetKey: string): void {
  const to = workspace.tabs.find((x) => x.key === targetKey)
  if (!to || to === tab || !rail.sameProject(tab.key, to.key)) return
  const names = { tab: tabName(tab), target: tabName(to) }
  withViewTransition(() => workspace.mergeTab(tab.key, to.focus, 'right'))
  announce(t('workspace.paneDrop.merged', names))
  void nextTick(focusActivePane)
}

function reorderTab(key: string, slot: number): void {
  const to = tabMoveIndex(
    workspace.tabs.map((x) => x.key),
    visibleTabKeys.value,
    key,
    slot,
  )
  const tab = workspace.tabs.find((x) => x.key === key)
  if (to === null || !tab) return
  const hadFocus = !!(document.activeElement as HTMLElement | null)?.closest?.('[data-tab]')
  workspace.moveTab(key, to)
  const keys = visibleTabKeys.value
  announce(t('workspace.tabStrip.moved', { name: tabName(tab), n: keys.indexOf(key) + 1, total: keys.length }))
  void nextTick(() => {
    const el = tabButton(key)
    if (hadFocus) el?.focus()
    else el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  })
}

function moveActiveTab(step: 1 | -1): void {
  const tab = workspace.activeTab
  const slot = tab ? stepSlot(visibleTabKeys.value, tab.key, step) : null
  if (tab && slot !== null) reorderTab(tab.key, slot)
}

const {
  source: dragSource,
  preview: dropPreview,
  toStrip: dropToStrip,
  pointer: dragPointer,
  caret: dropCaret,
  onDown: onDragDown,
} = usePaneDrag({
  canvas,
  strip: tabRow,
  tabList: tabStrip,
  sourceAt(target) {
    const tabEl = target.closest<HTMLElement>('[data-tab]')
    if (tabEl) {
      const tab = workspace.tabs.find((x) => x.key === tabEl.dataset.tab)
      return tab && tabDraggable() ? { kind: 'tab', key: tab.key } : null
    }
    const key = target.closest('[data-pane-grip]')?.closest<HTMLElement>('[data-pane]')?.dataset.pane
    return key && multiPane.value && tabBoxes.value.has(key) ? { kind: 'pane', key } : null
  },
  canDock: (src) => src.kind === 'pane' || src.key !== workspace.activeTab?.key,
  swapKey: (e) => (isMac ? e.metaKey : e.ctrlKey),
  onDrop: onPaneDrop,
})

// Past the middle of the window the ghost hangs left of the pointer, so it never leaves the screen.
const ghostStyle = computed(() => {
  const { x, y } = dragPointer.value
  const flip = x > window.innerWidth / 2
  return { left: `${flip ? x - 14 : x + 14}px`, top: `${y + 14}px`, transform: flip ? 'translateX(-100%)' : undefined }
})

const edgeWord = (edge: Edge): string => t(`workspace.drag.edge.${edge}`)

const dragLabel = computed(() => {
  const src = dragSource.value
  if (!src) return ''
  if (src.kind === 'tab') {
    const tab = workspace.tabs.find((x) => x.key === src.key)
    return tab ? tabName(tab) : ''
  }
  const pane = paneOf(src.key)
  return pane ? info.titleOf(pane) : ''
})
const dragPane = computed(() => {
  const src = dragSource.value
  if (src?.kind === 'pane') return paneOf(src.key)
  const tab = src && workspace.tabs.find((x) => x.key === src.key)
  return tab ? tabPrimary(tab) : undefined
})

/** What letting go now would do, shown in the ghost. */
const dropWord = computed(() => {
  if (dropToStrip.value) return t('workspace.drag.newTab')
  if (dropCaret.value !== null) return t('workspace.tabStrip.moveHere')
  const p = dropPreview.value
  if (!p) return ''
  return p.edge ? t('workspace.drag.dock', { edge: edgeWord(p.edge) }) : t('workspace.drag.swap')
})

function onPaneDrop(src: PaneDragSource, act: PaneDropAction): void {
  if (act.kind === 'reorder') {
    if (src.kind === 'tab') reorderTab(src.key, act.slot)
    return
  }
  withViewTransition(() => {
    if (src.kind === 'tab') {
      if (act.kind === 'dock') workspace.mergeTab(src.key, act.key, act.edge)
    } else if (act.kind === 'dock') workspace.movePane(src.key, act.key, act.edge)
    else if (act.kind === 'swap') workspace.swapPanes(src.key, act.key)
    else workspace.detachPane(src.key)
  })
  announce(
    act.kind === 'swap'
      ? t('workspace.drag.swapped')
      : act.kind === 'newTab'
        ? t('workspace.drag.detached')
        : t(src.kind === 'tab' ? 'workspace.drag.merged' : 'workspace.drag.moved', { edge: edgeWord(act.edge) }),
  )
  void nextTick(focusActivePane)
}

const moveTabKeys = `${keyCombo(['Mod', 'Shift', 'PgUp'], isMac)} / PgDn`

function tabTip(tab: Tab): string | undefined {
  const hints = [t('workspace.tabStrip.renameHint'), tabDraggable() ? t('workspace.tabStrip.reorderHint', { keys: moveTabKeys }) : ''].filter(Boolean).join(' · ')
  const dock = tabDraggable() && tab !== workspace.activeTab ? t('workspace.drag.tabHint') : ''
  const subs = tabState(tab)?.subagents ?? 0
  const running = subs ? t('workspace.subagentState.count', { n: subs }, subs) : ''
  return [tabName(tab), running, ...tabPeerLines(tab), tabDetail(tab), hints, dock].filter(Boolean).join('\n') || undefined
}

function tabDetail(tab: Tab): string | undefined {
  const keys = leaves(tab.root)
  const project = tabProject(tab, paneOf)
  const space = project ? spaceLabel(folderName(project), tabSpaces.value.get(tab.key) ?? null) : null
  if (keys.length > 1) return [space, ...keys.map((k) => paneOf(k)).filter((p): p is Pane => !!p).map(describe)].filter(Boolean).join('\n')
  const pane = paneOf(keys[0]!)
  return [space, pane && !isTerm(pane) ? viewDetail(pane) : pane && workCwd(pane)].filter(Boolean).join('\n') || undefined
}

onMounted(() => {
  // First workspace visit (or after the app's data was reset): ask for every folder once instead of per folder later.
  void fullAccess('first')
  // Capture: runs before xterm's own handler sees the key.
  window.addEventListener('keydown', onGlobalKey, true)
  window.addEventListener('focus', clearSeenAttention)
  window.addEventListener('resize', onViewportResize)
  canvasObserver = new ResizeObserver(([entry]) => {
    if (entry) workspace.canvasSize = canvasSize.value = { w: entry.contentRect.width, h: entry.contentRect.height }
  })
  if (canvas.value) canvasObserver.observe(canvas.value)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKey, true)
  window.removeEventListener('focus', clearSeenAttention)
  window.removeEventListener('resize', onViewportResize)
  document.removeEventListener('pointerdown', onOutside, true)
  document.removeEventListener('pointerdown', onHelpOutside, true)
  canvasObserver?.disconnect()
  pillObserver.disconnect()
  stripObserver.disconnect()
  cancelAnimationFrame(fadeFrame)
  workspace.setClosedNamer(null)
  if (noticeTimer) clearTimeout(noticeTimer)
})
</script>

<template>
  <main class="flex h-[calc(100dvh-var(--ccm-header-h,52px))] min-h-0 w-full gap-3 px-3 pt-2 pb-3 sm:px-4">
    <aside
      v-if="workspace.tabs.length"
      class="relative hidden shrink-0 flex-col gap-1.5 md:flex"
      :class="sideDragging ? 'select-none' : ''"
      :style="{ width: `${sidebarOpen ? sideWidth : RAIL_COLUMN_W}px` }"
      data-tour="ws-sidebar"
    >
      <RailColumn v-if="!sidebarOpen" v-on="sideEvents" />
      <WorkspaceSidebar v-else class="min-h-0 flex-1" :narrow="sideWidth < SIDE_NARROW" v-on="sideEvents" />
      <SideResizer
        v-if="sidebarOpen"
        v-model:dragging="sideDragging"
        :width="sideWidth"
        :min="SIDE_MIN"
        :max="sideMax"
        :label="t('workspace.side.panel')"
        @resize="resizeSide"
        @commit="writeSideWidth(sideWidthPref)"
        @reset="resetSide"
      />
    </aside>
    <div
      class="relative flex min-h-0 min-w-0 flex-1 flex-col gap-2"
      :class="[sideDragging || explorerDragging ? 'pointer-events-none' : '', dragSource ? 'cursor-grabbing select-none' : '']"
      @pointerdown="onDragDown"
    >
    <div v-if="workspace.tabs.length" class="flex min-w-0 items-center gap-2">
      <button
        type="button"
        class="ccm-btn-plain hidden shrink-0 md:inline-flex"
        :aria-pressed="sidebarOpen"
        :title="t('workspace.side.toggle')"
        :aria-label="t('workspace.side.toggle')"
        @click="toggleSidebar"
      >
        <PanelLeft :size="15" aria-hidden="true" />
      </button>
      <button
        v-if="activeCluster"
        ref="missionOpener"
        type="button"
        class="inline-flex h-7 max-w-[24ch] min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-inner px-2 text-xs font-semibold text-ink-muted transition-colors duration-(--ccm-dur-fast) hover:bg-fill hover:text-ink"
        :title="[activeCluster.root, t('workspace.rail.mission.open', { keys: shortcutText('wsMission', isMac) }), otherNews].filter(Boolean).join('\n')"
        :aria-label="[t('workspace.rail.mission.open', { keys: shortcutText('wsMission', isMac) }), otherNews].filter(Boolean).join('. ')"
        aria-haspopup="dialog"
        :aria-expanded="missionOpen"
        data-strip-project
        @click="toggleMission"
      >
        <FolderOpen :size="14" class="shrink-0" aria-hidden="true" />
        <span class="min-w-0 truncate">{{ activeCluster.key === 'home' ? t('workspace.side.home') : activeCluster.name }}</span>
        <span v-if="otherNeeds" class="inline-flex shrink-0 items-center gap-0.5 tabular" :class="otherFailed ? 'text-st-error' : 'text-st-waiting'">
          <BellRing :size="12" aria-hidden="true" />{{ otherNeeds }}<span class="sr-only"> {{ t('workspace.rail.needs', { n: otherNeeds }, otherNeeds) }}</span>
        </span>
        <Transition name="ccm-fade">
          <span v-if="otherNews" class="inline-flex shrink-0 text-peer" aria-hidden="true" data-strip-project-peer>
            <Mail :size="11" />
          </span>
        </Transition>
      </button>
      <div
        ref="tabRow"
        class="flex min-w-0 flex-1 items-center gap-1 rounded-inner outline-2 -outline-offset-2 transition-[background-color,outline-color] duration-(--ccm-dur-fast)"
        :class="dropToStrip ? 'bg-accent-soft outline-accent' : 'outline-transparent'"
        data-tab-row
        @dblclick="onStripDblClick"
      >
      <div
        ref="tabStrip"
        class="ccm-tabstrip relative flex min-w-0 items-center overflow-x-auto"
        role="tablist"
        :aria-label="t('workspace.tabs')"
        :data-fade-start="stripFade.start || undefined"
        :data-fade-end="stripFade.end || undefined"
        @wheel="onStripWheel"
        @scroll.passive="measureFade"
      >
        <span
          v-if="tabPill"
          aria-hidden="true"
          class="pointer-events-none absolute top-0 left-0 h-7 rounded-inner bg-control shadow-control"
          :class="pillReady ? 'transition-[transform,width] duration-(--ccm-dur-slow) ease-out-quint' : ''"
          :style="{ width: `${tabPill.w}px`, transform: `translateX(${tabPill.x}px)` }"
        />
        <span
          v-if="dropCaret !== null"
          aria-hidden="true"
          class="pointer-events-none absolute top-1 bottom-1 left-0 z-10 w-0.5 rounded-full bg-accent motion-safe:transition-transform motion-safe:duration-(--ccm-dur-fast)"
          :style="{ transform: `translateX(${dropCaret - 1}px)` }"
          data-tab-caret
        />
        <TransitionGroup name="ccm-tab" tag="div" role="presentation" class="flex items-center gap-1" @before-leave="pinLeaving" @leave="onTabLeave">
        <div
          v-for="(tab, i) in visibleTabs"
          :key="tab.key"
          role="presentation"
          :data-selected="tab === workspace.activeTab || undefined"
          :data-tab-item="tab.key"
          class="group relative inline-flex h-7 shrink-0 items-center rounded-inner text-xs transition-colors duration-(--ccm-dur-fast)"
          :class="[tab === workspace.activeTab ? 'text-ink' : 'text-ink-muted hover:bg-fill', dragSource?.kind === 'tab' && dragSource.key === tab.key ? 'text-ink-faint!' : '']"
          @contextmenu="onTabContext(tab, $event)"
        >
          <span
            v-if="tabFlash[tab.key]"
            :key="tabFlash[tab.key]!.n"
            class="ccm-flash pointer-events-none absolute inset-0 rounded-inner"
            :class="FLASH_CLASS[tabFlash[tab.key]!.kind]"
            aria-hidden="true"
            :data-tab-flash="tabFlash[tab.key]!.kind"
          />
          <div v-if="renaming === tab.key" class="flex h-full min-w-0 items-center pr-1 pl-1.5" :style="{ width: `${renameWidth}px` }" data-tab-renaming>
            <TabRenameInput :tab-key="tab.key" :initial="tab.name ?? tabName(tab)" @done="(saved) => onRenameDone(tab.key, saved)" />
          </div>
          <button
            v-else
            type="button"
            role="tab"
            :data-tab="tab.key"
            :aria-selected="tab === workspace.activeTab"
            :tabindex="tab === workspace.activeTab ? 0 : -1"
            class="inline-flex h-full max-w-[260px] min-w-0 cursor-pointer items-center gap-1.5 pr-1 pl-2.5"
            :title="tabTip(tab)"
            @click="onTabClick(tab)"
            @dblclick.stop="startRename(tab)"
            @keydown="onTabKey($event, tab, i)"
          >
            <span class="grid size-[13px] shrink-0 place-items-center *:[grid-area:1/1]">
              <Transition name="ccm-fade">
                <span :key="tabState(tab)?.status ?? 'pane'" class="inline-flex" :data-tab-status="tabState(tab)?.status">
                  <StatusIcon v-if="tabState(tab)" :status="tabState(tab)!.status" :size="13" />
                  <PaneIcon v-else-if="tabPrimary(tab)" :pane="tabPrimary(tab)!" :size="13" class="shrink-0" />
                </span>
              </Transition>
            </span>
            <span
              :key="labelFlash[tab.key] ?? 0"
              class="-mx-0.5 min-w-0 truncate rounded-[4px] px-0.5 font-medium"
              :class="labelFlash[tab.key] ? 'ccm-highlight' : ''"
              data-tab-label
            >{{ tabName(tab) }}</span>
            <Transition name="ccm-fade">
              <span v-if="tabNewsOf(tab)" class="inline-flex shrink-0 text-peer" :data-tab-peer="tabNewsOf(tab)!.dir">
                <Mail :size="10" aria-hidden="true" />
                <span class="sr-only">{{ tabNewsOf(tab)!.label }}</span>
              </span>
            </Transition>
            <span v-if="leaves(tab.root).some((k) => paneOf(k)?.dirty)" class="shrink-0 text-warning" :title="t('editor.unsaved')" data-tab-dirty>
              <span aria-hidden="true">●</span><span class="sr-only">{{ t('editor.unsaved') }}</span>
            </span>
            <span v-if="leaves(tab.root).length > 1" class="shrink-0 rounded-[4px] bg-fill px-1 text-2xs text-ink-muted tabular" data-pane-count>
              {{ leaves(tab.root).length }}<span class="sr-only"> {{ t('workspace.panes') }}</span>
            </span>
            <Transition name="ccm-fade">
              <span
                v-if="tabZoom(tab)"
                class="inline-flex shrink-0 text-accent-ink"
                :title="t('workspace.zoom.tabGlyph', { n: leaves(tab.root).length - 1 }, leaves(tab.root).length - 1)"
                data-tab-zoom
              >
                <Maximize2 :size="11" aria-hidden="true" />
                <span class="sr-only">{{ t('workspace.zoom.tabGlyph', { n: leaves(tab.root).length - 1 }, leaves(tab.root).length - 1) }}</span>
              </span>
            </Transition>
            <span v-if="tabAttention(tab)" class="inline-flex shrink-0" aria-hidden="true" :data-tab-attention="tabAttention(tab)">
              <StatusIcon :status="tabAttention(tab) === 'waiting' ? 'waiting' : 'completed'" :size="12" :animate="false" />
            </span>
            <span v-if="tabStatusText(tab)" class="sr-only">{{ tabStatusText(tab) }}</span>
          </button>
          <button
            type="button"
            class="mr-1 inline-flex size-5 cursor-pointer items-center justify-center rounded-[5px] text-ink-faint hover:bg-fill-strong hover:text-ink"
            :title="t('workspace.closeTab')"
            :aria-label="`${t('workspace.closeTab')}: ${tabName(tab)}`"
            @click="closeTab(tab)"
          >
            <X :size="12" aria-hidden="true" />
          </button>
        </div>
        </TransitionGroup>
      </div>
      <div class="relative shrink-0" @keydown.esc.stop="closeMenu()" @focusout="onFocusOut">
        <button
          ref="menuTrigger"
          type="button"
          class="ccm-btn-plain"
          aria-haspopup="dialog"
          :aria-expanded="menuOpen"
          :aria-label="t('workspace.newLabel')"
          :title="t('workspace.newHint', { keys: isMac ? '⌘T' : 'Ctrl+Shift+T' })"
          data-tour="ws-new"
          @click="onPlusClick"
        >
          <Plus :size="16" aria-hidden="true" />
        </button>
        <Transition name="ccm-menu" @before-leave="retireOverlay">
          <div
            v-if="menuOpen"
            ref="menu"
            class="ccm-menu absolute top-full z-40 mt-1.5 w-[min(380px,calc(100vw-24px))] p-2"
            :class="menuAlignRight ? 'right-0 [--ccm-origin:top_right]' : 'left-0 [--ccm-origin:top_left]'"
            role="dialog"
            :aria-label="t('workspace.launch.title')"
          >
            <LaunchPicker ref="menuPicker" :cwd="contextCwd" @launch="launch" @browser="openBrowserTab" @open-file="openFileTab" @changes="openChangesTab" @log="openLogTab" />
            <div v-if="activeProject && (hasScripts || hasLayouts)" class="mt-1.5 flex flex-col border-t border-line pt-1.5">
              <button v-if="hasScripts" type="button" :class="MENU_ROW" data-menu="scripts" @click="openScriptsForActive()">
                <Play :size="14" class="shrink-0 text-ink-muted group-focus-visible/row:text-on-accent" aria-hidden="true" />{{ t('workspace.scripts.open') }}
              </button>
              <button v-if="hasLayouts" type="button" :class="MENU_ROW" data-menu="save-layout" :title="activeProject" @click="showLayouts(activeProject, folderName(activeProject), 'save')">
                <LayoutTemplate :size="14" class="shrink-0 text-ink-muted group-focus-visible/row:text-on-accent" aria-hidden="true" />{{ t('workspace.layouts.save') }}
              </button>
            </div>
          </div>
        </Transition>
      </div>
      </div>
      <button
        v-if="chipCount"
        ref="attentionChip"
        type="button"
        class="ccm-btn shrink-0"
        :class="needs.entries.some((e) => e.state === 'failed') ? 'text-st-error!' : 'text-st-waiting!'"
        :title="t('workspace.rail.needsList.chipTip', { keys: isMac ? '⇧⌘A' : 'Ctrl+Shift+A' })"
        aria-haspopup="listbox"
        :aria-expanded="!!needsAnchor"
        data-attention-chip
        @click="onAttentionClick"
      >
        <BellRing :size="14" aria-hidden="true" />
        <span>{{ t('workspace.attention.chip', { n: chipCount }, chipCount) }}</span>
      </button>
      <Teleport to="body">
        <Transition name="ccm-menu" @before-leave="retireOverlay">
          <AttentionPopover v-if="needsAnchor" :anchor="needsAnchor" :list="needs" :trigger="attentionChip" @close="closeNeeds" />
        </Transition>
      </Teleport>
      <Transition name="ccm-fade">
        <DimToggle v-if="multiPane" :on="settings.dimInactive" :visible="visible" @toggle="toggleDim" />
      </Transition>
      <div class="relative shrink-0" @keydown="onHelpKey">
        <button
          ref="helpButton"
          type="button"
          class="ccm-btn-plain"
          aria-haspopup="menu"
          :aria-expanded="helpOpen"
          :aria-label="t('wsHelp.button')"
          :title="t('wsHelp.button')"
          data-tour="ws-help"
          @click="toggleHelp"
        >
          <CircleHelp :size="16" aria-hidden="true" />
        </button>
        <Transition name="ccm-menu" @before-leave="retireOverlay">
          <div
            v-if="helpOpen"
            ref="helpMenu"
            role="menu"
            :aria-label="t('wsHelp.button')"
            class="ccm-menu absolute top-full right-0 z-40 mt-1.5 flex w-56 flex-col p-1 [--ccm-origin:top_right]"
          >
            <button type="button" role="menuitem" :class="MENU_ROW" data-menu="shortcuts" @click="helpAction(() => (ui.shortcutsOpen = true))">
              <Keyboard :size="14" class="shrink-0 text-ink-muted group-focus-visible/row:text-on-accent" aria-hidden="true" />{{ t('wsHelp.shortcuts') }}
            </button>
            <button type="button" role="menuitem" :class="MENU_ROW" data-menu="tour" @click="helpAction(() => (ui.tourOpen = 'workspace'))">
              <GraduationCap :size="14" class="shrink-0 text-ink-muted group-focus-visible/row:text-on-accent" aria-hidden="true" />{{ t('wsHelp.tour') }}
            </button>
          </div>
        </Transition>
      </div>
      <button
        type="button"
        class="ccm-btn-plain hidden shrink-0 md:inline-flex"
        :aria-pressed="explorerOpen"
        :title="t('workspace.explorer.toggle', { keys: shortcutText('wsExplorer', isMac) })"
        :aria-label="t('workspace.explorer.toggle', { keys: shortcutText('wsExplorer', isMac) })"
        data-explorer-toggle
        @click="toggleExplorer"
      >
        <PanelRight :size="15" aria-hidden="true" />
      </button>
    </div>

    <div v-if="!workspace.tabs.length" class="ccm-scroll flex min-h-0 flex-1 flex-col items-center overflow-y-auto py-6">
      <div class="my-auto flex w-full max-w-[400px] flex-col gap-3">
        <div class="px-1 text-center">
          <h2 class="text-base font-semibold text-ink">{{ t('workspace.empty.title') }}</h2>
          <p class="mt-1 text-sm text-ink-muted">{{ t('workspace.empty.body') }}</p>
        </div>
        <RestorePicker
          v-if="lastSummary"
          :projects="workspace.lastProjects"
          :tabs="lastSummary.tabs"
          :agents="lastSummary.agents"
          @restore="restoreLast"
          @dismiss="workspace.dismissLast()"
        />
        <div class="ccm-group p-2">
          <LaunchPicker ref="emptyPicker" data-tour="ws-new" @launch="launch" @browser="openBrowserTab" @open-file="openFileTab" />
        </div>
      </div>
    </div>

    <!-- Every pane lives here flat, placed by its box: splitting or switching tabs never remounts a terminal. -->
    <div v-show="workspace.tabs.length" ref="canvas" class="relative min-h-0 flex-1">
      <template v-for="pane in workspace.panes" :key="pane.key">
        <TermPane
          v-if="isTerm(pane)"
          v-show="tabBoxes.has(pane.key)"
          class="absolute"
          :style="tabBoxes.has(pane.key) ? boxStyle(tabBoxes.get(pane.key)!) : undefined"
          :pane="pane"
          :visible="visible && tabBoxes.has(pane.key)"
          :focused="pane.key === workspace.activeKey"
          :multi="multiPane"
          :zoomed="isZoomed(pane.key)"
          :hidden-count="hiddenOf(pane.key)"
          :dim="paneDim(pane.key)"
          @zoom="toggleZoom(pane.key)"
          @split="(choice) => mouseSplit(choice, pane.key)"
          @close="mouseClose(pane.key)"
          @open-link="(target, opts) => openLink(pane, target, opts)"
          @scripts="openScripts([workCwd(pane)!])"
        />
        <!-- Viewer panes carry their own toolbar; the wrapper only places, focuses and rings them. -->
        <div
          v-else
          v-show="tabBoxes.has(pane.key)"
          class="absolute flex min-h-0 min-w-0 flex-col rounded-card outline-2 -outline-offset-2 transition-[outline-color] duration-(--ccm-dur-base) ease-out-quint"
          :class="multiPane && pane.key === workspace.activeKey ? 'outline-focus' : 'outline-transparent'"
          :style="[tabBoxes.has(pane.key) ? boxStyle(tabBoxes.get(pane.key)!) : {}, visible && tabBoxes.has(pane.key) ? { viewTransitionName: `ccm-pane-${pane.key}`, viewTransitionClass: 'ccm-pane' } : {}]"
          :data-pane="pane.key"
          :data-kind="pane.kind"
          @pointerdown="mouseFocus(pane.key)"
          @focusin="workspace.activate(pane.key)"
        >
          <BrowserPane
            v-if="pane.kind === 'browser'"
            class="min-h-0 flex-1"
            :url="pane.url ?? ''"
            :cwd="workCwd(pane) ?? workspace.recentDirs[0]"
            :active="visible && tabBoxes.has(pane.key)"
            @navigate="(url) => workspace.update(pane.key, { url })"
            @title="(title) => workspace.update(pane.key, { title })"
            @favicon="(favicon) => workspace.update(pane.key, { favicon })"
            @insert-text="(text) => insertFromBrowser(pane.key, text)"
            @insert-image="insertFromBrowser(pane.key, null)"
          >
            <template #toolbar-end>
              <ViewPaneControls
                :movable="multiPane"
                :zoomable="multiPane || isZoomed(pane.key)"
                :zoomed="isZoomed(pane.key)"
                :hidden-count="hiddenOf(pane.key)"
                @zoom="toggleZoom(pane.key)"
                @split="(choice) => mouseSplit(choice, pane.key)"
                @close="mouseClose(pane.key)"
              />
            </template>
          </BrowserPane>
          <FilePane
            v-else-if="pane.kind === 'file'"
            class="min-h-0 flex-1"
            :pane-key="pane.key"
            :path="pane.path!"
            :line="pane.line"
            :active="visible && tabBoxes.has(pane.key)"
            @open="(path) => workspace.openFile(path, undefined, { cwd: pane.cwd })"
            @show-diff="(root, path) => withViewTransition(() => workspace.openChanges(root, { select: path, split: { key: pane.key, dir: 'row' } }))"
            @search="(q: SearchQuery) => void showSearch(q)"
            @show-commit="(root, hash) => withViewTransition(() => workspace.openLog(root, { select: hash, split: { key: pane.key, dir: 'row' } }))"
          >
            <template #end>
              <ViewPaneControls
                :movable="multiPane"
                :zoomable="multiPane || isZoomed(pane.key)"
                :zoomed="isZoomed(pane.key)"
                :hidden-count="hiddenOf(pane.key)"
                @zoom="toggleZoom(pane.key)"
                @split="(choice) => mouseSplit(choice, pane.key)"
                @close="mouseClose(pane.key)"
              />
            </template>
          </FilePane>
          <LogPane
            v-else-if="pane.kind === 'log'"
            class="min-h-0 flex-1"
            :cwd="pane.cwd!"
            :select="pane.select"
            :active="visible && tabBoxes.has(pane.key)"
            @selected="workspace.update(pane.key, { select: undefined })"
            @root="(root) => workspace.update(pane.key, { root })"
            @open="(path, line) => workspace.openFile(path, line, { cwd: pane.root ?? pane.cwd })"
          >
            <template #end>
              <ViewPaneControls
                :movable="multiPane"
                :zoomable="multiPane || isZoomed(pane.key)"
                :zoomed="isZoomed(pane.key)"
                :hidden-count="hiddenOf(pane.key)"
                @zoom="toggleZoom(pane.key)"
                @split="(choice) => mouseSplit(choice, pane.key)"
                @close="mouseClose(pane.key)"
              />
            </template>
          </LogPane>
          <RunPane
            v-else-if="pane.kind === 'run'"
            class="min-h-0 flex-1"
            :root="pane.cwd!"
            :active="visible && tabBoxes.has(pane.key)"
            @open="(path, line) => workspace.openFile(path, line, { cwd: pane.cwd, split: { key: pane.key, dir: 'row' } })"
            @open-agent="withViewTransition(() => workspace.split(pane.key, 'row', { kind: 'term', preset: 'claude' }))"
          >
            <template #end>
              <ViewPaneControls
                :movable="multiPane"
                :zoomable="multiPane || isZoomed(pane.key)"
                :zoomed="isZoomed(pane.key)"
                :hidden-count="hiddenOf(pane.key)"
                @zoom="toggleZoom(pane.key)"
                @split="(choice) => mouseSplit(choice, pane.key)"
                @close="mouseClose(pane.key)"
              />
            </template>
          </RunPane>
          <ChangesPane
            v-else
            class="min-h-0 flex-1"
            :cwd="pane.cwd!"
            :select="pane.select"
            :active="visible && tabBoxes.has(pane.key)"
            @selected="workspace.update(pane.key, { select: undefined })"
            @open="(path, line) => workspace.openFile(path, line, { cwd: pane.root ?? pane.cwd })"
            @count="(count) => workspace.update(pane.key, { count })"
            @root="(root) => workspace.update(pane.key, { root })"
            @log="(root) => withViewTransition(() => workspace.openLog(root, { split: { key: pane.key, dir: 'row' } }))"
          >
            <template #end>
              <ViewPaneControls
                :movable="multiPane"
                :zoomable="multiPane || isZoomed(pane.key)"
                :zoomed="isZoomed(pane.key)"
                :hidden-count="hiddenOf(pane.key)"
                @zoom="toggleZoom(pane.key)"
                @split="(choice) => mouseSplit(choice, pane.key)"
                @close="mouseClose(pane.key)"
              />
            </template>
          </ChangesPane>
          <Transition
            enter-active-class="transition-opacity duration-(--ccm-dur-base) ease-out-quint"
            enter-from-class="opacity-0"
            leave-active-class="transition-opacity duration-(--ccm-dur-base) ease-out-quint"
            leave-to-class="opacity-0"
          >
            <div v-if="paneDim(pane.key)" class="pointer-events-none absolute inset-0 z-10 rounded-card bg-canvas/45" aria-hidden="true" data-pane-dim />
          </Transition>
        </div>
      </template>
      <div
        v-for="d in tabDividers"
        :key="`${workspace.activeTab?.key}:${d.path}`"
        class="group/div absolute z-10 flex touch-none items-center justify-center outline-none"
        :class="d.dir === 'row' ? 'cursor-col-resize' : 'cursor-row-resize'"
        :style="dividerStyle(d)"
        role="separator"
        tabindex="0"
        :aria-orientation="d.dir === 'row' ? 'vertical' : 'horizontal'"
        :aria-valuenow="Math.round(d.ratio * 100)"
        aria-valuemin="15"
        aria-valuemax="85"
        :aria-label="t('workspace.resize')"
        @pointerdown.prevent="startDrag(d, $event)"
        @keydown="onDividerKey(d, $event)"
      >
        <span
          class="rounded-full bg-transparent transition-colors duration-(--ccm-dur-fast) group-hover/div:bg-accent group-focus-visible/div:bg-accent group-active/div:bg-accent"
          :class="d.dir === 'row' ? 'h-full w-0.5' : 'h-0.5 w-full'"
        />
      </div>
      <!-- While a pane or tab is dragged: dividers, webviews and terminals stay out of the way. -->
      <div v-if="dragSource" class="absolute inset-0 z-20 cursor-grabbing" aria-hidden="true" />
      <div
        v-if="dropPreview"
        class="pointer-events-none absolute z-30 rounded-card border-2 border-accent bg-accent-soft motion-safe:transition-[left,top,width,height] motion-safe:duration-(--ccm-dur-fast)"
        :style="{ left: `${dropPreview.left}px`, top: `${dropPreview.top}px`, width: `${dropPreview.width}px`, height: `${dropPreview.height}px` }"
        aria-hidden="true"
        data-drop-preview
        :data-edge="dropPreview.edge ?? 'swap'"
      />
      <MissionControl :open="missionOpen && visible" :pane-rect="paneRect" @close="closeMission" />
    </div>
    <DropTerminal v-if="dropMounted" :open="dropOpen && visible" :cwd="dropCwd" @hide="dropOpen = false" />
    <div class="pointer-events-none absolute inset-x-3 bottom-3 z-40 flex justify-center">
      <UndoToast :info="visible ? undoInfo : null" :keys="undoKeys" @undo="reopenLast" @dismiss="dismissUndo" />
    </div>
    </div>
    <aside
      v-if="workspace.tabs.length && explorerOpen"
      class="relative hidden shrink-0 flex-col md:flex"
      :class="explorerDragging ? 'select-none' : ''"
      :style="{ width: `${explorerWidth}px` }"
      data-explorer-panel
    >
      <div class="ccm-material flex min-h-0 flex-1 flex-col rounded-card p-1.5">
        <ExplorerPanel ref="explorerPanel" :root="activeProject" :active-path="activeFile" :visible="visible" @open="openFromExplorer" @open-diff="(root, path) => withViewTransition(() => workspace.openChanges(root, { select: path }))" @open-log="(root) => withViewTransition(() => workspace.openLog(root))" @open-split="openSplitFromExplorer" @terminal="(dir) => withViewTransition(() => workspace.open('shell', dir))" @run="(dir) => withViewTransition(() => workspace.openRun(dir))" @renamed="onExplorerRenamed" @trashed="onExplorerTrashed" />
      </div>
      <SideResizer
        v-model:dragging="explorerDragging"
        edge="left"
        :width="explorerWidth"
        :min="SIDE_MIN"
        :max="explorerMax"
        :label="t('workspace.explorer.title')"
        @resize="resizeExplorer"
        @commit="writeSideWidth(explorerWidthPref, EXPLORER_WIDTH_KEY)"
        @reset="resetExplorer"
      />
    </aside>

    <Teleport to="body">
      <div
        v-if="dragSource"
        class="pointer-events-none fixed z-50 inline-flex h-7 max-w-[40ch] items-center gap-1.5 rounded-inner bg-control px-2 text-xs text-ink shadow-control"
        :style="ghostStyle"
        aria-hidden="true"
        data-drag-ghost
      >
        <PaneIcon v-if="dragPane" :pane="dragPane" :size="13" class="shrink-0" />
        <span class="min-w-0 truncate font-medium">{{ dragLabel }}</span>
        <span v-if="dropWord" class="shrink-0 text-accent-ink">· {{ dropWord }}</span>
        <span v-else-if="dragSource.kind === 'pane'" class="shrink-0 text-ink-faint">· {{ swapKeyName }} = {{ t('workspace.drag.swap') }}</span>
      </div>
    </Teleport>
    <p class="sr-only" aria-live="polite">{{ dragAnnounce }}</p>
    <ContextMenu v-if="tabCtx" :at="tabCtx.at" :entries="tabCtx.entries" :label="tabCtx.label" :trigger="tabCtx.trigger" @pick="tabCtx.pick" @close="tabCtx = null" />

    <Teleport to="body">
      <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div v-if="closing.length && !closeOut" class="ccm-scrim fixed inset-0 z-50 flex items-center justify-center p-4" @click.self="workspace.cancelClose()">
        <div
          ref="confirmSheet"
          class="ccm-sheet flex w-full max-w-[440px] flex-col gap-3 p-5"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="ws-close-title"
          aria-describedby="ws-close-body"
          @keydown.esc.stop="workspace.cancelClose()"
          @keydown="trapConfirm"
        >
          <template v-if="closingDirty.length">
            <h2 id="ws-close-title" class="text-base font-semibold text-ink" data-close-unsaved>{{ t('editor.close.title', { n: closingDirty.length }, closingDirty.length) }}</h2>
            <div id="ws-close-body" class="flex flex-col gap-2 text-sm text-ink-muted">
              <p>{{ t('editor.close.body') }}</p>
              <ul class="flex flex-col gap-1 rounded-inner bg-fill p-2 text-xs text-ink">
                <li v-for="p in closingDirty" :key="p.key" class="flex min-w-0 items-center gap-1.5">
                  <PaneIcon :pane="p" :size="13" class="shrink-0" />
                  <span class="truncate" :title="p.path">{{ baseName(p.path ?? '') }}</span>
                  <span class="shrink-0 text-warning" aria-hidden="true">●</span>
                </li>
              </ul>
              <template v-if="closingBusy.length">
                <p>{{ t('editor.close.busy') }}</p>
                <ul class="flex flex-col gap-1 rounded-inner bg-fill p-2 text-xs text-ink">
                  <li v-for="p in closingBusy" :key="p.key" class="flex min-w-0 items-center gap-1.5">
                    <PaneIcon :pane="p" :size="13" class="shrink-0" />
                    <span class="truncate" :title="p.cwd">{{ describe(p) }}</span>
                  </li>
                </ul>
              </template>
              <p v-for="(err, i) in closeErrors" :key="i" class="flex items-start gap-1.5 text-xs text-st-error" role="alert">
                <X :size="13" class="mt-0.5 shrink-0" aria-hidden="true" /><span class="min-w-0">{{ err }}</span>
              </p>
            </div>
            <div class="flex justify-end gap-2">
              <button type="button" class="ccm-btn" @click="workspace.cancelClose()">{{ t('editor.close.cancel') }}</button>
              <button type="button" class="ccm-btn ccm-btn-danger" :disabled="closeSaving" data-close-discard @click="confirmPending()">{{ t('editor.close.discard') }}</button>
              <button ref="confirmButton" type="button" class="ccm-btn ccm-btn-primary" :disabled="closeSaving" data-close-save @click="saveAndClose">{{ t('editor.close.save') }}</button>
            </div>
          </template>
          <template v-else>
          <h2 id="ws-close-title" class="text-base font-semibold text-ink">{{ t('workspace.closeConfirm.title', { n: closing.length }, closing.length) }}</h2>
          <div id="ws-close-body" class="flex flex-col gap-2 text-sm text-ink-muted">
            <p>{{ t('workspace.closeConfirm.body') }}</p>
            <ul class="flex flex-col gap-1 rounded-inner bg-fill p-2 text-xs text-ink">
              <li v-for="p in closing" :key="p.key" class="flex min-w-0 items-center gap-1.5" :class="isBusy(p) ? '' : 'text-ink-muted'">
                <PaneIcon :pane="p" :size="13" class="shrink-0" />
                <span class="truncate" :title="p.cwd">{{ describe(p) }}</span>
              </li>
            </ul>
          </div>
          <div class="flex justify-end gap-2">
            <button type="button" class="ccm-btn" @click="workspace.cancelClose()">{{ t('workspace.closeConfirm.cancel') }}</button>
            <button ref="confirmButton" type="button" class="ccm-btn ccm-btn-danger" @click="confirmPending()">
              {{ t('workspace.closeConfirm.action', { n: closing.length }, closing.length) }}
            </button>
          </div>
          </template>
        </div>
      </div>
      </Transition>
    </Teleport>

    <Teleport to="body">
      <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
        <div v-if="runClose" class="ccm-scrim fixed inset-0 z-50 flex items-center justify-center p-4" @click.self="runClose = null">
          <div
            class="ccm-sheet flex w-full max-w-[440px] flex-col gap-3 p-5"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="ws-runclose-title"
            aria-describedby="ws-runclose-body"
            data-run-close
            @keydown.esc.stop="runClose = null"
            @keydown="trapTab"
          >
            <h2 id="ws-runclose-title" class="text-base font-semibold text-ink">{{ t('workspace.rail.runConfirm.title', { name: runClose.cluster.name || t('workspace.side.home') }) }}</h2>
            <p id="ws-runclose-body" class="text-sm text-ink-muted">{{ t('workspace.rail.runConfirm.body') }}</p>
            <div class="flex justify-end gap-2">
              <button type="button" class="ccm-btn" @click="runClose = null">{{ t('workspace.rail.runConfirm.cancel') }}</button>
              <button ref="runCloseButton" type="button" class="ccm-btn ccm-btn-danger" :disabled="runCloseBusy" @click="confirmRunClose">
                {{ t('workspace.rail.runConfirm.action') }}
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <PromptPicker v-if="prompts.open && visible" @close="prompts.open = false" />
    <NavPicker v-if="nav.picker && visible" @close="nav.picker = null" />
    <NotesPanel v-if="notesRoot !== undefined && visible" :root="notesRoot" @close="notesRoot = undefined" />
    <PlanBoard v-if="ui.planBoard && visible" :root="planRoot" @close="ui.planBoard = null" />
    <EnvCheckDialog v-if="ui.envCheck && visible" :root="envRoot" @close="ui.envCheck = null" />
    <I18nScanDialog v-if="ui.i18nScan && visible" :root="i18nRoot" @close="ui.i18nScan = null" />
    <PermAdvisorDialog v-if="ui.permAdvisor && visible" :root="permRoot" @close="ui.permAdvisor = null" />
    <QuickOpen :open="quickOpen" :root="quickRoot" @close="quickOpen = false" @open="onQuickPick" @scripts="scriptsFromQuick" />
    <ScriptsDialog
      :open="!!scripts"
      :dirs="scripts?.dirs ?? []"
      :query="scripts?.query"
      :return-to="scriptsReturn"
      @close="closeScripts"
      @focus-lost="focusActivePane"
      @run="runScript"
    />
    <LayoutsDialog
      :open="!!layoutsFor"
      :root="lastLayouts.root"
      :name="lastLayouts.name"
      :mode="lastLayouts.mode"
      :capture="captureFor"
      @close="layoutsFor = null"
      @open="openLayout"
    />

    <Teleport to="body">
      <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
        <div v-if="agentChoices" class="ccm-scrim fixed inset-0 z-50 flex items-center justify-center p-4" @click.self="agentChoices = null">
          <div class="ccm-sheet flex w-full max-w-[360px] flex-col gap-2 p-3" role="dialog" aria-modal="true" aria-labelledby="ws-agent-title" @keydown="onChoiceKey">
            <h2 id="ws-agent-title" class="px-1 text-sm font-semibold text-ink">{{ t('workspace.handoff.pickTarget') }}</h2>
            <ul ref="choiceList" class="flex flex-col" role="list">
              <li v-for="p in agentChoices.panes" :key="p.key">
                <button
                  type="button"
                  class="group flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-inner px-2 text-left text-sm text-ink hover:bg-fill focus-visible:bg-accent focus-visible:text-on-accent focus-visible:outline-none"
                  @click="deliver(p.key, agentChoices!.text)"
                >
                  <PresetIcon :preset="presetOf(p)" :size="14" class="shrink-0 group-focus-visible:text-on-accent" />
                  <span class="truncate" :title="p.cwd">{{ describe(p) }}</span>
                </button>
              </li>
            </ul>
            <div class="flex justify-end">
              <button type="button" class="ccm-btn" @click="agentChoices = null">{{ t('workspace.closeConfirm.cancel') }}</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
    <Transition name="ccm-fade">
      <p
        v-if="agentNotice"
        class="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-control bg-raised px-3 py-2 text-xs text-ink shadow-pop"
        role="status"
      >
        {{ agentNotice }}
      </p>
    </Transition>
    <ShortcutTip :visible="visible" />
  </main>
</template>
