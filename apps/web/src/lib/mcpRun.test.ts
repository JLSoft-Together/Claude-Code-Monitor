import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { RunConfig, RunDevice, RunSession } from '@ccm/shared'

const bridge = vi.hoisted(() => ({
  runSessions: vi.fn(),
  runStart: vi.fn(),
  runStop: vi.fn(),
  runReload: vi.fn(),
  runConfigs: vi.fn(),
  runDevices: vi.fn(),
}))

vi.mock('../lib/devices', () => ({ devSnapshot: () => Promise.resolve(null), devConnectMany: () => Promise.resolve([]) }))
vi.mock('../lib/desktop', () => ({
  desktop: {
    platform: 'win32',
    onRunEvent: () => () => {},
    runSessions: () => bridge.runSessions(),
    runStart: (req: unknown) => bridge.runStart(req),
    runStop: (id: string) => bridge.runStop(id),
    runReload: (id: string, full: boolean) => bridge.runReload(id, full),
    runConfigs: (root: string) => bridge.runConfigs(root),
    runDevices: () => bridge.runDevices(),
  },
  hasRun: true,
}))

import { useRunStore } from '../stores/run'
import { createRunCalls, isErrorLine, RUN_REPLY_MS } from './mcpRun'

const ROOT = 'C:\\work\\app'
const cfg = (id: string, device = 'selected'): RunConfig => ({ id, name: `cfg ${id}`, cwd: ROOT, shared: false, env: {}, beforeLaunch: [], type: 'android', module: ':app', variant: 'debug', device, args: '' })
const dev = (id: string, state: RunDevice['state'] = 'ready'): RunDevice => ({ id, name: `Phone ${id}`, platform: 'android', emulator: false, state, source: 'adb' })
const session = (over: Partial<RunSession> = {}): RunSession => ({
  id: 's1', configId: 'a', configName: 'cfg a', type: 'android', cwd: ROOT, deviceId: 'P1', deviceName: 'Phone P1', mode: null, state: 'running',
  startedAt: 10, endedAt: null, appId: 'com.x', vmServiceUri: null, devtoolsUri: null, failure: null, progress: null, ...over,
})
const base = { id: 'q', from: 'pane', cwd: ROOT }

