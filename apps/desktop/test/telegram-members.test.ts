import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseTelegramMembers, sanitizeTelegramPatch, type TelegramInbound, type TelegramInboundResult } from '@ccm/shared'
import { ACT_TEXT } from '../src/telegram/actions'
import { TEXT } from '../src/telegram/inbound'
import { TelegramNotifier } from '../src/telegram/notifier'
import type { TgFetch } from '../src/telegram/api'

const crypt = { available: () => true, encrypt: (s: string) => Buffer.from(`sealed:${s}`), decrypt: (b: Buffer) => b.toString().replace(/^sealed:/, '') }
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ'
const CHAT = -1001234567890
const OWNER = 555
const READER = 601
const FULL = 602
const STRANGER = 999
const project = path.resolve(os.tmpdir(), 'tg-members', 'A')
const SINCE = Date.parse('2026-11-04T10:00:00Z')

type Sent = { method: string; body: Record<string, unknown> }

function setup(answer?: (req: TelegramInbound) => TelegramInboundResult) {
  const sent: Sent[] = []
  const asked: TelegramInbound[] = []
  const inbound: string[] = []
  let nextId = 100
  const fetch: TgFetch = async (url, init) => {
    const method = url.split('/').pop()!
    if (method === 'getUpdates') return new Promise(() => undefined)
    sent.push({ method, body: typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {} })
    const result = method === 'getMe' ? { id: 42, username: 'orrery_bot' } : method === 'sendMessage' ? { message_id: nextId++ } : true
    return { ok: true, status: 200, json: async () => ({ ok: true, result }) }
  }
  const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'tg-members-')), 'telegram.json')
  const tg = new TelegramNotifier({
    file,
    crypt,
    fetch,
    locale: () => 'vi',
    home: '',
    platform: 'win32',
    now: () => 3_000_000,
    sleep: async () => undefined,
    onInbound: (e) => inbound.push(e.from),
    askPage: async (req) => {
      asked.push(req)
      return (answer ?? (() => ({ ok: true, action: 'send', name: 'A', queued: false, terminalId: 'term-1' })))(req)
    },
  })
  tg.set({ token: TOKEN, enabled: true })
  tg.setRoute({ project, chatId: String(CHAT), threadId: 7 })
  return { tg, sent, asked, inbound, file }
}

const msg = (text: string, from: number, name = 'Ai đó') => ({
  update_id: 1,
  message: { message_id: 50, chat: { id: CHAT, type: 'supergroup' }, message_thread_id: 7, is_topic_message: true, from: { id: from, first_name: name }, text },
})
const cb = (data: string, from: number) => ({ update_id: 2, callback_query: { id: 'cb1', from: { id: from }, data, message: { message_id: 100 } } })
const texts = (sent: Sent[]) => sent.filter((s) => s.method === 'sendMessage').map((s) => String(s.body.text))
const answers = (sent: Sent[]) => sent.filter((s) => s.method === 'answerCallbackQuery').map((s) => s.body.text)
const buttons = (s: Sent | undefined) => ((s?.body.reply_markup as { inline_keyboard: { callback_data: string }[][] } | undefined)?.inline_keyboard.flat() ?? []).map((b) => b.callback_data)

async function ready(tg: TelegramNotifier) {
  const code = (tg.pair(true) as { ok: true; state: { pairCode: string } }).state.pairCode
  await tg.onUpdate(msg(`@orrery_bot pair ${code}`, OWNER, 'Chủ'))
  tg.set({ receiving: true })
  expect(tg.set({ members: [{ id: READER, name: 'Xem', level: 'read' }, { id: FULL, name: 'Đủ', level: 'full' }] }).ok).toBe(true)
}

