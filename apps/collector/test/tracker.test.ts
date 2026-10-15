import { appendFileSync } from 'node:fs'
import { appendFile, mkdir, mkdtemp, utimes, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RegistryRecord } from '../src/registry'
import { cwdSlug, findTranscript, SessionTracker, terminalIdOf } from '../src/tracker'

const SID = '11111111-2222-3333-4444-555555555555'
const SID2 = '66666666-7777-8888-9999-000000000000'
const CWD = '/work/demo'

const line = (o: unknown) => `${JSON.stringify(o)}\n`
const toolUse = (msgId: string, id: string, name: string, at: string) =>
  line({ type: 'assistant', timestamp: at, message: { id: msgId, stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 2 }, content: [{ type: 'tool_use', id, name, input: { command: 'secret' } }] } })
const toolResult = (id: string, at: string, isError = false) =>
  line({ type: 'user', timestamp: at, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content: 'secret output' }] } })

const record = (over: Partial<RegistryRecord> = {}): RegistryRecord => ({
  pid: 4242,
  sessionId: SID,
  cwd: CWD,
  startedAt: 1_791_366_405_292,
  procStart: '1343584',
  status: 'busy',
  ...over,
})

describe('tracker helpers', () => {
  it('derives the terminal id from pid and process start, never the title', () => {
    expect(terminalIdOf(record({ name: 'anything' }))).toBe('4242:1343584')
    expect(terminalIdOf(record({ procStart: undefined }))).toBe('4242:1791366405292')
    expect(terminalIdOf({ pid: 7 })).toBe('7:0')
  })

  it('slugs a cwd the way Claude Code names project dirs', () => {
    expect(cwdSlug('D:\\work\\demo')).toBe('D--work-demo')
    expect(cwdSlug('/Users/me/my.app')).toBe('-Users-me-my-app')
  })

  it('finds a transcript by slug first, then by scanning project dirs', async () => {
    const projects = await mkdtemp(path.join(os.tmpdir(), 'ccm-find-'))
    await mkdir(path.join(projects, 'elsewhere'))
    await writeFile(path.join(projects, 'elsewhere', `${SID}.jsonl`), '')
    expect(await findTranscript(projects, SID, CWD)).toBe(path.join(projects, 'elsewhere', `${SID}.jsonl`))

    await mkdir(path.join(projects, cwdSlug(CWD)))
    await writeFile(path.join(projects, cwdSlug(CWD), `${SID}.jsonl`), '')
    expect(await findTranscript(projects, SID, CWD)).toBe(path.join(projects, cwdSlug(CWD), `${SID}.jsonl`))

    expect(await findTranscript(projects, SID2, CWD)).toBeNull()
    expect(await findTranscript(path.join(projects, 'missing'), SID)).toBeNull()
  })
})

