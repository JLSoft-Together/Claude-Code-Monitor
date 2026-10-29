import type { Agent, CtxKind, CtxSource, CtxSources } from '@ccm/shared'
import { desktop } from './desktop'

const bridge = desktop as unknown as { ctxSources?: (cwd: string) => Promise<CtxSources> } | undefined

export const hasCtxSources = typeof bridge?.ctxSources === 'function'
/** Read from disk by desktop on each call (no watcher): paths, sizes, line counts. */
export const ctxSources = (cwd: string): Promise<CtxSources> => bridge?.ctxSources?.(cwd) ?? Promise.resolve({ ok: false, error: 'unavailable' })

export const CTX_GROUPS: readonly { id: string; kinds: readonly CtxKind[] }[] = [
  { id: 'instructions', kinds: ['managed', 'user', 'project', 'local', 'rules', 'import'] },
  { id: 'memory', kinds: ['memory-index', 'memory'] },
  { id: 'skills', kinds: ['skill'] },
  { id: 'mcp', kinds: ['mcp-config'] },
]

export interface CtxGroup {
  id: string
  files: CtxSource[]
  /** Bytes of the files read into every new session. */
  startBytes: number
}

export function groupSources(files: readonly CtxSource[]): CtxGroup[] {
  return CTX_GROUPS.map((g) => {
    const list = files.filter((f) => g.kinds.includes(f.kind))
    return { id: g.id, files: list, startBytes: list.filter((f) => f.load === 'start').reduce((n, f) => n + f.bytes, 0) }
  }).filter((g) => g.files.length)
}

export const startBytes = (files: readonly CtxSource[]): number => files.filter((f) => f.load === 'start').reduce((n, f) => n + f.bytes, 0)

/** File size as KB with one decimal under 10 KB; never converted to tokens. */
export function kb(bytes: number): string {
  const v = bytes / 1024
  return v < 10 ? v.toFixed(1) : String(Math.round(v))
}

/** Measured tokens of the session (collector usage), absent when Claude has not replied yet. */
export function measured(agent: Pick<Agent, 'firstContextTokens' | 'contextTokens' | 'contextWindow'> | undefined): { first?: number; now?: number; window?: number } {
  if (!agent) return {}
  return { first: agent.firstContextTokens, now: agent.contextTokens, window: agent.contextWindow }
}

/** `path` shown relative to `cwd` or `~` when inside them. */
export function displayPath(file: string, cwd: string, home: string | null): string {
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const f = norm(file)
  const win = /^[A-Za-z]:/.test(f)
  const starts = (base: string): boolean => {
    const b = norm(base)
    return !!b && (win ? f.toLowerCase().startsWith(`${b.toLowerCase()}/`) : f.startsWith(`${b}/`))
  }
  if (starts(cwd)) return f.slice(norm(cwd).length + 1)
  if (home && starts(home)) return `~/${f.slice(norm(home).length + 1)}`
  return f
}
