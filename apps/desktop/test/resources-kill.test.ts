import { describe, expect, it } from 'vitest'
import type { DeviceUsedMessage, ResourceReport, ServerRes } from '@ccm/shared'
import { createAdbCommands } from '../src/devices/adb'
import { DeviceUseReporter } from '../src/resources/deviceUse'
import { confirmLines, planKill } from '../src/resources/kill'

const NOW = 1_800_000_000_000
const server = (over: Partial<ServerRes>): ServerRes => ({
  pid: 500,
  start: '1335',
  kind: 'dev-server',
  name: 'node.exe',
  cmd: 'node vite',
  ports: [],
  ramBytes: 200 * 1024 ** 2,
  cpuPct: 0,
  idleSinceMs: NOW - 3_600_000,
  lastBusyAt: null,
  forgotten: true,
  sessionId: null,
  orphan: true,
  ...over,
})

const report: ResourceReport = {
  at: new Date(NOW).toISOString(),
  idleMinutes: 60,
  cores: 8,
  sessions: [{ sessionId: 's1', pid: 100, start: '900', name: 'claude.exe', ramBytes: 400 * 1024 ** 2, cpuPct: 0, idleSinceMs: NOW - 4e6, forgotten: true }],
  servers: [
    server({}),
    server({ pid: 600, start: '777', kind: 'daemon', name: 'java.exe', lastBusyAt: NOW - 30_000 }),
    server({ pid: 700, start: '888', kind: 'daemon', name: 'java.exe', lastBusyAt: NOW - 600_000 }),
    server({ pid: 800, start: '999', kind: 'emulator', name: 'qemu-system-x86_64.exe', daemon: { type: 'emulator', avd: 'Pixel_8' } }),
  ],
  totals: { ramBytes: 0, cpuPct: 0, forgotten: 4, forgottenRamBytes: 0 },
  outside: [{ pid: 42, name: 'postgres.exe', ports: [{ port: 5432, address: '0.0.0.0', established: 0 }] }],
}

describe('planKill', () => {
  it('needs a report and the exact pid + creation time from it', () => {
    expect(planKill(null, [{ pid: 500, start: '1335' }], NOW)).toEqual({ ok: false, error: 'unavailable' })
    expect(planKill(report, [{ pid: 500, start: '1336' }], NOW)).toEqual({ ok: false, error: 'gone' })
    expect(planKill(report, [{ pid: 42, start: '1' }], NOW)).toEqual({ ok: false, error: 'gone' })
  })

  it('refuses a daemon busy in the last 2 minutes, takes an idle one', () => {
    expect(planKill(report, [{ pid: 600, start: '777' }], NOW)).toEqual({ ok: false, error: 'busy' })
    expect(planKill(report, [{ pid: 700, start: '888' }], NOW)).toMatchObject({ ok: true, items: [{ pid: 700 }] })
  })

  it('plans sessions, servers and emulators (AVD for adb emu kill), labels win', () => {
    const plan = planKill(report, [{ pid: 100, start: '900', label: 'my-app' }, { pid: 500, start: '1335' }, { pid: 800, start: '999' }], NOW)
    expect(plan).toMatchObject({
      ok: true,
      items: [
        { pid: 100, name: 'my-app', session: true },
        { pid: 500, name: 'node.exe', session: false, cmd: 'node vite' },
        { pid: 800, avd: 'Pixel_8' },
      ],
    })
    if (!plan.ok) throw new Error('plan')
    const lines = confirmLines(plan.items, 'agent session')
    expect(lines[0]).toBe('• my-app (agent session) — 400 MB, pid 100')
    expect(lines[1]).toContain('\n   node vite')
  })
})

describe('adb commands report device use', () => {
  it('names the serial of every -s command, not of connect / list', async () => {
    const used: string[] = []
    const cmds = createAdbCommands({ spawn: () => { throw new Error('no spawn') }, cwd: '.', adb: async () => null, onUse: (s) => used.push(s) })
    await cmds.shell('emulator-5554', ['getprop'])
    await cmds.spawnShell('RFX', ['ls'])
    await cmds.list()
    await cmds.connect('10.0.0.2:5555')
    expect(used).toEqual(['emulator-5554', 'RFX'])
  })
})

describe('DeviceUseReporter', () => {
  it('throttles per serial and adds the AVD of emulators', async () => {
    const sent: DeviceUsedMessage[] = []
    let now = NOW
    let asked = 0
    const r = new DeviceUseReporter(
      (m) => sent.push(m),
      async () => {
        asked++
        return 'Pixel_8'
      },
      () => now,
    )
    r.used('RFCTB05YJWJ')
    r.used('RFCTB05YJWJ')
    r.used('emulator-5554')
    r.used('bad serial;')
    await Promise.resolve()
    await Promise.resolve()
    now += 20_000
    r.used('emulator-5554')
    await Promise.resolve()
    await Promise.resolve()
    expect(sent).toEqual([
      { type: 'device.used', serial: 'RFCTB05YJWJ', at: NOW },
      { type: 'device.used', serial: 'emulator-5554', at: NOW, avd: 'Pixel_8' },
      { type: 'device.used', serial: 'emulator-5554', at: NOW + 20_000, avd: 'Pixel_8' },
    ])
    expect(asked).toBe(1)
  })
})
