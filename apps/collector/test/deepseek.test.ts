import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DeepseekMonitor } from '../src/deepseek/monitor'
import { codewhaleHome, DeepseekThreadState, outboxPathFrom, parseOutboxLine } from '../src/deepseek/outbox'
import { matchDeepseekProcesses, parseCodewhaleArgs, toDeepseekProcesses, type DeepseekProcess } from '../src/deepseek/processes'
import { MonitorStore } from '../src/store'
import { JsonlTailer } from '../src/tailer'

// Shaped like the fixture in Codewhale's crates/hooks/src/lifecycle_outbox.rs tests.
const ev = (event: string, kind: string, extra: Record<string, unknown> = {}, payload: Record<string, unknown> = {}) => ({
  schema_version: 1,
  seq: 1,
  event,
  kind,
  thread_id: 's',
  turn_id: null,
  item_id: null,
  timestamp: 't',
  payload: { workspace: '/home/cw/wt-lane', ...payload },
  ...extra,
})

describe('parseOutboxLine', () => {
  it('reads the source fixture', () => {
    const e = parseOutboxLine(ev('session_start', 'session.started'))
    expect(e).toEqual({ event: 'session_start', kind: 'session.started', threadId: 's', at: undefined, workspace: '/home/cw/wt-lane' })
  })

  it('drops unknown events, empty / odd thread ids, other schema versions and non-objects', () => {
    expect(parseOutboxLine(ev('tool_call', 'tool.started'))).toBeNull()
    expect(parseOutboxLine(ev('turn_start', 'turn.started', { thread_id: '' }))).toBeNull()
    expect(parseOutboxLine(ev('turn_start', 'turn.started', { thread_id: 'a b' }))).toBeNull()
    expect(parseOutboxLine(ev('turn_start', 'turn.started', { schema_version: 2 }))).toBeNull()
    expect(parseOutboxLine('{"event":')).toBeNull()
    expect(parseOutboxLine(null)).toBeNull()
  })

  it('keeps no free text: kinds outside the vocabulary, relative workspaces and subagent prose are dropped', () => {
    const e = parseOutboxLine(
      ev('subagent_spawn', 'Spawned a helper to read secrets', { timestamp: '2026-11-03T10:00:00Z' }, { workspace: 'rel/dir', subagent: { id: 'sub-1', name: 'reads the secret file now', prompt: 'secret' }, message: 'secret' }),
    )
    expect(e).toEqual({ event: 'subagent_spawn', threadId: 's', kind: undefined, at: '2026-11-03T10:00:00.000Z', workspace: undefined, subagent: { id: 'sub-1', name: undefined, outcome: undefined } })
    expect(JSON.stringify(e)).not.toContain('secret')
    expect(parseOutboxLine(ev('subagent_spawn', 'subagent.spawned', {}, { subagent: 'agent_7' }))?.subagent).toEqual({ id: 'agent_7', outcome: undefined })
    expect(parseOutboxLine(ev('subagent_complete', 'subagent.completed', {}, { subagent: { agent_id: 'a1', agent_type: 'explorer', status: 'failed' } }))?.subagent).toEqual({ id: 'a1', name: 'explorer', outcome: 'error' })
  })
})

describe('DeepseekThreadState', () => {
  const apply = (s: DeepseekThreadState, event: string, kind: string, at: string, payload: Record<string, unknown> = {}) =>
    s.apply(parseOutboxLine(ev(event, kind, { timestamp: at }, payload))!)

  it('works between turn_start and turn_end, stays working when stalled, ends on session_end', () => {
    const s = new DeepseekThreadState()
    apply(s, 'session_start', 'session.started', '2026-11-03T10:00:00Z')
    expect(s.turnOpen).toBe(false)
    expect(apply(s, 'turn_start', 'turn.started', '2026-11-03T10:00:01Z')).toEqual([{ k: 'turn_start', at: '2026-11-03T10:00:01.000Z' }])
    apply(s, 'turn_stalled', 'turn.stalled', '2026-11-03T10:00:30Z')
    expect(s).toMatchObject({ turnOpen: true, stalled: true })
    expect(apply(s, 'turn_end', 'turn.failed', '2026-11-03T10:01:00Z')).toEqual([{ k: 'turn_end', outcome: 'failed', at: '2026-11-03T10:01:00.000Z' }])
    expect(s).toMatchObject({ turnOpen: false, stalled: false, lastOutcome: 'failed', turns: 1, workspace: '/home/cw/wt-lane' })
    apply(s, 'subagent_spawn', 'subagent.spawned', '2026-11-03T10:01:01Z', { subagent: { id: 'x' } })
    apply(s, 'subagent_spawn', 'subagent.spawned', '2026-11-03T10:01:02Z')
    apply(s, 'subagent_complete', 'subagent.completed', '2026-11-03T10:01:03Z', { subagent: { id: 'x' } })
    // A completion without an id closes the latest open one.
    apply(s, 'subagent_complete', 'subagent.completed', '2026-11-03T10:01:04Z')
    expect([...s.subagents.values()].map((x) => [x.id, x.outcome])).toEqual([['x', 'completed'], ['n1', 'completed']])
    apply(s, 'session_end', 'session.ended', '2026-11-03T10:02:00Z')
    expect(s.endedAt).toBe('2026-11-03T10:02:00.000Z')
    apply(s, 'turn_start', 'turn.started', '2026-11-03T11:00:00Z')
    expect(s.endedAt).toBeUndefined()
  })
})

