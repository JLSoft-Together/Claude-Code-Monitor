<script setup lang="ts">
import { modeOf, THEMES } from '../lib/themes'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  AArrowDown,
  AArrowUp,
  ListChecks,
  ListTodo,
  Type,
  Activity,
  AppWindow,
  Bell,
  ChartColumnBig,
  CornerDownLeft,
  FileDown,
  FolderOpen,
  GraduationCap,
  History,
  Puzzle,
  Keyboard,
  Languages,
  ListFilter,
  Minimize2,
  Moon,
  Search,
  Settings2,
  Smartphone,
  Stethoscope,
  FolderSearch,
  Trash2,
  Volume2,
  X,
  Palette,
  Lightbulb,
  GitGraph,
  BookText,
  Inbox,
  Wrench,
  KeyRound,
  Sparkles,
  ShieldCheck,
  Package,
  Layers,
  ClipboardCheck,
  FileText,
  Folder,
  SlidersHorizontal,
  Star,
} from 'lucide-vue-next'
import { DEV_TOOLS } from '../lib/devTools'
import { retireOverlay, withViewTransition } from '../lib/motion'
import { desktop, hasExtensions, hasTerminals } from '../lib/desktop'
import { hasDevices } from '../lib/devices'
import { hasEnvCheck, hasExplorer, hasI18nScan, hasLog } from '../lib/preview'
import { hasPermAdvisor } from '../lib/permAdvisor'
import { hasApkSize } from '../lib/apkSize'
import { hasReleaseCheck } from '../lib/releaseCheck'
import { hasCtxSources } from '../lib/ctxSources'
import { visibleFonts } from '../lib/fonts'
import { stepCodeSize } from '../composables/useWheelZoom'
import { useTipsStore } from '../stores/tips'
import { shortPath } from '../lib/format'
import { highlightRuns } from '../lib/fuzzy'
import { entries as settingsEntries, searchSettings, type SettingsPage } from './settings'
import { cap, fold, joinPath, listSettings, matchFiles, matchText, parsePrefix, prefixOf, searchable, type PaletteMode, type Searchable } from '../lib/paletteSearch'
import { listFiles, changesStatus, type FileList } from '../lib/preview'
import { filterProjects, landingTab, projectEntries, type ProjectEntry } from '../lib/projectSwitcher'
import { flashSettingRow } from '../lib/settingsFlash'
import { leaves } from '../lib/splitLayout'
import { useProjectMru } from '../composables/useProjectMru'
import { useRail } from '../composables/useRail'
import { useRevealInWorkspace } from '../composables/useRevealInWorkspace'
import { useSettingsEnv } from '../composables/useSettingsEnv'
import { isMac } from '../lib/platform'
import { keyCombo } from '../lib/shortcuts'
import { statusMeta } from '../lib/status'
import { APP_VERSION } from '../lib/changelog'
import { isCodex } from '../lib/provider'
import { displayTitle } from '../lib/title'
import { useConnectionStore } from '../stores/connection'
import { useFavoritesStore } from '../stores/favorites'
import { usePromptsStore } from '../stores/prompts'
import { useInboxStore } from '../stores/inbox'
import { useSettingsStore } from '../stores/settings'
import { useTerminalsStore } from '../stores/terminals'
import { useUiStore } from '../stores/ui'
import { useWorkspaceStore, workCwd } from '../stores/workspace'
import ArtImage from './ArtImage.vue'
import StatusIcon from './StatusIcon.vue'

type Group = 'sessions' | 'projects' | 'favorites' | 'files' | 'nav' | 'actions' | 'prefs' | 'settings' | 'help'
type Scope = 'all' | 'sessions' | 'projects' | 'commands' | 'files' | 'settings'

interface Item extends Searchable {
  id: string
  group: Group
  sub?: string
  icon?: Component
  status?: string
  /** Current state of a preference, shown as an On / Off tag. */
  on?: boolean
  /** Character positions in `label` a fuzzy match hit. */
  marks?: number[]
  run: () => void
  /** Shift+Enter. */
  alt?: () => void
  altHint?: string
}

interface MoreRow {
  more: Group
  hidden: number
}

const { t } = useI18n()
const ui = useUiStore()
const workspace = useWorkspaceStore()
const tips = useTipsStore()
const terminals = useTerminalsStore()
const favorites = useFavoritesStore()
const settings = useSettingsStore()
const connection = useConnectionStore()
const prompts = usePromptsStore()
const inbox = useInboxStore()
const rail = useRail()
const projectMru = useProjectMru()
const reveal = useRevealInWorkspace()
const settingsEnv = useSettingsEnv()

const query = ref('')
const scope = ref<Scope>('all')
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)
const list = ref<HTMLElement | null>(null)
let restoreFocus: HTMLElement | null = null

