import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { FwpEntry, FwpSnapshot } from '@ccm/shared'
import type { SpawnSpec } from '../src/run/proc'
import { FlutterPreviewService, type FlutterPreviewDeps } from '../src/flutterPreview/service'

interface FakeChild extends ChildProcess {
  sent: { id: number; method: string; params: Record<string, unknown> }[]
  msg(obj: Record<string, unknown>): void
  out(line: string): void
  exit(code: number | null): Promise<void>
}

const tick = (): Promise<void> => new Promise((r) => setImmediate(r))

function fakeChild(): FakeChild {
  const c = new EventEmitter() as FakeChild
  const stdin = new PassThrough()
  Object.assign(c, { stdout: new PassThrough(), stderr: new PassThrough(), stdin, pid: 42, exitCode: null, sent: [] })
  stdin.on('data', (chunk: Buffer) => {
    for (const l of chunk.toString().split('\n').filter(Boolean)) c.sent.push((JSON.parse(l) as FakeChild['sent'])[0]!)
  })
  c.msg = (obj) => (c.stdout as PassThrough).write(JSON.stringify([obj]) + '\n')
  c.out = (line) => (c.stdout as PassThrough).write(line + '\n')
  c.exit = async (code) => {
    await tick()
    c.emit('close', code)
    await tick()
  }
  return c
}

const PUBSPEC = 'name: demo\ndependencies:\n  flutter:\n    sdk: flutter\n'
const ENTRY: FwpEntry = { id: 'lib/a.dart#a', file: 'lib/a.dart', line: 1, symbol: 'a', label: 'a', call: 'a()' }

function harness(opts: { sdk?: string | null; pubspec?: string | null; sdkInside?: boolean } = {}) {
  const child = fakeChild()
  const specs: SpawnSpec[] = []
  const killed: boolean[] = []
  const hosts: string[] = []
  let onSave: ((changed: string[]) => void) | null = null
  let entries: FwpEntry[] = [ENTRY]
  const deps: FlutterPreviewDeps = {
    spawn: (spec) => {
      specs.push(spec)
      return child
    },
    env: { PATH: '' },
    platform: 'linux',
    home: '/home/u',
    settings: () => ({ flutterSdk: null }),
    emit: vi.fn<(s: FwpSnapshot) => void>(),
    watch: (_dir, cb) => {
      onSave = cb
      return () => (onSave = null)
    },
    kill: (_c, sync) => killed.push(sync === true),
    findSdk: () => (opts.sdk === null ? { sdk: null, source: null, fvm: null, issues: [{ code: 'flutter-missing' }] } : { sdk: opts.sdk ?? '/sdk', source: 'path', fvm: null, issues: [] }),
    sdkInside: () => opts.sdkInside === true,
    scan: async () => entries,
    readText: async () => (opts.pubspec === undefined ? PUBSPEC : opts.pubspec),
    writeHost: async (root, source) => {
      hosts.push(source)
      return { file: `${root}/.dart_tool/ccm_preview/main.dart`, changed: true }
    },
    stopTimeoutMs: 50,
    logFlushMs: 1,
  }
  const service = new FlutterPreviewService(deps)
  return {
    service,
    deps,
    child,
    specs,
    killed,
    hosts,
    save: (changed: string[]) => onSave?.(changed),
    watching: () => onSave !== null,
    setEntries: (e: FwpEntry[]) => (entries = e),
  }
}

async function started(h: ReturnType<typeof harness>): Promise<void> {
  h.child.msg({ event: 'app.start', params: { appId: 'app1' } })
  h.child.msg({ event: 'app.started', params: { appId: 'app1' } })
  await tick()
}

