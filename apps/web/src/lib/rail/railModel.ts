import type { PtyPreset, TerminalStatus } from '@ccm/shared'
import { dirKey } from '../../stores/favorites'
import { isTerm, primaryPaneKey, tabProject, type Pane, type Tab } from '../../stores/workspace'
import type { RunBadge } from '../runUi'
import { folderName, projectOf } from '../sidebarRows'
import { leaves } from '../splitLayout'
import { applyOrder } from './railOrder'
import type { RepoFacts } from './repo'

export type RailState = 'failed' | 'asked' | 'ended' | 'working' | 'done' | 'starting' | 'idle'
export const needsUser = (s: RailState): boolean => s === 'asked' || s === 'failed'

export interface RailSession {
  status: TerminalStatus
  /** `displayTitle`: alias, else Claude's own session name. Never prompt text. */
  title: string
  branch?: string
  /** ISO time of the last status change. */
  since?: string
}

export interface RailRow {
  /** Pane key for agent / run rows, `tab:<key>` for a tab without either. */
  key: string
  paneKey: string
  tabKey: string
  kind: 'agent' | 'other'
  /** Drawn by `PaneIcon`. */
  pane: Pane
  preset: PtyPreset
  /** Agent product name, or the row label for `other` rows. */
  agent: string
  task: string | null
  /** Agent name made unique within the checkout: `Claude`, `Claude 2`. */
  ordinal: string
  state: RailState
  /** Run pane: its project's run badge (Building / Running / Run failed). */
  run: RunBadge | null
  since: number
  focused: boolean
  tabActive: boolean
}

export interface RailCheckout {
  key: string
  path: string | null
  branch: string | null
  tag: 'worktree' | 'folder' | null
  primary: boolean
  active: boolean
  rows: RailRow[]
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
}

export interface RailInput {
  tabs: readonly Tab[]
  panes: readonly Pane[]
  activeKey: string | null
  sessionOf: (pane: Pane) => RailSession | undefined
  /** `history`: a remembered folder with no pane, which the host may refuse to look up. */
  factsOf: (dir: string, history?: boolean) => RepoFacts | undefined
  labelOf: (pane: Pane) => string
  agentLabel: (preset: PtyPreset) => string
  /** Run pane → run badge of its project. */
  runOf?: (pane: Pane) => RunBadge | null
  history: readonly string[]
  order: readonly string[]
}

export function paneState(pane: Pane, session: RailSession | undefined): RailState {
  if (pane.state === 'starting') return 'starting'
  if (pane.state === 'error' || pane.state === 'gone' || session?.status === 'error') return 'failed'
  if (pane.attention === 'waiting' || session?.status === 'waiting') return 'asked'
  if (pane.state === 'exited') return 'ended'
  if (session?.status === 'working') return 'working'
  if (pane.attention === 'done') return 'done'
  return 'idle'
}

/** Building / Running → working, Run failed → failed (counts as needs you). */
export function runState(badge: RunBadge | null | undefined): RailState {
  return badge === 'failed' ? 'failed' : badge ? 'working' : 'idle'
}

/** Visible lines of a row; `word` is the translated state word (or wait label). */
export function rowLines(row: Pick<RailRow, 'kind' | 'agent' | 'task' | 'ordinal'>, word: string): { first: string; second: string } {
  if (row.kind === 'other') return { first: row.agent, second: word }
  return row.task === null ? { first: row.ordinal, second: `${row.agent} · ${word}` } : { first: row.task, second: `${row.ordinal} · ${word}` }
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
      checkout = { key: coKey, path: place.checkout, branch: null, tag, primary: tag !== 'worktree', active: false, rows: [] }
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
    const shown = leaves(tab.root)
      .map(paneOf)
      .filter((p): p is Pane => !!p && ((isTerm(p) && p.preset !== 'shell') || p.kind === 'run'))
    for (const pane of shown) {
      if (pane.kind === 'run') {
        const run = input.runOf?.(pane) ?? null
        const label = input.labelOf(pane)
        checkout.rows.push({
          key: pane.key, paneKey: pane.key, tabKey: tab.key, kind: 'other', pane, preset: pane.preset, agent: label, task: null,
          ordinal: label, state: runState(run), run, since: pane.focusedAt ?? 0, focused: tabActive && pane.key === input.activeKey, tabActive,
        })
        continue
      }
      const session = input.sessionOf(pane)
      checkout.branch ??= session?.branch ?? pane.branch ?? null
      const agent = input.agentLabel(pane.preset)
      const task = session?.title || null
      checkout.rows.push({
        key: pane.key, paneKey: pane.key, tabKey: tab.key, kind: 'agent', pane, preset: pane.preset, agent, task,
        ordinal: claim(task ? `${task} · ` : '', agent), state: paneState(pane, session), run: null,
        since: time(session?.since, pane.focusedAt ?? 0), focused: tabActive && pane.key === input.activeKey, tabActive,
      })
    }
    if (!shown.length) {
      const primary = paneOf(primaryPaneKey(tab.root, paneOf))
      if (!primary) continue
      checkout.branch ??= primary.branch ?? null
      const label = input.labelOf(primary)
      checkout.rows.push({
        key: `tab:${tab.key}`, paneKey: tab.focus, tabKey: tab.key, kind: 'other', pane: primary, preset: primary.preset, agent: label, task: null,
        ordinal: label, state: isTerm(primary) ? paneState(primary, undefined) : 'idle', run: null, since: primary.focusedAt ?? 0, focused: tabActive, tabActive,
      })
    }
  }

  const live = [...clusters.values()]
  for (const c of live) {
    c.checkouts.sort((a, b) => Number(b.primary) - Number(a.primary))
    const rows = c.checkouts.flatMap((k) => k.rows)
    c.needs = rows.filter((r) => needsUser(r.state)).length
    c.failed = rows.filter((r) => r.state === 'failed').length
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
      r.checkouts.push({ key: dirKey(place.checkout), path: place.checkout, branch: null, tag, primary: tag !== 'worktree', active: false, rows: [] })
    }
    remembered.set(place.clusterKey, r)
  }
  return applyOrder([...live, ...remembered.values()], input.order)
}