describe('MCP run calls (page side)', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    bridge.runSessions.mockReset().mockResolvedValue([])
    bridge.runStart.mockReset().mockResolvedValue({ ok: true, sessionId: 'n1' })
    bridge.runStop.mockReset().mockResolvedValue({ ok: true })
    bridge.runReload.mockReset().mockResolvedValue({ ok: true })
    bridge.runConfigs.mockReset().mockResolvedValue([cfg('a'), cfg('b', 'P2')])
    bridge.runDevices.mockReset().mockResolvedValue([dev('P1'), dev('P2')])
  })

  it('starts the selected config on the selected device, or an asked config / device from the lists only', async () => {
    const calls = createRunCalls(useRunStore())
    await calls.app({ ...base, tool: 'run_app', action: 'start' })
    expect(bridge.runStart).toHaveBeenLastCalledWith({ root: ROOT, configId: 'a', deviceId: 'P1' })
    await calls.app({ ...base, tool: 'run_app', action: 'start', config: 'a', device: 'P2' })
    expect(bridge.runStart).toHaveBeenLastCalledWith({ root: ROOT, configId: 'a', deviceId: 'P2' })
    expect(await calls.app({ ...base, tool: 'run_app', action: 'start', config: 'zzz' })).toMatchObject({ ok: true, refused: { code: 'config' } })
    expect(await calls.app({ ...base, tool: 'run_app', action: 'start', config: 'a', device: 'evil' })).toMatchObject({ refused: { code: 'device' } })
    // b pins P2: another device is refused
    expect(await calls.app({ ...base, tool: 'run_app', action: 'start', config: 'b', device: 'P1' })).toMatchObject({ refused: { code: 'device' } })
    expect(bridge.runStart).toHaveBeenCalledTimes(2)
  })

  it('does not change the Run bar pick and refuses start of a pair already running', async () => {
    const run = useRunStore()
    const calls = createRunCalls(run)
    run.handleEvent({ type: 'session', session: session() })
    expect(await calls.app({ ...base, tool: 'run_app', action: 'start' })).toMatchObject({ refused: { code: 'running' }, session: { id: 's1', state: 'running' } })
    await calls.app({ ...base, tool: 'run_app', action: 'restart', config: 'a', device: 'P2' })
    expect(run.selected).toEqual({})
  })

  it('stop / reload act on the live run of the project; nothing running is a refusal', async () => {
    const run = useRunStore()
    const calls = createRunCalls(run)
    expect(await calls.app({ ...base, tool: 'run_app', action: 'stop' })).toMatchObject({ refused: { code: 'no-session' } })
    run.handleEvent({ type: 'session', session: session() })
    await calls.app({ ...base, tool: 'run_app', action: 'stop' })
    expect(bridge.runStop).toHaveBeenCalledWith('s1')
    await calls.app({ ...base, tool: 'run_app', action: 'reload', full: true })
    expect(bridge.runReload).toHaveBeenCalledWith('s1', true)
    run.handleEvent({ type: 'session', session: session({ id: 's2', state: 'building', startedAt: 20 }) })
    expect(await calls.app({ ...base, tool: 'run_app', action: 'reload' })).toMatchObject({ refused: { code: 'not-running' } })
    bridge.runStop.mockResolvedValue({ ok: false, error: { code: 'session-missing' } })
    expect(await calls.app({ ...base, tool: 'run_app', action: 'stop' })).toMatchObject({ refused: { code: 'session-missing' } })
  })

  it('answers waiting when the start takes longer than main lets the page reply', async () => {
    vi.useFakeTimers()
    try {
      const calls = createRunCalls(useRunStore())
      bridge.runStart.mockReturnValue(new Promise(() => {}))
      const pending = calls.app({ ...base, tool: 'run_app', action: 'start' })
      await vi.advanceTimersByTimeAsync(RUN_REPLY_MS + 10)
      expect(await pending).toMatchObject({ refused: { code: 'waiting' } })
    } finally {
      vi.useRealTimers()
    }
  })

  it('status lists configs, devices and runs of this project only, with a one-line last error', async () => {
    const run = useRunStore()
    const calls = createRunCalls(run)
    run.handleEvent({ type: 'session', session: session({ state: 'failed', failure: { code: 'build', detail: 'Gradle failed' }, endedAt: 30 }) })
    run.handleEvent({ type: 'session', session: session({ id: 'other', cwd: 'C:\\elsewhere' }) })
    const res = await calls.status({ ...base, tool: 'run_status' })
    expect(res).toMatchObject({
      ok: true,
      configs: [{ id: 'a', selected: true }, { id: 'b', device: 'P2', selected: false }],
      devices: [{ serial: 'P1', selected: true }, { serial: 'P2' }],
      sessions: [{ id: 's1', state: 'crashed', lastError: 'build: Gradle failed' }],
    })
  })

  it('log returns the last N lines (errors only on request) and marks output lost to a reload', async () => {
    const run = useRunStore()
    const calls = createRunCalls(run)
    expect(await calls.log({ ...base, tool: 'run_log', lines: 10, errorsOnly: false })).toMatchObject({ session: null, lines: [] })
    run.handleEvent({ type: 'session', session: session() })
    run.handleEvent({
      type: 'log',
      sessionId: 's1',
      lines: [
        { stream: 'build', text: 'compiling', at: 1 },
        { stream: 'logcat', text: 'boom', level: 'E', at: 2 },
        { stream: 'app', text: 'Build failed with an exception', at: 3 },
        { stream: 'app', text: 'ok', at: 4 },
      ],
    })
    const all = await calls.log({ ...base, tool: 'run_log', lines: 2, errorsOnly: false })
    expect(all).toMatchObject({ lines: [{ text: 'Build failed with an exception' }, { text: 'ok' }], partial: false })
    const errs = await calls.log({ ...base, tool: 'run_log', lines: 50, errorsOnly: true })
    expect(errs).toMatchObject({ lines: [{ text: 'boom', level: 'E' }, { text: 'Build failed with an exception' }] })
    expect(isErrorLine({ stream: 'app', text: 'terror is fine', at: 0 })).toBe(false)
  })
})
