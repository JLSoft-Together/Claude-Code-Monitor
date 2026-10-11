import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { claudeTargetFor, callerOf, matchProcesses, normalizeDir, type ClaudeTarget, type ThreadKey } from '../src/codex/link'
import { CodexMonitor, parseThreadNames } from '../src/codex/monitor'
import { modeOfCommandLine, parsePsAll, parseWindowsProcesses, unixCodexProcesses, type CodexProcess } from '../src/codex/processes'
import { readSessionMeta, RolloutTailer } from '../src/codex/reader'
import { classifyLine, CodexThreadState, extractCodexSignals, modeOf } from '../src/codex/rollout'
import { MonitorStore } from '../src/store'
import { extractSignals, TranscriptState } from '../src/transcript'

const TID = '01a125e6-f212-7711-a885-025fd33ab05a'
const T0 = Date.parse('2026-10-11T07:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()
const rec = (type: string, payload: Record<string, unknown>, at = T0) => ({ timestamp: iso(at), ordinal: 0, type, payload })
const line = (o: unknown) => `${JSON.stringify(o)}\n`
const usage = (input: number, cached: number, output: number) => ({ input_tokens: input, cached_input_tokens: cached, output_tokens: output, reasoning_output_tokens: 0, total_tokens: input + output })

const meta = (over: Record<string, unknown> = {}, at = T0) =>
  rec('session_meta', { id: TID, session_id: TID, timestamp: iso(at), cwd: 'C:\\Temp\\art-hero-x1', originator: 'codex_exec', cli_version: '0.162.0', source: 'exec', base_instructions: 'secret '.repeat(50), ...over }, at)
const started = (at = T0) => rec('event_msg', { type: 'task_started', turn_id: 't1', model_context_window: 258400 }, at)
const context = (at = T0) => rec('turn_context', { turn_id: 't1', model: 'gpt-6-luna', effort: 'medium', approval_policy: 'never' }, at)
const call = (id: string, at = T0) => rec('response_item', { type: 'custom_tool_call', call_id: id, name: 'exec', input: 'secret command' }, at)
const output = (id: string, at = T0) => rec('response_item', { type: 'custom_tool_call_output', call_id: id, output: 'secret output' }, at)
const tokens = (at = T0, used = 7) =>
  rec('event_msg', {
    type: 'token_count',
    info: { total_token_usage: usage(18000, 12000, 2000), last_token_usage: usage(18000, 12000, 2000), model_context_window: 258400 },
    rate_limits: { limit_id: 'codex', primary: { used_percent: used, window_minutes: 300, resets_at: 1_791_650_000 }, secondary: { used_percent: 12, window_minutes: 10080, resets_at: 1_792_000_000 }, plan_type: 'plus' },
  }, at)
const complete = (at = T0) => rec('event_msg', { type: 'task_complete', turn_id: 't1', last_agent_message: 'secret answer' }, at)
const message = (at = T0) => rec('response_item', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'secret prompt '.repeat(40) }] }, at)

