import { describe, expect, it } from 'vitest'
import type { DevUiState } from '@ccm/shared'
import { densitySteps, densityValue, fontValue, isLaunchUri, isPackageName, launchRows, shortActivity } from './deviceUiTest'

const state = (physical: number | null, override: number | null): DevUiState => ({
  sdk: 34, night: 'no', fontScale: 1, density: { physical, override }, animationsOff: false, locale: { supported: true, pkg: null, current: null }, changed: [],
})

describe('device UI test helpers', () => {
  it('density steps sit around the physical density', () => {
    expect(densitySteps(400).map((s) => s.value)).toEqual([340, 0, 460, 520])
    expect(densitySteps(null)).toEqual([{ value: 0, key: 'default' }])
    expect(densityValue(state(400, null))).toBe(0)
    expect(densityValue(state(400, 400))).toBe(0)
    expect(densityValue(state(400, 460))).toBe(460)
    expect(densityValue(state(400, 333))).toBe(-1)
  })

  it('font scale snaps to a preset or none', () => {
    expect(fontValue(1.3)).toBe(1.3)
    expect(fontValue(1.299999)).toBe(1.3)
    expect(fontValue(1.1)).toBe(-1)
  })

  it('lists deep links first, then exported activities with the launcher on top', () => {
    const rows = launchRows([
      { activity: 'com.app.Detail', exported: true, launcher: false, links: ['myapp://d'] },
      { activity: 'com.app.Main', exported: true, launcher: true, links: [] },
      { activity: 'com.app.Private', exported: false, launcher: false, links: [] },
    ])
    expect(rows.map((r) => `${r.kind}:${r.target}`)).toEqual(['uri:myapp://d', 'activity:com.app.Main', 'activity:com.app.Detail'])
    expect(shortActivity('com.app.Main', 'com.app')).toBe('.Main')
    expect(shortActivity('org.x.Main', 'com.app')).toBe('org.x.Main')
  })

  it('validates what the page sends', () => {
    expect(isLaunchUri('myapp://x?a=1&b=2')).toBe(true)
    expect(isLaunchUri('no scheme')).toBe(false)
    expect(isLaunchUri('https://a b')).toBe(false)
    expect(isPackageName('com.example.app')).toBe(true)
    expect(isPackageName('com')).toBe(false)
  })
})
