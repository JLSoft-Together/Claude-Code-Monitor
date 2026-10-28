import type { BuildError } from '@ccm/shared'
import type { CheckRequest } from './preview'
import type { ScriptsResult } from './projects'

export interface CheckOption extends CheckRequest {
  label: string
}

const CHECK_NAME = /^(?:typecheck|type-check|types|tsc|check|lint|test|tests|analyze|analyse|vet|verify)(?::[\w.-]+)?$/
const RUNNERS = new Set(['npm', 'pnpm', 'yarn', 'bun', 'make', 'just', 'cargo', 'python'])

/** Scripts that look like checks (typecheck / lint / test …), plus `flutter analyze` in a Flutter project. */
export function checkOptions(scripts: ScriptsResult | null, flutter: boolean): CheckOption[] {
  const out: CheckOption[] = []
  for (const g of scripts?.groups ?? []) {
    if (!RUNNERS.has(g.source)) continue
    for (const item of g.items) if (CHECK_NAME.test(item.name)) out.push({ source: g.source, name: item.name, label: item.run })
  }
  if (flutter) out.push({ source: 'flutter', name: 'analyze', label: 'flutter analyze' })
  return out.slice(0, 20)
}

export const checkKey = (c: CheckRequest): string => `${c.source}:${c.name}`

/** Errors per file, files in first-seen order, errors before warnings inside a file. */
export function groupErrors(errors: readonly BuildError[]): { file: string; items: BuildError[] }[] {
  const map = new Map<string, BuildError[]>()
  for (const e of errors) {
    const list = map.get(e.file) ?? []
    list.push(e)
    map.set(e.file, list)
  }
  return [...map].map(([file, items]) => ({ file, items: items.sort((a, b) => (a.severity === b.severity ? a.line - b.line : a.severity === 'error' ? -1 : 1)) }))
}
