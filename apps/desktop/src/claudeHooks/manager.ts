import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import {
  HOOK_TEST_OUTPUT_MAX,
  HOOK_TEST_TIMEOUT_MS,
  hookEventRank,
  type HookFileState,
  type HookRow,
  type HookSource,
  type HooksListResult,
  type HookTestResult,
  type HookToggleResult,
} from '@ccm/shared'
import { claudeRoot, sameDir } from '../extensions/status'
import { formatSettings, jsonDiff } from '../preview/permRules'
import { isWithin, realOrNull } from '../preview/paths'
import { killTree } from '../run/proc'
import { BACKUP_SUFFIX } from '../statusline'
import {
  clipOutput,
  fakePayload,
  flattenHooks,
  hasHookEntry,
  hookKey,
  hookText,
  isObj,
  isOrreryHook,
  maskHookText,
  normFile,
  removeHookEntry,
  restoreHookEntry,
  type FlatHook,
  type Obj,
} from './model'

export const HOOKS_STASH_FILE = 'hooks-disabled.json'
const JSON_MAX = 512 * 1024
const CAPTURE_MAX = 64 * 1024
const ID_RE = /^[0-9a-f]{24}$/

type FileSource = Exclude<HookSource, 'plugin'>

interface JsonRead {
  state: HookFileState
  text: string
  data: Obj | null
  mtimeMs: number
}

interface StashEntry {
  key: string
  file: string
  event: string
  matcher: string | null
  hook: Obj
  at: string
}

interface Found {
  row: HookRow
  flat: FlatHook
  file: string
  pluginRoot?: string
}

export type SpawnFn = (file: string, args: string[], opts: SpawnOptions) => ChildProcess

export interface HooksManagerDeps {
  env: NodeJS.ProcessEnv
  home: string
  platform: NodeJS.Platform
  dataDir: string
  confirmWrite: (req: { file: string; action: 'disable' | 'enable'; event: string; diff: string }) => Promise<boolean>
  confirmTest: (req: { event: string; text: string; cwd: string }) => Promise<boolean>
  spawn?: SpawnFn
}

async function readJson(file: string): Promise<JsonRead> {
  try {
    const st = await fs.stat(file)
    if (!st.isFile() || st.size > JSON_MAX) return { state: 'unreadable', text: '', data: null, mtimeMs: 0 }
    const text = await fs.readFile(file, 'utf8')
    try {
      const v: unknown = text.trim() ? JSON.parse(text.replace(/^﻿/, '')) : {}
      if (!isObj(v) || (v.hooks !== undefined && !isObj(v.hooks))) return { state: 'unreadable', text, data: null, mtimeMs: st.mtimeMs }
      return { state: 'ok', text, data: v, mtimeMs: st.mtimeMs }
    } catch {
      return { state: 'unreadable', text, data: null, mtimeMs: st.mtimeMs }
    }
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT' ? { state: 'none', text: '', data: {}, mtimeMs: 0 } : { state: 'unreadable', text: '', data: null, mtimeMs: 0 }
  }
}

async function writeAtomic(file: string, text: string, backup: boolean): Promise<boolean> {
  const tmp = `${file}.ccm-tmp`
  try {
    await fs.mkdir(path.dirname(file), { recursive: true })
    if (backup) await fs.copyFile(file, `${file}${BACKUP_SUFFIX}`)
    await fs.writeFile(tmp, text)
    await fs.rename(tmp, file)
    return true
  } catch {
    await fs.rm(tmp, { force: true }).catch(() => undefined)
    return false
  }
}

const ENV_KEEP = new Set(['PATH', 'PATHEXT', 'HOME', 'USERPROFILE', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'APPDATA', 'LOCALAPPDATA', 'LANG', 'CLAUDE_CONFIG_DIR'])

/** Only what a shell and the usual hook runtimes need to start: no tokens, no app key, no parent session vars. */
export function testEnv(env: NodeJS.ProcessEnv, projectDir: string, pluginRoot?: string): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(env)) if (v !== undefined && ENV_KEEP.has(k.toUpperCase())) out[k] = v
  out.CLAUDE_PROJECT_DIR = projectDir
  if (pluginRoot) out.CLAUDE_PLUGIN_ROOT = pluginRoot
  return out
}

