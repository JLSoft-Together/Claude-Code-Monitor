import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { parseMcpPageResult, type AdbDevice, type DevSnapshot, type McpPageResult, type RunSession } from '@ccm/shared'
import { handleMcp, type ToolHost } from '../src/pty/mcp'
import type { McpTool } from '../src/pty/mcpTools/types'
import { deviceScreenshot } from '../src/pty/mcpTools/deviceScreenshot'
import { runApp } from '../src/pty/mcpTools/runApp'
import { runLog } from '../src/pty/mcpTools/runLog'
import { runStatus } from '../src/pty/mcpTools/runStatus'
import { mcpScreenshot, TEMP_SHOT_DIR, type McpShotDeps } from '../src/devices/mcpShot'

const TOOLS: readonly McpTool[] = [runApp, runStatus, runLog, deviceScreenshot]
const ROOT = path.join(os.tmpdir(), 'ccm-run-project')
const fail = (): Promise<never> => Promise.reject(new Error('not expected'))
const hostWith = (over: Partial<ToolHost> = {}): ToolHost => ({ root: ROOT, take: () => true, openSession: fail, notify: fail, page: fail, checkoutRoots: () => Promise.resolve([]), ...over })
const call = async (host: ToolHost, name: string, args: unknown) => {
  const res = await handleMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, host, '0', TOOLS)
  return (res.json as { result: { content: { text: string }[]; structuredContent: Record<string, unknown>; isError?: boolean } }).result
}
// What the host's askPageMcp does with the page's raw answer.
const pageSays = (raw: unknown) => vi.fn((c: { tool: string }) => Promise.resolve(parseMcpPageResult(raw, c.tool as never)))

const sessionRaw = {
  id: '0b6f8f4e-1111-4222-8333-944445555666',
  configId: 'auto-android-app',
  configName: 'app',
  type: 'android',
  deviceId: 'emulator-5554',
  deviceName: 'Pixel 7',
  rawState: 'running',
  startedAt: 1_700_000_000_000,
  endedAt: null,
  appId: 'com.example',
  lastError: null,
}

describe('run_app', () => {
  it('validates arguments before asking the page', async () => {
    const page = vi.fn(fail)
    const host = hostWith({ page })
    for (const args of [{}, { action: 'deploy' }, { action: 'start', config: '-rf' }, { action: 'start', config: 'a b' }, { action: 'start', device: '../x' }, { action: 'start', full: true }, { action: 'reload', full: 'yes' }]) {
      expect((await call(host, 'run_app', args)).isError).toBe(true)
    }
    expect(page).not.toHaveBeenCalled()
  })

  it('takes the rate limit before anything else', async () => {
    const page = vi.fn(fail)
    const take = vi.fn(() => false)
    const res = await call(hostWith({ page, take }), 'run_app', { action: 'start' })
    expect(res.structuredContent).toEqual({ ok: false, error: 'rate' })
    expect(take).toHaveBeenCalledWith('run', 6, 60_000)
    expect(page).not.toHaveBeenCalled()
  })

  it('passes only checked fields and reports the run', async () => {
    const page = pageSays({ ok: true, action: 'start', session: { ...sessionRaw, rawState: 'building' } })
    const res = await call(hostWith({ page }), 'run_app', { action: 'start', config: 'auto-android-app', device: 'emulator-5554' })
    expect(page).toHaveBeenCalledWith({ tool: 'run_app', action: 'start', config: 'auto-android-app', device: 'emulator-5554' })
    expect(res.isError).toBeUndefined()
    expect(res.content[0]!.text).toContain('Started')
    expect(res.structuredContent).toMatchObject({ ok: true, session: { state: 'starting', rawState: 'building' } })
  })

  it('a start still waiting for the trust confirm is not an error', async () => {
    const res = await call(hostWith({ page: pageSays({ ok: true, action: 'start', refused: { code: 'waiting' }, session: null }) }), 'run_app', { action: 'start' })
    expect(res.isError).toBeUndefined()
    expect(res.structuredContent).toMatchObject({ ok: true, pending: true })
  })

  it('turns refusals and page errors into tool errors', async () => {
    const refused = await call(hostWith({ page: pageSays({ ok: true, action: 'start', refused: { code: 'config' }, session: null }) }), 'run_app', { action: 'start', config: 'nope' })
    expect(refused.isError).toBe(true)
    expect(refused.content[0]!.text).toContain('run_status')
    const noRun = await call(hostWith({ page: pageSays({ ok: true, action: 'stop', refused: { code: 'no-session' }, session: null }) }), 'run_app', { action: 'stop' })
    expect(noRun.content[0]!.text).toContain('Nothing of this project is running')
    const caller = await call(hostWith({ page: pageSays({ ok: false, error: 'caller' }) }), 'run_app', { action: 'stop' })
    expect(caller.structuredContent).toEqual({ ok: false, error: 'caller' })
    const junk = await call(hostWith({ page: pageSays({ ok: true, action: 'explode' }) }), 'run_app', { action: 'stop' })
    expect(junk.structuredContent).toEqual({ ok: false, error: 'failed' })
  })
})

