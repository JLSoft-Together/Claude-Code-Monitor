import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Agent, TerminalSession, ToolSpan } from '@ccm/shared'
import { NameStore } from '@ccm/habblaud/server/model/names'
import { DONE_GRACE_MS, OFFLINE_GRACE_MS, OfficeModel, SNAPSHOT_RECENT, roomKey } from '../src/office/model.js'

const T0 = Date.parse('2026-01-01T00:00:00.000Z')
const iso = (ms: number) => new Date(T0 + ms).toISOString()

function setup(platform: NodeJS.Platform = 'win32') {
  const clock = { t: T0 + 100_000 }
  const model = new OfficeModel({ names: new NameStore(null), platform, now: () => clock.t, version: '9.9.9' })
  return { model, clock }
}

const term = (o: Partial<TerminalSession> = {}): TerminalSession => ({ id: 't1', title: 'Title', cwd: 'C:\\Code\\app', status: 'idle', ...o })
const main = (o: Partial<Agent> = {}): Agent => ({ id: 'a1', terminalId: 't1', role: 'main', status: 'idle', ...o })
const sub = (o: Partial<Agent> = {}): Agent => ({ id: 's1', parentId: 'a1', terminalId: 't1', role: 'subagent', status: 'working', ...o })
const span = (o: Partial<ToolSpan> = {}): ToolSpan => ({ id: 'x1', terminalId: 't1', agentId: 'a1', tool: 'Read', start: iso(0), ...o })

describe('roomKey', () => {
  it('normalises separators, trailing slash and case on win32', () => {
    expect(roomKey('C:\\Code\\app', 'win32')).toBe('c:/code/app')
    expect(roomKey('c:\\code\\app\\', 'win32')).toBe('c:/code/app')
    expect(roomKey('C:/Code/app', 'win32')).toBe('c:/code/app')
    expect(roomKey('/Home/Me/App/', 'linux')).toBe('/Home/Me/App')
    expect(roomKey(undefined, 'win32')).toBe('(unknown)')
    expect(roomKey('  ', 'darwin')).toBe('(unknown)')
  })
})

