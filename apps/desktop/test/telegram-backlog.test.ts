import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { TelegramInbound, TelegramInboundResult } from '@ccm/shared'
import { TelegramNotifier } from '../src/telegram/notifier'
import type { TgFetch } from '../src/telegram/api'

const crypt = { available: () => true, encrypt: (s: string) => Buffer.from(`sealed:${s}`), decrypt: (b: Buffer) => b.toString().replace(/^sealed:/, '') }
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ'
const CHAT = -1001234567890
const OWNER = 555
const NOW = Date.parse('2026-11-05T10:00:00Z')
const project = path.resolve(os.tmpdir(), 'tg-backlog', 'A')
const SECRET = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd'

type Sent = { method: string; body: Record<string, unknown> }
type Poll = { kind: 'updates'; list: unknown[] } | { kind: 'conflict' } | { kind: 'hang' }

function setup() {
  const sent: Sent[] = []
  const asked: TelegramInbound[] = []
  const polls: unknown[] = []
  const state = { poll: { kind: 'hang' } as Poll }
  let nextId = 100
  let served: Poll | null = null
  const fetch: TgFetch = async (url, init) => {
    const method = url.split('/').pop()!
    const body = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {}
    if (method === 'getUpdates') {
      polls.push(body.offset)
      const p = state.poll
      if (p.kind === 'conflict') return { ok: false, status: 409, json: async () => ({ ok: false, description: 'Conflict: terminated by other getUpdates request' }) }
      if (p.kind === 'updates' && body.offset === 0 && served !== p) {
        served = p
        return { ok: true, status: 200, json: async () => ({ ok: true, result: p.list }) }
      }
      return new Promise(() => undefined)
    }
    sent.push({ method, body })
    const result = method === 'getMe' ? { id: 42, username: 'orrery_bot' } : method === 'sendMessage' ? { message_id: nextId++ } : true
    return { ok: true, status: 200, json: async () => ({ ok: true, result }) }
  }
  const tg = new TelegramNotifier({
    file: path.join(mkdtempSync(path.join(os.tmpdir(), 'tg-backlog-')), 'telegram.json'),
    crypt,
    fetch,
    locale: () => 'vi',
    home: '',
    platform: 'win32',
    now: () => NOW,
    sleep: async () => undefined,
    askPage: async (req): Promise<TelegramInboundResult> => {
      asked.push(req)
      return { ok: true, action: 'send', name: 'A', queued: false, terminalId: 't1' }
    },
  })
  tg.set({ token: TOKEN, enabled: true })
  tg.setRoute({ project, chatId: String(CHAT), threadId: 7 })
  return { tg, sent, asked, polls, state }
}

const update = (id: number, text: string, agoMin: number, from = OWNER) => ({
  update_id: id,
  message: { message_id: id, date: Math.floor(NOW / 1000) - agoMin * 60, chat: { id: CHAT, type: 'supergroup' }, message_thread_id: 7, is_topic_message: true, from: { id: from, first_name: 'Chủ' }, text },
})
const flush = async () => {
  for (let i = 0; i < 30; i++) await new Promise((r) => setTimeout(r, 0))
}
const texts = (sent: Sent[]) => sent.filter((s) => s.method === 'sendMessage').map((s) => String(s.body.text))
const keysOf = (sent: Sent[]) => ((sent.filter((s) => s.method === 'sendMessage').at(-1)!.body.reply_markup as { inline_keyboard: { callback_data: string; text: string }[][] }).inline_keyboard.flat())
const cb = (data: string) => ({ update_id: 900, callback_query: { id: 'cb', from: { id: OWNER }, data, message: { message_id: 101 } } })

async function paired(tg: TelegramNotifier) {
  const code = (tg.pair(true) as { ok: true; state: { pairCode: string } }).state.pairCode
  await tg.onUpdate(update(1, `@orrery_bot pair ${code}`, 0))
  tg.stop()
}

