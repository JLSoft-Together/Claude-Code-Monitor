import type { UsageHeatmap } from '@ccm/shared'

export interface HeatGrid {
  /** rows[weekday][hour]; weekday 0 = Monday. */
  rows: number[][]
  max: number
  total: number
  /** Busiest weekday / hour, null without data. */
  peak: { weekday: number; hour: number } | null
}

const weekdayOf = (day: string): number => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return (new Date(y, m - 1, d, 12).getDay() + 6) % 7
}

/** Sums the per-day hours into a Monday-first weekday × hour grid. */
export function heatGrid(h: UsageHeatmap | null): HeatGrid {
  const rows = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
  let max = 0
  let total = 0
  let peak: HeatGrid['peak'] = null
  for (const { day, hours } of h?.days ?? []) {
    const row = rows[weekdayOf(day)]!
    hours.forEach((n, hour) => {
      if (hour > 23 || !n) return
      row[hour]! += n
      total += n
    })
  }
  rows.forEach((row, weekday) =>
    row.forEach((n, hour) => {
      if (n > max) {
        max = n
        peak = { weekday, hour }
      }
    }),
  )
  return { rows, max, total, peak }
}

/** 0 = none, 1–4 = quartiles of the busiest cell. */
export const heatLevel = (n: number, max: number): number => (n <= 0 || max <= 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)))
