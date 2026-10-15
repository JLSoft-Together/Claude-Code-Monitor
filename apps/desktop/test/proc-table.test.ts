import { describe, expect, it, vi } from 'vitest'
import type { WinProc } from '../../collector/src/win-procs'
import { readPidTable } from '../src/pty/owners'
import { nativeProcRows, treePids } from '../src/run/proc'

const row = (pid: number, ppid: number, name = 'x.exe'): WinProc => ({ pid, ppid, name, start: 1n })

describe('native process table in the desktop', () => {
  it('owners read the native table on win32 and fall back when it is unavailable', async () => {
    const table = await readPidTable('win32', process.env, () => [row(10, 1), row(20, 10)])
    expect(table).toEqual(new Map([[10, 1], [20, 10]]))
    const native = vi.fn(() => [row(1, 0)])
    await readPidTable('darwin', process.env, native).catch(() => null)
    expect(native).not.toHaveBeenCalled()
  })

  it('reads command lines only for the subtree and keeps the Gradle daemon alive', () => {
    const cmds: Record<number, string> = {
      100: 'cmd.exe /d /s /c "gradlew.bat assembleDebug"',
      101: 'java.exe org.gradle.wrapper.GradleWrapperMain assembleDebug',
      102: 'java.exe -Xmx2g org.gradle.launcher.daemon.bootstrap.GradleDaemon 8.7',
      103: 'java.exe org.jetbrains.kotlin.daemon.KotlinCompileDaemon',
      104: 'conhost.exe',
    }
    const commandLine = vi.fn((pid: number) => cmds[pid] ?? null)
    const table = [row(100, 1), row(101, 100), row(102, 101), row(103, 102), row(104, 101), row(200, 1)]
    const rows = nativeProcRows(100, table, commandLine)!
    expect(commandLine).not.toHaveBeenCalledWith(200)
    expect([...treePids(100, rows, (cmd) => /GradleDaemon/.test(cmd))].sort()).toEqual([100, 101, 104])
    expect(nativeProcRows(100, null, commandLine)).toBeNull()
    expect(nativeProcRows(100, table, (pid) => (pid === 103 ? null : (cmds[pid] ?? '')))).toBeNull()
  })
})
