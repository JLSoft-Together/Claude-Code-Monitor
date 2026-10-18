import { isRunLive, type BuildError, type EnvIssue, type FlutterPlatform, type RunConfig, type RunDevice, type RunKind, type RunProject, type RunSession, type RunState, type RunTemplates } from '@ccm/shared'
import { dirKey } from '../stores/favorites'
import { isTerm, presetOf, type Pane } from '../stores/workspace'
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
  const list = panes.filter((p) => isTerm(p) && presetOf(p) !== 'shell' && p.state === 'running' && !!p.cwd && inRoot(p.cwd, root))
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

/** Blank config of `kind` pointed at the first matching project (the root for custom), template defaults applied. */
export function newConfig(kind: RunKind, id: string, name: string, projects: readonly RunProject[], root: string, templates?: RunTemplates | null): RunConfig {
  const base = { id, name, shared: false, env: {}, beforeLaunch: [] as string[] }
  if (kind === 'flutter') {
    const p = projects.find((x) => x.kind === 'flutter' && x.type === 'app') ?? projects.find((x) => x.kind === 'flutter')
    const entry = p?.kind === 'flutter' ? (p.entrypoints.find((e) => e === 'lib/main.dart') ?? p.entrypoints[0]) : undefined
    const t = templates?.flutter
    const flavor = t?.flavor && p?.kind === 'flutter' && p.flavors.includes(t.flavor) ? t.flavor : ''
    return { ...base, type: 'flutter', cwd: p?.dir ?? root, entrypoint: entry ?? 'lib/main.dart', device: 'selected', mode: t?.mode ?? 'debug', flavor, args: t?.args ?? '', attachArgs: '' }
  }
  if (kind === 'android') {
    const p = projects.find((x) => x.kind === 'android' && appModules(x).length) ?? projects.find((x) => x.kind === 'android')
    return { ...base, type: 'android', cwd: p?.dir ?? root, module: (p && appModules(p)[0]) ?? ':app', variant: templates?.android.variant ?? 'debug', device: 'selected', args: templates?.android.args ?? '' }
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

const PLATFORM_OF: [RegExp, FlutterPlatform][] = [
  [/^android/, 'android'],
  [/^ios/, 'ios'],
  [/^web/, 'web'],
  [/^windows/, 'windows'],
  [/^(darwin|macos)/, 'macos'],
  [/^linux/, 'linux'],
]

/** Flutter plan §4: only devices of a platform folder the project has (no `web/` → no Chrome). Unknown platforms stay. */
export function fitsPlatforms(device: RunDevice, platforms: readonly FlutterPlatform[]): boolean {
  if (!platforms.length) return true
  const hit = PLATFORM_OF.find(([re]) => re.test(device.platform))
  return !hit || platforms.includes(hit[1])
}

/** Raw build / Gradle / Xcode output lines worth highlighting in the Build tab (plan §6 "highlight dòng lỗi"). */
const ERROR_LINE = /(^|\s)(e: |error:|Error:|ERROR:|FAILURE:|BUILD FAILED|FAILED$|\* What went wrong|Exception\b|Execution failed|Unhandled exception|AAPT: error|Could not resolve)/

export const isErrorLine = (text: string): boolean => ERROR_LINE.test(text)

export interface ProjectMark {
  kind: 'flutter' | 'android'
  /** i18n key under `run.project.*` naming the framework / project type. */
  label: string
  /** Not runnable / module types unknown: shown with a "?" mark. */
  unsure: boolean
  /** i18n key under `run.project.reason.*`, null when it simply runs. */
  reason: string | null
  runnable: boolean
}

/** Framework, guessed / unknown state and why a project can't run (Explorer badge, empty state, Run bar tooltip). */
export function projectMark(p: RunProject): ProjectMark {
  if (p.kind === 'flutter') {
    const runnable = p.type === 'app' || !!p.example
    const reason = p.type === 'app' ? null : p.type === 'plugin' ? (p.example ? 'pluginExample' : 'plugin') : p.type
    return { kind: 'flutter', label: `type.${p.type}`, unsure: !runnable, reason, runnable }
  }
  const guessed = p.modules.some((m) => m.guessed)
  const runnable = p.status === 'runnable' || p.modules.some((m) => m.launcher)
  const reason = p.status === 'no-app' ? 'no-app' : p.status === 'unknown' ? 'unknown' : guessed ? 'guessed' : null
  return { kind: 'android', label: `framework.${p.framework}`, unsure: p.status !== 'runnable' || guessed, reason, runnable }
}

/** Determinate step of the Android pipeline (build → install → launch); null = indeterminate / idle. */
export function runStep(session: RunSession | null): { n: number; total: number } | null {
  if (!session || session.type !== 'android') return null
  const at = (['building', 'installing', 'launching'] as const).indexOf(session.state as 'building')
  return at < 0 ? null : { n: at + 1, total: 3 }
}
