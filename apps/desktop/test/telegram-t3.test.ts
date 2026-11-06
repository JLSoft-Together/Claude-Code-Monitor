import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parsePhoneEpisode, type TelegramEpisodeMessage, TelegramInbound, TelegramInboundResult } from '@ccm/shared'
import { TelegramNotifier } from '../src/telegram/notifier'
import type { TgFetch } from '../src/telegram/api'

const crypt = { available: () => true, encrypt: (s: string) => Buffer.from(`sealed:${s}`), decrypt: (b: Buffer) => b.toString().replace(/^sealed:/, '') }
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ'
const CHAT = -1001234567890
const A = path.resolve(os.tmpdir(), 'tg-t3', 'A')
const B = path.resolve(os.tmpdir(), 'tg-t3', 'B')
const AGENT = '11111111-2222-4333-8444-555555555555'
const T0 = new Date(2026, 10, 6, 10, 0).getTime()

type Sent = { method: string; body: Record<string, unknown> }
type Reply = { status?: number; body?: unknown } | undefined

function setup(opts: { panes?: () => unknown[]; reply?: (method: string, body: Record<string, unknown>) => Reply; file?: string } = {}) {
  const sent: Sent[] = []
  const clock = { now: T0 }
  let nextId = 100
  const fetch: TgFetch = async (url, init) => {
    const method = url.split('/').pop()!
    if (method === 'getUpdates') return new Promise(() => undefined)
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {}
    sent.push({ method, body })
    const forced = opts.reply?.(method, body)
    if (forced) return { ok: (forced.status ?? 200) < 400, status: forced.status ?? 200, json: async () => forced.body ?? { ok: true, result: true } }
    const result = method === 'getMe' ? { id: 42, username: 'orrery_bot' } : method === 'sendMessage' ? { message_id: nextId++ } : true
    return { ok: true, status: 200, json: async () => ({ ok: true, result }) }
  }
  const file = opts.file ?? path.join(mkdtempSync(path.join(os.tmpdir(), 'tg-t3-')), 'telegram.json')
  const tg = new TelegramNotifier({
    file,
    crypt,
    fetch,
    locale: () => 'vi',
    home: '',
    platform: 'win32',
    now: () => clock.now,
    sleep: async () => undefined,
    askPage: async (req: TelegramInbound): Promise<TelegramInboundResult> => (req.action === 'status' ? { ok: true, action: 'status', panes: (opts.panes?.() ?? []) as never } : { ok: false, error: 'unavailable' }),
  })
  tg.set({ token: TOKEN, enabled: true })
  return { tg, sent, clock, file }
}

const ep = (over: Partial<TelegramEpisodeMessage> = {}): TelegramEpisodeMessage => ({ type: 'telegram', episode: 'e1', reason: 'waiting', terminalId: 't1', name: 'A', cwd: A, ...over })
const texts = (sent: Sent[], method = 'sendMessage') => sent.filter((s) => s.method === method).map((s) => String(s.body.text))
const rate = (secs: number): Reply => ({ status: 429, body: { ok: false, error_code: 429, description: 'Too Many Requests: retry after 30', parameters: { retry_after: secs } } })

