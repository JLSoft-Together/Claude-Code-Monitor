import { defineStore } from 'pinia'
import type { CompactFlow } from '../lib/compactHandoff'
import { computed, ref, shallowRef, watch } from 'vue'
import { cleanPanePrompt, isAgentSessionId, isPtyPreset, type PaneOpenRequest, type PaneOpenResult, type PeerLink, type PtyPreset, type TerminalSession } from '@ccm/shared'
import {
  dockSpot,
  dockTree,
  isLayout,
  isLeaf,
  leaves,
  movePane as moveLeaf,
  neighbor,
  removeLeaf,
  setRatio as setTreeRatio,
  splitLeaf,
  swapPanes as swapLeaves,
  type Edge,
  type FocusDir,
  type LayoutNode,
  type SplitDir,
} from '../lib/splitLayout'
import type { SavedLayout } from '../lib/projects'
import { dirKey } from './favorites'
import { openedLinkId, usePeersStore } from './peers'

export type PaneState = 'parked' | 'starting' | 'running' | 'exited' | 'gone' | 'error'

/** Missing = 'term' (state saved before v21). */
export type PaneKind = 'term' | 'browser' | 'file' | 'changes' | 'log' | 'run'

export type PaneSpec =
  | { kind: 'term'; preset: PtyPreset }
  | { kind: 'browser'; url: string }
  | { kind: 'file'; path: string; line?: number }
  | { kind: 'changes' }
  | { kind: 'log' }
  | { kind: 'run' }

/** Split menu entries. */
export type SplitChoice = PtyPreset | 'browser'

export interface Pane {
  key: string
  kind?: PaneKind
  /** Terms only; viewer panes keep 'shell' as a placeholder. */
  preset: PtyPreset
  /** Browser: http(s) URL or absolute file path (preview URLs change every run). Empty = blank page. */
  url?: string
  /** File viewer: absolute path, opened at `line`. */
  path?: string
  line?: number
  /** File viewer (v42): editor buffer differs from the file on disk. Runtime only, never persisted. */
  dirty?: boolean
  /** Changes / Log: git toplevel once known; Changes: number of changed files. */
  root?: string
  count?: number
  /** Changes: absolute path of the file to select; Log: commit hash to select. Runtime only, cleared once shown. */
  select?: string
  /** Browser page title / favicon, runtime only. */
  title?: string
  favicon?: string | null
  /** Last time this pane took focus: picks the agent a browser pane sends to. */
  focusedAt?: number
  cwd?: string
  /** Shell's current folder reported via OSC 7 / 9;9 after `cd`; runtime only, `cwd` stays the starting folder. */
  liveCwd?: string
  /** PTY host session id once spawned; lets a reload re-attach instead of starting over. */
  sessionId?: string
  pid?: number
  /** Monitor terminal running inside this pane (agent process descends from the PTY), found by `useWorkspaceLinks`. */
  terminalId?: string
  /** What runs now when it differs from `preset`, from the monitor link (`agentNow`): an agent typed in a shell pane, or 'shell' once an agent pane's agent exited. Runtime only. */
  agent?: PtyPreset
  /** Agent session to continue when spawning (`claude --resume` / `codex resume`). */
  resume?: string
  /** Latest agent session seen running in this pane (from the monitor link); what a later restore resumes. */
  agentSessionId?: string
  /** Latched when the agent starts waiting or finishes while the pane is out of sight; cleared when focused. */
  attention?: 'waiting' | 'done'
  /** Git branch of the pane's folder, pushed by the PTY host when HEAD changes. */
  branch?: string
  /** A command was entered in this shell: closing it may stop a dev server or build the monitor cannot see. */
  ranCommand?: boolean
  /** Script line started from the scripts menu: names the row; typed once (`pendingCommand`) when the shell is ready. */
  command?: string
  pendingCommand?: string
  openTicket?: string
  prefill?: string
  prefillSubmit?: boolean
  compact?: CompactFlow
  openedBy?: string
  state: PaneState
  exitCode?: number
  error?: string
}

export interface Tab {
  key: string
  root: LayoutNode
  /** Pane that gets focus when the tab is selected. */
  focus: string
  /** Folder the tab was opened for: fixed for the tab's life, a `cd` never moves it. Missing = home / saved before v38. */
  project?: string
  name?: string
  folded?: boolean
  zoom?: string
}

export const TAB_NAME_MAX = 60

const zoomOf = (t: Partial<Tab>, root: LayoutNode): string | undefined => {
  const keys = leaves(root)
  return typeof t.zoom === 'string' && keys.length > 1 && keys.includes(t.zoom) ? t.zoom : undefined
}

export const CLOSED_MAX = 10
export const OPENED_NOTE_MS = 120_000

export interface ClosedPane {
  key: string
  kind?: PaneKind
  preset: PtyPreset
  cwd?: string
  resume?: string
  url?: string
  path?: string
  line?: number
  name: string
  openedBy?: string
}

export interface ClosedAnchor {
  siblingKey: string
  group: string[]
  dir: SplitDir
  side: 'a' | 'b'
  ratio: number
}

export interface ClosedTab {
  root: LayoutNode
  focus: string
  name?: string
  project?: string
  index: number
  panes: ClosedPane[]
}

export interface ClosedLoose {
  pane: ClosedPane
  anchor: ClosedAnchor | null
  project?: string
}

export interface ClosedEntry {
  id: number
  at: number
  tabs: ClosedTab[]
  loose: ClosedLoose[]
}

export const closedPanes = (e: ClosedEntry): ClosedPane[] => [...e.tabs.flatMap((t) => t.panes), ...e.loose.map((l) => l.pane)]

const copyTree = (n: LayoutNode): LayoutNode => (isLeaf(n) ? { pane: n.pane } : { dir: n.dir, ratio: n.ratio, a: copyTree(n.a), b: copyTree(n.b) })

const remapTree = (n: LayoutNode, map: ReadonlyMap<string, string>): LayoutNode =>
  isLeaf(n) ? { pane: map.get(n.pane) ?? n.pane } : { dir: n.dir, ratio: n.ratio, a: remapTree(n.a, map), b: remapTree(n.b, map) }

export function anchorOf(root: LayoutNode, key: string): ClosedAnchor | null {
  if (isLeaf(root)) return null
  for (const side of ['a', 'b'] as const) {
    const child = root[side]
    if (!isLeaf(child) || child.pane !== key) continue
    const group = leaves(root[side === 'a' ? 'b' : 'a'])
    return { siblingKey: side === 'a' ? group[0]! : group[group.length - 1]!, group, dir: root.dir, side, ratio: root.ratio }
  }
  return anchorOf(root.a, key) ?? anchorOf(root.b, key)
}

function wrapGroup(n: LayoutNode, want: ReadonlySet<string>, wrap: (n: LayoutNode) => LayoutNode): LayoutNode | null {
  const keys = leaves(n)
  if (keys.length === want.size && keys.every((k) => want.has(k))) return wrap(n)
  if (isLeaf(n) || !keys.some((k) => want.has(k))) return null
  const a = wrapGroup(n.a, want, wrap)
  if (a) return { ...n, a }
  const b = wrapGroup(n.b, want, wrap)
  return b ? { ...n, b } : null
}

