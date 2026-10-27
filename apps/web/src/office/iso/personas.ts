import { setPersonaOverride } from '@ccm/habblaud/client/src/world/social/persona'
import { archetypesOf, DEFAULT_ARCHETYPES, jinOverride, type Archetype, type Look } from './archetypes'
import { isoArt } from './isoArt'

export function installPersonas(lookOf: (seed: number) => Look | undefined, source?: Promise<readonly Archetype[]>): () => void {
  let live = true
  setPersonaOverride(jinOverride(lookOf))
  const list = source ?? isoArt().then(archetypesOf)
  void list
    .catch(() => DEFAULT_ARCHETYPES)
    .then((l) => {
      if (live) setPersonaOverride(jinOverride(lookOf, l))
    })
  return () => {
    if (!live) return
    live = false
    setPersonaOverride(null)
  }
}