describe('SessionTracker', () => {
  let projects: string
  let transcript: string
  let tracker: SessionTracker

  beforeEach(async () => {
    projects = await mkdtemp(path.join(os.tmpdir(), 'ccm-tracker-'))
    await mkdir(path.join(projects, cwdSlug(CWD)))
    transcript = path.join(projects, cwdSlug(CWD), `${SID}.jsonl`)
    await writeFile(transcript, toolUse('m1', 't1', 'Read', '2026-10-07T10:00:00.000Z') + toolResult('t1', '2026-10-07T10:00:01.000Z'))
    tracker = new SessionTracker(terminalIdOf(record()), record(), projects, {}, () => Date.parse('2026-10-07T10:30:00.000Z'))
  })

  it('stays silent during catch-up, then reports new tool calls by agent', async () => {
    expect(await tracker.sync(true)).toEqual([])

    await appendFile(transcript, toolUse('m2', 't2', 'Bash', '2026-10-07T10:00:02.000Z') + toolResult('t2', '2026-10-07T10:00:03.000Z', true))
    const activity = await tracker.sync(false)
    expect(activity).toEqual([
      { kind: 'tool.started', terminalId: tracker.terminalId, agentId: tracker.mainAgentId, at: '2026-10-07T10:00:02.000Z', data: { tool: 'Bash' } },
      { kind: 'tool.failed', terminalId: tracker.terminalId, agentId: tracker.mainAgentId, at: '2026-10-07T10:00:03.000Z', data: { tool: 'Bash' } },
    ])
    expect(JSON.stringify(activity)).not.toContain('secret')
  })

  it('reports nothing for a successful tool result', async () => {
    await tracker.sync(true)
    await appendFile(transcript, toolUse('m2', 't2', 'Grep', '2026-10-07T10:00:02.000Z') + toolResult('t2', '2026-10-07T10:00:03.000Z'))
    expect((await tracker.sync(false)).map((a) => a.kind)).toEqual(['tool.started'])
  })

  it('shows the open tool on the main agent only while working', async () => {
    await appendFile(transcript, toolUse('m2', 't2', 'Bash', '2026-10-07T10:00:02.000Z'))
    await tracker.sync(true)
    const busy = tracker.buildTerminal()
    expect(tracker.buildAgents(busy)[0]).toMatchObject({ role: 'main', status: 'working', currentTool: 'Bash', inputTokens: 20, outputTokens: 4, totalTokens: 24 })

    tracker.setRecord(record({ status: 'idle' }))
    expect(tracker.buildAgents(tracker.buildTerminal())[0]!.currentTool).toBeUndefined()
  })

  it('maps registry status and drops live-only fields once ended', async () => {
    tracker.setRecord(record({ status: 'waiting', waitingFor: 'permission', statusUpdatedAt: 1_791_366_500_000 }))
    await tracker.sync(true)
    expect(tracker.buildTerminal()).toMatchObject({ status: 'waiting', waitingFor: 'permission', title: 'demo', statusSince: new Date(1_791_366_500_000).toISOString() })

    tracker.markEnded('2026-10-07T11:00:00.000Z')
    const ended = tracker.buildTerminal()
    expect(ended).toMatchObject({ status: 'stale', endedAt: '2026-10-07T11:00:00.000Z' })
    expect(ended.waitingFor).toBeUndefined()
    expect(ended.statusSince).toBeUndefined()
  })

  it('forgets transcript state when the registry switches session', async () => {
    await tracker.sync(true)
    expect(tracker.buildAgents(tracker.buildTerminal())[0]!.totalTokens).toBe(12)

    const next = path.join(projects, cwdSlug(CWD), `${SID2}.jsonl`)
    await writeFile(next, toolUse('n1', 'u1', 'Edit', '2026-10-07T10:05:00.000Z'))
    expect(tracker.setRecord(record({ sessionId: SID2 }))).toEqual({ sessionChanged: true })
    expect(tracker.buildAgents(tracker.buildTerminal())[0]!.totalTokens).toBeUndefined()

    await tracker.sync(true)
    expect(tracker.buildAgents(tracker.buildTerminal())[0]).toMatchObject({ totalTokens: 12, currentTool: 'Edit' })
    expect(tracker.setRecord(record({ sessionId: SID2, status: 'idle' }))).toEqual({ sessionChanged: false })
  })

  it('coalesces overlapping syncs without losing appended records', async () => {
    await tracker.sync(true)
    appendFileSync(transcript, toolUse('m2', 't2', 'Bash', '2026-10-07T10:00:02.000Z'))
    const first = tracker.sync(false)
    appendFileSync(transcript, toolUse('m3', 't3', 'Grep', '2026-10-07T10:00:04.000Z'))
    const second = tracker.sync(false)
    const [a, b] = await Promise.all([first, second])
    expect(b).toEqual([])
    expect(a.filter((x) => x.kind === 'tool.started').map((x) => x.data?.tool)).toEqual(['Bash', 'Grep'])
  })

  it('reports subagent tools under the subagent and marks unresolved ones unknown after the session ends', async () => {
    const dir = path.join(projects, cwdSlug(CWD), SID, 'subagents')
    await mkdir(dir, { recursive: true })
    await tracker.sync(true)
    await writeFile(path.join(dir, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'x'.repeat(300), toolUseId: 'toolu_agent', parentAgentId: '../evil' }))
    await writeFile(path.join(dir, 'agent-a1.jsonl'), toolUse('s1', 'g1', 'Grep', '2026-10-07T10:00:05.000Z'))

    const activity = await tracker.sync(false)
    expect(activity.map((a) => [a.kind, a.agentId])).toEqual([
      ['agent.started', 'a1'],
      ['tool.started', 'a1'],
    ])

    let sub = tracker.buildAgents(tracker.buildTerminal())[1]!
    expect(sub).toMatchObject({ id: 'a1', parentId: tracker.mainAgentId, status: 'working', currentTool: 'Grep', type: 'Explore' })
    expect(sub.description).toHaveLength(160)

    tracker.markEnded('2026-10-07T11:00:00.000Z')
    sub = tracker.buildAgents(tracker.buildTerminal())[1]!
    expect(sub.status).toBe('unknown')
    expect(sub.currentTool).toBeUndefined()
  })

  it('records spans during catch-up without queueing them', async () => {
    await tracker.sync(true)
    expect(tracker.toolSpans().find((s) => s.id === 't1')).toMatchObject({ tool: 'Read', outcome: 'ok' })
    expect(tracker.drainSpans()).toEqual([])
  })

  it('queues live span changes once', async () => {
    await tracker.sync(true)
    await appendFile(transcript, toolUse('m2', 't2', 'Grep', '2026-10-07T10:00:02.000Z') + toolResult('t2', '2026-10-07T10:00:03.000Z'))
    await tracker.sync(false)
    const drained = tracker.drainSpans()
    expect(drained.at(-1)).toMatchObject({ id: 't2', tool: 'Grep', outcome: 'ok' })
    expect(tracker.drainSpans()).toEqual([])
  })

  it('records subagent spans under the subagent id', async () => {
    const dir = path.join(projects, cwdSlug(CWD), SID, 'subagents')
    await mkdir(dir, { recursive: true })
    await tracker.sync(true)
    await writeFile(path.join(dir, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'Explore', toolUseId: 'toolu_agent' }))
    await writeFile(path.join(dir, 'agent-a1.jsonl'), toolUse('s1', 'g1', 'Grep', '2026-10-07T10:00:05.000Z'))
    await tracker.sync(false)
    expect(tracker.toolSpans().some((s) => s.agentId === 'a1' && s.tool === 'Grep')).toBe(true)
  })

  it("closes a finished subagent's open spans", async () => {
    const dir = path.join(projects, cwdSlug(CWD), SID, 'subagents')
    await mkdir(dir, { recursive: true })
    await appendFile(transcript, toolUse('m2', 'toolu_fg', 'Agent', '2026-10-07T10:00:02.000Z'))
    await tracker.sync(true)
    await writeFile(path.join(dir, 'agent-f1.meta.json'), JSON.stringify({ agentType: 'Explore', toolUseId: 'toolu_fg', requestShape: 'foreground' }))
    await writeFile(path.join(dir, 'agent-f1.jsonl'), toolUse('s1', 'g1', 'Grep', '2026-10-07T10:00:05.000Z'))
    await tracker.sync(false)
    tracker.drainSpans()
    await appendFile(transcript, toolResult('toolu_fg', '2026-10-07T10:00:09.000Z'))
    await tracker.sync(false)
    expect(tracker.drainSpans()).toContainEqual(expect.objectContaining({ id: 'g1', agentId: 'f1', end: '2026-10-07T10:00:09.000Z', outcome: 'interrupted' }))
    expect(tracker.toolSpans().find((s) => s.id === 'g1')).toMatchObject({ outcome: 'interrupted' })
  })

  it('closes open spans when asked and returns them', async () => {
    await appendFile(transcript, toolUse('m2', 't2', 'Bash', '2026-10-07T10:00:02.000Z'))
    await tracker.sync(true)
    expect(tracker.closeOpenSpans('2026-10-07T10:05:00.000Z')).toEqual([expect.objectContaining({ id: 't2', end: '2026-10-07T10:05:00.000Z', outcome: 'interrupted' })])
  })

  it('keeps spans across a session switch', async () => {
    await tracker.sync(true)
    tracker.setRecord(record({ sessionId: SID2 }))
    expect(tracker.toolSpans().some((s) => s.id === 't1')).toBe(true)
  })
})

