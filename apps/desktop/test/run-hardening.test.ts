import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { CustomRunConfig, EnvIssue, RunState } from '@ccm/shared'
import { previewCommand } from '../src/run/command'
import { createCustomRunner } from '../src/run/custom'
import { firstPid, lineSplitter, parseBuildError, pidofMissing, psPid } from '../src/run/parse'
import { killTree, parseProcRows, substVars, treePids } from '../src/run/proc'
import { BadArgError, cmdShim, quoteCmdArg, withArgs } from '../src/run/resolve'
import { configHash } from '../src/run/trust'
import type { RunContext } from '../src/run/types'

vi.mock('../src/run/proc', async (orig) => {
  const mod = await orig<typeof import('../src/run/proc')>()
  return {
    ...mod,
    killTree: vi.fn((child: ChildProcess & { exitNow?: (code: number | null) => void }) => child.exitNow?.(null)),
  }
})

describe('parse hardening', () => {
  it('a malformed %-escape in a Kotlin file URI keeps the raw path', () => {
    const e = parseBuildError('e: file:///C:/src/100%/Main.kt:3:1 Unresolved reference: x', '/p')
    expect(e).toMatchObject({ line: 3, col: 1, message: 'Unresolved reference: x' })
    expect(e!.file).toContain('100%')
  })

  it('lineSplitter survives a throwing handler and caps endless lines at 64 KB', () => {
    const seen: string[] = []
    const s = lineSplitter((l) => {
      if (l === 'boom') throw new Error('parser bug')
      seen.push(l)
    })
    s.push('a\nboom\nb\n')
    expect(seen).toEqual(['a', 'b'])
    s.push('x'.repeat(64 * 1024 + 10))
    expect(seen.at(-1)).toHaveLength(64 * 1024)
    s.flush()
    expect(seen.at(-1)).toBe('x'.repeat(10))
  })

  it('picks the lowest pid from pidof / ps output and detects a missing pidof', () => {
    expect(firstPid('5678 1234\n')).toBe('1234')
    expect(firstPid('\n')).toBeNull()
    expect(pidofMissing(127, '')).toBe(true)
    expect(pidofMissing(0, '/system/bin/sh: pidof: not found')).toBe(true)
    expect(pidofMissing(1, '')).toBe(false)
    expect(psPid('  PID NAME\n  901 com.ex:remote\n  877 com.ex\n  12 com.ex\n', 'com.ex')).toBe('12')
    expect(psPid('USER PID PPID VSIZE RSS WCHAN PC NAME\nu0_a1 3456 100 1 2 0 0 S com.ex\n', 'com.ex')).toBe('3456')
    expect(psPid('error: unknown option -A\n', 'com.ex')).toBeNull()
  })
})

describe('cmd.exe quoting', () => {
  const env = { SystemRoot: 'C:\\Windows' }

  it.each([
    ['a&b', '^^^"a^^^&b^^^"'],
    ['100%', '^^^"100^^^%^^^"'],
    ['x^y', '^^^"x^^^^y^^^"'],
    ['hi!', '^^^"hi^^^!^^^"'],
    ['two words', '^^^"two^^^ words^^^"'],
    ['C:\\Dự án\\ứng dụng', '^^^"C:\\Dự^^^ án\\ứng^^^ dụng^^^"'],
  ])('%s', (arg, quoted) => {
    expect(quoteCmdArg(arg)).toBe(quoted)
  })

  it('rejects CR / LF / NUL in args and paths', () => {
    for (const bad of ['a\nb', 'a\rb', 'a\0b']) {
      expect(() => quoteCmdArg(bad)).toThrow(BadArgError)
      expect(() => cmdShim(`C:\\x${bad}.bat`, [], env)).toThrow(BadArgError)
    }
    const shim = cmdShim('C:\\tools\\fvm.bat', [], env)
    expect(() => withArgs(shim, ['ok', 'line\nbreak'])).toThrow(BadArgError)
    expect(withArgs({ file: '/bin/echo', args: [] }, ['line\nbreak']).args).toEqual(['line\nbreak'])
  })

  it('one quoting for gradlew, flutter and shims', async () => {
    const { gradlewSpawn } = await import('../src/run/android/env')
    const { flutterSpawn } = await import('../src/run/flutter/env')
    const g = gradlewSpawn('C:\\a b', ['x&y'], 'win32', env)
    const f = flutterSpawn('C:\\a b', ['x&y'], 'win32', env)
    expect(g.args[3]!.endsWith(`${quoteCmdArg('x&y')}"`)).toBe(true)
    expect(f.args[3]!.endsWith(`${quoteCmdArg('x&y')}"`)).toBe(true)
  })
})

describe('gradle daemon survives Stop (win32 pid filter)', () => {
  const table = parseProcRows(
    [
      '100 1 C:\\Windows\\System32\\cmd.exe /d /s /c "gradlew.bat assembleDebug"',
      '101 100 "C:\\jbr\\bin\\java.exe" -classpath gradle-wrapper.jar org.gradle.wrapper.GradleWrapperMain assembleDebug',
      '102 101 "C:\\jbr\\bin\\java.exe" -Xmx2g org.gradle.launcher.daemon.bootstrap.GradleDaemon 8.7',
      '103 102 "C:\\jbr\\bin\\java.exe" org.jetbrains.kotlin.daemon.KotlinCompileDaemon',
      '104 101 C:\\Windows\\System32\\conhost.exe',
      '200 1 unrelated.exe',
    ].join('\r\n'),
  )

  it('kills the client tree, children first, leaving the daemon and its subtree', () => {
    const pids = treePids(100, table, (cmd) => /GradleDaemon/.test(cmd))
    expect([...pids].sort()).toEqual([100, 101, 104])
    expect(pids.indexOf(101)).toBeLessThan(pids.indexOf(100))
    expect(treePids(102, table, (cmd) => /GradleDaemon/.test(cmd))).toEqual([])
  })

  it('still walks orphans of an exited wrapper', () => {
    const orphans = table.filter((r) => r.pid !== 100)
    expect(treePids(100, orphans, () => false).sort()).toEqual([100, 101, 102, 103, 104])
  })
})

