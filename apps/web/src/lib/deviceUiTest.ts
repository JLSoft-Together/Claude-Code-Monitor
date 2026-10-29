import type { DevDeepLink, DevUiState } from '@ccm/shared'

export const FONT_SCALES = [0.85, 1, 1.15, 1.3, 2] as const

/** Display size steps around the physical density; 0 = reset to the device default. */
export function densitySteps(physical: number | null): { value: number; key: 'small' | 'default' | 'large' | 'larger' }[] {
  if (!physical) return [{ value: 0, key: 'default' }]
  return [
    { value: Math.round(physical * 0.85), key: 'small' },
    { value: 0, key: 'default' },
    { value: Math.round(physical * 1.15), key: 'large' },
    { value: Math.round(physical * 1.3), key: 'larger' },
  ]
}

/** The step the device is on now (0 when there is no override or it matches none of them). */
export function densityValue(state: DevUiState): number {
  const o = state.density.override
  if (!o || o === state.density.physical) return 0
  return densitySteps(state.density.physical).some((s) => s.value === o) ? o : -1
}

export const fontValue = (scale: number): number => FONT_SCALES.find((f) => Math.abs(f - scale) < 0.005) ?? -1

export interface LaunchRow {
  key: string
  kind: 'uri' | 'activity'
  /** URI to open, or the activity class. */
  target: string
  activity: string
  launcher: boolean
}

/** Deep links first (each sample URI), then exported activities that can be started by name; launcher on top. */
export function launchRows(activities: readonly DevDeepLink[]): LaunchRow[] {
  const links: LaunchRow[] = []
  const starts: LaunchRow[] = []
  for (const a of activities) {
    for (const uri of a.links) links.push({ key: `u:${uri}:${a.activity}`, kind: 'uri', target: uri, activity: a.activity, launcher: a.launcher })
    if (a.exported) starts.push({ key: `a:${a.activity}`, kind: 'activity', target: a.activity, activity: a.activity, launcher: a.launcher })
  }
  starts.sort((x, y) => Number(y.launcher) - Number(x.launcher))
  return [...links, ...starts]
}

export const shortActivity = (cls: string, pkg: string | null): string => (pkg && cls.startsWith(`${pkg}.`) ? cls.slice(pkg.length) : cls)

/** What the free URI field accepts: a scheme, no spaces or control characters (main checks again). */
export const isLaunchUri = (s: string): boolean => s.length <= 2048 && /^[A-Za-z][A-Za-z0-9+.-]*:\S+$/.test(s) && !/[\x00-\x1f\x7f]/.test(s)

export const isPackageName = (s: string): boolean => s.length <= 255 && /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(s)
