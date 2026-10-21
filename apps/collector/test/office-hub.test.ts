import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocket } from 'ws'
import type { OfficeSnapshot } from '@ccm/habblaud/shared/types'
import { NameStore } from '@ccm/habblaud/server/model/names'
import type { ServerMessage, TerminalSession } from '@ccm/shared'
import { OfficeHub } from '../src/office/hub'
import { OfficeModel } from '../src/office/model'
import { startServer } from '../src/server'
import { MonitorStore } from '../src/store'

const term = (o: Partial<TerminalSession> = {}): TerminalSession => ({ id: 't1', title: 'T', cwd: 'C:\\Code\\app', status: 'idle', ...o })

describe('OfficeHub', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup() {
    const store = new MonitorStore({ activityLimit: 10, batchMs: 10 })
    const model = new OfficeModel({ names: new NameStore(null), platform: 'win32' })
    const sent: Array<{ id: string; m: ServerMessage }> = []
    const ingest = vi.fn()
    const hub = new OfficeHub({ store, model, recorder: { ingest } as never, send: (id, m) => void sent.push({ id, m }) })
    hub.start()
    vi.advanceTimersByTime(300)
    ingest.mockClear()
    return { store, hub, sent, ingest }
  }
  const snapshots = (sent: Array<{ id: string; m: ServerMessage }>, id: string) =>
    sent.filter((s) => s.id === id).flatMap((s) => s.m.events.filter((e) => e.type === 'office.snapshot'))

  it('sends the current snapshot at once on subscribe, as a direct reply', () => {
    const { hub, sent, store } = setup()
    store.upsertTerminal(term())
    hub.subscribe('c1', true)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.m.direct).toBe(true)
    expect(sent[0]!.m.seq).toBe(-1)
    const ev = sent[0]!.m.events[0] as { type: string; payload: OfficeSnapshot }
    expect(ev.type).toBe('office.snapshot')
    hub.stop()
  })

  it('commits 10 changes inside 200 ms as one snapshot', () => {
    const { hub, sent, store } = setup()
    hub.subscribe('c1', true)
    sent.length = 0
    for (let i = 0; i < 10; i++) {
      store.upsertTerminal(term({ id: `t${i}`, cwd: `C:\\Code\\p${i}` }))
      store.upsertAgent({ id: `a${i}`, terminalId: `t${i}`, role: 'main', status: 'working' })
      vi.advanceTimersByTime(15)
    }
    vi.advanceTimersByTime(400)
    expect(snapshots(sent, 'c1')).toHaveLength(1)
    hub.stop()
  })

  it('sends nothing to a client that did not subscribe, or after unsubscribe', () => {
    const { hub, sent, store } = setup()
    hub.subscribe('c1', true)
    hub.subscribe('c2', false)
    sent.length = 0
    store.upsertTerminal(term())
    store.upsertAgent({ id: 'a1', terminalId: 't1', role: 'main', status: 'working' })
    vi.advanceTimersByTime(400)
    expect(snapshots(sent, 'c2')).toHaveLength(0)
    expect(snapshots(sent, 'c1')).toHaveLength(1)
    hub.subscribe('c1', false)
    sent.length = 0
    store.upsertAgent({ id: 'a2', terminalId: 't1', role: 'main', status: 'working' })
    vi.advanceTimersByTime(400)
    expect(sent).toHaveLength(0)
    hub.stop()
  })

  it('a late subscriber does not make existing subscribers miss a pending update', () => {
    const { hub, sent, store } = setup()
    hub.subscribe('A', true)
    sent.length = 0
    store.upsertTerminal(term())
    store.upsertAgent({ id: 'a1', terminalId: 't1', role: 'main', status: 'working' })
    vi.advanceTimersByTime(20)
    hub.subscribe('B', true)
    vi.advanceTimersByTime(400)
    const revs = (id: string) => snapshots(sent, id).map((e) => (e as { payload: OfficeSnapshot }).payload.rev)
    expect(revs('B').length).toBeGreaterThan(0)
    expect(revs('A').length).toBeGreaterThan(0)
    expect(Math.max(...revs('A'))).toBe(Math.max(...revs('B')))
    hub.stop()
  })

  it('sends a second snapshot when a terminal status flips working to waiting', () => {
    const { hub, sent, store } = setup()
    store.upsertTerminal(term({ status: 'working' }))
    store.upsertAgent({ id: 'a1', terminalId: 't1', role: 'main', status: 'working' })
    vi.advanceTimersByTime(300)
    hub.subscribe('c1', true)
    sent.length = 0
    store.upsertTerminal(term({ status: 'waiting' }))
    vi.advanceTimersByTime(400)
    expect(snapshots(sent, 'c1')).toHaveLength(1)
    hub.stop()
  })

  it('dropClient stops sends', () => {
    const { hub, sent, store } = setup()
    hub.subscribe('c1', true)
    hub.dropClient('c1')
    sent.length = 0
    store.upsertTerminal(term())
    store.upsertAgent({ id: 'a1', terminalId: 't1', role: 'main', status: 'working' })
    vi.advanceTimersByTime(400)
    expect(sent).toHaveLength(0)
    hub.stop()
  })

  it('ingests every changed commit into the recorder even with zero subscribers', () => {
    const { hub, ingest, store } = setup()
    store.upsertTerminal(term())
    store.upsertAgent({ id: 'a1', terminalId: 't1', role: 'main', status: 'working' })
    vi.advanceTimersByTime(300)
    expect(ingest).toHaveBeenCalledTimes(1)
    store.upsertAgent({ id: 'a2', terminalId: 't1', role: 'main', status: 'working' })
    vi.advanceTimersByTime(300)
    expect(ingest).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(5000)
    expect(ingest).toHaveBeenCalledTimes(2)
    hub.stop()
  })
})

