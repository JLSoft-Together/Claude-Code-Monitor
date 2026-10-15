import { execFile } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { windowsCodexProcesses } from '../src/codex/processes'
import { ancestorChain } from '../src/focus'
import { processInfoFromTable, queryProcessesWindows, type ProcessInfo } from '../src/process'
import { PsHost } from '../src/ps-host'
import { windowsPowerShell } from '../src/win-exe'
import { defaultKoffiLoader, nativeCommandLine, nativeProcessTable, setKoffiLoader, winProcs, type WinProc } from '../src/win-procs'

const FT = (ms: number): bigint => (BigInt(ms) + 11_644_473_600_000n) * 10_000n
const T0 = Date.parse('2026-10-15T10:00:00Z')
const row = (pid: number, ppid: number, name: string, ms: number | null): WinProc => ({ pid, ppid, name, start: ms === null ? null : FT(ms) })

afterEach(() => setKoffiLoader(defaultKoffiLoader))

describe('native process table', () => {
  it('falls back (null) when koffi fails to load', async () => {
    setKoffiLoader(() => {
      throw new Error('no koffi')
    })
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    expect(winProcs()).toBeNull()
    expect(nativeProcessTable()).toBeNull()
    expect(nativeCommandLine(process.pid)).toBeNull()
    const cim = vi.fn(async (pids: number[]) => new Map<number, ProcessInfo>(pids.map((pid) => [pid, { pid, start: { kind: 'filetime', value: 1n } }])))
    const out = await queryProcessesWindows([7], nativeProcessTable, cim)
    expect(cim).toHaveBeenCalledWith([7])
    expect(out?.get(7)?.start).toEqual({ kind: 'filetime', value: 1n })
  })

  it('maps the table to the CIM query shape, and asks CIM when a wanted start is unreadable', async () => {
    const table = [row(10, 5, 'claude.exe', T0), row(5, 1, 'pwsh.exe', T0 - 1000), row(20, 5, 'claude.exe', null)]
    expect(processInfoFromTable([10, 99], table)).toEqual(
      new Map([[10, { pid: 10, start: { kind: 'filetime', value: FT(T0) }, parentPid: 5, parentName: 'pwsh.exe' }]]),
    )
    expect(processInfoFromTable([10, 20], table)).toBeNull()
    const cim = vi.fn(async () => null)
    await queryProcessesWindows([10], () => table, cim)
    expect(cim).not.toHaveBeenCalled()
    await queryProcessesWindows([20], () => table, cim)
    expect(cim).toHaveBeenCalledOnce()
  })

  it('walks codex ancestry like the CIM script', () => {
    const table = [
      row(7, 1, 'explorer.exe', T0 - 9000),
      row(8, 7, 'WindowsTerminal.exe', T0 - 5000),
      row(9, 8, 'claude.exe', T0 - 2000),
      row(10, 9, 'codex.exe', T0),
      row(11, 10, 'codex.exe', T0 + 10),
      row(12, 20, 'codex.exe', T0 + 5),
      row(20, 30, 'timeout.exe', T0 + 1),
      row(30, 4, 'bash.exe', T0 + 2),
    ]
    const cmds: Record<number, string> = { 10: 'codex.exe exec -', 11: 'codex.exe sandbox', 12: 'codex.exe exec -' }
    const procs = windowsCodexProcesses(table, (pid) => cmds[pid] ?? null)!
    expect(procs.map((p) => p.pid)).toEqual([10, 12])
    expect(procs[0]).toMatchObject({ start: T0, mode: 'exec', ancestors: [9, 8, 7], orphan: false })
    // bash.exe (30) was created after timeout.exe (20): chain cut there, and timeout is a shell-ish runner.
    expect(procs[1]).toMatchObject({ ancestors: [20], orphan: true })
    expect(windowsCodexProcesses(table, () => null)).toBeNull()
    expect(windowsCodexProcesses([row(10, 9, 'codex.exe', null)], () => 'codex.exe')).toBeNull()
  })

  it('builds the focus chain up to a missing or younger parent', () => {
    const table = [row(9, 8, 'claude.exe', T0), row(8, 7, 'pwsh.exe', T0 - 10), row(7, 3, 'explorer.exe', T0 + 99)]
    expect(ancestorChain(9, table)).toEqual([9, 8])
    expect(ancestorChain(42, table)).toEqual([])
  })
})

