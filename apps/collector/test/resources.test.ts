import { describe, expect, it } from 'vitest'
import { parseDeviceUsed, sanitizeIdle, type Agent, type BackgroundJob, type ResourceReport, type TerminalSession } from '@ccm/shared'
import { emulatorIdleSince, idleSinceOf, isForgotten, serverBusy, sessionIdleSince, trackBusy } from '../src/resources/idle'
import { nativeReader, parseCimTable, parseCpuTime, parsePsTable, type ProcReader, type ProcRow } from '../src/resources/procs'
import { ResourceSampler } from '../src/resources/sampler'
import { buildTree, cpuPercent, daemonOf, sumOf } from '../src/resources/tree'
import { mentionsDevice } from '../src/transcript'
import { Toaster, formatBytes, type ToastContent } from '../src/toast'
import { defaultKoffiLoader, setKoffiLoader, winProcs, type WinProc, type WinProcApi } from '../src/win-procs'

const MB = 1024 ** 2
const row = (pid: number, ppid: number, name: string, extra: Partial<ProcRow> = {}): ProcRow => ({
  pid,
  ppid,
  name,
  start: `s${pid}`,
  startMs: pid,
  ramBytes: 10 * MB,
  cpuMs: 0,
  cmd: name,
  ...extra,
})

describe('ps / CIM parsers', () => {
  it('reads Linux and macOS cputime', () => {
    expect(parseCpuTime('00:01:02')).toBe(62_000)
    expect(parseCpuTime('1-02:00:00')).toBe(26 * 3_600_000)
    expect(parseCpuTime('1:02.33')).toBe(62_330)
    expect(parseCpuTime('bad')).toBeNull()
  })

  it('parses ps rows with lstart and full command', () => {
    const out = [
      '  101     1  20480 00:00:03 Sun Nov  1 10:00:00 2026 /bin/zsh -l',
      '  202   101   1024     0:01.50 Sun Nov  1 10:00:05 2026 /Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/java -cp x org.gradle.launcher.daemon.bootstrap.GradleDaemon 8.14',
      'garbage',
    ].join('\n')
    const rows = parsePsTable(out)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ pid: 101, ppid: 1, name: 'zsh', ramBytes: 20 * MB, cpuMs: 3000, start: 'Sun Nov 1 10:00:00 2026' })
    expect(rows[0]!.startMs).toBe(Date.parse('2026-11-01T10:00:00Z'))
    expect(daemonOf('java', rows[1]!.cmd)).toEqual({ type: 'gradle', version: '8.14', jdk: 'jbr' })
  })

  it('parses the CIM JSON, single object and nulls included', () => {
    const rows = parseCimTable(JSON.stringify([{ pid: 5, ppid: 1, name: 'node.exe', ft: '133000000000000000', ws: 1024, cpu: 12.5, cmd: 'node x' }, { pid: 6, ppid: 5, name: 'x', ft: null, ws: null, cpu: null, cmd: null }]))
    expect(rows[0]).toMatchObject({ pid: 5, start: '133000000000000000', ramBytes: 1024, cpuMs: 12.5, cmd: 'node x' })
    expect(rows[1]).toMatchObject({ start: null, ramBytes: null, cpuMs: null, cmd: null })
    expect(parseCimTable(JSON.stringify({ pid: 1, ppid: 0, name: 'a' }))).toHaveLength(1)
  })
})

describe('daemon classification', () => {
  it('names Gradle, Kotlin, Dart, flutter and the emulator from the command line only', () => {
    const gradle = '"C:\\Program Files\\Java\\jdk-17.0.12\\bin\\java.exe" -cp C:\\Users\\me\\.gradle\\wrapper\\dists\\gradle-8.9-bin\\x\\gradle-8.9\\lib\\gradle-daemon-main-8.9.jar org.gradle.launcher.daemon.bootstrap.GradleDaemon 8.9'
    expect(daemonOf('java.exe', gradle)).toEqual({ type: 'gradle', version: '8.9', jdk: 'jdk-17.0.12' })
    expect(daemonOf('java.exe', 'java -cp kotlin-compiler-embeddable-2.0.21.jar org.jetbrains.kotlin.daemon.KotlinCompileDaemon')).toEqual({ type: 'kotlin', version: '2.0.21' })
    expect(daemonOf('dart.exe', 'dart.exe language-server --protocol=lsp')).toEqual({ type: 'dart' })
    expect(daemonOf('dart.exe', 'dart flutter_tools.snapshot daemon')).toEqual({ type: 'flutter' })
    expect(daemonOf('dart.exe', 'dart flutter_tools.snapshot run')).toBeNull()
    expect(daemonOf('qemu-system-x86_64.exe', 'qemu-system-x86_64.exe -avd Pixel_7_API_34 -port 5556')).toEqual({ type: 'emulator', avd: 'Pixel_7_API_34', serial: 'emulator-5556' })
    expect(daemonOf('java.exe', 'java -jar app.jar')).toBeNull()
    expect(daemonOf('node.exe', 'node GradleDaemon')).toBeNull()
    expect(daemonOf('java.exe', undefined)).toBeNull()
  })
})

