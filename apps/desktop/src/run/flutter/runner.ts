import type { ChildProcess } from 'node:child_process'
import path from 'node:path'
import { isRunLive, type EnvIssue, type FlutterRunConfig, type LogLevel, type RunResult, type RunState } from '@ccm/shared'
import { runBeforeLaunch } from '../before'
import { flutterArgv } from '../command'
import { lineSplitter, machineRequest, parseBuildError, parseMachineLine } from '../parse'
import { killTree, substVars } from '../proc'
import { BadArgError, cmdShim, resolveCommand, type ResolvedCommand } from '../resolve'
import type { RunContext, Runner } from '../types'
import { findFlutterSdk, flutterExecutable, flutterSpawn, type FlutterEnvOpts, type FlutterSdkLookup } from './env'

export interface FlutterRunnerDeps {
  findSdk?: (projectDir: string, opts: FlutterEnvOpts) => FlutterSdkLookup
  kill?: (child: ChildProcess, sync?: boolean) => void
  stopTimeoutMs?: number
}

const STOP_TIMEOUT = 5_000
const DEVICE_LOST = /lost connection to device|device (?:was )?disconnected|device .* (?:not found|is offline)|no connected devices/i

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

/** SDK `bin/<tool>` for flutter / dart heads in beforeLaunch, so they match the SDK the run uses. */
export function sdkTool(sdk: string, head: string, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): ResolvedCommand | null {
  const name = head.toLowerCase().replace(/\.(bat|exe)$/, '')
  if (head.includes('/') || head.includes('\\') || (name !== 'flutter' && name !== 'dart')) return null
  if (name === 'flutter') {
    const exe = flutterExecutable(sdk, platform)
    return platform === 'win32' ? cmdShim(exe, [], env) : { file: exe, args: [] }
  }
  const p = platform === 'win32' ? path.win32 : path.posix
  const exe = p.join(sdk, 'bin', platform === 'win32' ? 'dart.bat' : 'dart')
  return platform === 'win32' ? cmdShim(exe, [], env) : { file: exe, args: [] }
}

