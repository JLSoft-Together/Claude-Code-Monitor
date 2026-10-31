import { CUSTOM_PREFIX, COMMAND_RULES, OUTSIDE_RULE } from '@ccm/shared'

/** i18n key for built-in command / outside rules; file globs are shown as they are. */
export function ruleKey(rule: string | undefined): string | null {
  if (!rule) return null
  return rule === OUTSIDE_RULE || rule in COMMAND_RULES ? `sensitive.rule.${rule}` : null
}

export function ruleText(rule: string | undefined, t: (key: string) => string): string {
  const key = ruleKey(rule)
  if (key) return t(key)
  return (rule ?? '?').startsWith(CUSTOM_PREFIX) ? rule!.slice(CUSTOM_PREFIX.length) : (rule ?? '?')
}

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** Path of `file` inside `root`, forward slashes; null when outside. */
export function relInside(file: string, root: string): string | null {
  const f = file.replace(/\\/g, '/')
  const r = root.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!norm(f).startsWith(`${norm(r)}/`)) return null
  return f.slice(r.length + 1)
}

export const folderName = (dir: string): string => dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || dir