describe('buildTree', () => {
  const rows = [
    row(10, 1, 'claude.exe'),
    row(11, 10, 'bash.exe'),
    row(12, 11, 'node.exe', { cmd: 'node vite' }),
    row(13, 10, 'node.exe', { cmd: 'node mcp-server' }),
    row(14, 11, 'java.exe', { cmd: 'java org.gradle.launcher.daemon.bootstrap.GradleDaemon 8.14' }),
    row(20, 1, 'emulator.exe', { cmd: 'emulator -avd Pixel' }),
    row(21, 20, 'qemu-system-x86_64.exe', { cmd: 'qemu -avd Pixel' }),
    // ppid 10 reused: created before "parent" 10, so not its child.
    row(5, 10, 'explorer.exe', { startMs: 5 }),
  ]

  it('splits the session tree, the shell under it, daemons and emulators', () => {
    const t = buildTree({ rows, sessions: [{ sessionId: 'a', pid: 10 }], lineage: new Map() })
    expect(t.sessions[0]!.members.map((m) => m.pid)).toEqual([10, 11, 13, 12])
    const shell = t.servers.find((s) => s.root.pid === 11)!
    expect(shell).toMatchObject({ kind: 'shell', sessionId: 'a', orphan: false })
    expect(shell.main.pid).toBe(12)
    expect(shell.members.map((m) => m.pid)).toEqual([11, 12])
    expect(t.servers.find((s) => s.root.pid === 13)).toBeUndefined()
    expect(t.servers.find((s) => s.root.pid === 14)).toMatchObject({ kind: 'daemon', sessionId: 'a', daemon: { type: 'gradle', version: '8.14' } })
    const emu = t.servers.filter((s) => s.kind === 'emulator')
    expect(emu.map((s) => [s.root.pid, s.members.length])).toEqual([[20, 2]])
    expect([...t.seen.keys()].sort()).toEqual(['s11', 's12', 's13', 's14'].map((k) => `${k.slice(1)}:${k}`).sort())
    expect(t.servers.some((s) => s.root.pid === 5)).toBe(false)
  })

  it('marks a dev server once it listens, and leftovers as orphans once the session is gone', () => {
    const first = buildTree({ rows, sessions: [{ sessionId: 'a', pid: 10 }], lineage: new Map(), ports: new Map([[12, [{ port: 5173, address: '127.0.0.1', established: 0 }]]]) })
    expect(first.servers.find((s) => s.root.pid === 11)).toMatchObject({ kind: 'dev-server', ports: [{ port: 5173 }] })
    const after = rows.filter((r) => r.pid !== 10)
    const t = buildTree({ rows: after, sessions: [], lineage: first.seen })
    const orphan = t.servers.find((s) => s.root.pid === 11)!
    expect(orphan).toMatchObject({ orphan: true, sessionId: 'a', kind: 'shell' })
    expect(orphan.members.map((m) => m.pid)).toEqual([11, 12])
    expect(t.servers.find((s) => s.root.pid === 13)).toMatchObject({ orphan: true, kind: 'other' })
    expect(t.servers.find((s) => s.root.pid === 14)).toMatchObject({ kind: 'daemon', orphan: false, sessionId: 'a' })
    // Never seen under a session: not an orphan, whatever its name.
    expect(buildTree({ rows: after, sessions: [], lineage: new Map() }).servers.every((s) => !s.orphan)).toBe(true)
  })

  it('treats cmd.exe as a tool shell only when it hosts one (MCP wrappers are not servers)', () => {
    const t = buildTree({
      rows: [
        row(10, 1, 'claude.exe'),
        row(30, 10, 'cmd.exe', { cmd: 'cmd.exe /d /s /c "npx figma-ui-mcp"' }),
        row(31, 30, 'node.exe'),
        row(40, 10, 'cmd.exe', { cmd: 'cmd.exe /d /s /c ""chcp.com" 65001 >nul & powershell.exe -Command x"' }),
        row(41, 40, 'conhost.exe'),
        row(42, 40, 'powershell.exe'),
        row(43, 42, 'node.exe', { cmd: 'node server.js' }),
        row(50, 10, 'uvx.exe'),
      ],
      sessions: [{ sessionId: 'a', pid: 10 }],
      lineage: new Map(),
    })
    expect(t.servers.map((s) => [s.root.pid, s.main.pid])).toEqual([[40, 43]])
    expect(t.sessions[0]!.members).toHaveLength(8)
  })

  it('computes CPU share and sums', () => {
    expect(cpuPercent(undefined, 100, 1000, 4)).toBeNull()
    expect(cpuPercent({ cpuMs: 0, at: 0 }, 30_000, 30_000, 4)).toBe(25)
    expect(cpuPercent({ cpuMs: 50, at: 0 }, 10, 1000, 2)).toBe(0)
    expect(sumOf([row(1, 0, 'a'), row(2, 1, 'b', { ramBytes: null })], (r) => r.ramBytes)).toBe(10 * MB)
    expect(sumOf([row(1, 0, 'a', { ramBytes: null })], (r) => r.ramBytes)).toBeNull()
  })
})

