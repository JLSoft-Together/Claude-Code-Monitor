import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { ORRERY_ACTIONS, TELEGRAM_INBOUND_ACTION, parseInbound, parseInboundResult, type TelegramEpisodeMessage, type TelegramInbound, type TelegramInboundResult } from '@ccm/shared'
import { TelegramNotifier } from '../src/telegram/notifier'
import type { TgFetch } from '../src/telegram/api'

const crypt = { available: () => true, encrypt: (s: string) => Buffer.from(`sealed:${s}`), decrypt: (b: Buffer) => b.toString().replace(/^sealed:/, '') }
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ'
const CHAT = -1001234567890
const OWNER = 555
const READER = 601
const FULL = 602
const A = path.resolve(os.tmpdir(), 'tg-t2', 'A')
const B = path.resolve(os.tmpdir(), 'tg-t2', 'B')
const SINCE = Date.parse('2026-11-04T10:00:00Z')

type Sent = { method: string; body: Record<string, unknown> }

const pane = (n: number, status = 'idle') => ({ name: `A #${n}`, status, terminalId: `term-${n}`, since: SINCE })

const clock = { now: 3_000_000 }

function setup(opts: { panes?: ReturnType<typeof pane>[]; answer?: (req: TelegramInbound) => TelegramInboundResult } = {}) {
  clock.now = 3_000_000
  const sent: Sent[] = []
  const asked: TelegramInbound[] = []
  const focused: number[] = []
  let nextId = 100
  const fetch: TgFetch = async (url, init) => {
    const method = url.split('/').pop()!
    if (method === 'getUpdates') return new Promise(() => undefined)
    sent.push({ method, body: typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {} })
    const result = method === 'getMe' ? { id: 42, username: 'orrery_bot' } : method === 'sendMessage' ? { message_id: nextId++ } : true
    return { ok: true, status: 200, json: async () => ({ ok: true, result }) }
  }
  const panes = opts.panes ?? [pane(1)]
  const tg = new TelegramNotifier({
    file: path.join(mkdtempSync(path.join(os.tmpdir(), 'tg-t2-')), 'telegram.json'),
    crypt,
    fetch,
    locale: () => 'vi',
    home: '',
    platform: 'win32',
    now: () => clock.now,
    sleep: async () => undefined,
    focusApp: () => focused.push(1),
    askPage: async (req) => {
      asked.push(req)
      if (opts.answer) return opts.answer(req)
      if (req.action === 'status') return { ok: true, action: 'status', panes }
      if (req.action === 'compact' || req.action === 'close' || req.action === 'focus') return { ok: true, action: req.action, name: 'A #1' }
      if (req.action === 'new') return { ok: true, action: 'new', name: 'B' }
      return { ok: true, action: 'keys', name: 'A #1', key: 'esc' }
    },
  })
  tg.set({ token: TOKEN, enabled: true })
  tg.setRoute({ project: A, chatId: String(CHAT), threadId: 7 })
  return { tg, sent, asked, focused }
}

const inTopic = (text: string, from = OWNER, thread: number | null = 7) => ({
  update_id: 1,
  message: { message_id: 50, chat: { id: CHAT, type: 'supergroup' }, ...(thread ? { message_thread_id: thread, is_topic_message: true } : {}), from: { id: from, first_name: 'Chủ' }, text },
})
const press = (data: string, from = OWNER) => ({ update_id: 2, callback_query: { id: 'cb1', from: { id: from }, data, message: { message_id: 100 } } })
const lastOf = (sent: Sent[], method: string) => sent.filter((s) => s.method === method).at(-1)
const keysOf = (s: Sent | undefined) => ((s?.body.reply_markup as { inline_keyboard: { callback_data: string; text: string }[][] } | undefined)?.inline_keyboard.flat() ?? [])
const textOf = (s: Sent | undefined) => String(s?.body.text ?? '')

async function ready(tg: TelegramNotifier) {
  const code = (tg.pair(true) as { ok: true; state: { pairCode: string } }).state.pairCode
  await tg.onUpdate(inTopic(`@orrery_bot pair ${code}`))
  tg.set({ receiving: true })
  tg.set({ members: [{ id: READER, name: 'Xem', level: 'read' }, { id: FULL, name: 'Đủ', level: 'full' }] })
}