describe('outbox config', () => {
  const home = path.resolve('/home/u')
  const cw = path.join(home, '.codewhale')

  it('reads only [lifecycle_outbox] path and expands ~', () => {
    expect(outboxPathFrom(null, cw, home)).toBeNull()
    expect(outboxPathFrom('telemetry = false\n', cw, home)).toBeNull()
    expect(outboxPathFrom('path = "/nope"\n[lifecycle_outbox]\n# c\npath = "~/.codewhale/notifications/outbox.jsonl" # comment\n[other]\npath = "/x"\n', cw, home)).toBe(
      path.join(home, '.codewhale', 'notifications', 'outbox.jsonl'),
    )
    expect(outboxPathFrom("[ lifecycle_outbox ]\npath = 'C:\\x\\o.jsonl'\n", cw, home)).toBe(path.resolve(cw, 'C:\\x\\o.jsonl'))
    expect(outboxPathFrom('lifecycle_outbox.path = "out.jsonl"\n', cw, home)).toBe(path.join(cw, 'out.jsonl'))
    expect(outboxPathFrom('[lifecycle_outbox]\nenabled = true\n', cw, home)).toBeNull()
  })

  it('picks CODEWHALE_HOME, then ~/.codewhale, then the legacy ~/.deepseek', () => {
    expect(codewhaleHome({ CODEWHALE_HOME: '/cw' }, () => false, home)).toBe('/cw')
    expect(codewhaleHome({}, () => false, home)).toBe(cw)
    expect(codewhaleHome({}, (d) => d.endsWith('.deepseek'), home)).toBe(path.join(home, '.deepseek'))
    expect(codewhaleHome({}, () => true, home)).toBe(cw)
  })
})

describe('Codewhale processes', () => {
  it('parses workspace and resume flags, skips one-shot commands', () => {
    expect(parseCodewhaleArgs('codewhale --skip-onboarding')).toEqual({ workspace: undefined, resumeId: undefined })
    expect(parseCodewhaleArgs('"C:\\npm\\node_modules\\codewhale\\bin\\downloads\\codewhale.exe" -C "D:\\proj a" -r 0a1b2c')).toEqual({ workspace: 'D:\\proj a', resumeId: '0a1b2c' })
    expect(parseCodewhaleArgs('codewhale --workspace=/w exec --auto "fix it"')).toEqual({ workspace: '/w', resumeId: undefined })
    expect(parseCodewhaleArgs('codewhale -C rel')).toEqual({ workspace: undefined, resumeId: undefined })
    expect(parseCodewhaleArgs('codewhale auth status')).toBeNull()
  })

  it('keeps top-level processes and never the command line', () => {
    const out = toDeepseekProcesses([
      { pid: 10, start: 1, ancestors: [5], orphan: false, cmd: 'codewhale "secret prompt"' },
      { pid: 11, start: 2, ancestors: [10, 5], orphan: false, cmd: 'codewhale mcp serve' },
      { pid: 12, start: 3, ancestors: [5], orphan: false, cmd: 'codewhale auth status' },
    ])
    expect(out).toEqual([{ pid: 10, start: 1, ancestors: [5], workspace: undefined, resumeId: undefined }])
  })

  it('matches one process per session: resume id, workspace, start time, lone candidate', () => {
    const p = (pid: number, start: number, extra: Partial<DeepseekProcess> = {}): DeepseekProcess => ({ pid, start, ancestors: [], ...extra })
    const m = matchDeepseekProcesses(
      [
        { id: 'resumed-thread', startedAt: 50_000 },
        { id: 'ws', workspace: '/a', startedAt: 10_000 },
        { id: 'timed', startedAt: 20_500 },
        { id: 'late', startedAt: 900_000 },
      ],
      [p(1, 9_000, { resumeId: 'resumed' }), p(2, 5_000, { workspace: '/a' }), p(3, 20_000), p(4, 100_000)],
      'linux',
    )
    expect(Object.fromEntries([...m].map(([k, v]) => [k, v.pid]))).toEqual({ 'resumed-thread': 1, ws: 2, timed: 3, late: 4 })
    // Kept pid with the same start wins over a closer newcomer.
    const kept = matchDeepseekProcesses([{ id: 'k', startedAt: 1_000, pid: 7, start: 0 }], [p(8, 1_000), p(7, 0)], 'linux')
    expect(kept.get('k')?.pid).toBe(7)
    expect(matchDeepseekProcesses([{ id: 'x', startedAt: 1_000 }, { id: 'y', startedAt: 1_100 }], [p(9, 900)], 'linux').size).toBe(1)
  })
})

