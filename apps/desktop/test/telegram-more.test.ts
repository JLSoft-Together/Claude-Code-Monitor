import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseInbound, parseInboundResult, uniquePaneNames, type TelegramInbound, type TelegramInboundResult } from '@ccm/shared'
import { commandOf, readMessage } from '../src/telegram/inbound'
import { TelegramNotifier } from '../src/telegram/notifier'
import { viaTelegram } from '../src/telegram/actions'
import type { TgFetch } from '../src/telegram/api'

const crypt = { available: () => true, encrypt: (s: string) => Buffer.from(`sealed:${s}`), decrypt: (b: Buffer) => b.toString().replace(/^sealed:/, '') }
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ'
const CHAT = -1001234567890
const OWNER = 555
const project = path.resolve(os.tmpdir(), 'tg-more', 'A')
const UUID = '0b7c1e1e-5f7a-4d55-9c6e-2a1b3c4d5e6f'

const ICONS = [{ emoji: '⚡️', custom_emoji_id: 'run' }, { emoji: '❓', custom_emoji_id: 'ask' }, { emoji: '✔️', custom_emoji_id: 'ok' }]

type Sent = { method: string; body: Record<string, unknown> | FormData }

function setup(answer: (req: TelegramInbound) => TelegramInboundResult, extra: Partial<ConstructorParameters<typeof TelegramNotifier>[0]> = {}, failEdit = false) {
  const sent: Sent[] = []
  const asked: TelegramInbound[] = []
  let nextId = 100
  const fetch: TgFetch = async (url, init) => {
    const method = url.split('/').pop()!
    if (method === 'getUpdates') return new Promise(() => undefined)
    const body = init.body instanceof FormData ? init.body : typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {}
    sent.push({ method, body })
    if (method === 'editMessageText' && failEdit) return { ok: false, status: 400, json: async () => ({ ok: false, description: 'Bad Request: message to edit not found' }) }
    const result = method === 'getMe' ? { id: 42, username: 'orrery_bot' } : method === 'getForumTopicIconStickers' ? ICONS : method === 'sendMessage' ? { message_id: nextId++ } : true
    return { ok: true, status: 200, json: async () => ({ ok: true, result }) }
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-more-'))
  const tg = new TelegramNotifier({
    file: path.join(dir, 'telegram.json'),
    crypt,
    fetch,
    locale: () => 'vi',
    home: '',
    platform: 'win32',
    sleep: async () => undefined,
    askPage: async (req) => {
      asked.push(req)
      return answer(req)
    },
    ...extra,
  })
  tg.set({ token: TOKEN, enabled: true })
  tg.setRoute({ project, chatId: String(CHAT), threadId: 7 })
  return { tg, sent, asked }
}

const msg = (text: string, extra: Record<string, unknown> = {}) => ({
  update_id: 1,
  message: { message_id: 50, chat: { id: CHAT, type: 'supergroup' }, message_thread_id: 7, is_topic_message: true, from: { id: OWNER, first_name: 'Chủ' }, text, ...extra },
})
const cb = (data: string) => ({ update_id: 2, callback_query: { id: 'cb', from: { id: OWNER }, data, message: { message_id: 101 } } })
const lastText = (sent: Sent[]) => String((sent.filter((s) => s.method === 'sendMessage').at(-1)!.body as Record<string, unknown>).text)
const keysOf = (sent: Sent[]) => ((sent.filter((s) => s.method === 'sendMessage').at(-1)!.body as Record<string, unknown>).reply_markup as { inline_keyboard: { callback_data: string; text: string }[][] }).inline_keyboard.flat()

async function receiving(tg: TelegramNotifier) {
  const code = (tg.pair(true) as { ok: true; state: { pairCode: string } }).state.pairCode
  await tg.onUpdate(msg(`@orrery_bot pair ${code}`))
  tg.set({ receiving: true })
}

describe('v84 parsing', () => {
  it('reads new / resume / run / all / last', () => {
    const c = (t: string) => commandOf(readMessage(msg(t), 42)!, 'orrery_bot')
    expect(c('@orrery_bot new viết test cho login')).toEqual({ kind: 'new', text: 'viết test cho login' })
    expect(c('@orrery_bot resume')).toEqual({ kind: 'resume' })
    expect(c('@orrery_bot run app debug')).toEqual({ kind: 'run', config: 'app debug' })
    expect(c('@orrery_bot all dừng lại')).toEqual({ kind: 'all', text: 'dừng lại' })
    expect(c('@orrery_bot all')).toEqual({ kind: 'help' })
    expect(c('@orrery_bot /compact')).toEqual({ kind: 'compact' })
    expect(c('@orrery_bot /compact keep the api notes')).toEqual({ kind: 'send', text: '/compact keep the api notes' })
    expect(c('@orrery_bot /clear')).toEqual({ kind: 'send', text: '/clear' })
    expect(c('@orrery_bot close')).toEqual({ kind: 'close' })
    expect(c('@orrery_bot /focus')).toEqual({ kind: 'focus' })
    expect(c('@orrery_bot close the db connection')).toEqual({ kind: 'send', text: 'close the db connection' })
    expect(c('@orrery_bot /hand-off')).toEqual({ kind: 'send', text: '/hand-off' })
    expect(viaTelegram('/clear', 'vi')).toBe('/clear')
    expect(viaTelegram('/hand-off', 'vi')).toBe('/hand-off')
    expect(viaTelegram('/frontend-design /ui-ux-pro-max:ui-ux-pro-max', 'vi')).toBe('/frontend-design /ui-ux-pro-max:ui-ux-pro-max')
    expect(viaTelegram('/compact giữ phần ads', 'vi')).toBe('/compact giữ phần ads')
    expect(viaTelegram('/frontend-design /ui-ux-pro-max làm màn login', 'vi')).toMatch(/^\/frontend-design \/ui-ux-pro-max làm màn login\n\n\(Tin này gửi từ Telegram/)
    expect(c('@orrery_bot last')).toEqual({ kind: 'last' })
    expect(parseInbound({ id: 'x', action: 'resume', project, sessionId: 'nope', cwd: project })).toBeNull()
    expect(parseInboundResult({ ok: true, action: 'resumeList', items: [{ id: UUID, name: 'A', cwd: project, endedAt: 'x' }, { id: 'bad', name: 'B', cwd: project }] })).toEqual({ ok: true, action: 'resumeList', items: [{ id: UUID, name: 'A', cwd: project, endedAt: 'x' }] })
  })
})

describe('v84 commands', () => {
  it('opens a new session and sends to all', async () => {
    const { tg, sent, asked } = setup((req) => (req.action === 'new' ? { ok: true, action: 'new', name: 'A' } : { ok: true, action: 'all', names: ['A', 'A 2'] }))
    await receiving(tg)
    await tg.onUpdate(msg('@orrery_bot new sửa lỗi đăng nhập'))
    expect(asked.map((a) => a.action)).toEqual(['status', 'new'])
    expect(asked[1]).toMatchObject({ action: 'new', project, text: viaTelegram('sửa lỗi đăng nhập', 'vi') })
    expect(lastText(sent)).toContain('Đã mở session Claude mới')
    await tg.onUpdate(msg('@orrery_bot all chạy lint'))
    expect(asked.at(-1)).toMatchObject({ action: 'all', text: viaTelegram('chạy lint', 'vi') })
    expect(lastText(sent)).toContain('<b>A</b>, <b>A 2</b>')
    tg.stop()
  })

  it('asks before opening another session and can send the prompt to an open one', async () => {
    const panes = [{ name: 'A', status: 'idle', terminalId: 't1' }, { name: 'A 2', status: 'working', terminalId: 't2' }]
    const { tg, sent, asked } = setup((req) =>
      req.action === 'status' ? { ok: true, action: 'status', panes } : req.action === 'new' ? { ok: true, action: 'new', name: 'A 3' } : { ok: true, action: 'send', name: 'A 2', queued: true, terminalId: 't2' },
    )
    await receiving(tg)
    await tg.onUpdate(msg('@orrery_bot new sửa lỗi đăng nhập'))
    expect(asked.map((a) => a.action)).toEqual(['status'])
    expect(lastText(sent)).toContain('đang có 2 session')
    const keys = keysOf(sent)
    expect(keys.map((k) => k.text)).toEqual(['➕ Mở session mới', '📨 A · rảnh', '📨 A 2 · đang làm'])
    await tg.onUpdate(cb(keys[2]!.callback_data))
    expect(asked.at(-1)).toMatchObject({ action: 'send', text: viaTelegram('sửa lỗi đăng nhập', 'vi'), target: { kind: 'terminal', terminalId: 't2' } })
    expect(lastText(sent)).toContain('A 2')
    await tg.onUpdate(cb(keys[0]!.callback_data))
    expect(asked.filter((a) => a.action === 'new')).toHaveLength(0)

    await tg.onUpdate(msg('@orrery_bot new'))
    const bare = keysOf(sent)
    expect(bare.map((k) => k.text)).toEqual(['➕ Mở session mới'])
    await tg.onUpdate(cb(bare[0]!.callback_data))
    expect(asked.at(-1)).toMatchObject({ action: 'new', project })
    expect(asked.at(-1)).not.toHaveProperty('text')
    expect(lastText(sent)).toContain('Đã mở session Claude mới')
    tg.stop()
  })

  it('offers a button per session for stop, last and a plain message when several are open', async () => {
    const panes = uniquePaneNames([{ name: 'A', status: 'idle', terminalId: 't1' }, { name: 'A', status: 'working', terminalId: 't2' }])
    expect(panes.map((p) => p.name)).toEqual(['A #1', 'A #2'])
    const { tg, sent, asked } = setup((req) =>
      req.action === 'status' ? { ok: true, action: 'status', panes } : req.action === 'keys' ? { ok: true, action: 'keys', name: 'A #2', key: 'stop' } : req.action === 'send' && !req.target ? { ok: false, error: 'many', panes } : { ok: true, action: 'send', name: 'A #1', queued: false, terminalId: 't1' },
    )
    await receiving(tg)

    await tg.onUpdate(msg('@orrery_bot stop'))
    expect(lastText(sent)).toContain('Dừng session nào?')
    const stop = keysOf(sent)
    expect(stop.map((k) => k.text)).toEqual(['⏹ Dừng A #1 · rảnh', '⏹ Dừng A #2 · đang làm'])
    await tg.onUpdate(cb(stop[1]!.callback_data))
    expect(asked.at(-1)).toMatchObject({ action: 'keys', key: 'stop', target: { kind: 'terminal', terminalId: 't2' } })

    await tg.onUpdate(msg('@orrery_bot last'))
    expect(lastText(sent)).toContain('Xem câu trả lời cuối của session nào?')
    await tg.onUpdate(cb(keysOf(sent)[0]!.callback_data))
    expect(lastText(sent)).toContain('chưa có câu trả lời')

    await tg.onUpdate(msg('@orrery_bot chạy lint'))
    expect(lastText(sent)).toContain('Gửi vào session nào?')
    const send = keysOf(sent)
    expect(send.map((k) => k.text)).toEqual(['📨 A #1 · rảnh', '📨 A #2 · đang làm'])
    await tg.onUpdate(cb(send[0]!.callback_data))
    expect(asked.at(-1)).toMatchObject({ action: 'send', text: viaTelegram('chạy lint', 'vi'), target: { kind: 'terminal', terminalId: 't1' } })
    tg.stop()
  })

  it('puts how long each session has been in its state on the pick buttons, within 64 characters', async () => {
    const clock = Date.now()
    const panes = [
      { name: 'A', status: 'idle', terminalId: 't1', since: clock - 2 * 60_000 },
      { name: 'B', status: 'working', terminalId: 't2', since: clock - 10_000 },
      { name: 'C', status: 'idle', terminalId: 't3', since: clock - 90 * 60_000 },
      { name: 'x'.repeat(80), status: 'idle', terminalId: 't4', since: clock - 3 * 86_400_000 },
    ]
    const { tg, sent } = setup((req) => (req.action === 'status' ? { ok: true, action: 'status', panes } : { ok: false, error: 'many', panes }), { now: () => clock })
    await receiving(tg)
    await tg.onUpdate(msg('@orrery_bot stop'))
    const texts = keysOf(sent).map((k) => k.text)
    expect(texts.slice(0, 3)).toEqual(['⏹ Dừng A · rảnh · 2 phút', '⏹ Dừng B · đang làm · vừa xong', '⏹ Dừng C · rảnh · 1 giờ'])
    expect(texts[3]).toMatch(/…( · rảnh · 3 ngày)$/)
  })

  it('routes one session to its own topic: reports, telegram_send and commands from that topic', async () => {
    const AGENT = '11111111-2222-4333-8444-555555555555'
    const { tg, sent, asked } = setup((req) => (req.action === 'status' ? { ok: true, action: 'status', panes: [{ name: 'A', status: 'idle', terminalId: 't1' }, { name: 'B', status: 'idle', terminalId: 't2' }] } : { ok: true, action: 'send', name: 'B', queued: false, terminalId: 't2' }))
    await receiving(tg)
    expect(tg.setSessionRoute({ session: AGENT, name: 'B', project, link: 't.me/c/1234567890/9/100' }).ok).toBe(true)
    expect(tg.state().sessionRoutes).toEqual([{ session: AGENT, name: 'B', project, chatId: '-1001234567890', threadId: 9, where: '-1001234567890 › #9' }])
    tg.setPanes([{ agent: AGENT, pane: 'p2', terminal: 't2' }])

    await tg.report(project, 'xong', undefined, 'p2')
    expect((sent.filter((s) => s.method === 'sendMessage').at(-1)!.body as Record<string, unknown>).message_thread_id).toBe(9)
    await tg.report(project, 'xong', undefined, 'p1')
    expect((sent.filter((s) => s.method === 'sendMessage').at(-1)!.body as Record<string, unknown>).message_thread_id).toBe(7)

    await tg.onUpdate(msg('@orrery_bot chạy lint', { message_thread_id: 9 }))
    expect(asked.at(-1)).toMatchObject({ action: 'send', target: { kind: 'terminal', terminalId: 't2' } })

    expect(tg.removeSessionRoute(AGENT).ok).toBe(true)
    expect(tg.state().sessionRoutes).toEqual([])
    tg.stop()
  })

  it('frees the topic when its running session ends, and resume from that topic still lists the project', async () => {
    const AGENT = '11111111-2222-4333-8444-555555555555'
    const { tg, sent, asked } = setup((req) => (req.action === 'resumeList' ? { ok: true, action: 'resumeList', items: [{ id: AGENT, name: 'B', cwd: project, endedAt: '2026-11-05T10:00:00Z' }] } : { ok: true, action: 'status', panes: [] }))
    await receiving(tg)
    tg.setSessionRoute({ session: AGENT, name: 'B', project, link: 't.me/c/1234567890/9/100' })
    tg.setPanes([{ agent: AGENT, pane: 'p2', terminal: 't2' }])
    tg.setPanes([{ agent: AGENT, pane: 'p2', terminal: 't2' }, { agent: '22222222-2222-4333-8444-555555555555', pane: 'p3' }])
    expect(tg.state().sessionRoutes).toHaveLength(1)

    tg.setPanes([{ agent: AGENT, pane: 'p2' }])
    expect(tg.state().sessionRoutes).toEqual([])
    await tg.onUpdate(msg('@orrery_bot resume', { message_thread_id: 9 }))
    expect(asked.at(-1)).toMatchObject({ action: 'resumeList', project })
    expect(keysOf(sent).map((k) => k.text)).toEqual(['↩️ B'])
    tg.stop()
  })

  it('keeps one session per topic, follows a new session id in the same pane and a renamed pane', async () => {
    const OLD = '11111111-2222-4333-8444-555555555555'
    const NEW = '66666666-2222-4333-8444-555555555555'
    const NEXT = '77777777-2222-4333-8444-555555555555'
    const { tg, asked } = setup((req) => (req.action === 'status' ? { ok: true, action: 'status', panes: [] } : { ok: true, action: 'send', name: 'B', queued: false, terminalId: 't2' }))
    await receiving(tg)
    tg.setSessionRoute({ session: OLD, name: 'A', project, link: 't.me/c/1234567890/9/100' })
    tg.setSessionRoute({ session: NEW, name: 'B', project, link: 't.me/c/1234567890/9/100', keep: true })
    expect(tg.state().sessionRoutes.map((r) => r.session)).toEqual([NEW])

    tg.setPanes([{ agent: NEW, pane: 'p2', terminal: 't2', name: 'B' }])
    tg.setPanes([{ agent: NEXT, pane: 'p2', terminal: 't2', name: 'B dev' }])
    expect(tg.state().sessionRoutes).toMatchObject([{ session: NEXT, name: 'B dev', threadId: 9 }])
    await tg.onUpdate(msg('@orrery_bot chạy lint', { message_thread_id: 9 }))
    expect(asked.at(-1)).toMatchObject({ action: 'send', target: { kind: 'terminal', terminalId: 't2' } })
    tg.stop()
  })

  it('/clear without keep frees the topic and offers the new session; an ended one offers resume', async () => {
    const A = '11111111-2222-4333-8444-555555555555'
    const B = '66666666-2222-4333-8444-555555555555'
    const flush = () => new Promise((r) => setTimeout(r, 0))
    const { tg, sent } = setup(() => ({ ok: true, action: 'status', panes: [] }))
    await receiving(tg)
    tg.setSessionRoute({ session: A, name: 'Build', project, chatId: String(CHAT), threadId: 9 })
    tg.setPanes([{ agent: A, pane: 'p2', terminal: 't2', name: 'Build', cwd: project }])
    tg.setPanes([{ agent: B, pane: 'p2', terminal: 't2', name: 'Build', cwd: project }])
    await flush()
    expect(tg.state().sessionRoutes).toEqual([])
    const notice = sent.filter((x) => x.method === 'sendMessage').at(-1)!.body as Record<string, unknown>
    expect(notice).toMatchObject({ message_thread_id: 9, disable_notification: true })
    expect(lastText(sent)).toContain('/clear')
    const link = keysOf(sent)
    expect(link.map((k) => k.text)).toEqual(['🔗 Build'])
    await tg.onUpdate(cb(link[0]!.callback_data))
    expect(tg.state().sessionRoutes).toMatchObject([{ session: B, threadId: 9 }])

    tg.setPanes([])
    await flush()
    expect(tg.state().sessionRoutes).toEqual([])
    expect(lastText(sent)).toContain('đã kết thúc')
    expect(keysOf(sent).map((k) => k.text)).toEqual(['↩️ Build'])
    tg.stop()
  })

  it('frees, a few minutes after start, a link whose session ended while the app was off', async () => {
    const A = '11111111-2222-4333-8444-555555555555'
    const B = '66666666-2222-4333-8444-555555555555'
    const C = '77777777-2222-4333-8444-555555555555'
    let now = Date.parse('2026-11-05T09:00:00Z')
    const { tg, sent } = setup(() => ({ ok: true, action: 'status', panes: [] }), { now: () => now })
    tg.setSessionRoute({ session: A, name: 'Gone', project, chatId: String(CHAT), threadId: 9 })
    tg.setSessionRoute({ session: B, name: 'Back', project, chatId: String(CHAT), threadId: 10 })
    tg.setSessionRoute({ session: C, name: 'Kept', project, chatId: String(CHAT), threadId: 11, keep: true })
    tg.setPanes([{ agent: B, pane: 'p2' }])
    expect(tg.state().sessionRoutes).toHaveLength(3)
    now += 60_000
    tg.setPanes([{ agent: B, pane: 'p2', terminal: 't2' }])
    await tg.tick()
    expect(tg.state().sessionRoutes).toHaveLength(3)
    now += 3 * 60_000
    await tg.tick()
    await new Promise((r) => setTimeout(r, 0))
    expect(tg.state().sessionRoutes.map((r) => r.session)).toEqual([B, C])
    expect(lastText(sent)).toContain('<b>Gone</b> đã kết thúc')
    now += 60_000
    tg.setPanes([])
    expect(tg.state().sessionRoutes.map((r) => r.session)).toEqual([C])
    tg.stop()
  })

  it('a kept link stays when its session ends', async () => {
    const A = '11111111-2222-4333-8444-555555555555'
    const { tg } = setup(() => ({ ok: true, action: 'status', panes: [] }))
    tg.setSessionRoute({ session: A, name: 'Build', project, chatId: String(CHAT), threadId: 9, keep: true })
    tg.setPanes([{ agent: A, pane: 'p2', terminal: 't2' }])
    tg.setPanes([])
    expect(tg.state().sessionRoutes).toMatchObject([{ session: A, keep: true }])
    tg.setSessionRoute({ session: A, name: 'Build', project, chatId: String(CHAT), threadId: 10 })
    expect(tg.state().sessionRoutes).toMatchObject([{ threadId: 10, keep: true }])
    tg.stop()
  })

  it('where tells what the topic is connected to and disconnects it', async () => {
    const A = '11111111-2222-4333-8444-555555555555'
    const { tg, sent } = setup(() => ({ ok: true, action: 'status', panes: [] }))
    await receiving(tg)
    expect(commandOf(readMessage(msg('@orrery_bot where'), 42)!, 'orrery_bot')).toEqual({ kind: 'where' })
    tg.setSessionRoute({ session: A, name: 'Build', project, chatId: String(CHAT), threadId: 9 })
    tg.setPanes([{ agent: A, pane: 'p2', terminal: 't2' }])
    await tg.onUpdate(msg('@orrery_bot where', { message_thread_id: 9 }))
    expect(lastText(sent)).toContain('session <b>Build</b> — đang mở')
    await tg.onUpdate(cb(keysOf(sent)[0]!.callback_data))
    expect(tg.state().sessionRoutes).toEqual([])
    expect(lastText(sent)).toContain('Đã ngắt topic này khỏi <b>Build</b>')

    await tg.onUpdate(msg('@orrery_bot where'))
    expect(lastText(sent)).toContain('project <b>A</b>')
    await tg.onUpdate(cb(keysOf(sent)[0]!.callback_data))
    expect(tg.state().routes).toEqual([])
    tg.stop()
  })

  it('marks a topic broken when Telegram says it is gone, and a session test goes to its own topic', async () => {
    const A = '11111111-2222-4333-8444-555555555555'
    let gone = true
    const sent: string[] = []
    const fetch: TgFetch = async (url, init) => {
      const method = url.split('/').pop()!
      if (method === 'getUpdates') return new Promise(() => undefined)
      if (method === 'getMe') return { ok: true, status: 200, json: async () => ({ ok: true, result: { id: 42, username: 'orrery_bot' } }) }
      sent.push(String(init.body))
      return gone ? { ok: false, status: 400, json: async () => ({ ok: false, description: 'Bad Request: message thread not found' }) } : { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) }
    }
    const { tg } = setup(() => ({ ok: true, action: 'status', panes: [] }), { fetch })
    tg.setSessionRoute({ session: A, name: 'Build', project, chatId: String(CHAT), threadId: 9 })
    expect((await tg.test(undefined, A)).ok).toBe(false)
    expect(sent.at(-1)).toContain('"message_thread_id":9')
    expect(tg.state().sessionRoutes[0]!.broken).toBe(true)
    expect(tg.state().routes[0]!.broken).toBeUndefined()
    gone = false
    expect((await tg.test(undefined, A)).ok).toBe(true)
    expect(tg.state().sessionRoutes[0]!.broken).toBeUndefined()
    tg.stop()
  })

  it('offers to connect an unassigned topic to an open session or its project', async () => {
    const AGENT = '11111111-2222-4333-8444-555555555555'
    const other = path.resolve(os.tmpdir(), 'tg-more', 'B')
    const { tg, sent } = setup(() => ({ ok: true, action: 'status', panes: [] }))
    await receiving(tg)
    tg.setPanes([{ agent: AGENT, pane: 'p2', terminal: 't2', name: 'Build bot', cwd: other }])
    await tg.onUpdate(msg('@orrery_bot status', { message_thread_id: 12 }))
    expect(lastText(sent)).toContain('Topic này chưa nối với gì')
    const keys = keysOf(sent)
    expect(keys.map((k) => k.text)).toEqual(['🔗 Build bot', '📁 B'])
    await tg.onUpdate(cb(keys[0]!.callback_data))
    expect(tg.state().sessionRoutes).toMatchObject([{ session: AGENT, name: 'Build bot', project: other, chatId: String(CHAT), threadId: 12 }])
    expect(lastText(sent)).toContain('Đã nối topic này với <b>Build bot</b>')
    await tg.onUpdate(cb(keys[1]!.callback_data))
    expect(tg.state().routes.some((r) => r.project === other)).toBe(false)

    await tg.onUpdate(msg('@orrery_bot status', { message_thread_id: 13 }))
    await tg.onUpdate(cb(keysOf(sent)[1]!.callback_data))
    expect(tg.state().routes.find((r) => r.project === other)).toMatchObject({ chatId: String(CHAT), threadId: 13 })
    tg.stop()
  })

  it('a reply to a bot message reaches its Claude session after a restart and a resume', async () => {
    const AGENT = '11111111-2222-4333-8444-555555555555'
    const answer = (req: TelegramInbound): TelegramInboundResult => (req.action === 'status' ? { ok: true, action: 'status', panes: [] } : { ok: true, action: 'send', name: 'B', queued: false, terminalId: 't2' })
    const { tg, sent } = setup(answer)
    tg.setPanes([{ agent: AGENT, pane: 'p2', terminal: 't2' }])
    await tg.report(project, 'xong', undefined, 'p2')
    const reportId = (sent.filter((s) => s.method === 'sendMessage').length + 99)
    tg.stop()

    const file = (tg as unknown as { deps: { file: string } }).deps.file
    const again = setup(answer, { file })
    await receiving(again.tg)
    again.tg.setPanes([{ agent: AGENT, pane: 'p9', terminal: 't9' }])
    await again.tg.onUpdate(msg('thêm test', { reply_to_message: { message_id: reportId, from: { id: 42, is_bot: true } } }))
    expect(again.asked.at(-1)).toMatchObject({ action: 'send', target: { kind: 'terminal', terminalId: 't9' } })

    again.tg.setPanes([])
    await again.tg.onUpdate(msg('thêm test', { reply_to_message: { message_id: reportId, from: { id: 42, is_bot: true } } }))
    expect(lastText(again.sent)).toContain('chưa mở trong Orrery')
    again.tg.stop()
  })

  it('lists ended sessions and resumes the picked one', async () => {
    const { tg, sent, asked } = setup((req) =>
      req.action === 'resumeList' ? { ok: true, action: 'resumeList', items: [{ id: UUID, name: 'A', cwd: project, endedAt: '2026-11-04T10:00:00Z' }] } : { ok: true, action: 'resume', name: 'A' },
    )
    await receiving(tg)
    await tg.onUpdate(msg('@orrery_bot resume'))
    const keys = keysOf(sent)
    expect(keys.map((k) => k.text)).toEqual(['↩️ A'])
    await tg.onUpdate(cb(keys[0]!.callback_data))
    expect(asked.at(-1)).toMatchObject({ action: 'resume', sessionId: UUID, cwd: project })
    expect(lastText(sent)).toContain('Đã mở lại')
    tg.stop()
  })

  it('answers the last reply of the only session, masked', async () => {
    const { tg, sent } = setup(() => ({ ok: true, action: 'status', panes: [{ name: 'A', status: 'idle', terminalId: 't1' }] }))
    await receiving(tg)
    await tg.onUpdate(msg('@orrery_bot last'))
    expect(lastText(sent)).toContain('chưa có câu trả lời')
    await tg.handle({ type: 'telegram', episode: 'e', reason: 'done', terminalId: 't1', name: 'A', cwd: project, worked: 10, reply: 'Xong rồi token=abcdef123456' })
    await tg.onUpdate(msg('@orrery_bot last'))
    expect(lastText(sent)).toContain('Câu trả lời cuối của <b>A</b>')
    expect(lastText(sent)).toContain('token=[masked]')
    tg.stop()
  })

  it('runs a config, shows a screenshot once running, and attaches the log on failure', async () => {
    const started: string[] = []
    const { tg, sent } = setup(() => ({ ok: false, error: 'none' }), {
      runConfigs: async () => [
        { id: 'c1', name: 'app debug' },
        { id: 'c2', name: 'app release' },
      ],
      runStart: async (_p, id) => {
        started.push(id)
        return { ok: true, sessionId: 'run-1' }
      },
      runLog: () => ['line 1', 'FAILURE: Build failed'],
      screenshot: async () => ({ ok: true, png: 'x.png', device: 'Pixel 8' }),
      readFile: async () => Buffer.from('png'),
    })
    await receiving(tg)
    await tg.onUpdate(msg('@orrery_bot run'))
    const keys = keysOf(sent)
    expect(keys.map((k) => k.text)).toEqual(['▶️ app debug', '▶️ app release'])
    await tg.onUpdate(cb(keys[1]!.callback_data))
    expect(started).toEqual(['c2'])
    expect(lastText(sent)).toContain('Đang chạy <b>app release</b>')
    await tg.runState({ id: 'run-1', state: 'running', configName: 'app release', deviceId: null })
    const photo = sent.find((s) => s.method === 'sendPhoto')!.body as FormData
    expect(String(photo.get('caption'))).toContain('Pixel 8')
    await tg.runState({ id: 'run-1', state: 'running', configName: 'app release', deviceId: null })
    expect(sent.filter((s) => s.method === 'sendPhoto')).toHaveLength(1)
    expect(await tg.runFailedReport({ id: 'run-1', cwd: project, configName: 'app release', failure: { code: 'gradle' } })).toBe(true)
    const doc = sent.find((s) => s.method === 'sendDocument')!.body as FormData
    expect(await (doc.get('document') as Blob).text()).toContain('FAILURE: Build failed')
    tg.stop()
  })
})

describe('pinned status and health', () => {
  it('posts and pins once, edits only on change, and recreates a deleted pin', async () => {
    let clock = Date.now()
    let panes = [{ name: 'A', status: 'working', tool: 'Bash', since: clock - 3 * 60_000 }]
    const first = setup(() => ({ ok: true, action: 'status', panes }), { now: () => clock })
    first.tg.set({ pinStatus: true })
    await first.tg.pinTick()
    expect(first.sent.map((s) => s.method)).toEqual(expect.arrayContaining(['sendMessage', 'pinChatMessage']))
    expect(lastText(first.sent)).toContain('A — đang chạy · Bash · 3 phút')
    await first.tg.pinTick()
    expect(first.sent.filter((s) => s.method === 'editMessageText')).toHaveLength(0)
    panes = [{ name: 'A', status: 'idle', tool: undefined as unknown as string, since: clock }]
    clock += 25_000
    await first.tg.pinTick()
    expect(first.sent.filter((s) => s.method === 'editMessageText')).toHaveLength(1)
    expect(first.tg.state().health.sentToday).toBeGreaterThanOrEqual(2)

    const gone = setup(() => ({ ok: true, action: 'status', panes }), { now: () => clock }, true)
    gone.tg.set({ pinStatus: true })
    await gone.tg.pinTick()
    panes = [{ name: 'A', status: 'working', tool: 'Edit', since: clock }]
    clock += 25_000
    await gone.tg.pinTick()
    expect(gone.sent.filter((s) => s.method === 'pinChatMessage')).toHaveLength(2)
    expect(gone.tg.state().health.errorsToday).toBe(1)
  })

  it('pins a session topic with only its own session', async () => {
    const AGENT = '11111111-2222-4333-8444-555555555555'
    const { tg, sent } = setup(() => ({ ok: true, action: 'status', panes: [{ name: 'A', status: 'idle', terminalId: 't1' }, { name: 'B', status: 'working', terminalId: 't2' }] }))
    tg.set({ pinStatus: true })
    tg.setSessionRoute({ session: AGENT, name: 'B', project, link: 't.me/c/1234567890/9/100' })
    tg.setPanes([{ agent: AGENT, pane: 'p2', terminal: 't2' }])
    await tg.pinTick()
    const posts = sent.filter((s) => s.method === 'sendMessage').map((s) => s.body as Record<string, unknown>)
    expect(posts.map((p) => p.message_thread_id)).toEqual([7, 9])
    expect(String(posts[0]!.text)).toContain('A — rảnh')
    expect(String(posts[1]!.text)).toContain('B — đang chạy')
    expect(String(posts[1]!.text)).not.toContain('A — rảnh')
    expect(sent.filter((s) => s.method === 'pinChatMessage')).toHaveLength(2)
    tg.removeSessionRoute(AGENT)
    expect(sent.at(-1)!.method).toBe('unpinChatMessage')
  })
})

describe('topic icons', () => {
  it('shows the most urgent state per topic, keeps a session to its own topic and clears on off', async () => {
    const AGENT = '11111111-2222-4333-8444-555555555555'
    let panes = [{ name: 'A', status: 'working', terminalId: 't1' }, { name: 'B', status: 'waiting', terminalId: 't2' }]
    let now = Date.parse('2026-11-05T09:00:00Z')
    const { tg, sent } = setup(() => ({ ok: true, action: 'status', panes }), { now: () => now })
    tg.setSessionRoute({ session: AGENT, name: 'B', project, chatId: String(CHAT), threadId: 9 })
    tg.setPanes([{ agent: AGENT, pane: 'p2', terminal: 't2' }])
    await tg.iconTick()
    expect(sent.some((s) => s.method === 'editForumTopic')).toBe(false)
    tg.set({ topicIcons: true })
    await tg.iconTick()
    const edits = () => sent.filter((s) => s.method === 'editForumTopic').map((s) => s.body as Record<string, unknown>)
    expect(edits().map((e) => [e.message_thread_id, e.icon_custom_emoji_id])).toEqual([[7, 'run'], [9, 'ask']])
    await tg.iconTick()
    expect(edits()).toHaveLength(2)
    panes = [{ name: 'A', status: 'idle', terminalId: 't1' }, { name: 'B', status: 'waiting', terminalId: 't2' }]
    await tg.iconTick()
    expect(edits()).toHaveLength(2)
    now += 30_000
    await tg.iconTick()
    expect(edits().at(-1)).toMatchObject({ message_thread_id: 7, icon_custom_emoji_id: 'ok' })
    tg.set({ topicIcons: false })
    await new Promise((r) => setTimeout(r, 0))
    expect(edits().slice(-2).map((e) => e.icon_custom_emoji_id)).toEqual(['', ''])
    tg.stop()
  })
})
