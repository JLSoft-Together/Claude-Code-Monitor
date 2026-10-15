import type { Agent } from '@ccm/shared'
import type { Ref } from 'vue'
import { treeOrder } from './layout'

export interface MapNav {
  /** One column per session, top to bottom as the map stacks it (main first, then subagents in tree order). */
  columns: string[][]
  parent: Map<string, string | null>
  firstChild: Map<string, string>
  where: Map<string, [number, number]>
}

/** Parent as the map draws it: the real parent when it is in the same list, else the session's main agent. */
export function treeParent(agent: Agent, ids: Set<string>, mainId: string | undefined): string | null {
  if (agent.role === 'main') return null
  if (agent.parentId && agent.parentId !== agent.id && ids.has(agent.parentId)) return agent.parentId
  return mainId && mainId !== agent.id ? mainId : null
}

export function buildNav(terminalIds: string[], byTerminal: Record<string, Agent[]>): MapNav {
  const nav: MapNav = { columns: [], parent: new Map(), firstChild: new Map(), where: new Map() }
  for (const terminalId of terminalIds) {
    const agents = byTerminal[terminalId]
    if (!agents?.length) continue
    const main = agents.find((a) => a.role === 'main')
    const ids = new Set(agents.map((a) => a.id))
    const column: string[] = []
    if (main) {
      column.push(main.id)
      nav.parent.set(main.id, null)
    }
    for (const { agent } of treeOrder(agents)) {
      const p = treeParent(agent, ids, main?.id)
      column.push(agent.id)
      nav.parent.set(agent.id, p)
      if (p && !nav.firstChild.has(p)) nav.firstChild.set(p, agent.id)
    }
    const c = nav.columns.length
    column.forEach((id, i) => nav.where.set(id, [c, i]))
    nav.columns.push(column)
  }
  return nav
}

export type NavKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'
export const NAV_KEYS: readonly string[] = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']

/**
 * ↑↓ walk the session column, Home/End its ends. ← goes to the parent; on a session's root it goes to the previous
 * session. → goes to the first child; on a root it goes to the next session (its first child is already ↓).
 */
export function navigate(nav: MapNav, from: string | null, key: NavKey): string | null {
  const at = from ? nav.where.get(from) : undefined
  if (!at) return nav.columns[0]?.[0] ?? null
  const [c, i] = at
  const column = nav.columns[c]!
  const root = nav.parent.get(from!) === null
  switch (key) {
    case 'ArrowDown':
      return column[i + 1] ?? null
    case 'ArrowUp':
      return column[i - 1] ?? null
    case 'Home':
      return column[0] ?? null
    case 'End':
      return column.at(-1) ?? null
    case 'ArrowLeft':
      return root ? (nav.columns[c - 1]?.[0] ?? null) : (nav.parent.get(from!) ?? null)
    case 'ArrowRight':
      return root ? (nav.columns[c + 1]?.[0] ?? null) : (nav.firstChild.get(from!) ?? null)
  }
}

function childrenOf(agents: Agent[]): Map<string, string[]> {
  const byTerminal = new Map<string, Agent[]>()
  for (const a of agents) {
    const list = byTerminal.get(a.terminalId)
    if (list) list.push(a)
    else byTerminal.set(a.terminalId, [a])
  }
  const children = new Map<string, string[]>()
  for (const list of byTerminal.values()) {
    const ids = new Set(list.map((a) => a.id))
    const mainId = list.find((a) => a.role === 'main')?.id
    for (const a of list) {
      const p = treeParent(a, ids, mainId)
      if (!p) continue
      const kids = children.get(p)
      if (kids) kids.push(a.id)
      else children.set(p, [a.id])
    }
  }
  return children
}

/** Children per agent (map parent rules), across all sessions in `agents`. */
export function childCounts(agents: Agent[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const [p, kids] of childrenOf(agents)) out.set(p, kids.length)
  return out
}

/** Drops the descendants of collapsed agents; `hiddenUnder` counts them per collapsed agent that is itself shown. */
export function hideCollapsed(agents: Agent[], collapsed: ReadonlySet<string>): { visible: Set<string>; hiddenUnder: Map<string, number> } {
  const visible = new Set(agents.map((a) => a.id))
  const hiddenUnder = new Map<string, number>()
  if (!collapsed.size) return { visible, hiddenUnder }
  const children = childrenOf(agents)
  for (const id of collapsed) {
    if (!children.has(id)) continue
    const seen = new Set<string>()
    const stack = [...children.get(id)!]
    while (stack.length) {
      const next = stack.pop()!
      if (seen.has(next)) continue
      seen.add(next)
      visible.delete(next)
      stack.push(...(children.get(next) ?? []))
    }
    hiddenUnder.set(id, seen.size)
  }
  for (const id of [...hiddenUnder.keys()]) if (!visible.has(id)) hiddenUnder.delete(id)
  return { visible, hiddenUnder }
}

/** What AgentMap shares with its nodes (provide/inject `ccm-map-node`): roving tab stop, find hits, folding. */
export interface MapNodeContext {
  tabStop: Readonly<Ref<string | null>>
  matches: Readonly<Ref<ReadonlySet<string> | null>>
  currentMatch: Readonly<Ref<string | null>>
  children: Readonly<Ref<ReadonlyMap<string, number>>>
  hiddenUnder: Readonly<Ref<ReadonlyMap<string, number>>>
  collapsed: Readonly<Ref<ReadonlySet<string>>>
  toggleFold: (id: string) => void
}
