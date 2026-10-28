import type { BuildError } from '@ccm/shared'
import { pathKey } from './changesView'

export interface ProblemRun {
  label: string
  at: number
  errors: readonly BuildError[]
}

export interface FileProblems {
  items: BuildError[]
  errors: number
  warnings: number
  label: string
  at: number
}

/** Problems of one file from the latest run of each check, sorted by line. */
export function problemsFor(runs: readonly ProblemRun[], path: string): FileProblems | null {
  const key = pathKey(path)
  let best: FileProblems | null = null
  for (const run of runs) {
    const items = run.errors.filter((e) => pathKey(e.file) === key)
    if (!items.length) continue
    if (!best) best = { items: [], errors: 0, warnings: 0, label: run.label, at: run.at }
    else best.label = `${best.label}, ${run.label}`
    best.items.push(...items)
    best.at = Math.min(best.at, run.at)
  }
  if (!best) return null
  best.items.sort((a, b) => a.line - b.line || a.col - b.col)
  best.errors = best.items.filter((e) => e.severity === 'error').length
  best.warnings = best.items.length - best.errors
  return best
}

/** Worst severity per file key, for marking names in the Explorer tree. */
export function problemFiles(runs: readonly ProblemRun[]): Map<string, 'error' | 'warning'> {
  const out = new Map<string, 'error' | 'warning'>()
  for (const run of runs)
    for (const e of run.errors) {
      const key = pathKey(e.file)
      if (out.get(key) !== 'error') out.set(key, e.severity)
    }
  return out
}

/** Index of the next (dir 1) or previous (dir -1) problem after / before `line`, wrapping around. */
export function stepProblem(items: readonly BuildError[], line: number, dir: 1 | -1): number {
  if (!items.length) return -1
  if (dir === 1) {
    const i = items.findIndex((e) => e.line > line)
    return i === -1 ? 0 : i
  }
  for (let i = items.length - 1; i >= 0; i--) if (items[i]!.line < line) return i
  return items.length - 1
}