describe('codex rollout parsing', () => {
  it('classifies lines from their head only', () => {
    const head = (o: unknown) => JSON.stringify(o).slice(0, 256)
    expect(classifyLine(head(meta()))).toBe('parse')
    expect(classifyLine(head(started()))).toBe('parse')
    expect(classifyLine(head(message()))).toBe('skip')
    expect(classifyLine(head(rec('world_state', { full: true })))).toBe('skip')
    expect(classifyLine(head(rec('event_msg', { type: 'item_completed' })))).toBe('skip')
    expect(classifyLine(head(rec('compacted', { message: 'x' })))).toBe('compacted')
    expect(classifyLine('{"something":"else"}')).toBe('parse')
  })

  it('folds a turn into thread state without reading content', () => {
    const state = new CodexThreadState()
    for (const r of [meta(), started(), context(), call('c1', T0 + 1000), tokens(T0 + 2000)]) state.apply(extractCodexSignals(r))
    expect(state.meta?.id).toBe(TID)
    expect(state).toMatchObject({ model: 'gpt-6-luna', effort: 'medium', turnOpen: true, contextWindow: 258400 })
    expect(state.currentTool()).toBe('exec')
    expect(state.total).toEqual({ input: 18000, cached: 12000, output: 2000, total: 20000 })
    expect(state.limits).toMatchObject({ plan: 'plus', fiveHour: { usedPct: 7 }, sevenDay: { usedPct: 12 } })
    expect(state.limits?.fiveHour?.resetsAt).toBe(new Date(1_791_650_000_000).toISOString())
    for (const r of [output('c1'), complete(T0 + 3000)]) state.apply(extractCodexSignals(r))
    expect(state.turnOpen).toBe(false)
    expect(state.currentTool()).toBeUndefined()
    expect(JSON.stringify(state)).not.toContain('secret')
  })

  it('ignores rate limits of other limit ids and maps modes', () => {
    const other = rec('event_msg', { type: 'token_count', rate_limits: { limit_id: 'other', primary: { used_percent: 90, window_minutes: 300 } } })
    expect(extractCodexSignals(other).some((s) => s.k === 'limits')).toBe(false)
    const m = (over: Record<string, unknown>) => modeOf(extractCodexSignals(meta(over)).find((s) => s.k === 'meta')!.meta as never)
    expect(m({})).toBe('exec')
    expect(m({ source: 'cli', originator: 'codex-tui' })).toBe('tui')
    expect(m({ source: 'vscode', originator: 'Claude Code' })).toBe('plugin')
    expect(m({ source: 'vscode', originator: 'Codex Desktop' })).toBeNull()
    expect(m({ source: { subagent: { thread_spawn: { parent_thread_id: 'p1', depth: 1 } } } })).toBe('subagent')
  })
})

describe('codex rollout reader', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ccm-codex-read-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('tails across partial lines, skips big content lines and counts compactions once', async () => {
    const file = path.join(dir, `rollout-x-${TID}.jsonl`)
    await writeFile(file, line(meta()) + line(started()) + line(message()))
    const tailer = new RolloutTailer(file)
    const state = new CodexThreadState()
    for (const r of await tailer.read()) state.apply(extractCodexSignals(r))
    const big = JSON.stringify(rec('compacted', { message: 'z'.repeat(300_000) }))
    await appendFile(file, big.slice(0, 1000))
    for (const r of await tailer.read()) state.apply(extractCodexSignals(r))
    await appendFile(file, `${big.slice(1000)}\n${JSON.stringify(tokens()).slice(0, 40)}`)
    for (const r of await tailer.read()) state.apply(extractCodexSignals(r))
    await appendFile(file, `${JSON.stringify(tokens()).slice(40)}\n`)
    for (const r of await tailer.read()) state.apply(extractCodexSignals(r))
    expect(state.compactions).toBe(1)
    expect(state.turnOpen).toBe(true)
    expect(state.total?.output).toBe(2000)
  })

  it('starts near the end of a large file and drops the cut line', async () => {
    const file = path.join(dir, `rollout-y-${TID}.jsonl`)
    await writeFile(file, line(meta()) + line(message()).repeat(200) + line(started()) + line(tokens()))
    const records = await new RolloutTailer(file, line(started()).length + line(tokens()).length + 50).read()
    const state = new CodexThreadState()
    for (const r of records) state.apply(extractCodexSignals(r))
    expect(state.total?.input).toBe(18000)
    expect(state.meta).toBeUndefined()
  })

  it('reads the meta line, also when it has no newline yet', async () => {
    const file = path.join(dir, `rollout-z-${TID}.jsonl`)
    await writeFile(file, line(meta()))
    expect(await readSessionMeta(file)).toMatchObject({ id: TID, source: 'exec', originator: 'codex_exec', cwd: 'C:\\Temp\\art-hero-x1', version: '0.162.0' })
    await writeFile(file, JSON.stringify(meta()))
    expect((await readSessionMeta(file))?.cwd).toBe('C:\\Temp\\art-hero-x1')
  })
})

