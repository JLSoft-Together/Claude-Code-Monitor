import os from 'node:os'
import path from 'node:path'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { maskSecrets } from '@ccm/shared'
import type { ResolvedCommand } from '../run/resolve'
import { claudeJsonFile, claudeRoot } from '../extensions/status'
import { defaultRunner, findCodewhale, installPlan, updatePlan, type CliRunner, type CodewhaleInstall, type FsProbe, type InstallOrigin, type InstallRoute, type InstallStep, type RunResult } from './cli'
import { cleanApiKey, compareVersions, parseAuthStatus, parseDoctorUpdates, parseDownloadProgress, parseTelemetry, parseVersion } from './parse'
import { applySync, currentFingerprint, planSync, readSyncRecord, syncState, type FileAction, type PlannedFile, type SyncPaths, type SyncState } from './sync'

export type DeepSeekBusy = 'install' | 'login' | 'logout' | 'telemetry' | 'sync' | 'update'

export interface DeepSeekStatus {
  installed: boolean
  /** npm wrapper present, release binary not downloaded yet. */
  needsDownload: boolean
  version: string | null
  loggedIn: boolean | null
  telemetry: boolean | null
  installRoute: InstallRoute | null
  origin: InstallOrigin | null
  sync: SyncState
  /** Unix ms of the last sync, if any. */
  syncedAt: number | null
  busy: DeepSeekBusy | null
}

export type DeepSeekCode = 'badInput' | 'busy' | 'cancelled' | 'notInstalled' | 'noInstaller' | 'installed' | 'timeout' | 'failed' | 'notFound'

export interface DeepSeekResult {
  ok: boolean
  code?: DeepSeekCode
  detail?: string
}

export interface DeepSeekUpdateCheck extends DeepSeekResult {
  current?: string
  latest?: string
  newer?: boolean
}

export interface DeepSeekSyncFile {
  id: PlannedFile['id']
  /** `~/…` form. */
  file: string
  action: FileAction
  reason?: PlannedFile['reason']
}

export interface DeepSeekSyncResult extends DeepSeekResult {
  files?: DeepSeekSyncFile[]
  mcpAdded?: string[]
}

export type DeepSeekEvent =
  | { phase: 'install'; line: string }
  | { phase: 'download'; mb: number; totalMb: number | null; pct: number | null }

export type DeepSeekConfirm =
  | { kind: 'install' | 'download' | 'update'; commands: string[] }
  | { kind: 'logout' }
  | { kind: 'sync'; files: { file: string; action: 'create' | 'update' }[]; mcpAdded: string[]; outboxAdded: boolean }

export interface DeepSeekDeps {
  ipcMain: IpcMain
  isAppFrame: (event: IpcMainInvokeEvent) => boolean
  /** Native consent; false = cancelled. */
  confirm: (event: IpcMainInvokeEvent, plan: DeepSeekConfirm) => Promise<boolean>
  emit: (event: DeepSeekEvent) => void
  /** Orrery's data dir: holds `deepseek-sync.json` (fingerprint of the last sync). */
  dataDir: string
  run?: CliRunner
  find?: () => CodewhaleInstall | null
  plan?: typeof installPlan
  update?: typeof updatePlan
  env?: NodeJS.ProcessEnv
  home?: string
  platform?: NodeJS.Platform
  probe?: FsProbe
  now?: () => number
}

const QUICK_TIMEOUT = 30_000
const DOCTOR_TIMEOUT = 90_000
const INSTALL_TIMEOUT = 15 * 60_000
export const STATUS_TTL_MS = 60_000
export const SYNC_RECORD = 'deepseek-sync.json'

const CHANNELS = [
  'ccm:deepseek-status',
  'ccm:deepseek-install',
  'ccm:deepseek-cancel',
  'ccm:deepseek-login',
  'ccm:deepseek-logout',
  'ccm:deepseek-telemetry',
  'ccm:deepseek-sync',
  'ccm:deepseek-check-update',
  'ccm:deepseek-update',
]

export function syncPaths(env: NodeJS.ProcessEnv, home: string): SyncPaths {
  return {
    home,
    codewhaleHome: path.join(home, '.codewhale'),
    claudeRoot: claudeRoot(env, home),
    claudeJson: claudeJsonFile(env, home),
    codexHome: env.CODEX_HOME || path.join(home, '.codex'),
  }
}

type CliPart = Pick<DeepSeekStatus, 'installed' | 'needsDownload' | 'version' | 'loggedIn' | 'telemetry' | 'installRoute' | 'origin'>

