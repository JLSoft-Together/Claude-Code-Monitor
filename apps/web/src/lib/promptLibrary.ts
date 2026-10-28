import type { BuildError } from '@ccm/shared'
import type { ChangeEntry } from './preview'

export const PROMPT_VARS = ['file', 'selection', 'branch', 'diffstat', 'checks', 'wt'] as const
export type PromptVar = (typeof PROMPT_VARS)[number]
export type PromptContext = Partial<Record<PromptVar, string>>

export interface SavedPrompt {
  id: string
  name: string
  text: string
  /** 'global' or a project's `dirKey`. */
  scope: string
}

export const MAX_PROMPTS = 200
export const MAX_PROMPT_BYTES = 8192
const MAX_NAME = 80
const VAR = /\{(file|selection|branch|diffstat|checks|wt)\}/g

const bytes = (s: string): number => new TextEncoder().encode(s).length

export function usedVars(template: string): PromptVar[] {
  return [...new Set([...template.matchAll(VAR)].map((m) => m[1] as PromptVar))]
}

export function missingVars(template: string, ctx: PromptContext): PromptVar[] {
  return usedVars(template).filter((v) => !ctx[v])
}

/** Known variables with a value are replaced; missing ones stay as `{name}` so the owner sees what to fill. */
export function expand(template: string, ctx: PromptContext): string {
  return template.replace(VAR, (whole, v: PromptVar) => ctx[v] || whole)
}

export function cleanPrompts(raw: unknown): SavedPrompt[] {
  if (!Array.isArray(raw)) return []
  const out: SavedPrompt[] = []
  const ids = new Set<string>()
  for (const r of raw) {
    if (out.length >= MAX_PROMPTS) break
    const p = r as Partial<SavedPrompt> | null
    if (!p || typeof p.id !== 'string' || !p.id || ids.has(p.id) || typeof p.name !== 'string' || typeof p.text !== 'string' || typeof p.scope !== 'string') continue
    const name = p.name.trim().slice(0, MAX_NAME)
    if (!name || !p.text.trim() || bytes(p.text) > MAX_PROMPT_BYTES || !p.scope) continue
    ids.add(p.id)
    out.push({ id: p.id, name, text: p.text, scope: p.scope })
  }
  return out
}

export const fitsPrompt = (text: string): boolean => !!text.trim() && bytes(text) <= MAX_PROMPT_BYTES

/** `{checks}`: up to 20 `file:line: message` lines, errors first. */
export function checksText(errors: readonly BuildError[], root?: string, max = 20): string {
  const base = root?.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()
  const rel = (f: string): string => {
    const norm = f.replace(/\\/g, '/')
    return base && norm.toLowerCase().startsWith(`${base}/`) ? norm.slice(base.length + 1) : norm
  }
  const sorted = [...errors].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))
  const lines = sorted.slice(0, max).map((e) => `${rel(e.file)}:${e.line}: ${e.message}`)
  if (errors.length > max) lines.push(`… +${errors.length - max}`)
  return lines.join('\n')
}

/** `{diffstat}`: "N files, +a −r" then one line per file (up to 20). */
export function diffstatText(entries: readonly ChangeEntry[], max = 20): string {
  if (!entries.length) return ''
  const added = entries.reduce((n, e) => n + (e.added ?? 0), 0)
  const removed = entries.reduce((n, e) => n + (e.removed ?? 0), 0)
  const head = `${entries.length} file${entries.length === 1 ? '' : 's'}, +${added} -${removed}`
  const rows = entries.slice(0, max).map((e) => `${e.path} (+${e.added ?? 0} -${e.removed ?? 0})`)
  if (entries.length > max) rows.push(`… +${entries.length - max}`)
  return [head, ...rows].join('\n')
}