export const cleanTabName = (v: unknown): string | undefined =>
  typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, TAB_NAME_MAX) || undefined : undefined

const tabExtras = (t: Partial<Tab>): Pick<Tab, 'name' | 'folded'> => ({ name: cleanTabName(t.name), folded: t.folded === true || undefined })

export function tabTitle(tab: Tab, paneOf: (key: string) => Pane | undefined, titleOf: (pane: Pane) => string): string {
  if (tab.name) return tab.name
  const primary = paneOf(primaryPaneKey(tab.root, paneOf))
  return primary ? titleOf(primary) : ''
}

const STORAGE_KEY = 'ccm.workspace.panes'
const RECENT_KEY = 'ccm.workspace.recent'
const PRESET_KEY = 'ccm.workspace.preset'
const RECENT_LIMIT = 8
// Survives app restarts (unlike the per-window session state): what "Restore previous workspace" rebuilds.
const LAST_KEY = 'ccm.workspace.last'

interface ViewFields {
  kind?: PaneKind
  url?: string
  path?: string
  line?: number
}

interface LastPane extends ViewFields {
  key: string
  preset: PtyPreset
  cwd?: string
  resume?: string
}

export const isTerm = (p: Pick<Pane, 'kind'>): boolean => !p.kind || p.kind === 'term'

/** What the pane runs now: a shell pane running `claude` / `codex` shows and behaves as that agent, an agent pane whose agent quit as its shell; spawn keeps `preset`. */
export const presetOf = (p: Pick<Pane, 'preset' | 'agent'>): PtyPreset => p.agent ?? p.preset

/**
 * `Pane.agent` from the pane's linked monitor terminal: the live agent when it is not the preset; an agent pane
 * that was linked and whose session ended is back at the shell its preset runs in (until the next agent links).
 */
export function agentNow(p: Pick<Pane, 'preset' | 'agent' | 'terminalId'>, term: Pick<TerminalSession, 'status' | 'provider'> | undefined): PtyPreset | undefined {
  if (term && term.status !== 'stale') {
    const live = term.provider ?? 'claude'
    return live === p.preset ? undefined : live
  }
  return p.preset !== 'shell' && (p.terminalId || p.agent) ? 'shell' : undefined
}

export type SaveOutcome = { ok: true } | { ok: false; error: string }

/** Folder the pane works in now: links, quick open and the branch chip follow the shell's `cd`. */
export const workCwd = (p: Pick<Pane, 'cwd' | 'liveCwd'>): string | undefined => p.liveCwd ?? p.cwd

/** Pane that names a tab: first terminal in layout order, else the first leaf, so focus moves never relabel it. */
export function primaryPaneKey(root: LayoutNode, paneOf: (key: string) => Pick<Pane, 'kind'> | undefined): string {
  const keys = leaves(root)
  return keys.find((k) => {
    const p = paneOf(k)
    return !!p && isTerm(p)
  }) ?? keys[0]!
}

/** A tab's project; tabs saved before v38 fall back to their naming pane's starting folder. */
export function tabProject(tab: Tab, paneOf: (key: string) => Pick<Pane, 'kind' | 'cwd'> | undefined): string | undefined {
  return tab.project ?? paneOf(primaryPaneKey(tab.root, paneOf))?.cwd
}

const isAbs = (p: unknown): p is string => typeof p === 'string' && (/^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\'))
const isWeb = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//i.test(u)

/** Keeps only what a pane of that kind needs; null when the stored entry is unusable. */
function viewFields(p: ViewFields): ViewFields | null {
  switch (p.kind) {
    case undefined:
    case 'term':
      return {}
    case 'browser':
      return p.url === undefined || p.url === '' || isWeb(p.url) || isAbs(p.url) ? { kind: 'browser', url: p.url ?? '' } : null
    case 'file':
      return isAbs(p.path) ? { kind: 'file', path: p.path, line: typeof p.line === 'number' && p.line > 0 ? Math.floor(p.line) : undefined } : null
    case 'changes':
      return { kind: 'changes' }
    case 'log':
      return { kind: 'log' }
    case 'run':
      return { kind: 'run' }
    default:
      return null
  }
}

function cleanPane<T extends ViewFields & { key: string; preset: unknown; cwd?: string }>(p: T): T | null {
  if (!p || typeof p.key !== 'string' || !isPtyPreset(p.preset)) return null
  const view = viewFields(p)
  if (!view) return null
  if ((view.kind === 'changes' || view.kind === 'log' || view.kind === 'run') && !isAbs(p.cwd)) return null
  return { ...p, kind: undefined, url: undefined, path: undefined, line: undefined, ...view }
}

function viewOf(p: ViewFields): ViewFields {
  return isTerm(p) ? {} : { kind: p.kind, url: p.url, path: p.path, line: p.line }
}

export interface LastWorkspace {
  at: string
  panes: LastPane[]
  tabs: Tab[]
}

export interface LastProject {
  key: string
  cwd?: string
  sessions: number
}

const projectKey = (cwd: string | undefined): string => cwd ?? ''

function lastTabProject(snap: LastWorkspace, tab: Tab): string | undefined {
  return tab.project ?? snap.panes.find((p) => p.key === leaves(tab.root)[0])?.cwd
}

export function lastProjectsOf(snap: LastWorkspace): LastProject[] {
  const byKey = new Map<string, LastProject>()
  const paneOf = new Map(snap.panes.map((p) => [p.key, p]))
  for (const tab of snap.tabs) {
    const cwd = lastTabProject(snap, tab)
    const key = projectKey(cwd)
    const entry = byKey.get(key) ?? { key, cwd, sessions: 0 }
    for (const k of leaves(tab.root)) {
      const p = paneOf.get(k)
      if (p && isTerm(p)) entry.sessions++
    }
    byKey.set(key, entry)
  }
  return [...byKey.values()]
}

function loadLast(): LastWorkspace | null {
  try {
    const raw = JSON.parse(readLocal(LAST_KEY) ?? 'null') as LastWorkspace | null
    if (!raw || !Array.isArray(raw.panes) || !Array.isArray(raw.tabs)) return null
    const panes = raw.panes.map(cleanPane).filter((p): p is LastPane => !!p)
    const known = new Set(panes.map((p) => p.key))
    const tabs = raw.tabs
      .filter((t) => t && isLayout(t.root) && leaves(t.root).every((k) => known.has(k)))
      .map((t) => {
        const zoom = zoomOf(t, t.root)
        return { key: String(t.key), root: t.root, focus: zoom ?? String(t.focus), project: isAbs(t.project) ? t.project : undefined, ...tabExtras(t), zoom }
      })
    return tabs.length ? { at: String(raw.at ?? ''), panes, tabs } : null
  } catch {
    return null
  }
}

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // storage blocked: preference just is not remembered
  }
}