export function registerDeepSeekIpc(deps: DeepSeekDeps): () => void {
  const { ipcMain, isAppFrame } = deps
  const env = deps.env ?? process.env
  const home = deps.home ?? os.homedir()
  const platform = deps.platform ?? process.platform
  const run = deps.run ?? defaultRunner(env)
  const find = deps.find ?? (() => findCodewhale(env, home, platform, deps.probe))
  const plan = deps.plan ?? installPlan
  const update = deps.update ?? updatePlan
  const now = deps.now ?? Date.now
  const recordFile = path.join(deps.dataDir, SYNC_RECORD)
  const paths = syncPaths(env, home)
  let busy: DeepSeekBusy | null = null
  let abort: AbortController | null = null
  // CLI answers (version / login / telemetry) cost three process starts; the sync state is recomputed every call.
  let cache: { at: number; cli: CliPart } | null = null
  const invalidate = (): void => {
    cache = null
  }

  const tilde = (file: string): string => {
    const rel = path.relative(home, file)
    return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? `~/${rel.split(path.sep).join('/')}` : file
  }
  const clean = (text: string, secret?: string): string => {
    let out = secret ? text.split(secret).join('••••') : text
    out = maskSecrets(out, home, platform).trim()
    return out.length > 400 ? `…${out.slice(-400)}` : out
  }
  const failure = (res: RunResult, secret?: string): DeepSeekResult => {
    if (res.cancelled) return { ok: false, code: 'cancelled' }
    if (res.timedOut) return { ok: false, code: 'timeout' }
    const detail = clean(`${res.stderr}\n${res.stdout}`, secret)
    return { ok: false, code: 'failed', ...(detail ? { detail } : {}) }
  }

  async function exclusive<T extends DeepSeekResult>(event: IpcMainInvokeEvent, kind: DeepSeekBusy, work: () => Promise<T>): Promise<T | DeepSeekResult> {
    if (!isAppFrame(event)) return { ok: false, code: 'badInput' }
    if (busy) return { ok: false, code: 'busy' }
    busy = kind
    try {
      return await work()
    } finally {
      busy = null
    }
  }

  const ready = (): CodewhaleInstall | null => {
    const cw = find()
    return cw && !cw.needsDownload ? cw : null
  }

  async function cliPart(): Promise<CliPart> {
    const cw = find()
    const base: CliPart = {
      installed: !!cw && !cw.needsDownload,
      needsDownload: !!cw?.needsDownload,
      version: null,
      loggedIn: null,
      telemetry: null,
      installRoute: plan(env, home, platform, deps.probe)?.route ?? null,
      origin: cw?.origin ?? null,
    }
    // Any run of a not-yet-downloaded npm wrapper starts the 128 MB download, so only Install / Download does that.
    if (!cw || cw.needsDownload) return base
    const opts = { cwd: home, timeout: QUICK_TIMEOUT }
    const [ver, auth, tele] = await Promise.all([run(cw.cmd, ['--version'], opts), run(cw.cmd, ['auth', 'status'], opts), run(cw.cmd, ['config', 'get', 'telemetry'], opts)])
    return {
      ...base,
      version: ver.code === 0 ? parseVersion(ver.stdout) : null,
      loggedIn: auth.code === 0 ? parseAuthStatus(auth.stdout) : null,
      telemetry: tele.code === 0 ? parseTelemetry(tele.stdout) : null,
    }
  }

  ipcMain.handle('ccm:deepseek-status', async (event, fresh: unknown): Promise<DeepSeekStatus | null> => {
    if (!isAppFrame(event)) return null
    let cli = cache && fresh !== true && now() - cache.at < STATUS_TTL_MS ? cache.cli : null
    if (!cli) {
      cli = (busy === 'install' || busy === 'update' ? cache?.cli : null) ?? (await cliPart())
      if (!busy) cache = { at: now(), cli }
    }
    const [record, hash] = await Promise.all([readSyncRecord(recordFile), currentFingerprint(paths)])
    return { ...cli, sync: syncState(record, hash), syncedAt: record?.at ?? null, busy }
  })

  /** Runs `steps`, then (npm) the wrapper once so it downloads its binary, streaming progress. */
  async function runInstall(steps: InstallStep[], wrapperAfter: () => ResolvedCommand | null): Promise<DeepSeekResult> {
    abort = new AbortController()
    const deadline = now() + INSTALL_TIMEOUT
    const left = (): number => Math.max(1_000, deadline - now())
    const signal = abort.signal
    try {
      for (const step of steps) {
        const res = await run(step.cmd, [], { cwd: home, timeout: left(), signal, onLine: (line) => deps.emit({ phase: 'install', line: clean(line).slice(0, 200) }) })
        if (res.code !== 0) return failure(res)
      }
      const wrapper = wrapperAfter()
      if (wrapper) {
        const res = await run(wrapper, ['--version'], {
          cwd: home,
          timeout: left(),
          signal,
          onLine: (line) => {
            const p = parseDownloadProgress(line)
            deps.emit(p ? { phase: 'download', ...p } : { phase: 'install', line: clean(line).slice(0, 200) })
          },
        })
        if (res.code !== 0) return failure(res)
      }
      return find()?.needsDownload === false ? { ok: true } : { ok: false, code: 'notFound' }
    } finally {
      abort = null
      invalidate()
    }
  }

  ipcMain.handle('ccm:deepseek-install', (event) =>
    exclusive(event, 'install', async (): Promise<DeepSeekResult> => {
      const cw = find()
      if (cw && !cw.needsDownload) return { ok: false, code: 'installed' }
      const steps = cw ? [] : (plan(env, home, platform, deps.probe)?.steps ?? null)
      if (!steps) return { ok: false, code: 'noInstaller' }
      const commands = cw ? ['codewhale --version'] : [...steps.map((s) => s.display), 'codewhale --version']
      if (!(await deps.confirm(event, { kind: cw ? 'download' : 'install', commands }))) return { ok: false, code: 'cancelled' }
      return runInstall(steps, () => {
        const after = find()
        return after?.needsDownload ? after.cmd : null
      })
    }),
  )

  ipcMain.handle('ccm:deepseek-check-update', async (event): Promise<DeepSeekUpdateCheck> => {
    if (!isAppFrame(event)) return { ok: false, code: 'badInput' }
    const cw = ready()
    if (!cw) return { ok: false, code: 'notInstalled' }
    const res = await run(cw.cmd, ['doctor', '--check-updates'], { cwd: home, timeout: DOCTOR_TIMEOUT })
    const parsed = parseDoctorUpdates(res.stdout)
    if (!parsed) return res.code === 0 ? { ok: false, code: 'failed' } : failure(res)
    return { ok: true, ...parsed, newer: compareVersions(parsed.latest, parsed.current) > 0 }
  })

  ipcMain.handle('ccm:deepseek-update', (event) =>
    exclusive(event, 'update', async (): Promise<DeepSeekResult> => {
      const cw = ready()
      if (!cw) return { ok: false, code: 'notInstalled' }
      const steps = update(cw, env, home, platform, deps.probe)
      if (!steps) return { ok: false, code: 'noInstaller' }
      const commands = [...steps.map((s) => s.display), ...(cw.origin === 'npm' ? ['codewhale --version'] : [])]
      if (!(await deps.confirm(event, { kind: 'update', commands }))) return { ok: false, code: 'cancelled' }
      return runInstall(steps, () => (cw.origin === 'npm' ? (cw.wrapper ?? null) : null))
    }),
  )

  ipcMain.handle('ccm:deepseek-cancel', (event): boolean => {
    if (!isAppFrame(event) || !abort) return false
    abort.abort()
    return true
  })

  ipcMain.handle('ccm:deepseek-login', (event, raw: unknown) =>
    exclusive(event, 'login', async (): Promise<DeepSeekResult> => {
      const key = cleanApiKey(raw)
      if (!key) return { ok: false, code: 'badInput' }
      const cw = ready()
      if (!cw) return { ok: false, code: 'notInstalled' }
      const res = await run(cw.cmd, ['auth', 'set', '--provider', 'deepseek', '--api-key-stdin'], { cwd: home, timeout: QUICK_TIMEOUT, stdin: `${key}\n` })
      invalidate()
      return res.code === 0 ? { ok: true } : failure(res, key)
    }),
  )

  ipcMain.handle('ccm:deepseek-logout', (event) =>
    exclusive(event, 'logout', async (): Promise<DeepSeekResult> => {
      const cw = ready()
      if (!cw) return { ok: false, code: 'notInstalled' }
      if (!(await deps.confirm(event, { kind: 'logout' }))) return { ok: false, code: 'cancelled' }
      // 0.10.2 does not prompt; the `y` only answers a confirm a later version might add, after ours.
      const res = await run(cw.cmd, ['auth', 'clear', '--provider', 'deepseek'], { cwd: home, timeout: QUICK_TIMEOUT, stdin: 'y\n' })
      invalidate()
      return res.code === 0 ? { ok: true } : failure(res)
    }),
  )

  ipcMain.handle('ccm:deepseek-telemetry', (event, on: unknown) =>
    exclusive(event, 'telemetry', async (): Promise<DeepSeekResult> => {
      if (typeof on !== 'boolean') return { ok: false, code: 'badInput' }
      const cw = ready()
      if (!cw) return { ok: false, code: 'notInstalled' }
      const res = await run(cw.cmd, ['config', 'set', 'telemetry', on ? 'true' : 'false'], { cwd: home, timeout: QUICK_TIMEOUT })
      invalidate()
      return res.code === 0 ? { ok: true } : failure(res)
    }),
  )

  ipcMain.handle('ccm:deepseek-sync', (event) =>
    exclusive(event, 'sync', async (): Promise<DeepSeekSyncResult> => {
      const p = await planSync(paths)
      const files = p.files.map((f): DeepSeekSyncFile => ({ id: f.id, file: tilde(f.file), action: f.action, ...(f.reason ? { reason: f.reason } : {}) }))
      const writes = files.filter((f): f is DeepSeekSyncFile & { action: 'create' | 'update' } => f.action === 'create' || f.action === 'update')
      if (writes.length && !(await deps.confirm(event, { kind: 'sync', files: writes.map((f) => ({ file: f.file, action: f.action })), mcpAdded: p.mcpAdded, outboxAdded: p.outboxAdded }))) {
        return { ok: false, code: 'cancelled' }
      }
      try {
        await applySync(p, recordFile, now())
      } catch (e) {
        return { ok: false, code: 'failed', detail: clean(String((e as Error).message ?? e)) }
      }
      return { ok: true, files, mcpAdded: p.mcpAdded }
    }),
  )

  return () => {
    abort?.abort()
    for (const ch of CHANNELS) ipcMain.removeHandler(ch)
  }
}
