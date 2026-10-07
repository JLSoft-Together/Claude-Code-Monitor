import { CONTEXT_WINDOW_1M } from '@ccm/shared'

const FAMILY = /^(opus|sonnet|haiku|fable)$/i
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()

/** "claude-opus-5-5" → "Opus 5.5" (catalog name when known, else parsed); unknown ids pass through. */
export function modelLabel(id: string | undefined, contextWindow?: number, names: Record<string, string> = {}): string | null {
  if (!id) return null
  const bare = id.replace(/\[.*\]$/, '')
  const parts = bare.split('-').filter((p) => p !== 'claude' && !/^\d{8}$/.test(p))
  const family = parts.find((p) => FAMILY.test(p))
  const version = parts.filter((p) => /^\d{1,2}$/.test(p)).join('.')
  const base = names[bare] ?? (family ? `${cap(family)}${version ? ` ${version}` : ''}` : id)
  return contextWindow !== undefined && contextWindow >= CONTEXT_WINDOW_1M ? `${base} · 1M` : base
}

/** Localized effort name; unknown levels pass through so a new Claude level still shows. */
export function effortLabel(effort: string | undefined, t: (key: string) => string): string | null {
  if (!effort) return null
  return EFFORTS.has(effort) ? t(`effort.${effort}`) : effort
}