export function createFlutterRunner(ctx: RunContext, deps: FlutterRunnerDeps = {}): Runner {
  const { hooks } = ctx
  const kill = deps.kill ?? killTree
  const findSdk = deps.findSdk ?? findFlutterSdk
  const cfg = ctx.config as FlutterRunConfig

  let state: RunState = 'starting'
  let child: ChildProcess | null = null
  let stepChild: ChildProcess | null = null
  let appId: string | null = null
  let started = false
  let ended = false
  let stopRequested = false
  let sawBuildError = false
  let deviceLost = false
  let nextId = 1
  let stopPromise: Promise<void> | null = null
  let settleStart: () => void = () => undefined
  let onExit: () => void = () => undefined
  const exited = new Promise<void>((resolve) => (onExit = resolve))
  const pending = new Map<number, { resolve: (r: { result?: unknown; error?: unknown }) => void }>()

  const setState = (next: RunState, patch?: Parameters<typeof hooks.state>[1]): void => {
    // Late machine events (app.started, progress) after Stop / exit must not revive the session.
    if (isRunLive(next) && (ended || (stopRequested && next !== 'stopping'))) return
    state = next
    hooks.state(next, patch)
  }

  const end = (next: RunState, failure?: EnvIssue): void => {
    if (ended) return
    ended = true
    if (failure) hooks.fail(failure)
    setState(next, { progress: null })
    for (const p of pending.values()) p.resolve({ error: 'exited' })
    pending.clear()
    settleStart()
    onExit()
  }

  const text = (line: string, stream: 'build' | 'app', level?: LogLevel): void => {
    if (DEVICE_LOST.test(line)) deviceLost = true
    hooks.log(level ? { stream, text: line, level } : { stream, text: line })
    const err = parseBuildError(line, cfg.cwd)
    if (!err) return
    if (err.severity === 'error' && !started) sawBuildError = true
    hooks.error(err)
  }

  const request = (method: string, params: Record<string, unknown>): Promise<{ result?: unknown; error?: unknown }> => {
    const c = child
    if (!c?.stdin || c.stdin.destroyed || ended) return Promise.resolve({ error: 'not-running' })
    const id = nextId++
    return new Promise((resolve) => {
      pending.set(id, { resolve })
      c.stdin!.write(machineRequest(id, method, params))
    })
  }

  const onEvent = (event: string, params: Record<string, unknown>): void => {
    switch (event) {
      case 'daemon.connected':
        hooks.log({ stream: 'build', text: `flutter daemon connected${typeof params.pid === 'number' ? ` (pid ${params.pid})` : ''}` })
        return
      case 'app.start':
        appId = str(params.appId) ?? appId
        setState(state, { appId })
        return
      case 'app.progress': {
        if (params.finished === true) return setState(state, { progress: null })
        const message = str(params.message)
        if (message) {
          hooks.log({ stream: 'build', text: message })
          setState(state, { progress: message })
        }
        return
      }
      case 'app.debugPort': {
        const uri = str(params.wsUri)
        if (uri) setState(state, { vmServiceUri: uri })
        return
      }
      case 'app.devTools': {
        const uri = str(params.uri)
        if (uri) setState(state, { devtoolsUri: uri })
        return
      }
      case 'app.started':
        started = true
        setState('running', { progress: null })
        settleStart()
        return
      case 'app.log': {
        const log = typeof params.log === 'string' ? params.log : ''
        const lines = log.split(/\r?\n/)
        if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
        for (const l of lines) text(l, 'app', params.error === true ? 'E' : undefined)
        return
      }
      case 'app.webLaunchUrl': {
        const url = str(params.url)
        if (url) hooks.log({ stream: 'app', text: url })
        return
      }
      case 'app.warning': {
        const warning = str(params.warning)
        if (warning) hooks.log({ stream: started ? 'app' : 'build', text: warning, level: 'W' })
        return
      }
      case 'app.stop': {
        const error = str(params.error)
        if (error) text(error, started ? 'app' : 'build', 'E')
        return
      }
      case 'daemon.logMessage': {
        const message = str(params.message)
        if (!message) return
        const level: LogLevel | undefined = params.level === 'error' ? 'E' : params.level === 'warning' ? 'W' : undefined
        for (const l of message.split(/\r?\n/)) text(l, 'build', level)
        return
      }
    }
  }

  const onLine = (line: string): void => {
    const msg = parseMachineLine(line)
    if (msg.kind === 'event') return onEvent(msg.event, msg.params)
    if (msg.kind === 'response') {
      const p = pending.get(msg.id)
      pending.delete(msg.id)
      p?.resolve({ result: msg.result, error: msg.error })
      return
    }
    if (line.trim()) text(line, started ? 'app' : 'build')
  }

  const onClose = (code: number | null): void => {
    if (ended) return
    if (stopRequested) return end(started ? 'stopped' : 'cancelled')
    if (started) return end('stopped', deviceLost ? { code: 'device-lost' } : undefined)
    if (code === 0 && !sawBuildError) return end('stopped')
    end('failed', sawBuildError ? { code: 'build' } : { code: 'exit', detail: String(code ?? 'signal') })
  }

  async function start(): Promise<void> {
    const startDone = new Promise<void>((resolve) => (settleStart = resolve))
    const found = findSdk(cfg.cwd, { setting: ctx.settings.flutterSdk, env: ctx.env, platform: ctx.platform, home: ctx.home })
    const sdk = found.sdk
    if (cfg.type !== 'flutter' || !sdk) {
      end('failed', { code: 'spawn', detail: found.issues[0]?.code ?? 'flutter-missing' })
      return startDone
    }
    if (cfg.beforeLaunch.length) {
      setState('before-launch')
      let lastHead = ''
      const resolve = (head: string): ResolvedCommand | null => {
        lastHead = head
        return sdkTool(sdk, head, ctx.platform, ctx.env) ?? resolveCommand(head, cfg.cwd, { ...ctx.env, ...cfg.env }, ctx.platform)
      }
      const ok = await runBeforeLaunch(ctx, resolve, (c) => (stepChild = c), () => stopRequested)
      if (stopRequested || ended) {
        end('cancelled')
        return startDone
      }
      if (!ok) {
        end('failed', { code: 'before-launch', detail: path.basename(lastHead) })
        return startDone
      }
    }
    setState('starting')
    const vars = substVars(cfg.cwd, ctx.root, ctx.env, cfg.env)
    const flutterFile = flutterExecutable(sdk, ctx.platform)
    const argv = flutterArgv(cfg, ctx.device?.id ?? null, { ...vars, flutterFile })
    const shown = flutterArgv(cfg, ctx.device?.id ?? null, { ...vars, maskEnv: true, flutterFile })
    hooks.log({ stream: 'build', text: `> flutter ${shown.slice(1).join(' ')}` })
    try {
      const spec = flutterSpawn(sdk, argv.slice(1), ctx.platform, ctx.env)
      child = ctx.spawn({ file: spec.file, args: spec.args, cwd: cfg.cwd, env: cfg.env, verbatim: spec.windowsVerbatimArguments === true, stdin: 'pipe' })
    } catch (e) {
      end('failed', e instanceof BadArgError ? { code: 'bad-arg' } : { code: 'spawn', detail: e instanceof Error ? e.message : String(e) })
      return startDone
    }
    const out = lineSplitter(onLine)
    const err = lineSplitter((line) => line.trim() && text(line, started ? 'app' : 'build'))
    child.stdout?.on('data', out.push)
    child.stderr?.on('data', err.push)
    child.stdin?.on('error', () => undefined)
    child.once('error', (e) => end('failed', { code: 'spawn', detail: e.message }))
    child.once('close', (code) => {
      out.flush()
      err.flush()
      onClose(code)
    })
    return startDone
  }

  async function reload(full: boolean): Promise<RunResult> {
    if (cfg.mode !== 'debug') return { ok: false, error: { code: 'reload-unsupported' } }
    if (!started || ended || !appId || state !== 'running') return { ok: false, error: { code: 'reload-failed', detail: 'not-running' } }
    setState('reloading')
    const res = await request('app.restart', { appId, fullRestart: full, pause: false, reason: 'manual' })
    if (!ended && (state as RunState) === 'reloading') setState('running')
    const result = res.result as { code?: unknown; message?: unknown } | undefined
    const failed = res.error !== undefined && res.error !== null ? errorText(res.error) : typeof result?.code === 'number' && result.code !== 0 ? String(result.message ?? result.code) : null
    if (failed === null) return { ok: true }
    hooks.log({ stream: 'app', text: failed, level: 'E' })
    return { ok: false, error: { code: 'reload-failed', detail: failed } }
  }

  function stop(): Promise<void> {
    if (stopPromise) return stopPromise
    stopRequested = true
    if (stepChild) kill(stepChild)
    const c = child
    if (!c || ended) {
      stopPromise = Promise.resolve()
      return stopPromise
    }
    setState('stopping')
    if (appId) void request('app.stop', { appId })
    else kill(c)
    const timer = setTimeout(() => kill(c), deps.stopTimeoutMs ?? STOP_TIMEOUT)
    stopPromise = exited.then(() => clearTimeout(timer))
    return stopPromise
  }

  function killNow(): void {
    stopRequested = true
    if (stepChild) kill(stepChild, true)
    if (child && !ended) kill(child, true)
  }

  return { start, stop, kill: killNow, reload }
}

function errorText(error: unknown): string {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  return JSON.stringify(error)
}