const ep = (patch: Partial<TelegramEpisodeMessage>): TelegramEpisodeMessage => ({ type: 'telegram', episode: 'w1', reason: 'waiting', terminalId: 'term-1', name: 'A', cwd: A, since: SINCE, ...patch })

describe('shared protocol of the new commands', () => {
  it('maps compact / close / focus to Orrery actions that only the bot may call', () => {
    expect(TELEGRAM_INBOUND_ACTION.compact).toBe('session.compact')
    expect(TELEGRAM_INBOUND_ACTION.close).toBe('session.closeOwner')
    expect(TELEGRAM_INBOUND_ACTION.focus).toBe('session.focus')
    for (const a of ['session.compact', 'session.closeOwner', 'session.focus'] as const) expect(ORRERY_ACTIONS[a].sources).toEqual(['telegram'])
    expect(parseInbound({ id: 'x', action: 'close', project: A, target: { kind: 'terminal', terminalId: 't' }, evil: 1 })).toEqual({ id: 'x', action: 'close', project: A, target: { kind: 'terminal', terminalId: 't' } })
    expect(parseInbound({ id: 'x', action: 'compact', project: '' })).toBeNull()
    expect(parseInboundResult({ ok: true, action: 'focus', name: 'A' })).toEqual({ ok: true, action: 'focus', name: 'A' })
    expect(parseInboundResult({ ok: true, action: 'esc' })).toEqual({ ok: false, error: 'unavailable' })
    expect(parseInbound({ id: 'x', action: 'keys', project: A, key: 'esc', since: SINCE })).toMatchObject({ key: 'esc', since: SINCE })
  })
})

describe('buttons under a waiting message', () => {
  it('a waiting message offers Esc and the last 20 lines; Esc carries the episode start', async () => {
    const { tg, sent, asked } = setup()
    await ready(tg)
    await tg.handle(ep({}))
    const keys = keysOf(lastOf(sent, 'sendMessage'))
    expect(keys.map((k) => k.text)).toEqual(['⎋ Esc', '📜 20 dòng cuối'])
    await tg.onUpdate(press(keys[0]!.callback_data))
    expect(asked[0]).toMatchObject({ action: 'keys', key: 'esc', project: A, since: SINCE, target: { kind: 'terminal', terminalId: 'term-1' } })
    expect(asked[0]).not.toHaveProperty('tool')
    expect(textOf(lastOf(sent, 'sendMessage'))).toContain('Đã gửi Esc')
    await tg.onUpdate(press(keys[0]!.callback_data))
    expect(asked).toHaveLength(1)
    tg.stop()
  })

  it('without an episode start there is no Esc, only the tail', async () => {
    const { tg, sent } = setup()
    await ready(tg)
    await tg.handle(ep({ since: undefined }))
    expect(keysOf(lastOf(sent, 'sendMessage')).map((k) => k.text)).toEqual(['📜 20 dòng cuối'])
    tg.stop()
  })

  it('a refused Esc (the prompt moved on) answers with the state text and keeps the button', async () => {
    const { tg, sent } = setup({ answer: () => ({ ok: false, error: 'state' }) })
    await ready(tg)
    await tg.handle(ep({}))
    const keys = keysOf(lastOf(sent, 'sendMessage'))
    await tg.onUpdate(press(keys[0]!.callback_data))
    expect(lastOf(sent, 'answerCallbackQuery')!.body.text).toBe('Session đó không còn ở trạng thái này nữa.')
    expect(sent.some((s) => s.method === 'editMessageReplyMarkup')).toBe(false)
    tg.stop()
  })

  it('a read member can press the tail but not Esc; a full member can press both', async () => {
    const { tg, sent, asked } = setup({ answer: (req) => (req.action === 'tail' ? { ok: true, action: 'tail', name: 'A', text: 'line' } : { ok: true, action: 'keys', name: 'A', key: 'esc' }) })
    await ready(tg)
    await tg.handle(ep({}))
    const [esc, tail] = keysOf(lastOf(sent, 'sendMessage'))
    await tg.onUpdate(press(esc!.callback_data, READER))
    expect(asked).toHaveLength(0)
    expect(lastOf(sent, 'answerCallbackQuery')!.body.text).toBe('Bạn không có quyền dùng nút này.')
    await tg.onUpdate(press(tail!.callback_data, READER))
    expect(asked[0]).toMatchObject({ action: 'tail', lines: 20, target: { kind: 'terminal', terminalId: 'term-1' } })
    await tg.onUpdate(press(esc!.callback_data, FULL))
    expect(asked[1]).toMatchObject({ action: 'keys', key: 'esc' })
    tg.stop()
  })

  it('a question keeps its options and adds Esc and the tail; a permission keeps allow / deny first', async () => {
    const { tg, sent } = setup()
    await ready(tg)
    await tg.handle(ep({ episode: 'q1', reason: 'question', ask: { question: 'Which?', options: ['a', 'b'], multi: false } }))
    expect(keysOf(lastOf(sent, 'sendMessage')).map((k) => k.callback_data.slice(0, 2))).toEqual(['qa', 'qa', 'es', 'tl'])
    await tg.handle(ep({ episode: 'q2', reason: 'question', ask: { question: 'Which?', options: ['a'], multi: true } }))
    expect(keysOf(lastOf(sent, 'sendMessage')).map((k) => k.callback_data.slice(0, 2))).toEqual(['es', 'tl'])
    await tg.handle(ep({ episode: 'p1', reason: 'permission', tool: 'Bash' }))
    expect(keysOf(lastOf(sent, 'sendMessage')).map((k) => k.callback_data.slice(0, 2))).toEqual(['ap', 'dn', 'es', 'tl'])
    tg.stop()
  })

  it('adds no buttons while the bot is not receiving', async () => {
    const { tg, sent } = setup()
    await tg.handle(ep({}))
    expect(keysOf(lastOf(sent, 'sendMessage'))).toEqual([])
    tg.stop()
  })
})

