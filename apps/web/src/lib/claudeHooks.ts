import type { HookRow, HooksListResult, HookTestResult, HookToggleResult } from '@ccm/shared'
import { desktop } from './desktop'

interface HooksBridge {
  hooksList?: (dir: string | null) => Promise<HooksListResult>
  hooksToggle?: (req: { id: string; dir: string | null; on: boolean }) => Promise<HookToggleResult>
  hooksTest?: (req: { id: string; dir: string | null }) => Promise<HookTestResult>
}
const bridge = desktop as unknown as HooksBridge | undefined

export const hasHooks = typeof bridge?.hooksList === 'function'
export const hooksList = (dir: string | null): Promise<HooksListResult> => bridge?.hooksList?.(dir) ?? Promise.resolve({ ok: false, error: 'unavailable' })
export const hooksToggle = (id: string, dir: string | null, on: boolean): Promise<HookToggleResult> =>
  bridge?.hooksToggle?.({ id, dir, on }) ?? Promise.resolve({ ok: false, error: 'failed' })
export const hooksTest = (id: string, dir: string | null): Promise<HookTestResult> => bridge?.hooksTest?.({ id, dir }) ?? Promise.resolve({ ok: false, error: 'spawn' })

export interface HookGroup {
  event: string
  rows: HookRow[]
  /** Hooks that run for this event: enabled and, for plugin hooks, the plugin is on. */
  active: number
}

export const isActive = (r: HookRow): boolean => r.enabled && r.pluginEnabled !== false

/** Rows arrive sorted by event; consecutive rows of one event become one group. */
export function groupByEvent(rows: readonly HookRow[]): HookGroup[] {
  const out: HookGroup[] = []
  for (const row of rows) {
    let g = out[out.length - 1]
    if (!g || g.event !== row.event) {
      g = { event: row.event, rows: [], active: 0 }
      out.push(g)
    }
    g.rows.push(row)
    if (isActive(row)) g.active++
  }
  return out
}

export function filterRows(rows: readonly HookRow[], query: string): HookRow[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...rows]
  return rows.filter((r) => [r.event, r.matcher ?? '', r.text, r.plugin ?? '', r.source].some((s) => s.toLowerCase().includes(q)))
}
