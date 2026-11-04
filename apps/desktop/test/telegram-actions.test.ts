import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { inTelegramQuiet, sanitizeTelegramPatch, type TelegramEpisodeMessage, type TelegramInbound, type TelegramInboundResult } from '@ccm/shared'
import { summaryHtml, emptyCounts } from '../src/telegram/actions'
import { commandOf, readMessage } from '../src/telegram/inbound'
import { TelegramNotifier } from '../src/telegram/notifier'
import type { TgFetch } from '../src/telegram/api'

const crypt = { available: () => true, encrypt: (s: string) => Buffer.from(`sealed:${s}`), decrypt: (b: Buffer) => b.toString().replace(/^sealed:/, '') }
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ'
const CHAT = -1001234567890
const OWNER = 555
const project = path.resolve(os.tmpdir(), 'tg-act', 'A')
const SINCE = Date.parse('2026-11-04T10:00:00Z')

type Sent = { method: string; body: Record<string, unknown> | FormData; url: string }

function setup(opts: { answer?: (req: TelegramInbound) => TelegramInboundResult; now?: () => number; extra?: Partial<ConstructorParameters<typeof TelegramNotifier>[0]> } = {}) {
  const sent: Sent[] = []
  const asked: TelegramInbound[] = []
  let nextId = 100
  const fetch: TgFetch = async (url, init) => {
    const method = url.split('/').pop()!
    if (method === 'getUpdates') return new Promise(() => undefined)
    if (url.includes('/file/bot')) return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => new TextEncoder().encode('img').buffer as ArrayBuffer }
    const body = init.body instanceof FormData ? init.body : typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {}
    sent.push({ method, body, url })
    const result =
      method === 'getMe' ? { id: 42, username: 'orrery_bot' } : method === 'sendMessage' ? { message_id: nextId++ } : method === 'getFile' ? { file_path: 'photos/file_1.jpg', file_size: 3 } : true
    return { ok: true, status: 200, json: async () => ({ ok: true, result }) }
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-act-'))
  const tg = new TelegramNotifier({
    file: path.join(dir, 'telegram.json'),
    crypt,
    fetch,
    locale: () => 'vi',
    home: '',
    platform: 'win32',
    now: opts.now,
    askPage: async (req) => {
      asked.push(req)
      return (opts.answer ?? (() => ({ ok: true, action: 'keys', name: 'A', key: 'approve' })))(req)
    },
    ...opts.extra,
  })
  tg.set({ token: TOKEN, enabled: true })
  tg.setRoute({ project, chatId: String(CHAT), threadId: 7 })
  return { tg, sent, asked }
}

const msgUpdate = (text: string, extra: Record<string, unknown> = {}, from = OWNER) => ({
  update_id: 1,
  message: { message_id: 50, chat: { id: CHAT, type: 'supergroup' }, message_thread_id: 7, is_topic_message: true, from: { id: from, first_name: 'Chủ' }, text, ...extra },
})
const cbUpdate = (data: string, from = OWNER) => ({ update_id: 2, callback_query: { id: 'cb1', from: { id: from }, data, message: { message_id: 100 } } })

async function receiving(tg: TelegramNotifier) {
  const code = (tg.pair(true) as { ok: true; state: { pairCode: string } }).state.pairCode
  await tg.onUpdate(msgUpdate(`@orrery_bot pair ${code}`))
  tg.set({ receiving: true })
}

const ep = (patch: Partial<TelegramEpisodeMessage>): TelegramEpisodeMessage => ({ type: 'telegram', episode: 'e1', reason: 'permission', terminalId: 'term-1', name: 'A', cwd: project, tool: 'Bash', since: SINCE, ...patch })

const buttons = (s: Sent) => ((s.body as Record<string, unknown>).reply_markup as { inline_keyboard: { callback_data: string; text: string }[][] } | undefined)?.inline_keyboard.flat() ?? []