describe('team members (WP-D)', () => {
  it('a read member gets status, but a prompt / stop / new is refused and never reaches the page', async () => {
    const { tg, sent, asked } = setup((req) => (req.action === 'status' ? { ok: true, action: 'status', panes: [{ name: 'A', status: 'idle', terminalId: 'term-1' }] } : { ok: true, action: 'send', name: 'A', queued: false }))
    await ready(tg)
    await tg.onUpdate(msg('@orrery_bot status', READER))
    expect(asked.map((r) => r.action)).toEqual(['status'])
    expect(texts(sent).at(-1)).toContain('A')
    for (const text of ['@orrery_bot làm login đi', '@orrery_bot stop', '@orrery_bot new viết test', '@orrery_bot all chạy test', '@orrery_bot screen']) {
      await tg.onUpdate(msg(text, READER))
      expect(texts(sent).at(-1)).toBe(TEXT.vi.readOnly)
    }
    expect(asked.map((r) => r.action)).toEqual(['status'])
    tg.stop()
  })

  it('a read member may press 💬 / 📜 / 📄 but not ⏹, ▶️ or Allow', async () => {
    const { tg, sent, asked } = setup((req) => (req.action === 'status' ? { ok: true, action: 'status', panes: [{ name: 'A', status: 'working', terminalId: 'term-1' }, { name: 'B', status: 'idle', terminalId: 'term-2' }] } : { ok: true, action: 'tail', name: 'A', text: 'line' }))
    await ready(tg)
    await tg.onUpdate(msg('@orrery_bot tail', READER))
    const tl = buttons(sent.filter((s) => s.method === 'sendMessage').at(-1))[0]!
    expect(tl).toMatch(/^tl:/)
    await tg.onUpdate(cb(tl, READER))
    expect(asked.at(-1)).toMatchObject({ action: 'tail' })
    await tg.onUpdate(msg('@orrery_bot stop', OWNER))
    const st = buttons(sent.filter((s) => s.method === 'sendMessage').at(-1))[0]!
    const before = asked.length
    await tg.onUpdate(cb(st, READER))
    await tg.onUpdate(cb('ap:abcdef123456', READER))
    expect(asked.length).toBe(before)
    expect(answers(sent).slice(-2)).toEqual([ACT_TEXT.vi.notAllowed, ACT_TEXT.vi.notAllowed])
    tg.stop()
  })

  it('a full member’s prompt reaches the session under the name the owner saved, not the Telegram display name', async () => {
    const { tg, asked, inbound } = setup()
    await ready(tg)
    await tg.onUpdate(msg('@orrery_bot sửa nút login', FULL, 'Chủ'))
    expect(asked.at(-1)).toMatchObject({ action: 'send', from: 'Đủ' })
    expect((asked.at(-1) as { text: string }).text).toContain('sửa nút login')
    expect((asked.at(-1) as { text: string }).text).toContain('telegram_send')
    expect(inbound.at(-1)).toBe('Đủ')
    tg.stop()
  })

  it('a full member may press ⏹ but not Allow / Deny, topic links or the backlog', async () => {
    const { tg, sent, asked } = setup((req) => (req.action === 'status' ? { ok: true, action: 'status', panes: [{ name: 'A', status: 'working', terminalId: 'term-1', since: SINCE }] } : { ok: true, action: 'keys', name: 'A', key: req.action === 'keys' ? req.key : 'stop' }))
    await ready(tg)
    await tg.handle({ type: 'telegram', episode: 'p1', reason: 'permission', terminalId: 'term-1', name: 'A', cwd: project, tool: 'Bash', since: SINCE })
    const keys = buttons(sent.filter((s) => s.method === 'sendMessage').at(-1))
    const ap = keys.find((k) => k.startsWith('ap:'))!
    const before = asked.length
    for (const data of [ap, keys.find((k) => k.startsWith('dn:'))!, 'lk:abcdef123456', 'bg:abcdef123456']) await tg.onUpdate(cb(data, FULL))
    expect(asked.length).toBe(before)
    expect(answers(sent).slice(-4)).toEqual(Array(4).fill(ACT_TEXT.vi.notAllowed))
    await tg.onUpdate(msg('@orrery_bot stop', FULL))
    const st = buttons(sent.filter((s) => s.method === 'sendMessage').at(-1)).find((k) => k.startsWith('st:'))!
    await tg.onUpdate(cb(st, FULL))
    expect(asked.at(-1)).toMatchObject({ action: 'keys', key: 'stop' })
    await tg.onUpdate(cb(ap, OWNER))
    expect(asked.at(-1)).toMatchObject({ action: 'keys', key: 'approve' })
    tg.stop()
  })

  it('a stranger shows up in recentStrangers until added; removing a member makes the next tap "not yours" again', async () => {
    const { tg, sent, asked, file } = setup()
    await ready(tg)
    await tg.onUpdate(msg('@orrery_bot hi', STRANGER, 'Khách\u0007‮'))
    expect(asked).toHaveLength(0)
    expect(tg.state().recentStrangers).toEqual([{ id: STRANGER, name: 'Khách', at: 3_000_000, chat: String(CHAT) }])
    await tg.onUpdate(cb('st:abcdef123456', STRANGER))
    expect(answers(sent).at(-1)).toBe(ACT_TEXT.vi.notOwner)
    tg.set({ members: [...tg.state().members, { id: STRANGER, name: 'Khách', level: 'full' }] })
    expect(tg.state().recentStrangers).toEqual([])
    expect(JSON.parse(readFileSync(file, 'utf8')).members).toHaveLength(3)
    await tg.onUpdate(msg('@orrery_bot làm đi', STRANGER))
    expect(asked.at(-1)).toMatchObject({ action: 'send', from: 'Khách' })
    tg.set({ members: tg.state().members.filter((m) => m.id !== STRANGER) })
    await tg.onUpdate(cb('st:abcdef123456', STRANGER))
    expect(answers(sent).at(-1)).toBe(ACT_TEXT.vi.notOwner)
    tg.stop()
  })

  it('keeps only the last 20 strangers, newest first', async () => {
    const { tg } = setup()
    await ready(tg)
    for (let i = 0; i < 25; i++) await tg.onUpdate(msg('@orrery_bot hi', 2000 + i))
    const ids = tg.state().recentStrangers.map((s) => s.id)
    expect(ids).toHaveLength(20)
    expect(ids[0]).toBe(2024)
    expect(ids.at(-1)).toBe(2005)
    tg.stop()
  })

  it('the owner is never a member, and members do nothing without an owner', async () => {
    const { tg, asked } = setup()
    await ready(tg)
    tg.set({ members: [{ id: OWNER, name: 'Chủ', level: 'read' }, { id: FULL, name: 'Đủ', level: 'full' }] })
    expect(tg.state().members.map((m) => m.id)).toEqual([FULL])
    await tg.onUpdate(msg('@orrery_bot làm đi', OWNER))
    expect(asked.at(-1)).toMatchObject({ action: 'send' })
    tg.unpair()
    const before = asked.length
    await tg.onUpdate(msg('@orrery_bot làm đi', FULL))
    expect(asked.length).toBe(before)
    tg.stop()
  })

  it('pairing a member as owner drops them from the member list', async () => {
    const { tg } = setup()
    await ready(tg)
    tg.unpair()
    const code = (tg.pair(true) as { ok: true; state: { pairCode: string } }).state.pairCode
    await tg.onUpdate(msg(`@orrery_bot pair ${code}`, FULL, 'Đủ'))
    expect(tg.state().owner).toMatchObject({ id: FULL })
    expect(tg.state().members.map((m) => m.id)).toEqual([READER])
    tg.stop()
  })

  it('sanitizer rejects bad ids, bad levels, duplicates and more than 20', () => {
    const ok = { id: 7, name: ' Tên\u0000 dài ', level: 'read' }
    expect(sanitizeTelegramPatch({ members: [ok] })).toEqual({ members: [{ id: 7, name: 'Tên  dài', level: 'read' }] })
    for (const bad of [0, -5, 1.5, '7', Number.MAX_SAFE_INTEGER + 2, NaN]) expect(sanitizeTelegramPatch({ members: [{ ...ok, id: bad }] })).toBeNull()
    expect(sanitizeTelegramPatch({ members: [{ ...ok, level: 'admin' }] })).toBeNull()
    expect(sanitizeTelegramPatch({ members: [{ ...ok, name: 5 }] })).toBeNull()
    expect(sanitizeTelegramPatch({ members: [ok, { ...ok, level: 'full' }] })).toBeNull()
    expect(sanitizeTelegramPatch({ members: Array.from({ length: 21 }, (_, i) => ({ ...ok, id: i + 1 })) })).toBeNull()
    expect(sanitizeTelegramPatch({ members: Array.from({ length: 20 }, (_, i) => ({ ...ok, id: i + 1 })) })?.members).toHaveLength(20)
    expect(sanitizeTelegramPatch({ members: 'x' })).toBeNull()
    expect(parseTelegramMembers([{ id: 9, name: 'x'.repeat(200), level: 'full' }])![0]!.name).toHaveLength(80)
    expect(parseTelegramMembers([{ id: 9, name: '\u0007', level: 'full' }])![0]!.name).toBe('9')
  })
})