const STATUS_RANK: Record<string, number> = { waiting: 0, working: 1, error: 2, idle: 3, unknown: 4, stale: 5 }
const GROUP_ORDER: Group[] = ['sessions', 'projects', 'favorites', 'files', 'nav', 'actions', 'prefs', 'help', 'settings']
const SCOPES: Scope[] = ['all', 'sessions', 'projects', 'commands', 'files', 'settings']
const MODE_SCOPE: Record<PaletteMode, Scope> = { actions: 'commands', sessions: 'sessions', files: 'files', settings: 'settings' }
const MODES: PaletteMode[] = ['actions', 'sessions', 'files', 'settings']
const inScope = (g: Group, s: Scope) =>
  s === 'all' || s === g || (s === 'projects' && g === 'favorites') || (s === 'commands' && g !== 'sessions' && g !== 'projects' && g !== 'favorites' && g !== 'files' && g !== 'settings')

const parsed = computed(() => parsePrefix(query.value))
const text = computed(() => parsed.value.text)
const scopeNow = computed<Scope>(() => (parsed.value.mode ? MODE_SCOPE[parsed.value.mode] : scope.value))

const tabFocusedAt = (tabKey: string): number => {
  const tab = workspace.tabs.find((x) => x.key === tabKey)
  if (!tab) return 0
  return Math.max(0, ...leaves(tab.root).map((k) => workspace.panes.find((p) => p.key === k)?.focusedAt ?? 0))
}

function openProject(entry: ProjectEntry, newTab: boolean): void {
  ui.setView('workspace')
  const tabKey = newTab ? undefined : landingTab(entry.tabKeys, tabFocusedAt)
  if (tabKey) workspace.activateTab(tabKey)
  else workspace.open(workspace.preset, entry.dir, undefined, { tab: newTab })
}

const projectItem = (e: ProjectEntry, marks?: number[]): Item => ({
  id: `p:${e.key}`,
  group: 'projects',
  ...searchable(e.name, e.dir, e.branch),
  sub: [e.branch, shortPath(e.dir), e.tabs ? t('paletteV80.project.tabs', { n: e.tabs }, e.tabs) : null].filter(Boolean).join(' · '),
  icon: e.favorite ? Star : Folder,
  status: e.needs ? 'waiting' : e.failed ? 'error' : undefined,
  marks,
  run: () => openProject(e, false),
  alt: () => openProject(e, true),
  altHint: t('paletteV80.newTab'),
})

const projects = computed(() => projectEntries({ clusters: rail.clusters.value, mru: projectMru.mru.value, favorites: favorites.list }))
const projectItems = computed<Item[]>(() => (hasTerminals ? projects.value.map((e) => projectItem(e)) : []))

const activeCwd = (): string | undefined => {
  const pane = workspace.active
  if (!pane) return undefined
  return pane.kind === 'changes' || pane.kind === 'log' ? (pane.root ?? pane.cwd) : workCwd(pane)
}

const files = shallowRef<FileList | null>(null)
const fileState = ref<'idle' | 'loading' | 'failed' | 'none'>('idle')
let fileLoad = 0

async function loadFiles(): Promise<void> {
  const run = ++fileLoad
  files.value = null
  const cwd = activeCwd()
  if (!cwd) {
    fileState.value = 'none'
    return
  }
  fileState.value = 'loading'
  const status = await changesStatus(cwd)
  if (run !== fileLoad) return
  const res = await listFiles(status.ok ? status.root : cwd)
  if (run !== fileLoad) return
  files.value = res
  fileState.value = res ? 'idle' : 'failed'
}