/** How Claude Code runs a command hook: exec form with `args`, PowerShell when asked, else bash (Git Bash on Windows, PowerShell without it). */
export function shellFor(hook: Obj, command: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform, exists: (p: string) => boolean = existsSync): { file: string; args: string[] } {
  if (Array.isArray(hook.args)) return { file: command, args: hook.args.filter((a): a is string => typeof a === 'string') }
  const ps = (): { file: string; args: string[] } => ({ file: platform === 'win32' ? 'powershell.exe' : 'pwsh', args: ['-NoProfile', '-NonInteractive', '-Command', command] })
  if (hook.shell === 'powershell') return ps()
  if (platform === 'win32') {
    const candidates = [
      env.CLAUDE_CODE_GIT_BASH_PATH,
      env.ProgramFiles && path.win32.join(env.ProgramFiles, 'Git', 'bin', 'bash.exe'),
      env['ProgramFiles(x86)'] && path.win32.join(env['ProgramFiles(x86)'], 'Git', 'bin', 'bash.exe'),
      env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'),
    ]
    const bash = candidates.find((c): c is string => !!c && exists(c))
    return bash ? { file: bash, args: ['-c', command] } : ps()
  }
  const sh = env.SHELL && /\/(?:bash|zsh|sh)$/.test(env.SHELL) ? env.SHELL : '/bin/sh'
  return { file: sh, args: ['-c', command] }
}

const expandPluginRoot = (s: string, root?: string): string => (root ? s.split('${CLAUDE_PLUGIN_ROOT}').join(root) : s)

export class HooksManager {
  private busy = false
  private testing = false
  private readonly approved = new Set<string>()
  private readonly spawn: SpawnFn

  constructor(private readonly deps: HooksManagerDeps) {
    this.spawn = deps.spawn ?? ((file, args, opts) => nodeSpawn(file, args, opts))
  }

  private get root(): string {
    return claudeRoot(this.deps.env, this.deps.home)
  }

  private stashFile(): string {
    return path.join(this.deps.dataDir, HOOKS_STASH_FILE)
  }

  private files(dir: string | null): { source: FileSource; file: string }[] {
    const out: { source: FileSource; file: string }[] = [{ source: 'user', file: path.join(this.root, 'settings.json') }]
    if (dir) out.push({ source: 'project', file: path.join(dir, '.claude', 'settings.json') }, { source: 'local', file: path.join(dir, '.claude', 'settings.local.json') })
    return out
  }

  private async readStash(): Promise<StashEntry[]> {
    const r = await readJson(this.stashFile())
    const list = r.data && Array.isArray(r.data.entries) ? r.data.entries : []
    return list.filter(
      (e): e is StashEntry =>
        isObj(e) && typeof e.key === 'string' && typeof e.file === 'string' && typeof e.event === 'string' && (e.matcher === null || typeof e.matcher === 'string') && isObj(e.hook),
    )
  }

  private writeStash(entries: StashEntry[]): Promise<boolean> {
    return writeAtomic(this.stashFile(), `${JSON.stringify({ version: 1, entries }, null, 2)}\n`, false)
  }

  private row(file: string, flat: FlatHook, source: HookSource, enabled: boolean, extra: Partial<HookRow> = {}): HookRow {
    const { platform, home } = this.deps
    const orrery = isOrreryHook(flat.hook)
    const type = typeof flat.hook.type === 'string' ? flat.hook.type : 'unknown'
    return {
      id: hookKey(file, flat, platform),
      event: flat.event,
      matcher: flat.matcher,
      type,
      text: maskHookText(hookText(flat.hook), home, platform).slice(0, 2000),
      timeout: typeof flat.hook.timeout === 'number' ? flat.hook.timeout : null,
      async: flat.hook.async === true,
      source,
      orrery,
      enabled,
      toggleable: source !== 'plugin' && !orrery,
      testable: !orrery && type === 'command' && typeof flat.hook.command === 'string',
      ...extra,
    }
  }

  private async pluginHooks(dir: string | null, enabledMap: Map<string, boolean>): Promise<Found[]> {
    const { platform } = this.deps
    const pluginsDir = path.join(this.root, 'plugins')
    const realPlugins = await realOrNull(pluginsDir)
    const installed = await readJson(path.join(pluginsDir, 'installed_plugins.json'))
    const plugins = installed.data && isObj(installed.data.plugins) ? installed.data.plugins : {}
    const out: Found[] = []
    for (const [id, entries] of Object.entries(plugins)) {
      if (!Array.isArray(entries)) continue
      const entry = entries.find(
        (e) => isObj(e) && typeof e.installPath === 'string' && (e.scope === 'user' || (!!dir && typeof e.projectPath === 'string' && sameDir(e.projectPath, dir, platform))),
      ) as Obj | undefined
      if (!entry || !realPlugins) continue
      const real = await realOrNull(entry.installPath as string)
      if (!real || !isWithin(realPlugins, real, platform)) continue
      const sources: string[] = [path.join(real, 'hooks', 'hooks.json')]
      const manifest = await readJson(path.join(real, '.claude-plugin', 'plugin.json'))
      const inline = manifest.data?.hooks
      const refs = typeof inline === 'string' ? [inline] : Array.isArray(inline) ? inline.filter((x): x is string => typeof x === 'string') : []
      for (const ref of refs) sources.push(path.resolve(real, ref))
      const seen = new Set<string>()
      const add = (file: string, hooks: unknown): void => {
        for (const flat of flattenHooks(hooks)) out.push({ flat, file, pluginRoot: real, row: this.row(file, flat, 'plugin', enabledMap.get(id) !== false, { plugin: id, pluginEnabled: enabledMap.get(id) !== false }) })
      }
      if (isObj(inline)) add(path.join(real, '.claude-plugin', 'plugin.json'), isObj(inline.hooks) ? inline.hooks : inline)
      for (const file of sources) {
        if (!isWithin(real, file, platform) || seen.has(normFile(file, platform))) continue
        seen.add(normFile(file, platform))
        const r = await readJson(file)
        if (r.state === 'ok' && r.data) add(file, r.data.hooks)
      }
    }
    return out
  }

