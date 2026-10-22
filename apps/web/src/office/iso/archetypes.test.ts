import { afterEach, describe, expect, it, vi } from 'vitest'
import { personaFor, setPersonaOverride, soloWeights } from '@ccm/habblaud/client/src/world/social/persona'
import { IDLE_WEIGHTS } from '@ccm/habblaud/client/src/world/sim/behavior'
import { archetypeFor, DEFAULT_ARCHETYPES, JIN, jinOverride, jinPersona, loadArchetypes, parseArchetypeManifest } from './archetypes'
import { lookFromAgents } from './index'
import { installPersonas } from './personas'

afterEach(() => setPersonaOverride(null))

const jinSeed = (): number => {
  for (let s = 1; s < 10_000; s++) if (archetypeFor(s, 'm') === JIN) return s
  throw new Error('no jin seed')
}

describe('iso archetypes', () => {
  it('six defaults, three per look, Jin is male', () => {
    expect(DEFAULT_ARCHETYPES).toHaveLength(6)
    expect(DEFAULT_ARCHETYPES.filter((a) => a.look === 'f')).toHaveLength(3)
    expect(DEFAULT_ARCHETYPES.find((a) => a.id === JIN)?.look).toBe('m')
  })

  it('is stable per seed and stays inside the look pool', () => {
    const counts = new Map<string, number>()
    for (let s = 0; s < 3000; s++) {
      const m = archetypeFor(s, 'm')
      const f = archetypeFor(s, 'f')
      expect(archetypeFor(s, 'm')).toBe(m)
      expect(['jin', 'm1', 'm2']).toContain(m)
      expect(['f1', 'f2', 'f3']).toContain(f)
      counts.set(m, (counts.get(m) ?? 0) + 1)
    }
    for (const n of counts.values()) expect(n).toBeGreaterThan(800)
  })

  it('falls back to the whole list when a look has no archetype', () => {
    expect(archetypeFor(9, 'f', [{ id: 'solo', look: 'm' }])).toBe('solo')
  })

  it('parses a manifest and rejects bad ones', () => {
    expect(parseArchetypeManifest({ archetypes: [{ id: 'jin', look: 'm' }, { id: 'ana', look: 'f' }] })).toEqual([
      { id: 'jin', look: 'm' },
      { id: 'ana', look: 'f' },
    ])
    expect(parseArchetypeManifest([{ id: 'jin', look: 'm' }])).toEqual([{ id: 'jin', look: 'm' }])
    expect(parseArchetypeManifest({ archetypes: [] })).toBeNull()
    expect(parseArchetypeManifest({ archetypes: [{ id: 'Jin!', look: 'm' }] })).toBeNull()
    expect(parseArchetypeManifest({ archetypes: [{ id: 'a', look: 'x' }] })).toBeNull()
    expect(parseArchetypeManifest({ archetypes: [{ id: 'a', look: 'm' }, { id: 'a', look: 'f' }] })).toBeNull()
    expect(parseArchetypeManifest('nope')).toBeNull()
  })

  it('loadArchetypes falls back to the defaults on 404, bad JSON or a network error', async () => {
    expect(await loadArchetypes(vi.fn(async () => new Response(null, { status: 404 })))).toBe(DEFAULT_ARCHETYPES)
    expect(await loadArchetypes(vi.fn(async () => new Response('{', { status: 200 })))).toBe(DEFAULT_ARCHETYPES)
    expect(await loadArchetypes(vi.fn(async () => Promise.reject(new Error('x'))))).toBe(DEFAULT_ARCHETYPES)
    const list = await loadArchetypes(vi.fn(async () => new Response(JSON.stringify({ archetypes: [{ id: 'jin', look: 'm' }] }), { status: 200 })))
    expect(list).toEqual([{ id: 'jin', look: 'm' }])
  })
})

describe('Jin persona', () => {
  it('adds cafeina and brings coffee to x2.5 and bathroom to x3 in total', () => {
    for (const traits of [['leitura', 'calma'], ['fofoca', 'vaidade'], ['cafeina']] as const) {
      const p = jinPersona({ traits: [...traits], sociability: 0.5, skill: 0.5, catchphrase: 'x' })
      expect(p.traits).toContain('cafeina')
      expect(p.traits.length).toBeLessThanOrEqual(3)
      const w = soloWeights(p)
      expect(w.coffee).toBeCloseTo(IDLE_WEIGHTS.coffee * 2.5)
      expect(w.bathroom).toBeCloseTo(IDLE_WEIGHTS.bathroom * 3)
    }
  })

  it('the override answers only for a known look, Jin seeds only', () => {
    const seed = jinSeed()
    const looks = new Map<number, 'f' | 'm'>([
      [seed, 'm'],
      [seed + 100_000, 'f'],
    ])
    const fn = jinOverride((s) => looks.get(s))
    const base = { traits: [], sociability: 0.5, skill: 0.5, catchphrase: 'x' }
    expect(soloWeights(fn(seed, base)!).coffee).toBeCloseTo(IDLE_WEIGHTS.coffee * 2.5)
    expect(fn(seed + 100_000, base)).toBeNull()
    expect(fn(424242, base)).toBeUndefined()
  })

  it('installPersonas sets the habblaud override and removes it again', async () => {
    const seed = jinSeed()
    const off = installPersonas(lookFromAgents(() => [{ seed, look: 'm' }]), Promise.resolve(DEFAULT_ARCHETYPES))
    expect(soloWeights(personaFor(seed)).coffee).toBeCloseTo(IDLE_WEIGHTS.coffee * 2.5)
    expect(personaFor(seed).traits).toContain('cafeina')
    off()
    expect(personaFor(seed).soloK).toBeUndefined()
  })

  it('lookFromAgents rebuilds its map only when the agent list changes', () => {
    let agents = [{ seed: 1, look: 'f' as const }]
    const lookOf = lookFromAgents(() => agents)
    expect(lookOf(1)).toBe('f')
    expect(lookOf(2)).toBeUndefined()
    agents = [{ seed: 2, look: 'f' }]
    expect(lookOf(2)).toBe('f')
  })
})
