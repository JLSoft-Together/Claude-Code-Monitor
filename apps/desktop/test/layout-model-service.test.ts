import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { AndroidEnv, RunDevice } from '@ccm/shared'
import { RenderCache } from '../src/layout/ipc'
import type { FlutterRunConfig } from '@ccm/shared'
import { afterRunTarget, dependsOn, LayoutModelService, type ModelServiceDeps } from '../src/layout/model'
import type { LayoutEvent } from '../src/layout/types'
import { RunManager } from '../src/run/sessions'
import type { DeviceService, RunContext, Runner } from '../src/run/types'

const tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'ccm-layout-model-')))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function write(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text)
}

/** Gradle root with `:app` (application, depends on `:lib`), `:lib` (library) and `:other` (library nobody uses). */
function project(): { root: string; appLayout: string; libLayout: string; otherLayout: string } {
  const root = path.join(tmp, `p${Math.random().toString(36).slice(2, 8)}`)
  write(path.join(root, 'settings.gradle.kts'), 'rootProject.name = "Demo"\ninclude(":app", ":lib", ":other")\n')
  write(path.join(root, 'app', 'build.gradle.kts'), 'plugins { id("com.android.application") }\ndependencies { implementation(project(":lib")) }\n')
  write(path.join(root, 'lib', 'build.gradle.kts'), 'plugins { id("com.android.library") }\n')
  write(path.join(root, 'other', 'build.gradle.kts'), 'plugins { id("com.android.library") }\n')
  const layout = (mod: string) => path.join(root, mod, 'src', 'main', 'res', 'layout', 'main.xml')
  for (const m of ['app', 'lib', 'other']) write(layout(m), '<FrameLayout/>')
  return { root, appLayout: layout('app'), libLayout: layout('lib'), otherLayout: layout('other') }
}

function modelJson(root: string, extraJar = false) {
  return {
    module: ':app',
    variant: 'debug',
    namespace: 'com.example.app',
    resDirs: [path.join(root, 'app', 'src', 'main', 'res')],
    generatedResDirs: [path.join(root, 'app', 'build', 'generated', 'res')],
    aarRes: [],
    classpath: [path.join(root, 'lib.jar'), ...(extraJar ? [path.join(root, 'extra.jar')] : [])],
    classDirs: [],
    rJar: path.join(root, 'R.jar'),
    appTheme: '@style/Theme.Demo',
    activityThemes: { 'com.example.app.MainActivity': '@style/Theme.Demo.Main' },
    warnings: [],
  }
}

class FakeChild extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  pid = 99
  exitCode: number | null = null
  signalCode = null
}

const okEnv: AndroidEnv = { kind: 'android', sdk: '/sdk', adb: '/sdk/adb', emulator: null, jdk: '/jdk', jdkVersion: 21, gradlew: true, issues: [] }

interface Opts {
  /** What the fake Gradle run does with the -Pccm.out file; 'hang' never exits. */
  gradle?: 'ok' | 'fail' | 'hang'
  model?: (root: string, run: number) => unknown
  daemon?: (method: string, params: unknown) => unknown
  modelsDir?: string
  env?: AndroidEnv
}