describe('office.subscribe validation', () => {
  it('accepts only a boolean on', async () => {
    const got: unknown[] = []
    const server = await startServer({
      host: '127.0.0.1',
      port: 0,
      webDist: tmpdir(),
      store: new MonitorStore({ activityLimit: 10, batchMs: 10 }),
      onClientMessage: (m) => void got.push(m),
    })
    const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}/ws`)
    try {
      await new Promise<void>((resolve, reject) => {
        ws.once('open', () => resolve())
        ws.once('error', reject)
      })
      for (const on of ['yes', 1, null, undefined]) ws.send(JSON.stringify({ type: 'office.subscribe', on }))
      ws.send(JSON.stringify({ type: 'office.subscribe', on: true }))
      for (let i = 0; i < 100 && got.length < 1; i++) await new Promise((r) => setTimeout(r, 20))
      await new Promise((r) => setTimeout(r, 50))
      expect(got).toEqual([{ type: 'office.subscribe', on: true }])
    } finally {
      ws.close()
      server.close()
    }
  })
})

describe('timeline routes', () => {
  const KEY = 'secret-key-1234'
  let dir = ''
  let port = 0
  let close: () => void = () => undefined

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'ccm-tl-'))
    writeFileSync(join(dir, '2026-10-20.jsonl'), '{"t":"key","at":1}\n')
    const server = await startServer({
      host: '127.0.0.1',
      port: 0,
      webDist: tmpdir(),
      store: new MonitorStore({ activityLimit: 10, batchMs: 10 }),
      appKey: KEY,
      timelineDir: dir,
    })
    port = (server.address() as AddressInfo).port
    close = () => server.close()
  })
  afterEach(() => {
    close()
    rmSync(dir, { recursive: true, force: true })
  })

  const get = (path: string, key: string | null = KEY) =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, headers: key ? { 'x-ccm-app': key } : {} }, (res) => {
        let body = ''
        res.on('data', (c: Buffer) => (body += c.toString('utf8')))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
      })
      req.on('error', reject)
      req.end()
    })

  it('lists recorded days', async () => {
    const r = await get('/api/timeline/days')
    expect(r.status).toBe(200)
    const json = JSON.parse(r.body) as { recording: boolean; days: Array<{ day: string }> }
    expect(json.recording).toBe(true)
    expect(json.days.map((d) => d.day)).toEqual(['2026-10-20'])
  })

  it('serves a recorded day', async () => {
    const r = await get('/api/timeline/2026-10-20')
    expect(r.status).toBe(200)
    expect(r.body).toBe('{"t":"key","at":1}\n')
  })

  it('answers 404 for an unrecorded day and 400 for an invalid one', async () => {
    expect((await get('/api/timeline/2026-10-19')).status).toBe(404)
    expect((await get('/api/timeline/..%2Fsecret')).status).toBe(400)
    expect((await get('/api/timeline/nope')).status).toBe(400)
  })

  it('answers 403 without the app key', async () => {
    expect((await get('/api/timeline/days', null)).status).toBe(403)
    expect((await get('/api/timeline/2026-10-20', 'wrong-key-12345')).status).toBe(403)
  })
})