describe('codex processes', () => {
  it('reads the subcommand and resume id, nothing else', () => {
    const exe = '"C:\\npm\\codex.exe"'
    expect(modeOfCommandLine(`${exe} exec -s read-only -i logo.png -`)).toEqual({ mode: 'exec', resumeId: undefined })
    expect(modeOfCommandLine(`${exe} -m gpt-6 exec resume ${TID}`)).toEqual({ mode: 'exec', resumeId: TID })
    expect(modeOfCommandLine(`${exe} resume ${TID}`)).toEqual({ mode: 'tui', resumeId: TID })
    expect(modeOfCommandLine(`${exe} "resume my work"`)).toEqual({ mode: 'tui' })
    expect(modeOfCommandLine(`${exe} app-server`)).toEqual({ mode: 'app-server' })
    expect(modeOfCommandLine(`${exe} login`)).toEqual({ mode: 'other' })
    expect(modeOfCommandLine(exe)).toEqual({ mode: 'tui' })
  })

  it('parses the Windows query and marks shell-cut chains as orphans', () => {
    const ft = (ms: number) => String((BigInt(ms) + 11_644_473_600_000n) * 10_000n)
    const out = JSON.stringify([
      { pid: 10, ft: ft(T0), anc: [9, 8, 7], cut: false, top: 'claude.exe', cmd: 'codex.exe exec -' },
      { pid: 11, ft: ft(T0), anc: [10], cut: false, top: 'codex.exe', cmd: 'codex.exe sandbox' },
      { pid: 12, ft: ft(T0 + 5), anc: 20, cut: true, top: 'timeout.exe', cmd: 'codex.exe exec -' },
      { pid: 13, ft: ft(T0), anc: [30, 31], cut: true, top: 'WindowsTerminal.exe', cmd: 'codex.exe' },
    ])
    const procs = parseWindowsProcesses(out)
    expect(procs.map((p) => p.pid)).toEqual([10, 12, 13])
    expect(procs[0]).toMatchObject({ start: T0, mode: 'exec', ancestors: [9, 8, 7], orphan: false })
    expect(procs[1]).toMatchObject({ ancestors: [20], orphan: true })
    expect(procs[2]).toMatchObject({ mode: 'tui', orphan: false })
  })

  it('parses ps output with ancestry', () => {
    const all = parsePsAll(
      [
        '    1     0 Sat Oct 10 13:00:00 2026 /sbin/launchd',
        '  100     1 Sat Oct 10 13:00:01 2026 /Applications/Claude.app/claude',
        '  200   100 Sat Oct 10 13:00:02 2026 -zsh',
        '  300   200 Sat Oct 10 13:00:03 2026 /opt/codex/codex',
        '  400     1 Sat Oct 10 13:00:04 2026 node',
        '  401   400 Sat Oct 10 13:00:05 2026 codex',
      ].join('\n'),
    )
    const procs = unixCodexProcesses(all, `  300 /opt/codex/codex exec -\n  401 codex resume ${TID}\n`)
    expect(procs.find((p) => p.pid === 300)).toMatchObject({ mode: 'exec', ancestors: [200, 100], orphan: false, start: Date.parse('2026-10-10T13:00:03Z') })
    expect(procs.find((p) => p.pid === 401)).toMatchObject({ mode: 'tui', resumeId: TID, ancestors: [400], orphan: true })
  })
})