describe('one pinned status per topic', () => {
  it('lists every session of the topic, project route and session route together, once', async () => {
    const { tg, sent } = setup({ panes: () => [{ name: 'A1', status: 'working', terminalId: 't1', tool: 'Bash', since: T0 - 120_000 }, { name: 'A2', status: 'waiting', terminalId: 't2' }, { name: 'A3', status: 'idle', terminalId: 't3' }] })
    tg.set({ pinStatus: true })
    tg.setRoute({ project: A, chatId: String(CHAT), threadId: 7 })
    tg.setSessionRoute({ session: AGENT, name: 'A2', project: A, chatId: String(CHAT), threadId: 7 })
    tg.setPanes([{ agent: AGENT, pane: 'p2', terminal: 't2' }])
    await tg.pinTick()
    const posts = texts(sent)
    expect(posts).toHaveLength(1)
    expect(posts[0]).toContain('🟢 A1 — đang chạy · Bash · 2 phút')
    expect(posts[0]).toContain('🟡 A2 — chờ bạn')
    expect(posts[0]).toContain('⚪ A3 — rảnh')
    expect(posts[0]!.match(/A2/g)).toHaveLength(1)
    expect(sent.filter((s) => s.method === 'pinChatMessage')).toHaveLength(1)
    tg.stop()
  })

  it('keeps a session with its own topic out of the project topic and shows a closed one', async () => {
    const { tg, sent } = setup({ panes: () => [{ name: 'A1', status: 'idle', terminalId: 't1' }, { name: 'A2', status: 'working', terminalId: 't2' }] })
    tg.set({ pinStatus: true })
    tg.setRoute({ project: A, chatId: String(CHAT), threadId: 7 })
    tg.setSessionRoute({ session: AGENT, name: 'A2', project: A, chatId: String(CHAT), threadId: 9, keep: true })
    tg.setPanes([{ agent: AGENT, pane: 'p2', terminal: 't2' }])
    await tg.pinTick()
    const [p7, p9] = texts(sent)
    expect(p7).toContain('A1')
    expect(p7).not.toContain('A2')
    expect(p9).toContain('🟢 A2 — đang chạy')
    tg.setPanes([])
    expect(tg.state().sessionRoutes).toHaveLength(1)
    tg.stop()
  })

  it('shows a kept link whose pane is gone as closed, and an empty topic as no session without deleting the pin', async () => {
    let panes: unknown[] = [{ name: 'A1', status: 'idle', terminalId: 't1' }]
    const { tg, sent, clock } = setup({ panes: () => panes })
    tg.set({ pinStatus: true })
    tg.setRoute({ project: A, chatId: String(CHAT), threadId: 7 })
    tg.setSessionRoute({ session: AGENT, name: 'K', project: B, chatId: String(CHAT), threadId: 9, keep: true })
    await tg.pinTick()
    expect(texts(sent)[1]).toContain('⚫ K — đã đóng')
    panes = []
    clock.now += 25_000
    await tg.pinTick()
    const edits = texts(sent, 'editMessageText')
    expect(edits).toHaveLength(1)
    expect(edits[0]).toContain('Không có session nào nối với topic này')
    expect(sent.some((s) => s.method === 'unpinChatMessage')).toBe(false)
    tg.stop()
  })

  it('edits at most once per 20 s per topic, skips unchanged text, and survives a restart without a second pin', async () => {
    let status = 'idle'
    const { tg, sent, clock, file } = setup({ panes: () => [{ name: 'A1', status, terminalId: 't1' }] })
    tg.set({ pinStatus: true })
    tg.setRoute({ project: A, chatId: String(CHAT), threadId: 7 })
    await tg.pinTick()
    status = 'working'
    clock.now += 5_000
    await tg.pinTick()
    expect(texts(sent, 'editMessageText')).toHaveLength(0)
    clock.now += 20_000
    await tg.pinTick()
    expect(texts(sent, 'editMessageText')).toHaveLength(1)
    await tg.pinTick()
    expect(texts(sent, 'editMessageText')).toHaveLength(1)
    tg.stop()

    const again = setup({ file, panes: () => [{ name: 'A1', status, terminalId: 't1' }] })
    again.tg.set({ pinStatus: true })
    await again.tg.pinTick()
    expect(texts(again.sent)).toHaveLength(0)
    expect(texts(again.sent, 'editMessageText')).toHaveLength(1)
    expect(again.sent.some((s) => s.method === 'pinChatMessage')).toBe(false)
    again.tg.stop()
  })

  it('posts and pins a new message when the pinned one was deleted by hand', async () => {
    let status = 'idle'
    const { tg, sent, clock } = setup({
      panes: () => [{ name: 'A1', status, terminalId: 't1' }],
      reply: (m) => (m === 'editMessageText' ? { status: 400, body: { ok: false, description: 'Bad Request: message to edit not found' } } : undefined),
    })
    tg.set({ pinStatus: true })
    tg.setRoute({ project: A, chatId: String(CHAT), threadId: 7 })
    await tg.pinTick()
    status = 'working'
    clock.now += 30_000
    await tg.pinTick()
    expect(texts(sent)).toHaveLength(2)
    expect(sent.filter((s) => s.method === 'pinChatMessage')).toHaveLength(2)
    tg.stop()
  })

  it('pins in General (no thread) and unpins when the last link leaves the topic', async () => {
    const { tg, sent } = setup({ panes: () => [{ name: 'A1', status: 'idle', terminalId: 't1' }] })
    tg.set({ pinStatus: true })
    tg.setRoute({ project: A, chatId: String(CHAT), threadId: null })
    tg.setRoute({ project: B, chatId: String(CHAT), threadId: null })
    await tg.pinTick()
    expect(sent.filter((s) => s.method === 'sendMessage')).toHaveLength(1)
    expect(sent.find((s) => s.method === 'sendMessage')!.body.message_thread_id).toBeUndefined()
    tg.removeRoute(A)
    expect(sent.some((s) => s.method === 'unpinChatMessage')).toBe(false)
    tg.removeRoute(B)
    expect(sent.at(-1)!.method).toBe('unpinChatMessage')
    tg.stop()
  })

  it('moves legacy per-session pins to nothing: unpinned once, no s: key left', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-t3-legacy-'))
    const file = path.join(dir, 'telegram.json')
    const sealed = Buffer.from(`sealed:${TOKEN}`).toString('base64')
    const { writeFileSync } = await import('node:fs')
    writeFileSync(file, JSON.stringify({ enabled: true, token: sealed, pinStatus: true, routes: [{ project: A, label: 'A', chatId: String(CHAT), threadId: 7 }], pins: { [`s:${AGENT}`]: { chatId: String(CHAT), messageId: 31 }, [A]: 77 } }))
    const { tg, sent } = setup({ file, panes: () => [] })
    await tg.pinTick()
    expect(sent.filter((s) => s.method === 'unpinChatMessage').map((s) => s.body.message_id)).toEqual([31, 77])
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf8')).pins)).toEqual([`${CHAT}:7`])
    tg.stop()
  })
})

