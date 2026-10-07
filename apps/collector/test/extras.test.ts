import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { forecastWindow, LimitHistory } from '../src/forecast'
import { SessionHistory } from '../src/history'
import { StatusTimeline } from '../src/timeline'
import { JobReader, lastStateChange, parseJobState } from '../src/jobs'
import { parseModelCatalog } from '../src/model-catalog'
import { ResponseTracker } from '../src/response'
import { latestLimits, parseStatusLine } from '../src/statusline'
import { MonitorStore } from '../src/store'
import { extractSignals, TranscriptState } from '../src/transcript'

const SID = '0e1d2c3b-4a59-4687-9a1b-2c3d4e5f6a7b'

describe('background jobs', () => {
  let dir = ''
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('keeps only whitelisted state fields', () => {
    const job = parseJobState(
      'abc123',
      JSON.stringify({
        state: 'blocked',
        tempo: 'idle',
        name: 'fix login',
        intent: 'secret prompt',
        detail: 'secret detail',
        output: { result: 'secret' },
        linkScanPath: 'C:/x',
        inFlight: { tasks: 2, queued: 1 },
        tokens: 900,
      }),
    )
    expect(job).toEqual({ id: 'abc123', name: 'fix login', state: 'blocked', tempo: 'idle', tasks: 2, queued: 1, tokens: 900 })
    expect(JSON.stringify(job)).not.toContain('secret')
    expect(parseJobState('x1234', '{"state":"weird"}')?.state).toBe('unknown')
  })

  it('finds when the current state started from the timeline tail', () => {
    const tail = [
      { at: '2026-10-08T01:00:00Z', state: 'working', text: 'x' },
      { at: '2026-10-08T01:05:00Z', state: 'blocked' },
      { at: '2026-10-08T01:06:00Z', state: 'blocked' },
    ]
      .map((r) => JSON.stringify(r))
      .join('\n')
    expect(lastStateChange(tail, 'blocked')).toBe('2026-10-08T01:05:00Z')
    expect(lastStateChange(tail, 'done')).toBeUndefined()
  })

  it('reads job dirs and drops old finished jobs', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ccm-jobs-'))
    await mkdir(path.join(dir, 'job0001'))
    await writeFile(path.join(dir, 'job0001', 'state.json'), JSON.stringify({ state: 'working', name: 'a' }))
    await mkdir(path.join(dir, 'job0002'))
    await writeFile(path.join(dir, 'job0002', 'state.json'), JSON.stringify({ state: 'done' }))
    await mkdir(path.join(dir, '..bad'), { recursive: true }).catch(() => undefined)
    const reader = new JobReader(dir)
    expect((await reader.read(Date.now())).map((j) => j.id).sort()).toEqual(['job0001', 'job0002'])
    expect((await reader.read(Date.now() + 2 * 24 * 3_600_000)).map((j) => j.id)).toEqual(['job0001'])
  })
})

describe('model catalog', () => {
  it('maps ids to display names only', () => {
    const text = JSON.stringify({
      catalog: { config: { models: [{ id: 'claude-opus-5-5', name: 'Opus 5.5', notice: { text: 'x' } }, { id: '../x', name: 'bad' }] } },
    })
    expect(parseModelCatalog(text)).toEqual({ 'claude-opus-5-5': 'Opus 5.5' })
    expect(parseModelCatalog('nope')).toEqual({})
  })
})

describe('status line bridge records', () => {
  it('parses numbers and picks the newest limits', () => {
    const a = parseStatusLine(JSON.stringify({ sessionId: SID, at: '2026-10-08T01:00:00Z', costUsd: 1.5, fiveHour: { usedPct: 140 } }))
    const b = parseStatusLine(JSON.stringify({ sessionId: SID, at: '2026-10-08T02:00:00Z', sevenDay: { usedPct: 40, resetsAt: '2026-10-10T00:00:00Z' } }))
    expect(a?.fiveHour?.usedPct).toBe(100)
    expect(latestLimits([a!, b!])).toEqual({ fiveHour: undefined, sevenDay: { usedPct: 40, resetsAt: '2026-10-10T00:00:00Z' }, updatedAt: '2026-10-08T02:00:00Z' })
    expect(latestLimits([parseStatusLine(JSON.stringify({ sessionId: SID, at: '2026-10-08T01:00:00Z' }))!])).toBeNull()
    expect(parseStatusLine('{"sessionId":1}')).toBeNull()
  })
})

describe('response tracker', () => {
  it('counts waits, long waits, median and rolls over at midnight', () => {
    let now = new Date(2026, 9, 8, 10).getTime()
    const r = new ResponseTracker(null, () => now)
    r.record(30_000)
    r.record(90_000)
    r.record(6 * 60_000)
    expect(r.record(-1)).toBe(false)
    expect(r.record(9 * 3_600_000)).toBe(false)
    expect(r.stats()).toMatchObject({ count: 3, longWaits: 1, medianMs: 90_000, totalMs: 480_000 })
    now = new Date(2026, 9, 9, 0, 5).getTime()
    expect(r.rollDay()).toBe(true)
    expect(r.stats()).toMatchObject({ count: 0, longWaits: 0 })
  })
})

