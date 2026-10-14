import { mkdir, mkdtemp, appendFile, rm, writeFile } from 'node:fs/promises'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { mapRegistryStatus, mapTaskNotificationStatus, waitReason } from '@ccm/shared'
import { parseProcessQueryOutput, parsePsNames, parsePsOutput, procStartMatches } from '../src/process'
import { parseRegistryRecord, pidFromFileName } from '../src/registry'
import { JsonlTailer } from '../src/tailer'
import { extractSignals, TranscriptState } from '../src/transcript'
import { MonitorStore } from '../src/store'
import { loadConfig } from '../src/config'
import type { RunResult, Runner } from '../src/osascript'

describe('waitReason', () => {
  it('maps documented values', () => {
    for (const v of ['permission prompt', ' Permission Prompt ', 'sandbox request', 'worker request']) expect(waitReason(v)).toBe('permission')
    for (const v of ['input needed', 'dialog open']) expect(waitReason(v)).toBe('question')
  })

  it('maps unknown strings to other', () => {
    for (const v of ['something new', '', undefined]) expect(waitReason(v)).toBe('other')
  })
})

describe('status mapping', () => {
  it('maps every verified raw status', () => {
    expect(mapRegistryStatus('busy')).toEqual({ status: 'working', backgroundShell: false })
    expect(mapRegistryStatus('waiting')).toEqual({ status: 'waiting', backgroundShell: false })
    expect(mapRegistryStatus('shell')).toEqual({ status: 'idle', backgroundShell: true })
    expect(mapRegistryStatus('idle')).toEqual({ status: 'idle', backgroundShell: false })
    expect(mapRegistryStatus('teleporting').status).toBe('unknown')
    expect(mapRegistryStatus(undefined).status).toBe('unknown')
  })

  it('maps task notification statuses', () => {
    expect(mapTaskNotificationStatus('completed')).toBe('completed')
    expect(mapTaskNotificationStatus('failed')).toBe('error')
    expect(mapTaskNotificationStatus('stopped')).toBe('cancelled')
    expect(mapTaskNotificationStatus('weird')).toBe('unknown')
  })
})

describe('registry', () => {
  it('accepts only canonical pid file names', () => {
    expect(pidFromFileName('1234.json')).toBe(1234)
    expect(pidFromFileName('01234.json')).toBeNull()
    expect(pidFromFileName('1234.abc.key')).toBeNull()
    expect(pidFromFileName('x.json')).toBeNull()
  })

  it('keeps only whitelisted fields', () => {
    const rec = parseRegistryRecord(
      7,
      JSON.stringify({ pid: 7, sessionId: 's', name: 'n', status: 'busy', messagingSocketPath: '\\\\.\\pipe\\secret', startedAt: 'bad' }),
    )
    expect(rec).toMatchObject({ pid: 7, sessionId: 's', name: 'n', status: 'busy' })
    expect(rec).not.toHaveProperty('messagingSocketPath', expect.anything())
    expect(rec?.startedAt).toBeUndefined()
  })

  it('returns null on torn json', () => {
    expect(parseRegistryRecord(7, '{"pid":7,"sess')).toBeNull()
  })
})

describe('process', () => {
  const ft = (value: bigint) => ({ kind: 'filetime' as const, value })
  const ls = (value: string) => ({ kind: 'lstart' as const, value })

  it('matches FILETIME within 1ms', () => {
    expect(procStartMatches('134358400013081891', ft(134358400013081890n))).toBe(true)
    expect(procStartMatches('134358400013081891', ft(134358400013181891n))).toBe(false)
    expect(procStartMatches(undefined, ft(1n))).toBe(true)
  })

  it('matches ps lstart exactly, ignoring spacing, and keeps unknown formats', () => {
    expect(procStartMatches('Thu Oct  8 03:01:22 2026', ls('Thu Oct 8 03:01:22 2026'))).toBe(true)
    expect(procStartMatches('Thu Oct  8 03:01:22 2026', ls('Thu Oct  8 03:01:23 2026'))).toBe(false)
    expect(procStartMatches('2026-10-08T03:01:22Z', ls('Thu Oct  8 03:01:22 2026'))).toBe(true)
    expect(procStartMatches(undefined, ls('Thu Oct  8 03:01:22 2026'))).toBe(true)
  })

  it('parses ps rows and parent names', () => {
    const out = '  4242   311 Thu Oct  8 03:01:22 2026\n  77 1 Fri Oct 10 12:00:00 2026\ngarbage\n\n'
    const info = parsePsOutput(out)
    expect(info.get(4242)).toEqual({ pid: 4242, parentPid: 311, start: ls('Thu Oct 8 03:01:22 2026') })
    expect(info.get(77)?.start).toEqual(ls('Fri Oct 10 12:00:00 2026'))
    expect(info.size).toBe(2)
    expect(parsePsOutput('').size).toBe(0)
    const names = parsePsNames('  311 -zsh\n  12 /Applications/iTerm.app/Contents/MacOS/iTerm2\n 9 bash\n')
    expect([...names.values()]).toEqual(['zsh', 'iTerm2', 'bash'])
  })

  it('parses single and array CIM output', () => {
    expect(parseProcessQueryOutput('{"pid":1,"ft":"5","ppid":2,"pname":"pwsh.exe"}').get(1)?.parentName).toBe('pwsh.exe')
    expect(parseProcessQueryOutput('[{"pid":1,"ft":"5"},{"pid":3,"ft":"x"}]').size).toBe(1)
    expect(parseProcessQueryOutput('').size).toBe(0)
  })
})

