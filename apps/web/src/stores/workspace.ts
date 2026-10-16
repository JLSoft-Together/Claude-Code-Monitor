import { defineStore } from 'pinia'
import { computed, ref, shallowRef, watch } from 'vue'
import { cleanPanePrompt, isAgentSessionId, isPtyPreset, type PaneOpenRequest, type PaneOpenResult, type PtyPreset } from '@ccm/shared'
import {
  dockSpot,
  dockTree,
  isLayout,
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

export type PaneState = 'starting' | 'running' | 'exited' | 'gone' | 'error'

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
  /** File viewer opened by a single click in the Explorer: the next single click replaces it. Runtime only. */
  preview?: boolean
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

function loadLast(): LastWorkspace | null {
  try {
    const raw = JSON.parse(readLocal(LAST_KEY) ?? 'null') as LastWorkspace | null
    if (!raw || !Array.isArray(raw.panes) || !Array.isArray(raw.tabs)) return null
    const panes = raw.panes.map(cleanPane).filter((p): p is LastPane => !!p)
    const known = new Set(panes.map((p) => p.key))
    const tabs = raw.tabs
      .filter((t) => t && isLayout(t.root) && leaves(t.root).every((k) => known.has(k)))
      .map((t) => ({ key: String(t.key), root: t.root, focus: String(t.focus), project: isAbs(t.project) ? t.project : undefined }))
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
      .filter((p): p is SavedPane => !!p && (!isTerm(p) || !!p.sessionId))
      .map((p) => ({ ...p, resume: agentId(p.resume), agentSessionId: agentId(p.agentSessionId), ranCommand: p.ranCommand === true || undefined, command: typeof p.command === 'string' ? p.command.slice(0, 300) : undefined }))
    const known = new Set(panes.map((p) => p.key))
    const rawTabs = Array.isArray(raw) ? panes.map((p) => ({ key: `t${p.key}`, root: { pane: p.key }, focus: p.key })) : (raw.tabs ?? [])
    const tabs: Tab[] = []
    for (const tab of rawTabs) {
      if (!tab || typeof tab.key !== 'string' || !isLayout(tab.root)) continue
      let root: LayoutNode | null = tab.root
      for (const key of leaves(tab.root)) if (!known.has(key)) root = root && removeLeaf(root, key)
      if (!root) continue
      const left = leaves(root)
      tabs.push({ key: tab.key, root, focus: left.includes(tab.focus) ? tab.focus : left[0]!, project: isAbs((tab as Partial<Tab>).project) ? (tab as Tab).project : undefined })
    }
    const placed = new Set(tabs.flatMap((t) => leaves(t.root)))
    return { panes: panes.filter((p) => placed.has(p.key)), tabs, active: Array.isArray(raw) ? null : (raw.active ?? null) }
  } catch {
    return empty
  }
}

const agentId = (v: unknown): string | undefined => (typeof v === 'string' && isAgentSessionId(v) ? v : undefined)

export type InsertRequest = { id: number; paneKey: string; text: string; image?: undefined } | { id: number; paneKey: string; image: true; text?: undefined }

function dirOfPath(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i > 0 ? p.slice(0, i) : p
}

let seq = 0
const newKey = (prefix: string): string => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`

export const useWorkspaceStore = defineStore('workspace', () => {
  const saved = loadSaved()
  const panes = ref<Pane[]>(saved.panes.map((p) => ({ ...p, state: isTerm(p) ? 'starting' : 'running' })))
  const tabs = ref<Tab[]>(saved.tabs)
  const activeKey = ref<string | null>(panes.value.some((p) => p.key === saved.active) ? saved.active : (tabs.value[0]?.focus ?? null))

  const last = ref<LastWorkspace | null>(panes.value.length ? null : loadLast())
  const recentDirs = ref<string[]>(loadRecent())
  const storedPreset = readLocal(PRESET_KEY)
  const preset = ref<PtyPreset>(isPtyPreset(storedPreset) ? storedPreset : 'claude')
  watch(preset, (p) => writeLocal(PRESET_KEY, p))

  const tabOf = (paneKey: string): Tab | undefined => tabs.value.find((t) => leaves(t.root).includes(paneKey))
  const active = computed(() => panes.value.find((p) => p.key === activeKey.value) ?? null)
  const activeTab = computed(() => (activeKey.value ? tabOf(activeKey.value) : undefined) ?? null)
  const paneByTerminal = computed(() => new Map(panes.value.filter((p) => p.terminalId).map((p) => [p.terminalId!, p])))
  const attentionPanes = computed(() => panes.value.filter((p) => p.attention))
  /** Panes waiting on a yes before they (and their agents) are killed. */
  const pendingClose = ref<string[] | null>(null)

  watch(
    [panes, tabs, activeKey],
    () => {
      const kept = panes.value.filter((p) => !isTerm(p) || (p.sessionId && p.state !== 'gone'))
      const data: Saved = {
        panes: kept.map((p) => ({ key: p.key, preset: p.preset, cwd: p.cwd, sessionId: p.sessionId, resume: p.resume, agentSessionId: p.agentSessionId, ranCommand: p.ranCommand, command: p.command, ...viewOf(p) })),
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

  type AgentOpen = Pick<Pane, 'openTicket' | 'prefill'>

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

  function placeNew(pane: Pane, split?: Placement): void {
    const tab = split ? tabOf(split.key) : undefined
    if (tab && split) {
      tab.root = splitLeaf(tab.root, split.key, pane.key, split.dir)
      tab.focus = pane.key
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

  /**
   * One viewer per file: an open one jumps to `line` instead. `preview: true` (Explorer single click) reuses the
   * window's preview viewer in place; `preview: false` (double click) keeps the viewer. Unset = a kept viewer.
   */
  function openFile(path: string, line?: number, opts: { cwd?: string; split?: Placement; preview?: boolean } = {}): Pane {
    const same = panes.value.find((p) => p.kind === 'file' && sameDir(p.path, path))
    if (same) {
      same.line = line
      if (opts.preview === false) same.preview = undefined
      activate(same.key)
      return same
    }
    // One preview slot per project: previewing in project B must not take over project A's tab.
    const slot = opts.preview ? panes.value.find((p) => p.kind === 'file' && p.preview && !p.dirty && (!opts.cwd || sameDir(p.cwd, opts.cwd))) : undefined
    if (slot) {
      slot.path = path
      slot.line = line
      slot.cwd = opts.cwd ?? dirOfPath(path)
      activate(slot.key)
      return slot
    }
    const pane = addView({ kind: 'file', path, line }, opts.cwd ?? dirOfPath(path))
    if (opts.preview) pane.preview = true
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

  const isAgentPane = (p: Pane): boolean => isTerm(p) && p.preset !== 'shell' && (p.state === 'running' || p.state === 'starting')

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
    const extra: AgentOpen = {
      openTicket: typeof req.id === 'string' && req.id ? req.id : undefined,
      prefill: req.preset === 'shell' ? undefined : cleanPanePrompt(req.prompt),
    }
    const caller = typeof req.from === 'string' && req.from ? panes.value.find((p) => isTerm(p) && p.sessionId === req.from) : undefined
    const callerTab = caller ? tabOf(caller.key) : undefined
    if (!caller || !callerTab) return { ok: true, paneKey: joinProject(addPane(req.preset, req.cwd, resume, extra)).key }
    const pane = addPane(req.preset, req.cwd, resume, extra)
    const size = canvasSize.value
    const spot = size.w && size.h ? dockSpot(callerTab.root, caller.key, size) : null
    if (spot) {
      callerTab.root = splitLeaf(callerTab.root, spot.key, pane.key, spot.dir)
    } else tabs.value.push({ key: newKey('t'), root: { pane: pane.key }, focus: pane.key, project: tabProject(callerTab, paneOf) ?? req.cwd })
    return { ok: true, paneKey: pane.key }
  }

  /** Same folder as the target, next to it; same agent unless one is picked (Windows Terminal's "duplicate" split). */
  function split(targetKey: string, dir: SplitDir, spec?: PaneSpec): Pane | null {
    const tab = tabOf(targetKey)
    const target = panes.value.find((p) => p.key === targetKey)
    if (!tab || !target) return null
    const pane = addSpec(spec ?? { kind: 'term', preset: isTerm(target) ? target.preset : preset.value }, workCwd(target))
    tab.root = splitLeaf(tab.root, targetKey, pane.key, dir)
    tab.focus = pane.key
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

  function restoreLast(): void {
    const snap = last.value
    last.value = null
    writeLocal(LAST_KEY, 'null')
    if (!snap) return
    const keys = new Map<string, string>()
    for (const p of snap.panes) keys.set(p.key, (isTerm(p) ? addPane(p.preset, p.cwd, p.resume) : addView(viewOf(p), p.cwd)).key)
    const remap = (n: LayoutNode): LayoutNode => ('pane' in n ? { pane: keys.get(n.pane)! } : { ...n, a: remap(n.a), b: remap(n.b) })
    for (const tab of snap.tabs)
      tabs.value.push({
        key: newKey('t'),
        root: remap(tab.root),
        focus: keys.get(tab.focus) ?? keys.get(leaves(tab.root)[0]!)!,
        project: tab.project ?? snap.panes.find((p) => p.key === leaves(tab.root)[0])?.cwd,
      })
    activeKey.value = tabs.value[0]?.focus ?? null
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
  function requestClose(keys: string[], busy: (pane: Pane) => boolean): void {
    const list = keys.map((k) => panes.value.find((p) => p.key === k)).filter((p): p is Pane => !!p)
    if (list.some(busy)) pendingClose.value = list.map((p) => p.key)
    else for (const p of list) remove(p.key)
  }

  function confirmClose(): void {
    const keys = pendingClose.value ?? []
    pendingClose.value = null
    for (const k of keys) remove(k)
  }

  function cancelClose(): void {
    pendingClose.value = null
  }

  /** v42: an edited file pane stops being the Explorer preview slot (a single click must not replace it). */
  function setDirty(key: string, dirty: boolean): void {
    const pane = panes.value.find((p) => p.key === key)
    if (!pane || !!pane.dirty === dirty) return
    pane.dirty = dirty || undefined
    if (dirty) pane.preview = undefined
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
    tab.root = swapLeaves(tab.root, a, b)
    activate(a)
  }

  /** Every pane of tab `tabKey` docks as one block onto `edge` of `target`; the target tab keeps its project. */
  function mergeTab(tabKey: string, target: string, edge: Edge): void {
    const i = tabs.value.findIndex((t) => t.key === tabKey)
    const src = tabs.value[i]
    const to = tabOf(target)
    if (!src || !to || src === to) return
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
    setDirty,
    registerSaver,
    dirtyPanes,
    saveFiles,
    resumeSession,
    restoreLast,
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
    setRatio,
    remember,
    forget,
  }
})
