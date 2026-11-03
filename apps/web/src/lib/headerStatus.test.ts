import { describe, expect, it } from 'vitest'
import type { PlanLimits } from '@ccm/shared'
import { limitRisk, limitsStale, worstLimit } from './headerStatus'
import { canOfferWhatsNew } from './onboardingGate'

const lim = (five?: number, seven?: number, updatedAt = '2026-11-03T10:00:00Z'): PlanLimits => ({
  ...(five === undefined ? {} : { fiveHour: { usedPct: five } }),
  ...(seven === undefined ? {} : { sevenDay: { usedPct: seven } }),
  updatedAt,
} as PlanLimits)

describe('worstLimit', () => {
  it('is null without data', () => {
    expect(worstLimit(null, undefined)).toBeNull()
    expect(worstLimit(lim(), lim())).toBeNull()
  })
  it('picks the lowest remaining window across providers', () => {
    expect(worstLimit(lim(23, 40), lim(10, 97))).toEqual({ provider: 'codex', key: 'sevenDay', left: 3, level: 'critical' })
  })
  it('works with Claude only; critical at 10% left, warn at 20%', () => {
    expect(worstLimit(lim(89.6), null)).toEqual({ provider: 'claude', key: 'fiveHour', left: 10, level: 'critical' })
    expect(worstLimit(lim(89.4), null)?.level).toBe('warn')
    expect(worstLimit(lim(80), null)?.level).toBe('warn')
    expect(worstLimit(lim(79), null)?.level).toBe('ok')
    expect(worstLimit(lim(77), null)?.left).toBe(23)
  })
  it('prefers Claude on a tie', () => {
    expect(worstLimit(lim(50), lim(50))?.provider).toBe('claude')
  })
})

describe('limitsStale', () => {
  it('goes stale after 30 minutes', () => {
    const at = Date.parse('2026-11-03T10:00:00Z')
    expect(limitsStale(lim(1), at + 29 * 60_000)).toBe(false)
    expect(limitsStale(lim(1), at + 31 * 60_000)).toBe(true)
    expect(limitsStale(null, at)).toBe(false)
  })
})

describe('limitRisk', () => {
  const NOW = Date.parse('2026-11-03T10:00:00Z')
  const fc = (usedPct: number, fullInMin: number, beforeReset = true, updatedAt = '2026-11-03T10:00:00Z'): PlanLimits =>
    ({ fiveHour: { usedPct, forecast: { pctPerHour: 40, fullAt: new Date(NOW + fullInMin * 60_000).toISOString(), beforeReset } }, updatedAt }) as PlanLimits

  it('is null without a forecast (never invented)', () => {
    expect(limitRisk(lim(50), null, NOW)).toBeNull()
    expect(limitRisk(null, undefined, NOW)).toBeNull()
  })
  it('flags only a fill before the reset, in the future, below 100%', () => {
    expect(limitRisk(fc(60, 40), null, NOW)?.key).toBe('fiveHour')
    expect(limitRisk(fc(60, 40, false), null, NOW)).toBeNull()
    expect(limitRisk(fc(60, -5), null, NOW)).toBeNull()
    expect(limitRisk(fc(100, 40), null, NOW)).toBeNull()
  })
  it('narrows to a window and to one provider', () => {
    expect(limitRisk(fc(60, 45), null, NOW, 30 * 60_000)).toBeNull()
    expect(limitRisk(fc(60, 20), null, NOW, 30 * 60_000)?.provider).toBe('claude')
    expect(limitRisk(fc(60, 20), null, NOW, 30 * 60_000, 'codex')).toBeNull()
    expect(limitRisk(fc(60, 90), fc(60, 20), NOW)?.provider).toBe('codex')
  })
  it('skips a stale report', () => {
    expect(limitRisk(fc(60, 20, true, '2026-11-03T09:00:00Z'), null, NOW)).toBeNull()
  })
})

describe('canOfferWhatsNew', () => {
  const base = { due: true, whatsNewOpen: false, setupOpen: false, tourOpen: false, tourDue: false, tourShownThisSession: false }
  it('offers when nothing else is going on', () => expect(canOfferWhatsNew(base)).toBe(true))
  it('waits when the guide ran this session (fresh profile)', () => expect(canOfferWhatsNew({ ...base, tourShownThisSession: true })).toBe(false))
  it('waits while setup, guide or itself is open or the guide is due', () => {
    for (const k of ['whatsNewOpen', 'setupOpen', 'tourOpen', 'tourDue'] as const) expect(canOfferWhatsNew({ ...base, [k]: true })).toBe(false)
  })
  it('stays quiet when already seen', () => expect(canOfferWhatsNew({ ...base, due: false })).toBe(false))
})
