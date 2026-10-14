import type { ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { EnvIssue, RunState } from '@ccm/shared'
import { runBeforeLaunch } from '../before'
import { androidGradleArgs } from '../command'
import { isWithin } from '../../preview/paths'
import { firstPid, installFailure, lineSplitter, parseBuildError, parseLogcat, parseOutputMetadata, parseResolvedActivity, pidofMissing, psPid, type InstallFailure } from '../parse'
import { killTree, killTreeSparing, substVars } from '../proc'
import { BadArgError, resolveCommand } from '../resolve'
import type { RunnerFactory } from '../types'
import { parseProjectDirs } from './detect'
import { collect, type Collected } from './devices'
import { androidEnv, gradlewSpawn, type EnvDeps } from './env'

const TIMING = {
  pidSearchMs: 1_500,
  pidWatchMs: 3_000,
  goneMs: 10_000,
  adbMs: 15_000,
  forceStopMs: 5_000,
  noPidNoticeMs: 60_000,
}

const GRADLE_DAEMON = /GradleDaemon/

const BLOCKING = new Set(['sdk-missing', 'jdk-missing', 'jdk-old', 'gradlew-missing', 'gradlew-not-executable'])
const LAUNCHER = 'android.intent.category.LAUNCHER'

export interface AndroidRunnerDeps {
  envDeps?: EnvDeps
  timing?: Partial<typeof TIMING>
}

async function readText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8')
  } catch {
    return null
  }
}

/** Gradle path → module dir, honouring `project(':x').projectDir = …` overrides in settings. */
export async function moduleDir(root: string, module: string): Promise<string> {
  const rel = module.replace(/^:+/, '')
  if (!rel) return root
  const settings = (await readText(path.join(root, 'settings.gradle.kts'))) ?? (await readText(path.join(root, 'settings.gradle')))
  const custom = settings ? parseProjectDirs(settings).get(`:${rel}`) : undefined
  return custom ? path.resolve(root, custom) : path.join(root, ...rel.split(':'))
}

/** `freeArmDebug` → `freeArm/debug`, `debug`, `freeArmDebug` (AGP: `apk/<flavors>/<buildType>/`). */
export function apkDirs(variant: string): string[] {
  const words = variant.split(/(?=[A-Z])/)
  const buildType = (words.pop() ?? variant).toLowerCase()
  const flavor = words.join('')
  const out = flavor ? [`${flavor}/${buildType}`, buildType, variant] : [buildType]
  return [...new Set(out)]
}

export async function findApk(modDir: string, variant: string): Promise<{ apk: string; applicationId: string } | null> {
  const buildDir = path.join(modDir, 'build')
  const apkRoot = path.join(buildDir, 'outputs', 'apk')
  const read = async (dir: string): Promise<{ meta: { apk: string; applicationId: string } | null; name: string | null }> => {
    const text = await readText(path.join(dir, 'output-metadata.json'))
    if (!text) return { meta: null, name: null }
    let name: string | null = null
    try {
      const v = (JSON.parse(text) as { variantName?: unknown }).variantName
      name = typeof v === 'string' ? v : null
    } catch {
      // parseOutputMetadata reports it
    }
    return { meta: parseOutputMetadata(text, dir), name }
  }
  // A metadata file is the repo's (or a stale build's) word: it must name this variant and point inside build/.
  const fits = (meta: { apk: string } | null, name: string | null): boolean => !!meta && (name === null || name === variant) && isWithin(buildDir, meta.apk)
  for (const rel of apkDirs(variant)) {
    const { meta, name } = await read(path.join(apkRoot, ...rel.split('/')))
    if (meta && fits(meta, name)) return meta
  }
  const subdirs = async (dir: string): Promise<string[]> => {
    try {
      return (await fs.readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => path.join(dir, d.name))
    } catch {
      return []
    }
  }
  for (const a of await subdirs(apkRoot)) {
    for (const dir of [a, ...(await subdirs(a))]) {
      const { meta, name } = await read(dir)
      if (meta && name === variant && fits(meta, name)) return meta
    }
  }
  return null
}