describe('topic health', () => {
  it('records when a topic last took a message and the error code of a failure, never the text', async () => {
    let fail = false
    const { tg, clock, file } = setup({ reply: (m) => (m === 'sendMessage' && fail ? { status: 403, body: { ok: false, description: 'Forbidden: bot was kicked SECRET-WORDS' } } : undefined) })
    tg.setRoute({ project: A, chatId: String(CHAT), threadId: 7 })
    await tg.handle(ep())
    expect(tg.state().routes[0]).toMatchObject({ lastSentAt: T0 })
    expect(tg.state().routes[0]!.lastError).toBeUndefined()
    fail = true
    clock.now += 60_000
    await tg.handle(ep({ episode: 'e2', terminalId: 't2' }))
    expect(tg.state().routes[0]).toMatchObject({ lastSentAt: T0, lastError: 'chat' })
    const saved = readFileSync(file, 'utf8')
    expect(saved).toContain('"error": "chat"')
    expect(saved).not.toContain('SECRET-WORDS')
    fail = false
    clock.now += 60_000
    await tg.handle(ep({ episode: 'e3', terminalId: 't3' }))
    expect(tg.state().routes[0]!.lastError).toBeUndefined()
    expect(tg.state().routes[0]!.lastSentAt).toBe(clock.now)
    tg.stop()
  })

  it('shows the health of a session route, and reads it back after a restart', async () => {
    const first = setup({})
    first.tg.setRoute({ project: A, chatId: String(CHAT), threadId: 7 })
    first.tg.setSessionRoute({ session: AGENT, name: 'S', project: A, chatId: String(CHAT), threadId: 9, keep: true })
    first.tg.setPanes([{ agent: AGENT, pane: 'p', terminal: 't1' }])
    await first.tg.handle(ep())
    expect(first.tg.state().sessionRoutes[0]).toMatchObject({ lastSentAt: T0 })
    expect(first.tg.state().routes[0]!.lastSentAt).toBeUndefined()
    const second = setup({ file: first.file })
    expect(second.tg.state().sessionRoutes[0]).toMatchObject({ lastSentAt: T0 })
    first.tg.stop()
    second.tg.stop()
  })
})

