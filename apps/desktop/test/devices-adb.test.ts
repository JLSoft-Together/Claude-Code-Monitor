import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createAdbCommands } from '../src/devices/adb'
import { killTree, type SpawnSpec, type Spawner } from '../src/run/proc'

vi.mock('../src/run/proc', async (orig) => {
  const mod = await orig<typeof import('../src/run/proc')>()
  return { ...mod, killTree: vi.fn() }
})

const ADB = '/sdk/platform-tools/adb'

function fake(out = '', code: number | null = 0, live = false): { spawn: Spawner; specs: SpawnSpec[] } {
  const specs: SpawnSpec[] = []
  const spawn: Spawner = (spec) => {
    specs.push(spec)
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), pid: undefined })
    if (!live) {
      process.nextTick(() => {
        child.stdout.emit('data', Buffer.from(out))
        child.emit('close', code)
      })
    }
    return child as unknown as ChildProcess
  }
  return { spawn, specs }
}

const make = (f: ReturnType<typeof fake>, adb: string | null = ADB, timing = {}) =>
  createAdbCommands({ spawn: f.spawn, cwd: '/home', adb: async () => adb, timing })

describe('adb commands', () => {
  it('passes argv without a shell', async () => {
    const f = fake('connected to 1.2.3.4:5555')
    const c = make(f)
    await c.connect('1.2.3.4:5555')
    await c.pair('1.2.3.4:37000', '123456')
    await c.disconnect('1.2.3.4:5555')
    await c.tcpip('abc', 5555)
    await c.wlanIp('abc')
    await c.mdnsCheck()
    await c.mdnsServices()
    await c.list()
    expect(f.specs.every((s) => s.file === ADB)).toBe(true)
    expect(f.specs.map((s) => s.args)).toEqual([
      ['connect', '1.2.3.4:5555'],
      ['pair', '1.2.3.4:37000', '123456'],
      ['disconnect', '1.2.3.4:5555'],
      ['-s', 'abc', 'tcpip', '5555'],
      ['-s', 'abc', 'shell', 'ip', '-f', 'inet', 'addr', 'show', 'wlan0'],
      ['mdns', 'check'],
      ['mdns', 'services'],
      ['devices', '-l'],
    ])
  })

  it('list parses devices and returns null on timeout, failure or missing adb', async () => {
    const rows = await make(fake('List of devices attached\nabc\tdevice model:Pixel_7\n')).list()
    expect(rows?.map((r) => [r.id, r.model])).toEqual([['abc', 'Pixel 7']])
    expect(await make(fake('', 0, true), ADB, { cmdMs: 50 }).list()).toBeNull()
    expect(await make(fake('', 1)).list()).toBeNull()
    expect(await make(fake(), null).list()).toBeNull()
  })

  it('connect times out and kills the child', async () => {
    const f = fake('', 0, true)
    const r = await make(f, ADB, { connectMs: 50 }).connect('1.2.3.4:5555')
    expect(r).toEqual({ ok: false, error: 'timeout' })
    expect(killTree).toHaveBeenCalled()
  })

  it('adb missing', async () => {
    const f = fake()
    const c = make(f, null)
    expect(await c.connect('a:1')).toEqual({ ok: false, error: 'adb-missing' })
    expect(await c.pair('a:1', '123456')).toEqual({ ok: false, error: 'adb-missing' })
    expect(await c.disconnect('a:1')).toEqual({ ok: false, error: 'adb-missing' })
    expect(await c.tcpip('a', 5555)).toEqual({ ok: false, error: 'adb-missing' })
    expect(await c.wlanIp('a')).toBeNull()
    expect(await c.mdnsCheck()).toBe(false)
    expect(await c.mdnsServices()).toEqual([])
    expect(f.specs).toHaveLength(0)
  })

  it('mdnsCheck false on unavailable', async () => {
    expect(await make(fake('ERROR: mdns daemon unavailable', 1)).mdnsCheck()).toBe(false)
    expect(await make(fake('ERROR: mdns daemon unavailable', 0)).mdnsCheck()).toBe(false)
    expect(await make(fake('mdns daemon version [Openscreen]', 0)).mdnsCheck()).toBe(true)
  })

  it('maps results', async () => {
    expect(await make(fake('connected to h:5555')).connect('h:5555')).toEqual({ ok: true })
    expect(await make(fake('', null)).connect('h')).toEqual({ ok: false, error: 'connect-failed' })
    expect(await make(fake('', null)).pair('h:1', '123456')).toEqual({ ok: false, error: 'pair-failed' })
    expect(await make(fake('', null)).disconnect('h')).toEqual({ ok: false, error: 'not-connected' })
    expect(await make(fake('restarting in TCP mode port: 5555')).tcpip('a', 5555)).toEqual({ ok: true })
    expect(await make(fake('error: closed')).tcpip('a', 5555)).toMatchObject({ ok: false, error: 'tcpip-failed' })
    expect(await make(fake('', null)).tcpip('a', 5555)).toEqual({ ok: false, error: 'tcpip-failed' })
    expect(await make(fake('    inet 192.168.1.9/24 brd')).wlanIp('a')).toBe('192.168.1.9')
    expect(await make(fake('', 1)).wlanIp('a')).toBeNull()
    expect(await make(fake('x _adb-tls-connect._tcp. 1.2.3.4:4000')).mdnsServices()).toHaveLength(1)
  })
})
