import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { RunConfig, RunDevice, RunEvent, RunLogLine, RunSession } from '@ccm/shared'

const bridge = vi.hoisted(() => ({
  handler: null as null | ((e: unknown) => void),
  onRunEvent: vi.fn(),
  runSessions: vi.fn(),
  runStart: vi.fn(),
}))

vi.mock('../lib/desktop', () => ({
  desktop: {
    platform: 'win32',
    onRunEvent: (h: (e: unknown) => void) => {
      bridge.handler = h
      bridge.onRunEvent()
      return () => {}
    },
    runSessions: () => bridge.runSessions(),
    runStart: (req: unknown) => bridge.runStart(req),
  },
  hasRun: true,
}))

import { LOG_CAP, inRoot, isRunnable, useRunStore } from './run'
import { useWorkspaceStore } from './workspace'

const ROOT = 'C:\\work\\app'

const session = (over: Partial<RunSession> = {}): RunSession => ({
  id: 's1',
  configId: 'c1',
  configName: 'main.dart',
  type: 'flutter',
  cwd: `${ROOT}\\mobile`,
  deviceId: 'emulator-5554',
  deviceName: 'Pixel',
  mode: 'debug',
  state: 'building',
  startedAt: 1,
  endedAt: null,
  appId: null,
  vmServiceUri: null,
  devtoolsUri: null,
  failure: null,
  progress: null,
  ...over,
})

const lines = (n: number, stream: RunLogLine['stream'] = 'build', from = 0): RunLogLine[] =>
  Array.from({ length: n }, (_, i) => ({ stream, text: `line ${from + i}`, at: from + i }))

const flutterCfg = (id: string): RunConfig => ({ id, name: id, cwd: ROOT, shared: false, env: {}, beforeLaunch: [], type: 'flutter', entrypoint: 'lib/main.dart', device: 'selected', mode: 'debug', flavor: '', args: '', attachArgs: '' })

