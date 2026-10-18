import type { PtyPreset, TerminalStatus } from '@ccm/shared'
import { dirKey } from '../../stores/favorites'
import { isTerm, presetOf, primaryPaneKey, tabProject, tabTitle, workCwd, type Pane, type Tab } from '../../stores/workspace'
import type { RunBadge } from '../runUi'
import { folderName, projectOf } from '../sidebarRows'
import { leaves } from '../splitLayout'
import { applyOrder } from './railOrder'
import type { RepoFacts } from './repo'

export type RailState = 'failed' | 'asked' | 'ended' | 'working' | 'subagents' | 'done' | 'starting' | 'idle'
export const needsUser = (s: RailState): boolean => s === 'asked' || s === 'failed'
export const isBusyState = (s: RailState): boolean => s === 'working' || s === 'subagents'

export interface RailSession {
  status: TerminalStatus
  /** `displayTitle`: alias, else Claude's own session name. Never prompt text. */
  title: string
  branch?: string
  /** ISO time of the last status change. */
  since?: string
  subagents: number
}

export interface RailPeer {
  dir: 'out' | 'in' | 'both'
  kind: 'message' | 'opened'
  other: string | null
  name: string
  inside: boolean
  peers: number
  n: number
  at: number
  until: number
}

export const isPeerNews = (p: Pick<RailPeer, 'dir' | 'kind'> | null | undefined): boolean => !!p && p.kind === 'message' && p.dir !== 'out'

export type PeerSlot = 'line' | 'badge' | null

export function peerSlot(state: RailState | null | undefined, peer: unknown): PeerSlot {
  if (!peer) return null
  return state && needsUser(state) ? 'badge' : 'line'
}

export interface RailRow {
  /** Pane key for agent / run rows, `tab:<key>` for a tab without either. */
  key: string
  paneKey: string
  tabKey: string
  kind: 'agent' | 'shell' | 'other'
  /** Drawn by `PaneIcon`. */
  pane: Pane
  preset: PtyPreset
  /** Agent product name, or the row label for `other` rows. */
  agent: string
  task: string | null
  /** Agent name made unique within the checkout: `Claude`, `Claude 2`. */
  ordinal: string
  state: RailState
  subagents: number
  /** Run pane: its project's run badge (Building / Running / Run failed). */
  run: RunBadge | null
  since: number
  focused: boolean
  tabActive: boolean
  group: string | null
  twin?: string
  peer?: RailPeer
}

export interface RailGroup {
  key: string
  tabKey: string
  title: string
  named: boolean
  count: number
  state: RailState
  subagents: number
  folded: boolean
  tabActive: boolean
  focused: boolean
  paneKeys: string[]
  lead: string | null
  peer?: RailPeer
}

export type RailItem = { kind: 'group'; key: string; group: RailGroup } | { kind: 'row'; key: string; row: RailRow; group: RailGroup | null }

export interface RailCheckout {
  key: string
  path: string | null
  branch: string | null
  tag: 'worktree' | 'folder' | null
  primary: boolean
  active: boolean
  rows: RailRow[]
  groups: RailGroup[]
}

export interface RailCluster {
  /** Order key: `repo:<common dir>`, `plain:<folder>` or `home`. */
  key: string
  /** Other keys this cluster answered to (provisional plain keys): stored order matches them too. */
  aliases: string[]
  name: string
  /** Main checkout (or the folder); what the header names. Actions use a checkout's own `path`. */
  root: string | null
  live: boolean
  active: boolean
  needs: number
  failed: number
  checkouts: RailCheckout[]
  /** Tab keys in open order. */
  tabKeys: string[]
  /** Remembered folders this cluster covers (✕ forgets them). */
  history: string[]
  peer?: RailPeer
}