  private async collect(dir: string | null): Promise<{ found: Found[]; files: { source: FileSource; state: HookFileState }[]; disableAll: boolean; reads: Map<string, JsonRead> }> {
    const { platform } = this.deps
    const files = this.files(dir)
    const reads = new Map<string, JsonRead>()
    for (const f of files) reads.set(f.file, await readJson(f.file))
    const found: Found[] = []
    const enabledMap = new Map<string, boolean>()
    let disableAll = false
    for (const f of files) {
      const r = reads.get(f.file)!
      if (r.state !== 'ok' || !r.data) continue
      if (r.data.disableAllHooks === true) disableAll = true
      if (isObj(r.data.enabledPlugins)) for (const [id, on] of Object.entries(r.data.enabledPlugins)) if (typeof on === 'boolean') enabledMap.set(id, on)
      for (const flat of flattenHooks(r.data.hooks)) found.push({ flat, file: f.file, row: this.row(f.file, flat, f.source, true) })
    }
    const stash = await this.readStash()
    for (const f of files) {
      const r = reads.get(f.file)!
      for (const e of stash) {
        if (normFile(e.file, platform) !== normFile(f.file, platform)) continue
        const flat: FlatHook = { event: e.event, matcher: e.matcher, hook: e.hook }
        if (r.data && hasHookEntry(r.data, flat)) continue
        found.push({ flat, file: f.file, row: this.row(f.file, flat, f.source, false) })
      }
    }
    found.push(...(await this.pluginHooks(dir, enabledMap)))
    found.sort((a, b) => hookEventRank(a.row.event) - hookEventRank(b.row.event) || a.row.event.localeCompare(b.row.event))
    return { found, files: files.map((f) => ({ source: f.source, state: reads.get(f.file)!.state })), disableAll, reads }
  }

  async list(dir: string | null): Promise<HooksListResult> {
    const { found, files, disableAll } = await this.collect(dir)
    return { ok: true, dir, rows: found.map((f) => f.row), files, disableAll }
  }

  /** Settings file of a row must sit where it claims: project files inside the project, the user file inside the Claude root. */
  private async fileAllowed(file: string, dir: string | null): Promise<boolean> {
    const { platform } = this.deps
    const base = dir && isWithin(dir, file, platform) ? dir : this.root
    const realBase = (await realOrNull(base)) ?? base
    for (const p of [path.dirname(file), file]) {
      const real = await realOrNull(p)
      if (real && !isWithin(realBase, real, platform)) return false
    }
    return true
  }

