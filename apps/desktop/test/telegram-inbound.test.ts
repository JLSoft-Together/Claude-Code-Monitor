import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { inboundPrompt, parseInbound, parseInboundResult, type TelegramInbound, type TelegramInboundResult } from '@ccm/shared'
import { commandOf, readMessage, resultHtml } from '../src/telegram/inbound'
import { INBOUND_PER_CHAT_MIN, TelegramNotifier } from '../src/telegram/notifier'
import { viaTelegram } from '../src/telegram/actions'
import type { TgFetch } from '../src/telegram/api'

const crypt = { available: () => true, encrypt: (s: string) => Buffer.from(`sealed:${s}`), decrypt: (b: Buffer) => b.toString().replace(/^sealed:/, '') }
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ'
const CHAT = -1001234567890
const project = path.resolve(os.tmpdir(), 'tg-in', 'A')
const OWNER = 555

type Sent = { method: string; body: Record<string, unknown> }

function setup(answer: (req: TelegramInbound) => TelegramInboundResult = () => ({ ok: true, action: 'send', name: 'A', queued: false, terminalId: 't1' })) {
  const sent: Sent[] = []
  const asked: TelegramInbound[] = []
  let nextId = 100
  const fetch: TgFetch = async (url, init) => {
    const method = url.split('/').pop()!
    if (method === 'getUpdates') return new Promise(() => undefined)
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {}
    sent.push({ method, body })
    const result = method === 'getMe' ? { id: 42, username: 'orrery_bot' } : method === 'sendMessage' ? { message_id: nextId++ } : []
    return { ok: true, status: 200, json: async () => ({ ok: true, result }) }
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-in-'))
  const tg = new TelegramNotifier({
    file: path.join(dir, 'telegram.json'),
    crypt,
    fetch,
    locale: () => 'vi',
    home: '',
    platform: 'win32',
    askPage: async (req) => {
      asked.push(req)
      return answer(req)
    },
  })
  tg.set({ token: TOKEN })
  tg.setRoute({ project, chatId: String(CHAT), threadId: 7 })
  return { tg, sent, asked }
}

const update = (text: string, extra: Record<string, unknown> = {}, from = OWNER) => ({
  update_id: 1,
  message: { message_id: 50, chat: { id: CHAT, type: 'supergroup', is_forum: true }, message_thread_id: 7, is_topic_message: true, from: { id: from, first_name: 'Chủ', last_name: 'nhân' }, text, ...extra },
})

async function paired(tg: TelegramNotifier) {
  const code = (tg.pair(true) as { ok: true; state: { pairCode: string } }).state.pairCode
  await tg.onUpdate(update(`@orrery_bot pair ${code}`))
}

describe('inbound parsing', () => {
  it('reads commands only when the bot is mentioned or replied to', () => {
    const m = readMessage(update('@orrery_bot chạy test giúp anh'), 42)!
    expect(commandOf(m, 'orrery_bot')).toEqual({ kind: 'send', text: 'chạy test giúp anh' })
    expect(commandOf(readMessage(update('chạy test'), 42)!, 'orrery_bot')).toBeNull()
    expect(commandOf(readMessage(update('làm tiếp', { reply_to_message: { message_id: 9, from: { id: 42 } } }), 42)!, 'orrery_bot')).toEqual({ kind: 'send', text: 'làm tiếp' })
    expect(commandOf(readMessage(update('@Orrery_Bot STATUS'), 42)!, 'orrery_bot')).toEqual({ kind: 'status' })
    expect(commandOf(readMessage(update('@orrery_bot pair 123456'), 42)!, 'orrery_bot')).toEqual({ kind: 'pair', code: '123456' })
    expect(readMessage(update('x', { reply_to_message: { message_id: 3, forum_topic_created: { name: 'A' } } }), 42)!.replyTo).toBeNull()
  })

  it('cleans prompts and checks page answers', () => {
    expect(inboundPrompt('a\x1b[31mred\x1b[0m\x07 b‮\n\n\n\nc')).toBe('ared b\n\nc')
    expect(parseInbound({ id: 'x', action: 'send', project, text: ' ', from: 'a' })).toBeNull()
    expect(parseInboundResult({ ok: false, error: 'hack' })).toEqual({ ok: false, error: 'unavailable' })
    expect(resultHtml({ ok: true, action: 'send', name: '<A>', queued: true }, 'vi')).toContain('&lt;A&gt;</b> đang làm')
  })
})

describe('TelegramNotifier inbound', () => {
  it('pairs only with the current code, then answers everyone else with a fixed line and never forwards them', async () => {
    const { tg, sent, asked } = setup()
    await tg.onUpdate(update('@orrery_bot pair 000000'))
    expect(tg.state().owner).toBeNull()
    await paired(tg)
    expect(tg.state().owner).toEqual({ id: OWNER, name: 'Chủ nhân' })
    expect(tg.state().pairCode).toBeNull()
    tg.set({ receiving: true })
    const before = sent.length
    await tg.onUpdate(update('@orrery_bot xoá hết đi', {}, 999))
    expect(sent.length).toBe(before + 1)
    expect(JSON.stringify(sent.at(-1))).toContain('tôi chỉ trả lời chủ nhân Chủ nhân')
    expect(asked).toHaveLength(0)
    expect(tg.state().ignored).toBe(1)
    tg.stop()
  })

  it('needs receiving on and a paired owner', async () => {
    const { tg, asked } = setup()
    tg.set({ receiving: true })
    expect(tg.state().receiving).toBe(false)
    await paired(tg)
    await tg.onUpdate(update('@orrery_bot làm đi'))
    expect(asked).toHaveLength(0)
    tg.set({ receiving: true })
    expect(tg.state().receiving).toBe(true)
    await tg.onUpdate(update('@orrery_bot làm đi'))
    expect(asked).toEqual([expect.objectContaining({ action: 'send', project, text: viaTelegram('làm đi', 'vi'), from: 'Chủ nhân' })])
    tg.stop()
  })

  it('targets the session of the report that was replied to and answers in the topic', async () => {
    const { tg, sent, asked } = setup()
    await paired(tg)
    tg.set({ receiving: true, enabled: true })
    await tg.handle({ type: 'telegram', episode: 'e', reason: 'done', terminalId: 'term-9', name: 'A', cwd: project, worked: 5 * 60_000 })
    const reportId = (sent.filter((s) => s.method === 'sendMessage').length + 99) as number
    await tg.onUpdate(update('sửa tiếp', { reply_to_message: { message_id: reportId, from: { id: 42 } } }))
    expect(asked[0]).toMatchObject({ target: { kind: 'terminal', terminalId: 'term-9' } })
    const reply = sent[sent.length - 1]!
    expect(reply.body).toMatchObject({ chat_id: String(CHAT), message_thread_id: 7, reply_parameters: { message_id: 50 } })
    expect(String(reply.body.text)).toContain('Đã gửi vào')
    tg.stop()
  })

  it('refuses topics without a project and caps commands per chat', async () => {
    const { tg, sent, asked } = setup()
    await paired(tg)
    tg.set({ receiving: true })
    await tg.onUpdate(update('@orrery_bot x', { message_thread_id: 99 }))
    expect(String(sent[sent.length - 1]!.body.text)).toContain('chưa được gán project')
    for (let i = 0; i < INBOUND_PER_CHAT_MIN + 3; i++) await tg.onUpdate(update(`@orrery_bot lệnh ${i}`))
    expect(asked).toHaveLength(INBOUND_PER_CHAT_MIN)
    expect(String(sent[sent.length - 1]!.body.text)).toContain('Gửi nhanh quá')
    tg.stop()
  })

  it('lists sessions on status', async () => {
    const { tg, sent } = setup(() => ({ ok: true, action: 'status', panes: [{ name: 'A', status: 'working' }] }))
    await paired(tg)
    tg.set({ receiving: true })
    await tg.onUpdate(update('@orrery_bot status'))
    expect(String(sent[sent.length - 1]!.body.text)).toContain('<b>A</b> — đang làm')
    tg.stop()
  })
})