export interface RailInput {
  tabs: readonly Tab[]
  panes: readonly Pane[]
  activeKey: string | null
  sessionOf: (pane: Pane) => RailSession | undefined
  /** `history`: a remembered folder with no pane, which the host may refuse to look up. */
  factsOf: (dir: string, history?: boolean) => RepoFacts | undefined
  labelOf: (pane: Pane) => string
  tabTitleOf?: (tab: Tab) => string
  agentLabel: (preset: PtyPreset) => string
  /** Run pane → run badge of its project. */
  runOf?: (pane: Pane) => RunBadge | null
  peerOf?: (pane: Pane) => RailPeer | undefined
  history: readonly string[]
  order: readonly string[]
}

export function paneState(pane: Pane, session: RailSession | undefined): RailState {
  if (pane.state === 'starting') return 'starting'
  if (pane.state === 'error' || pane.state === 'gone' || session?.status === 'error') return 'failed'
  if (pane.attention === 'waiting' || session?.status === 'waiting') return 'asked'
  if (pane.state === 'exited') return 'ended'
  if (session?.status === 'working') return 'working'
  if (session?.status === 'idle' && session.subagents > 0) return 'subagents'
  if (pane.attention === 'done') return 'done'
  return 'idle'
}

const GROUP_RANK: readonly RailState[] = ['failed', 'asked', 'working', 'subagents', 'starting', 'done', 'ended', 'idle']

export function groupState(states: readonly RailState[]): RailState {
  let best = GROUP_RANK.length - 1
  for (const s of states) best = Math.min(best, GROUP_RANK.indexOf(s))
  return GROUP_RANK[best]!
}

export function stateWord(state: RailState, subagents: number): { key: string; n?: number } {
  if (state === 'subagents') return { key: 'workspace.subagentState.waiting', n: subagents }
  if (state === 'working' && subagents > 0) return { key: 'workspace.subagentState.working', n: subagents }
  return { key: `workspace.rail.state.${state}` }
}

export function railItems(checkout: Pick<RailCheckout, 'rows' | 'groups'>): RailItem[] {
  const groups = new Map(checkout.groups.map((g) => [g.key, g]))
  const items: RailItem[] = []
  let open: string | null = null
  for (const row of checkout.rows) {
    const group = (row.group && groups.get(row.group)) || null
    if (group && open !== group.key) items.push({ kind: 'group', key: group.key, group })
    open = group?.key ?? null
    items.push({ kind: 'row', key: row.key, row, group })
  }
  return items
}

/** Building / Running → working, Run failed → failed (counts as needs you). */
export function runState(badge: RunBadge | null | undefined): RailState {
  return badge === 'failed' ? 'failed' : badge ? 'working' : 'idle'
}

function plainLines(row: Pick<RailRow, 'kind' | 'agent' | 'task' | 'ordinal'>, word: string): { first: string; second: string } {
  if (row.kind === 'other') return { first: row.agent, second: word }
  if (row.kind === 'shell') return row.task && row.task !== row.agent ? { first: row.task, second: `${row.agent} · ${word}` } : { first: row.agent, second: word }
  return row.task === null ? { first: row.ordinal, second: `${row.agent} · ${word}` } : { first: row.task, second: `${row.ordinal} · ${word}` }
}

/** Visible lines of a row; `word` is the translated state word (or wait label). */
export function rowLines(row: Pick<RailRow, 'kind' | 'agent' | 'task' | 'ordinal' | 'twin'>, word: string): { first: string; second: string } {
  const lines = plainLines(row, word)
  return row.twin ? { first: `${lines.first} ${row.twin}`, second: lines.second } : lines
}

export function showsCheckouts(cluster: Pick<RailCluster, 'checkouts' | 'live'>): boolean {
  const k = cluster.checkouts
  return k.some((c) => c.path) && (k.length > 1 || !cluster.live || k.some((c) => c.branch || c.tag === 'worktree'))
}