describe('run store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    bridge.handler = null
    bridge.onRunEvent.mockClear()
    bridge.runSessions.mockReset().mockResolvedValue([])
    bridge.runStart.mockReset()
  })

  it('keeps only the last LOG_CAP lines per session and bumps the version once per flush', () => {
    const run = useRunStore()
    run.handleEvent({ type: 'session', session: session() })
    const v0 = run.logVersion
    run.handleEvent({ type: 'log', sessionId: 's1', lines: lines(LOG_CAP) })
    run.handleEvent({ type: 'log', sessionId: 's1', lines: lines(250, 'build', LOG_CAP) })
    expect(run.logVersion).toBe(v0)
    run.flushLogs()
    expect(run.logVersion).toBe(v0 + 1)
    const all = run.linesFor('s1')
    expect(all).toHaveLength(LOG_CAP)
    expect(all[0]!.text).toBe('line 250')
    expect(all.at(-1)!.text).toBe(`line ${LOG_CAP + 249}`)
  })

  it('filters and clears by stream', () => {
    const run = useRunStore()
    run.handleEvent({ type: 'session', session: session() })
    run.handleEvent({ type: 'log', sessionId: 's1', lines: [...lines(3, 'build'), ...lines(2, 'logcat', 10)] })
    run.handleEvent({ type: 'error', sessionId: 's1', error: { file: 'a.kt', line: 1, col: 2, message: 'x', severity: 'error' } })
    expect(run.linesFor('s1', ['logcat'])).toHaveLength(2)
    run.clearLog('s1', ['build'])
    expect(run.linesFor('s1')).toHaveLength(2)
    expect(run.errorsFor('s1')).toHaveLength(0)
  })

  it('dedupes build errors', () => {
    const run = useRunStore()
    run.handleEvent({ type: 'session', session: session() })
    const error = { file: 'lib/main.dart', line: 3, col: 1, message: 'Undefined name', severity: 'error' as const }
    run.handleEvent({ type: 'error', sessionId: 's1', error })
    run.handleEvent({ type: 'error', sessionId: 's1', error: { ...error } })
    expect(run.errorsFor('s1')).toHaveLength(1)
  })

  it('ignores output for unknown session ids', () => {
    const run = useRunStore()
    run.handleEvent({ type: 'log', sessionId: 'ghost', lines: lines(5) })
    run.handleEvent({ type: 'error', sessionId: 'ghost', error: { file: 'a.kt', line: 1, col: 2, message: 'x', severity: 'error' } })
    expect(run.linesFor('ghost')).toHaveLength(0)
    expect(run.errorsFor('ghost')).toHaveLength(0)
  })

  it('subscribes once and merges live sessions', async () => {
    bridge.runSessions.mockResolvedValue([session({ state: 'running' })])
    const run = useRunStore()
    await run.ensure()
    await run.ensure()
    expect(bridge.onRunEvent).toHaveBeenCalledTimes(1)
    expect(run.liveSessionsFor(ROOT).map((s) => s.id)).toEqual(['s1'])
    expect(run.isRestored('s1')).toBe(true)
    bridge.handler!({ type: 'session', session: session({ id: 's2', state: 'running', startedAt: 5 }) } satisfies RunEvent)
    expect(run.isRestored('s2')).toBe(false)
    expect(run.focusedSession(ROOT)?.id).toBe('s2')
    run.focusSession(ROOT, 's1')
    expect(run.focusedSession(ROOT)?.id).toBe('s1')
    expect(run.sessionsFor('C:\\work\\other')).toHaveLength(0)
  })

  it('remembers the picked config and device per root', async () => {
    const run = useRunStore()
    run.handleEvent({ type: 'configs', root: ROOT, configs: [flutterCfg('a'), flutterCfg('b')] })
    const devices: RunDevice[] = [
      { id: 'd1', name: 'Pixel', platform: 'android-arm64', emulator: true, state: 'ready', source: 'flutter' },
      { id: 'd2', name: 'Chrome', platform: 'web-javascript', emulator: false, state: 'ready', source: 'flutter' },
    ]
    run.handleEvent({ type: 'devices', devices })
    expect(run.selectedConfig(ROOT)?.id).toBe('a')
    run.select(ROOT, { config: 'b', device: 'd2' })
    expect(JSON.parse(localStorage.getItem('ccm.run.selected')!)).toEqual({ 'c:\\work\\app': { config: 'b', device: 'd2' } })
    bridge.runStart.mockResolvedValue({ ok: true, sessionId: 'n1' })
    await run.start(ROOT)
    expect(bridge.runStart).toHaveBeenCalledWith({ root: ROOT, configId: 'b', deviceId: 'd2' })

    setActivePinia(createPinia())
    expect(useRunStore().selected['c:\\work\\app']).toEqual({ config: 'b', device: 'd2' })
  })

  it('keeps a start refusal as the project notice', async () => {
    const run = useRunStore()
    run.handleEvent({ type: 'configs', root: ROOT, configs: [flutterCfg('a')] })
    bridge.runStart.mockResolvedValue({ ok: false, error: { code: 'device-missing' } })
    await run.start(ROOT)
    expect(run.noticeFor(ROOT)).toEqual({ code: 'device-missing' })
  })

  it('sends a build error to the most recently focused agent pane inside the run root, without Enter', () => {
    const run = useRunStore()
    const ws = useWorkspaceStore()
    const error = { file: `${ROOT}\\mobile\\lib\\main.dart`, line: 12, col: 5, message: 'Undefined name\n  foo', severity: 'error' as const }
    expect(run.sendErrorToAgent(error, ROOT)).toBe(false)
    const outside = ws.open('claude', 'C:\\work\\other')
    const shell = ws.open('shell', ROOT)
    const mobile = ws.open('claude', `${ROOT}\\mobile`)
    const codex = ws.open('codex', ROOT)
    for (const p of [outside, shell, mobile, codex]) ws.update(p.key, { state: 'running' })
    ws.update(outside.key, { focusedAt: 50 })
    ws.update(shell.key, { focusedAt: 40 })
    ws.update(codex.key, { focusedAt: 10 })
    ws.update(mobile.key, { focusedAt: 20 })
    expect(run.sendErrorToAgent(error, ROOT)).toBe(true)
    expect(ws.insertRequest).toMatchObject({ paneKey: mobile.key, text: '@lib/main.dart:12:5 Undefined name foo' })
    expect(ws.activeKey).toBe(mobile.key)
    ws.update(mobile.key, { state: 'exited' })
    expect(run.sendErrorToAgent(error, ROOT)).toBe(true)
    expect(ws.insertRequest).toMatchObject({ paneKey: codex.key, text: '@mobile/lib/main.dart:12:5 Undefined name foo' })
  })

  it('shows refused stop / reload / emulator results as the project notice', async () => {
    const run = useRunStore()
    await run.reload('s1', false, ROOT)
    expect(run.noticeFor(ROOT)).toEqual({ code: 'reload-failed' })
  })
})

describe('run helpers', () => {
  it('matches folders inside a root only', () => {
    expect(inRoot('C:/work/app/mobile', 'c:\\work\\app')).toBe(true)
    expect(inRoot('C:\\work\\app2', 'C:\\work\\app')).toBe(false)
  })

  it('treats Flutter packages as not runnable unless they ship an example', () => {
    const base = { kind: 'flutter' as const, dir: ROOT, name: 'x', entrypoints: [], platforms: [], flavors: [], needsPubGet: false, fvm: null }
    expect(isRunnable({ ...base, type: 'package' })).toBe(false)
    expect(isRunnable({ ...base, type: 'plugin', example: `${ROOT}\\example` })).toBe(true)
    expect(isRunnable({ kind: 'android', dir: ROOT, name: 'a', framework: 'native', status: 'no-app', modules: [] })).toBe(false)
  })
})