function setup(o: Opts = {}) {
  const events: LayoutEvent[] = []
  const calls: { method: string; params: unknown }[] = []
  const spawns: { args: string[]; env?: Record<string, string> }[] = []
  const killed: ChildProcess[] = []
  const watchers: { dirs: string[]; onChange: (files: string[]) => void; closed: boolean }[] = []
  const requestRestart = vi.fn()
  let runs = 0
  const deps: ModelServiceDeps = {
    modelsDir: o.modelsDir ?? path.join(tmp, `models-${Math.random().toString(36).slice(2, 8)}`),
    initScript: path.join(tmp, 'ccm-project-model.gradle'),
    platform: process.platform,
    env: { SystemRoot: 'C:\\Windows' },
    home: tmp,
    getSettings: () => ({ androidSdk: null, jdk: null }),
    spawn: (spec) => {
      spawns.push({ args: spec.args, env: spec.env })
      const child = new FakeChild()
      const run = ++runs
      // win32: cmd.exe line, quotes are ^-escaped.
      const out = /-Pccm\.out=([^"\s^]+)/.exec(spec.args.join(' '))![1]!
      if (o.gradle !== 'hang') {
        setTimeout(() => {
          child.stdout.write('BUILD SUCCESSFUL\n')
          if (o.gradle !== 'fail') writeFileSync(out, JSON.stringify((o.model ?? ((r: string) => modelJson(r)))(spec.cwd, run)))
          else child.stderr.write('FAILURE: Build failed with an exception.\n')
          child.emit('close', o.gradle === 'fail' ? 1 : 0)
        }, 5)
      }
      return child as unknown as ChildProcess
    },
    kill: (c) => {
      killed.push(c)
      ;(c as unknown as FakeChild).emit('close', null)
    },
    daemon: {
      request: async (method, params) => {
        calls.push({ method, params })
        return o.daemon?.(method, params) ?? { ok: true }
      },
      requestRestart,
    },
    broadcast: (e) => events.push(e),
    log: () => undefined,
    watchDirs: (dirs, onChange) => {
      const w = { dirs, onChange, closed: false }
      watchers.push(w)
      return () => (w.closed = true)
    },
    canRun: () => true,
    debounceMs: 20,
    genDebounceMs: 60,
    androidEnv: async () => o.env ?? okEnv,
    exists: () => true,
  }
  const service = new LayoutModelService(deps)
  return { service, deps, events, calls, spawns, killed, watchers, requestRestart }
}

describe('module pick', () => {
  it('uses the app module, the app depending on a library, else the first app', async () => {
    const p = project()
    const { service } = setup()
    expect(await service.resolve(p.appLayout)).toEqual({ target: { root: p.root, module: ':app' }, name: 'Demo' })
    expect(await service.resolve(p.libLayout)).toMatchObject({ target: { module: ':app' } })
    expect(await service.resolve(p.otherLayout)).toMatchObject({ target: { module: ':app' } })
  })

  it('reports no-gradle / no-app', async () => {
    const { service } = setup()
    const loose = path.join(tmp, 'loose', 'res', 'layout', 'a.xml')
    write(loose, '<View/>')
    const lib = path.join(tmp, `lib${Date.now()}`)
    write(path.join(lib, 'settings.gradle'), "include ':ui'\n")
    write(path.join(lib, 'ui', 'build.gradle'), "plugins { id 'com.android.library' }\n")
    write(path.join(lib, 'ui', 'src', 'main', 'res', 'layout', 'a.xml'), '<View/>')
    expect((await service.info(path.join(lib, 'ui', 'src', 'main', 'res', 'layout', 'a.xml'))).reason).toBe('no-app')
    const info = await service.info(loose)
    expect(info.target).toBeNull()
  })

  it('borrows the app of a library layout, transitively, and flags a library no app uses', async () => {
    const root = path.join(tmp, `t${Math.random().toString(36).slice(2, 8)}`)
    write(path.join(root, 'settings.gradle'), "include ':app', ':feature:home', ':core:ui', ':orphan'\n")
    write(path.join(root, 'app', 'build.gradle'), "plugins { id 'com.android.application' }\ndependencies { implementation project(':feature:home') }\n")
    write(path.join(root, 'feature', 'home', 'build.gradle'), "plugins { id 'com.android.library' }\ndependencies { api(projects.core.ui) }\n")
    write(path.join(root, 'core', 'ui', 'build.gradle'), "plugins { id 'com.android.library' }\n")
    write(path.join(root, 'orphan', 'build.gradle'), "plugins { id 'com.android.library' }\n")
    const layout = (mod: string) => path.join(root, ...mod.split(':').filter(Boolean), 'src', 'main', 'res', 'layout', 'a.xml')
    const { service } = setup()
    expect(await service.info(layout(':core:ui'))).toMatchObject({ target: { module: ':app' }, library: { module: ':core:ui', candidates: [':app'], linked: true } })
    expect(await service.info(layout(':orphan'))).toMatchObject({ target: { module: ':app' }, library: { module: ':orphan', candidates: [], linked: false } })
    expect((await service.info(layout(':app'))).library).toBeUndefined()
  })

  it('several dependent apps: first by path, then the one last run or picked (persisted)', async () => {
    const p = project()
    write(path.join(p.root, 'settings.gradle.kts'), 'rootProject.name = "Demo"\ninclude(":app", ":lib", ":other", ":demo")\n')
    write(path.join(p.root, 'demo', 'build.gradle.kts'), 'plugins { id("com.android.application") }\ndependencies { implementation(projects.lib) }\n')
    const s = setup()
    s.deps.canRun = () => false
    expect(await s.service.info(p.libLayout)).toMatchObject({ target: { module: ':app' }, library: { candidates: [':app', ':demo'], linked: true } })
    s.service.afterBuild(p.root, ':demo', 'debug')
    await wait(20)
    expect((await s.service.info(p.libLayout)).target?.module).toBe(':demo')
    expect((await s.service.pickApp(p.libLayout, ':other')).target?.module).toBe(':demo')
    expect((await s.service.pickApp(p.libLayout, ':app')).target?.module).toBe(':app')
    expect((await s.service.info(p.appLayout)).target?.module).toBe(':app')
    const next = setup({ modelsDir: s.deps.modelsDir })
    expect((await next.service.info(p.libLayout)).target?.module).toBe(':app')
    await next.service.pickApp(p.libLayout, ':demo')
    expect((await next.service.prepare(p.libLayout)).frameworkOnly).toBe(true)
    expect(next.spawns).toHaveLength(0)
  })

  it('uses projectDeps of a cached app model for deps the build scripts do not name', async () => {
    const p = project()
    const s = setup({ model: (root) => ({ ...modelJson(root), projectDeps: [':other', 'bad path'] }) })
    expect((await s.service.info(p.otherLayout)).library).toMatchObject({ linked: false })
    await s.service.refresh({ root: p.root, module: ':app' })
    expect((await s.service.info(p.otherLayout)).library).toEqual({ module: ':other', candidates: [':app'], linked: true })
    expect((await s.service.prepare(p.otherLayout)).frameworkOnly).toBe(false)
  })

  it('dependsOn knows project() and type-safe accessors', () => {
    expect(dependsOn('implementation(project(":core:ui"))', ':core:ui')).toBe(true)
    expect(dependsOn("implementation project(path: ':core:ui')", ':core:ui')).toBe(true)
    expect(dependsOn('implementation(projects.core.uiKit)', ':core:ui-kit')).toBe(true)
    expect(dependsOn('implementation(projects.core.uiKit.extra)', ':core:ui-kit')).toBe(false)
    expect(dependsOn('// implementation(project(":core:ui"))', ':core:ui')).toBe(false)
  })
})

describe('refresh', () => {
  it('runs the init script once per root (single flight) and caches the model', async () => {
    const p = project()
    const { service, spawns, events, deps } = setup()
    const target = { root: p.root, module: ':app' }
    const [a, b] = await Promise.all([service.refresh(target), service.refresh(target)])
    expect(spawns).toHaveLength(1)
    expect(spawns[0]!.args.join(' ')).toContain(':app:ccmProjectModel')
    expect(spawns[0]!.env).toEqual({ JAVA_HOME: '/jdk', ANDROID_HOME: '/sdk' })
    expect(a).toMatchObject({ state: 'ready', classpathCount: 1 })
    expect(b).toEqual(a)
    expect(events.filter((e) => e.type === 'model').map((e) => (e as { state: { state: string } }).state.state)).toEqual(['running', 'ready'])
    const info = await service.info(p.appLayout)
    expect(info.themes).toEqual(['@style/Theme.Demo', '@style/Theme.Demo.Main'])
    expect(info.hasModel).toBe(true)
    const { readdirSync } = await import('node:fs')
    expect(readdirSync(deps.modelsDir).filter((f) => f.endsWith('.json') && !f.includes('.next.'))).toHaveLength(1)
  })

  it('kills a hanging Gradle run at the timeout', async () => {
    const p = project()
    const s = setup({ gradle: 'hang' })
    s.deps.timeoutMs = 30
    const state = await s.service.refresh({ root: p.root, module: ':app' })
    expect(s.killed).toHaveLength(1)
    expect(state).toMatchObject({ state: 'error', code: 'timeout' })
  })

  it('reports a failed build and a blocking env issue without loading anything', async () => {
    const p = project()
    const failed = setup({ gradle: 'fail' })
    expect(await failed.service.refresh({ root: p.root, module: ':app' })).toMatchObject({ state: 'error', code: 'gradle-failed', detail: expect.stringContaining('FAILURE') })
    const noJdk = setup({ env: { ...okEnv, jdk: null, issues: [{ code: 'jdk-missing' }] } })
    expect(await noJdk.service.refresh({ root: p.root, module: ':app' })).toMatchObject({ state: 'error', code: 'jdk-missing' })
    expect(noJdk.spawns).toHaveLength(0)
    expect(failed.calls).toHaveLength(0)
  })

  it('afterBuild is skipped until the preview is set up', () => {
    const p = project()
    const s = setup()
    s.deps.canRun = () => false
    s.service.afterBuild(p.root, ':app', 'debug')
    expect(s.spawns).toHaveLength(0)
  })
})

describe('daemon loading', () => {
  it('never runs Gradle on open: framework-only until a model exists', async () => {
    const p = project()
    const { service, spawns, calls } = setup()
    expect(await service.prepare(p.appLayout)).toEqual({ key: 'framework', frameworkOnly: true, builtinLibs: false, sourceOnly: false })
    expect((await service.info(p.appLayout)).state).toEqual({ state: 'none' })
    expect(spawns).toHaveLength(0)
    expect(calls).toHaveLength(0)
  })

  it('loads lazily, reloads from the cache after a daemon restart and in a new session, without Gradle', async () => {
    const p = project()
    const s = setup()
    await s.service.refresh({ root: p.root, module: ':app' })
    expect(s.calls).toHaveLength(0)
    const first = await s.service.prepare(p.appLayout)
    expect(first.frameworkOnly).toBe(false)
    expect(s.calls.map((c) => c.method)).toEqual(['project/load'])
    expect(await s.service.prepare(p.appLayout)).toEqual(first)
    expect(s.calls).toHaveLength(1)

    s.service.onDaemonState('stopped')
    s.service.onDaemonState('ready')
    await wait(5)
    expect(s.calls.map((c) => c.method)).toEqual(['project/load', 'project/load'])
    expect((await s.service.prepare(p.appLayout)).key).not.toBe(first.key)

    const next = setup({ modelsDir: s.deps.modelsDir })
    expect((await next.service.info(p.appLayout)).state).toMatchObject({ state: 'ready' })
    expect((await next.service.prepare(p.appLayout)).frameworkOnly).toBe(false)
    expect(next.calls.map((c) => c.method)).toEqual(['project/load'])
    expect(next.spawns).toHaveLength(0)
    expect(s.spawns).toHaveLength(1)
  })

  it('sends project/changed classes when a refresh keeps the payload, project/load when it changes', async () => {
    const p = project()
    const s = setup({ model: (root, run) => modelJson(root, run >= 3) })
    const target = { root: p.root, module: ':app' }
    await s.service.refresh(target)
    await s.service.prepare(p.appLayout)
    await s.service.refresh(target)
    expect(s.calls.map((c) => [c.method, (c.params as { kind?: string }).kind])).toEqual([
      ['project/load', undefined],
      ['project/changed', 'res'],
      ['project/changed', 'classes'],
    ])
    await s.service.refresh(target)
    expect(s.calls.at(-1)!.method).toBe('project/load')
    expect(s.events.filter((e) => e.type === 'project-changed')).toHaveLength(3)
  })

  it('debounces res changes into one project/changed res and flushes them before a render', async () => {
    const p = project()
    const s = setup()
    await s.service.refresh({ root: p.root, module: ':app' })
    const before = await s.service.prepare(p.appLayout)
    expect(s.watchers).toHaveLength(3)
    expect(s.watchers[0]!.dirs).toEqual([path.join(p.root, 'app', 'src', 'main', 'res')])
    const fire = s.watchers[0]!.onChange
    fire(['a.xml'])
    fire(['b.xml'])
    fire(['a.xml'])
    await wait(60)
    const changed = s.calls.filter((c) => c.method === 'project/changed')
    expect(changed).toEqual([{ method: 'project/changed', params: { kind: 'res', files: ['a.xml', 'b.xml'] } }])
    expect(s.events.at(-1)).toEqual({ type: 'project-changed', root: p.root, module: ':app' })

    fire(['c.xml'])
    const after = await s.service.prepare(p.appLayout)
    expect(s.calls.filter((c) => c.method === 'project/changed')).toHaveLength(2)
    expect(after.key).not.toBe(before.key)
  })

  it('asks the daemon to restart when project/load suggests it', async () => {
    const p = project()
    const s = setup({ daemon: (m) => (m === 'project/load' ? { ok: true, restartSuggested: true } : { ok: true }) })
    await s.service.refresh({ root: p.root, module: ':app' })
    await s.service.prepare(p.appLayout)
    expect(s.requestRestart).toHaveBeenCalledTimes(1)
  })

  it('a failed project/load falls back to framework-only until the next refresh', async () => {
    const p = project()
    const s = setup({
      daemon: (m) => {
        if (m === 'project/load') throw new Error('boom')
        return { ok: true }
      },
    })
    await s.service.refresh({ root: p.root, module: ':app' })
    expect((await s.service.prepare(p.appLayout)).frameworkOnly).toBe(true)
    expect((await s.service.info(p.appLayout)).state).toMatchObject({ state: 'error', code: 'load-failed' })
    await s.service.prepare(p.appLayout)
    expect(s.calls.filter((c) => c.method === 'project/load')).toHaveLength(1)
  })
})

describe('generated res + warm projects', () => {
  it('watches generated res through the module dir, ignores other build output, waits longer', async () => {
    const p = project()
    const s = setup()
    await s.service.refresh({ root: p.root, module: ':app' })
    await s.service.prepare(p.appLayout)
    const gen = s.watchers[1]!
    expect(gen.dirs).toEqual([path.join(p.root, 'app')])
    gen.onChange([path.join(p.root, 'app', 'build', 'intermediates', 'x.dex'), path.join(p.root, 'app', 'src', 'main', 'res', 'a.xml')])
    await wait(100)
    expect(s.calls.filter((c) => c.method === 'project/changed')).toHaveLength(0)
    const strings = path.join(p.root, 'app', 'build', 'generated', 'res', 'values', 'gradleResValues.xml')
    gen.onChange([strings])
    await wait(30)
    expect(s.calls.filter((c) => c.method === 'project/changed')).toHaveLength(0)
    await wait(80)
    expect(s.calls.filter((c) => c.method === 'project/changed')).toEqual([{ method: 'project/changed', params: { kind: 'res', files: [strings] } }])
    expect(s.events.at(-1)).toEqual({ type: 'project-changed', root: p.root, module: ':app' })
  })

  it('treats only build/ below the Gradle root as generated (project under a folder named build)', async () => {
    const p = project()
    const root = path.join(tmp, 'build', `w${Math.random().toString(36).slice(2, 8)}`)
    mkdirSync(path.dirname(root), { recursive: true })
    const { renameSync } = await import('node:fs')
    renameSync(p.root, root)
    const s = setup()
    await s.service.refresh({ root, module: ':app' })
    await s.service.prepare(path.join(root, 'app', 'src', 'main', 'res', 'layout', 'main.xml'))
    expect(s.watchers.map((w) => w.dirs)).toEqual([[path.join(root, 'app', 'src', 'main', 'res')], [path.join(root, 'app')], [path.join(root, 'app', 'src')]])
  })

  it('re-watches when a refresh changes the res dirs of the loaded project', async () => {
    const p = project()
    const s = setup({
      model: (root, run) => {
        const m = modelJson(root)
        return run >= 2 ? { ...m, resDirs: [...m.resDirs, path.join(root, 'app', 'src', 'debug', 'res')] } : m
      },
    })
    await s.service.refresh({ root: p.root, module: ':app' })
    await s.service.prepare(p.appLayout)
    await s.service.refresh({ root: p.root, module: ':app' })
    expect(s.watchers.map((w) => w.closed)).toEqual([true, true, true, false, false, false])
    expect(s.watchers[3]!.dirs).toHaveLength(2)
  })

  it('stops both watchers when another project loads', async () => {
    const a = project()
    const b = project()
    const s = setup()
    await s.service.refresh({ root: a.root, module: ':app' })
    await s.service.refresh({ root: b.root, module: ':app' })
    await s.service.prepare(a.appLayout)
    await s.service.prepare(b.appLayout)
    expect(s.watchers.map((w) => w.closed)).toEqual([true, true, true, false, false, false])
  })

  it('sends projectId and flags classes refreshed while another project was active', async () => {
    const a = project()
    const b = project()
    const s = setup()
    await s.service.refresh({ root: a.root, module: ':app' })
    await s.service.refresh({ root: b.root, module: ':app' })
    await s.service.prepare(a.appLayout)
    await s.service.prepare(b.appLayout)
    await s.service.refresh({ root: a.root, module: ':app' })
    await s.service.prepare(a.appLayout)
    await s.service.prepare(b.appLayout)
    await s.service.prepare(a.appLayout)
    const loads = s.calls.filter((c) => c.method === 'project/load').map((c) => c.params as { projectId: string; classesChanged: boolean })
    expect(loads.map((l) => l.classesChanged)).toEqual([true, true, true, false, false])
    expect(loads[0]!.projectId).toMatch(/^[0-9a-f]{16}$/)
    expect(loads[0]!.projectId).toBe(loads[2]!.projectId)
    expect(loads[1]!.projectId).not.toBe(loads[0]!.projectId)
  })
})

describe('code change hint', () => {
  it('flags .kt / .java edits of the loaded model until the next refresh, ignores other files', async () => {
    const p = project()
    const s = setup({ model: (root) => ({ ...modelJson(root), classDirs: [path.join(root, 'lib', 'build', 'tmp', 'kotlin-classes', 'debug')] }) })
    const target = { root: p.root, module: ':app' }
    await s.service.refresh(target)
    await s.service.prepare(p.appLayout)
    const code = s.watchers[2]!
    expect(code.dirs).toEqual([path.join(p.root, 'lib', 'src'), path.join(p.root, 'app', 'src')])
    code.onChange([path.join(p.root, 'app', 'src', 'main', 'res', 'layout', 'main.xml')])
    expect((await s.service.info(p.appLayout)).codeChanged).toBe(false)
    code.onChange([path.join(p.root, 'lib', 'src', 'main', 'java', 'V.kt')])
    code.onChange([path.join(p.root, 'app', 'src', 'main', 'java', 'A.java')])
    expect(s.events.filter((e) => e.type === 'code-changed')).toEqual([{ type: 'code-changed', root: p.root, module: ':app' }])
    expect((await s.service.info(p.appLayout)).codeChanged).toBe(true)
    await wait(2)
    await s.service.refresh(target)
    expect((await s.service.info(p.appLayout)).codeChanged).toBe(false)
  })

  it('stops watching when the daemon stops (idle shutdown)', async () => {
    const p = project()
    const s = setup()
    await s.service.refresh({ root: p.root, module: ':app' })
    await s.service.prepare(p.appLayout)
    s.service.onDaemonState('stopped')
    expect(s.watchers.every((w) => w.closed)).toBe(true)
    s.watchers[2]!.onChange([path.join(p.root, 'app', 'src', 'A.kt')])
    expect(s.events.some((e) => e.type === 'code-changed')).toBe(false)
  })
})

describe('afterRunTarget', () => {
  const flutter = (over: Partial<FlutterRunConfig> = {}): FlutterRunConfig => ({
    id: 'f',
    name: 'main',
    type: 'flutter',
    cwd: path.join(tmp, 'flutter_app'),
    shared: false,
    env: {},
    beforeLaunch: [],
    entrypoint: 'lib/main.dart',
    device: 'selected',
    mode: 'debug',
    flavor: '',
    args: '',
    attachArgs: '',
    ...over,
  })
  const dev = (platform: string): RunDevice => ({ id: 'd', name: 'd', platform, emulator: false, state: 'ready', source: 'flutter' })
  const has = (p: string) => p.endsWith('settings.gradle')

  it('maps Flutter on Android to <cwd>/android :app with flavor + mode', () => {
    expect(afterRunTarget(flutter(), dev('android-arm64'), has)).toEqual({ root: path.join(tmp, 'flutter_app', 'android'), module: ':app', variant: 'debug' })
    expect(afterRunTarget(flutter({ flavor: 'dev', mode: 'profile' }), dev('android-x64'), has)?.variant).toBe('devProfile')
  })

  it('skips non-Android devices, missing android/ Gradle project and odd flavors', () => {
    expect(afterRunTarget(flutter(), dev('windows-x64'), has)).toBeNull()
    expect(afterRunTarget(flutter(), null, has)).toBeNull()
    expect(afterRunTarget(flutter(), dev('android-arm64'), () => false)).toBeNull()
    expect(afterRunTarget(flutter({ flavor: 'prod-eu' }), dev('android-arm64'), has)).toBeNull()
  })

  it('passes Android configs through and ignores custom ones', () => {
    const base = { id: 'a', name: 'app', cwd: '/p', shared: false, env: {}, beforeLaunch: [], device: 'selected', args: '' }
    expect(afterRunTarget({ ...base, type: 'android', module: ':app', variant: 'freeDebug' }, null)).toEqual({ root: '/p', module: ':app', variant: 'freeDebug' })
    expect(afterRunTarget({ id: 'c', name: 'c', cwd: '/p', shared: false, env: {}, beforeLaunch: [], type: 'custom', command: 'make' }, null)).toBeNull()
  })
})

describe('render cache', () => {
  it('is an LRU that evicts the least recently used entry', () => {
    const evicted: number[] = []
    const c = new RenderCache<number>(2, (v) => evicted.push(v))
    c.set('a', 1)
    c.set('b', 2)
    expect(c.get('a')).toBe(1)
    c.set('c', 3)
    expect(evicted).toEqual([2])
    expect(c.get('b')).toBeUndefined()
    expect(c.size).toBe(2)
  })
})

describe('RunManager.onSessionState', () => {
  it('reports the transition to running with the config', async () => {
    const root = path.join(tmp, `run${Date.now()}`)
    write(path.join(root, 'settings.gradle.kts'), 'include(":app")\n')
    write(path.join(root, 'app', 'build.gradle.kts'), 'plugins { id("com.android.application") }\n')
    const phone: RunDevice = { id: 'R58', name: 'Galaxy', platform: 'android', emulator: false, state: 'ready', source: 'adb' }
    const devices = (list: RunDevice[]): DeviceService => ({ list: async () => list, onChange: () => () => undefined, emulators: async () => [], launchEmulator: async () => ({ ok: true }), stop: () => undefined })
    const fake = (ctx: RunContext): Runner => ({
      start: async () => {
        ctx.hooks.state('building')
        ctx.hooks.state('running', { appId: 'x' })
      },
      stop: async () => undefined,
      kill: () => undefined,
    })
    const manager = new RunManager({
      dataDir: path.join(root, '.data'),
      env: {},
      platform: process.platform,
      home: tmp,
      spawn: () => {
        throw new Error('no spawn')
      },
      runners: { flutter: fake, android: fake, custom: fake },
      devices: { flutter: () => devices([]), adb: () => devices([phone]) },
      broadcast: () => undefined,
      confirm: async () => true,
    })
    const seen: string[] = []
    const off = manager.onSessionState((s, cfg, device) => seen.push(`${s.state}:${cfg.type}:${cfg.type === 'android' ? cfg.module : ''}:${device?.id ?? ''}`))
    const cfg = (await manager.configs(root)).find((c) => c.type === 'android')!
    expect((await manager.start({ root, configId: cfg.id, deviceId: 'R58' })).ok).toBe(true)
    await wait(5)
    expect(seen).toEqual(['building:android::app:R58', 'running:android::app:R58'])
    off()
    expect(existsSync(root)).toBe(true)
  })
})

describe('loose kit (PLAN-v44)', () => {
  const kit = { resDirs: [], aarResDirs: [{ dir: '/kit/aars/m/res', name: 'm' }], classpath: ['/kit/classes/m.jar'], rJar: '/kit/R.jar', packageName: 'dev.ccm.loosekit', namespace: 'dev.ccm.loosekit', appTheme: '@style/Theme.Material3.DayNight.NoActionBar', activityThemes: {} }

  it('loads the kit for a layout without a model and a real model wins', async () => {
    const p = project()
    const s = setup()
    s.deps.looseKit = async () => kit
    const loose = path.join(tmp, `loose${Date.now()}`, 'ad.xml')
    write(loose, '<androidx.constraintlayout.widget.ConstraintLayout/>')

    const first = await s.service.prepare(loose)
    expect(first).toEqual({ key: expect.stringMatching(/^loose-kit#/), frameworkOnly: true, builtinLibs: true, sourceOnly: false })
    expect(s.calls).toEqual([{ method: 'project/load', params: { ...kit, projectId: 'loose-kit' } }])
    expect(await s.service.prepare(loose)).toEqual(first)
    expect(s.calls).toHaveLength(1)

    // In a Gradle project without a built model: the kit stays loaded.
    expect((await s.service.prepare(p.appLayout)).key).toBe(first.key)
    expect(s.calls).toHaveLength(1)

    await s.service.refresh({ root: p.root, module: ':app' })
    const real = await s.service.prepare(p.appLayout)
    expect(real.frameworkOnly).toBe(false)
    expect((s.calls.at(-1)!.params as { packageName: string }).packageName).toBe('com.example.app')

    const back = await s.service.prepare(loose)
    expect(back.key).toMatch(/^loose-kit#/)
    expect(back.key).not.toBe(first.key)
    expect(s.calls.at(-1)!.params).toMatchObject({ projectId: 'loose-kit' })
  })

  it('without a model, project res from sources over the kit; a real model wins; a failed source load falls back to the kit', async () => {
    const p = project()
    const sourceModels = { gradleHome: path.join(tmp, 'no-gradle-home'), aarCacheDir: path.join(tmp, 'aars') }
    const s = setup()
    s.deps.looseKit = async () => kit
    s.deps.sourceModels = sourceModels
    const first = await s.service.prepare(p.appLayout)
    expect(first).toEqual({ key: expect.stringMatching(/^source:/), frameworkOnly: false, builtinLibs: true, sourceOnly: true })
    const params = s.calls[0]!.params as { resDirs: string[]; classpath: string[]; projectId: string }
    expect(params.resDirs).toEqual([path.join(p.root, 'lib', 'src', 'main', 'res'), path.join(p.root, 'app', 'src', 'main', 'res')])
    expect(params.classpath).toEqual(kit.classpath)
    expect(params.projectId).toMatch(/^source:/)
    expect(await s.service.prepare(p.appLayout)).toEqual(first)
    expect(s.calls).toHaveLength(1)
    expect(s.watchers.at(-1)!.dirs).toEqual(params.resDirs)

    s.watchers.at(-1)!.onChange([path.join(p.root, 'app', 'src', 'main', 'res', 'values', 'colors.xml')])
    await wait(60)
    expect(s.calls.at(-1)!.method).toBe('project/changed')
    expect(s.events).toContainEqual({ type: 'project-changed', root: p.root, module: ':app' })

    await s.service.refresh({ root: p.root, module: ':app' })
    const real = await s.service.prepare(p.appLayout)
    expect(real).toMatchObject({ frameworkOnly: false, sourceOnly: false })
    expect((s.calls.at(-1)!.params as { packageName: string }).packageName).toBe('com.example.app')

    const failing = setup({ daemon: (m, params) => (m === 'project/load' && String((params as { projectId?: string }).projectId).startsWith('source:') ? Promise.reject(new Error('boom')) : { ok: true }) })
    failing.deps.looseKit = async () => kit
    failing.deps.sourceModels = sourceModels
    expect(await failing.service.prepare(p.appLayout)).toMatchObject({ key: expect.stringMatching(/^loose-kit#/), sourceOnly: false })
    await failing.service.prepare(p.appLayout)
    expect(failing.calls.filter((c) => (c.params as { projectId?: string }).projectId?.startsWith('source:'))).toHaveLength(1)
  })

  it('no kit = framework only; a failed kit load is not retried until the daemon restarts', async () => {
    const none = setup()
    none.deps.looseKit = async () => null
    const loose = path.join(tmp, `loose${Date.now()}b`, 'ad.xml')
    write(loose, '<View/>')
    expect(await none.service.prepare(loose)).toEqual({ key: 'framework', frameworkOnly: true, builtinLibs: false, sourceOnly: false })
    expect(none.calls).toHaveLength(0)

    const s = setup({ daemon: () => { throw new Error('boom') } })
    s.deps.looseKit = async () => kit
    expect(await s.service.prepare(loose)).toEqual({ key: 'framework', frameworkOnly: true, builtinLibs: false, sourceOnly: false })
    await s.service.prepare(loose)
    expect(s.calls).toHaveLength(1)
    s.service.onDaemonState('starting')
    s.service.onDaemonState('ready')
    await s.service.prepare(loose)
    expect(s.calls).toHaveLength(2)
  })
})

describe('compile + auto compile', () => {
  it('the Refresh button compiles; Run builds only read the model', async () => {
    const p = project()
    const s = setup()
    await s.service.refreshFile(p.appLayout)
    expect(s.spawns[0]!.args.join(' ')).toContain('-Pccm.compile=true')
    s.service.afterBuild(p.root, ':app', 'debug')
    await wait(30)
    expect(s.spawns[1]!.args.join(' ')).not.toContain('-Pccm.compile=true')
    expect(s.events.some((e) => e.type === 'model' && e.state.state === 'running' && e.state.compile === true)).toBe(true)
  })

  it('auto compiles once per Gradle root per session, never with a model or with the setting off', async () => {
    const p = project()
    const s = setup()
    expect(await s.service.autoCompile(p.appLayout)).toBe(true)
    expect(await s.service.autoCompile(p.libLayout)).toBe(false)
    await wait(30)
    expect(s.spawns).toHaveLength(1)
    expect(s.spawns[0]!.args.join(' ')).toContain('-Pccm.compile=true')
    // The model now exists: nothing to compile.
    const next = setup({ modelsDir: s.deps.modelsDir })
    expect(await next.service.autoCompile(p.appLayout)).toBe(false)

    const off = setup()
    off.deps.getSettings = () => ({ androidSdk: null, jdk: null, layoutAutoCompile: false })
    expect(await off.service.autoCompile(project().appLayout)).toBe(false)
    const idle = setup()
    idle.deps.canRun = () => false
    expect(await idle.service.autoCompile(project().appLayout)).toBe(false)
    expect(off.spawns.length + idle.spawns.length).toBe(0)
  })

  it('a source model with classes of an earlier build reports prebuiltAt', async () => {
    const p = project()
    write(path.join(p.root, 'app', 'build', 'intermediates', 'compile_and_runtime_not_namespaced_r_class_jar', 'debug', 'processDebugResources', 'R.jar'), 'R')
    write(path.join(p.root, 'app', 'build', 'tmp', 'kotlin-classes', 'debug', 'A.class'), '')
    const s = setup()
    s.deps.sourceModels = { gradleHome: path.join(tmp, 'no-gradle-home'), aarCacheDir: path.join(tmp, 'aars') }
    const r = await s.service.prepare(p.appLayout)
    expect(r).toMatchObject({ frameworkOnly: false, sourceOnly: false, prebuiltAt: expect.any(Number) })
    const params = s.calls[0]!.params as { rJar: string; classpath: string[] }
    expect(params.rJar).toContain('R.jar')
    expect(params.classpath[0]).toBe(path.join(p.root, 'app', 'build', 'tmp', 'kotlin-classes', 'debug'))
  })
})