export const headId = (clusterKey: string): string => `head:${clusterKey}`
export const checkoutId = (clusterKey: string, checkoutKey: string): string => `co:${clusterKey}|${checkoutKey}`
export const rowId = (rowKey: string): string => `row:${rowKey}`

export function treeIds(clusters: readonly RailCluster[], collapsed: (clusterKey: string) => boolean): string[] {
  const ids: string[] = []
  for (const c of clusters) {
    ids.push(headId(c.key))
    if (collapsed(c.key)) continue
    const lines = showsCheckouts(c)
    for (const k of c.checkouts) {
      if (lines && k.path) ids.push(checkoutId(c.key, k.key))
      for (const item of railItems(k)) {
        if (item.kind === 'group') ids.push(item.key)
        else if (!item.group?.folded) ids.push(rowId(item.key))
      }
    }
  }
  return ids
}

export function tabStopOf(clusters: readonly RailCluster[], collapsed: (clusterKey: string) => boolean, last: string | null): string | null {
  const ids = treeIds(clusters, collapsed)
  if (last && ids.includes(last)) return last
  for (const c of clusters)
    for (const k of c.checkouts)
      for (const r of k.rows) {
        if (!r.focused) continue
        if (ids.includes(rowId(r.key))) return rowId(r.key)
        if (r.group && ids.includes(r.group)) return r.group
      }
  return ids[0] ?? null
}

const folderOf = (pane: Pane): string | undefined => {
  const dir = isTerm(pane) ? workCwd(pane) : undefined
  return dir ? folderName(dir) : undefined
}

function markTwins(rows: readonly RailRow[]): void {
  const firsts = rows.map((r) => plainLines(r, '').first)
  const claimed = new Set(firsts)
  const same = new Map<string, RailRow[]>()
  rows.forEach((r, i) => {
    if (r.kind === 'agent') return
    const first = firsts[i]!
    same.set(first, [...(same.get(first) ?? []), r])
  })
  for (const [first, list] of same) {
    if (list.length < 2) continue
    const dirs = list.map((r) => folderOf(r.pane))
    if (dirs.every((d) => !!d && d !== first) && new Set(dirs.map((d) => d!.toLowerCase())).size === dirs.length) {
      list.forEach((r, i) => (r.twin = `· ${dirs[i]}`))
      continue
    }
    let n = 2
    for (const r of list.slice(1)) {
      while (claimed.has(`${first} ${n}`)) n++
      r.twin = String(n)
      claimed.add(`${first} ${n++}`)
    }
  }
}

export function latestPeer(rows: readonly Pick<RailRow, 'peer'>[], keep: (p: RailPeer) => boolean = () => true): RailPeer | undefined {
  let best: RailPeer | undefined
  for (const r of rows) if (r.peer && keep(r.peer) && (!best || r.peer.at > best.at)) best = r.peer
  return best
}

function leadOf(rows: readonly RailRow[], state: RailState): string | null {
  let lead: RailRow | undefined
  for (const r of rows) if (r.state === state && (!lead || r.since < lead.since)) lead = r
  return lead?.paneKey ?? null
}

const time = (iso: string | undefined, fallback = 0): number => {
  const n = iso ? Date.parse(iso) : NaN
  return Number.isFinite(n) ? n : fallback
}

interface Place {
  clusterKey: string
  alias: string | null
  name: string
  root: string | null
  checkout: string | null
  facts: RepoFacts | undefined
}

function placeOf(dir: string | undefined, factsOf: RailInput['factsOf']): Place {
  if (!dir) return { clusterKey: 'home', alias: null, name: '', root: null, checkout: null, facts: undefined }
  const facts = factsOf(dir)
  // Until git answers, fold by the `<repo>-wt/<branch>` naming so a new worktree tab does not flash as its own project.
  const provisional = projectOf(dir) ?? dir
  const alias = `plain:${dirKey(provisional)}`
  if (!facts) return { clusterKey: alias, alias: null, name: folderName(provisional), root: provisional, checkout: dir, facts }
  const root = facts.main ?? facts.top
  return { clusterKey: facts.key, alias, name: folderName(root), root, checkout: facts.top, facts }
}