describe('JsonlTailer', () => {
  it('reads incrementally and buffers partial lines and split utf8', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'ccm-tail-'))
    const file = path.join(dir, 'a.jsonl')
    await writeFile(file, '{"a":1}\n{"b":')
    const t = new JsonlTailer(file)
    expect(await t.read()).toEqual([{ a: 1 }])
    const bytes = Buffer.from('"ệ"}\n', 'utf8')
    await appendFile(file, bytes.subarray(0, 2))
    expect(await t.read()).toEqual([])
    await appendFile(file, bytes.subarray(2))
    expect(await t.read()).toEqual([{ b: 'ệ' }])
    await appendFile(file, 'not json\n{"c":3}\n')
    expect(await t.read()).toEqual([{ c: 3 }])
  })

  it('returns nothing for a missing file', async () => {
    expect(await new JsonlTailer(path.join(os.tmpdir(), 'nope-ccm.jsonl')).read()).toEqual([])
  })
})

describe('transcript signals', () => {
  const assistant = (id: string, blocks: unknown[], stop: string | null = 'tool_use') => ({
    type: 'assistant',
    timestamp: '2026-10-07T10:00:00.000Z',
    message: { id, model: 'claude-opus-5-5', stop_reason: stop, content: blocks, usage: { input_tokens: 10, cache_read_input_tokens: 5, output_tokens: 3 } },
  })

  it('dedupes usage per message id and tracks open tools', () => {
    const s = new TranscriptState()
    s.apply(extractSignals(assistant('m1', [{ type: 'thinking' }])))
    s.apply(extractSignals(assistant('m1', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'secret' } }])))
    expect(s.tokens()).toEqual({ input: 10, output: 3, cacheRead: 5 })
    expect(s.currentTool()).toBe('Bash')
    expect(s.model).toBe('claude-opus-5-5')
    s.apply(extractSignals({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] } }))
    expect(s.currentTool()).toBeUndefined()
  })

  it('parses task notifications without content', () => {
    const text = '<task-notification><task-id>abc</task-id><tool-use-id>toolu_1</tool-use-id><status>failed</status><summary>secret</summary></task-notification>'
    const sig = extractSignals({ type: 'queue-operation', operation: 'enqueue', content: text })
    expect(sig).toEqual([{ k: 'task_notification', taskId: 'abc', toolUseId: 'toolu_1', status: 'failed', at: undefined }])
    expect(JSON.stringify(sig)).not.toContain('secret')
  })

  it('ignores unknown record types', () => {
    expect(extractSignals({ type: 'brand-new-thing', foo: 1 })).toEqual([])
    expect(extractSignals(null)).toEqual([])
  })
})

