export const MAX_RAIL_ORDER = 200
const KEY = 'ccm.workspace.railOrder'

/** Stored keys first in stored order (first match wins), everything else keeps today's order. */
export function applyOrder<T extends { key: string; aliases: readonly string[] }>(clusters: readonly T[], order: readonly string[]): T[] {
  if (!order.length) return clusters as T[]
  const used = new Set<T>()
  const pinned: T[] = []
  for (const entry of order) {
    const hit = clusters.find((x) => !used.has(x) && (x.key === entry || x.aliases.includes(entry)))
    if (hit) {
      used.add(hit)
      pinned.push(hit)
    }
  }
  return [...pinned, ...clusters.filter((x) => !used.has(x))]
}

/** Drop of `from` at `to`: pins every cluster above and at the slot, so the next one opening cannot push it. */
export function pinAt(clusters: readonly { key: string }[], from: number, to: number, order: readonly string[]): string[] | null {
  const n = clusters.length
  if (from === to || from < 0 || to < 0 || from >= n || to >= n) return null
  const keys = clusters.map((x) => x.key)
  if (new Set(keys).size !== n) return null
  const moved = [...keys]
  moved.splice(to, 0, moved.splice(from, 1)[0]!)
  const prefix = moved.slice(0, to + 1)
  const next = [...prefix, ...order.filter((o) => !prefix.includes(o))]
  if (next.length <= MAX_RAIL_ORDER) return next
  const shown = new Set(keys)
  for (let i = next.length - 1; i >= 0 && next.length > MAX_RAIL_ORDER; i--) if (!shown.has(next[i]!)) next.splice(i, 1)
  return next.slice(0, MAX_RAIL_ORDER)
}

export function loadRailOrder(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    return Array.isArray(raw) ? raw.filter((k): k is string => typeof k === 'string').slice(0, MAX_RAIL_ORDER) : []
  } catch {
    return []
  }
}

export function saveRailOrder(order: readonly string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(order))
  } catch {
    // storage blocked: the order is not remembered
  }
}