function tagOf(place: Place): RailCheckout['tag'] {
  const f = place.facts
  if (!place.checkout || !f) return null
  if (!f.repo) return 'folder'
  return f.main && dirKey(f.main) !== dirKey(f.top) ? 'worktree' : null
}

export function buildRail(input: RailInput): RailCluster[] {
  const byKey = new Map(input.panes.map((p) => [p.key, p]))
  const paneOf = (k: string): Pane | undefined => byKey.get(k)
  const activeTab = input.activeKey ? input.tabs.find((t) => leaves(t.root).includes(input.activeKey!)) : undefined
  const clusters = new Map<string, RailCluster>()
  const taken = new Map<string, Set<string>>()

  for (const tab of input.tabs) {
    const place = placeOf(tabProject(tab, paneOf), input.factsOf)
    let cluster = clusters.get(place.clusterKey)
    if (!cluster) {
      cluster = { key: place.clusterKey, aliases: [], name: place.name, root: place.root, live: true, active: false, needs: 0, failed: 0, checkouts: [], tabKeys: [], history: [] }
      clusters.set(place.clusterKey, cluster)
    }
    if (place.alias && !cluster.aliases.includes(place.alias)) cluster.aliases.push(place.alias)
    cluster.tabKeys.push(tab.key)
    const coKey = place.checkout ? dirKey(place.checkout) : 'home'
    let checkout = cluster.checkouts.find((c) => c.key === coKey)
    if (!checkout) {
      const tag = tagOf(place)
      checkout = { key: coKey, path: place.checkout, branch: null, tag, primary: tag !== 'worktree', active: false, rows: [], groups: [] }
      cluster.checkouts.push(checkout)
    }
    const tabActive = tab === activeTab
    if (tabActive) cluster.active = checkout.active = true
    const claimed = taken.get(coKey) ?? new Set<string>()
    taken.set(coKey, claimed)
    const claim = (prefix: string, base: string): string => {
      let w = base
      for (let n = 2; claimed.has(prefix + w); n++) w = `${base} ${n}`
      claimed.add(prefix + w)
      return w
    }
    const keys = leaves(tab.root)
    const members = keys.map(paneOf).filter((p): p is Pane => !!p && (isTerm(p) || p.kind === 'run'))
    const grouped = members.length >= 2
    const group = grouped ? `group:${tab.key}` : null
    const shown = grouped ? members : members.filter((p) => p.kind === 'run' || presetOf(p) !== 'shell')
    const named = !grouped && shown.length === 1 ? tab.name : undefined
    const titleOf = (): string => (input.tabTitleOf ? input.tabTitleOf(tab) : tabTitle(tab, paneOf, input.labelOf))
    const peerOf = (pane: Pane): Pick<RailRow, 'peer'> => {
      const peer = isTerm(pane) ? input.peerOf?.(pane) : undefined
      return peer ? { peer } : {}
    }
    const first = checkout.rows.length
    for (const pane of shown) {
      const focused = tabActive && pane.key === input.activeKey
      if (pane.kind === 'run') {
        const run = input.runOf?.(pane) ?? null
        const label = named ?? input.labelOf(pane)
        checkout.rows.push({
          key: pane.key, paneKey: pane.key, tabKey: tab.key, kind: 'other', pane, preset: pane.preset, agent: label, task: null,
          ordinal: label, state: runState(run), subagents: 0, run, since: pane.focusedAt ?? 0, focused, tabActive, group,
        })
        continue
      }
      const session = input.sessionOf(pane)
      checkout.branch ??= session?.branch ?? pane.branch ?? null
      const subagents = session?.subagents ?? 0
      const since = time(session?.since, pane.focusedAt ?? 0)
      const preset = presetOf(pane)
      if (preset === 'shell') {
        const shell = input.agentLabel('shell')
        checkout.rows.push({
          key: pane.key, paneKey: pane.key, tabKey: tab.key, kind: 'shell', pane, preset, agent: shell, task: input.labelOf(pane),
          ordinal: shell, state: paneState(pane, session), subagents, run: null, since, focused, tabActive, group, ...peerOf(pane),
        })
        continue
      }
      const agent = input.agentLabel(preset)
      const task = named ?? (session?.title || null)
      checkout.rows.push({
        key: pane.key, paneKey: pane.key, tabKey: tab.key, kind: 'agent', pane, preset, agent, task,
        ordinal: claim(task ? `${task} · ` : '', agent), state: paneState(pane, session), subagents, run: null, since, focused, tabActive, group, ...peerOf(pane),
      })
    }
    if (group) {
      const rows = checkout.rows.slice(first)
      const state = groupState(rows.map((r) => r.state))
      const peer = rows.some((r) => needsUser(r.state)) ? undefined : latestPeer(rows)
      checkout.groups.push({
        key: group, tabKey: tab.key, title: titleOf(), named: !!tab.name, count: rows.length, state,
        subagents: rows.reduce((n, r) => n + r.subagents, 0), folded: !!tab.folded, tabActive,
        focused: tabActive && !!input.activeKey && keys.includes(input.activeKey), paneKeys: rows.map((r) => r.paneKey), lead: leadOf(rows, state),
        ...(peer ? { peer } : {}),
      })
    }
    if (!shown.length) {
      const primary = paneOf(primaryPaneKey(tab.root, paneOf))
      if (!primary) continue
      checkout.branch ??= primary.branch ?? null
      const label = titleOf()
      checkout.rows.push({
        key: `tab:${tab.key}`, paneKey: tab.focus, tabKey: tab.key, kind: 'other', pane: primary, preset: primary.preset, agent: label, task: null,
        ordinal: label, state: isTerm(primary) ? paneState(primary, undefined) : 'idle', subagents: 0, run: null, since: primary.focusedAt ?? 0,
        focused: tabActive, tabActive, group: null, ...peerOf(primary),
      })
    }
  }

  const live = [...clusters.values()]
  for (const c of live) {
    c.checkouts.sort((a, b) => Number(b.primary) - Number(a.primary))
    for (const k of c.checkouts) markTwins(k.rows)
    const rows = c.checkouts.flatMap((k) => k.rows)
    c.needs = rows.filter((r) => needsUser(r.state)).length
    c.failed = rows.filter((r) => r.state === 'failed').length
    const peer = latestPeer(rows, isPeerNews)
    if (peer) c.peer = peer
  }

  // Remembered projects: opened before, nothing open now. Folded per repo; dropped when a live cluster already draws them.
  const remembered = new Map<string, RailCluster>()
  for (const dir of input.history) {
    const place = placeOf(dir, (d) => input.factsOf(d, true))
    const owner = live.find((c) => c.key === place.clusterKey || (!!place.alias && c.aliases.includes(place.alias)))
    if (owner) {
      owner.history.push(dir)
      continue
    }
    const r = remembered.get(place.clusterKey) ?? {
      key: place.clusterKey, aliases: place.alias ? [place.alias] : [], name: place.name, root: place.root, live: false, active: false,
      needs: 0, failed: 0, checkouts: [], tabKeys: [], history: [],
    }
    r.history.push(dir)
    if (place.checkout && !r.checkouts.some((k) => k.key === dirKey(place.checkout!))) {
      const tag = tagOf(place)
      r.checkouts.push({ key: dirKey(place.checkout), path: place.checkout, branch: null, tag, primary: tag !== 'worktree', active: false, rows: [], groups: [] })
    }
    remembered.set(place.clusterKey, r)
  }
  return applyOrder([...live, ...remembered.values()], input.order)
}
