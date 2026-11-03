import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ResourceReport, ServerRes } from '@ccm/shared'
import { parseMcpDeskResult, type McpDeskCall, type McpDeskResult } from '../../../packages/shared/src/mcpDesk'
import { LayoutError } from '../src/layout/daemon'
import { registerLayoutIpc } from '../src/layout/ipc'
import { createDesk, type DeskDeps } from '../src/mcpDesk'
import { freePort } from '../src/pty/mcpTools/freePort'
import { listServers } from '../src/pty/mcpTools/listServers'
import { previewLayout } from '../src/pty/mcpTools/previewLayout'
import type { DeskAsk, ToolHost } from '../src/pty/mcpTools/types'
import { mineOf, paneScope, planFreePort, serversFor } from '../src/resources/agentPorts'

let dir = ''
let root = ''
let layout = ''

beforeAll(() => {
  dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ccm-desk-')))
  root = path.join(dir, 'app')
  layout = path.join(root, 'src', 'main', 'res', 'layout', 'main.xml')
  mkdirSync(path.dirname(layout), { recursive: true })
  writeFileSync(layout, '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"/>')
  writeFileSync(path.join(root, 'notes.txt'), 'x')
  mkdirSync(path.join(dir, 'other'))
  writeFileSync(path.join(dir, 'other', 'x.xml'), '<LinearLayout/>')
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const fail = (): Promise<never> => Promise.reject(new Error('not expected'))
const hostWith = (desk?: (c: DeskAsk) => Promise<McpDeskResult>, take: ToolHost['take'] = () => true): ToolHost => ({
  root,
  take,
  openSession: fail,
  notify: fail,
  page: fail,
  checkoutRoots: () => Promise.resolve([]),
  ...(desk ? { desk } : {}),
})
const text = (r: { content: { text: string }[] }): string => r.content[0]!.text

describe('preview_layout tool', () => {
  it('checks arguments before asking main', async () => {
    const desk = vi.fn(async (): Promise<McpDeskResult> => ({ ok: false, error: 'failed' }))
    const host = hostWith(desk)
    expect((await previewLayout.call({ path: layout, device: 'watch' }, host)).structuredContent).toMatchObject({ error: 'device' })
    expect((await previewLayout.call({ path: layout, theme: 'sepia' }, host)).structuredContent).toMatchObject({ error: 'theme' })
    expect((await previewLayout.call({ path: path.join(dir, 'other', 'x.xml') }, host)).structuredContent).toMatchObject({ error: 'outside' })
    expect((await previewLayout.call({ path: '../other/x.xml' }, host)).structuredContent).toMatchObject({ error: 'outside' })
    expect((await previewLayout.call({ path: 'notes.txt' }, host)).structuredContent).toMatchObject({ error: 'xml' })
    expect((await previewLayout.call({ path: 'nope.xml' }, host)).structuredContent).toMatchObject({ error: 'missing' })
    expect(desk).not.toHaveBeenCalled()
    expect((await previewLayout.call({ path: layout }, hostWith())).structuredContent).toMatchObject({ error: 'unavailable' })
    expect((await previewLayout.call({ path: layout }, hostWith(desk, () => false))).structuredContent).toMatchObject({ error: 'rate' })
  })

  it('passes the resolved path and says when to call again while starting', async () => {
    const desk = vi.fn(async (): Promise<McpDeskResult> => ({ ok: false, error: 'starting', retryInSec: 6 }))
    const res = await previewLayout.call({ path: 'src/main/res/layout/main.xml', device: 'tablet', theme: 'dark' }, hostWith(desk))
    expect(desk).toHaveBeenCalledWith({ tool: 'preview_layout', path: layout, device: 'tablet', night: true })
    expect(res.isError).toBe(true)
    expect(text(res)).toMatch(/starting.*about 6 seconds/)
    const ok = await previewLayout.call(
      { path: layout },
      hostWith(async () => ({ ok: true, tool: 'preview_layout', png: 'C:/shots/layout-main.png', width: 1080, height: 2340, renderMs: 42, frameworkOnly: false, diagnostics: [{ severity: 'error', message: 'Missing class', line: 3 }] })),
    )
    expect(text(ok)).toContain('layout-main.png')
    expect(text(ok)).toContain('error line 3: Missing class')
  })
})

describe('list_servers / free_port tools', () => {
  it('list_servers prints mine first with idle time, outside ports by name only', async () => {
    const res = await listServers.call(
      {},
      hostWith(async () => ({
        ok: true,
        tool: 'list_servers',
        at: '2026-11-03T10:00:00Z',
        servers: [{ pid: 10, name: 'node', kind: 'dev-server', ports: [5173], mine: true, cmd: 'vite', idleSec: 600, orphan: false }],
        outside: [{ port: 8080, name: 'java' }],
      })),
    )
    expect(text(res)).toContain('[mine] node (dev-server, pid 10) :5173 — idle 10 min')
    expect(text(res)).toContain(':8080 java')
  })

  it('free_port validates the port, rate-limits and reports a refusal', async () => {
    const desk = vi.fn(async (): Promise<McpDeskResult> => ({ ok: false, error: 'cancelled' }))
    for (const port of [0, 70000, 1.5, '3000', null]) expect((await freePort.call({ port }, hostWith(desk))).structuredContent).toMatchObject({ error: 'port' })
    expect(desk).not.toHaveBeenCalled()
    expect((await freePort.call({ port: 3000 }, hostWith(desk, () => false))).structuredContent).toMatchObject({ error: 'rate' })
    const res = await freePort.call({ port: 3000 }, hostWith(desk))
    expect(desk).toHaveBeenCalledWith({ tool: 'free_port', port: 3000 })
    expect(text(res)).toMatch(/declined/)
    expect(freePort.def.annotations.destructiveHint).toBe(true)
  })
})

describe('parseMcpDeskResult', () => {
  it('re-checks what main sends back', () => {
    expect(parseMcpDeskResult({ ok: false, error: 'rm -rf' }, 'free_port')).toEqual({ ok: false, error: 'failed' })
    expect(parseMcpDeskResult({ ok: false, error: 'starting', retryInSec: 5000 }, 'preview_layout')).toEqual({ ok: false, error: 'starting' })
    expect(parseMcpDeskResult({ ok: true, png: 'a.txt', width: 1, height: 1 }, 'preview_layout')).toEqual({ ok: false, error: 'failed' })
    const list = parseMcpDeskResult({ ok: true, at: 'x', servers: [{ pid: 3, name: 'n\u202eode\nx', kind: 'other', ports: [80, 'x', 99999], mine: false, cmd: 'secret', idleSec: null }], outside: [] }, 'list_servers')
    expect(list).toEqual({ ok: true, tool: 'list_servers', at: 'x', servers: [{ pid: 3, name: 'n ode x', kind: 'other', ports: [80], mine: false, idleSec: null, orphan: false }], outside: [] })
  })
})

const server = (over: Partial<ServerRes>): ServerRes => ({
  pid: 100,
  start: '133',
  kind: 'dev-server',
  name: 'node',
  cmd: 'npm run dev',
  ports: [{ port: 3000, address: '127.0.0.1', established: 0 }],
  ramBytes: 1,
  cpuPct: 0,
  idleSinceMs: 0,
  lastBusyAt: null,
  forgotten: false,
  sessionId: null,
  orphan: false,
  ...over,
})
const report = (servers: ServerRes[], over: Partial<ResourceReport> = {}): ResourceReport => ({
  at: '2026-11-03T10:00:00Z',
  idleMinutes: 30,
  cores: 8,
  sessions: [{ sessionId: 'S1', pid: 20, ramBytes: 1, cpuPct: 0, idleSinceMs: null, forgotten: false }],
  servers,
  totals: { ramBytes: 0, cpuPct: 0, forgotten: 0, forgottenRamBytes: 0 },
  ...over,
})
// pane shell 10 → claude 20 → node 30; another tree 50 → 60.
const rows = [
  { pid: 10, ppid: 1, cmd: '' },
  { pid: 20, ppid: 10, cmd: '' },
  { pid: 30, ppid: 20, cmd: '' },
  { pid: 50, ppid: 1, cmd: '' },
  { pid: 60, ppid: 50, cmd: '' },
]

describe('pane scope', () => {
  let home = ''
  beforeAll(() => {
    home = path.join(dir, 'home')
  })
  it('mine = pane tree, its agent session, or a working folder in the project (not for home / drive roots)', () => {
    const scope = paneScope(root, 10, rows, home)
    const mine = mineOf(report([]), scope)
    expect(mine(server({ pid: 30 }))).toBe(true)
    expect(mine(server({ pid: 99, sessionId: 'S1', orphan: true }))).toBe(true)
    expect(mine(server({ pid: 99, cwd: path.join(root, 'web') }))).toBe(true)
    expect(mine(server({ pid: 60, cwd: path.join(dir, 'other') }))).toBe(false)
    expect(mine(server({ pid: 30, kind: 'emulator' }))).toBe(false)
    const wide = paneScope(path.parse(root).root, 10, rows, home)
    expect(wide.projectRule).toBe(false)
    expect(paneScope(home, 10, rows, home).projectRule).toBe(false)
    expect(paneScope(dir, 10, rows, home).projectRule).toBe(false)
    expect(mineOf(report([]), wide)(server({ pid: 99, cwd: path.join(root, 'web') }))).toBe(false)
    expect(paneScope(root, null, rows, home).tree.size).toBe(0)
  })

  it('planFreePort refuses foreign, outside, emulator and session holders; never a partial stop', () => {
    const scope = paneScope(root, 10, rows, home)
    expect(planFreePort(null, scope, 3000)).toEqual({ ok: false, error: 'no-report' })
    expect(planFreePort(report([]), scope, 3000)).toEqual({ ok: false, error: 'not-found' })
    expect(planFreePort(report([], { outside: [{ pid: 7, name: 'java', ports: [{ port: 3000, address: '', established: 0 }] }] }), scope, 3000)).toEqual({ ok: false, error: 'outside', detail: 'java' })
    expect(planFreePort(report([server({ pid: 30, kind: 'emulator' })]), scope, 3000)).toMatchObject({ error: 'emulator' })
    expect(planFreePort(report([server({ pid: 20 })]), scope, 3000)).toMatchObject({ error: 'self' })
    expect(planFreePort(report([server({ pid: 10 })]), scope, 3000)).toMatchObject({ error: 'self' })
    expect(planFreePort(report([server({ pid: 30 }), server({ pid: 60, name: 'other' })]), scope, 3000)).toEqual({ ok: false, error: 'not-mine', detail: 'other' })
    expect(planFreePort(report([server({ pid: 30, start: '' })]), scope, 3000)).toMatchObject({ error: 'gone' })
    expect(planFreePort(report([server({ pid: 30 }), server({ pid: 60, ports: [] })]), scope, 3000)).toEqual({ ok: true, targets: [{ pid: 30, start: '133', label: 'node :3000' }] })
  })

  it('serversFor keeps command lines of the pane only', () => {
    const scope = paneScope(root, 10, rows, home)
    const out = serversFor(report([server({ pid: 60, cmd: 'other --token x' }), server({ pid: 30, idleSinceMs: 1_000 })], { outside: [{ pid: 7, name: 'java', ports: [{ port: 8080, address: '', established: 0 }] }] }), scope, 61_000)
    expect(out.servers.map((s) => [s.pid, s.mine, s.cmd ?? null, s.idleSec])).toEqual([
      [30, true, 'npm run dev', 60],
      [60, false, null, 61],
    ])
    expect(out.outside).toEqual([{ port: 8080, name: 'java' }])
  })
})

const call = (over: Partial<McpDeskCall> & Pick<McpDeskCall, 'tool'>): McpDeskCall => ({ id: 'i', from: 'pane1', cwd: root, pid: 10, name: 'app', ...over }) as McpDeskCall

describe('createDesk (main side)', () => {
  const base = (over: Partial<DeskDeps> = {}): DeskDeps => ({
    render: null,
    writeShot: async () => null,
    fallbackDir: path.join(dir, 'fallback'),
    report: () => report([server({ pid: 30 })]),
    procRows: async () => rows,
    home: path.join(dir, 'home'),
    locale: () => 'vi',
    kill: async () => ({ ok: true, killed: 1 }),
    ...over,
  })

  it('free_port: one confirm at a time, agent wording, refusal passed back', async () => {
    let release: (v: { ok: true; killed: number }) => void = () => undefined
    const kill = vi.fn(() => new Promise<{ ok: true; killed: number }>((r) => (release = r)))
    const desk = createDesk(base({ kill }))
    const first = desk(call({ tool: 'free_port', port: 3000 }))
    await vi.waitFor(() => expect(kill).toHaveBeenCalled())
    expect(await desk(call({ tool: 'free_port', port: 3000 }))).toEqual({ ok: false, error: 'confirm-open' })
    release({ ok: true, killed: 1 })
    expect(await first).toEqual({ ok: true, tool: 'free_port', port: 3000, stopped: [{ pid: 30, name: 'node' }] })
    const [targets, ask] = kill.mock.calls[0] as unknown as [unknown, { message: string; detail: (l: string[]) => string; confirm: string }]
    expect(targets).toEqual([{ pid: 30, start: '133', label: 'node :3000' }])
    expect(ask.message).toBe('Agent ở “app” muốn giải phóng cổng 3000')
    expect(ask.detail(['• node'])).toContain('free_port')
    expect(ask.confirm).toBe('Dừng')
    const no = createDesk(base({ kill: async () => ({ ok: false, error: 'cancelled' }) }))
    expect(await no(call({ tool: 'free_port', port: 3000 }))).toEqual({ ok: false, error: 'cancelled' })
    const other = createDesk(base({ kill }))
    kill.mockClear()
    expect(await other(call({ tool: 'free_port', port: 3000, pid: 50, cwd: path.join(dir, 'other') }))).toMatchObject({ ok: false, error: 'not-mine' })
    expect(kill).not.toHaveBeenCalled()
  })

  it('preview_layout: refuses paths outside the pane, saves to the capture folder or the fallback', async () => {
    const png = path.join(dir, 'render.png')
    writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const render = vi.fn(async () => ({ ok: true as const, png, width: 1080, height: 2340, renderMs: 9, frameworkOnly: true, diagnostics: [] }))
    const outside = createDesk(base({ render }))
    expect(await outside(call({ tool: 'preview_layout', path: path.join(dir, 'other', 'x.xml'), device: 'phone', night: false }))).toEqual({ ok: false, error: 'outside' })
    expect(render).not.toHaveBeenCalled()
    const shots = vi.fn(async (_b: Buffer, name: string) => path.join(dir, `${name}.png`))
    const viaCapture = await createDesk(base({ render, writeShot: shots }))(call({ tool: 'preview_layout', path: layout, device: 'tablet', night: true }))
    expect(render).toHaveBeenCalledWith(layout, { device: { width: 1600, height: 2560, density: 320 }, night: true, slot: 'pane1' })
    expect(viaCapture).toMatchObject({ ok: true, png: path.join(dir, 'layout-main-dark.png') })
    const viaTemp = await createDesk(base({ render }))(call({ tool: 'preview_layout', path: layout, device: 'phone', night: false }))
    expect(viaTemp).toMatchObject({ ok: true })
    expect(readdirSync(path.join(dir, 'fallback')).some((n) => n.startsWith('layout-main-'))).toBe(true)
    const starting = createDesk(base({ render: async () => ({ ok: false, code: 'starting', retryInSec: 8 }) }))
    expect(await starting(call({ tool: 'preview_layout', path: layout, device: 'phone', night: false }))).toEqual({ ok: false, error: 'starting', retryInSec: 8 })
  })
})

describe('layout agentRender (warm-up on the call only)', () => {
  const setup = (daemon: Record<string, unknown>, ready = true) => {
    const ipcMain = { handle: () => undefined, removeHandler: () => undefined }
    return registerLayoutIpc({
      ipcMain: ipcMain as never,
      isAppFrame: () => true,
      resolveDir: async () => null,
      dataDir: path.join(dir, 'data'),
      getJdk: () => null,
      confirm: async () => false,
      server: { urlFor: async () => null },
      daemonJar: __filename,
      spawn: () => {
        throw new Error('no spawn')
      },
      kill: () => undefined,
      bundle: { isReady: () => ready, status: () => ({ state: 'ready', dir: '/x' }), dir: '/x', downloadBytes: 1, download: async () => ({ state: 'ready', dir: '/x' }) } as never,
      daemon: { stop: async () => undefined, killNow: () => undefined, stage: null, ...daemon } as never,
    })
  }
  const device = { width: 1080, height: 2340, density: 440 }

  it('answers starting while the JVM boots, then renders', async () => {
    const ensure = vi.fn(() => new Promise<void>(() => undefined))
    const d = { state: 'stopped', stage: 'setup', ensure, render: vi.fn() }
    const ipc = setup(d)
    expect(await ipc.agentRender(layout, { device, night: false, slot: 'p' })).toEqual({ ok: false, code: 'starting', retryInSec: 6 })
    expect(ensure).toHaveBeenCalledTimes(1)
    expect(d.render).not.toHaveBeenCalled()
    const renderDir = path.join(dir, 'data', 'layoutlib', 'cache', 'render')
    mkdirSync(renderDir, { recursive: true })
    const out = path.join(renderDir, 'r1.png')
    writeFileSync(out, 'png')
    const render = vi.fn(async () => ({ requestId: 'r1', png: out, width: 1080, height: 2340, viewTree: null, diagnostics: [{ severity: 'error', message: 'bad' }], renderMs: 7 }))
    const ready = setup({ state: 'ready', ensure: vi.fn(), render })
    expect(await ready.agentRender(layout, { device, night: true, slot: 'p' })).toEqual({ ok: true, png: realpathSync(out), width: 1080, height: 2340, renderMs: 7, frameworkOnly: true, diagnostics: [{ severity: 'error', message: 'bad' }] })
    expect(render).toHaveBeenCalledWith(expect.objectContaining({ layoutPath: layout, night: true, theme: null }), 'agent:p')
  })

  it('never starts the JVM for a non-layout or without the kit', async () => {
    const ensure = vi.fn(async () => undefined)
    expect(await setup({ state: 'stopped', ensure }).agentRender(path.join(root, 'notes.txt'), { device, night: false, slot: 'p' })).toEqual({ ok: false, code: 'not-layout' })
    expect(await setup({ state: 'stopped', ensure }, false).agentRender(layout, { device, night: false, slot: 'p' })).toEqual({ ok: false, code: 'bundle-missing' })
    expect(ensure).not.toHaveBeenCalled()
    const crash = setup({ state: 'failed', ensure: () => Promise.reject(new LayoutError('crash-loop')) })
    expect(await crash.agentRender(layout, { device, night: false, slot: 'p' })).toEqual({ ok: false, code: 'crash-loop' })
  })
})