describe('/compact, /close, /focus', () => {
  it('compact asks first, then runs the flow on exactly that pane', async () => {
    const { tg, sent, asked } = setup()
    await ready(tg)
    await tg.onUpdate(inTopic('@orrery_bot /compact'))
    expect(asked.map((r) => r.action)).toEqual(['status'])
    const ask = lastOf(sent, 'sendMessage')
    expect(textOf(ask)).toContain('Compact')
    const keys = keysOf(ask)
    expect(keys).toHaveLength(1)
    await tg.onUpdate(press(keys[0]!.callback_data))
    expect(asked[1]).toMatchObject({ action: 'compact', project: A, target: { kind: 'terminal', terminalId: 'term-1' } })
    expect(textOf(lastOf(sent, 'sendMessage'))).toContain('Đã bắt đầu compact')
    expect(sent.some((s) => s.method === 'editMessageReplyMarkup')).toBe(true)
    await tg.onUpdate(press(keys[0]!.callback_data))
    expect(asked).toHaveLength(2)
    tg.stop()
  })

  it('/compact with notes is still typed into the session, not the Orrery flow', async () => {
    const { tg, asked } = setup({ answer: () => ({ ok: true, action: 'send', name: 'A', queued: false }) })
    await ready(tg)
    await tg.onUpdate(inTopic('@orrery_bot /compact keep the api notes'))
    expect(asked[0]).toMatchObject({ action: 'send', text: '/compact keep the api notes' })
    tg.stop()
  })

  it('close needs a confirm, closes the chosen pane, and is owner only', async () => {
    const { tg, sent, asked } = setup()
    await ready(tg)
    await tg.onUpdate(inTopic('@orrery_bot close', FULL))
    expect(asked).toHaveLength(0)
    expect(textOf(lastOf(sent, 'sendMessage'))).toBe('Bạn không có quyền dùng nút này.')
    await tg.onUpdate(inTopic('@orrery_bot close', READER))
    expect(asked).toHaveLength(0)
    await tg.onUpdate(inTopic('@orrery_bot close'))
    const keys = keysOf(lastOf(sent, 'sendMessage'))
    expect(asked.map((r) => r.action)).toEqual(['status'])
    expect(textOf(lastOf(sent, 'sendMessage'))).toContain('Đóng')
    await tg.onUpdate(press(keys[0]!.callback_data, FULL))
    expect(asked).toHaveLength(1)
    await tg.onUpdate(press(keys[0]!.callback_data))
    expect(asked[1]).toMatchObject({ action: 'close', target: { kind: 'terminal', terminalId: 'term-1' } })
    expect(textOf(lastOf(sent, 'sendMessage'))).toContain('Đã đóng')
    tg.stop()
  })

  it('with several panes the owner picks one by name; a stale button after the pane is gone says why', async () => {
    let gone = false
    const { tg, sent, asked } = setup({
      panes: [pane(1), pane(2, 'working')],
      answer: (req) => (req.action === 'status' ? { ok: true, action: 'status', panes: [pane(1), pane(2, 'working')] } : gone ? { ok: false, error: 'gone' } : { ok: true, action: 'close', name: 'A #2' }),
    })
    await ready(tg)
    await tg.onUpdate(inTopic('@orrery_bot close'))
    const pick = keysOf(lastOf(sent, 'sendMessage'))
    expect(pick.map((k) => k.text)).toEqual(['🗑 Đóng A #1 · rảnh · vừa xong', '🗑 Đóng A #2 · đang làm · vừa xong'])
    gone = true
    await tg.onUpdate(press(pick[1]!.callback_data))
    expect(asked.at(-1)).toMatchObject({ action: 'close', target: { kind: 'terminal', terminalId: 'term-2' } })
    expect(lastOf(sent, 'answerCallbackQuery')!.body.text).toContain('không còn mở')
    expect(sent.some((s) => s.method === 'editMessageReplyMarkup')).toBe(false)
    tg.stop()
  })

  it('focus runs at once, brings the window up only when the pane was found, and a read member is refused', async () => {
    const { tg, sent, asked, focused } = setup()
    await ready(tg)
    await tg.onUpdate(inTopic('@orrery_bot focus', READER))
    expect(asked).toHaveLength(0)
    await tg.onUpdate(inTopic('@orrery_bot focus', FULL))
    expect(asked.map((r) => r.action)).toEqual(['status', 'focus'])
    expect(focused).toHaveLength(1)
    expect(textOf(lastOf(sent, 'sendMessage'))).toContain('Orrery đã lên trước')
    tg.stop()
    const none = setup({ answer: (req) => (req.action === 'status' ? { ok: true, action: 'status', panes: [pane(1)] } : { ok: false, error: 'gone' }) })
    await ready(none.tg)
    await none.tg.onUpdate(inTopic('@orrery_bot focus'))
    expect(none.focused).toHaveLength(0)
    none.tg.stop()
  })

  it('says none when the project has no pane, and respects the per-minute inbound limit', async () => {
    const { tg, sent, asked } = setup({ panes: [] })
    await ready(tg)
    await tg.onUpdate(inTopic('@orrery_bot compact'))
    expect(asked.map((r) => r.action)).toEqual(['status'])
    expect(keysOf(lastOf(sent, 'sendMessage'))).toEqual([])
    for (let i = 0; i < 40; i++) await tg.onUpdate(inTopic('@orrery_bot compact'))
    expect(textOf(lastOf(sent, 'sendMessage'))).toContain('nhanh quá')
    tg.stop()
  })
})