describe('FlutterPreviewService', () => {
  it('start spawns flutter run --machine on the host, then show calls ext.ccm.show', async () => {
    const h = harness()
    await h.service.show(ENTRY.id)
    expect(await h.service.start('/proj', 'emulator-5554', 'dev')).toEqual({ ok: true })
    expect(h.specs[0]).toMatchObject({ file: '/sdk/bin/flutter', cwd: '/proj', stdin: 'pipe' })
    expect(h.specs[0]!.args).toEqual(['run', '--machine', '-t', '/proj/.dart_tool/ccm_preview/main.dart', '-d', 'emulator-5554', '--debug', '--flavor', 'dev'])
    expect(h.hosts[0]).toContain("'lib/a.dart#a': () => p0.a(),")
    expect(h.service.get().state).toBe('starting')
    await started(h)
    expect(h.service.get()).toMatchObject({ state: 'running', appId: 'app1', current: ENTRY.id, entries: [ENTRY] })
    expect(h.watching()).toBe(true)
    const showOnStart = h.child.sent.find((m) => m.method === 'app.callServiceExtension')
    expect(showOnStart?.params).toEqual({ appId: 'app1', methodName: 'ext.ccm.show', params: { id: ENTRY.id } })
    h.child.msg({ id: showOnStart!.id, result: { ok: true } })

    const shown = h.service.show('lib/a.dart#other')
    await tick()
    const req = h.child.sent.at(-1)!
    expect(req.params).toMatchObject({ methodName: 'ext.ccm.show', params: { id: 'lib/a.dart#other' } })
    h.child.msg({ id: req.id, result: { ok: false } })
    expect(await shown).toEqual({ ok: false, error: { code: 'unknown-id' } })
  })

  it('saving a .dart file rescans, rewrites the host and hot reloads', async () => {
    const h = harness()
    await h.service.start('/proj', 'emulator-5554')
    await started(h)
    h.save(['/proj/lib/readme.md'])
    await tick()
    expect(h.child.sent.some((m) => m.method === 'app.restart')).toBe(false)
    const b: FwpEntry = { ...ENTRY, id: 'lib/a.dart#b', symbol: 'b', call: 'b()' }
    h.setEntries([ENTRY, b])
    h.save(['/proj/lib/a.dart'])
    await tick()
    expect(h.service.get().state).toBe('reloading')
    const restart = h.child.sent.find((m) => m.method === 'app.restart')!
    expect(restart.params).toEqual({ appId: 'app1', fullRestart: false, pause: false, reason: 'save' })
    expect(h.hosts.at(-1)).toContain('p0.b()')
    h.child.msg({ id: restart.id, result: { code: 0 } })
    await tick()
    expect(h.service.get()).toMatchObject({ state: 'running', entries: [ENTRY, b] })
  })

  it('stop sends app.stop, kills after the timeout, ends stopped', async () => {
    const h = harness()
    await h.service.start('/proj', 'emulator-5554')
    await started(h)
    const stopping = h.service.stop()
    expect(h.service.get().state).toBe('stopped')
    expect(h.child.sent.at(-1)?.method).toBe('app.stop')
    await new Promise((r) => setTimeout(r, 80))
    expect(h.killed).toEqual([false])
    await h.child.exit(0)
    await stopping
    expect(h.service.get().state).toBe('stopped')
    expect(h.watching()).toBe(false)
  })

  it('a build error before start fails with the parsed error', async () => {
    const h = harness()
    await h.service.start('/proj', 'emulator-5554')
    h.child.out('lib/a.dart:3:5: Error: Undefined name x.')
    await h.child.exit(1)
    const s = h.service.get()
    expect(s.state).toBe('failed')
    expect(s.error).toMatchObject({ code: 'build', build: { line: 3, col: 5, severity: 'error' } })
    expect(s.log).toContain('lib/a.dart:3:5: Error: Undefined name x.')
  })

  it('missing SDK, local FVM SDK and non-Flutter projects fail before spawning', async () => {
    const noSdk = harness({ sdk: null })
    expect(await noSdk.service.start('/proj', 'd1')).toEqual({ ok: false, error: { code: 'flutter-missing' } })
    const local = harness({ sdkInside: true })
    expect(await local.service.start('/proj', 'd1')).toMatchObject({ ok: false, error: { code: 'fvm-local-unverified' } })
    const dart = harness({ pubspec: 'name: pure\n' })
    expect(await dart.service.start('/proj', 'd1')).toMatchObject({ ok: false, error: { code: 'not-flutter' } })
    expect([...noSdk.specs, ...local.specs, ...dart.specs]).toHaveLength(0)
    expect(noSdk.service.get().state).toBe('failed')
  })

  it('stop during an in-flight start cancels it before spawn', async () => {
    const h = harness()
    let release: () => void = () => undefined
    h.deps.scan = () => new Promise<FwpEntry[]>((r) => (release = () => r([ENTRY])))
    const starting = h.service.start('/proj', 'emulator-5554')
    await tick()
    expect(h.service.get().state).toBe('starting')
    await h.service.stop()
    expect(h.service.get().state).toBe('stopped')
    release()
    expect(await starting).toEqual({ ok: false, error: { code: 'cancelled' } })
    expect(h.specs).toHaveLength(0)
    expect(h.service.get().state).toBe('stopped')
  })

  it('a scan failure after stop does not mark the session failed', async () => {
    const h = harness()
    let reject: (e: Error) => void = () => undefined
    h.deps.scan = () => new Promise<FwpEntry[]>((_r, j) => (reject = j))
    const starting = h.service.start('/proj', 'emulator-5554')
    await tick()
    h.service.killNow()
    reject(new Error('EACCES'))
    expect(await starting).toEqual({ ok: false, error: { code: 'cancelled' } })
    expect(h.service.get().state).not.toBe('failed')
    expect(h.specs).toHaveLength(0)
  })

  it('a hot reload compile error surfaces as error and clears on the next good reload', async () => {
    const h = harness()
    await h.service.start('/proj', 'emulator-5554')
    await started(h)
    h.save(['/proj/lib/a.dart'])
    await tick()
    h.child.msg({ event: 'daemon.logMessage', params: { level: 'error', message: 'lib/a.dart:4:2: Error: Expected a type.' } })
    await tick()
    const first = h.child.sent.filter((m) => m.method === 'app.restart').at(-1)!
    h.child.msg({ id: first.id, result: { code: 1, message: 'Reload rejected' } })
    await tick()
    expect(h.service.get()).toMatchObject({ state: 'running', error: { code: 'build', build: { line: 4, col: 2 } } })

    h.save(['/proj/lib/a.dart'])
    await tick()
    const second = h.child.sent.filter((m) => m.method === 'app.restart').at(-1)!
    h.child.msg({ id: second.id, result: { code: 1, message: 'Reload rejected' } })
    await tick()
    expect(h.service.get().error).toEqual({ code: 'reload-failed', detail: 'Reload rejected' })

    h.save(['/proj/lib/a.dart'])
    await tick()
    const third = h.child.sent.filter((m) => m.method === 'app.restart').at(-1)!
    h.child.msg({ id: third.id, result: { code: 0 } })
    await tick()
    expect(h.service.get()).toMatchObject({ state: 'running', error: null })
  })

  it('an unexpected exit after start reports device-lost or exited', async () => {
    const lost = harness()
    await lost.service.start('/proj', 'emulator-5554')
    await started(lost)
    lost.child.out('Lost connection to device.')
    await lost.child.exit(0)
    expect(lost.service.get()).toMatchObject({ state: 'stopped', error: { code: 'device-lost' } })

    const gone = harness()
    await gone.service.start('/proj', 'emulator-5554')
    await started(gone)
    await gone.child.exit(1)
    expect(gone.service.get()).toMatchObject({ state: 'stopped', error: { code: 'exited', detail: '1' } })
  })

  it('show while not running remembers the selection and returns ok', async () => {
    const h = harness()
    expect(await h.service.show(ENTRY.id)).toEqual({ ok: true })
    expect(h.service.get().current).toBe(ENTRY.id)
  })

  it('killNow kills synchronously', async () => {
    const h = harness()
    await h.service.start('/proj', 'emulator-5554')
    h.service.killNow()
    expect(h.killed).toEqual([true])
  })
})