const items = computed<Item[]>(() => {
  const sessions: Item[] = [...terminals.list]
    .sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9))
    .map((x) => {
      const title = displayTitle(x)
      const live = x.status !== 'stale'
      const provider = isCodex(x) ? t('provider.codex') : null
      const reopen = !live && reveal.canReopen(x)
      return {
        id: `s:${x.id}`,
        group: 'sessions' as const,
        ...searchable(title, x.title, x.cwd, x.gitBranch, x.status, provider),
        sub: [provider, t(statusMeta(x.status).labelKey), x.gitBranch, shortPath(x.cwd)].filter(Boolean).join(' · '),
        status: x.status,
        run: () => {
          ui.setView('monitor')
          ui.focusTerminal(x.id)
        },
        alt: reopen ? () => void reveal.reopen(x) : live && x.processId ? () => connection.focusWindow(x.id) : undefined,
        altHint: reopen ? t('paletteV80.resume') : t('palette.jump'),
      }
    })
  const favs: Item[] = hasTerminals
    ? []
    : favorites.list.map((f) => ({
        id: `f:${f.dir}`,
        group: 'favorites' as const,
        ...searchable(f.label, f.dir),
        sub: shortPath(f.dir),
        icon: FolderOpen,
        run: () => connection.openFavorite(f.dir, 'new'),
        alt: () => connection.openFavorite(f.dir, 'continue'),
        altHint: t('palette.continue'),
      }))
  const ended = terminals.list.filter((x) => x.status === 'stale').length
  const commands: Omit<Item, 'exact' | 'hay'>[] = [
    { id: 'c:monitor', group: 'nav', label: t('palette.goMonitor'), icon: Activity, run: () => ui.setView('monitor') },
    { id: 'c:usage', group: 'nav', label: t('palette.goUsage'), icon: ChartColumnBig, run: () => ui.setView('usage') },
    { id: 'c:history', group: 'nav', label: t('palette.goHistory'), icon: History, run: () => ui.setView('history') },
    {
      id: 'c:prompt-search',
      group: 'nav',
      label: t('promptSearch.palette'),
      icon: History,
      run: () => {
        ui.setView('history')
        ui.promptSearchFocus = true
      },
    },
    ...(hasExtensions ? [{ id: 'c:extensions', group: 'nav' as const, label: t('palette.goExtensions'), icon: Puzzle, run: () => ui.setView('extensions') }] : []),
    ...(hasDevices ? [{ id: 'c:devices', group: 'nav' as const, label: t('palette.goDevices'), icon: Smartphone, run: () => ui.setView('devices') }] : []),
    ...(hasTerminals && hasLog
      ? [
          {
            id: 'c:gitlog',
            group: 'nav' as const,
            label: t('workspace.log.palette'),
            icon: GitGraph,
            run: () => {
              const pane = workspace.active
              const cwd = pane ? (pane.kind === 'changes' || pane.kind === 'log' ? (pane.root ?? pane.cwd) : workCwd(pane)) : workspace.recentDirs[0]
              if (!cwd) return
              ui.setView('workspace')
              workspace.openLog(cwd)
            },
          },
        ]
      : []),
    ...(hasTerminals
      ? [
          {
            id: 'c:projects',
            group: 'nav' as const,
            label: t('projectSwitcher.palette'),
            sub: isMac ? '⌃⌥P' : 'Ctrl+Alt+P',
            icon: FolderSearch,
            run: () => {
              ui.setView('workspace')
              ui.projectSwitcher = true
            },
          },
          {
            id: 'c:prompts',
            group: 'actions' as const,
            label: t('workspace.prompts.palette'),
            sub: isMac ? '⇧⌘P' : 'Alt+Shift+P',
            icon: BookText,
            run: () => {
              ui.setView('workspace')
              prompts.open = true
            },
          },
        ]
      : []),
    ...(hasTerminals && hasExplorer
      ? [
          {
            id: 'c:plan',
            group: 'actions' as const,
            label: t('workspace.plan.palette'),
            sub: t('workspace.plan.paletteSub'),
            icon: ListTodo,
            run: () => {
              ui.setView('workspace')
              ui.planBoard = { dir: null }
            },
          },
        ]
      : []),
    ...(hasTerminals && hasEnvCheck
      ? [
          {
            id: 'c:env',
            group: 'actions' as const,
            label: t('workspace.envCheck.palette'),
            sub: t('workspace.envCheck.paletteSub'),
            icon: KeyRound,
            run: () => {
              ui.setView('workspace')
              ui.envCheck = { dir: null }
            },
          },
        ]
      : []),
    ...(hasTerminals && hasI18nScan
      ? [
          {
            id: 'c:i18n',
            group: 'actions' as const,
            label: t('workspace.i18nScan.palette'),
            sub: t('workspace.i18nScan.paletteSub'),
            icon: Languages,
            run: () => {
              ui.setView('workspace')
              ui.i18nScan = { dir: null }
            },
          },
          {
            id: 'c:strings',
            group: 'actions' as const,
            label: t('stringsTable.palette'),
            sub: t('stringsTable.paletteSub'),
            icon: Languages,
            run: () => {
              ui.setView('workspace')
              ui.stringsTable = { dir: null, focus: null }
            },
          },
        ]
      : []),
    ...(hasTerminals && hasApkSize
      ? [
          {
            id: 'c:apk-size',
            group: 'actions' as const,
            label: t('apkSize.palette'),
            sub: t('apkSize.paletteSub'),
            icon: Package,
            run: () => {
              ui.setView('workspace')
              ui.apkSize = { path: null, root: null }
            },
          },
        ]
      : []),
    ...(hasTerminals && hasReleaseCheck
      ? [
          {
            id: 'c:release-check',
            group: 'actions' as const,
            label: t('releaseCheck.palette'),
            sub: t('releaseCheck.paletteSub'),
            icon: ClipboardCheck,
            run: () => {
              ui.setView('workspace')
              ui.releaseCheck = { dir: null }
            },
          },
        ]
      : []),
    ...(hasTerminals && hasPermAdvisor
      ? [
          {
            id: 'c:perms',
            group: 'actions' as const,
            label: t('permAdvisor.palette'),
            sub: t('permAdvisor.paletteSub'),
            icon: ShieldCheck,
            run: () => {
              ui.setView('workspace')
              ui.permAdvisor = { dir: null }
            },
          },
        ]
      : []),
    ...(hasTerminals && hasCtxSources
      ? [
          {
            id: 'c:context',
            group: 'actions' as const,
            label: t('ctxSources.palette'),
            sub: t('ctxSources.paletteSub'),
            icon: Layers,
            run: () => {
              ui.setView('workspace')
              ui.contextSources = { cwd: null, terminalId: null }
            },
          },
        ]
      : []),
    { id: 'c:compact', group: 'nav', label: ui.compact ? t('compact.exit') : t('compact.enter'), icon: Minimize2, run: () => ui.toggleCompact() },
    { id: 'c:inbox', group: 'actions', label: t('inbox.palette'), sub: t('inbox.button', { n: inbox.items.length }, inbox.items.length), icon: Inbox, run: () => (inbox.open = true) },
    { id: 'c:recap', group: 'actions', label: t('palette.recap'), icon: FileDown, run: () => ui.openRecap() },
    ...DEV_TOOLS.map((id) => ({
      id: `c:tool:${id}`,
      group: 'actions' as const,
      label: t('workspace.devTools.palette', { name: t(`workspace.devTools.tab.${id}`) }),
      sub: t(`workspace.devTools.sub.${id}`),
      icon: Wrench,
      run: () => (ui.devTools = id),
    })),
    ...(ended ? [{ id: 'c:clear', group: 'actions' as const, label: t('sessions.clearEnded', { n: ended }), icon: Trash2, run: () => void connection.dismissEnded() }] : []),
    { id: 'c:notify', group: 'prefs', label: t('settings.notifyEnable'), icon: Bell, on: settings.notifyEnabled, run: () => void settings.toggleNotifications() },
    { id: 'c:sound', group: 'prefs', label: t('settings.sound'), icon: Volume2, on: settings.sound, run: () => (settings.sound = !settings.sound) },
    { id: 'c:theme', group: 'prefs', label: t('palette.darkTheme'), icon: Moon, on: modeOf(settings.theme) === 'dark', run: () => settings.toggleTheme() },
    ...THEMES.map((th) => ({
      id: `c:theme:${th.id}`,
      group: 'prefs' as const,
      label: t('palette.themeNamed', { name: `${th.name} ${t(th.mode === 'dark' ? 'settings.themeDark' : 'settings.themeLight')}` }),
      icon: Palette,
      on: settings.theme === th.id,
      run: () => withViewTransition(() => settings.setTheme(th.id)),
    })),
    ...(['code', 'ui'] as const).flatMap((kind) =>
      visibleFonts(kind, desktop?.platform).map((f) => ({
        id: `c:font:${kind}:${f.id}`,
        group: 'prefs' as const,
        label: t(kind === 'code' ? 'fonts.paletteCode' : 'fonts.paletteUi', { name: f.id === 'system' ? t('fonts.system') : f.name }),
        icon: Type,
        on: (kind === 'code' ? settings.codeFont : settings.uiFont) === f.id,
        run: () => (kind === 'code' ? settings.setCodeFont(f.id) : settings.setUiFont(f.id)),
      })),
    ),
    { id: 'c:codeLarger', group: 'prefs', label: t('fonts.paletteLarger'), sub: t('fonts.px', { n: settings.codeFontSize }), icon: AArrowUp, run: () => stepCodeSize(settings, 1) },
    { id: 'c:codeSmaller', group: 'prefs', label: t('fonts.paletteSmaller'), sub: t('fonts.px', { n: settings.codeFontSize }), icon: AArrowDown, run: () => stepCodeSize(settings, -1) },
    { id: 'c:keyHints', group: 'prefs', label: t('keys.hints'), icon: Keyboard, on: settings.keyHints, run: () => (settings.keyHints = !settings.keyHints) },
    { id: 'c:tools', group: 'prefs', label: t('palette.toolsPref'), icon: ListFilter, on: !settings.hideTools, run: () => (settings.hideTools = !settings.hideTools) },
    { id: 'c:lang', group: 'prefs', label: t('palette.language'), sub: settings.locale === 'vi' ? 'Tiếng Việt → English' : 'English → Tiếng Việt', icon: Languages, run: () => settings.toggleLocale() },
    { id: 'c:settings', group: 'help', label: t('palette.openSettings'), icon: Settings2, run: () => (ui.settingsOpen = true) },
    { id: 'c:whatsNew', group: 'help', label: t('whatsNew.open'), sub: APP_VERSION, icon: Sparkles, run: () => (ui.whatsNewOpen = true) },
    { id: 'c:keys', group: 'help', label: t('keys.title'), sub: '?', icon: Keyboard, run: () => (ui.shortcutsOpen = true) },
    { id: 'c:tour', group: 'help', label: t('tour.open'), icon: GraduationCap, run: () => (ui.tourOpen = 'monitor') },
    ...(hasTerminals
      ? [
          { id: 'c:tourWorkspace', group: 'help' as const, label: t('wsHelp.tour'), icon: GraduationCap, run: () => (ui.tourOpen = 'workspace' as const) },
          { id: 'c:tips', group: 'prefs' as const, label: t('tips.setting'), icon: Lightbulb, on: !tips.state.off, run: () => tips.setOff(!tips.state.off) },
        ]
      : []),
    { id: 'c:diag', group: 'help', label: t('diag.title'), icon: Stethoscope, run: () => (ui.diagnosticsOpen = true) },
    ...(desktop ? [{ id: 'c:setup', group: 'help' as const, label: t('setup.open'), sub: t('setup.openHint'), icon: ListChecks, run: () => (ui.setupOpen = true) }] : []),
  ]
  return [...sessions, ...favs, ...commands.map((c) => ({ ...c, ...searchable(c.label, c.sub) }))]
})