describe('/new project picker', () => {
  it('General (no route) offers the routes of the chat and opens the pick with the typed prompt', async () => {
    const { tg, sent, asked } = setup({ panes: [] })
    await ready(tg)
    tg.setRoute({ project: B, chatId: String(CHAT), threadId: 8 })
    await tg.onUpdate(inTopic('@orrery_bot new write the login tests', OWNER, null))
    expect(asked).toHaveLength(0)
    const pick = lastOf(sent, 'sendMessage')
    expect(keysOf(pick).map((k) => k.text)).toEqual(['📁 A', '📁 B'])
    expect(JSON.stringify(pick!.body)).not.toContain('login')
    await tg.onUpdate(press(keysOf(pick)[1]!.callback_data))
    expect(asked.map((r) => r.action)).toEqual(['status', 'new'])
    expect(asked[1]).toMatchObject({ action: 'new', project: B, text: expect.stringContaining('write the login tests') })
    expect(sent.some((s) => s.method === 'editMessageReplyMarkup')).toBe(true)
    await tg.onUpdate(press(keysOf(pick)[0]!.callback_data))
    expect(asked).toHaveLength(2)
    tg.stop()
  })

  it('a topic with two projects asks which one; a topic with one project does not', async () => {
    const { tg, sent, asked } = setup({ panes: [] })
    await ready(tg)
    await tg.onUpdate(inTopic('@orrery_bot new'))
    expect(asked.map((r) => r.action)).toEqual(['status', 'new'])
    asked.length = 0
    tg.setRoute({ project: B, chatId: String(CHAT), threadId: 7 })
    await tg.onUpdate(inTopic('@orrery_bot new'))
    expect(asked).toHaveLength(0)
    expect(keysOf(lastOf(sent, 'sendMessage')).map((k) => k.text)).toEqual(['📁 A', '📁 B'])
    tg.stop()
  })

  it('the pick still offers a new / existing session when the project already has one open', async () => {
    const { tg, sent } = setup({ panes: [pane(1)] })
    await ready(tg)
    tg.setRoute({ project: B, chatId: String(CHAT), threadId: 8 })
    await tg.onUpdate(inTopic('@orrery_bot new fix it', OWNER, null))
    await tg.onUpdate(press(keysOf(lastOf(sent, 'sendMessage'))[0]!.callback_data))
    expect(keysOf(lastOf(sent, 'sendMessage')).map((k) => k.callback_data.slice(0, 2))).toEqual(['nw', 'np'])
    tg.stop()
  })

  it('a read member never gets the picker, and an unrouted chat keeps the old answer', async () => {
    const { tg, sent, asked } = setup({ panes: [] })
    await ready(tg)
    await tg.onUpdate(inTopic('@orrery_bot new x', READER, null))
    expect(asked).toHaveLength(0)
    expect(keysOf(lastOf(sent, 'sendMessage'))).toEqual([])
    tg.removeRoute(A)
    await tg.onUpdate(inTopic('@orrery_bot new x', OWNER, null))
    expect(textOf(lastOf(sent, 'sendMessage'))).toContain('chưa được gán project')
    expect(asked).toHaveLength(0)
    tg.stop()
  })
})

