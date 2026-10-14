import { isRunLive, type BuildError, type EnvIssue, type RunConfig, type RunKind, type RunProject, type RunSession, type RunState } from '@ccm/shared'
import { dirKey } from '../stores/favorites'
import { isTerm, type Pane } from '../stores/workspace'
import { fileMention } from './promptAttachments'

/** `dir` is `root` or inside it. */
export function inRoot(dir: string, root: string): boolean {
  const d = dirKey(dir)
  const r = dirKey(root)
  return d === r || d.startsWith(`${r}\\`)
}

/**
 * i18n key for a backend issue: `run.<group>.<code>.<detail>` (install / launch reasons), then
 * `run.<group>.<code>.other`, then `run.<group>.<code>`, first group that has one; else `run.error.unknown`.
 */
export function issueKey(issue: EnvIssue, groups: readonly string[], te: (key: string) => boolean): { key: string; params: Record<string, string> } {
  const params = { detail: issue.detail ?? '', code: issue.code }
  for (const g of groups) {
    const base = `run.${g}.${issue.code}`
    if (issue.detail && te(`${base}.${issue.detail}`)) return { key: `${base}.${issue.detail}`, params }
    if (te(`${base}.other`)) return { key: `${base}.other`, params }
    if (te(base)) return { key: base, params }
  }
  return { key: 'run.error.unknown', params }
}

/** Empty `({detail})` / trailing `:` left by a missing detail are dropped. */
export const tidyIssueText = (text: string): string => text.replace(/\s*\(\)/, '').replace(/:\s*$/, '').replace(/:\s*\./, '.')

/** Running Claude / Codex pane inside the run root, most recently focused first (TermPane drops inserts into a starting pane). */
export function agentPaneFor(panes: readonly Pane[], root: string): Pane | null {
  const list = panes.filter((p) => isTerm(p) && p.preset !== 'shell' && p.state === 'running' && !!p.cwd && inRoot(p.cwd, root))
  list.sort((a, b) => (b.focusedAt ?? 0) - (a.focusedAt ?? 0))
  return list[0] ?? null
}

/** `@file:line:col message` on one line, the file relative to the agent's folder when inside it. */
export function errorPrompt(error: BuildError, cwd: string | undefined, win: boolean): string {
  return `${fileMention(error.file, cwd, win)}:${error.line}:${error.col} ${error.message.replace(/\s+/g, ' ').trim()}`
}

export type RunBadge = 'busy' | 'running' | 'failed'
const BUILDING: readonly RunState[] = ['before-launch', 'building', 'installing', 'launching', 'starting']

/** Building while any run is on its way up, Running while one is up, Failed when the newest run failed. */
export function runBadge(list: readonly RunSession[]): RunBadge | null {
  const live = list.filter((s) => isRunLive(s.state))
  if (live.some((s) => BUILDING.includes(s.state))) return 'busy'
  if (live.length) return 'running'
  const newest = list.reduce<RunSession | null>((a, s) => (!a || s.startedAt > a.startedAt ? s : a), null)
  return newest?.state === 'failed' ? 'failed' : null
}

export interface EnvRow {
  key: string
  value: string
}

export const envRows = (env: Record<string, string>): EnvRow[] => Object.entries(env).map(([key, value]) => ({ key, value }))

export function rowsToEnv(rows: readonly EnvRow[]): Record<string, string> {
  const env: Record<string, string> = {}
  for (const r of rows) if (r.key.trim()) env[r.key.trim()] = r.value
  return env
}

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/
const WORD = /^[A-Za-z0-9_]*$/

/** Codes under `run.configs.invalid` the backend would reject the config for. */
export function configIssues(cfg: RunConfig, rows: readonly EnvRow[]): { code: string; name?: string }[] {
  const out: { code: string; name?: string }[] = []
  if (!cfg.name.trim()) out.push({ code: 'name' })
  const seen = new Set<string>()
  for (const r of rows) {
    const key = r.key.trim()
    if (!key) continue
    if (!ENV_KEY.test(key)) out.push({ code: 'env', name: key })
    else if (seen.has(key)) out.push({ code: 'envDup', name: key })
    seen.add(key)
  }
  if (cfg.type === 'flutter') {
    if (!cfg.entrypoint.trim()) out.push({ code: 'entrypoint' })
    if (!WORD.test(cfg.flavor)) out.push({ code: 'flavor' })
  }
  if (cfg.type === 'android') {
    if (!cfg.module) out.push({ code: 'module' })
    if (!cfg.variant || !WORD.test(cfg.variant)) out.push({ code: 'variant' })
  }
  return out
}

export const appModules = (p: RunProject): string[] => (p.kind === 'android' ? p.modules.filter((m) => m.type === 'application' || m.guessed || m.launcher).map((m) => m.path) : [])

/** Blank config of `kind` pointed at the first matching project (the root for custom). */
export function newConfig(kind: RunKind, id: string, name: string, projects: readonly RunProject[], root: string): RunConfig {
  const base = { id, name, shared: false, env: {}, beforeLaunch: [] as string[] }
  if (kind === 'flutter') {
    const p = projects.find((x) => x.kind === 'flutter' && x.type === 'app') ?? projects.find((x) => x.kind === 'flutter')
    const entry = p?.kind === 'flutter' ? (p.entrypoints.find((e) => e === 'lib/main.dart') ?? p.entrypoints[0]) : undefined
    return { ...base, type: 'flutter', cwd: p?.dir ?? root, entrypoint: entry ?? 'lib/main.dart', device: 'selected', mode: 'debug', flavor: '', args: '', attachArgs: '' }
  }
  if (kind === 'android') {
    const p = projects.find((x) => x.kind === 'android' && appModules(x).length) ?? projects.find((x) => x.kind === 'android')
    return { ...base, type: 'android', cwd: p?.dir ?? root, module: (p && appModules(p)[0]) ?? ':app', variant: 'debug', device: 'selected', args: '' }
  }
  return { ...base, type: 'custom', cwd: root, command: '' }
}

export const cloneConfig = (cfg: RunConfig): RunConfig => JSON.parse(JSON.stringify(cfg)) as RunConfig

export function moveItem<T>(list: readonly T[], i: number, delta: number): T[] {
  const j = i + delta
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return [...list]
  const next = [...list]
  ;[next[i], next[j]] = [next[j]!, next[i]!]
  return next
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`
  return JSON.stringify(v)
}

export const sameConfig = (a: RunConfig, b: RunConfig): boolean => stable(a) === stable(b)

/**
 * What Apply writes. While the list is still the generated defaults (all `auto-` ids, nothing stored), the first save
 * would hide every other default, so the whole list is saved instead.
 */
export function configChanges(original: readonly RunConfig[], working: readonly RunConfig[]): { save: RunConfig[]; remove: string[] } {
  const before = new Map(original.map((c) => [c.id, c]))
  const ids = new Set(working.map((c) => c.id))
  const changed = working.filter((c) => !before.has(c.id) || !sameConfig(before.get(c.id)!, c))
  const removed = original.filter((c) => !ids.has(c.id)).map((c) => c.id)
  if (!changed.length && !removed.length) return { save: [], remove: [] }
  const defaults = original.length > 0 && original.every((c) => c.id.startsWith('auto-'))
  if (defaults) return { save: [...working], remove: [] }
  return { save: changed, remove: removed }
}