describe('codex linking', () => {
  const proc = (pid: number, start: number, over: Partial<CodexProcess> = {}): CodexProcess => ({ pid, start, mode: 'exec', ancestors: [], orphan: false, ...over })
  const thread = (id: string, createdAt: number, over: Partial<ThreadKey> = {}): ThreadKey => ({ id, createdAt, mode: 'exec', ...over })

  it('pairs threads with the process that started just before them', () => {
    const m = matchProcesses(
      [thread('a', T0 + 300), thread('b', T0 + 1_200), thread('r', T0 - 99_000_000, { mode: 'tui' }), thread('p', T0, { mode: 'plugin' }), thread('s', T0 + 5_000, { mode: 'subagent', parentThreadId: 'a' })],
      [proc(1, T0 + 1_000), proc(2, T0), proc(3, T0 + 2_000, { mode: 'tui', resumeId: 'r' }), proc(4, T0 - 10_000, { mode: 'app-server' })],
    )
    expect(m.get('a')?.pid).toBe(2)
    expect(m.get('b')?.pid).toBe(1)
    expect(m.get('r')?.pid).toBe(3)
    expect(m.has('p')).toBe(false)
    expect(m.get('s')?.pid).toBe(2)
  })

  it('gives a late TUI thread to the only TUI process', () => {
    const m = matchProcesses([thread('old', T0 + 100, { mode: 'tui', pid: 5, start: T0 }), thread('new', T0 + 3_600_000, { mode: 'tui' })], [proc(5, T0, { mode: 'tui' })])
    expect(m.get('old')?.pid).toBe(5)
    expect(m.get('new')?.pid).toBe(5)
  })

  it('links by ancestry, by the latest codex shell call when the chain is cut, and plugin threads by cwd', () => {
    const targets: ClaudeTarget[] = [
      { terminalId: 'c1', pid: 100, cwd: 'D:\\work\\demo', mainAgentId: 'c1:main', ended: false, codexCalls: [{ agentId: 'sub-a', at: iso(T0 - 2_000) }] },
      { terminalId: 'c2', pid: 200, cwd: 'D:\\work\\other', mainAgentId: 'c2:main', ended: false, codexCalls: [{ agentId: 'c2:main', at: iso(T0 - 30_000) }] },
    ]
    const exec = { mode: 'exec' as const, cwd: 'C:\\Temp\\x', createdAt: T0 }
    expect(claudeTargetFor(proc(9, T0, { ancestors: [50, 200] }), exec, targets)?.terminalId).toBe('c2')
    expect(claudeTargetFor(proc(9, T0, { ancestors: [50], orphan: true }), exec, targets)?.terminalId).toBe('c1')
    expect(claudeTargetFor(undefined, exec, targets)?.terminalId).toBe('c1')
    expect(claudeTargetFor(proc(9, T0, { ancestors: [50] }), exec, targets)).toBeUndefined()
    expect(claudeTargetFor(undefined, { mode: 'plugin', cwd: 'd:/work/other/', createdAt: T0 }, targets, 'win32')?.terminalId).toBe('c2')
    expect(callerOf(targets[0]!, T0)).toBe('sub-a')
    expect(callerOf(targets[0]!, T0 + 3_600_000)).toBe('c1:main')
    expect(normalizeDir('\\\\?\\C:\\Temp\\X\\', 'win32')).toBe('c:\\temp\\x')
  })
})

describe('transcript codex calls', () => {
  it('flags shell calls that mention codex without keeping the command', () => {
    const signals = extractSignals({
      type: 'assistant',
      timestamp: iso(T0),
      message: { id: 'm1', content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'cat p.md | codex exec -s read-only -' } }, { type: 'tool_use', id: 'tu2', name: 'Bash', input: { command: 'echo codexify' } }] },
    })
    expect(signals.filter((s) => s.k === 'tool_use').map((s) => (s as { codex?: true }).codex)).toEqual([true, undefined])
    const state = new TranscriptState()
    state.apply(signals)
    expect(state.codexCalls).toEqual([iso(T0)])
    expect(JSON.stringify(signals)).not.toContain('read-only')
  })
})