describe('quiet hours and patches', () => {
  it('handles ranges across midnight', () => {
    const q = { enabled: true, from: '23:00', to: '07:00' }
    expect(inTelegramQuiet(q, new Date(2026, 10, 4, 23, 30))).toBe(true)
    expect(inTelegramQuiet(q, new Date(2026, 10, 4, 6, 59))).toBe(true)
    expect(inTelegramQuiet(q, new Date(2026, 10, 4, 7, 0))).toBe(false)
    expect(inTelegramQuiet({ ...q, enabled: false }, new Date(2026, 10, 4, 23, 30))).toBe(false)
    expect(sanitizeTelegramPatch({ quiet: { enabled: true, from: '25:00', to: '07:00' } })).toBeNull()
    expect(sanitizeTelegramPatch({ summary: { enabled: true, at: '21:30' }, alerts: false })).toEqual({ summary: { enabled: true, at: '21:30' }, alerts: false })
  })

  it('reads stop / screen / file commands', () => {
    const m = (t: string, extra = {}) => readMessage(msgUpdate(t, extra), 42)!
    expect(commandOf(m('@orrery_bot stop'), 'orrery_bot')).toEqual({ kind: 'stop' })
    expect(commandOf(m('@orrery_bot screen emulator-5554'), 'orrery_bot')).toEqual({ kind: 'screen', serial: 'emulator-5554' })
    const photo = readMessage({ message: { message_id: 1, chat: { id: CHAT, type: 'supergroup' }, from: { id: OWNER }, caption: '@orrery_bot lỗi này', photo: [{ file_id: 's', file_size: 1 }, { file_id: 'b', file_size: 9 }] } }, 42)!
    expect(commandOf(photo, 'orrery_bot')).toEqual({ kind: 'file', file: { fileId: 'b', kind: 'photo', name: 'photo.jpg', size: 9 }, text: 'lỗi này' })
  })
})

describe('buttons', () => {
  it('adds approve / deny under permission messages only while receiving, and only the owner can press them', async () => {
    const { tg, sent, asked } = setup()
    await tg.handle(ep({ episode: 'p0' }))
    expect(buttons(sent[sent.length - 1]!)).toEqual([])
    await receiving(tg)
    await tg.handle(ep({ episode: 'p1' }))
    const keys = buttons(sent[sent.length - 1]!)
    expect(keys.map((k) => k.text)).toEqual(['✅ Cho phép', '❌ Từ chối'])
    await tg.onUpdate(cbUpdate(keys[0]!.callback_data, 999))
    expect(asked).toHaveLength(0)
    expect(sent[sent.length - 1]).toMatchObject({ method: 'answerCallbackQuery', body: { text: 'Chỉ tài khoản đã ghép mới dùng được các nút này.' } })
    await tg.onUpdate(cbUpdate(keys[0]!.callback_data))
    expect(asked[0]).toMatchObject({ action: 'keys', key: 'approve', project, target: { kind: 'terminal', terminalId: 'term-1' }, since: SINCE, tool: 'Bash' })
    expect(sent.some((s) => s.method === 'editMessageReplyMarkup')).toBe(true)
    expect(String((sent[sent.length - 1]!.body as Record<string, unknown>).text)).toContain('Đã cho phép')
    await tg.onUpdate(cbUpdate(keys[0]!.callback_data))
    expect(asked).toHaveLength(1)
    tg.stop()
  })

  it('done buttons continue, run tests and send the diff', async () => {
    const { tg, sent, asked } = setup({
      answer: () => ({ ok: true, action: 'send', name: 'A', queued: false, terminalId: 'term-1' }),
      extra: { diff: async () => ({ ok: true, text: 'diff --git a/x b/x\n', files: 1 }) },
    })
    await receiving(tg)
    await tg.handle(ep({ episode: 'd1', reason: 'done', worked: 5 * 60_000 }))
    const keys = buttons(sent[sent.length - 1]!)
    expect(keys.map((k) => k.text)).toEqual(['▶️ Tiếp tục', '🧪 Chạy test', '📄 Xem diff'])
    await tg.onUpdate(cbUpdate(keys[1]!.callback_data))
    expect(asked[0]).toMatchObject({ action: 'send', text: 'Chạy test của project và báo kết quả.' })
    await tg.onUpdate(cbUpdate(keys[2]!.callback_data))
    const doc = sent.find((s) => s.method === 'sendDocument')!.body as FormData
    expect(doc.get('message_thread_id')).toBe('7')
    tg.stop()
  })

  it('stop asks for confirmation, then presses Esc', async () => {
    const { tg, sent, asked } = setup({
      answer: (req) => (req.action === 'status' ? { ok: true, action: 'status', panes: [{ name: 'A', status: 'working', terminalId: 'term-1' }] } : { ok: true, action: 'keys', name: 'A', key: 'stop' }),
    })
    await receiving(tg)
    await tg.onUpdate(msgUpdate('@orrery_bot stop'))
    const keys = buttons(sent[sent.length - 1]!)
    expect(keys.map((k) => k.text)).toEqual(['⏹ Dừng'])
    expect(asked.filter((a) => a.action === 'keys')).toHaveLength(0)
    await tg.onUpdate(cbUpdate(keys[0]!.callback_data))
    expect(asked[asked.length - 1]).toMatchObject({ action: 'keys', key: 'stop' })
    tg.stop()
  })
})