describe('run_status / run_log', () => {
  it('status with no run configuration and no device', async () => {
    const res = await call(hostWith({ page: pageSays({ ok: true, configs: [], devices: [], sessions: [], focused: null }) }), 'run_status', {})
    expect(res.content[0]!.text).toContain('no Run configuration')
    expect(res.content[0]!.text).toContain('No device')
  })

  it('status drops entries the page made up', async () => {
    const page = pageSays({
      ok: true,
      configs: [{ id: 'ok', name: 'Debug', type: 'flutter', selected: true }, { id: '--evil', name: 'x', type: 'flutter' }, { id: 'y', name: 'y', type: 'shell' }],
      devices: [{ serial: 'emulator-5554', name: 'Pixel\u202e7', platform: 'android', state: 'ready' }, { serial: 'a b', name: 'n', platform: 'android', state: 'ready' }],
      sessions: [sessionRaw, { ...sessionRaw, id: '../x' }],
      focused: sessionRaw.id,
    })
    const res = await call(hostWith({ page }), 'run_status', {})
    expect(res.structuredContent).toMatchObject({ configs: [{ id: 'ok' }], devices: [{ serial: 'emulator-5554', name: 'Pixel7' }], sessions: [{ id: sessionRaw.id }] })
    expect((res.structuredContent.configs as unknown[]).length).toBe(1)
  })

  it('log: lines must be 1..200; text is cleaned and masked', async () => {
    const page = vi.fn(fail)
    for (const lines of [0, 201, 1.5, '5']) expect((await call(hostWith({ page }), 'run_log', { lines })).isError).toBe(true)
    expect((await call(hostWith({ page }), 'run_log', { errorsOnly: 'y' })).isError).toBe(true)
    expect(page).not.toHaveBeenCalled()
    const home = os.homedir()
    const said = pageSays({
      ok: true,
      session: sessionRaw,
      lines: [
        { stream: 'build', text: '\x1b[31mFAILURE\x1b[0m token=abcd1234secret' },
        { stream: 'logcat', level: 'E', text: `key sk-AAAAAAAAAAAAAAAA in ${path.join(home, 'app')}` },
        { stream: 'nope', text: 'dropped' },
      ],
      errors: [{ file: path.join(home, 'app', 'Main.kt'), line: 3, col: 1, message: 'Unresolved reference', severity: 'error' }],
      partial: true,
    })
    const res = await call(hostWith({ page: said }), 'run_log', { lines: 10, errorsOnly: true })
    expect(said).toHaveBeenCalledWith({ tool: 'run_log', lines: 10, errorsOnly: true })
    const text = res.content[0]!.text
    expect(text).toContain('[build] FAILURE token=[masked]')
    expect(text).toContain('key [masked]')
    expect(text).not.toContain('sk-AAAA')
    expect(text).not.toContain('\x1b')
    expect(text).not.toContain('dropped')
    expect(text).not.toContain(home)
    expect(text).toContain('Unresolved reference')
    expect(text).toContain('reloaded')
  })

  it('log without any run', async () => {
    const res = await call(hostWith({ page: pageSays({ ok: true, session: null, lines: [], errors: [] }) }), 'run_log', {})
    expect(res.content[0]!.text).toContain('Nothing has run')
  })
})

describe('device_screenshot tool', () => {
  it('validates serial and the rate limit before asking', async () => {
    const page = vi.fn(fail)
    expect((await call(hostWith({ page }), 'device_screenshot', { serial: '-s' })).isError).toBe(true)
    expect((await call(hostWith({ page }), 'device_screenshot', { serial: 'a;rm' })).isError).toBe(true)
    const take = vi.fn(() => false)
    expect((await call(hostWith({ page, take }), 'device_screenshot', {})).structuredContent).toEqual({ ok: false, error: 'rate' })
    expect(take).toHaveBeenCalledWith('shot', 10, 60_000)
    expect(page).not.toHaveBeenCalled()
  })

  it('lists the devices when several are connected, returns the path when saved', async () => {
    const several = await call(hostWith({ page: pageSays({ ok: true, refused: { code: 'several' }, devices: [{ serial: 'A1', name: 'One' }, { serial: 'B2', name: 'Two' }] }) }), 'device_screenshot', {})
    expect(several.isError).toBe(true)
    expect(several.content[0]!.text).toContain('A1')
    const file = path.join(ROOT, 'shots', 'Pixel-20261103-101010.png')
    const ok = await call(hostWith({ page: pageSays({ ok: true, shot: { path: file, width: 1080, height: 2400, serial: 'A1', name: 'Pixel', saved: 'capture' } }) }), 'device_screenshot', { serial: 'A1' })
    expect(ok.content[0]!.text).toContain(file)
    expect(ok.structuredContent).toMatchObject({ ok: true, width: 1080, height: 2400 })
    const notPng = parseMcpPageResult({ ok: true, shot: { path: 'C:\\x.exe', width: 1, height: 1, serial: 'A1', name: 'P' } }, 'device_screenshot')
    expect(notPng).toEqual({ ok: false, error: 'failed' })
  })
})