const T0 = Date.parse('2026-11-01T10:00:00Z')
const term = (extra: Partial<TerminalSession> = {}): TerminalSession => ({ id: 'a', title: 'proj', status: 'idle', processId: 10, lastActivityAt: new Date(T0).toISOString(), ...extra })

describe('idle rules', () => {
  it('session idle only when idle / waiting with nothing running', () => {
    expect(sessionIdleSince(term(), [], [])).toBe(T0)
    expect(sessionIdleSince(term({ status: 'working' }), [], [])).toBeNull()
    expect(sessionIdleSince(term({ endedAt: 'x' }), [], [])).toBeNull()
    const sub = { id: 's', terminalId: 'a', role: 'subagent', status: 'working' } as Agent
    expect(sessionIdleSince(term(), [sub], [])).toBeNull()
    const job = { id: 'j', state: 'working', sessionId: 'c1' } as BackgroundJob
    expect(sessionIdleSince(term({ claudeSessionId: 'c1' }), [], [job])).toBeNull()
    expect(isForgotten(T0, T0 + 60 * 60_000, 60)).toBe(true)
    expect(isForgotten(T0, T0 + 59 * 60_000, 60)).toBe(false)
    expect(isForgotten(T0, T0 + 999 * 60_000, 0)).toBe(false)
  })

  it('server quiet streak needs CPU < 1 % and no connection, unknown CPU is busy', () => {
    expect(serverBusy(0.5, [])).toBe(false)
    expect(serverBusy(1, [])).toBe(true)
    expect(serverBusy(null, [])).toBe(true)
    expect(serverBusy(0, [{ port: 1, address: '::', established: 1 }])).toBe(true)
    let s = trackBusy(undefined, false, T0)
    expect(idleSinceOf(s, T0)).toBe(T0)
    s = trackBusy(s, true, T0 + 1000)
    expect(idleSinceOf(s, T0 + 1000)).toBeNull()
    s = trackBusy(s, false, T0 + 2000)
    expect(idleSinceOf(s, T0 + 2000)).toBe(T0 + 1000)
    expect(emulatorIdleSince(T0, T0 + 5, null)).toBe(T0 + 5)
    expect(emulatorIdleSince(T0, null, T0 + 9)).toBe(T0 + 9)
  })

  it('flags device shell calls without keeping the command', () => {
    expect(mentionsDevice('Bash', { command: 'adb -s emulator-5554 install x.apk' })).toBe(true)
    expect(mentionsDevice('Bash', { command: './gradlew :app:installDebug' })).toBe(true)
    expect(mentionsDevice('PowerShell', { command: 'flutter run -d emulator-5554' })).toBe(true)
    expect(mentionsDevice('Bash', { command: 'flutter test' })).toBe(false)
    expect(mentionsDevice('Read', { command: 'adb' })).toBe(false)
  })

  it('validates settings and the desktop device message', () => {
    expect(sanitizeIdle(60)).toBe(60)
    expect(sanitizeIdle(0)).toBe(0)
    expect(sanitizeIdle(45)).toBeNull()
    expect(parseDeviceUsed({ type: 'device.used', serial: 'emulator-5554', avd: 'Pixel_7', at: 5 })).toEqual({ type: 'device.used', serial: 'emulator-5554', avd: 'Pixel_7', at: 5 })
    expect(parseDeviceUsed({ type: 'device.used', serial: 'a b', at: 5 })).toBeNull()
    expect(parseDeviceUsed({ type: 'device.used', serial: 'x', avd: '../x', at: 5 })).toBeNull()
    expect(parseDeviceUsed('shutdown')).toBeNull()
  })
})

