import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseInbound, parseInboundResult, parseTelegramAsk, parseTelegramEpisode, type TelegramEpisodeMessage, type TelegramInbound, type TelegramInboundResult } from '@ccm/shared'
import { TelegramNotifier } from '../src/telegram/notifier'
import type { TgFetch } from '../src/telegram/api'

const crypt = { available: () => true, encrypt: (s: string) => Buffer.from(`sealed:${s}`), decrypt: (b: Buffer) => b.toString().replace(/^sealed:/, '') }
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ'
const CHAT = -1001234567890
const OWNER = 555
const project = path.resolve(os.tmpdir(), 'tg-ask', 'A')
const SINCE = Date.parse('2026-11-05T10:00:00Z')

type Sent = { method: string; body: Record<string, unknown> }

function setup() {
  const sent: Sent[] = []
  const asked: TelegramInbound[] = []
  let nextId = 100
  const fetch: TgFetch = async (url, init) => {
    const method = url.split('/').pop()!
    if (method === 'getUpdates') return new Promise(() => undefined)
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {}
    if (method !== 'setMyCommands') sent.push({ method, body })
    const result = method === 'getMe' ? { id: 42, username: 'orrery_bot' } : method === 'sendMessage' ? { message_id: nextId++ } : true
    return { ok: true, status: 200, json: async () => ({ ok: true, result }) }
  }
  const tg = new TelegramNotifier({
    file: path.join(mkdtempSync(path.join(os.tmpdir(), 'tg-ask-')), 'telegram.json'),
    crypt,
    fetch,
    locale: () => 'vi',
    home: '',
    platform: 'win32',
    askPage: async (req): Promise<TelegramInboundResult> => {
      asked.push(req)
      return { ok: true, action: 'keys', name: 'A', key: 'option', option: 2 }
    },
  })
  tg.set({ token: TOKEN, enabled: true })
  tg.setRoute({ project, chatId: String(CHAT), threadId: 7 })
  return { tg, sent, asked }
}

const msgUpdate = (text: string) => ({ update_id: 1, message: { message_id: 50, chat: { id: CHAT, type: 'supergroup' }, message_thread_id: 7, is_topic_message: true, from: { id: OWNER, first_name: 'Chủ' }, text } })
const cbUpdate = (data: string) => ({ update_id: 2, callback_query: { id: 'cb1', from: { id: OWNER }, data, message: { message_id: 100 } } })

async function receiving(tg: TelegramNotifier) {
  const code = (tg.pair(true) as { ok: true; state: { pairCode: string } }).state.pairCode
  await tg.onUpdate(msgUpdate(`@orrery_bot pair ${code}`))
  tg.set({ receiving: true })
}

const ep = (patch: Partial<TelegramEpisodeMessage>): TelegramEpisodeMessage => ({ type: 'telegram', episode: 'q1', reason: 'question', terminalId: 'term-1', name: 'A', cwd: project, since: SINCE, ask: { question: 'Which database?', options: ['Postgres', 'SQLite', 'MySQL'], multi: false }, ...patch })

const buttons = (s: Sent) => ((s.body.reply_markup as { inline_keyboard: { callback_data: string; text: string }[][] } | undefined)?.inline_keyboard.flat() ?? [])
const last = (sent: Sent[]) => sent[sent.length - 1]!
const noOptions = (s: Sent) => buttons(s).filter((b) => b.callback_data.startsWith('qa:'))

describe('ask parsing (shared)', () => {
  it('cuts lengths, drops unknown fields and wrong types', () => {
    const a = parseTelegramAsk({ question: ` ${'q'.repeat(300)} `, options: ['A\nB', 'x'.repeat(90)], multi: false, description: 'no', preview: 'no' })!
    expect(a.question).toHaveLength(200)
    expect(a.options).toEqual(['A B', 'x'.repeat(60)])
    expect(Object.keys(a).sort()).toEqual(['multi', 'options', 'question'])
    expect(parseTelegramAsk({ question: 'q', options: [1], multi: false })).toBeUndefined()
    expect(parseTelegramAsk({ question: 'q', options: ['a'], multi: 'no' })).toBeUndefined()
    expect(parseTelegramAsk({ question: '', options: ['a'], multi: false })).toBeUndefined()
    expect(parseTelegramAsk({ question: 'q', options: [], multi: false })).toBeUndefined()
    expect(parseTelegramAsk('x')).toBeUndefined()
    expect(parseTelegramAsk({ question: 'q', options: Array.from({ length: 9 }, (_, i) => `o${i}`), multi: false })).toMatchObject({ more: true, options: ['o0', 'o1', 'o2', 'o3', 'o4', 'o5'] })
  })

  it('keeps a valid ask on the episode and drops a bad one without losing the episode', () => {
    const base = { type: 'telegram', episode: 'e', reason: 'question', terminalId: 't', name: 'A', cwd: project }
    expect(parseTelegramEpisode({ ...base, ask: { question: 'q', options: ['a'], multi: false, junk: 1 } })!.ask).toEqual({ question: 'q', options: ['a'], multi: false })
    const bad = parseTelegramEpisode({ ...base, ask: { question: 'q', options: 'a', multi: false } })!
    expect(bad.ask).toBeUndefined()
    expect(bad.reason).toBe('question')
  })

  it('accepts the option key only with a number 1..6', () => {
    const req = { id: 'x', action: 'keys', project, key: 'option', option: 2, since: SINCE }
    expect(parseInbound(req)).toMatchObject({ key: 'option', option: 2 })
    expect(parseInbound({ ...req, option: 0 })).toBeNull()
    expect(parseInbound({ ...req, option: 7 })).toBeNull()
    expect(parseInbound({ ...req, option: undefined })).toBeNull()
    expect(parseInbound({ ...req, key: 'approve' })).not.toHaveProperty('option')
    expect(parseInboundResult({ ok: true, action: 'keys', name: 'A', key: 'option', option: 3 })).toEqual({ ok: true, action: 'keys', name: 'A', key: 'option', option: 3 })
    expect(parseInboundResult({ ok: true, action: 'keys', name: 'A', key: 'option' })).toEqual({ ok: false, error: 'unavailable' })
  })
})