describe('${env:} substitution and masking', () => {
  it('only sees the filtered child env + config env', () => {
    const vars = substVars('/p', '/w', { CCM_APP_KEY: 'k', ELECTRON_RUN_AS_NODE: '1', NODE_OPTIONS: '-r x', HOME: '/h' }, { API: 'a' })
    expect(vars.env.CCM_APP_KEY).toBeUndefined()
    expect(vars.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(vars.env.NODE_OPTIONS).toBeUndefined()
    expect(vars.env).toMatchObject({ HOME: '/h', API: 'a' })
  })

  it('preview shows *** for env values but validates with the real ones', () => {
    const cfg: CustomRunConfig = { id: 'c', name: 'c', type: 'custom', cwd: '/w/app', shared: false, env: { TOKEN: 'secret' }, beforeLaunch: [], command: 'deploy --token=${env:TOKEN} --empty=${env:NOPE} ${projectDir}' }
    const p = previewCommand(cfg, { executable: '', deviceId: null, workspaceDir: '/w', env: { CCM_APP_KEY: 'k' } })
    expect(p.argv).toEqual(['deploy', '--token=***', '--empty=', '/w/app'])
    expect(p.command).not.toContain('secret')
    const leak = previewCommand({ ...cfg, command: 'x ${env:CCM_APP_KEY}' }, { executable: '', deviceId: null, workspaceDir: '/w', env: { CCM_APP_KEY: 'k' } })
    expect(leak.argv).toEqual(['x', ''])
  })
})

describe('trust hash', () => {
  it('changes with any content that decides what runs, not with key order', () => {
    const cfg: CustomRunConfig = { id: 'c', name: 'c', type: 'custom', cwd: '/w', shared: true, env: { A: '1', B: '2' }, beforeLaunch: ['npm ci'], command: 'npm start' }
    expect(configHash(cfg)).toBe(configHash({ ...cfg, env: { B: '2', A: '1' } }))
    expect(configHash(cfg)).not.toBe(configHash({ ...cfg, command: 'npm start --evil' }))
    expect(configHash(cfg)).not.toBe(configHash({ ...cfg, beforeLaunch: ['npm ci', 'curl x'] }))
    expect(configHash(cfg)).not.toBe(configHash({ ...cfg, env: { A: '1', B: '3' } }))
  })
})

interface FakeChild extends ChildProcess {
  exitNow: (code: number | null) => void
}

function customHarness(cfg: Partial<CustomRunConfig>, behave: (child: FakeChild, n: number) => void = () => undefined) {
  const states: RunState[] = []
  const fails: EnvIssue[] = []
  const children: FakeChild[] = []
  const ctx: RunContext = {
    root: process.cwd(),
    config: { id: 'c', name: 'c', type: 'custom', cwd: process.cwd(), shared: false, env: {}, beforeLaunch: [], command: 'node -v', ...cfg },
    device: null,
    settings: { flutterSdk: null, androidSdk: null, jdk: null },
    env: process.env,
    platform: process.platform,
    home: process.cwd(),
    spawn: () => {
      const c = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), pid: 1, exitCode: null as number | null, signalCode: null }) as unknown as FakeChild
      c.exitNow = (code) => {
        if (c.exitCode !== null) return
        ;(c as { exitCode: number | null }).exitCode = code ?? 1
        setImmediate(() => {
          c.emit('exit', code)
          c.emit('close', code)
        })
      }
      children.push(c)
      behave(c, children.length - 1)
      return c
    },
    hooks: {
      state: (s) => states.push(s),
      fail: (f) => fails.push(f),
      log: () => undefined,
      error: () => undefined,
      confirm: async () => true,
    },
  }
  return { runner: createCustomRunner(ctx), states, fails, children }
}

describe('custom runner', () => {
  it('Stop tree-kills at once and ends stopped', async () => {
    vi.mocked(killTree).mockClear()
    const h = customHarness({})
    const started = h.runner.start()
    await vi.waitFor(() => expect(h.children).toHaveLength(1))
    await h.runner.stop()
    await started
    expect(vi.mocked(killTree)).toHaveBeenCalledWith(h.children[0], false)
    expect(h.states).toEqual(['running', 'stopping', 'stopped'])
  })

  it('Stop during beforeLaunch reports cancelled and never starts the command', async () => {
    const h = customHarness({ beforeLaunch: ['node -e 1'] })
    const started = h.runner.start()
    await vi.waitFor(() => expect(h.children).toHaveLength(1))
    await h.runner.stop()
    await started
    expect(h.children).toHaveLength(1)
    expect(h.states).toEqual(['before-launch', 'stopping', 'cancelled'])
    expect(h.fails).toEqual([])
  })

  it('a step resolves on exit even when a grandchild keeps the pipes open', async () => {
    const h = customHarness({}, (c) =>
      setImmediate(() => {
        ;(c as { exitCode: number | null }).exitCode = 0
        c.emit('exit', 0)
      }),
    )
    await h.runner.start()
    expect(h.states).toEqual(['running', 'stopped'])
  }, 5_000)
})
