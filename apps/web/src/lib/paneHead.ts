import { CONTEXT_THRESHOLDS } from '@ccm/shared'
import { isSeparator, type MenuEntry } from './menu'
import type { RailState } from './rail/railModel'
import type { AnyStatus } from './status'
import type { PaneState } from '../stores/workspace'

export const STATE_BADGE: Record<RailState, AnyStatus> = {
  failed: 'error',
  asked: 'waiting',
  ended: 'completed',
  working: 'working',
  subagents: 'working',
  done: 'completed',
  starting: 'idle',
  idle: 'idle',
  parked: 'stale',
}

export type ProcessChip = 'parked' | 'starting' | 'exited' | 'error'

export function processChip(state: PaneState): ProcessChip | null {
  if (state === 'parked') return 'parked'
  if (state === 'starting') return 'starting'
  if (state === 'exited') return 'exited'
  if (state === 'error' || state === 'gone') return 'error'
  return null
}

export function suggestCompact(pct: number | null | undefined, state: string | null | undefined): boolean {
  return typeof pct === 'number' && pct >= CONTEXT_THRESHOLDS.warning && state === 'ready'
}

export const zoomKeys = (mac: boolean): string => (mac ? '⌘⇧↩' : 'Ctrl+Shift+Enter')

const ACTIVE =
  'button, a, input, select, textarea, label, [role=button], [role=group], [role=radiogroup], [role=search], [role=menu], [role=menuitem], [contenteditable], [data-pane-chip]'

export function isHeadBlank(target: EventTarget | null, head: Element): boolean {
  if (!target || !(target as Node).nodeType) return false
  const el = (target as Node).nodeType === 1 ? (target as Element) : (target as Node).parentElement
  if (!el || !head.contains(el)) return false
  const hit = el.closest(ACTIVE)
  return !hit || hit === head || !head.contains(hit)
}

export const moreKey = (id: string): string => id.split(':')[0] ?? id

export function overflowEntries(entries: readonly MenuEntry[], shown: (key: string) => boolean): MenuEntry[] {
  const out: MenuEntry[] = []
  for (const e of entries) {
    if (isSeparator(e)) {
      const last = out[out.length - 1]
      if (last && !isSeparator(last)) out.push(e)
    } else if (!shown(moreKey(e.id))) out.push(e)
  }
  while (out.length && isSeparator(out[out.length - 1]!)) out.pop()
  return out
}

export function isShownIn(scope: ParentNode, key: string): boolean {
  const el = scope.querySelector(`[data-more="${key}"]`)
  return !!el && el.getClientRects().length > 0
}