describe('question buttons', () => {
  it('shows the question and one button per option, and presses the number', async () => {
    const { tg, sent, asked } = setup()
    await receiving(tg)
    await tg.handle(ep({}))
    const msg = last(sent)
    expect(String(msg.body.text)).toContain('Which database?')
    expect(String(msg.body.text)).toContain('2. SQLite')
    const keys = buttons(msg)
    expect(keys.map((k) => k.text)).toEqual(['🔹 1 · Postgres', '🔹 2 · SQLite', '🔹 3 · MySQL', '⎋ Esc', '📜 20 dòng cuối'])
    expect(keys.slice(0, 3).every((k) => k.callback_data.startsWith('qa:'))).toBe(true)
    await tg.onUpdate(cbUpdate(keys[1]!.callback_data))
    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatchObject({ action: 'keys', key: 'option', option: 2, since: SINCE, target: { kind: 'terminal', terminalId: 'term-1' } })
    expect(asked[0]).not.toHaveProperty('tool')
    expect(sent.some((s) => s.method === 'editMessageReplyMarkup')).toBe(true)
    expect(String(last(sent).body.text)).toContain('Đã chọn “SQLite”')
    await tg.onUpdate(cbUpdate(keys[2]!.callback_data))
    await tg.onUpdate(cbUpdate(keys[1]!.callback_data))
    expect(asked).toHaveLength(1)
    tg.stop()
  })

  it('offers no button for multiSelect, more than 6 options, or when not receiving, but still shows the question', async () => {
    const { tg, sent } = setup()
    await tg.handle(ep({ episode: 'q0' }))
    expect(buttons(last(sent))).toEqual([])
    expect(String(last(sent).body.text)).toContain('Which database?')
    await receiving(tg)
    await tg.handle(ep({ episode: 'q2', ask: { question: 'Pick', options: ['a', 'b'], multi: true } }))
    expect(noOptions(last(sent))).toEqual([])
    expect(String(last(sent).body.text)).toContain('1. a')
    await tg.handle(ep({ episode: 'q3', ask: { question: 'Pick', options: ['a', 'b'], multi: false, more: true } }))
    expect(noOptions(last(sent))).toEqual([])
    await tg.handle(ep({ episode: 'q4', ask: undefined }))
    expect(noOptions(last(sent))).toEqual([])
    tg.stop()
  })

  it('masks secrets in the question and the labels and escapes html', async () => {
    const { tg, sent } = setup()
    await receiving(tg)
    const secret = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789'
    await tg.handle(ep({ episode: 'q5', ask: { question: `Use ${secret} <b>?`, options: [`key ${secret}`, 'No'], multi: false } }))
    const msg = last(sent)
    const all = JSON.stringify(msg.body)
    expect(all).not.toContain(secret)
    expect(String(msg.body.text)).toContain('&lt;b&gt;')
    expect(buttons(msg)[0]!.text).not.toContain(secret)
    tg.stop()
  })

  it('tells the owner when the pane no longer waits for that question', async () => {
    const { tg, sent } = setup()
    const asked: TelegramInbound[] = []
    ;(tg as unknown as { deps: { askPage: unknown } }).deps.askPage = async (req: TelegramInbound): Promise<TelegramInboundResult> => {
      asked.push(req)
      return { ok: false, error: 'state' }
    }
    await receiving(tg)
    await tg.handle(ep({ episode: 'q6' }))
    const keys = buttons(last(sent))
    await tg.onUpdate(cbUpdate(keys[0]!.callback_data))
    expect(asked).toHaveLength(1)
    expect(last(sent)).toMatchObject({ method: 'answerCallbackQuery', body: { text: 'Session đó không còn ở trạng thái này nữa.' } })
    expect(sent.some((s) => s.method === 'editMessageReplyMarkup')).toBe(false)
    tg.stop()
  })

  it('labels the ExitPlanMode permission as a plan approval', async () => {
    const { tg, sent, asked } = setup()
    await receiving(tg)
    await tg.handle(ep({ episode: 'p1', reason: 'permission', tool: 'ExitPlanMode', ask: undefined }))
    const keys = buttons(last(sent))
    expect(keys.map((k) => k.text)).toEqual(['✅ Duyệt plan', '❌ Từ chối plan', '⎋ Esc', '📜 20 dòng cuối'])
    await tg.onUpdate(cbUpdate(keys[0]!.callback_data))
    expect(asked[0]).toMatchObject({ key: 'approve', tool: 'ExitPlanMode' })
    tg.stop()
  })
})
