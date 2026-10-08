import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CollectorConfig } from '../src/config'
import { Monitor, type MonitorDeps } from '../src/monitor'
import type { ProcessInfo } from '../src/process'
import { MonitorStore } from '../src/store'

const SID = '11111111-2222-3333-4444-555555555555'
const SID2 = '66666666-7777-8888-9999-000000000000'
const PID = 4242
const CWD = 'D:\\work\\demo'
const SLUG = 'D--work-demo'

const line = (o: unknown) => `${JSON.stringify(o)}\n`

function registry(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    pid: PID,
    sessionId: SID,
    cwd: CWD,
    startedAt: 1_791_366_405_292,
    procStart: '134358400013081891',
    version: '2.1.289',
    kind: 'interactive',
    entrypoint: 'cli',
    name: 'demo-1a',
    nameSource: 'derived',
    status: 'busy',
    statusUpdatedAt: 1_791_366_405_292,
    messagingSocketPath: '\\\\.\\pipe\\LOCAL\\cc-msg-secret',
    ...over,
  })
}

describe('Monitor with fixture claude root', () => {
  let root: string
  let store: MonitorStore
  let monitor: Monitor
  let now: number
  let alive: boolean
  let projectDir: string

  const config = (): CollectorConfig => ({
    claudeRoot: root,
    host: '127.0.0.1',
    port: 0,
    toast: false,
    staleTtlMs: 120 * 60_000,
    reconcileMs: 5_000,
    processVerifyMs: 60_000,
    activityLimit: 300,
    batchMs: 1,
    verifyProcesses: false,
    webDist: root,
    dataDir: root,
    devOriginPorts: [],
    statusLineBridge: path.join(root, 'statusline-bridge.mjs'),
    statusLineCommand: 'node statusline-bridge.mjs',
  })

  const deps = (): MonitorDeps => ({ isPidAlive: () => alive, queryProcesses: async () => null, now: () => now })

  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), 'ccm-root-'))
    now = Date.parse('2026-10-07T10:00:00.000Z')
    alive = true
    projectDir = path.join(root, 'projects', SLUG)
    await mkdir(path.join(root, 'sessions'), { recursive: true })
    await mkdir(path.join(projectDir, SID, 'subagents'), { recursive: true })
    await writeFile(path.join(root, 'sessions', `${PID}.json`), registry())
    await writeFile(path.join(root, 'sessions', `${PID}.deadbeef.key`), 'never-read')
    await writeFile(
      path.join(projectDir, `${SID}.jsonl`),
      line({ type: 'assistant', timestamp: '2026-10-07T09:59:00.000Z', message: { id: 'm1', model: 'claude-opus-5-5', stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 20 }, content: [{ type: 'tool_use', id: 'toolu_agent', name: 'Agent', input: { prompt: 'secret prompt' } }] } }) +
        line({ type: 'user', timestamp: '2026-10-07T09:59:01.000Z', toolUseResult: { status: 'async_launched', prompt: 'secret prompt' }, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_agent' }] } }) +
        line({ type: 'assistant', timestamp: '2026-10-07T09:59:02.000Z', message: { id: 'm2', stop_reason: 'tool_use', usage: { input_tokens: 50, output_tokens: 5 }, content: [{ type: 'tool_use', id: 'toolu_bash', name: 'Bash', input: { command: 'echo secret' } }] } }),
    )
    await writeFile(
      path.join(projectDir, SID, 'subagents', 'agent-a1.meta.json'),
      JSON.stringify({ agentType: 'Explore', description: 'Find ads code', toolUseId: 'toolu_agent', spawnDepth: 1, requestShape: 'background' }),
    )
    await writeFile(
      path.join(projectDir, SID, 'subagents', 'agent-a1.jsonl'),
      line({ type: 'assistant', isSidechain: true, timestamp: '2026-10-07T09:59:03.000Z', message: { id: 's1', stop_reason: 'tool_use', usage: { input_tokens: 7, output_tokens: 2 }, content: [{ type: 'tool_use', id: 'toolu_grep', name: 'Grep' }] } }),
    )
    store = new MonitorStore({ activityLimit: 300, batchMs: 1 })
    monitor = new Monitor(config(), store, deps())
    await monitor.start({ watch: false })
  })

  it('builds terminal, main agent and subagent from fixtures', () => {
    const snap = store.snapshot()
    expect(snap.terminals).toHaveLength(1)
    const t = snap.terminals[0]!
    expect(t).toMatchObject({ processId: PID, title: 'demo-1a', status: 'working', kind: 'interactive', claudeSessionId: SID, cwd: CWD })
    expect(t.id).toBe(`${PID}:134358400013081891`)

    const main = snap.agents.find((a) => a.role === 'main')!
    expect(main).toMatchObject({ status: 'working', currentTool: 'Bash', inputTokens: 150, outputTokens: 25, totalTokens: 175, model: 'claude-opus-5-5' })

    const sub = snap.agents.find((a) => a.role === 'subagent')!
    expect(sub).toMatchObject({ id: 'a1', parentId: main.id, status: 'working', type: 'Explore', description: 'Find ads code', currentTool: 'Grep', totalTokens: 9 })

    expect(snap.activity).toHaveLength(0)
    const json = JSON.stringify(snap)
    expect(json).not.toContain('secret')
    expect(json).not.toContain('pipe')
  })

  it('applies a dashboard alias and clears it again', () => {
    const id = store.snapshot().terminals[0]!.id
    expect(monitor.setAlias(id, '  Ads work  ')).toBe(true)
    let snap = store.snapshot()
    expect(snap.terminals[0]).toMatchObject({ title: 'demo-1a', alias: 'Ads work' })
    expect(snap.activity.at(-1)).toMatchObject({ kind: 'terminal.renamed', data: { from: 'demo-1a', to: 'Ads work' } })
    expect(monitor.setAlias(id, 'Ads work')).toBe(false)
    expect(monitor.setAlias('nope', 'x')).toBe(false)
    expect(monitor.setAlias(id, '   ')).toBe(true)
    snap = store.snapshot()
    expect(snap.terminals[0]!.alias).toBeUndefined()
  })

  it('prefers the status line window, then the model catalog, over the 200k guess', async () => {
    const mainOf = () => store.snapshot().agents.find((a) => a.role === 'main')!
    expect(mainOf().contextWindow).toBe(200_000)

    const doc = { surfaces: { cc: { model_selector_config: [{ models: [{ id: 'claude-opus-5-5', runtime: { max_input_tokens: 1_000_000 } }] }] } } }
    await mkdir(path.join(root, 'cache', 'model-catalog'), { recursive: true })
    await writeFile(
      path.join(root, 'cache', 'model-catalog', 'published-x.json'),
      JSON.stringify({ documentBytes: Buffer.from(JSON.stringify(doc)).toString('base64') }),
    )
    monitor.stop()
    store = new MonitorStore({ activityLimit: 300, batchMs: 1 })
    monitor = new Monitor(config(), store, deps())
    await monitor.start({ watch: false })
    expect(mainOf().contextWindow).toBe(1_000_000)

    await mkdir(path.join(root, 'statusline'), { recursive: true })
    await writeFile(path.join(root, 'statusline', `${SID}.json`), JSON.stringify({ v: 1, sessionId: SID, at: '2026-10-07T10:00:00.000Z', contextWindow: 500_000 }))
    await monitor.pollExtras()
    expect(mainOf().contextWindow).toBe(500_000)
    expect(store.snapshot().agents.find((a) => a.role === 'subagent')!.contextWindow).not.toBe(500_000)
  })

  it('reports context, permission mode, branch and compaction without content', async () => {
    let main = store.snapshot().agents.find((a) => a.role === 'main')!
    expect(main).toMatchObject({ contextTokens: 50, contextWindow: 200_000 })
    await appendFile(
      path.join(projectDir, `${SID}.jsonl`),
      line({ type: 'permission-mode', permissionMode: 'default', sessionId: SID }) +
        line({ type: 'assistant', gitBranch: 'feat/x', timestamp: '2026-10-07T10:00:01.000Z', message: { id: 'm3', model: 'claude-opus-5-5', usage: { input_tokens: 10, cache_creation_input_tokens: 20, cache_read_input_tokens: 250_000, output_tokens: 1 }, content: [] } }),
    )
    await monitor.reconcile()
    main = store.getAgent(main.id)!
    expect(main).toMatchObject({ contextTokens: 250_030, contextWindow: 1_000_000 })
    expect(store.snapshot().terminals[0]).toMatchObject({ permissionMode: 'default', gitBranch: 'feat/x' })

    await appendFile(
      path.join(projectDir, `${SID}.jsonl`),
      line({ type: 'permission-mode', permissionMode: 'bypassPermissions', sessionId: SID }) +
        line({ type: 'system', subtype: 'compact_boundary', content: 'secret summary', timestamp: '2026-10-07T10:00:02.000Z', compactMetadata: { trigger: 'auto', preTokens: 250_030, postTokens: 12_000, preservedSegment: 'secret' } }),
    )
    await monitor.reconcile()
    expect(store.getAgent(main.id)!.contextTokens).toBe(12_000)
    expect(store.snapshot().terminals[0]).toMatchObject({ permissionMode: 'bypassPermissions', compactions: 1 })
    const kinds = store.snapshot().activity.map((a) => a.kind)
    expect(kinds).toContain('terminal.mode')
    expect(store.snapshot().activity.find((a) => a.kind === 'terminal.compacted')).toMatchObject({ data: { trigger: 'auto', preTokens: 250_030, postTokens: 12_000 } })
    expect(JSON.stringify(store.snapshot())).not.toContain('secret')
  })

  it('stars a session dir and launches only starred dirs', async () => {
    const launched: string[] = []
    store = new MonitorStore({ activityLimit: 300, batchMs: 1 })
    monitor = new Monitor(config(), store, { ...deps(), launch: async (dir, mode) => void launched.push(`${dir}|${mode}`) })
    await monitor.start({ watch: false })
    const id = store.snapshot().terminals[0]!.id
    expect(await monitor.openFavorite(CWD, 'new')).toBe(false)
    expect(monitor.toggleFavorite(id)).toBe(true)
    expect(store.snapshot().favorites).toMatchObject([{ dir: path.resolve(CWD), label: 'demo-1a' }])
    expect(await monitor.openFavorite(CWD.toUpperCase(), 'continue')).toBe(true)
    expect(launched).toEqual([`${path.resolve(CWD)}|continue`])
    expect(store.snapshot().activity.at(-1)).toMatchObject({ kind: 'launch.started', data: { title: 'demo-1a', mode: 'continue' } })
    expect(monitor.renameFavorite(CWD, '  Ads\napp ')).toBe(true)
    expect(store.snapshot().favorites).toMatchObject([{ label: 'Ads app' }])
    expect(monitor.renameFavorite(CWD, null)).toBe(true)
    expect(store.snapshot().favorites).toMatchObject([{ label: path.basename(CWD) }])
    expect(monitor.renameFavorite('Z:/nope', 'x')).toBe(false)
    expect(monitor.removeFavorite(CWD)).toBe(true)
    expect(store.snapshot().favorites).toEqual([])
  })

  it('records an ended session in history with token totals only', async () => {
    const sessions: string[] = []
    store.subscribe((m) => {
      for (const e of m.events) if (e.type === 'history.added') sessions.push(e.payload.title)
    })
    alive = false
    now += 60_000
    await monitor.reconcile()
    store.flush()
    expect(sessions).toEqual(['demo-1a'])
    monitor.sendHistory()
    store.flush()
    const snapJson = JSON.stringify(store.snapshot())
    expect(snapJson).not.toContain('secret')
  })

  it('raises the window of a live session by its own pid only', async () => {
    const pids: number[] = []
    store = new MonitorStore({ activityLimit: 300, batchMs: 1 })
    monitor = new Monitor(config(), store, { ...deps(), focusWindow: async (pid) => (pids.push(pid), 'ok') })
    await monitor.start({ watch: false })
    const results: string[] = []
    store.subscribe((m) => {
      for (const e of m.events) if (e.type === 'terminal.focusResult') results.push(`${e.payload.terminalId}|${e.payload.result}`)
    })
    const id = store.snapshot().terminals[0]!.id
    await Promise.all([monitor.focusWindow(id), monitor.focusWindow('nope')])
    store.flush()
    expect(pids).toEqual([PID])
    expect(results).toEqual([`${id}|ok`, 'nope|notFound'])
  })

  it('opens only the tracked cwd and answers the asking socket', async () => {
    const opened: string[] = []
    store = new MonitorStore({ activityLimit: 300, batchMs: 1 })
    monitor = new Monitor(config(), store, { ...deps(), openFolder: async (dir, app) => (opened.push(`${app}:${dir}`), 'ok') })
    await monitor.start({ watch: false })
    const id = store.snapshot().terminals[0]!.id
    const replies: string[] = []
    const reply = (e: { type: string; payload: unknown }) => replies.push(`${e.type}:${JSON.stringify(e.payload)}`)
    await monitor.openFolder(id, 'vscode', reply)
    await monitor.openFolder('nope', 'explorer', reply)
    expect(opened).toEqual([`vscode:${CWD}`])
    expect(replies[0]).toContain('"result":"ok"')
    expect(replies[1]).toContain('"result":"notFound"')
    expect(monitor.diagnostics().sessions.live).toBe(1)
  })

  it('publishes the uncommitted diff once a turn settles', async () => {
    const calls: string[] = []
    store = new MonitorStore({ activityLimit: 300, batchMs: 1 })
    const stat = { files: 3, insertions: 10, deletions: 2, untracked: 1, at: new Date(0).toISOString() }
    monitor = new Monitor(config(), store, { ...deps(), diffDelayMs: 1, diffStat: async (cwd) => (calls.push(cwd), stat) })
    await monitor.start({ watch: false })
    await vi.waitFor(() => expect(store.snapshot().terminals[0]?.diff?.insertions).toBe(10))
    expect(calls).toEqual([CWD])
  })

  it('adds a favorite by path only for an existing local directory', async () => {
    const rejected: string[] = []
    store.subscribe((m) => {
      for (const e of m.events) if (e.type === 'favorite.rejected') rejected.push(e.payload.reason)
    })
    const dir = os.tmpdir()
    expect(await monitor.addFavorite(`"${dir}"`, ' Temp ')).toBe(true)
    expect(store.snapshot().favorites).toMatchObject([{ dir: path.resolve(dir), label: 'Temp' }])
    expect(await monitor.addFavorite(dir, null)).toBe(false)
    expect(await monitor.addFavorite('relative/dir', null)).toBe(false)
    expect(await monitor.addFavorite('\\\\server\\share', null)).toBe(false)
    expect(await monitor.addFavorite(path.join(dir, 'ccm-missing-dir-xyz'), null)).toBe(false)
    await new Promise((r) => setTimeout(r, 20))
    expect(rejected).toEqual(['exists', 'invalid', 'invalid', 'notFound'])
  })

  it('completes subagent from task-notification and records activity', async () => {
    await appendFile(
      path.join(projectDir, `${SID}.jsonl`),
      line({ type: 'queue-operation', operation: 'enqueue', timestamp: '2026-10-07T10:00:05.000Z', content: '<task-notification><task-id>a1</task-id><tool-use-id>toolu_agent</tool-use-id><status>completed</status><summary>secret</summary></task-notification>' }),
    )
    await monitor.reconcile()
    const sub = store.getAgent('a1')!
    expect(sub.status).toBe('completed')
    expect(sub.completedAt).toBe('2026-10-07T10:00:05.000Z')
    expect(sub.currentTool).toBeUndefined()
    expect(store.snapshot().activity.map((a) => a.kind)).toContain('agent.completed')
  })

  it('links nested subagent to its parent and resolves it from the parent transcript', async () => {
    const dir = path.join(projectDir, SID, 'subagents')
    await appendFile(
      path.join(dir, 'agent-a1.jsonl'),
      line({ type: 'assistant', isSidechain: true, timestamp: '2026-10-07T09:59:04.000Z', message: { id: 's2', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_nested', name: 'Agent', input: { prompt: 'secret' } }] } }) +
        line({ type: 'user', isSidechain: true, timestamp: '2026-10-07T09:59:05.000Z', toolUseResult: { status: 'async_launched' }, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_nested' }] } }),
    )
    await writeFile(path.join(dir, 'agent-a2.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'nested', toolUseId: 'toolu_nested', parentAgentId: 'a1', spawnDepth: 2, requestShape: 'background' }))
    await writeFile(path.join(dir, 'agent-a2.jsonl'), '')
    await monitor.reconcile()
    expect(store.getAgent('a2')).toMatchObject({ parentId: 'a1', spawnDepth: 2, status: 'working' })

    await appendFile(
      path.join(dir, 'agent-a1.jsonl'),
      line({ type: 'user', isSidechain: true, timestamp: '2026-10-07T10:00:06.000Z', message: { content: '<task-notification><task-id>a2</task-id><tool-use-id>toolu_nested</tool-use-id><status>failed</status><summary>secret</summary></task-notification>' } }),
    )
    await monitor.reconcile()
    expect(store.getAgent('a2')).toMatchObject({ status: 'error', completedAt: '2026-10-07T10:00:06.000Z' })
    expect(store.getAgent('a1')?.status).toBe('working')
  })

  it('falls back to main agent when parentAgentId is unknown', async () => {
    const dir = path.join(projectDir, SID, 'subagents')
    await writeFile(path.join(dir, 'agent-a3.meta.json'), JSON.stringify({ agentType: 'Plan', toolUseId: 'toolu_x', parentAgentId: 'gone', spawnDepth: 2 }))
    await writeFile(path.join(dir, 'agent-a3.jsonl'), '')
    await monitor.reconcile()
    expect(store.getAgent('a3')?.parentId).toBe(`${store.snapshot().terminals[0]!.id}:main`)
  })

  it('completes foreground subagent from its synchronous tool result', async () => {
    const dir = path.join(projectDir, SID, 'subagents')
    await appendFile(
      path.join(projectDir, `${SID}.jsonl`),
      line({ type: 'assistant', timestamp: '2026-10-07T10:00:01.000Z', message: { id: 'm3', stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'toolu_fg', name: 'Agent', input: {} }] } }),
    )
    await writeFile(path.join(dir, 'agent-f1.meta.json'), JSON.stringify({ agentType: 'Explore', toolUseId: 'toolu_fg', spawnDepth: 1, requestShape: 'foreground' }))
    await writeFile(path.join(dir, 'agent-f1.jsonl'), '')
    await monitor.reconcile()
    expect(store.getAgent('f1')?.status).toBe('working')
    await appendFile(
      path.join(projectDir, `${SID}.jsonl`),
      line({ type: 'user', timestamp: '2026-10-07T10:00:09.000Z', toolUseResult: { status: 'completed' }, message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_fg' }] } }),
    )
    await monitor.reconcile()
    expect(store.getAgent('f1')).toMatchObject({ status: 'completed', completedAt: '2026-10-07T10:00:09.000Z' })
  })

  it('tracks rename, waiting, /clear, end and stale removal', async () => {
    const file = path.join(root, 'sessions', `${PID}.json`)
    const tid = store.snapshot().terminals[0]!.id

    await writeFile(file, registry({ name: 'Android Ads', nameSource: 'user', status: 'waiting', waitingFor: 'permission prompt' }))
    await monitor.reconcile()
    expect(store.getTerminal(tid)).toMatchObject({ title: 'Android Ads', status: 'waiting', waitingFor: 'permission prompt' })
    expect(store.getAgent(`${tid}:main`)?.status).toBe('waiting')

    await writeFile(file, registry({ name: 'Android Ads', status: 'shell' }))
    await monitor.reconcile()
    expect(store.getTerminal(tid)).toMatchObject({ status: 'idle', backgroundShell: true })
    expect(store.getTerminal(tid)?.waitingFor).toBeUndefined()

    await writeFile(path.join(projectDir, `${SID2}.jsonl`), '')
    await writeFile(file, registry({ name: 'Android Ads', sessionId: SID2, status: 'idle' }))
    await monitor.reconcile()
    expect(store.getTerminal(tid)?.claudeSessionId).toBe(SID2)
    expect(store.getAgent('a1')).toBeUndefined()
    expect(store.agentsOf(tid)).toHaveLength(1)

    await writeFile(file, '{"pid":42')
    await monitor.reconcile()
    expect(store.getTerminal(tid)?.status).toBe('idle')

    await rm(file)
    await monitor.reconcile()
    expect(store.getTerminal(tid)).toMatchObject({ status: 'stale', endedAt: '2026-10-07T10:00:00.000Z' })
    expect(store.getAgent(`${tid}:main`)?.status).toBe('completed')

    now += 119 * 60_000
    await monitor.reconcile()
    expect(store.getTerminal(tid)).toBeDefined()
    now += 2 * 60_000
    await monitor.reconcile()
    expect(store.getTerminal(tid)).toBeUndefined()
    expect(store.agentsOf(tid)).toHaveLength(0)

    const kinds = store.snapshot().activity.map((a) => a.kind)
    expect(kinds).toEqual(expect.arrayContaining(['terminal.renamed', 'terminal.status', 'session.cleared', 'terminal.ended']))
  })

  it('marks dead pid as stale and leaves running subagent unknown', async () => {
    alive = false
    await monitor.reconcile()
    const t = store.snapshot().terminals[0]!
    expect(t.status).toBe('stale')
    expect(store.getAgent('a1')?.status).toBe('unknown')
  })

  it('verifies a macOS/Linux session by ps lstart and rejects a reused pid', async () => {
    const lstart = 'Thu Oct  8 03:01:22 2026'
    await writeFile(path.join(root, 'sessions', `${PID}.json`), registry({ procStart: lstart }))
    const terminalsWith = async (start: string) => {
      const s = new MonitorStore({ activityLimit: 300, batchMs: 1 })
      const queryProcesses = async (pids: number[]) => {
        const info = new Map<number, ProcessInfo>()
        for (const pid of pids) info.set(pid, { pid, start: { kind: 'lstart', value: start }, parentPid: 1, parentName: 'zsh' })
        return info
      }
      const m = new Monitor({ ...config(), verifyProcesses: true }, s, { ...deps(), queryProcesses })
      await m.start({ watch: false })
      m.stop()
      return s.snapshot().terminals
    }
    expect(await terminalsWith('Thu Oct 8 03:01:22 2026')).toMatchObject([{ processId: PID }])
    expect(await terminalsWith('Fri Oct  9 07:00:00 2026')).toHaveLength(0)
  })

  it('dismisses ended sessions on request but never live ones', async () => {
    const tid = store.snapshot().terminals[0]!.id
    expect(monitor.dismissEnded(tid)).toBe(0)
    expect(monitor.dismissEnded()).toBe(0)
    alive = false
    await monitor.reconcile()
    expect(monitor.dismissEnded('other')).toBe(0)
    expect(monitor.dismissEnded()).toBe(1)
    expect(store.getTerminal(tid)).toBeUndefined()
    expect(store.agentsOf(tid)).toHaveLength(0)
  })
})