function fakeReader(passes: ProcRow[][]): ProcReader {
  let i = 0
  return { read: async () => passes[Math.min(i++, passes.length - 1)]!.map((r) => ({ ...r })), enrich: () => undefined }
}

describe('ResourceSampler', () => {
  it('reports RAM, CPU %, forgotten servers, orphans and emulator idleness', async () => {
    const min = 60_000
    let now = T0
    let terminals = [term({ lastActivityAt: new Date(T0 - 61 * min).toISOString() })]
    let lastCall: number | null = null
    const base = [
      row(10, 1, 'claude.exe', { cpuMs: 0 }),
      row(11, 10, 'bash.exe', { cpuMs: 0, ramBytes: 1 * MB }),
      row(12, 11, 'node.exe', { cpuMs: 0, ramBytes: 100 * MB, cmd: 'node vite --token=abcd1234secret' }),
      row(20, 1, 'emulator.exe', { cpuMs: 0, ramBytes: 2048 * MB, cmd: 'emulator -avd Pixel' }),
    ]
    const at = (cpu: Record<number, number>, drop: number[] = []) => base.filter((r) => !drop.includes(r.pid)).map((r) => ({ ...r, cpuMs: cpu[r.pid] ?? 0 }))
    const passes = [at({}), at({ 12: 600, 20: 30_000 }), at({ 12: 600, 20: 60_000 }), at({ 12: 600, 20: 90_000 }, [10])]
    const sampler = new ResourceSampler({
      reader: fakeReader(passes),
      terminals: () => terminals,
      agents: () => [],
      jobs: () => [],
      idleMinutes: () => 60,
      lastDeviceCallAt: () => lastCall,
      onReport: () => undefined,
      now: () => now,
      cores: 2,
      mask: (cmd) => cmd.replace(/token=\S+/, 'token=[masked]'),
    })
    const r1 = (await sampler.sample())!
    expect(r1.sessions[0]).toMatchObject({ sessionId: 'a', pid: 10, ramBytes: 111 * MB, cpuPct: null, forgotten: true })
    const shell = r1.servers.find((s) => s.pid === 11)!
    expect(shell).toMatchObject({ kind: 'shell', name: 'node.exe', cmd: 'node vite --token=[masked]', start: 's11', forgotten: false, orphan: false })

    now += 30_000
    const r2 = (await sampler.sample())!
    expect(r2.servers.find((s) => s.pid === 11)!.cpuPct).toBeCloseTo(1)
    expect(r2.servers.find((s) => s.pid === 20)).toMatchObject({ kind: 'emulator', daemon: { avd: 'Pixel' }, cpuPct: 50 })

    now += 61 * min
    sampler.deviceUsed({ type: 'device.used', serial: 'emulator-5554', avd: 'Pixel', at: now - min })
    const r3 = (await sampler.sample())!
    expect(r3.servers.find((s) => s.pid === 11)).toMatchObject({ forgotten: true, idleSinceMs: T0 + 30_000 })
    // High CPU never keeps an emulator busy; the adb use a minute ago does.
    expect(r3.servers.find((s) => s.pid === 20)).toMatchObject({ forgotten: false, idleSinceMs: now - min })

    terminals = []
    lastCall = now
    now += 30_000
    const r4 = (await sampler.sample())!
    expect(r4.sessions).toEqual([])
    expect(r4.servers.find((s) => s.pid === 11)).toMatchObject({ orphan: true, forgotten: true, sessionId: 'a' })
    expect(r4.totals.forgotten).toBe(1)
    expect(r4.totals.forgottenRamBytes).toBe(101 * MB)
    expect(r4.totals.ramBytes).toBe(2149 * MB)
  })
})

