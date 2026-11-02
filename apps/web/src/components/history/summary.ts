import type { LaneStatus } from '@ccm/shared'

/** "worked 1m 26s · waited 2m 41s · idle 20s"; states with no time are left out, nothing recorded gives ''. */
export function summaryLine(
  totals: Record<LaneStatus, number>,
  fmt: (ms: number) => string,
  label: Record<LaneStatus, (d: string) => string>,
): string {
  const order: LaneStatus[] = ['working', 'waiting', 'idle']
  return order
    .filter((k) => totals[k] > 0)
    .map((k) => label[k](fmt(totals[k])))
    .filter(Boolean)
    .join(' · ')
}