describe('OfficeModel mapping', () => {
  it('merges differently written cwds into one room, with name, slot and seed', () => {
    const { model } = setup()
    model.setState(
      [term({ id: 't1', cwd: 'C:\\Code\\app' }), term({ id: 't2', cwd: 'c:/code/app/' })],
      [main(), main({ id: 'a2', terminalId: 't2' })],
    )
    const s = model.snapshot()
    expect(s.rooms).toHaveLength(1)
    expect(s.rooms[0]).toMatchObject({ id: 'c:/code/app', name: 'app', slot: 0 })
    expect(s.rooms[0]!.seed).toBe(s.rooms[0]!.seed >>> 0)
    expect(s.agents.every((a) => a.roomId === 'c:/code/app')).toBe(true)
  })

  it('puts a terminal without cwd in the unknown room', () => {
    const { model } = setup()
    model.setState([term({ cwd: undefined })], [main()])
    expect(model.snapshot().rooms.map((r) => r.id)).toEqual(['(unknown)'])
  })

  it('maps ids, kind, parent, provider, account, seed, role and title', () => {
    const { model } = setup()
    model.setState(
      [term({ alias: 'My alias' })],
      [main(), sub({ type: 'Explore', description: 'look around' }), sub({ id: 's2', parentId: 'a1' })],
    )
    const s = model.snapshot()
    const a = s.agents.find((x) => x.id === 'a1')!
    const b = s.agents.find((x) => x.id === 's1')!
    const c = s.agents.find((x) => x.id === 's2')!
    expect(a).toMatchObject({ kind: 'main', provider: 'claude', account: 'claude', role: 'main', title: 'My alias', sessionId: 't1' })
    expect(a.parentId).toBeUndefined()
    expect(b).toMatchObject({ kind: 'sub', parentId: 'a1', role: 'Explore', title: 'look around' })
    expect(c.role).toBe('sub')
    expect(a.seed).not.toBe(b.seed)
    expect(a.stats.subagents).toBe(2)
    expect(b.stats.subagents).toBe(0)
  })

  it('uses the terminal title when there is no alias, and codex provider/account', () => {
    const { model } = setup()
    model.setState([term({ provider: 'codex' })], [main({ provider: 'codex' })])
    const s = model.snapshot()
    expect(s.agents[0]).toMatchObject({ title: 'Title', provider: 'codex', account: 'codex' })
    expect(s.accounts).toEqual([
      { id: 'codex', provider: 'codex', short: 'X', name: 'Codex', color: '#000000', configDir: '', sessions: 1, usageStatus: 'disabled' },
    ])
  })

  it('builds one account per provider present', () => {
    const { model } = setup()
    model.setState(
      [term(), term({ id: 't2', provider: 'codex' })],
      [main(), main({ id: 'a2', terminalId: 't2', provider: 'codex' })],
    )
    expect(model.snapshot().accounts.map((a) => [a.id, a.short, a.name, a.sessions])).toEqual([
      ['claude', 'C', 'Claude', 1],
      ['codex', 'X', 'Codex', 1],
    ])
  })

  it.each([
    ['working', false, 'working'],
    ['waiting', false, 'waiting'],
    ['idle', false, 'idle'],
    ['idle', true, 'shell'],
    ['error', false, 'idle'],
    ['unknown', false, 'idle'],
  ] as const)('main status from terminal %s (backgroundShell %s) -> %s', (status, bg, expected) => {
    const { model } = setup()
    model.setState([term({ status, backgroundShell: bg })], [main({ status: 'working' })])
    const a = model.snapshot().agents[0]!
    expect(a.status).toBe(expected)
    expect(a.shells ?? []).toHaveLength(bg ? 1 : 0)
  })

  it('maps the background shell job', () => {
    const { model } = setup()
    model.setState([term({ status: 'idle', backgroundShell: true, statusSince: iso(5_000) })], [main()])
    expect(model.snapshot().agents[0]!.shells).toEqual([{ id: 't1:bg', label: '', startedAt: T0 + 5_000, background: true, kind: 'shell' }])
  })

  it.each([
    ['working', 'working'],
    ['waiting', 'waiting'],
    ['idle', 'idle'],
    ['unknown', 'working'],
    ['completed', 'done'],
    ['error', 'done'],
    ['cancelled', 'done'],
  ] as const)('sub status %s -> %s', (status, expected) => {
    const { model } = setup()
    model.setState([term({ status: 'working' })], [main(), sub({ status })])
    expect(model.snapshot().agents.find((a) => a.id === 's1')!.status).toBe(expected)
  })

  it('passes the raw waitingFor of the terminal', () => {
    const { model } = setup()
    model.setState([term({ status: 'waiting', waitingFor: 'approve Bash' })], [main()])
    expect(model.snapshot().agents[0]!.waitingFor).toBe('approve Bash')
  })

  it('maps currentTool to an activity with kind/icon/text and no detail', () => {
    const { model } = setup()
    model.setState([term({ status: 'working' })], [main({ currentTool: 'Edit', updatedAt: iso(7_000) })])
    const act = model.snapshot().agents[0]!.activity!
    expect(act).toMatchObject({ id: `a1:${T0 + 7_000}`, tool: 'Edit', kind: 'edit', at: T0 + 7_000 })
    expect(act.icon).toBeTruthy()
    expect(act.text).toBeTruthy()
    expect(act).not.toHaveProperty('detail')
  })

  it('keeps the activity id and time while the same tool runs, and starts anew on another tool', () => {
    const { model } = setup()
    model.setState([term({ status: 'working' })], [main({ currentTool: 'Task', updatedAt: iso(7_000) })])
    const first = model.snapshot().agents[0]!.activity!
    model.setState([term({ status: 'working' })], [main({ currentTool: 'Task', updatedAt: iso(9_000), outputTokens: 50 })])
    const same = model.snapshot().agents[0]!.activity!
    expect(same.id).toBe(first.id)
    expect(same.at).toBe(T0 + 7_000)
    model.setState([term({ status: 'working' })], [main({ currentTool: 'Read', updatedAt: iso(11_000) })])
    const next = model.snapshot().agents[0]!.activity!
    expect(next.id).not.toBe(first.id)
    expect(next).toMatchObject({ tool: 'Read', at: T0 + 11_000 })
    model.setState([term({ status: 'idle' })], [main({ updatedAt: iso(12_000) })])
    expect(model.snapshot().agents[0]!.activity).toBeUndefined()
    model.setState([term({ status: 'working' })], [main({ currentTool: 'Read', updatedAt: iso(13_000) })])
    expect(model.snapshot().agents[0]!.activity!.at).toBe(T0 + 13_000)
  })

  it('keeps the last SNAPSHOT_RECENT spans per agent and counts calls', () => {
    const { model } = setup()
    model.setState([term()], [main()])
    for (let i = 0; i < 12; i++) model.addSpan(span({ id: `x${i}`, start: iso(i * 1000) }))
    model.addSpan(span({ id: 'x11', start: iso(11_000), end: iso(11_500), outcome: 'error' }))
    const a = model.snapshot().agents[0]!
    expect(a.recent).toHaveLength(SNAPSHOT_RECENT)
    expect(a.recent.map((r) => r.id)).toEqual(['x4', 'x5', 'x6', 'x7', 'x8', 'x9', 'x10', 'x11'])
    expect(a.recent.at(-1)).toMatchObject({ durationMs: 500, error: true, at: T0 + 11_000 })
    expect(a.stats.toolCalls).toBe(12)
  })

  it('has no tasks and maps token stats', () => {
    const { model } = setup()
    model.setState([term()], [main({ inputTokens: 10, cacheReadTokens: 5, outputTokens: 3 }), sub()])
    const s = model.snapshot()
    expect(s.agents[0]!.tasks).toEqual([])
    expect(s.agents[0]!.stats).toMatchObject({ tokensIn: 15, tokensOut: 3 })
    expect(s.agents[1]!.stats).toMatchObject({ tokensIn: 0, tokensOut: 0, subagents: 0 })
  })

  it('parses ISO times and falls back to now()', () => {
    const { model, clock } = setup()
    model.setState(
      [term({ statusSince: iso(2_000), startedAt: iso(1_000), lastActivityAt: iso(3_000) }), term({ id: 't2' })],
      [main({ startedAt: iso(1_000), updatedAt: iso(3_000) }), sub({ terminalId: 't2' })],
    )
    const [a, b] = model.snapshot().agents
    expect(a).toMatchObject({ startedAt: T0 + 1_000, lastEventAt: T0 + 3_000, statusSince: T0 + 2_000 })
    expect(b).toMatchObject({ startedAt: clock.t, lastEventAt: clock.t, statusSince: clock.t })
  })

  it('fills meta, serverTime and bumps rev only on change', () => {
    const { model, clock } = setup()
    model.setState([term()], [main()])
    const s1 = model.snapshot()
    expect(s1.meta).toEqual({ demo: false, sources: [], startedAt: clock.t, version: '9.9.9' })
    expect(s1.serverTime).toBe(clock.t)
    clock.t += 1_000
    const s2 = model.snapshot()
    expect(s2.rev).toBe(s1.rev)
    model.setState([term({ status: 'working' })], [main()])
    expect(model.snapshot().rev).toBe(s1.rev + 1)
  })

  it('keeps names stable for the same id across restarts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'office-names-'))
    try {
      const file = join(dir, 'office-names.json')
      const store1 = new NameStore(file)
      const m1 = new OfficeModel({ names: store1, platform: 'win32' })
      m1.setState([term()], [main()])
      const name = m1.snapshot().agents[0]!.name
      store1.flush()
      const store2 = new NameStore(file)
      store2.load()
      const m2 = new OfficeModel({ names: store2, platform: 'win32' })
      m2.setState([term()], [main()])
      expect(m2.snapshot().agents[0]!.name).toBe(name)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('OfficeModel grace periods', () => {
  it('removed terminal -> offline, gone after 20 s', () => {
    const { model, clock } = setup()
    model.setState([term()], [main()])
    model.setState([], [])
    expect(model.snapshot().agents[0]!.status).toBe('offline')
    clock.t += OFFLINE_GRACE_MS
    expect(model.tick()).toBe(false)
    clock.t += 1
    expect(model.tick()).toBe(true)
    expect(model.snapshot().agents).toEqual([])
    expect(model.snapshot().rooms).toEqual([])
    expect(model.tick()).toBe(false)
  })

  it('stale terminal -> offline, back to live when it recovers', () => {
    const { model, clock } = setup()
    model.setState([term({ status: 'stale' })], [main()])
    expect(model.snapshot().agents[0]!.status).toBe('offline')
    clock.t += 5_000
    model.setState([term({ status: 'working' })], [main()])
    clock.t += OFFLINE_GRACE_MS * 2
    expect(model.tick()).toBe(false)
    expect(model.snapshot().agents[0]!.status).toBe('working')
  })

  it('completed sub -> done, gone after 25 s', () => {
    const { model, clock } = setup()
    model.setState([term({ status: 'working' })], [main(), sub()])
    model.setState([term({ status: 'working' })], [main(), sub({ status: 'completed' })])
    expect(model.snapshot().agents.find((a) => a.id === 's1')!.status).toBe('done')
    clock.t += DONE_GRACE_MS
    expect(model.tick()).toBe(false)
    clock.t += 1
    expect(model.tick()).toBe(true)
    expect(model.snapshot().agents.map((a) => a.id)).toEqual(['a1'])
  })
})

describe('OfficeModel tombstones and room paths', () => {
  const t = [term({ status: 'working' })]
  it('does not resurrect an expired sub that stays finished in the input', () => {
    const { model, clock } = setup()
    const done = [main(), sub({ status: 'completed' })]
    model.setState(t, done)
    clock.t += DONE_GRACE_MS + 1
    expect(model.tick()).toBe(true)
    model.setState(t, done)
    expect(model.snapshot().agents.map((a) => a.id)).toEqual(['a1'])
    clock.t += DONE_GRACE_MS + 1
    expect(model.tick()).toBe(false)
  })

  it('does not resurrect an expired main with a stale terminal', () => {
    const { model, clock } = setup()
    model.setState([term({ status: 'stale' })], [main()])
    clock.t += OFFLINE_GRACE_MS + 1
    model.tick()
    model.setState([term({ status: 'stale' })], [main()])
    expect(model.snapshot().agents).toEqual([])
  })

  it('brings an expired agent back when it becomes live again', () => {
    const { model, clock } = setup()
    model.setState(t, [main(), sub({ status: 'completed' })])
    clock.t += DONE_GRACE_MS + 1
    model.tick()
    model.setState(t, [main(), sub({ status: 'working' })])
    expect(model.snapshot().agents.find((a) => a.id === 's1')!.status).toBe('working')
  })

  it('clears the tombstone when the id leaves the input', () => {
    const { model, clock } = setup()
    model.setState(t, [main(), sub({ status: 'completed' })])
    clock.t += DONE_GRACE_MS + 1
    model.tick()
    model.setState(t, [main()])
    model.setState(t, [main(), sub({ status: 'completed' })])
    expect(model.snapshot().agents.find((a) => a.id === 's1')!.status).toBe('done')
  })

  it('keeps original case in room name and path on win32', () => {
    const { model } = setup()
    model.setState(
      [term({ id: 't1', cwd: 'C:\\Code\\MyProject' }), term({ id: 't2', cwd: 'c:/code/myproject/' })],
      [main(), main({ id: 'a2', terminalId: 't2' })],
    )
    const s = model.snapshot()
    expect(s.rooms).toHaveLength(1)
    expect(s.rooms[0]).toMatchObject({ id: 'c:/code/myproject', name: 'MyProject', path: 'C:/Code/MyProject' })
  })
})

describe('OfficeModel privacy', () => {
  it('never emits input, command or detail keys', () => {
    const { model } = setup()
    model.setState(
      [term({ status: 'working', backgroundShell: true })],
      [main({ currentTool: 'Bash' }), sub({ currentTool: 'Edit', description: 'task' })],
    )
    model.addSpan(span({ tool: 'Bash' }))
    model.addSpan(span({ id: 'x2', agentId: 's1', tool: 'WebFetch' }))
    const keys: string[] = []
    JSON.parse(JSON.stringify(model.snapshot()), function (k, v) {
      keys.push(k)
      return v
    })
    expect(keys.length).toBeGreaterThan(20)
    for (const banned of ['input', 'command', 'detail']) expect(keys).not.toContain(banned)
  })
})
