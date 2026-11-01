import { promises as fs } from 'node:fs'
import path from 'node:path'
import { DENY_SCOPES, denyRulesFor, type DenyResult, type DenyScope } from '@ccm/shared'
import { formatSettings, jsonDiff, readSettings } from './permRules'
import { isWithin, realOrNull } from './paths'

/** Spec R5b names this suffix; the v72 allow path keeps its own `.ccm-backup`. */
export const DENY_BACKUP_SUFFIX = '.orrery-bak'
const REGISTRY_MAX_FILES = 300
const REGISTRY_FILE_MAX = 64 * 1024

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export const claudeConfigDir = (env: NodeJS.ProcessEnv, home: string): string => env.CLAUDE_CONFIG_DIR || path.join(home, '.claude')

export function denyFile(scope: DenyScope, project: string, configDir: string): string {
  if (scope === 'user') return path.join(configDir, 'settings.json')
  return path.join(project, '.claude', scope === 'project' ? 'settings.json' : 'settings.local.json')
}

/** `cwd` of every Claude Code session registry file (`<config>/sessions/<pid>.json`); nothing else is read. */
export async function sessionCwds(configDir: string): Promise<string[]> {
  const dir = path.join(configDir, 'sessions')
  const names = (await fs.readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith('.json')).slice(0, REGISTRY_MAX_FILES)
  const out = new Set<string>()
  for (const name of names) {
    const file = path.join(dir, name)
    const st = await fs.stat(file).catch(() => null)
    if (!st?.isFile() || st.size > REGISTRY_FILE_MAX) continue
    try {
      const o: unknown = JSON.parse(await fs.readFile(file, 'utf8'))
      if (isObj(o) && typeof o.cwd === 'string' && path.isAbsolute(o.cwd)) out.add(o.cwd)
    } catch {
      continue
    }
  }
  return [...out]
}

/**
 * A session folder, or the git root above one (sensitive hits name the repo root when known). Both sides are real
 * paths, so a page cannot point the write at an arbitrary folder.
 */
export async function isSessionProject(project: string, cwds: readonly string[], platform: NodeJS.Platform = process.platform): Promise<boolean> {
  const real = (await Promise.all(cwds.map(realOrNull))).filter((c): c is string => !!c)
  if (real.some((c) => isWithin(project, c, platform) && isWithin(c, project, platform))) return true
  if (!real.some((c) => isWithin(project, c, platform))) return false
  return !!(await fs.stat(path.join(project, '.git')).catch(() => null))
}

/** Settings with `rules` appended to `permissions.deny` (existing ones skipped); every other key and its order kept. */
export function planDeny(settings: Record<string, unknown>, rules: readonly string[]): { next: Record<string, unknown>; added: string[] } {
  const perms = isObj(settings.permissions) ? settings.permissions : {}
  const deny = Array.isArray(perms.deny) ? perms.deny : []
  const added = [...new Set(rules)].filter((r) => !deny.includes(r))
  return { next: { ...settings, permissions: { ...perms, deny: [...deny, ...added] } }, added }
}

export type ConfirmDeny = (req: { file: string; scope: DenyScope; added: string[]; diff: string }) => Promise<boolean>

export interface DenyWrite {
  /** Real path of an allowed project folder. */
  project: string
  rule: unknown
  tool: unknown
  scope: unknown
  configDir: string
}

/** Adds the deny rules of one sensitive hit to the chosen settings file after `confirm` saw the exact diff. */
export async function writeDeny(req: DenyWrite, confirm: ConfirmDeny): Promise<DenyResult> {
  if (typeof req.scope !== 'string' || !(DENY_SCOPES as readonly string[]).includes(req.scope)) return { ok: false, error: 'invalid' }
  const scope = req.scope as DenyScope
  const rules = denyRulesFor(req.rule, req.tool)
  if (!rules.length) return { ok: false, error: 'invalid' }
  const file = denyFile(scope, req.project, req.configDir)
  const dir = path.dirname(file)
  if (scope !== 'user') {
    const realDir = await realOrNull(dir)
    if (realDir && !isWithin(req.project, realDir)) return { ok: false, error: 'denied' }
    const realFile = await realOrNull(file)
    if (realFile && !isWithin(req.project, realFile)) return { ok: false, error: 'denied' }
  }
  const read = await readSettings(file)
  if (read.state === 'unreadable' || !read.settings) return { ok: false, error: 'unreadable' }
  const { next, added } = planDeny(read.settings, rules)
  if (!added.length) return { ok: true, scope, added: [] }
  const text = formatSettings(next, read.text)
  if (!(await confirm({ file, scope, added, diff: jsonDiff(read.text, text) }))) return { ok: false, error: 'cancelled' }
  const again = await readSettings(file)
  if (again.text !== read.text || again.state !== read.state) return { ok: false, error: 'changed' }
  const tmp = `${file}.orrery-tmp`
  try {
    await fs.mkdir(dir, { recursive: true })
    if (read.state === 'ok') await fs.copyFile(file, `${file}${DENY_BACKUP_SUFFIX}`)
    await fs.writeFile(tmp, text)
    await fs.rename(tmp, file)
    return { ok: true, scope, added }
  } catch {
    await fs.rm(tmp, { force: true }).catch(() => undefined)
    return { ok: false, error: 'failed' }
  }
}
