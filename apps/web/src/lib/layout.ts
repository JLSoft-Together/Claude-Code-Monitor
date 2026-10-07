import type { Agent } from '@ccm/shared'

export interface Point {
  x: number
  y: number
}

export const COLUMN_WIDTH = 290
export const CHILD_INDENT = 28
export const MAIN_HEIGHT = 84
export const ROW_HEIGHT = 70
export const ROW_GAP = 56

export interface LayoutInput {
  terminals: string[]
  agentsByTerminal: Record<string, Agent[]>
  perRow: number
}

export function columnsFor(width: number): number {
  return Math.max(1, Math.min(6, Math.floor(width / COLUMN_WIDTH)))
}

export function treeHeight(agents: Agent[]): number {
  const subs = agents.filter((a) => a.role !== 'main').length
  return MAIN_HEIGHT + subs * ROW_HEIGHT
}

export const MAX_INDENT_DEPTH = 2

export function treeOrder(agents: Agent[]): { agent: Agent; depth: number }[] {
  const main = agents.find((a) => a.role === 'main')
  const ids = new Set(agents.map((a) => a.id))
  const children = new Map<string, Agent[]>()
  const rootId = main?.id ?? ''
  for (const a of agents) {
    if (a === main) continue
    const parent = a.parentId && a.parentId !== a.id && ids.has(a.parentId) ? a.parentId : rootId
    const list = children.get(parent) ?? []
    list.push(a)
    children.set(parent, list)
  }
  const out: { agent: Agent; depth: number }[] = []
  const seen = new Set<string>()
  const walk = (id: string, depth: number) => {
    for (const child of children.get(id) ?? []) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      out.push({ agent: child, depth })
      walk(child.id, depth + 1)
    }
  }
  walk(rootId, 1)
  for (const a of agents) if (a !== main && !seen.has(a.id)) out.push({ agent: a, depth: 1 })
  return out
}

export function computeLayout(input: LayoutInput): Map<string, Point> {
  const { terminals, agentsByTerminal } = input
  const perRow = Math.max(1, input.perRow)
  const positions = new Map<string, Point>()
  const placed = terminals.filter((id) => agentsByTerminal[id]?.length)

  let y = 0
  for (let start = 0; start < placed.length; start += perRow) {
    const row = placed.slice(start, start + perRow)
    let rowHeight = 0
    row.forEach((terminalId, col) => {
      const agents = agentsByTerminal[terminalId] ?? []
      const x0 = col * COLUMN_WIDTH
      const main = agents.find((a) => a.role === 'main')
      if (main) positions.set(main.id, { x: x0, y })
      let childY = y + MAIN_HEIGHT - ROW_HEIGHT
      for (const { agent, depth } of treeOrder(agents)) {
        childY += ROW_HEIGHT
        positions.set(agent.id, { x: x0 + Math.min(depth, MAX_INDENT_DEPTH) * CHILD_INDENT, y: childY })
      }
      rowHeight = Math.max(rowHeight, treeHeight(agents))
    })
    y += rowHeight + ROW_GAP
  }
  return positions
}

export function visibleAgents(agents: Agent[], hideFinished: boolean): { visible: Set<string>; hidden: number } {
  const visible = new Set<string>()
  if (!hideFinished) {
    for (const a of agents) visible.add(a.id)
    return { visible, hidden: 0 }
  }
  const byId = new Map(agents.map((a) => [a.id, a]))
  for (const a of agents) {
    if (a.role !== 'main' && (a.status === 'completed' || a.status === 'cancelled')) continue
    let cur: Agent | undefined = a
    while (cur && !visible.has(cur.id)) {
      visible.add(cur.id)
      cur = cur.parentId ? byId.get(cur.parentId) : undefined
    }
  }
  return { visible, hidden: agents.length - visible.size }
}