// Real-shaped transcripts (key order and record types as written by Claude Code 2.1.x) pin catch-up results.
describe('SessionTracker catch-up on real-shaped transcripts', () => {
  const NOW = Date.parse('2026-10-07T14:00:00.000Z')
  const OLD = new Date('2026-10-07T10:09:30.000Z')
  const tail = { userType: 'external', cwd: CWD, sessionId: SID, version: '2.1.289' }
  const prompt = (at: string, text: string) =>
    line({ parentUuid: 'p', isSidechain: false, type: 'user', message: { role: 'user', content: text }, timestamp: at, ...tail, gitBranch: 'main' })
  const assistant = (msgId: string, at: string, content: unknown[], stop: string | null) =>
    line({
      parentUuid: 'p',
      isSidechain: false,
      message: {
        model: 'claude-opus-4-1',
        id: msgId,
        type: 'message',
        role: 'assistant',
        content,
        stop_reason: stop,
        usage: { input_tokens: 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 1000, output_tokens: 7, cache_creation: { ephemeral_1h_input_tokens: 20 } },
      },
      requestId: 'req',
      type: 'assistant',
      uuid: msgId,
      timestamp: at,
      effort: 'high',
      ...tail,
      gitBranch: 'main',
    })
  const use = (id: string, name: string) => ({ type: 'tool_use', id, name, input: { command: 'secret', description: 'nested "type":"user" text' } })
  const result = (at: string, id: string, opts: { error?: boolean; async?: boolean; size?: number } = {}) =>
    line({
      parentUuid: 'p',
      isSidechain: false,
      promptId: 'pr',
      type: 'user',
      message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content: 'x'.repeat(opts.size ?? 20), is_error: opts.error ?? false }] },
      uuid: 'u',
      timestamp: at,
      toolUseResult: opts.async ? { status: 'async_launched', prompt: 'secret' } : { stdout: 'secret', stderr: '', interrupted: false },
      ...tail,
      gitBranch: 'main',
    })
  const attachment = (at: string, branch: string) =>
    line({
      parentUuid: 'p',
      isSidechain: false,
      attachment: { type: 'hook_success', hookName: 'SessionStart', content: 'escaped {"type":"user","message":{}} inside a string', nested: [{ type: 'text', text: 'y'.repeat(4000) }] },
      type: 'attachment',
      uuid: 'att',
      timestamp: at,
      ...tail,
      gitBranch: branch,
    })
  const notification = (at: string, toolUseId: string, status: string) =>
    line({
      type: 'queue-operation',
      operation: 'enqueue',
      timestamp: at,
      sessionId: SID,
      content: `<task-notification>\n<task-id>t</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<status>${status}</status>\n<summary>done</summary>\n</task-notification>`,
    })
  const userNotification = (at: string, toolUseId: string, status: string) =>
    line({
      parentUuid: 'p',
      isSidechain: true,
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: `<task-notification><tool-use-id>${toolUseId}</tool-use-id><status>${status}</status></task-notification>` }] },
      timestamp: at,
      ...tail,
      gitBranch: 'main',
    })
  const system = (subtype: string, at: string, extra: Record<string, unknown> = {}) =>
    line({ parentUuid: 'p', isSidechain: false, type: 'system', subtype, ...extra, timestamp: at, ...tail, gitBranch: 'main' })

  let projects: string
  let transcript: string
  let subDir: string

  const mainLines = () =>
    line({ type: 'mode', mode: 'normal', sessionId: SID }) +
    line({ type: 'permission-mode', permissionMode: 'default', sessionId: SID }) +
    line({ type: 'file-history-snapshot', messageId: 'm', snapshot: { trackedFileBackups: {} }, isSnapshotUpdate: false }) +
    prompt('2026-10-07T10:00:00.000Z', 'start') +
    assistant('m1', '2026-10-07T10:00:01.000Z', [use('toolu_bg', 'Agent')], 'tool_use') +
    result('2026-10-07T10:00:02.000Z', 'toolu_bg', { async: true }) +
    assistant('m2', '2026-10-07T10:00:03.000Z', [use('toolu_fg', 'Agent')], 'tool_use') +
    attachment('2026-10-07T10:00:04.000Z', 'main') +
    result('2026-10-07T10:05:00.000Z', 'toolu_fg') +
    notification('2026-10-07T10:10:00.000Z', 'toolu_bg', 'completed') +
    system('turn_duration', '2026-10-07T10:10:01.000Z', { durationMs: 600000 }) +
    line({ type: 'ai-title', aiTitle: 'Demo', sessionId: SID }) +
    line({ type: 'last-prompt', lastPrompt: 'start', leafUuid: 'l', sessionId: SID }) +
    system('compact_boundary', '2026-10-07T13:00:00.000Z', { compactMetadata: { trigger: 'auto', preTokens: 150000, postTokens: 30000 } }) +
    assistant('m3', '2026-10-07T13:30:00.000Z', [use('toolu_live', 'Agent')], 'tool_use') +
    result('2026-10-07T13:30:01.000Z', 'toolu_live', { async: true }) +
    assistant('m4', '2026-10-07T13:31:00.000Z', [use('toolu_b1', 'Bash')], 'tool_use') +
    result('2026-10-07T13:31:05.000Z', 'toolu_b1', { error: true }) +
    assistant('m5', '2026-10-07T13:32:00.000Z', [use('toolu_r1', 'Read')], 'tool_use') +
    attachment('2026-10-07T13:33:00.000Z', 'feature/x')

  // ~1.8 MB, so the head lies outside the parsed tail.
  const bgLines = () => {
    let out = prompt('2026-10-07T10:00:02.000Z', 'explore')
    for (let i = 0; i < 12; i++) {
      const sec = String(i).padStart(2, '0')
      out += assistant(`b${i}`, `2026-10-07T10:01:${sec}.000Z`, [use(`toolu_g${i}`, 'Grep')], 'tool_use')
      out += result(`2026-10-07T10:01:${sec}.500Z`, `toolu_g${i}`, { size: 150_000, error: i === 3 })
      if (i === 2) {
        out += assistant('bn', '2026-10-07T10:01:02.600Z', [use('toolu_nested', 'Agent')], 'tool_use')
        out += result('2026-10-07T10:01:02.700Z', 'toolu_nested', { async: true })
      }
      if (i === 5) out += userNotification('2026-10-07T10:01:05.900Z', 'toolu_nested', 'completed')
    }
    out += assistant('bend', '2026-10-07T10:09:00.000Z', [{ type: 'text', text: 'done' }], 'end_turn')
    return out
  }

  const fixture = async () => {
    projects = await mkdtemp(path.join(os.tmpdir(), 'ccm-real-'))
    await mkdir(path.join(projects, cwdSlug(CWD)))
    transcript = path.join(projects, cwdSlug(CWD), `${SID}.jsonl`)
    subDir = path.join(projects, cwdSlug(CWD), SID, 'subagents')
    await mkdir(subDir, { recursive: true })
    await writeFile(transcript, mainLines())
    const meta = (id: string, o: Record<string, unknown>) => writeFile(path.join(subDir, `agent-${id}.meta.json`), JSON.stringify(o))
    await meta('bg', { agentType: 'Explore', description: 'Background explore', toolUseId: 'toolu_bg', spawnDepth: 1 })
    await writeFile(path.join(subDir, 'agent-bg.jsonl'), bgLines())
    await meta('nested', { agentType: 'general-purpose', toolUseId: 'toolu_nested', parentAgentId: 'bg', spawnDepth: 2 })
    await writeFile(
      path.join(subDir, 'agent-nested.jsonl'),
      assistant('n1', '2026-10-07T10:01:03.000Z', [use('toolu_n1', 'Read')], 'tool_use') + result('2026-10-07T10:01:04.000Z', 'toolu_n1'),
    )
    await meta('fg', { agentType: 'Plan', toolUseId: 'toolu_fg' })
    await writeFile(path.join(subDir, 'agent-fg.jsonl'), assistant('f1', '2026-10-07T10:00:05.000Z', [use('toolu_f1', 'Glob')], 'tool_use'))
    await meta('live', { agentType: 'Explore', toolUseId: 'toolu_live' })
    await writeFile(path.join(subDir, 'agent-live.jsonl'), assistant('l1', '2026-10-07T13:40:00.000Z', [use('toolu_l1', 'Grep')], 'tool_use'))
    for (const id of ['bg', 'nested', 'fg']) await utimes(path.join(subDir, `agent-${id}.jsonl`), OLD, OLD)
    return new SessionTracker(terminalIdOf(record()), record(), projects, {}, () => NOW)
  }

  const view = (tracker: SessionTracker) => {
    const terminal = tracker.buildTerminal()
    return { terminal, agents: tracker.buildAgents(terminal).map(({ startedAt: _s, ...a }) => a), spans: tracker.toolSpans() }
  }

  it('builds the same terminal, agents and spans after catch-up', async () => {
    const tracker = await fixture()
    expect(await tracker.sync(true)).toEqual([])
    expect(view(tracker)).toMatchSnapshot()
  })

  it('leaves attachments and an old finished subagent result lines unparsed', async () => {
    const tracker = await fixture()
    const parsed: string[] = []
    const real = JSON.parse
    const spy = vi.spyOn(JSON, 'parse').mockImplementation((text: string, reviver?: Parameters<typeof JSON.parse>[1]) => {
      parsed.push(text)
      return real(text, reviver)
    })
    try {
      await tracker.sync(true)
    } finally {
      spy.mockRestore()
    }
    expect(parsed.some((t) => t.includes('"type":"attachment"'))).toBe(false)
    expect(parsed.some((t) => t.includes('"type":"ai-title"'))).toBe(false)
    expect(parsed.some((t) => t.includes('toolu_g0') && t.includes('tool_result'))).toBe(false)
    expect(parsed.some((t) => t.includes('toolu_nested') && t.includes('tool_result'))).toBe(true)
    expect(parsed.some((t) => t.includes('toolu_g11') && t.includes('tool_result'))).toBe(true)
  })

  it('keeps live spans when an old finished subagent ran more tools than the span cap', async () => {
    const tracker = await fixture()
    const bg = path.join(subDir, 'agent-bg.jsonl')
    let more = ''
    for (let i = 0; i < 2100; i++) more += assistant(`x${i}`, '2026-10-07T10:02:00.000Z', [use(`toolu_x${i}`, 'Read')], 'tool_use') + result('2026-10-07T10:02:01.000Z', `toolu_x${i}`)
    await writeFile(bg, more + bgLines())
    await utimes(bg, OLD, OLD)
    await tracker.sync(true)
    expect(tracker.toolSpans().map((s) => s.id)).toEqual(['toolu_live', 'toolu_b1', 'toolu_r1', 'toolu_l1'])
  })

  it('reads only the files a targeted sync names', async () => {
    const tracker = await fixture()
    await tracker.sync(true)
    const live = path.join(subDir, 'agent-live.jsonl')
    await appendFile(transcript, assistant('m6', '2026-10-07T13:42:00.000Z', [use('toolu_x', 'Edit')], 'tool_use'))
    await appendFile(live, assistant('l2', '2026-10-07T13:42:01.000Z', [use('toolu_l2', 'Glob')], 'tool_use'))
    const tools = (a: { agentId?: string; data?: Record<string, unknown> }[]) => a.map((x) => [x.agentId, x.data?.tool])
    expect(tools(await tracker.sync(false, { files: [live] }))).toEqual([['live', 'Glob']])
    expect(tools(await tracker.sync(false, { files: [transcript] }))).toEqual([[tracker.mainAgentId, 'Edit']])
    expect(await tracker.sync(false, { files: [path.join(subDir, 'unrelated.txt')] })).toEqual([])
  })

  it('leaves finished subagents to the watcher on a skip-resolved sync', async () => {
    const tracker = await fixture()
    await tracker.sync(true)
    const bgTokens = () => tracker.buildAgents(tracker.buildTerminal()).find((a) => a.id === 'bg')?.totalTokens
    const before = bgTokens()
    await appendFile(path.join(subDir, 'agent-bg.jsonl'), assistant('late', '2026-10-07T13:50:00.000Z', [{ type: 'text', text: 'more' }], 'end_turn'))
    await tracker.sync(false, { skipResolved: true })
    expect(bgTokens()).toBe(before)
    await tracker.sync(false)
    expect(bgTokens()).toBe(before! + 127)
  })

  it('reports appended lines live after catch-up', async () => {
    const tracker = await fixture()
    await tracker.sync(true)
    await appendFile(transcript, result('2026-10-07T13:41:00.000Z', 'toolu_r1') + system('turn_duration', '2026-10-07T13:41:01.000Z') + attachment('2026-10-07T13:41:02.000Z', 'feature/y'))
    await appendFile(
      path.join(subDir, 'agent-live.jsonl'),
      result('2026-10-07T13:41:03.000Z', 'toolu_l1', { error: true }) + assistant('l2', '2026-10-07T13:41:04.000Z', [{ type: 'text', text: 'ok' }], 'end_turn'),
    )
    await appendFile(transcript, notification('2026-10-07T13:41:05.000Z', 'toolu_live', 'completed'))
    const activity = await tracker.sync(false)
    expect({ activity, drained: tracker.drainSpans(), ...view(tracker) }).toMatchSnapshot()
  })
})
