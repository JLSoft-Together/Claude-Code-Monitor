import { computed, watch, type ComputedRef } from 'vue'
import type { AndroidModule, RunProject } from '@ccm/shared'
import { hasRun } from '../lib/desktop'
import { dirKey } from '../stores/favorites'
import { useRunStore } from '../stores/run'

export interface RunMark {
  project: RunProject
  module?: AndroidModule
}

/** Explorer badges: detected Flutter / Android project folders and Android app module folders under `root`, by `dirKey`. */
export function useRunMarks(root: () => string | null): ComputedRef<Map<string, RunMark>> {
  const run = useRunStore()
  watch(
    root,
    (dir) => {
      if (!hasRun || !dir) return
      void run.ensure()
      if (!run.detected(dir)) void run.detect(dir)
    },
    { immediate: true },
  )
  return computed(() => {
    const out = new Map<string, RunMark>()
    const dir = root()
    if (!hasRun || !dir) return out
    for (const p of run.projectsFor(dir)) {
      if (p.kind === 'flutter' && p.type === 'dart') continue
      if (!out.has(dirKey(p.dir))) out.set(dirKey(p.dir), { project: p })
      if (p.kind !== 'android') continue
      for (const m of p.modules) if ((m.type === 'application' || m.guessed) && !out.has(dirKey(m.dir))) out.set(dirKey(m.dir), { project: p, module: m })
    }
    return out
  })
}