function loadRecent(): string[] {
  try {
    const raw = JSON.parse(readLocal(RECENT_KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((d): d is string => typeof d === 'string').slice(0, RECENT_LIMIT) : []
  } catch {
    return []
  }
}

interface SavedPane extends ViewFields {
  key: string
  preset: PtyPreset
  cwd?: string
  /** Terms only. */
  sessionId?: string
  resume?: string
  agentSessionId?: string
  ranCommand?: boolean
  command?: string
  openedBy?: string
  parked?: boolean
}

interface Saved {
  panes: SavedPane[]
  tabs: Tab[]
  active: string | null
}

// Only ids survive a reload; a fresh app start has a new PTY host, so attach answers "gone" and the pane is dropped.
function loadSaved(): Saved {
  const empty: Saved = { panes: [], tabs: [], active: null }
  try {
    const raw = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Saved> | SavedPane[] | null
    if (!raw) return empty
    // P1 stored a bare pane list: one tab per pane.
    const list = Array.isArray(raw) ? raw : (raw.panes ?? [])
    const panes = list
      .map((p) => cleanPane(p))
      .filter((p): p is SavedPane => !!p && (!isTerm(p) || !!p.sessionId || p.parked === true))
      .map((p) => ({
        ...p,
        resume: agentId(p.resume),
        agentSessionId: agentId(p.agentSessionId),
        ranCommand: p.ranCommand === true || undefined,
        command: typeof p.command === 'string' ? p.command.slice(0, 300) : undefined,
        openedBy: typeof p.openedBy === 'string' && p.openedBy && p.openedBy !== p.key ? p.openedBy.slice(0, 64) : undefined,
        parked: isTerm(p) && !p.sessionId && p.parked === true ? true : undefined,
      }))
    const known = new Set(panes.map((p) => p.key))
    const rawTabs = Array.isArray(raw) ? panes.map((p) => ({ key: `t${p.key}`, root: { pane: p.key }, focus: p.key })) : (raw.tabs ?? [])
    const tabs: Tab[] = []
    for (const tab of rawTabs) {
      if (!tab || typeof tab.key !== 'string' || !isLayout(tab.root)) continue
      let root: LayoutNode | null = tab.root
      for (const key of leaves(tab.root)) if (!known.has(key)) root = root && removeLeaf(root, key)
      if (!root) continue
      const left = leaves(root)
      const zoom = zoomOf(tab as Partial<Tab>, root)
      tabs.push({
        key: tab.key,
        root,
        focus: zoom ?? (left.includes(tab.focus) ? tab.focus : left[0]!),
        project: isAbs((tab as Partial<Tab>).project) ? (tab as Tab).project : undefined,
        ...tabExtras(tab as Partial<Tab>),
        zoom,
      })
    }
    const placed = new Set(tabs.flatMap((t) => leaves(t.root)))
    return { panes: panes.filter((p) => placed.has(p.key)), tabs, active: Array.isArray(raw) ? null : (raw.active ?? null) }
  } catch {
    return empty
  }
}

const agentId = (v: unknown): string | undefined => (typeof v === 'string' && isAgentSessionId(v) ? v : undefined)

function baseOf(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

function fallbackName(p: Pane): string {
  if (p.kind === 'file') return baseOf(p.path ?? '') || 'file'
  if (p.kind === 'browser') return p.title || p.url || 'browser'
  return isTerm(p) ? p.preset : (p.kind ?? 'pane')
}

function closedPane(p: Pane, name: string): ClosedPane {
  const resume = isTerm(p) && p.preset !== 'shell' ? agentId(p.agentSessionId ?? p.resume) : undefined
  return { key: p.key, ...viewOf(p), preset: p.preset, cwd: resume ? p.cwd : workCwd(p), resume, name, ...(p.openedBy ? { openedBy: p.openedBy } : {}) }
}

export type InsertRequest = { id: number; paneKey: string; text: string; image?: undefined } | { id: number; paneKey: string; image: true; text?: undefined }

function dirOfPath(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i > 0 ? p.slice(0, i) : p
}

let seq = 0
const newKey = (prefix: string): string => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`

export const useWorkspaceStore = defineStore('workspace', () => {
  const saved = loadSaved()
  const panes = ref<Pane[]>(saved.panes.map(({ parked, ...p }) => ({ ...p, state: parked ? 'parked' : isTerm(p) ? 'starting' : 'running' })))
  const tabs = ref<Tab[]>(saved.tabs)
  const activeKey = ref<string | null>(panes.value.some((p) => p.key === saved.active) ? saved.active : (tabs.value[0]?.focus ?? null))

  const last = ref<LastWorkspace | null>(panes.value.length ? null : loadLast())
  const recentDirs = ref<string[]>(loadRecent())
  const storedPreset = readLocal(PRESET_KEY)
  const preset = ref<PtyPreset>(isPtyPreset(storedPreset) ? storedPreset : 'claude')
  watch(preset, (p) => writeLocal(PRESET_KEY, p))

  const tabOf = (paneKey: string): Tab | undefined => tabs.value.find((t) => leaves(t.root).includes(paneKey))
  const startTab = activeKey.value ? tabOf(activeKey.value) : undefined
  if (startTab?.zoom && startTab.zoom !== activeKey.value) startTab.zoom = undefined
  const active = computed(() => panes.value.find((p) => p.key === activeKey.value) ?? null)
  const activeTab = computed(() => (activeKey.value ? tabOf(activeKey.value) : undefined) ?? null)
  const paneByTerminal = computed(() => new Map(panes.value.filter((p) => p.terminalId).map((p) => [p.terminalId!, p])))
  const attentionPanes = computed(() => panes.value.filter((p) => p.attention))
  /** Panes waiting on a yes before they (and their agents) are killed. */
  const pendingClose = ref<string[] | null>(null)
  let pendingQuiet = false

  watch(
    [panes, tabs, activeKey],
    () => {
      const kept = panes.value.filter((p) => !isTerm(p) || p.state === 'parked' || (p.sessionId && p.state !== 'gone'))
      const data: Saved = {
        panes: kept.map((p) => ({
          key: p.key,
          preset: p.preset,
          cwd: p.cwd,
          sessionId: p.sessionId,
          resume: p.resume,
          agentSessionId: p.agentSessionId,
          ranCommand: p.ranCommand,
          command: p.command,
          openedBy: p.openedBy,
          parked: p.state === 'parked' || undefined,
          ...viewOf(p),
        })),
        tabs: tabs.value,
        active: activeKey.value,
      }
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data))
      } catch {
        // storage blocked: panes just will not survive a reload
      }
      // Never prompts or output: preset, folder and the agent session id to resume are all that is kept.
      if (!panes.value.length) return
      const snapshot: LastWorkspace = {
        at: new Date().toISOString(),
        panes: panes.value.map((p) => ({ key: p.key, preset: p.preset, cwd: p.cwd, resume: !isTerm(p) || p.preset === 'shell' ? undefined : (p.agentSessionId ?? p.resume), ...viewOf(p) })),
        tabs: tabs.value,
      }
      writeLocal(LAST_KEY, JSON.stringify(snapshot))
    },
    { deep: true },
  )

  type AgentOpen = Pick<Pane, 'openTicket' | 'prefill' | 'openedBy'>

  function addPane(preset: PtyPreset, cwd?: string, resume?: string, extra: AgentOpen = {}): Pane {
    const id = resume && preset !== 'shell' && isAgentSessionId(resume) ? resume : undefined
    const pane: Pane = { key: newKey('p'), preset, cwd, resume: id, agentSessionId: id, state: 'starting', ...extra }
    panes.value.push(pane)
    return pane
  }

  function addView(view: ViewFields, cwd?: string): Pane {
    panes.value.push({ key: newKey('p'), preset: 'shell', cwd, state: 'running', ...view })
    // The reactive proxy: later writes through it must reach watchers.
    return panes.value[panes.value.length - 1]!
  }

  function addSpec(spec: PaneSpec, cwd?: string): Pane {
    switch (spec.kind) {
      case 'term':
        return addPane(spec.preset, cwd)
      case 'browser':
        return addView({ kind: 'browser', url: spec.url }, cwd)
      case 'file':
        return addView({ kind: 'file', path: spec.path, line: spec.line }, cwd)
      case 'changes':
        return addView({ kind: 'changes' }, cwd)
      case 'log':
        return addView({ kind: 'log' }, cwd)
      case 'run':
        return addView({ kind: 'run' }, cwd)
    }
  }

  type Placement = { key: string; dir: SplitDir }

  const unzoom = (tab: Tab | undefined): void => {
    if (tab?.zoom) tab.zoom = undefined
  }

  function placeNew(pane: Pane, split?: Placement): void {
    const tab = split ? tabOf(split.key) : undefined
    if (tab && split) {
      tab.root = splitLeaf(tab.root, split.key, pane.key, split.dir)
      tab.focus = pane.key
      unzoom(tab)
    } else tabs.value.push({ key: newKey('t'), root: { pane: pane.key }, focus: pane.key, project: pane.cwd })
    activate(pane.key)
  }

  const sameDir = (a: string | undefined, b: string | undefined): boolean => !!a && !!b && dirKey(a) === dirKey(b)

  /** Reuses a browser pane already showing `url`; else a new tab (or a split next to `split.key`). */
  function openBrowser(url: string, opts: { cwd?: string; split?: Placement } = {}): Pane {
    const same = url ? panes.value.find((p) => p.kind === 'browser' && (p.url === url || (isAbs(url) && sameDir(p.url, url)))) : undefined
    if (same) {
      activate(same.key)
      return same
    }
    const pane = addView({ kind: 'browser', url }, opts.cwd)
    placeNew(pane, opts.split)
    return pane
  }

  /** One viewer per file: an open one jumps to `line` instead; every other file gets a viewer of its own. */
  function openFile(path: string, line?: number, opts: { cwd?: string; split?: Placement } = {}): Pane {
    const same = panes.value.find((p) => p.kind === 'file' && sameDir(p.path, path))
    if (same) {
      same.line = line
      activate(same.key)
      return same
    }
    const pane = addView({ kind: 'file', path, line }, opts.cwd ?? dirOfPath(path))
    placeNew(pane, opts.split)
    return pane
  }

  /** One Changes pane per repo (git toplevel once known, else the folder it was opened for); `select` = file to show. */
  function openChanges(cwd: string, opts: { split?: Placement; select?: string } = {}): Pane {
    const same = panes.value.find((p) => p.kind === 'changes' && (sameDir(p.root, cwd) || sameDir(p.cwd, cwd)))
    if (same) {
      if (opts.select) same.select = opts.select
      activate(same.key)
      return same
    }
    const pane = addView({ kind: 'changes' }, cwd)
    if (opts.select) pane.select = opts.select
    placeNew(pane, opts.split)
    return pane
  }

  /** One Log pane per repo, like Changes; `select` = commit hash to show. */
  function openLog(cwd: string, opts: { split?: Placement; select?: string } = {}): Pane {
    const same = panes.value.find((p) => p.kind === 'log' && (sameDir(p.root, cwd) || sameDir(p.cwd, cwd)))
    if (same) {
      if (opts.select) same.select = opts.select
      activate(same.key)
      return same
    }
    const pane = addView({ kind: 'log' }, cwd)
    if (opts.select) pane.select = opts.select
    placeNew(pane, opts.split)
    return pane
  }

  /** One Run pane per project root (`cwd`). */
  function openRun(cwd: string, opts: { split?: Placement } = {}): Pane {
    const same = panes.value.find((p) => p.kind === 'run' && sameDir(p.cwd, cwd))
    if (same) {
      activate(same.key)
      return same
    }
    const pane = addView({ kind: 'run' }, cwd)
    placeNew(pane, opts.split)
    return pane
  }

  /** Text or a clipboard image (^V) for an agent pane's input line; never followed by Enter. */
  const insertRequest = shallowRef<InsertRequest | null>(null)
  let insertSeq = 0
  function insertInto(paneKey: string, text: string): void {
    insertRequest.value = { id: ++insertSeq, paneKey, text }
    activate(paneKey)
  }
  function insertImage(paneKey: string): void {
    insertRequest.value = { id: ++insertSeq, paneKey, image: true }
    activate(paneKey)
  }

  const isAgentPane = (p: Pane): boolean => isTerm(p) && presetOf(p) !== 'shell' && (p.state === 'running' || p.state === 'starting')

  /**
   * Where a browser pane's "Send to agent" lands: a Claude/Codex pane in the same tab (linked to a monitor
   * session first, then most recently focused), else the most recently focused agent anywhere, else a picker.
   */
  function resolveAgentPane(browserKey: string): { pane: Pane } | { choices: Pane[] } {
    const byRecent = (a: Pane, b: Pane): number => (b.terminalId ? 1 : 0) - (a.terminalId ? 1 : 0) || (b.focusedAt ?? 0) - (a.focusedAt ?? 0)
    const tab = tabOf(browserKey)
    const local = tab ? leaves(tab.root).map((k) => panes.value.find((p) => p.key === k)).filter((p): p is Pane => !!p && isAgentPane(p)) : []
    if (local.length) return { pane: local.sort(byRecent)[0]! }
    const all = panes.value.filter(isAgentPane).sort((a, b) => (b.focusedAt ?? 0) - (a.focusedAt ?? 0))
    const recent = all.find((p) => p.focusedAt)
    return recent ? { pane: recent } : { choices: all }
  }

  /** Pane canvas in px, written by WorkspaceView: decides which side a new pane splits off. Not saved. */
  const canvasSize = ref({ w: 0, h: 0 })

  const paneOf = (k: string): Pane | undefined => panes.value.find((p) => p.key === k)
  const within = (dir: string, root: string): boolean => dirKey(dir) === dirKey(root) || dirKey(dir).startsWith(dirKey(root) + '\\')

  /** The tab working on `cwd`'s project: the active tab when it is one, else the one focused last. Home tabs match no folder. */
  function projectTab(cwd?: string): Tab | undefined {
    const matches = (t: Tab): boolean => {
      const project = tabProject(t, paneOf)
      return cwd ? !!project && within(cwd, project) : !project
    }
    if (activeTab.value && matches(activeTab.value)) return activeTab.value
    const lastFocus = (t: Tab): number => Math.max(0, ...leaves(t.root).map((k) => paneOf(k)?.focusedAt ?? 0))
    return tabs.value.filter(matches).sort((a, b) => lastFocus(b) - lastFocus(a))[0]
  }

  /**
   * A new terminal joins its project's tab beside the focused pane; a tab of its own only when the project has none,
   * no pane has room left, or `opts.tab` asks for one.
   */
  function open(preset: PtyPreset, cwd?: string, resume?: string, opts: { tab?: boolean } = {}): Pane {
    return joinProject(addPane(preset, cwd, resume), opts)
  }

  function joinProject(pane: Pane, opts: { tab?: boolean } = {}): Pane {
    const tab = opts.tab ? undefined : projectTab(pane.cwd)
    const spot = tab ? dockSpot(tab.root, tab.focus, canvasSize.value) : null
    if (tab && spot) {
      tab.root = splitLeaf(tab.root, spot.key, pane.key, spot.dir)
      tab.focus = pane.key
      unzoom(tab)
    } else tabs.value.push({ key: newKey('t'), root: { pane: pane.key }, focus: pane.key, project: pane.cwd })
    activate(pane.key)
    return pane
  }

  function openFromAgent(req: PaneOpenRequest, opts: { liveElsewhere?: (sessionId: string) => boolean } = {}): PaneOpenResult {
    if (!isPtyPreset(req.preset)) return { ok: false, error: 'preset' }
    if (typeof req.cwd !== 'string' || !req.cwd.trim()) return { ok: false, error: 'cwd' }
    const resume = req.resume === undefined || req.resume === '' ? undefined : req.preset !== 'shell' && isAgentSessionId(req.resume) ? req.resume : null
    if (resume === null) return { ok: false, error: 'resume' }
    if (resume) {
      const running = panes.value.find((p) => p.agentSessionId === resume && (p.state === 'running' || p.state === 'starting'))
      if (running) {
        activate(running.key)
        return { ok: true, paneKey: running.key }
      }
      if (opts.liveElsewhere?.(resume)) return { ok: false, error: 'live' }
    }
    const caller = typeof req.from === 'string' && req.from ? panes.value.find((p) => isTerm(p) && p.sessionId === req.from) : undefined
    const extra: AgentOpen = {
      openTicket: typeof req.id === 'string' && req.id ? req.id : undefined,
      prefill: req.preset === 'shell' ? undefined : cleanPanePrompt(req.prompt),
      ...(caller ? { openedBy: caller.key } : {}),
    }
    const callerTab = caller ? tabOf(caller.key) : undefined
    if (!caller || !callerTab) return { ok: true, paneKey: markOpened(joinProject(addPane(req.preset, req.cwd, resume, extra))).key }
    const pane = markOpened(addPane(req.preset, req.cwd, resume, extra))
    const size = canvasSize.value
    const spot = size.w && size.h ? dockSpot(callerTab.root, caller.key, size) : null
    if (spot) {
      callerTab.root = splitLeaf(callerTab.root, spot.key, pane.key, spot.dir)
      unzoom(callerTab)
    } else tabs.value.push({ key: newKey('t'), root: { pane: pane.key }, focus: pane.key, project: tabProject(callerTab, paneOf) ?? req.cwd })
    return { ok: true, paneKey: pane.key }
  }

  const freshOpened = new Map<string, number>()

  function markOpened(pane: Pane): Pane {
    if (pane.openedBy) freshOpened.set(pane.key, Date.now())
    return pane
  }

  const peers = usePeersStore()
  let openedSince = new Map<string, string>()
  const openedPairs = computed(() => {
    const out: Array<{ pane: string; id: string; a: string; b: string }> = []
    for (const p of panes.value) {
      if (!p.openedBy || !p.terminalId) continue
      const by = paneOf(p.openedBy)
      if (!by?.terminalId || by.terminalId === p.terminalId) continue
      const id = openedLinkId(by.terminalId, p.terminalId)
      if (!out.some((e) => e.id === id)) out.push({ pane: p.key, id, a: by.terminalId, b: p.terminalId })
    }
    return out
  })

  watch(
    () => openedPairs.value.map((e) => `${e.pane}:${e.id}`).join('|'),
    () => {
      const at = Date.now()
      const iso = new Date(at).toISOString()
      const since = new Map<string, string>()
      const entries = openedPairs.value.map((e) => {
        const first = openedSince.get(e.id) ?? iso
        since.set(e.id, first)
        const link: PeerLink = { id: e.id, kind: 'opened', a: e.a, b: e.b, ab: 1, ba: 0, firstAt: first, lastAt: first, lastDir: 'ab' }
        return { pane: e.pane, link }
      })
      openedSince = since
      const loud = new Set(entries.filter((e) => at - (freshOpened.get(e.pane) ?? -Infinity) < OPENED_NOTE_MS).map((e) => e.pane))
      for (const e of entries) freshOpened.delete(e.pane)
      for (const [key, t0] of freshOpened) if (at - t0 >= OPENED_NOTE_MS) freshOpened.delete(key)
      peers.setOpened(entries.filter((e) => !loud.has(e.pane)).map((e) => e.link), true)
      if (loud.size) peers.setOpened(entries.map((e) => e.link))
    },
    { immediate: true },
  )

  /** Same folder as the target, next to it; same agent unless one is picked (Windows Terminal's "duplicate" split). */
  function split(targetKey: string, dir: SplitDir, spec?: PaneSpec): Pane | null {
    const tab = tabOf(targetKey)
    const target = panes.value.find((p) => p.key === targetKey)
    if (!tab || !target) return null
    const pane = addSpec(spec ?? { kind: 'term', preset: isTerm(target) ? target.preset : preset.value }, workCwd(target))
    tab.root = splitLeaf(tab.root, targetKey, pane.key, dir)
    tab.focus = pane.key
    unzoom(tab)
    activate(pane.key)
    return pane
  }

  /** One pane per agent session: an already open one is focused instead of starting a second writer. */
  function resumeSession(preset: PtyPreset, cwd: string, sessionId: string): Pane {
    const open_ = panes.value.find((p) => p.agentSessionId === sessionId && (p.state === 'running' || p.state === 'starting'))
    if (open_) {
      activate(open_.key)
      return open_
    }
    return open(preset, cwd, sessionId)
  }

  /** New shell in `dir` that types `run` + Enter once its prompt is up: only ever from the user picking a script. */
  function runScript(dir: string | undefined, run: string, opts: { split?: Placement } = {}): Pane {
    addPane('shell', dir)
    const pane = panes.value[panes.value.length - 1]!
    pane.command = run
    pane.pendingCommand = run
    placeNew(pane, opts.split)
    return pane
  }

  /**
   * Adds a saved layout's tabs. Browser / file panes already open stay where they are (their leaf is dropped);
   * agents resume only when the layout stored session ids.
   */
  function openLayout(layout: Pick<SavedLayout, 'panes' | 'tabs'> & { project?: string }): number {
    let first: string | null = null
    let reused: string | null = null
    for (const tab of layout.tabs) {
      const keys = new Map<string, string>()
      let root: LayoutNode | null = tab.root
      for (const id of leaves(tab.root)) {
        const spec = layout.panes[id]
        const same =
          spec?.kind === 'browser' && spec.url
            ? panes.value.find((p) => p.kind === 'browser' && p.url === spec.url)
            : spec?.kind === 'file'
              ? panes.value.find((p) => p.kind === 'file' && sameDir(p.path, spec.path))
              : spec?.kind === 'run'
                ? panes.value.find((p) => p.kind === 'run' && sameDir(p.cwd, spec.cwd))
                : undefined
        if (!spec || same) {
          reused ??= same?.key ?? null
          root = root && removeLeaf(root, id)
          continue
        }
        const pane =
          spec.kind === 'term'
            ? addPane(spec.preset ?? 'shell', spec.cwd, spec.resume)
            : spec.kind === 'browser'
              ? addView({ kind: 'browser', url: spec.url ?? '' }, spec.cwd)
              : spec.kind === 'file'
                ? addView({ kind: 'file', path: spec.path, line: spec.line }, spec.cwd)
                : addView({ kind: spec.kind === 'log' || spec.kind === 'run' ? spec.kind : 'changes' }, spec.cwd)
        keys.set(id, pane.key)
      }
      if (!root) continue
      const remap = (n: LayoutNode): LayoutNode => ('pane' in n ? { pane: keys.get(n.pane)! } : { ...n, a: remap(n.a), b: remap(n.b) })
      const mapped = remap(root)
      const focus = (tab.focus && keys.get(tab.focus)) || leaves(mapped)[0]!
      tabs.value.push({ key: newKey('t'), root: mapped, focus, project: layout.project ?? panes.value.find((p) => p.key === leaves(mapped)[0])?.cwd })
      first ??= focus
    }
    const target = first ?? reused
    if (target) activate(target)
    return first ? tabs.value.length : 0
  }

  /** Last output / input per pane in this window: the sidebar's age when no monitor session is linked. Not persisted. */
  const lastSeen = ref<Record<string, number>>({})
  function touch(key: string, at = Date.now()): void {
    lastSeen.value[key] = at
  }

  const lastProjects = computed<LastProject[]>(() => (last.value ? lastProjectsOf(last.value) : []))

  function restoreLast(run?: ReadonlySet<string>): void {
    const snap = last.value
    last.value = null
    writeLocal(LAST_KEY, 'null')
    if (!snap) return
    const sleeping = new Set<string>()
    if (run) for (const tab of snap.tabs) if (!run.has(projectKey(lastTabProject(snap, tab)))) for (const k of leaves(tab.root)) sleeping.add(k)
    const keys = new Map<string, string>()
    for (const p of snap.panes) {
      if (!isTerm(p)) {
        keys.set(p.key, addView(viewOf(p), p.cwd).key)
        continue
      }
      const pane = addPane(p.preset, p.cwd, p.resume)
      if (sleeping.has(p.key)) update(pane.key, { state: 'parked' })
      keys.set(p.key, pane.key)
    }
    const remap = (n: LayoutNode): LayoutNode => ('pane' in n ? { pane: keys.get(n.pane)! } : { ...n, a: remap(n.a), b: remap(n.b) })
    for (const tab of snap.tabs) {
      const zoom = tab.zoom ? keys.get(tab.zoom) : undefined
      tabs.value.push({
        key: newKey('t'),
        root: remap(tab.root),
        focus: zoom ?? keys.get(tab.focus) ?? keys.get(leaves(tab.root)[0]!)!,
        project: tab.project ?? snap.panes.find((p) => p.key === leaves(tab.root)[0])?.cwd,
        ...tabExtras(tab),
        zoom,
      })
    }
    activeKey.value = tabs.value[0]?.focus ?? null
  }

  function wake(keys: readonly string[]): void {
    for (const key of keys) {
      const pane = panes.value.find((p) => p.key === key)
      if (pane?.state === 'parked') pane.state = 'starting'
    }
  }

  function dismissLast(): void {
    last.value = null
    writeLocal(LAST_KEY, 'null')
  }

  function update(key: string, patch: Partial<Pane>): void {
    const pane = panes.value.find((p) => p.key === key)
    if (pane) Object.assign(pane, patch)
  }

  function remove(key: string): void {
    const i = panes.value.findIndex((p) => p.key === key)
    if (i < 0) return
    panes.value.splice(i, 1)
    delete lastSeen.value[key]
    const t =tabs.value.findIndex((tab) => leaves(tab.root).includes(key))
    const tab = tabs.value[t]
    if (!tab) return
    unzoom(tab)
    const root = removeLeaf(tab.root, key)
    if (root) {
      tab.root = root
      if (tab.focus === key) tab.focus = leaves(root)[0]!
      if (activeKey.value === key) activeKey.value = tab.focus
      return
    }
    tabs.value.splice(t, 1)
    if (activeKey.value === key) activeKey.value = tabs.value[Math.min(t, tabs.value.length - 1)]?.focus ?? null
  }

  function closeTab(tabKey: string): void {
    const tab = tabs.value.find((t) => t.key === tabKey)
    if (tab) for (const key of leaves(tab.root)) remove(key)
  }

  function activate(key: string): void {
    const tab = tabOf(key)
    if (!tab) return
    if (tab.zoom !== key) unzoom(tab)
    tab.focus = key
    activeKey.value = key
    const pane = panes.value.find((p) => p.key === key)
    if (pane) pane.focusedAt = Date.now()
    if (pane?.attention) pane.attention = undefined
  }

  /** Waiting before done, oldest tab first. */
  function nextAttention(): Pane | null {
    const order = tabs.value.flatMap((t) => leaves(t.root))
    const pick = (kind: 'waiting' | 'done'): Pane | undefined =>
      order.map((k) => panes.value.find((p) => p.key === k)).find((p) => p?.attention === kind && p.key !== activeKey.value)
    const next = pick('waiting') ?? pick('done') ?? null
    if (next) activate(next.key)
    return next
  }

  /** Closes right away unless a pane still runs something worth asking about (`busy`). */
  function requestClose(keys: string[], busy: (pane: Pane) => boolean, opts: { record?: boolean } = {}): void {
    const list = keys.map((k) => panes.value.find((p) => p.key === k)).filter((p): p is Pane => !!p)
    if (list.some(busy)) {
      pendingClose.value = list.map((p) => p.key)
      pendingQuiet = opts.record === false
      return
    }
    if (opts.record !== false) recordClosed(list.map((p) => p.key))
    for (const p of list) remove(p.key)
  }

  function confirmClose(): void {
    const keys = pendingClose.value ?? []
    pendingClose.value = null
    if (!pendingQuiet) recordClosed(keys)
    pendingQuiet = false
    for (const k of keys) remove(k)
  }

  function cancelClose(): void {
    pendingClose.value = null
    pendingQuiet = false
  }

  const closedStack = shallowRef<ClosedEntry[]>([])
  let closedSeq = 0
  let closedNamer: ((pane: Pane) => string) | null = null

  function setClosedNamer(nameOf: ((pane: Pane) => string) | null): void {
    closedNamer = nameOf
  }

  function nameFor(pane: Pane, nameOf?: (pane: Pane) => string): string {
    try {
      return (nameOf ?? closedNamer ?? fallbackName)(pane) || fallbackName(pane)
    } catch {
      return fallbackName(pane)
    }
  }

  function recordClosed(keys: readonly string[], nameOf?: (pane: Pane) => string): ClosedEntry | null {
    const gone = new Set(keys.filter((k) => paneOf(k)))
    if (!gone.size) return null
    const entry: ClosedEntry = { id: ++closedSeq, at: Date.now(), tabs: [], loose: [] }
    const snap = (k: string): ClosedPane => {
      const pane = paneOf(k)!
      return closedPane(pane, nameFor(pane, nameOf))
    }
    tabs.value.forEach((tab, index) => {
      const all = leaves(tab.root)
      const mine = all.filter((k) => gone.has(k))
      if (!mine.length) return
      if (mine.length === all.length) {
        entry.tabs.push({ root: copyTree(tab.root), focus: tab.focus, name: tab.name, project: tab.project, index, panes: all.map(snap) })
        return
      }
      let root: LayoutNode | null = copyTree(tab.root)
      for (const k of mine) {
        entry.loose.push({ pane: snap(k), anchor: root && anchorOf(root, k), project: tab.project })
        root = root && removeLeaf(root, k)
      }
    })
    if (!entry.tabs.length && !entry.loose.length) return null
    closedStack.value = [...closedStack.value, entry].slice(-CLOSED_MAX)
    return entry
  }

  function placeBack(paneKey: string, anchor: ClosedAnchor, map: ReadonlyMap<string, string>): boolean {
    const group = anchor.group.map((k) => map.get(k) ?? k)
    const sibling = map.get(anchor.siblingKey) ?? anchor.siblingKey
    const host = tabOf(sibling) ?? group.map((k) => tabOf(k)).find((t): t is Tab => !!t)
    if (!host) return false
    const leaf: LayoutNode = { pane: paneKey }
    const wrap = (n: LayoutNode): LayoutNode => ({ dir: anchor.dir, ratio: anchor.ratio, a: anchor.side === 'a' ? leaf : n, b: anchor.side === 'a' ? n : leaf })
    const exact = wrapGroup(host.root, new Set(group), wrap)
    if (exact) host.root = exact
    else {
      const at = [sibling, ...group].find((k) => tabOf(k) === host)!
      const edge: Edge = anchor.dir === 'row' ? (anchor.side === 'a' ? 'left' : 'right') : anchor.side === 'a' ? 'top' : 'bottom'
      host.root = dockTree(host.root, at, leaf, edge)
    }
    host.focus = paneKey
    unzoom(host)
    return true
  }

  function reopenClosed(): { keys: string[]; from: string[] } | null {
    const entry = closedStack.value.at(-1)
    if (!entry) return null
    closedStack.value = closedStack.value.slice(0, -1)
    const map = new Map<string, string>()
    const from: string[] = []
    const make = (c: ClosedPane): Pane | null => {
      if (c.resume && panes.value.some((p) => p.agentSessionId === c.resume && (p.state === 'running' || p.state === 'starting'))) return null
      const pane = isTerm(c) ? addPane(c.preset, c.cwd, c.resume, c.openedBy ? { openedBy: c.openedBy } : {}) : addView(viewOf(c), c.cwd)
      map.set(c.key, pane.key)
      from.push(c.key)
      return pane
    }
    let focus: string | undefined
    for (const tab of entry.tabs) {
      for (const c of tab.panes) make(c)
      let root: LayoutNode | null = tab.root
      for (const k of leaves(tab.root)) if (!map.has(k)) root = root && removeLeaf(root, k)
      if (!root) continue
      const mapped = remapTree(root, map)
      const first = map.get(tab.focus) ?? leaves(mapped)[0]!
      tabs.value.splice(Math.min(tab.index, tabs.value.length), 0, { key: newKey('t'), root: mapped, focus: first, project: tab.project, name: tab.name })
      focus ??= first
    }
    for (const item of [...entry.loose].reverse()) {
      const pane = make(item.pane)
      if (!pane) continue
      if (!item.anchor || !placeBack(pane.key, item.anchor, map))
        tabs.value.push({ key: newKey('t'), root: { pane: pane.key }, focus: pane.key, project: item.project ?? pane.cwd })
      focus = pane.key
    }
    for (const p of panes.value) if (p.openedBy && map.has(p.openedBy)) p.openedBy = map.get(p.openedBy)
    if (focus) activate(focus)
    return { keys: from.map((k) => map.get(k)!), from }
  }

  function toggleZoom(paneKey: string): boolean {
    const tab = tabOf(paneKey)
    if (!tab) return false
    if (tab.zoom === paneKey || leaves(tab.root).length < 2) {
      unzoom(tab)
      return false
    }
    activate(paneKey)
    tab.zoom = paneKey
    return true
  }

  function clearZoom(tabKey: string): void {
    unzoom(tabs.value.find((t) => t.key === tabKey))
  }

  function setDirty(key: string, dirty: boolean): void {
    const pane = panes.value.find((p) => p.key === key)
    if (!pane || !!pane.dirty === dirty) return
    pane.dirty = dirty || undefined
  }

  /** Each mounted editor registers how to save its buffer; the close sheet and quit call them. Not reactive. */
  const savers = new Map<string, () => Promise<SaveOutcome>>()
  function registerSaver(key: string, save: (() => Promise<SaveOutcome>) | null): void {
    if (save) savers.set(key, save)
    else savers.delete(key)
  }
  const dirtyPanes = computed(() => panes.value.filter((p) => p.kind === 'file' && p.dirty))

  /** Saves the dirty panes among `keys` one by one; failures name the pane and the error key. */
  async function saveFiles(keys: readonly string[]): Promise<Array<{ key: string; error: string }>> {
    const failed: Array<{ key: string; error: string }> = []
    for (const key of keys) {
      const pane = panes.value.find((p) => p.key === key)
      if (!pane?.dirty) continue
      const save = savers.get(key)
      const res = save ? await save().catch((): SaveOutcome => ({ ok: false, error: 'failed' })) : { ok: false as const, error: 'unavailable' }
      if (!res.ok) failed.push({ key, error: res.error })
    }
    return failed
  }

  function activateTab(tabKey: string): void {
    const tab = tabs.value.find((t) => t.key === tabKey)
    if (tab) activeKey.value = tab.focus
  }

  /** Next / previous tab; `scope` (tab keys in display order) limits it to the tabs on screen. */
  function cycleTab(step: number, scope?: readonly string[]): void {
    const keys = scope?.length ? scope : tabs.value.map((t) => t.key)
    const n = keys.length
    if (!n) return
    const at = keys.indexOf(activeTab.value?.key ?? '')
    activateTab(keys[at < 0 ? (step > 0 ? 0 : n - 1) : (((at + step) % n) + n) % n]!)
  }

  function moveFocus(dir: FocusDir): void {
    const tab = activeTab.value
    if (!tab || !activeKey.value) return
    const next = neighbor(tab.root, activeKey.value, dir)
    if (next) activate(next)
  }

  /** Pulls a pane out of its tab (a tab left empty goes away); false when it was not in one. */
  function unplace(key: string): boolean {
    const i = tabs.value.findIndex((t) => leaves(t.root).includes(key))
    const tab = tabs.value[i]
    if (!tab) return false
    unzoom(tab)
    const root = removeLeaf(tab.root, key)
    if (!root) tabs.value.splice(i, 1)
    else {
      tab.root = root
      if (tab.focus === key) tab.focus = leaves(root)[0]!
    }
    return true
  }

  /** Docks `src` onto `edge` of `target`, from the same tab or from another one. */
  function movePane(src: string, target: string, edge: Edge): void {
    const to = tabOf(target)
    const from = tabOf(src)
    if (!to || !from || src === target) return
    unzoom(from)
    unzoom(to)
    if (from === to) to.root = moveLeaf(to.root, src, target, edge)
    else {
      unplace(src)
      to.root = dockTree(to.root, target, { pane: src }, edge)
    }
    activate(src)
  }

  /** Two panes of one tab trade places. */
  function swapPanes(a: string, b: string): void {
    const tab = tabOf(a)
    if (!tab || tab !== tabOf(b)) return
    unzoom(tab)
    tab.root = swapLeaves(tab.root, a, b)
    activate(a)
  }

  /** Every pane of tab `tabKey` docks as one block onto `edge` of `target`; the target tab keeps its project. */
  function mergeTab(tabKey: string, target: string, edge: Edge): void {
    const i = tabs.value.findIndex((t) => t.key === tabKey)
    const src = tabs.value[i]
    const to = tabOf(target)
    if (!src || !to || src === to) return
    unzoom(to)
    to.root = dockTree(to.root, target, src.root, edge)
    tabs.value.splice(i, 1)
    activate(src.focus)
  }

  /** A pane of a split tab gets a tab of its own, right after the one it left. */
  function detachPane(key: string): void {
    const from = tabOf(key)
    const pane = panes.value.find((p) => p.key === key)
    if (!from || !pane || leaves(from.root).length < 2) return
    unplace(key)
    const at = tabs.value.indexOf(from)
    tabs.value.splice(at + 1, 0, { key: newKey('t'), root: { pane: key }, focus: key, project: from.project ?? pane.cwd })
    activate(key)
  }

  function renameTab(tabKey: string, name: string): void {
    const tab = tabs.value.find((t) => t.key === tabKey)
    if (tab) tab.name = cleanTabName(name)
  }

  function moveTab(tabKey: string, to: number): void {
    const from = tabs.value.findIndex((t) => t.key === tabKey)
    if (from < 0) return
    const at = Math.max(0, Math.min(to, tabs.value.length - 1))
    if (at === from) return
    const [tab] = tabs.value.splice(from, 1)
    tabs.value.splice(at, 0, tab!)
  }

  function setFolded(tabKey: string, folded: boolean): void {
    const tab = tabs.value.find((t) => t.key === tabKey)
    if (tab) tab.folded = folded || undefined
  }

  function ungroup(tabKey: string): void {
    const tab = tabs.value.find((t) => t.key === tabKey)
    if (!tab) return
    unzoom(tab)
    const keep = activeKey.value
    for (const key of leaves(tab.root).slice(1).reverse()) detachPane(key)
    if (keep) activate(keep)
  }

  function movePaneToTab(paneKey: string, tabKey: string): void {
    const target = tabs.value.find((t) => t.key === tabKey)
    if (!target || tabOf(paneKey) === target) return
    const spot = dockSpot(target.root, target.focus, canvasSize.value)
    movePane(paneKey, spot?.key ?? target.focus, spot?.dir === 'col' ? 'bottom' : 'right')
  }

  /** The focused pane trades places with its neighbour on that side and keeps focus. */
  function swapWith(dir: FocusDir): void {
    const tab = activeTab.value
    const key = activeKey.value
    const next = tab && key ? neighbor(tab.root, key, dir) : null
    if (key && next) swapPanes(key, next)
  }

  function setRatio(tabKey: string, path: string, ratio: number): void {
    const tab = tabs.value.find((t) => t.key === tabKey)
    if (tab) tab.root = setTreeRatio(tab.root, path, ratio)
  }

  function remember(dir: string): void {
    const key = dirKey(dir)
    recentDirs.value = [dir, ...recentDirs.value.filter((d) => dirKey(d) !== key)].slice(0, RECENT_LIMIT)
    writeLocal(RECENT_KEY, JSON.stringify(recentDirs.value))
  }

  function forget(dir: string): void {
    const key = dirKey(dir)
    recentDirs.value = recentDirs.value.filter((d) => dirKey(d) !== key)
    writeLocal(RECENT_KEY, JSON.stringify(recentDirs.value))
  }

  return {
    panes,
    tabs,
    canvasSize,
    activeKey,
    active,
    activeTab,
    paneByTerminal,
    recentDirs,
    preset,
    last,
    attentionPanes,
    pendingClose,
    tabOf,
    open,
    openFromAgent,
    openBrowser,
    openFile,
    openChanges,
    openLog,
    openRun,
    insertRequest,
    insertInto,
    insertImage,
    resolveAgentPane,
    nextAttention,
    requestClose,
    confirmClose,
    cancelClose,
    closedStack,
    setClosedNamer,
    recordClosed,
    reopenClosed,
    toggleZoom,
    clearZoom,
    setDirty,
    registerSaver,
    dirtyPanes,
    saveFiles,
    resumeSession,
    restoreLast,
    lastProjects,
    wake,
    dismissLast,
    runScript,
    openLayout,
    lastSeen,
    touch,
    split,
    update,
    remove,
    closeTab,
    activate,
    activateTab,
    cycleTab,
    moveFocus,
    movePane,
    swapPanes,
    swapWith,
    mergeTab,
    detachPane,
    renameTab,
    moveTab,
    setFolded,
    ungroup,
    movePaneToTab,
    setRatio,
    remember,
    forget,
  }
})