describe('429 retry_after', () => {
  it('holds a chat for retry_after, queues the message and sends it afterwards', async () => {
    let limited = true
    const { tg, sent, clock } = setup({ reply: (m) => (m === 'sendMessage' && limited ? rate(30) : undefined) })
    tg.setRoute({ project: A, chatId: String(CHAT), threadId: 7 })
    expect(await tg.handle(ep())).toBe(true)
    expect(tg.state().routes[0]).toMatchObject({ lastError: 'rate' })
    expect(tg.state().lastError).toBeNull()
    const calls = sent.filter((s) => s.method === 'sendMessage').length
    await tg.handle(ep({ episode: 'e2', terminalId: 't2' }))
    expect(sent.filter((s) => s.method === 'sendMessage')).toHaveLength(calls)
    clock.now += 10_000
    await tg.flushHeld()
    expect(sent.filter((s) => s.method === 'sendMessage')).toHaveLength(calls)
    limited = false
    clock.now += 21_000
    await tg.flushHeld()
    const sentTexts = texts(sent)
    expect(sentTexts.slice(calls)).toHaveLength(2)
    expect(tg.state().routes[0]!.lastError).toBeUndefined()
    await tg.flushHeld()
    expect(sent.filter((s) => s.method === 'sendMessage')).toHaveLength(calls + 2)
    tg.stop()
  })

  it('keeps the hold when the retry is limited again, and does not touch other chats', async () => {
    let n = 0
    const { tg, sent, clock } = setup({ reply: (m, b) => (m === 'sendMessage' && b.chat_id === String(CHAT) && n++ < 2 ? rate(20) : undefined) })
    tg.setRoute({ project: A, chatId: String(CHAT), threadId: 7 })
    tg.setRoute({ project: B, chatId: '-1009999999999', threadId: null })
    await tg.handle(ep())
    clock.now += 21_000
    await tg.flushHeld()
    expect(n).toBe(2)
    await tg.flushHeld()
    expect(n).toBe(2)
    expect(await tg.handle(ep({ episode: 'other', cwd: B, terminalId: 'tb' }))).toBe(true)
    expect(sent.at(-1)!.body.chat_id).toBe('-1009999999999')
    clock.now += 21_000
    await tg.flushHeld()
    expect(sent.at(-1)!.body.chat_id).toBe(String(CHAT))
    tg.stop()
  })

  it('queues at most 20 messages per chat: the oldest ordinary one goes first, important ones stay', async () => {
    const { tg, sent, clock } = setup({ reply: (m) => (m === 'sendMessage' && clock.now === T0 ? rate(60) : undefined) })
    tg.setRoute({ project: A, chatId: String(CHAT), threadId: 7 })
    await tg.handle(ep({ episode: 'first', reason: 'waiting', terminalId: 'w0', name: 'IMPORTANT-0' }))
    for (let i = 1; i <= 25; i++) {
      await tg.handle(ep({ episode: `d${i}`, reason: 'done', worked: 10 * 60_000, terminalId: `d${i}`, name: `DONE-${i}` }))
    }
    clock.now += 61_000
    for (let i = 0; i < 3; i++) await tg.flushHeld()
    const delivered = texts(sent).filter((t) => t.includes('IMPORTANT-0') || t.includes('DONE-'))
    const afterHold = delivered.slice(1)
    expect(afterHold.length).toBeLessThanOrEqual(20)
    expect(afterHold.some((t) => t.includes('IMPORTANT-0'))).toBe(true)
    expect(afterHold.some((t) => t.includes('DONE-1<'))).toBe(false)
    expect(afterHold.some((t) => t.includes('DONE-25'))).toBe(true)
    tg.stop()
  })
})