  async toggle(id: unknown, dir: string | null, on: unknown): Promise<HookToggleResult> {
    if (typeof id !== 'string' || !ID_RE.test(id) || typeof on !== 'boolean') return { ok: false, error: 'invalid' }
    if (this.busy) return { ok: false, error: 'busy' }
    this.busy = true
    try {
      const { found } = await this.collect(dir)
      const hit = found.find((f) => f.row.id === id && f.row.enabled !== on)
      if (!hit) return { ok: false, error: 'notFound' }
      if (hit.row.orrery) return { ok: false, error: 'orrery' }
      if (hit.row.source === 'plugin') return { ok: false, error: 'readOnly' }
      if (!(await this.fileAllowed(hit.file, dir))) return { ok: false, error: 'denied' }
      const read = await readJson(hit.file)
      if (read.state === 'unreadable' || !read.data || (!on && read.state !== 'ok')) return { ok: false, error: 'unreadable' }
      const next = on ? restoreHookEntry(read.data, hit.flat) : removeHookEntry(read.data, hit.flat)
      if (!next) return { ok: false, error: 'notFound' }
      const stash = await this.readStash()
      const rest = stash.filter((e) => e.key !== id)
      if (next === read.data) return (await this.writeStash(rest)) ? { ok: true } : { ok: false, error: 'failed' }
      const text = formatSettings(next, read.text)
      const { home, platform } = this.deps
      const diff = jsonDiff(read.text, text)
        .split('\n')
        .map((l) => maskHookText(l, home, platform))
        .join('\n')
      if (!(await this.deps.confirmWrite({ file: hit.file, action: on ? 'enable' : 'disable', event: hit.flat.event, diff }))) return { ok: false, error: 'cancelled' }
      const again = await readJson(hit.file)
      if (again.text !== read.text || again.state !== read.state || again.mtimeMs !== read.mtimeMs) return { ok: false, error: 'changed' }
      if (on) {
        if (!(await writeAtomic(hit.file, text, read.state === 'ok'))) return { ok: false, error: 'failed' }
        await this.writeStash(rest)
        return { ok: true }
      }
      const entry: StashEntry = { key: id, file: hit.file, event: hit.flat.event, matcher: hit.flat.matcher, hook: hit.flat.hook, at: new Date().toISOString() }
      if (!(await this.writeStash([...rest, entry]))) return { ok: false, error: 'failed' }
      if (await writeAtomic(hit.file, text, true)) return { ok: true }
      await this.writeStash(stash)
      return { ok: false, error: 'failed' }
    } finally {
      this.busy = false
    }
  }

  async test(id: unknown, dir: string | null): Promise<HookTestResult> {
    if (typeof id !== 'string' || !ID_RE.test(id)) return { ok: false, error: 'invalid' }
    if (this.testing) return { ok: false, error: 'busy' }
    this.testing = true
    try {
      const { found } = await this.collect(dir)
      const hit = found.find((f) => f.row.id === id)
      if (!hit) return { ok: false, error: 'notFound' }
      if (!hit.row.testable || typeof hit.flat.hook.command !== 'string') return { ok: false, error: 'notTestable' }
      const { env, home, platform } = this.deps
      const cwd = dir ?? home
      if (!this.approved.has(id)) {
        if (!(await this.deps.confirmTest({ event: hit.flat.event, text: hit.row.text, cwd: maskHookText(cwd, home, platform) }))) return { ok: false, error: 'cancelled' }
        this.approved.add(id)
      }
      const command = expandPluginRoot(hit.flat.hook.command, hit.pluginRoot)
      const hookForShell = Array.isArray(hit.flat.hook.args) ? { ...hit.flat.hook, args: hit.flat.hook.args.map((a) => (typeof a === 'string' ? expandPluginRoot(a, hit.pluginRoot) : a)) } : hit.flat.hook
      const spec = shellFor(hookForShell, command, env, platform)
      const payload = `${JSON.stringify(fakePayload(hit.flat.event, hit.flat.matcher, cwd, `orrery-test-${randomUUID()}`))}\n`
      return await this.run(spec, cwd, testEnv(env, cwd, hit.pluginRoot), payload)
    } finally {
      this.testing = false
    }
  }

  private run(spec: { file: string; args: string[] }, cwd: string, env: NodeJS.ProcessEnv, stdin: string): Promise<HookTestResult> {
    const { home, platform } = this.deps
    return new Promise((resolve) => {
      const started = Date.now()
      let child: ChildProcess
      try {
        child = this.spawn(spec.file, spec.args, { cwd, env, windowsHide: true, shell: false, detached: platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
      } catch {
        resolve({ ok: false, error: 'spawn' })
        return
      }
      let out = ''
      let err = ''
      let timedOut = false
      let done = false
      const take = (cur: string, chunk: Buffer): string => (cur + chunk.toString('utf8')).slice(-CAPTURE_MAX)
      child.stdout?.on('data', (c: Buffer) => (out = take(out, c)))
      child.stderr?.on('data', (c: Buffer) => (err = take(err, c)))
      const timer = setTimeout(() => {
        timedOut = true
        killTree(child)
      }, HOOK_TEST_TIMEOUT_MS)
      const finish = (res: HookTestResult): void => {
        if (done) return
        done = true
        clearTimeout(timer)
        resolve(res)
      }
      child.on('error', () => finish({ ok: false, error: 'spawn' }))
      child.on('close', (code) => {
        const o = clipOutput(maskHookText(out, home, platform), HOOK_TEST_OUTPUT_MAX)
        const e = clipOutput(maskHookText(err, home, platform), HOOK_TEST_OUTPUT_MAX)
        finish({ ok: true, code: typeof code === 'number' ? code : null, timedOut, ms: Date.now() - started, stdout: o.text, stderr: e.text, truncated: o.cut || e.cut })
      })
      child.stdin?.on('error', () => undefined)
      child.stdin?.end(stdin)
    })
  }
}