const isPid = (s: string | null | undefined): s is string => !!s && /^\d+$/.test(s)

export function androidRunnerFactory(deps: AndroidRunnerDeps = {}): RunnerFactory {
  const T = { ...TIMING, ...deps.timing }
  return (ctx) => {
    const { hooks } = ctx
    const cwd = ctx.config.cwd
    const serial = ctx.device?.id ?? ''
    const children = new Set<ChildProcess>()
    let phase: RunState | 'idle' = 'idle'
    let ended = false
    let stopping: Promise<void> | null = null
    let adb: string | null = null
    let pkg: string | null = null
    let beforeChild: ChildProcess | null = null
    let logcat: ChildProcess | null = null
    let pidTimer: NodeJS.Timeout | null = null

    const halted = (): boolean => ended || stopping !== null
    const state = (s: RunState, patch?: { appId: string }): void => {
      if (halted()) return
      phase = s
      hooks.state(s, patch)
    }
    const clearPidTimer = (): void => {
      if (pidTimer) clearTimeout(pidTimer)
      pidTimer = null
    }
    let gradleChild: ChildProcess | null = null
    const killAll = (sync = false): void => {
      clearPidTimer()
      for (const c of children) {
        if (c === gradleChild) {
          // Owner decision: Stop leaves the Gradle daemon warm for the next build.
          killTreeSparing(c, GRADLE_DAEMON, { sync, onFallback: () => hooks.log({ stream: 'build', text: 'Could not read the process list; the Gradle daemon was stopped too.' }) })
        } else killTree(c, sync)
      }
      children.clear()
      gradleChild = null
      logcat = null
    }
    const fail = (failure: EnvIssue): void => {
      if (halted()) return
      ended = true
      killAll()
      hooks.fail(failure)
    }
    const track = (child: ChildProcess, done: boolean): void => {
      if (done) children.delete(child)
      else children.add(child)
    }
    const adbRun = (args: string[], timeoutMs?: number, log = false): Promise<Collected> => {
      if (log) hooks.log({ stream: 'build', text: `> adb ${args.join(' ')}` })
      return collect(ctx.spawn, adb!, ['-s', serial, ...args], cwd, { timeoutMs, track }).then((r) => {
        if (log) for (const text of r.out.split(/\r?\n/)) if (text.trim()) hooks.log({ stream: 'build', text })
        return r
      })
    }

    const gradle = (file: string, args: string[], verbatim: boolean, env: Record<string, string>): Promise<boolean> =>
      new Promise((resolve) => {
        let child: ChildProcess
        try {
          child = ctx.spawn({ file, args, cwd, env, verbatim })
        } catch {
          resolve(false)
          return
        }
        children.add(child)
        gradleChild = child
        const onLine = (text: string): void => {
          hooks.log({ stream: 'build', text })
          const error = parseBuildError(text, cwd)
          if (error) hooks.error(error)
        }
        const out = lineSplitter(onLine)
        const err = lineSplitter(onLine)
        child.stdout?.on('data', out.push)
        child.stderr?.on('data', err.push)
        let settled = false
        const done = (ok: boolean): void => {
          if (settled) return
          settled = true
          children.delete(child)
          if (gradleChild === child) gradleChild = null
          resolve(ok)
        }
        child.once('error', () => done(false))
        child.once('close', (code: number | null) => {
          out.flush()
          err.flush()
          done(code === 0)
        })
      })

    const install = async (apk: string): Promise<InstallFailure | null> => {
      const r = await adbRun(['install', '-r', '-t', apk], undefined, true)
      return r.code === null ? 'other' : installFailure(r.out)
    }

    const attach = (pid: string): void => {
      if (logcat) {
        children.delete(logcat)
        killTree(logcat)
      }
      // No `-T` on re-attach: the buffer replay is filtered to the new pid, i.e. exactly its startup logs.
      const args = ['-s', serial, 'logcat', '-v', 'threadtime', `--pid=${pid}`]
      let child: ChildProcess
      try {
        child = ctx.spawn({ file: adb!, args, cwd })
      } catch {
        logcat = null
        return
      }
      children.add(child)
      logcat = child
      const lines = lineSplitter((line) => {
        if (!line.trim() || line.startsWith('--------- beginning of')) return
        const p = parseLogcat(line)
        hooks.log(p ? { stream: 'logcat', level: p.level, tag: p.tag, text: p.text } : { stream: 'logcat', text: line })
      })
      child.stdout?.on('data', lines.push)
      child.stderr?.on('data', () => undefined)
      child.once('close', () => {
        lines.flush()
        children.delete(child)
        if (logcat === child) logcat = null
      })
      child.once('error', () => children.delete(child))
    }

    const watchPid = (): void => {
      const runningAt = Date.now()
      let pid: string | null = null
      let lastSeen = 0
      let usePs = false
      let noticed = false
      const findPid = async (): Promise<string | null> => {
        if (!usePs) {
          const r = await adbRun(['shell', 'pidof', '-s', pkg!], T.adbMs)
          if (!pidofMissing(r.code, r.out)) return r.code === 0 ? firstPid(r.out) : null
          usePs = true
        }
        const r = await adbRun(['shell', 'ps', '-A', '-o', 'PID,NAME'], T.adbMs)
        if (halted()) return null
        const found = psPid(r.out, pkg!)
        if (found || /PID/.test(r.out)) return found
        // Android < 8 ps: no -A / -o, prints USER PID PPID … NAME.
        return psPid((await adbRun(['shell', 'ps'], T.adbMs)).out, pkg!)
      }
      const tick = async (): Promise<void> => {
        pidTimer = null
        if (halted()) return
        const next = await findPid()
        if (halted()) return
        const now = Date.now()
        if (pid === null && !noticed && now - runningAt > T.noPidNoticeMs) {
          noticed = true
          hooks.log({ stream: 'logcat', level: 'W', text: `No running process found for ${pkg}; logcat is not attached.` })
        }
        if (isPid(next)) {
          lastSeen = now
          if (next !== pid) {
            attach(next)
            pid = next
          }
        } else if (pid !== null && now - lastSeen > T.goneMs) {
          ended = true
          phase = 'stopped'
          killAll()
          hooks.state('stopped')
          return
        }
        const searching = pid === null && now - runningAt < T.goneMs
        pidTimer = setTimeout(() => void tick(), searching ? T.pidSearchMs : T.pidWatchMs)
      }
      void tick()
    }

    const run = async (): Promise<void> => {
      const cfg = ctx.config
      if (cfg.type !== 'android') return fail({ code: 'config-type' })
      if (!ctx.device) return fail({ code: 'device-missing' })
      if (ctx.device.state === 'unauthorized') return fail({ code: 'device-unauthorized', detail: serial })
      const env = await androidEnv(
        cwd,
        { sdkSetting: ctx.settings.androidSdk, jdkSetting: ctx.settings.jdk, env: ctx.env, platform: ctx.platform, home: ctx.home, trusted: true },
        deps.envDeps,
      )
      if (halted()) return
      const issue = env.issues.find((i) => BLOCKING.has(i.code)) ?? (env.adb ? null : { code: 'sdk-missing' })
      if (issue) return fail(issue)
      adb = env.adb

      if (cfg.beforeLaunch.length) {
        state('before-launch')
        const lookupEnv = { ...ctx.env, ...cfg.env }
        const ok = await runBeforeLaunch(
          ctx,
          (cmd) => resolveCommand(cmd, cwd, lookupEnv, ctx.platform),
          (child) => {
            if (beforeChild) children.delete(beforeChild)
            beforeChild = child
            if (child) children.add(child)
          },
          halted,
        )
        if (halted()) return
        if (!ok) return fail({ code: 'before-launch' })
      }

      state('building')
      const vars = substVars(cwd, ctx.root, ctx.env, cfg.env)
      const gradleArgs = androidGradleArgs(cfg, vars)
      let spec: ReturnType<typeof gradlewSpawn>
      try {
        spec = gradlewSpawn(cwd, gradleArgs, ctx.platform, ctx.env)
      } catch (e) {
        return fail({ code: e instanceof BadArgError ? 'bad-arg' : 'spawn' })
      }
      const gradleEnv: Record<string, string> = {
        ...(env.jdk ? { JAVA_HOME: env.jdk } : {}),
        ...(env.sdk ? { ANDROID_HOME: env.sdk } : {}),
        ...cfg.env,
      }
      hooks.log({ stream: 'build', text: `> gradlew ${androidGradleArgs(cfg, { ...vars, maskEnv: true }).join(' ')}` })
      const built = await gradle(spec.file, spec.args, spec.verbatim, gradleEnv)
      if (halted()) return
      if (!built) return fail({ code: 'build' })

      const out = await findApk(await moduleDir(cwd, cfg.module), cfg.variant)
      if (halted()) return
      if (!out) return fail({ code: 'install', detail: 'apk-missing' })
      pkg = out.applicationId

      state('installing')
      let failure = await install(out.apk)
      if (halted()) return
      if (failure === 'signature') {
        const yes = await hooks.confirm('reinstall', pkg)
        if (halted()) return
        if (!yes) return fail({ code: 'install', detail: 'signature' })
        await adbRun(['uninstall', pkg], T.adbMs * 4, true)
        if (halted()) return
        failure = await install(out.apk)
        if (halted()) return
      }
      if (failure) return fail({ code: 'install', detail: failure })

      state('launching')
      const resolved = await adbRun(['shell', 'cmd', 'package', 'resolve-activity', '--brief', '-c', LAUNCHER, pkg], T.adbMs)
      if (halted()) return
      const component = parseResolvedActivity(resolved.out, pkg)
      let launched = false
      if (component) {
        const r = await adbRun(['shell', 'am', 'start', '-n', component], T.adbMs, true)
        if (halted()) return
        launched = r.code === 0 && !/^(Error|Exception)/m.test(r.out)
      }
      if (!launched) {
        // Devices without `cmd package resolve-activity` (Android < 7) or a failed `am start`.
        const r = await adbRun(['shell', 'monkey', '-p', pkg, '-c', LAUNCHER, '1'], T.adbMs, true)
        if (halted()) return
        if (/No activities found/i.test(r.out)) return fail({ code: 'launch', detail: 'no-launcher' })
        if (r.code !== 0 || /monkey aborted/i.test(r.out)) return fail({ code: 'launch' })
      }

      state('running', { appId: pkg })
      watchPid()
    }

    return {
      async start() {
        try {
          await run()
        } catch {
          fail({ code: 'spawn' })
        }
      },
      stop() {
        return (stopping ??= (async () => {
          if (ended) return
          const wasRunning = phase === 'running'
          phase = 'stopping'
          hooks.state('stopping')
          clearPidTimer()
          if (wasRunning && adb && pkg) await collect(ctx.spawn, adb, ['-s', serial, 'shell', 'am', 'force-stop', pkg], cwd, { timeoutMs: T.forceStopMs })
          killAll()
          ended = true
          phase = wasRunning ? 'stopped' : 'cancelled'
          hooks.state(phase)
        })())
      },
      kill() {
        if (!ended && phase === 'running' && adb && pkg) {
          try {
            ctx.spawn({ file: adb, args: ['-s', serial, 'shell', 'am', 'force-stop', pkg], cwd })
          } catch {
            // quitting anyway
          }
        }
        ended = true
        killAll(true)
      },
    }
  }
}

export const createAndroidRunner: RunnerFactory = androidRunnerFactory()