// One letter is too vague for files, and settings only join the mixed view once something is typed.
const wantFiles = computed(() => scopeNow.value === 'files' || text.value.length >= 2)
const wantSettings = computed(() => scopeNow.value === 'settings' || text.value !== '')

const localMatches = computed<Item[]>(() => {
  const found = matchText(items.value, text.value)
  const known = text.value ? filterProjects(projects.value, text.value).map((h) => projectItem(h.entry, h.name)) : projectItems.value
  return [...found, ...(hasTerminals ? known : [])]
})

function openSetting(page: SettingsPage, id: string): void {
  ui.settingsPage = page
  ui.settingsOpen = true
  flashSettingRow(id)
}

const settingItems = computed<Item[]>(() => {
  if (!wantSettings.value) return []
  const all = settingsEntries(isMac)
  const tr = (k: string): string => t(k)
  const hits = text.value ? searchSettings(text.value, all, settingsEnv.value, tr) : listSettings(all, settingsEnv.value, tr)
  return hits.map((h) => ({
    id: `set:${h.page}:${h.id}`,
    group: 'settings' as const,
    ...searchable(h.label),
    sub: t(`settingsV79.pages.${h.page}`),
    icon: SlidersHorizontal,
    run: () => openSetting(h.page, h.id),
  }))
})