describe('limit alerts go to the topics of running projects', () => {
  const info = { window: 'five_hour' as const, usedPct: 82, resetsAt: new Date(2026, 10, 6, 14, 30).getTime() }

  it('posts to each topic with an open session once per reset period, with window, percent and local reset time', async () => {
    const { tg, sent } = setup()
    tg.setRoute({ project: A, chatId: String(CHAT), threadId: 7 })
    tg.setRoute({ project: B, chatId: String(CHAT), threadId: 8 })
    tg.setSessionRoute({ session: AGENT, name: 'S', project: A, chatId: String(CHAT), threadId: 9, keep: true })
    tg.setPanes([
      { agent: AGENT, pane: 'p1', terminal: 't1', cwd: A },
      { agent: '22222222-2222-4333-8444-555555555555', pane: 'p2', terminal: 't2', cwd: A },
    ])
    expect(await tg.alert('limit', info)).toBe(true)
    const posts = sent.filter((s) => s.method === 'sendMessage')
    expect(posts.map((p) => p.body.message_thread_id).sort()).toEqual([7, 9])
    expect(String(posts[0]!.body.text)).toContain('5 giờ')
    expect(String(posts[0]!.body.text)).toContain('82%')
    expect(String(posts[0]!.body.text)).toContain('14:30')
    expect(await tg.alert('limit', info)).toBe(false)
    expect(sent.filter((s) => s.method === 'sendMessage')).toHaveLength(2)
    expect(await tg.alert('limit', { ...info, resetsAt: info.resetsAt + 5 * 3600_000 })).toBe(true)
    expect(sent.filter((s) => s.method === 'sendMessage')).toHaveLength(4)
    tg.stop()
  })

  it('a real hit is its own message after a forecast, and a 7-day reset on another day shows the date', async () => {
    const { tg, sent } = setup()
    tg.setRoute({ project: A, chatId: String(CHAT), threadId: 7 })
    tg.setPanes([{ agent: AGENT, pane: 'p1', terminal: 't1', cwd: A }])
    await tg.alert('limit', info)
    expect(await tg.alert('limit', { ...info, usedPct: 100, hit: true })).toBe(true)
    expect(String(sent.at(-1)!.body.text)).toContain('Đã chạm hạn mức')
    await tg.alert('limit', { window: 'seven_day', usedPct: 100, hit: true, resetsAt: new Date(2026, 10, 9, 8, 5).getTime() })
    expect(String(sent.at(-1)!.body.text)).toContain('7 ngày')
    expect(String(sent.at(-1)!.body.text)).toContain('09/11 08:05')
    tg.stop()
  })

  it('falls back to General of each routed chat when no session is open, once per reset', async () => {
    const { tg, sent } = setup()
    tg.setRoute({ project: A, chatId: String(CHAT), threadId: 7 })
    tg.setRoute({ project: B, chatId: String(CHAT), threadId: 8 })
    expect(await tg.alert('limit', info)).toBe(true)
    const posts = sent.filter((s) => s.method === 'sendMessage')
    expect(posts).toHaveLength(1)
    expect(posts[0]!.body.message_thread_id).toBeUndefined()
    expect(await tg.alert('limit', info)).toBe(false)
    tg.stop()
  })

  it('stays off with alerts off or Telegram off', async () => {
    const { tg, sent } = setup()
    tg.setRoute({ project: A, chatId: String(CHAT), threadId: 7 })
    tg.set({ alerts: false })
    expect(await tg.alert('limit', info)).toBe(false)
    tg.set({ alerts: true, enabled: false })
    expect(await tg.alert('limit', info)).toBe(false)
    expect(sent.filter((s) => s.method === 'sendMessage')).toHaveLength(0)
    tg.stop()
  })
})

describe('limit episode from the collector', () => {
  it('keeps window, percent, reset time and hit for a limit episode and drops garbage', () => {
    const raw = { type: 'phone', episode: 'l:1', reason: 'limit', name: 'Claude', window: 'seven_day', usedPct: 99.6, resetsAt: 1_800_000_000_000, hit: true }
    expect(parsePhoneEpisode(raw)).toMatchObject({ window: 'seven_day', usedPct: 100, resetsAt: 1_800_000_000_000, hit: true })
    expect(parsePhoneEpisode({ ...raw, window: 'hourly', usedPct: 'x', resetsAt: -1, hit: 1 })).not.toHaveProperty('window')
    expect(parsePhoneEpisode({ ...raw, reason: 'disk' })).not.toHaveProperty('window')
  })
})