describe('round 2: stale confirms, ownership, scope', () => {
  it('close and compact send the pane status start, so the page can refuse a late press', async () => {
    const { tg, sent, asked } = setup()
    await ready(tg)
    for (const word of ['close', 'compact']) {
      await tg.onUpdate(inTopic(`@orrery_bot ${word}`))
      await tg.onUpdate(press(keysOf(lastOf(sent, 'sendMessage'))[0]!.callback_data))
      expect(asked.at(-1)).toMatchObject({ action: word, since: SINCE })
    }
    tg.stop()
  })

  it('a refused (state) confirm answers and stays pressable; focus sends no since', async () => {
    const { tg, sent, asked } = setup({ answer: (req) => (req.action === 'status' ? { ok: true, action: 'status', panes: [pane(1)] } : { ok: false, error: 'state' }) })
    await ready(tg)
    await tg.onUpdate(inTopic('@orrery_bot close'))
    const keys = keysOf(lastOf(sent, 'sendMessage'))
    await tg.onUpdate(press(keys[0]!.callback_data))
    expect(lastOf(sent, 'answerCallbackQuery')!.body.text).toBe('Session đó không còn ở trạng thái này nữa.')
    expect(sent.some((s) => s.method === 'editMessageReplyMarkup')).toBe(false)
    await tg.onUpdate(inTopic('@orrery_bot focus'))
    expect(asked.at(-1)).toMatchObject({ action: 'focus' })
    expect(asked.at(-1)).not.toHaveProperty('since')
    tg.stop()
  })

  it('a confirm pressed after five minutes is expired and never reaches the page', async () => {
    const { tg, sent, asked } = setup()
    await ready(tg)
    await tg.onUpdate(inTopic('@orrery_bot compact'))
    const keys = keysOf(lastOf(sent, 'sendMessage'))
    clock.now += 5 * 60_000 + 1
    await tg.onUpdate(press(keys[0]!.callback_data))
    expect(asked.map((r) => r.action)).toEqual(['status'])
    expect(lastOf(sent, 'answerCallbackQuery')!.body.text).toBe('Nút này không còn hiệu lực.')
    await tg.onUpdate(press(keys[0]!.callback_data))
    expect(asked).toHaveLength(1)
    tg.stop()
  })

  it('a target that does not resolve to a terminal is gone, never "the only pane"', async () => {
    const { tg, sent, asked } = setup()
    await ready(tg)
    const before = sent.filter((s) => s.method === 'sendMessage').length
    expect((await tg.report(A, 'xong', undefined, 'pty-zz')).ok).toBe(true)
    const botMsg = 100 + before
    const reply = { ...inTopic('@orrery_bot close') }
    ;(reply.message as Record<string, unknown>).reply_to_message = { message_id: botMsg, from: { id: 42 } }
    await tg.onUpdate(reply)
    expect(asked.map((r) => r.action)).toEqual(['status'])
    expect(keysOf(lastOf(sent, 'sendMessage'))).toEqual([])
    expect(textOf(lastOf(sent, 'sendMessage'))).toContain('không còn mở')
    tg.stop()
  })

  it('only the asker or the owner presses a confirm or the project picker', async () => {
    const { tg, sent, asked } = setup({ panes: [pane(1)] })
    await ready(tg)
    await tg.onUpdate(inTopic('@orrery_bot compact', FULL))
    const keys = keysOf(lastOf(sent, 'sendMessage'))
    await tg.onUpdate(press(keys[0]!.callback_data, READER))
    expect(asked).toHaveLength(1)
    const second = { ...inTopic('@orrery_bot compact', FULL) }
    expect(second).toBeTruthy()
    tg.setRoute({ project: B, chatId: String(CHAT), threadId: 8 })
    await tg.onUpdate(inTopic('@orrery_bot new x', FULL, null))
    const pick = keysOf(lastOf(sent, 'sendMessage'))
    const other = 603
    tg.set({ members: [{ id: READER, name: 'Xem', level: 'read' }, { id: FULL, name: 'Đủ', level: 'full' }, { id: other, name: 'Khác', level: 'full' }] })
    await tg.onUpdate(press(pick[0]!.callback_data, other))
    expect(lastOf(sent, 'answerCallbackQuery')!.body.text).toBe('Bạn không có quyền dùng nút này.')
    expect(asked.some((r) => r.action === 'new')).toBe(false)
    await tg.onUpdate(press(pick[0]!.callback_data, FULL))
    expect(asked.some((r) => r.action === 'new' || r.action === 'status')).toBe(true)
    const keys2 = keys
    await tg.onUpdate(press(keys2[0]!.callback_data, OWNER))
    expect(asked.some((r) => r.action === 'compact')).toBe(true)
    tg.stop()
  })

  it('pressing one pane of a pick leaves the confirms of other messages alive', async () => {
    const two = [pane(1), pane(2, 'working')]
    const { tg, sent, asked } = setup({ panes: two })
    await ready(tg)
    await tg.onUpdate(inTopic('@orrery_bot close'))
    const first = keysOf(lastOf(sent, 'sendMessage'))
    await tg.onUpdate(inTopic('@orrery_bot compact'))
    const second = keysOf(lastOf(sent, 'sendMessage'))
    await tg.onUpdate(press(first[0]!.callback_data))
    expect(asked.at(-1)).toMatchObject({ action: 'close', target: { terminalId: 'term-1' } })
    await tg.onUpdate(press(first[1]!.callback_data))
    expect(asked.filter((r) => r.action === 'close')).toHaveLength(1)
    await tg.onUpdate(press(second[1]!.callback_data))
    expect(asked.at(-1)).toMatchObject({ action: 'compact', target: { terminalId: 'term-2' } })
    tg.stop()
  })

  it('/new in an unlinked topic (not General) keeps the link flow instead of the picker', async () => {
    const { tg, sent, asked } = setup({ panes: [] })
    await ready(tg)
    tg.setRoute({ project: B, chatId: String(CHAT), threadId: 8 })
    await tg.onUpdate(inTopic('@orrery_bot new x', OWNER, 99))
    expect(asked).toHaveLength(0)
    expect(keysOf(lastOf(sent, 'sendMessage')).some((k) => k.callback_data.startsWith('pj:'))).toBe(false)
    tg.stop()
  })
})