function openFile(root: string, rel: string, line: number | undefined, split: boolean): void {
  ui.setView('workspace')
  const key = workspace.activeKey
  withViewTransition(() => workspace.openFile(joinPath(root, rel), line, split && key ? { cwd: root, split: { key, dir: 'row' } } : { cwd: root }))
}

const fileItems = computed<Item[]>(() => {
  const list = files.value
  if (!list || !wantFiles.value) return []
  const found = matchFiles(list.files, text.value, { min: scopeNow.value === 'files' ? 0 : 2 })
  return found.hits.map((hit) => {
    const cut = hit.item.lastIndexOf('/') + 1
    const dir = cut ? hit.item.slice(0, cut - 1) : ''
    return {
      id: `file:${hit.item}`,
      group: 'files' as const,
      ...searchable(hit.item.slice(cut)),
      sub: [dir, found.line ? t('paletteV80.files.line', { n: found.line }) : null].filter(Boolean).join(' · ') || undefined,
      marks: hit.positions.filter((p) => p >= cut).map((p) => p - cut),
      icon: FileText,
      run: () => openFile(list.root, hit.item, found.line, false),
      alt: () => openFile(list.root, hit.item, found.line, true),
      altHint: t('workspace.quickOpen.hints.split'),
    }
  })
})

const matched = computed<Item[]>(() => [...localMatches.value, ...fileItems.value, ...settingItems.value])
const filtered = computed(() => matched.value.filter((x) => inScope(x.group, scopeNow.value)))
const scopeCounts = computed(() => Object.fromEntries(SCOPES.map((s) => [s, matched.value.filter((x) => inScope(x.group, s)).length])) as Record<Scope, number>)

