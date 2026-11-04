import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseInbound, parseInboundResult, type TelegramInbound, type TelegramInboundResult } from '@ccm/shared'
import { commandOf, readMessage } from '../src/telegram/inbound'
import { TelegramNotifier } from '../src/telegram/notifier'
import type { TgFetch } from '../src/telegram/api'

const crypt = { available: () => true, encrypt: (s: string) => Buffer.from(`sealed:${s}`), decrypt: (b: Buffer) => b.toString().replace(/^sealed:/, '') }
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ'
const CHAT = -1001234567890
const OWNER = 555
const project = path.resolve(os.tmpdir(), 'tg-more', 'A')
const UUID = '0b7c1e1e-5f7a-4d55-9c6e-2a1b3c4d5e6f'

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
    const result = method === 'getMe' ? { id: 42, username: 'orrery_bot' } : method === 'sendMessage' ? { message_id: nextId++ } : true
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
    expect(asked[0]).toMatchObject({ action: 'new', project, text: 'sửa lỗi đăng nhập' })
    expect(lastText(sent)).toContain('Đã mở session Claude mới')
    await tg.onUpdate(msg('@orrery_bot all chạy lint'))
    expect(asked[1]).toMatchObject({ action: 'all', text: 'chạy lint' })
    expect(lastText(sent)).toContain('<b>A</b>, <b>A 2</b>')
    tg.stop()
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
    let panes = [{ name: 'A', status: 'working', tool: 'Bash', since: Date.now() - 3 * 60_000 }]
    const first = setup(() => ({ ok: true, action: 'status', panes }))
    first.tg.set({ pinStatus: true })
    await first.tg.pinTick()
    expect(first.sent.map((s) => s.method)).toEqual(expect.arrayContaining(['sendMessage', 'pinChatMessage']))
    expect(lastText(first.sent)).toContain('A — đang làm · Bash · 3 phút')
    await first.tg.pinTick()
    expect(first.sent.filter((s) => s.method === 'editMessageText')).toHaveLength(0)
    panes = [{ name: 'A', status: 'idle', tool: undefined as unknown as string, since: Date.now() }]
    await first.tg.pinTick()
    expect(first.sent.filter((s) => s.method === 'editMessageText')).toHaveLength(1)
    expect(first.tg.state().health.sentToday).toBeGreaterThanOrEqual(2)

    const gone = setup(() => ({ ok: true, action: 'status', panes }), {}, true)
    gone.tg.set({ pinStatus: true })
    await gone.tg.pinTick()
    panes = [{ name: 'A', status: 'working', tool: 'Edit', since: Date.now() }]
    await gone.tg.pinTick()
    expect(gone.sent.filter((s) => s.method === 'pinChatMessage')).toHaveLength(2)
    expect(gone.tg.state().health.errorsToday).toBe(1)
  })
})
