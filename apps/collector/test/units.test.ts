import { mkdtemp, appendFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { mapRegistryStatus, mapTaskNotificationStatus } from '@ccm/shared'
import { parseProcessQueryOutput, procStartMatches } from '../src/process'
import { parseRegistryRecord, pidFromFileName } from '../src/registry'
import { JsonlTailer } from '../src/tailer'
import { extractSignals, TranscriptState } from '../src/transcript'
import { MonitorStore } from '../src/store'

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
  it('matches FILETIME within 1ms', () => {
    expect(procStartMatches('134358400013081891', 134358400013081890n)).toBe(true)
    expect(procStartMatches('134358400013081891', 134358400013181891n)).toBe(false)
    expect(procStartMatches(undefined, 1n)).toBe(true)
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
    await launchClaude(dir, 'continue', async (cmd, args, cwd) => {
      calls.push([cmd, ...args, `cwd=${cwd}`])
      if (cmd === 'wt.exe') throw new Error('ENOENT')
    })
    expect(calls[0]).toEqual(['wt.exe', '-w', '0', 'nt', '-d', dir, 'powershell.exe', '-NoLogo', '-NoExit', '-Command', 'claude --continue', `cwd=${dir}`])
    expect(calls[1]).toEqual(['powershell.exe', '-NoLogo', '-NoExit', '-Command', 'claude --continue', `cwd=${dir}`])
    await expect(launchClaude(`${dir}/does-not-exist`, 'new', async () => {})).rejects.toThrow('directory not found')
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