describe('transcript effort and cache tier', () => {
  const reply = (effort: string, creation: Record<string, number>, at: string) => ({
    type: 'assistant',
    timestamp: at,
    effort,
    message: {
      id: `m-${at}`,
      model: 'claude-opus-5-5',
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0, cache_creation: creation },
    },
  })

  it('tracks effort and keeps the last written tier across read-only replies', () => {
    const state = new TranscriptState()
    state.apply(extractSignals(reply('high', { ephemeral_1h_input_tokens: 50 }, '2026-10-08T01:00:00Z')))
    expect(state).toMatchObject({ effort: 'high', cacheTtl: '1h', cacheAt: '2026-10-08T01:00:00Z' })
    state.apply(extractSignals(reply('medium', {}, '2026-10-08T01:02:00Z')))
    expect(state).toMatchObject({ effort: 'medium', cacheTtl: '1h', cacheAt: '2026-10-08T01:02:00Z' })
    state.apply(extractSignals(reply('BAD VALUE', { ephemeral_5m_input_tokens: 5 }, '2026-10-08T01:03:00Z')))
    expect(state).toMatchObject({ effort: undefined, cacheTtl: '5m' })
  })
})

describe('store activity rings', () => {
  it('keeps tool events from evicting other activity', () => {
    const store = new MonitorStore({ activityLimit: 2, batchMs: 1 })
    store.pushActivity({ kind: 'terminal.started', at: '2026-10-08T01:00:00Z' })
    for (let i = 0; i < 5; i++) store.pushActivity({ kind: 'tool.started', at: `2026-10-08T01:0${i + 1}:00Z`, data: { tool: 'Bash' } })
    const kinds = store.snapshot().activity.map((a) => a.kind)
    expect(kinds).toEqual(['terminal.started', 'tool.started', 'tool.started'])
  })
})

describe('limit forecast', () => {
  const base = Date.parse('2026-10-08T10:00:00Z')
  const report = (min: number, pct: number, resetsAt = '2026-10-08T13:00:00Z') => ({
    fiveHour: { usedPct: pct, resetsAt },
    updatedAt: new Date(base + min * 60_000).toISOString(),
  })

  it('projects when the 5h window fills from the recent burn rate', () => {
    const h = new LimitHistory()
    let out = null
    for (let m = 0; m <= 30; m += 5) out = h.apply(report(m, 10 + m))
    const f = out?.fiveHour?.forecast
    expect(f?.pctPerHour).toBe(60)
    expect(f?.fullAt).toBe(new Date(base + 90 * 60_000).toISOString())
    expect(f?.beforeReset).toBe(true)
  })

  it('needs enough history and drops samples when the window resets', () => {
    const h = new LimitHistory()
    h.apply(report(0, 10))
    expect(h.apply(report(5, 15))?.fiveHour?.forecast).toBeUndefined()
    for (let m = 10; m <= 30; m += 5) h.apply(report(m, 10 + m))
    expect(h.apply(report(35, 2, '2026-10-08T15:35:00Z'))?.fiveHour?.forecast).toBeUndefined()
  })

  it('reports a flat window without a fill time', () => {
    const f = forecastWindow(
      [
        { at: base, pct: 40 },
        { at: base + 30 * 60_000, pct: 40 },
      ],
      undefined,
      { lookbackMs: 3_600_000, minSpanMs: 600_000, stepMs: 60_000 },
    )
    expect(f).toEqual({ pctPerHour: 0 })
  })
})

describe('status timeline + history', () => {
  it('adds a segment per status change and rolls at midnight', () => {
    let nowMs = new Date(2026, 9, 8, 10, 0, 0).getTime()
    const tl = new StatusTimeline(null, () => nowMs)
    const at = (h: number, m: number) => new Date(2026, 9, 8, h, m).toISOString()
    tl.observe('t1', 'demo', 'working', at(9, 0))
    tl.observe('t1', 'demo', 'working', at(9, 0))
    nowMs = new Date(2026, 9, 8, 10, 30).getTime()
    tl.observe('t1', 'demo', 'waiting', at(10, 0))
    tl.observe('t1', 'demo', 'stale')
    const lane = tl.data().lanes[0]!
    expect(lane.segments.map((s) => s.status)).toEqual(['working', 'waiting'])
    expect(lane.segments[1]!.to).toBe(at(10, 30))
    expect(tl.totals('t1')).toEqual({ working: 3_600_000, waiting: 1_800_000, idle: 0 })
    tl.observe('t2', 'other', 'working', at(23, 0))
    nowMs = new Date(2026, 9, 9, 1, 0).getTime()
    const next = tl.data()
    expect(next.lanes.map((l) => l.id)).toEqual(['t2'])
    expect(next.lanes[0]!.segments[0]!.from).toBe(new Date(2026, 9, 9).toISOString())
  })

  it('keeps ended sessions newest first without duplicates', () => {
    const h = new SessionHistory()
    const rec = (id: string) => ({ id, title: id, endedAt: '2026-10-08T10:00:00Z', inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, subagents: 0 })
    h.add(rec('a'))
    h.add(rec('b'))
    h.add(rec('a'))
    expect(h.list().map((r) => r.id)).toEqual(['a', 'b'])
  })
})