describe('nativeReader (fake koffi API)', () => {
  it('reads usage and command lines only for wanted pids, nulls on failures, CIM when the table fails', async () => {
    const calls: string[] = []
    let fail = false
    const api: WinProcApi = {
      list: () => {
        if (fail) throw new Error('snapshot')
        return [{ pid: 7, ppid: 1, name: 'node.exe', start: 1000n }, { pid: 8, ppid: 7, name: 'x.exe', start: null }] as WinProc[]
      },
      commandLine: (pid) => {
        calls.push(`cmd:${pid}`)
        return 'node app'
      },
      usage: (pid) => {
        calls.push(`use:${pid}`)
        if (pid === 8) return null
        return { privateBytes: 5, workingSet: 9, cpuMs: 3 }
      },
    }
    const fallback = { read: async () => [row(99, 1, 'cim')], enrich: () => undefined }
    const reader = nativeReader(api, fallback)
    const rows = (await reader.read())!
    expect(rows[0]).toMatchObject({ pid: 7, start: '1000', ramBytes: null, cpuMs: null })
    reader.enrich(rows, new Set([7, 8]), new Set([7]))
    expect(rows[0]).toMatchObject({ ramBytes: 9, cpuMs: 3, cmd: 'node app' })
    expect(rows[1]).toMatchObject({ ramBytes: null, cpuMs: null })
    const again = (await reader.read())!
    expect(again[0]!.cmd).toBe('node app')
    reader.enrich(again, new Set(), new Set([7]))
    expect(calls.filter((c) => c === 'cmd:7')).toHaveLength(1)
    fail = true
    expect((await reader.read())![0]!.pid).toBe(99)
  })
})

describe.runIf(process.platform === 'win32')('koffi usage (this machine)', () => {
  it('reads working set and CPU time of this process', () => {
    setKoffiLoader(defaultKoffiLoader)
    const u = winProcs()?.usage(process.pid)
    expect(u?.workingSet).toBeGreaterThan(1024 * 1024)
    expect(u?.privateBytes).toBeGreaterThan(0)
    expect(u?.cpuMs).toBeGreaterThan(0)
    expect(winProcs()?.usage(0)).toBeNull()
  })
})

describe('idle toast', () => {
  const report = (forgotten: boolean, idleSince = T0): ResourceReport => ({
    at: '',
    idleMinutes: 60,
    cores: 4,
    sessions: [],
    servers: [
      { pid: 5, start: '1', kind: 'daemon', name: 'java.exe', cmd: '', ports: [], ramBytes: 2.5 * 1024 ** 3, cpuPct: 0, idleSinceMs: idleSince, lastBusyAt: null, forgotten, sessionId: null, orphan: false, daemon: { type: 'gradle', version: '8.14' } },
    ],
    totals: { ramBytes: 0, cpuPct: 0, forgotten: forgotten ? 1 : 0, forgottenRamBytes: forgotten ? 2.5 * 1024 ** 3 : 0 },
  })

  it('primes on the first report, toasts once per episode, hides when cleared', async () => {
    const shown: ToastContent[] = []
    const hidden: string[] = []
    const toaster = new Toaster({ supported: true, port: 4317 }, { show: async (c) => (shown.push(c), true), hide: async (t) => (hidden.push(t), true), now: () => T0 })
    toaster.observeIdle(report(false))
    toaster.observeIdle(report(true))
    toaster.observeIdle(report(true))
    await new Promise((r) => setTimeout(r, 0))
    expect(shown).toHaveLength(1)
    expect(shown[0]!.title).toBe('1 mục bỏ quên đang dùng 2,5 GB')
    expect(shown[0]!.body).toContain('Gradle daemon 8.14')
    toaster.observeIdle(report(false))
    await new Promise((r) => setTimeout(r, 0))
    expect(hidden).toHaveLength(1)
    toaster.update({ kinds: { idle: false } })
    toaster.observeIdle(report(true, T0 + 1))
    expect(shown).toHaveLength(1)
    expect(toaster.idleWatch).toBe(false)
    toaster.update({ kinds: { idle: true }, idleMinutes: 120 })
    expect(toaster.settings().idleMinutes).toBe(120)
    expect(toaster.idleWatch).toBe(true)
    expect(formatBytes(300 * MB, 'en')).toBe('300 MB')
  })
})