describe('commands sent while the app was off', () => {
  it('does not offer again what the last run already handled', async () => {
    const { tg, sent, state } = setup()
    await paired(tg)
    ;(tg as unknown as { data: { lastUpdate?: number } }).data.lastUpdate = 11
    state.poll = { kind: 'updates', list: [update(11, '@orrery_bot chạy lint', 10), update(12, '@orrery_bot chạy test', 5)] }
    tg.set({ receiving: true })
    await flush()
    const head = texts(sent).at(-1)!
    expect(head).toContain('Có 1 lệnh gửi lúc Orrery tắt')
    expect(head).toContain('chạy test')
    expect(head).not.toContain('chạy lint')
    tg.stop()
  })

  it('asks first, then runs them in order on Run all', async () => {
    const { tg, sent, asked, state } = setup()
    await paired(tg)
    state.poll = { kind: 'updates', list: [update(11, '@orrery_bot chạy lint', 10), update(12, `@orrery_bot đọc <b>${SECRET}</b>`, 5)] }
    tg.set({ receiving: true })
    await flush()
    expect(asked).toEqual([])
    const head = texts(sent).at(-1)!
    expect(head).toContain('Có 2 lệnh gửi lúc Orrery tắt')
    expect(head).toContain('1. chạy lint')
    expect(head).toContain('&lt;b&gt;[masked]&lt;/b&gt;')
    expect(head).not.toContain(SECRET)
    const keys = keysOf(sent)
    expect(keys.map((k) => k.text)).toEqual(['▶️ Chạy hết', '🗑 Bỏ qua'])
    await tg.onUpdate(cb(keys[0]!.callback_data))
    expect(asked.map((a) => (a as { text: string }).text.split('\n')[0])).toEqual(['chạy lint', 'đọc <b>' + SECRET + '</b>'])
    await tg.onUpdate(cb(keys[0]!.callback_data))
    expect(asked).toHaveLength(2)
    tg.stop()
  })

  it('runs nothing on Skip', async () => {
    const { tg, sent, asked, state } = setup()
    await paired(tg)
    state.poll = { kind: 'updates', list: [update(11, '@orrery_bot chạy lint', 10)] }
    tg.set({ receiving: true })
    await flush()
    await tg.onUpdate(cb(keysOf(sent)[1]!.callback_data))
    expect(asked).toEqual([])
    expect(texts(sent).at(-1)).toContain('Đã bỏ qua 1 lệnh')
    tg.stop()
  })

  it('drops old updates, strangers, old callbacks and pair codes without a word', async () => {
    const { tg, sent, asked, state } = setup()
    await paired(tg)
    const before = sent.length
    state.poll = {
      kind: 'updates',
      list: [update(11, '@orrery_bot cũ', 120), update(12, '@orrery_bot người lạ', 5, 999), cb('go:abcdefabcdef'), update(13, '@orrery_bot pair 123456', 5)],
    }
    tg.set({ receiving: true })
    await flush()
    expect(asked).toEqual([])
    expect(sent.slice(before).filter((s) => s.method === 'sendMessage')).toEqual([])
    tg.stop()
  })
})

describe('bot polled elsewhere', () => {
  it('stops after 3 conflicts, shows the flag, and a retry polls again', async () => {
    const { tg, polls, state } = setup()
    await paired(tg)
    state.poll = { kind: 'conflict' }
    tg.set({ receiving: true })
    await flush()
    expect(polls).toHaveLength(4)
    expect(tg.state().pollConflict).toBe(true)
    expect(tg.state().lastError).toBe('conflict')
    expect(tg.state().receiving).toBe(true)
    tg.set({ waiting: false })
    await flush()
    expect(polls).toHaveLength(4)
    state.poll = { kind: 'updates', list: [] }
    tg.set({ receiving: true })
    await flush()
    expect(polls.length).toBeGreaterThan(4)
    expect(tg.state().pollConflict).toBe(false)
    expect(tg.state().lastError).toBeNull()
    tg.stop()
  })
})
