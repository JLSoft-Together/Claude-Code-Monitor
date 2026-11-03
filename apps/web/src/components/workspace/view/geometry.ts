import type { Box, Divider } from '../../../lib/splitLayout'

export const GAP = 8

export function boxStyle(box: Box): Record<string, string> {
  const edge = (v: number): boolean => v < 1e-6 || v > 1 - 1e-6
  const left = edge(box.x) ? 0 : GAP / 2
  const right = edge(box.x + box.w) ? 0 : GAP / 2
  const top = edge(box.y) ? 0 : GAP / 2
  const bottom = edge(box.y + box.h) ? 0 : GAP / 2
  return {
    left: `calc(${box.x * 100}% + ${left}px)`,
    top: `calc(${box.y * 100}% + ${top}px)`,
    width: `calc(${box.w * 100}% - ${left + right}px)`,
    height: `calc(${box.h * 100}% - ${top + bottom}px)`,
  }
}

export function dividerStyle(d: Divider): Record<string, string> {
  if (d.dir === 'row') {
    const x = d.box.x + d.box.w * d.ratio
    return { left: `calc(${x * 100}% - ${GAP / 2}px)`, top: `${d.box.y * 100}%`, width: `${GAP}px`, height: `${d.box.h * 100}%` }
  }
  const y = d.box.y + d.box.h * d.ratio
  return { top: `calc(${y * 100}% - ${GAP / 2}px)`, left: `${d.box.x * 100}%`, height: `${GAP}px`, width: `${d.box.w * 100}%` }
}