const cimRows = (pids: number[]): Promise<Array<{ pid: number; ppid: number; name: string; ft: string }>> =>
  new Promise((resolve, reject) => {
    const script = `@(Get-CimInstance Win32_Process -Filter "${pids.map((p) => `ProcessId=${p}`).join(' OR ')}" | ForEach-Object { [pscustomobject]@{ pid = [int]$_.ProcessId; ppid = [int]$_.ParentProcessId; name = $_.Name; ft = $_.CreationDate.ToFileTimeUtc().ToString() } }) | ConvertTo-Json -Compress`
    execFile(windowsPowerShell(), ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 30_000 }, (err, stdout) => {
      if (err) return reject(err)
      const parsed: unknown = JSON.parse(stdout)
      resolve((Array.isArray(parsed) ? parsed : [parsed]) as Array<{ pid: number; ppid: number; name: string; ft: string }>)
    })
  })

describe.runIf(process.platform === 'win32')('koffi vs CIM parity (this machine)', () => {
  it('reports the same pid, ppid, name and creation time for the current process tree', async () => {
    const table = nativeProcessTable()
    expect(table).not.toBeNull()
    const byPid = new Map(table!.map((p) => [p.pid, p]))
    const chain: number[] = []
    for (let p = byPid.get(process.pid); p && chain.length < 6 && p.start !== null; p = byPid.get(p.ppid)) chain.push(p.pid)
    expect(chain[0]).toBe(process.pid)
    const cim = await cimRows(chain)
    expect(cim.length).toBe(chain.length)
    for (const c of cim) {
      const n = byPid.get(c.pid)!
      expect({ ppid: n.ppid, name: n.name }).toEqual({ ppid: c.ppid, name: c.name })
      // CIM's CreationDate keeps microseconds; FILETIME has 100 ns ticks.
      const diff = n.start! - BigInt(c.ft)
      expect(diff >= -10n && diff <= 10n).toBe(true)
    }
    expect(nativeCommandLine(process.pid)).toContain('node')
  }, 40_000)
})

class FakeChild extends EventEmitter {
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  lines: Array<Record<string, unknown>> = []
  killed = false
  constructor(answer: (req: Record<string, unknown>, child: FakeChild) => void) {
    super()
    this.stdin.on('data', (chunk: Buffer) => {
      for (const line of String(chunk).split('\n').filter(Boolean)) {
        const req = JSON.parse(Buffer.from(line, 'base64').toString('utf8')) as Record<string, unknown>
        this.lines.push(req)
        answer(req, this)
      }
    })
  }
  kill(): boolean {
    this.killed = true
    this.emit('exit', null)
    return true
  }
}

describe('PsHost', () => {
  it('answers by id, keeps one host across requests and passes text as data', async () => {
    const children: FakeChild[] = []
    const host = new PsHost({
      script: 'x',
      spawner: () => {
        const c = new FakeChild((req, child) => child.stdout.write(`${String(req.id)}\t${String(req.mode)}-${String(req.title ?? '')}\r\n`))
        children.push(c)
        return c as unknown as ChildProcessWithoutNullStreams
      },
    })
    const [a, b] = await Promise.all([host.run({ mode: 'show', title: "Xin chào ' $(x)" }), host.run({ mode: 'hide' })])
    expect(a).toBe("show-Xin chào ' $(x)")
    expect(b).toBe('hide-')
    expect(children).toHaveLength(1)
    host.stop()
  })

  it('fails pending requests when the host dies and respawns on the next one', async () => {
    let n = 0
    const host = new PsHost({
      script: 'x',
      spawner: () => {
        n++
        const first = n === 1
        return new FakeChild((req, child) => {
          if (first) child.emit('exit', 1)
          else child.stdout.write(`${String(req.id)}\tok\n`)
        }) as unknown as ChildProcessWithoutNullStreams
      },
    })
    expect(await host.run({ mode: 'health' })).toBeNull()
    expect(await host.run({ mode: 'health' })).toBe('ok')
    expect(host.spawns).toBe(2)
    host.stop()
  })

  it('kills a hung host after the timeout', async () => {
    let child: FakeChild | null = null
    const host = new PsHost({
      script: 'x',
      timeoutMs: 20,
      spawner: () => (child = new FakeChild(() => undefined)) as unknown as ChildProcessWithoutNullStreams,
    })
    expect(await host.run({ mode: 'show' })).toBeNull()
    expect(child!.killed).toBe(true)
  })
})
