import type { TerminalStatus } from '@ccm/shared'

export interface StripItem {
  key: string
  left: number
  width: number
}

export function stripSlot(items: readonly Pick<StripItem, 'left' | 'width'>[], x: number): number {
  const at = items.findIndex((it) => x < it.left + it.width / 2)
  return at < 0 ? items.length : at
}

export function slotMoves(order: readonly string[], key: string, slot: number): boolean {
  const from = order.indexOf(key)
  return from >= 0 && slot >= 0 && slot <= order.length && slot !== from && slot !== from + 1
}

export function caretAt(items: readonly Pick<StripItem, 'left' | 'width'>[], slot: number, gap: number): number | null {
  if (!items.length || slot < 0 || slot > items.length) return null
  if (slot < items.length) return items[slot]!.left - gap / 2
  const last = items[items.length - 1]!
  return last.left + last.width + gap / 2
}

export function tabMoveIndex(all: readonly string[], visible: readonly string[], key: string, slot: number): number | null {
  if (!all.includes(key) || !slotMoves(visible, key, slot)) return null
  const from = visible.indexOf(key)
  const rest = visible.filter((k) => k !== key)
  const others = all.filter((k) => k !== key)
  const pos = slot > from ? slot - 1 : slot
  const next = rest[pos]
  if (next !== undefined) return others.indexOf(next)
  const prev = rest[pos - 1]
  return prev === undefined ? null : others.indexOf(prev) + 1
}

export function stepSlot(visible: readonly string[], key: string, step: 1 | -1): number | null {
  const from = visible.indexOf(key)
  if (from < 0) return null
  const slot = step > 0 ? from + 2 : from - 1
  return slot < 0 || slot > visible.length ? null : slot
}

export type FlashKind = 'waiting' | 'done' | 'error'

export interface TabSignal {
  status?: TerminalStatus
  attention?: 'waiting' | 'done'
}

export function flashKind(before: TabSignal, now: TabSignal): FlashKind | null {
  if (now.status !== before.status) {
    if (now.status === 'waiting' || now.status === 'error') return now.status
    if (now.status === 'idle' && before.status === 'working') return 'done'
  }
  if (now.attention && now.attention !== before.attention) return now.attention
  return null
}