describe('CodexMonitor', () => {
  let home: string
  let dayDir: string
  let store: MonitorStore
  let now: number
  let procs: CodexProcess[] | null
  let alive: Set<number>
  let targets: ClaudeTarget[]

  const monitor = () =>
    new CodexMonitor(
      { codexHome: home, staleTtlMs: 120 * 60_000, reconcileMs: 5_000, verifyMs: 60_000, verifyProcesses: true },
      store,
      () => targets,
      { listProcesses: async () => procs, isPidAlive: (pid) => alive.has(pid), now: () => now },
    )

  beforeEach(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'ccm-codex-home-'))
    now = T0 + 10_000
    const d = new Date(now)
    const pad = (n: number) => String(n).padStart(2, '0')
    dayDir = path.join(home, 'sessions', String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate()))
    await mkdir(dayDir, { recursive: true })
    store = new MonitorStore({ activityLimit: 100, batchMs: 1 })
    procs = []
    alive = new Set()
    targets = []
  })
  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  const write = (id: string, lines: unknown[]) => writeFile(path.join(dayDir, `rollout-2026-10-11T14-00-00-${id}.jsonl`), lines.map(line).join(''))

  it('puts a running exec launched by Claude into that session, under the calling agent', async () => {
    store.upsertTerminal({ id: 'claude-1', title: 'demo', status: 'working' })
    targets = [{ terminalId: 'claude-1', pid: 100, mainAgentId: 'claude-1:main', ended: false, codexCalls: [{ agentId: 'sub-a', at: iso(T0 - 1_000) }] }]
    procs = [{ pid: 300, start: T0 - 200, mode: 'exec', ancestors: [250, 100], orphan: false }]
    alive.add(300)
    await write(TID, [meta(), started(), context(), call('c1'), tokens()])
    const codex = monitor()
    await codex.start({ watch: false })
    const agent = store.getAgent(`codex:${TID}`)
    expect(agent).toMatchObject({ terminalId: 'claude-1', parentId: 'sub-a', role: 'subagent', provider: 'codex', type: 'exec', name: 'art-hero-x1', status: 'working', currentTool: 'exec', model: 'gpt-6-luna' })
    expect(agent).toMatchObject({ inputTokens: 6000, cacheReadTokens: 12000, outputTokens: 2000, totalTokens: 8000, contextTokens: 20000, contextWindow: 258400 })
    expect(store.snapshot().codexLimits).toMatchObject({ plan: 'plus', fiveHour: { usedPct: 7 } })
    expect(JSON.stringify(store.snapshot())).not.toContain('secret')

    alive.delete(300)
    await (codex as unknown as { tick(): Promise<void> }).tick()
    expect(store.getAgent(`codex:${TID}`)?.status).toBe('cancelled')
    codex.stop()
  })

  it('shows other runs as their own session and ends them with the process; skips Desktop threads', async () => {
    procs = [{ pid: 400, start: T0 - 100, mode: 'exec', ancestors: [1], orphan: false }]
    alive.add(400)
    await write(TID, [meta(), started(), context()])
    const desktop = '01a125e6-0000-7000-8000-000000000001'
    await write(desktop, [meta({ id: desktop, session_id: desktop, source: 'vscode', originator: 'Codex Desktop' }), started()])
    const codex = monitor()
    await codex.start({ watch: false })
    expect(store.getTerminal(`codex:${TID}`)).toMatchObject({ provider: 'codex', status: 'working', processId: 400, entrypoint: 'exec', codexVersion: '0.162.0' })
    expect(store.getAgent(`codex:${TID}:main`)).toMatchObject({ role: 'main', status: 'working' })
    expect(store.getTerminal(`codex:${desktop}`)).toBeUndefined()
    expect(codex.pidOf(`codex:${TID}`)).toBe(400)

    await appendFile(path.join(dayDir, `rollout-2026-10-11T14-00-00-${TID}.jsonl`), line(complete()))
    await (codex as unknown as { sync(id: string, file: string): Promise<void> }).sync(TID, path.join(dayDir, `rollout-2026-10-11T14-00-00-${TID}.jsonl`))
    expect(store.getTerminal(`codex:${TID}`)?.status).toBe('idle')
    alive.delete(400)
    await (codex as unknown as { tick(): Promise<void> }).tick()
    expect(store.getTerminal(`codex:${TID}`)).toMatchObject({ status: 'stale' })
    expect(store.getAgent(`codex:${TID}:main`)?.status).toBe('completed')
    expect(codex.dismissEnded(`codex:${TID}`)).toBe(1)
    expect(store.getTerminal(`codex:${TID}`)).toBeUndefined()
    codex.stop()
  })

  it('ignores finished and orphaned runs at startup but still reads the latest limits', async () => {
    await write(TID, [meta(), started(), tokens(T0, 33), complete()])
    const killed = '01a125e6-0000-7000-8000-000000000002'
    await write(killed, [meta({ id: killed, session_id: killed }), started(), call('c1')])
    const codex = monitor()
    await codex.start({ watch: false })
    expect([...store.terminalList()]).toHaveLength(0)
    expect(store.snapshot().agents).toHaveLength(0)
    expect(store.snapshot().codexLimits?.fiveHour?.usedPct).toBe(33)
    codex.stop()
  })

  it('names threads from session_index.jsonl', () => {
    const names = parseThreadNames(`${JSON.stringify({ id: TID, thread_name: 'Fix build', updated_at: 'x' })}\nnot json\n${JSON.stringify({ id: 'b', thread_name: '  ' })}\n`)
    expect([...names]).toEqual([[TID, 'Fix build']])
  })
})
