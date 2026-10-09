import { appendFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
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
    tracker = new SessionTracker(terminalIdOf(record()), record(), projects)
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
    await appendFile(transcript, toolUse('m2', 't2', 'Bash', '2026-10-07T10:00:02.000Z'))
    const first = tracker.sync(false)
    await appendFile(transcript, toolUse('m3', 't3', 'Grep', '2026-10-07T10:00:04.000Z'))
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
})
