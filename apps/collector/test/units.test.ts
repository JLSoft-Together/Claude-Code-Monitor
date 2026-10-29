import { mkdir, mkdtemp, appendFile, rm, writeFile } from 'node:fs/promises'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { mapRegistryStatus, mapTaskNotificationStatus, waitReason } from '@ccm/shared'
import { parseProcessQueryOutput, parsePsNames, parsePsOutput, procStartMatches } from '../src/process'
import { parseRegistryRecord, pidFromFileName, socketKey } from '../src/registry'
import { JsonlTailer } from '../src/tailer'
import { extractSignals, TranscriptState, type Signal } from '../src/transcript'
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

  it('keeps only a short hash of the messaging socket path', () => {
    const socket = '\\\\.\\pipe\\LOCAL\\cc-msg-0123456789abcdef0123456789abcdef'
    const rec = parseRegistryRecord(7, JSON.stringify({ pid: 7, messagingSocketPath: socket }))
    expect(rec?.sockKey).toMatch(/^[0-9a-f]{16}$/)
    expect(rec?.sockKey).toBe(socketKey(socket))
    expect(socketKey(socket.toUpperCase())).toBe(rec?.sockKey)
    expect(JSON.stringify(rec)).not.toContain('pipe')
    expect(JSON.stringify(rec)).not.toContain('cc-msg')
    expect(parseRegistryRecord(7, JSON.stringify({ pid: 7, messagingSocketPath: 'x'.repeat(301) }))?.sockKey).toBeUndefined()
    expect(parseRegistryRecord(7, JSON.stringify({ pid: 7, messagingSocketPath: 42 }))?.sockKey).toBeUndefined()
    expect(socketKey('')).toBeUndefined()
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

  describe('main ↔ subagent messages', () => {
    const AID = 'a0123456789abcdef'
    const FAKE = '…fake-body…'
    const T = '2026-10-16T10:00:00.000Z'
    const user = (origin: unknown, extra: Record<string, unknown> = {}) => ({
      type: 'user',
      uuid: 'u-1',
      timestamp: T,
      isMeta: true,
      promptSource: 'system',
      origin,
      message: { role: 'user', content: `<agent-message from="${AID}">${FAKE}</agent-message>` },
      ...extra,
    })
    const queued = (origin: unknown, extra: Record<string, unknown> = {}) => ({
      type: 'attachment',
      uuid: 'att-1',
      timestamp: T,
      attachment: { type: 'queued_command', prompt: FAKE, source_uuid: 'src-1', delivery_id: 'del-1', commandMode: 'prompt', isMeta: true, timestamp: T, origin, ...extra },
    })
    const handback = { kind: 'peer', from: AID, senderTaskId: AID, handback: true, name: FAKE, body: FAKE }
    const sendMessage = (to: string) => ({
      type: 'assistant',
      timestamp: T,
      message: { id: 'm1', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_s1', name: 'SendMessage', input: { to, message: FAKE, summary: FAKE, type: 'message', recipient: to, content: FAKE } }] },
    })
    const message = (s: Signal) => s.k === 'coordinator_msg' || s.k === 'handback' || s.k === 'send_main'

    it('reads a coordinator message from the user record or the queued command, by id and time only', () => {
      expect(extractSignals(user({ kind: 'coordinator' }))).toEqual([
        { k: 'seen', at: T },
        { k: 'coordinator_msg', key: 'u-1', at: T },
      ])
      expect(extractSignals(queued({ kind: 'coordinator' }))).toEqual([{ k: 'coordinator_msg', key: 'src-1', at: T }])
    })

    it('reads a hand-back only when it comes from an agent id with handback set', () => {
      expect(extractSignals(user(handback)).filter(message)).toEqual([{ k: 'handback', from: AID, key: 'u-1', at: T }])
      expect(extractSignals(queued(handback))).toEqual([{ k: 'handback', from: AID, key: 'src-1', at: T }])
      expect(extractSignals(user({ ...handback, handback: undefined })).filter(message)).toEqual([])
      expect(extractSignals(user({ ...handback, from: 'uds:\\\\.\\pipe\\LOCAL\\cc-msg-x' })).filter(message)).toEqual([])
      expect(extractSignals(user({ ...handback, from: 'a1' })).filter(message)).toEqual([])
      expect(extractSignals(user({ kind: 'human' })).filter(message)).toEqual([])
      expect(extractSignals(queued({ kind: 'human' }))).toEqual([])
      expect(extractSignals({ type: 'queue-operation', operation: 'enqueue', timestamp: T, content: `<agent-message from="${AID}">${FAKE}</agent-message>` })).toEqual([])
    })

    it('reads SendMessage to main by its tool use id and ignores sends to a subagent', () => {
      expect(extractSignals(sendMessage('main')).filter(message)).toEqual([{ k: 'send_main', key: 'toolu_s1', at: T }])
      expect(extractSignals(sendMessage(AID)).filter(message)).toEqual([])
      expect(extractSignals(sendMessage(AID)).map((s) => s.k)).toContain('tool_use')
    })

    it('falls back to the timestamp as key and drops records with neither', () => {
      expect(extractSignals(user({ kind: 'coordinator' }, { uuid: undefined })).filter(message)).toEqual([{ k: 'coordinator_msg', key: `@${T}`, at: T }])
      expect(extractSignals(user({ kind: 'coordinator' }, { uuid: 'not a valid id' })).filter(message)).toEqual([{ k: 'coordinator_msg', key: `@${T}`, at: T }])
      expect(extractSignals(user({ kind: 'coordinator' }, { uuid: undefined, timestamp: undefined })).filter(message)).toEqual([])
      expect(extractSignals(queued(handback, { source_uuid: undefined })).filter(message)).toEqual([{ k: 'handback', from: AID, key: 'att-1', at: T }])
    })

    it('lets no message content out', () => {
      const out = [user({ kind: 'coordinator' }), queued({ kind: 'coordinator' }), user(handback), queued(handback), sendMessage('main'), sendMessage(AID)].flatMap((r) => extractSignals(r))
      expect(out.filter(message)).toHaveLength(5)
      expect(JSON.stringify(out)).not.toContain('fake-body')
    })
  })

  describe('session ↔ session messages', () => {
    const SOCKET = '\\\\.\\pipe\\LOCAL\\cc-msg-0123456789abcdef0123456789abcdef'
    const MSG = '0f8fad5b-d9cb-469f-a165-70867728950e'
    const FAKE = '…fake-body…'
    const T = '2026-10-16T10:00:00.000Z'
    const peer = (from: string, extra: Record<string, unknown> = {}) => ({ kind: 'peer', from, msg_id: MSG, name: FAKE, fromMode: 'prompting', hopChain: ['abc'], body: FAKE, ...extra })
    const delivered = (origin: unknown, extra: Record<string, unknown> = {}) => ({
      type: 'user',
      uuid: 'u-1',
      timestamp: T,
      isMeta: true,
      turnOrigin: 'peer',
      promptSource: 'system',
      origin,
      message: { role: 'user', content: `<cross-session-message from="uds:${SOCKET}" from-name="${FAKE}">${FAKE}</cross-session-message>` },
      ...extra,
    })
    const queued = (origin: unknown) => ({
      type: 'attachment',
      uuid: 'att-1',
      timestamp: T,
      attachment: { type: 'queued_command', prompt: FAKE, source_uuid: 'src-1', commandMode: 'prompt', isMeta: true, origin },
    })
    const result = (toolUseResult: Record<string, unknown>) => ({
      type: 'user',
      uuid: 'u-2',
      timestamp: T,
      toolUseResult,
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_s1', content: FAKE }] },
    })
    const peerOnly = (s: Signal) => s.k === 'peer_in' || s.k === 'peer_sent'

    it('reads a delivered message as the hashed sender socket, msg_id and time', () => {
      const fromKey = socketKey(SOCKET)
      expect(extractSignals(delivered(peer(`uds:${SOCKET}`))).filter(peerOnly)).toEqual([{ k: 'peer_in', fromKey, msgId: MSG, dedupeKey: 'u-1', at: T }])
      expect(extractSignals(queued(peer(`uds:${SOCKET}`)))).toEqual([{ k: 'peer_in', fromKey, msgId: MSG, dedupeKey: 'src-1', at: T }])
      expect(extractSignals(delivered(peer(`uds:${SOCKET.toUpperCase()}`))).filter(peerOnly)[0]).toMatchObject({ fromKey })
      expect(extractSignals(delivered(peer('uds:/tmp/cc%20msg.sock'))).filter(peerOnly)[0]).toMatchObject({ fromKey: socketKey('/tmp/cc msg.sock') })
      expect(extractSignals(delivered(peer('uds:/tmp/%E0%A4%A.sock'))).filter(peerOnly)[0]).toMatchObject({ fromKey: socketKey('/tmp/%E0%A4%A.sock') })
      expect(extractSignals(delivered(peer(`uds:${SOCKET}`, { msg_id: 'bad id!' }))).filter(peerOnly)).toEqual([{ k: 'peer_in', fromKey, msgId: undefined, dedupeKey: 'u-1', at: T }])
    })

    it('ignores other addresses and hand-backs', () => {
      for (const from of ['bridge:abc', 'did:x:y', 'unknown', 'a0123456789abcdef', 'uds:']) {
        expect(extractSignals(delivered(peer(from))).filter(peerOnly)).toEqual([])
      }
      expect(extractSignals({ type: 'queue-operation', operation: 'enqueue', timestamp: T, content: `<cross-session-message from="uds:${SOCKET}">${FAKE}</cross-session-message>` })).toEqual([])
    })

    it('reads a successful send by msg_id only, never a send to a subagent', () => {
      expect(extractSignals(result({ success: true, message: FAKE, display: FAKE, msg_id: MSG })).filter(peerOnly)).toEqual([{ k: 'peer_sent', msgId: MSG, at: T }])
      expect(extractSignals(result({ success: false, message: FAKE, msg_id: MSG })).filter(peerOnly)).toEqual([])
      expect(extractSignals(result({ success: true, message: FAKE, msg_id: MSG, pin: { id: 'a0123456789abcdef', name: FAKE } })).filter(peerOnly)).toEqual([])
      expect(extractSignals(result({ success: true, message: FAKE, msg_id: MSG, resumedAgentId: 'a0123456789abcdef' })).filter(peerOnly)).toEqual([])
      expect(extractSignals(result({ success: true, message: FAKE })).filter(peerOnly)).toEqual([])
    })

    it('lets no message content or socket path out', () => {
      const out = [delivered(peer(`uds:${SOCKET}`)), queued(peer(`uds:${SOCKET}`)), result({ success: true, message: FAKE, display: FAKE, msg_id: MSG })].flatMap((r) => extractSignals(r))
      const json = JSON.stringify(out)
      expect(out.filter(peerOnly)).toHaveLength(3)
      expect(json).not.toContain('fake-body')
      expect(json).not.toContain('pipe')
      expect(json).not.toContain('cc-msg')
    })
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
    expect(msg.events[0]).toEqual({ type: 'terminal.created', payload: { id: 't', title: 'B', status: 'idle' } })
    expect(msg.events.filter((e) => e.type === 'terminal.updated')).toHaveLength(0)
    expect(store.snapshot().activity).toHaveLength(3)

    store.upsertTerminal({ id: 't', title: 'C', status: 'working', waitingFor: 'y' })
    store.upsertTerminal({ id: 't', title: 'C', status: 'idle' })
    store.flush()
    expect((messages[1] as typeof msg).events).toEqual([{ type: 'terminal.updated', payload: { id: 't', title: 'C', status: 'idle', waitingFor: null } }])
  })

  it('merges patches per id in a batch, last value per field, without crossing a removal', () => {
    const store = new MonitorStore({ activityLimit: 3, batchMs: 5 })
    const messages: { events: { type: string; payload: Record<string, unknown> }[] }[] = []
    store.subscribe((m) => messages.push(m as (typeof messages)[number]))
    const agent = { id: 'a', terminalId: 't', role: 'subagent' as const, name: 'x', status: 'working' as const }
    store.upsertAgent(agent)
    store.flush()
    store.upsertAgent({ ...agent, status: 'waiting', currentTool: 'Bash' })
    store.upsertAgent({ ...agent, id: 'b' })
    store.upsertAgent({ ...agent, status: 'completed' })
    store.pushActivity({ kind: 'agent.completed', agentId: 'a' })
    store.removeAgent('a')
    store.upsertAgent({ ...agent, name: 'again' })
    store.upsertAgent({ ...agent, name: 'again', status: 'completed' })
    store.flush()
    const events = messages[1]!.events
    expect(events.map((e) => e.type)).toEqual(['agent.updated', 'agent.created', 'activity', 'agent.removed', 'agent.created'])
    expect(events[0]!.payload).toEqual({ id: 'a', status: 'completed', currentTool: null })
    expect(events[4]!.payload).toMatchObject({ id: 'a', name: 'again', status: 'completed' })
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

describe('usage limit records (Claude Code 2.1.294)', () => {
  const hit = {
    type: 'assistant',
    timestamp: '2026-10-28T20:05:48.427Z',
    isApiErrorMessage: true,
    apiError: 'usage_limit_reached',
    error: 'rate_limit',
    quotaLimits: { status: 'rejected', resetsAt: 1793227200, rateLimitType: 'five_hour' },
    message: { id: 'x', model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text: "You've hit your session limit · resets 5:40am" }] },
  }
  const notice = (content: string) => ({ type: 'system', subtype: 'informational', level: 'notice', content })

  it('marks the hit with its reset time, Claude Code auto-continue and clears on the next real reply', () => {
    const s = new TranscriptState()
    s.apply(extractSignals(hit))
    expect(s.limitHit).toEqual({ at: hit.timestamp, resetsAt: new Date(1793227200 * 1000).toISOString(), window: 'five_hour', autoResume: undefined })
    s.apply(extractSignals(notice('Usage limit reached · continuing automatically at 5:40am · esc to cancel')))
    expect(s.limitHit?.autoResume).toBe(true)
    s.apply(extractSignals(notice('Automatic continue cancelled · /rate-limit-options to re-arm')))
    expect(s.limitHit?.autoResume).toBe(false)
    s.apply(extractSignals({ type: 'assistant', timestamp: 'x', message: { id: 'y', model: 'claude-opus-5-5', content: [] } }))
    expect(s.limitHit).toBeUndefined()

    s.apply(extractSignals(hit))
    s.apply(extractSignals(notice('Usage limit reset · continuing automatically')))
    expect(s.limitHit).toBeUndefined()
  })

  it('ignores other api errors and notices', () => {
    expect(extractSignals({ ...hit, apiError: 'overloaded' }).some((x) => x.k === 'limit_hit')).toBe(false)
    expect(extractSignals(notice('Something else'))).toEqual([])
  })
})