describe('JsonlTailer fromEnd / maxLine', () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ccm-ds-tail-'))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('starts near the end, drops the partial line and oversized lines, resets on truncation', async () => {
    const file = path.join(dir, 'o.jsonl')
    await writeFile(file, `${JSON.stringify({ n: 1, pad: 'x'.repeat(50) })}\n${JSON.stringify({ n: 2 })}\n`)
    const t = new JsonlTailer(file, 16, { fromEnd: 20, maxLine: 100 })
    expect(await t.read()).toEqual([{ n: 2 }])
    await appendFile(file, `${JSON.stringify({ n: 3, pad: 'y'.repeat(200) })}\n${JSON.stringify({ n: 4 })}\n{"n":`)
    expect(await t.read()).toEqual([{ n: 4 }])
    await appendFile(file, '5}\n')
    expect(await t.read()).toEqual([{ n: 5 }])
    await writeFile(file, `${JSON.stringify({ n: 6 })}\n`)
    expect(await t.read()).toEqual([{ n: 6 }])
  })
})

describe('DeepseekMonitor', () => {
  let home: string
  let outbox: string
  let store: MonitorStore
  let now: number
  let procs: DeepseekProcess[] | null
  let alive: Set<number>
  const T0 = Date.parse('2026-11-03T10:00:00Z')
  const at = (s: number) => new Date(T0 + s * 1000).toISOString()
  const line = (event: string, kind: string, s: number, extra: Record<string, unknown> = {}, payload: Record<string, unknown> = {}) =>
    `${JSON.stringify(ev(event, kind, { thread_id: 'th-1', timestamp: at(s), ...extra }, payload))}\n`

  type Internals = { readOutbox(c: boolean): Promise<void>; scanNow(): Promise<void>; tick(): Promise<void> }
  const monitor = () =>
    new DeepseekMonitor(
      { codewhaleHome: home, homeDir: home, staleTtlMs: 120 * 60_000, reconcileMs: 5_000, verifyMs: 60_000, verifyProcesses: true },
      store,
      { listProcesses: async () => procs, isPidAlive: (pid) => alive.has(pid), now: () => now },
    )

  beforeEach(async () => {
    home = await mkdtemp(path.join(os.tmpdir(), 'ccm-ds-home-'))
    outbox = path.join(home, 'notifications', 'outbox.jsonl')
    await mkdir(path.dirname(outbox), { recursive: true })
    await writeFile(path.join(home, 'config.toml'), '[lifecycle_outbox]\npath = "~/notifications/outbox.jsonl"\n')
    store = new MonitorStore({ activityLimit: 100, batchMs: 1 })
    now = T0 + 10_000
    procs = [{ pid: 500, start: T0 - 500, ancestors: [400] }]
    alive = new Set([500])
  })
  afterEach(async () => {
    await rm(home, { recursive: true, force: true })
  })

  it('rebuilds a live session at start, links its process and follows turns and subagents', async () => {
    await writeFile(outbox, line('session_start', 'session.started', 0) + line('turn_start', 'turn.started', 1))
    const ds = monitor()
    await ds.start({ watch: false })
    expect(store.getTerminal('deepseek:th-1')).toMatchObject({ provider: 'deepseek', status: 'working', processId: 500, deepseekSessionId: 'th-1', cwd: '/home/cw/wt-lane', title: 'wt-lane' })
    expect(store.getAgent('deepseek:th-1:main')).toMatchObject({ role: 'main', provider: 'deepseek', status: 'working' })
    expect(ds.pidOf('deepseek:th-1')).toBe(500)

    const internals = ds as unknown as Internals
    await appendFile(outbox, line('subagent_spawn', 'subagent.spawned', 2, {}, { subagent: { id: 'sa', name: 'explorer' } }) + line('turn_end', 'turn.failed', 3))
    await internals.readOutbox(false)
    expect(store.getTerminal('deepseek:th-1')?.status).toBe('idle')
    expect(store.getAgent('deepseek:th-1:sub:sa')).toMatchObject({ parentId: 'deepseek:th-1:main', role: 'subagent', status: 'working', type: 'explorer' })
    await appendFile(outbox, line('subagent_complete', 'subagent.completed', 4, {}, { subagent: { id: 'sa' } }))
    await internals.readOutbox(false)
    expect(store.getAgent('deepseek:th-1:sub:sa')?.status).toBe('completed')
    const kinds = store.snapshot().activity.map((a) => a.kind)
    expect(kinds).toEqual(expect.arrayContaining(['agent.started', 'turn.failed', 'agent.completed']))
    expect(kinds).not.toContain('turn.started')

    await appendFile(outbox, line('session_end', 'session.ended', 5))
    await internals.readOutbox(false)
    expect(store.getTerminal('deepseek:th-1')).toMatchObject({ status: 'stale', endedAt: at(5) })
    expect(store.getTerminal('deepseek:th-1')?.processId).toBeUndefined()
    expect(ds.dismissEnded('deepseek:th-1')).toBe(1)
    expect(store.getTerminal('deepseek:th-1')).toBeUndefined()
    ds.stop()
  })

  it('skips ended or process-less sessions at start; ends a session whose process exits', async () => {
    await writeFile(
      outbox,
      line('session_start', 'session.started', 0, { thread_id: 'done' }) +
        line('session_end', 'session.ended', 1, { thread_id: 'done' }) +
        line('session_start', 'session.started', 0),
    )
    const ds = monitor()
    await ds.start({ watch: false })
    expect(store.getTerminal('deepseek:done')).toBeUndefined()
    expect(store.getTerminal('deepseek:th-1')?.status).toBe('idle')
    alive.clear()
    now += 5_000
    await (ds as unknown as Internals).tick()
    expect(store.getTerminal('deepseek:th-1')?.status).toBe('stale')
    ds.stop()

    procs = []
    store = new MonitorStore({ activityLimit: 100, batchMs: 1 })
    const later = monitor()
    await later.start({ watch: false })
    expect(store.getTerminal('deepseek:th-1')).toBeUndefined()
    later.stop()
  })

  it('shows a new session only after a scan, then reports its first turn', async () => {
    await writeFile(outbox, '')
    const ds = monitor()
    await ds.start({ watch: false })
    procs = [...procs!, { pid: 600, start: T0 + 59_000, ancestors: [] }]
    alive.add(600)
    await appendFile(outbox, line('session_start', 'session.started', 60, { thread_id: 'th-2' }, { workspace: '/w/two' }) + line('turn_start', 'turn.started', 61, { thread_id: 'th-2' }, { workspace: '/w/two' }))
    const internals = ds as unknown as Internals
    await internals.readOutbox(false)
    expect(store.getTerminal('deepseek:th-2')).toBeUndefined()
    await internals.scanNow()
    expect(store.getTerminal('deepseek:th-2')).toMatchObject({ processId: 600, status: 'working' })
    expect(store.snapshot().activity.map((a) => a.kind)).toEqual(expect.arrayContaining(['terminal.started', 'turn.started']))
    ds.stop()
  })

  it('stays off without an outbox path', async () => {
    await writeFile(path.join(home, 'config.toml'), 'telemetry = false\n')
    const ds = monitor()
    await ds.start({ watch: false })
    expect(ds.diagnostics()).toEqual({ outbox: null, threads: 0, processes: 0 })
    ds.stop()
  })
})