describe('MonitorStore', () => {
  it('emits created, field patches with null for cleared fields, and batches', async () => {
    const store = new MonitorStore({ activityLimit: 3, batchMs: 5 })
    const messages: unknown[] = []
    store.subscribe((m) => messages.push(m))
    store.upsertTerminal({ id: 't', title: 'A', status: 'idle', waitingFor: 'x' })
    store.upsertTerminal({ id: 't', title: 'B', status: 'idle' })
    store.upsertTerminal({ id: 't', title: 'B', status: 'idle' })
    for (let i = 0; i < 5; i++) store.pushActivity({ kind: 'tool.started', data: { tool: String(i) } })
    await new Promise((r) => setTimeout(r, 20))
    expect(messages).toHaveLength(1)
    const msg = messages[0] as { seq: number; events: { type: string; payload: Record<string, unknown> }[] }
    expect(msg.seq).toBe(1)
    expect(msg.events[0]?.type).toBe('terminal.created')
    expect(msg.events[1]).toEqual({ type: 'terminal.updated', payload: { id: 't', title: 'B', waitingFor: null } })
    expect(msg.events.filter((e) => e.type === 'terminal.updated')).toHaveLength(1)
    expect(store.snapshot().activity).toHaveLength(3)
  })

  it('keeps broadcasting when one listener throws', () => {
    const store = new MonitorStore({ activityLimit: 3, batchMs: 5 })
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const got: unknown[] = []
    store.subscribe(() => {
      throw new Error('toast observer')
    })
    store.subscribe((m) => got.push(m))
    store.upsertTerminal({ id: 't', title: 'A', status: 'idle' })
    store.flush()
    expect(got).toHaveLength(1)
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
})

describe('context window and launcher', () => {
  it('infers the context window and threshold level', async () => {
    const { contextWindowOf, contextLevel } = await import('@ccm/shared')
    expect(contextWindowOf('claude-opus-5-5')).toBe(200_000)
    expect(contextWindowOf('claude-opus-5-5', { settingsModel: 'opus[1m]' })).toBe(1_000_000)
    expect(contextWindowOf('claude-haiku-4-5', { settingsModel: 'opus[1m]' })).toBe(200_000)
    expect(contextWindowOf('claude-sonnet-5', { peak: 300_000 })).toBe(1_000_000)
    expect(contextWindowOf('gpt-x')).toBeUndefined()
    expect(contextWindowOf('claude-opus-5-5', { catalog: 1_000_000 })).toBe(1_000_000)
    expect(contextWindowOf('claude-opus-4-1', { catalog: 200_000, settingsModel: 'opus[1m]' })).toBe(1_000_000)
    expect(contextWindowOf('claude-opus-5-5', { catalog: 1_000_000, reported: 200_000 })).toBe(200_000)
    expect(contextWindowOf(undefined, { reported: 1_000_000 })).toBe(1_000_000)
    expect(contextWindowOf('claude-opus-5-5', { reported: 0, catalog: -1 })).toBe(200_000)
    expect([59, 60, 80, 95].map(contextLevel)).toEqual(['ok', 'notice', 'warning', 'critical'])
  })

  it('launches through wt with a fixed command and falls back to a console', async () => {
    const { launchClaude } = await import('../src/launcher')
    const calls: string[][] = []
    const dir = process.cwd()
    const local = mkdtempSync(path.join(os.tmpdir(), 'ccm-wt-'))
    const wt = path.join(local, 'Microsoft', 'WindowsApps', 'wt.exe')
    mkdirSync(path.dirname(wt), { recursive: true })
    writeFileSync(wt, '')
    const env = { LOCALAPPDATA: local, SystemRoot: 'C:\\Win', PATH: '' }
    const ps = 'C:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
    const spawner = async (cmd: string, args: string[], cwd: string) => {
      calls.push([cmd, ...args, `cwd=${cwd}`])
      if (cmd === wt) throw new Error('ENOENT')
    }
    await launchClaude(dir, 'continue', spawner, undefined, 'win32', undefined, env)
    expect(calls[0]).toEqual([wt, '-w', '0', 'nt', '-d', dir, ps, '-NoLogo', '-NoExit', '-Command', 'claude --continue', `cwd=${dir}`])
    expect(calls[1]).toEqual([ps, '-NoLogo', '-NoExit', '-Command', 'claude --continue', `cwd=${dir}`])
    calls.length = 0
    await launchClaude(dir, 'new', spawner, undefined, 'win32', undefined, { SystemRoot: 'C:\\Win', PATH: dir })
    expect(calls.map((c) => c[0])).toEqual([ps])
    await expect(launchClaude(`${dir}/does-not-exist`, 'new', async () => {}, undefined, 'win32')).rejects.toThrow('directory not found')
  })
})

function fakeRun(result: Partial<RunResult> = {}) {
  const calls: [string, string[]][] = []
  const run: Runner = async (command, args) => {
    calls.push([command, args])
    return { code: 0, stdout: '', stderr: '', ...result }
  }
  return { calls, run }
}

describe('macOS launcher', () => {
  it('launchArgs keeps the dir as a separate argv item', async () => {
    const { launchArgs } = await import('../src/launcher')
    const dir = "/tmp/a b'c$(x)"
    for (const app of ['terminal', 'iterm'] as const) {
      const args = launchArgs(app, dir, 'new')
      expect(args).toHaveLength(4)
      expect(args[0]).toBe('-e')
      expect(args[1]).toContain('on run argv')
      expect(args[1]).toContain('quoted form of')
      expect(args[1]).not.toContain('a b')
      expect(args[2]).toBe(dir)
      expect(args[3]).toBe('claude')
    }
    expect(launchArgs('iterm', dir, 'new')[1]).toContain('application id "com.googlecode.iterm2"')
    expect(launchArgs('iterm', dir, 'new')[1]).toContain('create window with default profile')
    expect(launchArgs('terminal', dir, 'new')[1]).toMatch(/do script cmdLine\n/)
  })

  it('continue runs claude --continue', async () => {
    const { launchArgs } = await import('../src/launcher')
    expect(launchArgs('terminal', '/x', 'continue')[3]).toBe('claude --continue')
    expect(launchArgs('iterm', '/x', 'continue')[3]).toBe('claude --continue')
  })

  it('runs osascript on darwin and never the spawner', async () => {
    const { launchArgs, launchClaude } = await import('../src/launcher')
    const dir = process.cwd()
    const spawner = vi.fn(async () => {})
    const ok = fakeRun()
    await launchClaude(dir, 'continue', spawner, 'iterm', 'darwin', ok.run)
    expect(spawner).not.toHaveBeenCalled()
    expect(ok.calls).toEqual([['osascript', launchArgs('iterm', dir, 'continue')]])
    const def = fakeRun()
    await launchClaude(dir, 'new', spawner, undefined, 'darwin', def.run)
    expect(def.calls[0]![1]).toEqual(launchArgs('terminal', dir, 'new'))
  })

  it('maps osascript failures to LaunchError codes', async () => {
    const { launchClaude, LaunchError } = await import('../src/launcher')
    const dir = process.cwd()
    const cases: [string, string][] = [
      ['execution error: Not authorized to send Apple events to iTerm. (-1743)', 'denied'],
      ['execution error: Can’t get application "iTerm". (-1728)', 'notInstalled'],
      ['104:145: syntax error: Can’t get application id "com.googlecode.iterm2". (-1728)', 'notInstalled'],
      ['execution error: User canceled. (-128)', 'failed'],
      ['boom', 'failed'],
    ]
    for (const [stderr, code] of cases) {
      const err = await launchClaude(dir, 'new', undefined, 'iterm', 'darwin', fakeRun({ code: 1, stderr }).run).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(LaunchError)
      expect(err).toMatchObject({ code })
    }
  })

  // Windows cannot create these folder names; the guard itself is macOS-only (osascript).
  it.skipIf(process.platform === 'win32')('refuses dirs with control characters before running osascript', async () => {
    const { hasControlChars, launchClaude, LaunchError } = await import('../src/launcher')
    const root = await mkdtemp(path.join(os.tmpdir(), 'ccm-ctl-'))
    for (const name of ['x\x15touch PWNED', 'x\ntouch PWNED', 'x\x1b[200~y']) {
      const dir = path.join(root, name)
      await mkdir(dir)
      expect(hasControlChars(dir)).toBe(true)
      const r = fakeRun()
      const err = await launchClaude(dir, 'new', undefined, 'terminal', 'darwin', r.run).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(LaunchError)
      expect(err).toMatchObject({ code: 'failed' })
      expect(r.calls).toEqual([])
    }
    expect(hasControlChars("/tmp/a b'c$(x)")).toBe(false)
    expect(hasControlChars('/tmp/x\x7f')).toBe(true)
    await rm(root, { recursive: true, force: true })
  })

  it('checks the directory first and stays unsupported on linux', async () => {
    const { launchClaude } = await import('../src/launcher')
    const r = fakeRun()
    await expect(launchClaude(`${process.cwd()}/does-not-exist`, 'new', undefined, 'terminal', 'darwin', r.run)).rejects.toThrow('directory not found')
    expect(r.calls).toEqual([])
    await expect(launchClaude(process.cwd(), 'new', undefined, 'terminal', 'linux', r.run)).rejects.toThrow('unsupported platform')
    expect(r.calls).toEqual([])
  })
})

describe('macOS folder picker', () => {
  it('returns the POSIX path without the trailing slash', async () => {
    const { pickFolder } = await import('../src/folder-pick')
    const r = fakeRun({ stdout: '/Users/x/p/\n' })
    expect(await pickFolder('darwin', r.run)).toEqual({ result: 'ok', dir: '/Users/x/p' })
    expect(r.calls[0]![0]).toBe('osascript')
    expect(r.calls[0]![1][0]).toBe('-e')
    expect(r.calls[0]![1][1]).toContain('POSIX path of (choose folder')
    expect(await pickFolder('darwin', fakeRun({ stdout: '/\n' }).run)).toEqual({ result: 'ok', dir: '/' })
    expect(await pickFolder('darwin', fakeRun({ stdout: "/Users/x/a b'c/\n" }).run)).toEqual({ result: 'ok', dir: "/Users/x/a b'c" })
  })

  it('maps cancel, errors and other platforms', async () => {
    const { pickFolder } = await import('../src/folder-pick')
    expect(await pickFolder('darwin', fakeRun({ code: 1, stderr: 'execution error: User canceled. (-128)' }).run)).toEqual({ result: 'cancelled' })
    expect(await pickFolder('darwin', fakeRun({ code: 1, stderr: 'boom' }).run)).toEqual({ result: 'failed' })
    expect(await pickFolder('darwin', fakeRun({ stdout: '\n' }).run)).toEqual({ result: 'failed' })
    expect(await pickFolder('darwin', fakeRun({ stdout: 'relative/\n' }).run)).toEqual({ result: 'failed' })
    const r = fakeRun()
    expect(await pickFolder('linux', r.run)).toEqual({ result: 'unsupported' })
    expect(r.calls).toEqual([])
  })
})

describe('repo roots', () => {
  it('maps sub folders to the nearest .git ancestor, never above the stop dir', async () => {
    const { RepoRoots } = await import('../src/repo')
    const home = path.resolve('/home/me')
    const repos = new Set([path.resolve('/work/app'), home].map((d) => d.toLowerCase()))
    const probed: string[] = []
    const roots = new RepoRoots(async (d) => {
      probed.push(d)
      return repos.has(d.toLowerCase())
    }, [home])
    expect(await roots.resolve(path.resolve('/work/app/src/main/java'))).toBe(path.resolve('/work/app'))
    expect(await roots.resolve(path.resolve('/work/app'))).toBe(path.resolve('/work/app'))
    expect(await roots.resolve(path.resolve('/home/me/notes'))).toBe(path.resolve('/home/me/notes'))
    expect(await roots.resolve(home)).toBe(home)
    expect(await roots.resolve('relative/dir')).toBe('relative/dir')
    const count = probed.length
    await roots.resolve(path.resolve('/work/app/src/main/java'))
    expect(probed.length).toBe(count)
  })

  it('emits only new roots and reports unknown projects once resolved', () => {
    const store = new MonitorStore({ activityLimit: 10, batchMs: 1 })
    const asked: string[][] = []
    store.onNewProjects = (dirs) => asked.push(dirs)
    const b = { key: 'k', day: '2026-10-07', model: 'm', project: 'D:/a/b', messages: 1, input: 1, output: 1, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 }
    store.updateUsage([b])
    expect(asked).toEqual([['D:/a/b']])
    store.setProjectRoots({ 'D:/a/b': 'D:/a' })
    store.updateUsage([b])
    expect(asked).toHaveLength(1)
    expect(store.usageSnapshot().roots).toEqual({ 'D:/a/b': 'D:/a' })
  })
})

describe('config toast', () => {
  it('enables toast only for win32 or the electron backend', () => {
    expect(loadConfig({}, 'win32')).toMatchObject({ toast: true, toastBackend: 'powershell' })
    expect(loadConfig({ CCM_TOAST_BACKEND: 'electron' }, 'darwin')).toMatchObject({ toast: true, toastBackend: 'electron' })
    expect(loadConfig({}, 'darwin')).toMatchObject({ toast: false, toastBackend: null })
    expect(loadConfig({ CCM_TOAST: '0' }, 'win32')).toMatchObject({ toast: false, toastBackend: null })
    expect(loadConfig({ CCM_TOAST_BACKEND: 'electron', CCM_TOAST: '0' }, 'darwin')).toMatchObject({ toast: false, toastBackend: null })
  })
})
