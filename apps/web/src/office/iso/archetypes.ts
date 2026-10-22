import { soloWeights, type Persona, type PersonaOverride } from '@ccm/habblaud/client/src/world/social/persona'
import { IDLE_WEIGHTS } from '@ccm/habblaud/client/src/world/sim/behavior'
import { traitsClash, type TraitId } from '@ccm/habblaud/shared/world/traits'
import type { IsoArt } from './isoArt'

export type Look = 'f' | 'm'

export interface Archetype {
  id: string
  look: Look
}

export const JIN = 'jin'

export const DEFAULT_ARCHETYPES: readonly Archetype[] = [
  { id: JIN, look: 'm' },
  { id: 'm1', look: 'm' },
  { id: 'm2', look: 'm' },
  { id: 'f1', look: 'f' },
  { id: 'f2', look: 'f' },
  { id: 'f3', look: 'f' },
]

export const ARCHETYPE_MANIFEST_URL = '/assets/iso3d/chars/manifest.json'

export const JIN_TOTAL_K: Readonly<Record<'bathroom' | 'coffee', number>> = { bathroom: 3, coffee: 2.5 }

function mix(seed: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  return (h ^ (h >>> 16)) >>> 0
}

export function archetypeFor(seed: number, look: Look, list: readonly Archetype[] = DEFAULT_ARCHETYPES): string {
  const same = list.filter((a) => a.look === look)
  const pool = same.length ? same : list
  if (!pool.length) return JIN
  return pool[mix(seed) % pool.length]!.id
}

export function parseArchetypeManifest(raw: unknown): Archetype[] | null {
  const arr = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? (raw as { archetypes?: unknown }).archetypes : null
  if (!Array.isArray(arr) || arr.length < 1 || arr.length > 12) return null
  const out: Archetype[] = []
  const seen = new Set<string>()
  for (const it of arr) {
    if (!it || typeof it !== 'object') return null
    const { id, look } = it as { id?: unknown; look?: unknown }
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,32}$/.test(id) || seen.has(id)) return null
    if (look !== 'f' && look !== 'm') return null
    seen.add(id)
    out.push({ id, look })
  }
  return out
}

export function archetypesOf(art: Pick<IsoArt, 'chars'> | null): readonly Archetype[] {
  const list = art?.chars?.archetypes
  return list?.length ? list.map(({ id, look }) => ({ id, look })) : DEFAULT_ARCHETYPES
}

export async function loadArchetypes(fetcher: typeof fetch = fetch): Promise<readonly Archetype[]> {
  try {
    const res = await fetcher(ARCHETYPE_MANIFEST_URL)
    if (!res.ok) return DEFAULT_ARCHETYPES
    return parseArchetypeManifest(await res.json()) ?? DEFAULT_ARCHETYPES
  } catch {
    return DEFAULT_ARCHETYPES
  }
}

export function jinPersona(base: Persona): Persona {
  const cafe: TraitId = 'cafeina'
  const traits = base.traits.includes(cafe) ? [...base.traits] : [cafe, ...base.traits.filter((t) => !traitsClash(t, cafe))].slice(0, 3)
  const traitWeights = soloWeights({ ...base, traits, soloK: undefined })
  const soloK = {
    bathroom: (IDLE_WEIGHTS.bathroom * JIN_TOTAL_K.bathroom) / traitWeights.bathroom,
    coffee: (IDLE_WEIGHTS.coffee * JIN_TOTAL_K.coffee) / traitWeights.coffee,
  }
  return { ...base, traits, soloK }
}

export function jinOverride(lookOf: (seed: number) => Look | undefined, list: readonly Archetype[] = DEFAULT_ARCHETYPES): PersonaOverride {
  return (seed, base) => {
    const look = lookOf(seed)
    if (!look) return undefined
    return archetypeFor(seed, look, list) === JIN ? jinPersona(base) : null
  }
}
