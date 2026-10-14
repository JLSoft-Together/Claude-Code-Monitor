import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { isAgentSessionId, isPtyPreset, type PtyPreset } from '@ccm/shared'
import { isLayout, leaves, neighbor, removeLeaf, setRatio as setTreeRatio, splitLeaf, type FocusDir, type LayoutNode, type SplitDir } from '../lib/splitLayout'
import { dirKey } from './favorites'

export type PaneState = 'starting' | 'running' | 'exited' | 'gone' | 'error'

export interface Pane {
  key: string
  preset: PtyPreset
  cwd?: string
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
  state: PaneState
  exitCode?: number
  error?: string
}

export interface Tab {
  key: string
  root: LayoutNode
  /** Pane that gets focus when the tab is selected. */
  focus: string
}

const STORAGE_KEY = 'ccm.workspace.panes'
const RECENT_KEY = 'ccm.workspace.recent'
const PRESET_KEY = 'ccm.workspace.preset'
const RECENT_LIMIT = 8
// Survives app restarts (unlike the per-window session state): what "Restore previous workspace" rebuilds.
const LAST_KEY = 'ccm.workspace.last'

interface LastPane {
  key: string
  preset: PtyPreset
  cwd?: string
  resume?: string
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
    const panes = raw.panes.filter((p) => p && typeof p.key === 'string' && isPtyPreset(p.preset))
    const known = new Set(panes.map((p) => p.key))
    const tabs = raw.tabs.filter((t) => t && isLayout(t.root) && leaves(t.root).every((k) => known.has(k)))
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

interface SavedPane {
  key: string
  preset: PtyPreset
  cwd?: string
  sessionId: string
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
    const panes = list.filter((p) => p && typeof p.key === 'string' && p.sessionId && isPtyPreset(p.preset))
    const known = new Set(panes.map((p) => p.key))
    const rawTabs = Array.isArray(raw) ? panes.map((p) => ({ key: `t${p.key}`, root: { pane: p.key }, focus: p.key })) : (raw.tabs ?? [])
    const tabs: Tab[] = []
    for (const tab of rawTabs) {
      if (!tab || typeof tab.key !== 'string' || !isLayout(tab.root)) continue
      let root: LayoutNode | null = tab.root
      for (const key of leaves(tab.root)) if (!known.has(key)) root = root && removeLeaf(root, key)
      if (!root) continue
      const left = leaves(root)
      tabs.push({ key: tab.key, root, focus: left.includes(tab.focus) ? tab.focus : left[0]! })
    }
    const placed = new Set(tabs.flatMap((t) => leaves(t.root)))
    return { panes: panes.filter((p) => placed.has(p.key)), tabs, active: Array.isArray(raw) ? null : (raw.active ?? null) }
  } catch {
    return empty
  }
}

let seq = 0
const newKey = (prefix: string): string => `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`

export const useWorkspaceStore = defineStore('workspace', () => {
  const saved = loadSaved()
  const panes = ref<Pane[]>(saved.panes.map((p) => ({ ...p, state: 'starting' })))
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
  const liveCount = computed(() => panes.value.filter((p) => p.state === 'running' || p.state === 'starting').length)

  watch(
    [panes, tabs, activeKey],
    () => {
      const kept = panes.value.filter((p) => p.sessionId && p.state !== 'gone')
      const data: Saved = {
        panes: kept.map((p) => ({ key: p.key, preset: p.preset, cwd: p.cwd, sessionId: p.sessionId! })),
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
        panes: panes.value.map((p) => ({ key: p.key, preset: p.preset, cwd: p.cwd, resume: p.preset === 'shell' ? undefined : (p.agentSessionId ?? p.resume) })),
        tabs: tabs.value,
      }
      writeLocal(LAST_KEY, JSON.stringify(snapshot))
    },
    { deep: true },
  )

  function addPane(preset: PtyPreset, cwd?: string, resume?: string): Pane {
    const id = resume && preset !== 'shell' && isAgentSessionId(resume) ? resume : undefined
    const pane: Pane = { key: newKey('p'), preset, cwd, resume: id, agentSessionId: id, state: 'starting' }
    panes.value.push(pane)
    return pane
  }

  /** New tab holding one new pane. */
  function open(preset: PtyPreset, cwd?: string, resume?: string): Pane {
    const pane = addPane(preset, cwd, resume)
    tabs.value.push({ key: newKey('t'), root: { pane: pane.key }, focus: pane.key })
    activeKey.value = pane.key
    return pane
  }

  /** Same folder as the target, next to it; same agent unless one is picked (Windows Terminal's "duplicate" split). */
  function split(targetKey: string, dir: SplitDir, preset?: PtyPreset): Pane | null {
    const tab = tabOf(targetKey)
    const target = panes.value.find((p) => p.key === targetKey)
    if (!tab || !target) return null
    const pane = addPane(preset ?? target.preset, target.cwd)
    tab.root = splitLeaf(tab.root, targetKey, pane.key, dir)
    tab.focus = pane.key
    activeKey.value = pane.key
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

  function restoreLast(): void {
    const snap = last.value
    last.value = null
    writeLocal(LAST_KEY, 'null')
    if (!snap) return
    const keys = new Map<string, string>()
    for (const p of snap.panes) keys.set(p.key, addPane(p.preset, p.cwd, p.resume).key)
    const remap = (n: LayoutNode): LayoutNode => ('pane' in n ? { pane: keys.get(n.pane)! } : { ...n, a: remap(n.a), b: remap(n.b) })
    for (const tab of snap.tabs) tabs.value.push({ key: newKey('t'), root: remap(tab.root), focus: keys.get(tab.focus) ?? keys.get(leaves(tab.root)[0]!)! })
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
    const t = tabs.value.findIndex((tab) => leaves(tab.root).includes(key))
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

  function activateTab(tabKey: string): void {
    const tab = tabs.value.find((t) => t.key === tabKey)
    if (tab) activeKey.value = tab.focus
  }

  function cycleTab(step: number): void {
    const n = tabs.value.length
    if (!n) return
    const at = tabs.value.findIndex((t) => t === activeTab.value)
    activateTab(tabs.value[(at + step + n) % n]!.key)
  }

  function moveFocus(dir: FocusDir): void {
    const tab = activeTab.value
    if (!tab || !activeKey.value) return
    const next = neighbor(tab.root, activeKey.value, dir)
    if (next) activate(next)
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
    activeKey,
    active,
    activeTab,
    paneByTerminal,
    liveCount,
    recentDirs,
    preset,
    last,
    attentionPanes,
    pendingClose,
    tabOf,
    open,
    nextAttention,
    requestClose,
    confirmClose,
    cancelClose,
    resumeSession,
    restoreLast,
    dismissLast,
    split,
    update,
    remove,
    closeTab,
    activate,
    activateTab,
    cycleTab,
    moveFocus,
    setRatio,
    remember,
    forget,
  }
})