describe('mcpScreenshot (main)', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'ccm-shot-'))
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))
  const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
  const device = (id: string, state: AdbDevice['state'] = 'ready', online = true): AdbDevice => ({ id, state, transport: 'usb', model: id, product: null, device: null, transportId: null, alias: null, name: `Phone ${id}`, online, lastSeen: null })
  const run = (over: Partial<RunSession>): RunSession => ({
    id: 'r', configId: 'c', configName: 'c', type: 'android', cwd: path.join(ROOT, 'android'), deviceId: 'B2', deviceName: 'B', mode: null, state: 'running',
    startedAt: 1, endedAt: null, appId: null, vmServiceUri: null, devtoolsUri: null, failure: null, progress: null, ...over,
  })
  const deps = (over: Partial<McpShotDeps> & { devices?: AdbDevice[]; adb?: string | null } = {}): McpShotDeps => ({
    snapshot: (): Promise<DevSnapshot> => Promise.resolve({ adb: over.adb === undefined ? 'adb' : over.adb, devices: over.devices ?? [device('A1')], autoConnect: false }),
    screencap: vi.fn(() => Promise.resolve({ ok: true as const, png: `data:image/png;base64,${PNG.toString('base64')}`, width: 1080, height: 2400 })),
    runs: () => [],
    writeShot: vi.fn(() => Promise.resolve(path.join(tmp, 'cap.png'))),
    captureActive: () => true,
    tmpRoot: tmp,
    ...over,
  })

  it('refuses without adb, an unknown or offline serial, no device, several devices', async () => {
    expect((await mcpScreenshot({ cwd: ROOT }, deps({ adb: null }))).refused?.code).toBe('adb-missing')
    expect((await mcpScreenshot({ cwd: ROOT, serial: 'ZZ' }, deps())).refused?.code).toBe('not-connected')
    expect((await mcpScreenshot({ cwd: ROOT, serial: 'A1' }, deps({ devices: [device('A1', 'unauthorized')] }))).refused?.code).toBe('not-connected')
    expect((await mcpScreenshot({ cwd: ROOT }, deps({ devices: [device('A1', 'ready', false)] }))).refused?.code).toBe('no-device')
    const several = await mcpScreenshot({ cwd: ROOT }, deps({ devices: [device('A1'), device('B2')] }))
    expect(several).toMatchObject({ refused: { code: 'several' }, devices: [{ serial: 'A1' }, { serial: 'B2' }] })
  })

  it("defaults to the device of the project's live run, then saves in the capture folder", async () => {
    const d = deps({ devices: [device('A1'), device('B2')], runs: () => [run({}), run({ id: 'x', deviceId: 'A1', cwd: path.join(os.tmpdir(), 'other') })] })
    const res = await mcpScreenshot({ cwd: ROOT }, d)
    expect(d.screencap).toHaveBeenCalledWith('B2')
    expect(res.shot).toMatchObject({ serial: 'B2', saved: 'capture', width: 1080, path: path.join(tmp, 'cap.png') })
    expect(d.writeShot).toHaveBeenCalledWith(PNG, 'Phone B2')
  })

  it('without a capture folder writes Orrery-named files to temp and keeps only the newest', async () => {
    const d = deps({ captureActive: () => false })
    const res = await mcpScreenshot({ cwd: ROOT }, d)
    expect(res.shot?.saved).toBe('temp')
    expect(path.dirname(res.shot!.path)).toBe(path.join(tmp, TEMP_SHOT_DIR))
    expect(readdirSync(path.join(tmp, TEMP_SHOT_DIR))).toHaveLength(1)
    expect(d.writeShot).not.toHaveBeenCalled()
  })

  it('gives up before the host stops waiting and then saves nothing', async () => {
    let release: (v: unknown) => void = () => {}
    const slow = deps({ deadlineMs: 20, screencap: () => new Promise((r) => (release = r as never)), writeShot: vi.fn(() => Promise.resolve('x.png')) })
    expect((await mcpScreenshot({ cwd: ROOT }, slow)).refused?.code).toBe('timeout')
    release({ ok: true, png: `data:image/png;base64,${PNG.toString('base64')}`, width: 1, height: 1 })
    await new Promise((r) => setTimeout(r, 10))
    expect(slow.writeShot).not.toHaveBeenCalled()
  })

  it('passes a secure window refusal through, never another error code', async () => {
    const secure = deps({ screencap: () => Promise.resolve({ ok: false as const, error: 'secure' as const }) })
    expect((await mcpScreenshot({ cwd: ROOT }, secure)).refused?.code).toBe('secure')
    const busy = deps({ screencap: () => Promise.resolve({ ok: false as const, error: 'busy' as const }) })
    expect((await mcpScreenshot({ cwd: ROOT }, busy)).refused?.code).toBe('capture-failed')
  })
})