const expanded = ref(new Set<Group>())
type Row = (Item | MoreRow) & { index: number }
const isMore = (r: Row): r is MoreRow & { index: number } => 'more' in r

const groupLabel = (g: Group): string => (g === 'projects' || g === 'files' || g === 'settings' ? t(`paletteV80.group.${g}`) : t(`palette.group.${g}`))

const groups = computed(() => {
  let index = 0
  const single = scopeNow.value !== 'all'
  return GROUP_ORDER.flatMap((g) => {
    const inGroup = filtered.value.filter((x) => x.group === g)
    if (!inGroup.length) return []
    const { shown, hidden } = single ? { shown: inGroup, hidden: 0 } : cap(inGroup, expanded.value.has(g))
    const rows: Row[] = shown.map((x) => ({ ...x, index: index++ }))
    if (hidden) rows.push({ more: g, hidden, index: index++ })
    return [{ key: g, label: groupLabel(g), items: rows }]
  })
})
const flat = computed(() => groups.value.flatMap((g) => g.items))

const fileNote = computed(() => {
  if (scopeNow.value !== 'files') return null
  if (fileState.value === 'none') return t('paletteV80.files.noProject')
  if (fileState.value === 'loading') return t('paletteV80.files.loading')
  if (fileState.value === 'failed') return t('paletteV80.files.failed')
  return null
})

const tokens = computed(() => fold(text.value).split(/\s+/).filter(Boolean))

/** Splits a label into matched / unmatched runs; folding keeps precomposed text the same length. */
function parts(item: Item): { text: string; hit: boolean }[] {
  const label = item.label
  if (item.marks) return highlightRuns(label, item.marks)
  const folded = fold(label)
  if (!tokens.value.length || folded.length !== label.length) return [{ text: label, hit: false }]
  const mark = new Array<boolean>(label.length).fill(false)
  for (const tk of tokens.value) {
    let from = folded.indexOf(tk)
    while (from >= 0) {
      for (let i = from; i < from + tk.length; i++) mark[i] = true
      from = folded.indexOf(tk, from + tk.length)
    }
  }
  const out: { text: string; hit: boolean }[] = []
  for (let i = 0; i < label.length; i++) {
    const last = out[out.length - 1]
    if (last && last.hit === mark[i]) last.text += label[i]
    else out.push({ text: label[i]!, hit: mark[i]! })
  }
  return out
}

watch([query, scope], () => {
  active.value = 0
  expanded.value = new Set()
})
watch(
  () => flat.value.length,
  (n) => {
    if (active.value > n - 1) active.value = Math.max(0, n - 1)
  },
)

function close(): void {
  ui.paletteOpen = false
}

function choose(item: Row | undefined, alt: boolean): void {
  if (!item) return
  if (isMore(item)) {
    expanded.value = new Set(expanded.value).add(item.more)
    return
  }
  close()
  // After the close watcher has put focus back, so a navigating action keeps the focus it sets.
  void nextTick(() => (alt && item.alt ? item.alt() : item.run()))
}

function move(delta: number): void {
  const n = flat.value.length
  if (!n) return
  active.value = (active.value + delta + n) % n
  void nextTick(() => list.value?.querySelector(`[data-index="${active.value}"]`)?.scrollIntoView({ block: 'nearest' }))
}

function setScope(next: Scope): void {
  if (parsed.value.mode) query.value = parsed.value.text
  scope.value = next
}

function cycleScope(delta: number): void {
  setScope(SCOPES[(SCOPES.indexOf(scopeNow.value) + delta + SCOPES.length) % SCOPES.length]!)
}

function clearQuery(): void {
  query.value = ''
  input.value?.focus()
}

function startMode(mode: PaletteMode): void {
  query.value = prefixOf(mode)
  input.value?.focus()
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    move(1)
  } else if (e.key === 'ArrowUp') {
    e.preventDefault()
    move(-1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    choose(flat.value[active.value], e.shiftKey)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    if (query.value) query.value = ''
    else close()
  } else if (e.key === 'Tab') {
    e.preventDefault()
    cycleScope(e.shiftKey ? -1 : 1)
  }
}

function onGlobalKey(e: KeyboardEvent): void {
  // Inside a terminal Ctrl+K belongs to the shell / agent (kill line).
  if ((e.target as Element | null)?.closest?.('.xterm')) return
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    ui.paletteOpen = !ui.paletteOpen
  }
}

watch(
  () => ui.paletteOpen,
  async (open) => {
    if (open) {
      restoreFocus = document.activeElement as HTMLElement | null
      query.value = ''
      scope.value = 'all'
      active.value = 0
      expanded.value = new Set()
      filesAsked = false
      await nextTick()
      input.value?.focus()
    } else {
      fileLoad++
      files.value = null
      fileState.value = 'idle'
      if (restoreFocus?.isConnected) restoreFocus.focus()
      restoreFocus = null
    }
  },
)

