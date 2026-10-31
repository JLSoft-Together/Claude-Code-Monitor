import os from 'node:os'
import path from 'node:path'
import {
  defaultSensitiveSettings,
  sanitizeGlobs,
  sanitizeGroups,
  sanitizeIgnore,
  sanitizeSensitive,
  isSensitiveRule,
  MAX_IGNORE_PROJECTS,
  type SensitiveSettings,
} from '@ccm/shared'
import { JsonFile } from '../json-file'
import { classifyTouch, type SensitiveHit, type ToolTouch } from './rules'

export const SENSITIVE_FILE = 'sensitive.json'
/** The same rule on the same path in one session is reported once in this window. */
const REPEAT_MS = 10 * 60_000
const MAX_SEEN = 2000

export interface WatchDeps {
  claudeRoot: string
  home?: string
  tmp?: string
  win?: boolean
  now?: () => number
  /** Repo root of a session folder when known (store roots), so a monorepo subfolder session may edit siblings. */
  rootOf?: (cwd: string) => string | undefined
}

export interface SensitivePatch {
  groups?: Partial<SensitiveSettings['groups']>
  globs?: string[]
  ignore?: Record<string, string[]>
}

export class SensitiveWatch {
  private value: SensitiveSettings = defaultSensitiveSettings()
  private readonly seen = new Map<string, number>()
  private readonly file: JsonFile | null
  private readonly home: string
  private readonly win: boolean
  onChange: (settings: SensitiveSettings) => void = () => undefined

  constructor(
    private readonly deps: WatchDeps,
    file?: string,
  ) {
    this.file = file ? new JsonFile(file, 300) : null
    this.home = deps.home ?? os.homedir()
    this.win = deps.win ?? process.platform === 'win32'
  }

  async load(): Promise<void> {
    this.value = sanitizeSensitive(await this.file?.read())
  }

  get settings(): SensitiveSettings {
    return this.value
  }

  update(patch: SensitivePatch): void {
    const groups = patch.groups ? sanitizeGroups(patch.groups) : null
    const globs = patch.globs ? sanitizeGlobs(patch.globs) : null
    const ignore = patch.ignore ? sanitizeIgnore(patch.ignore) : null
    this.value = {
      groups: { ...this.value.groups, ...(groups ?? {}) },
      globs: globs ?? this.value.globs,
      ignore: ignore ?? this.value.ignore,
    }
    this.save()
  }

  ignore(project: string, rule: string, on: boolean): boolean {
    if (!project || project.length > 1024 || !isSensitiveRule(rule)) return false
    const ignore = { ...this.value.ignore }
    const list = new Set(ignore[project] ?? [])
    if (on) list.add(rule)
    else list.delete(rule)
    if (list.size) ignore[project] = [...list]
    else delete ignore[project]
    if (Object.keys(ignore).length > MAX_IGNORE_PROJECTS) return false
    this.value = { ...this.value, ignore }
    this.save()
    return true
  }

  flush(): Promise<void> {
    return this.file?.flush() ?? Promise.resolve()
  }

  /** New hits of one tool call; repeats of the same rule + path in a session within 10 minutes are dropped. */
  check(terminalId: string, touch: ToolTouch, cwd: string | undefined, atMs?: number): (SensitiveHit & { project?: string })[] {
    const project = cwd ? (this.deps.rootOf?.(cwd) ?? cwd) : undefined
    const hits = classifyTouch(touch, {
      project,
      projectKey: cwd,
      home: this.home,
      win: this.win,
      safeDirs: this.safeDirs(cwd),
      settings: this.value,
    })
    if (!hits.length) return []
    const now = atMs ?? this.deps.now?.() ?? Date.now()
    this.prune(now)
    return hits
      .filter((h) => {
        const key = `${terminalId}|${h.rule}|${h.path ?? ''}`
        const last = this.seen.get(key)
        this.seen.set(key, now)
        return last === undefined || now - last >= REPEAT_MS
      })
      .map((h) => (cwd ? { ...h, project: cwd } : h))
  }

  private safeDirs(cwd: string | undefined): string[] {
    const root = this.deps.claudeRoot
    const dirs = [path.join(root, 'plans'), path.join(root, 'todos'), path.join(this.deps.tmp ?? os.tmpdir(), 'claude')]
    if (cwd) dirs.push(path.join(root, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-')))
    return dirs
  }

  private prune(now: number): void {
    if (this.seen.size < MAX_SEEN) return
    for (const [k, at] of this.seen) if (now - at >= REPEAT_MS) this.seen.delete(k)
  }

  private save(): void {
    this.onChange(this.value)
    this.file?.schedule(() => this.value)
  }
}