describe('quiet hours, alerts, summary', () => {
  it('skips episodes in quiet hours but still counts them; alerts and run failures still go out', async () => {
    let now = new Date(2026, 10, 4, 23, 30).getTime()
    const { tg, sent } = setup({ now: () => now })
    tg.set({ quiet: { enabled: true, from: '23:00', to: '07:00' } })
    expect(await tg.handle(ep({ episode: 'q1', reason: 'done', worked: 600_000 }))).toBe(false)
    expect(await tg.alert('limit')).toBe(true)
    expect(sent[sent.length - 1]!.body).toMatchObject({ chat_id: String(CHAT) })
    expect((sent[sent.length - 1]!.body as Record<string, unknown>).message_thread_id).toBeUndefined()
    const run = { id: 'r1', cwd: path.join(project, 'app'), configName: 'app debug', failure: { code: 'gradle', detail: 'BUILD FAILED' } }
    expect(await tg.runFailedReport(run)).toBe(true)
    expect(await tg.runFailedReport(run)).toBe(false)
    tg.set({ alerts: false })
    expect(await tg.alert('disk', { label: 'C:', free: '1.5 GB' })).toBe(false)
    now = new Date(2026, 10, 4, 7, 30).getTime()
    expect(await tg.handle(ep({ episode: 'q2', reason: 'done', worked: 600_000 }))).toBe(true)
  })

  it('sends the day summary once after its time', async () => {
    let now = new Date(2026, 10, 4, 20, 59).getTime()
    const { tg, sent } = setup({ now: () => now })
    tg.set({ summary: { enabled: true, at: '21:00' } })
    await tg.handle(ep({ episode: 's1', reason: 'done', worked: 30 * 60_000 }))
    await tg.handle(ep({ episode: 's2', reason: 'permission' }))
    expect(await tg.tick()).toBe(false)
    now = new Date(2026, 10, 4, 21, 1).getTime()
    expect(await tg.tick()).toBe(true)
    expect(await tg.tick()).toBe(false)
    const text = String((sent[sent.length - 1]!.body as Record<string, unknown>).text)
    expect(text).toContain('Tổng kết ngày 2026-11-04')
    expect(text).toContain('<b>A</b>: 1 lần xong, 30 phút, 0 lần chờ, 1 lần xin quyền')
    expect(summaryHtml('en', 'd', [{ name: 'X', counts: emptyCounts() }])).toContain('No session activity today.')
  })
})

describe('files from Telegram', () => {
  it('downloads, saves into the project and sends the path to the session', async () => {
    const saved: { project: string; name: string; data: string }[] = []
    const { tg, asked } = setup({
      answer: () => ({ ok: true, action: 'send', name: 'A', queued: false }),
      extra: {
        saveFile: async (p, name, data) => {
          saved.push({ project: p, name, data: data.toString() })
          return path.join(p, '.orrery', 'telegram', name)
        },
      },
    })
    await receiving(tg)
    await tg.onUpdate({ update_id: 3, message: { message_id: 60, chat: { id: CHAT, type: 'supergroup' }, message_thread_id: 7, is_topic_message: true, from: { id: OWNER }, caption: '@orrery_bot màn này lỗi', photo: [{ file_id: 'b', file_size: 3 }] } })
    expect(saved).toEqual([{ project, name: 'photo.jpg', data: 'img' }])
    expect(asked[0]).toMatchObject({ action: 'send' })
    expect((asked[0] as { text: string }).text).toContain(path.join(project, '.orrery', 'telegram', 'photo.jpg'))
    expect((asked[0] as { text: string }).text).toContain('màn này lỗi')
    tg.stop()
  })
})