// The project's file list is only fetched once a search could use it.
let filesAsked = false
watch(
  () => ui.paletteOpen && (scopeNow.value === 'files' || (scopeNow.value === 'all' && text.value.length >= 2)),
  (want) => {
    if (!want || filesAsked) return
    filesAsked = true
    void loadFiles()
  },
)

onMounted(() => document.addEventListener('keydown', onGlobalKey))
onBeforeUnmount(() => document.removeEventListener('keydown', onGlobalKey))

const activeId = computed(() => (flat.value[active.value] ? `palette-opt-${active.value}` : undefined))
const emptyText = computed(() => fileNote.value ?? (query.value ? t('palette.emptyFor', { q: query.value }) : t('palette.empty')))
const HINTS = [
  { key: 'move', keys: '↑ ↓' },
  { key: 'open', keys: 'Enter' },
  { key: 'scope', keys: 'Tab' },
  { key: 'close', keys: 'Esc' },
] as const
</script>

<template>
  <Teleport to="body">
    <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div v-if="ui.paletteOpen" class="fixed inset-0 z-50 flex items-start justify-center ccm-scrim px-3 pt-[8vh] sm:px-4 sm:pt-[12vh]" @mousedown.self="close">
        <div
          role="dialog"
          aria-modal="true"
          :aria-label="t('palette.title')"
          class="flex max-h-[min(78vh,620px)] w-full max-w-[640px] flex-col overflow-hidden ccm-sheet"
        >
          <div class="flex items-center gap-3 px-5 pt-2">
            <Search :size="19" class="shrink-0 text-ink-muted" aria-hidden="true" />
            <input
              ref="input"
              v-model="query"
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-list"
              aria-autocomplete="list"
              :aria-activedescendant="activeId"
              :aria-label="t('palette.title')"
              :placeholder="t('paletteV80.placeholder')"
              class="ccm-bare-input h-14 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-faint"
              autocomplete="off"
              spellcheck="false"
              @keydown="onKey"
            />
            <button
              v-if="query"
              type="button"
              class="ccm-btn-plain shrink-0"
              :aria-label="t('palette.clear')"
              :title="t('palette.clear')"
              @mousedown.prevent
              @click="clearQuery"
            >
              <X :size="16" aria-hidden="true" />
            </button>
            <kbd v-else class="hidden shrink-0 rounded-inner bg-fill px-1.5 py-0.5 font-sans text-2xs text-ink-faint sm:inline">Esc</kbd>
          </div>

          <div class="flex gap-4 border-b border-line px-5" role="radiogroup" :aria-label="t('palette.scopeLabel')">
            <button
              v-for="s in SCOPES"
              :key="s"
              type="button"
              role="radio"
              :aria-checked="scopeNow === s"
              tabindex="-1"
              class="-mb-px inline-flex h-9 cursor-pointer items-center gap-1.5 border-b-2 text-xs font-medium transition-colors"
              :class="scopeNow === s ? 'border-accent text-ink' : 'border-transparent text-ink-faint hover:text-ink-muted'"
              @mousedown.prevent
              @click="setScope(s)"
            >
              {{ t(`paletteV80.scope.${s}`) }}
              <span class="tabular text-2xs" :class="scopeNow === s ? 'text-accent-ink' : 'text-ink-faint'">{{ scopeCounts[s] }}</span>
            </button>
          </div>

          <div id="palette-list" ref="list" role="listbox" :aria-label="t('palette.title')" class="ccm-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pt-1 pb-3">
            <div v-if="!flat.length" class="flex flex-col items-center gap-2 px-6 py-12 text-center">
              <ArtImage name="empty-project-search" class="w-28" />
              <p class="text-sm font-medium" :role="fileNote ? 'status' : undefined">{{ emptyText }}</p>
              <p v-if="!fileNote" class="max-w-[36ch] text-xs text-ink-faint">{{ t('palette.emptyHint') }}</p>
              <button
                v-if="scopeNow !== 'all' && scopeCounts.all"
                type="button"
                class="ccm-btn mt-2"
                @mousedown.prevent
                @click="setScope('all')"
              >
                {{ t('palette.showAll', { n: scopeCounts.all }) }}
              </button>
            </div>
            <div v-for="g in groups" :key="g.key" role="group" :aria-label="g.label" class="pt-3">
              <p class="px-3 pb-1.5 text-2xs font-medium text-ink-faint">{{ g.label }}</p>
              <div class="flex flex-col gap-0.5">
                <template v-for="item in g.items" :key="'more' in item ? `more:${item.more}` : item.id">
                <div
                  v-if="isMore(item)"
                  :id="`palette-opt-${item.index}`"
                  role="option"
                  :data-index="item.index"
                  :aria-selected="item.index === active"
                  class="flex h-9 cursor-pointer items-center gap-3 rounded-inner px-3 text-xs"
                  :class="item.index === active ? 'bg-accent text-on-accent' : 'text-ink-muted'"
                  data-palette-more
                  @mousemove="active = item.index"
                  @click="choose(item, false)"
                >
                  <span class="inline-flex size-7 shrink-0 items-center justify-center" aria-hidden="true">…</span>
                  {{ t('paletteV80.more', { n: item.hidden }) }}
                </div>
                <div
                  v-else
                  :id="`palette-opt-${item.index}`"
                  role="option"
                  :data-index="item.index"
                  :aria-selected="item.index === active"
                  class="relative flex min-h-11 cursor-pointer items-center gap-3 rounded-inner px-3 py-1.5 text-sm"
                  :class="item.index === active ? 'bg-accent text-on-accent' : 'text-ink'"
                  @mousemove="active = item.index"
                  @click="choose(item, $event.shiftKey)"
                >
                  <span
                    class="inline-flex size-7 shrink-0 items-center justify-center"
                    :class="item.status && item.index === active ? 'rounded-inner bg-surface' : ''"
                    aria-hidden="true"
                  >
                    <StatusIcon v-if="item.status" :status="item.status" :size="16" :animate="false" />
                    <component :is="item.icon" v-else-if="item.icon" :size="16" :class="item.index === active ? 'text-on-accent' : 'text-ink-faint'" />
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="block truncate"
                      ><template v-for="(p, pi) in parts(item)" :key="pi"
                        ><mark v-if="p.hit" class="bg-transparent font-semibold" :class="item.index === active ? 'text-on-accent' : 'text-accent-ink'">{{ p.text }}</mark
                        ><template v-else>{{ p.text }}</template></template
                      ></span
                    >
                    <span v-if="item.sub" class="mt-0.5 block truncate text-2xs" :class="item.index === active ? 'text-on-accent' : 'text-ink-faint'">{{ item.sub }}</span>
                  </span>
                  <span
                    v-if="item.on !== undefined"
                    class="inline-flex shrink-0 items-center gap-1.5 text-xs"
                    :class="item.index === active ? 'text-on-accent' : item.on ? 'text-success' : 'text-ink-faint'"
                  >
                    <span class="size-1.5 rounded-full" :class="item.on ? (item.index === active ? 'bg-on-accent' : 'bg-success') : 'border border-current'" aria-hidden="true" />
                    {{ item.on ? t('palette.on') : t('palette.off') }}
                  </span>
                  <span v-if="item.index === active" class="hidden shrink-0 items-center gap-2 text-2xs text-on-accent sm:inline-flex">
                    <span v-if="item.alt" class="inline-flex items-center gap-1"
                      ><AppWindow v-if="item.group === 'sessions'" :size="12" aria-hidden="true" />{{ item.altHint }}
                      <kbd class="rounded-inner bg-on-accent/20 px-1 font-sans">{{ keyCombo(['Shift', 'Enter'], isMac) }}</kbd></span
                    >
                    <kbd class="inline-flex items-center rounded-inner bg-on-accent/20 px-1 py-px"><CornerDownLeft :size="12" aria-hidden="true" /></kbd>
                  </span>
                </div>
                </template>
              </div>
            </div>
            <p v-if="scopeNow === 'files' && files?.truncated && flat.length" class="px-3 pt-3 text-2xs text-ink-faint">{{ t('paletteV80.files.truncated', { n: files.files.length }) }}</p>
          </div>

          <div class="hidden flex-wrap items-center gap-x-5 gap-y-1 border-t border-line px-5 py-3 text-2xs text-ink-faint sm:flex">
            <span v-for="h in HINTS" :key="h.key" class="inline-flex items-center gap-1.5">
              <kbd class="rounded-inner bg-fill px-1.5 py-px font-sans text-ink-muted">{{ h.keys }}</kbd>{{ t(`palette.hints.${h.key}`) }}
            </span>
            <span class="ml-auto inline-flex items-center gap-3">
              <button
                v-for="m in MODES"
                :key="m"
                type="button"
                class="inline-flex cursor-pointer items-center gap-1.5 hover:text-ink-muted"
                :data-palette-mode="m"
                @mousedown.prevent
                @click="startMode(m)"
              >
                <kbd class="rounded-inner bg-fill px-1.5 py-px font-sans text-ink-muted">{{ prefixOf(m) }}</kbd>{{ t(`paletteV80.prefix.${m}`) }}
              </button>
            </span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
