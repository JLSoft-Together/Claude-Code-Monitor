import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { sanitizeTelegramPatch, type TelegramEpisodeMessage } from '@ccm/shared'
import { TelegramNotifier } from '../src/telegram/notifier'
import type { TgFetch } from '../src/telegram/api'

const crypt = { available: () => true, encrypt: (s: string) => Buffer.from(`sealed:${s}`), decrypt: (b: Buffer) => b.toString().replace(/^sealed:/, '') }
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ'
const project = path.resolve(os.tmpdir(), 'tg-digest', 'A')

type Sent = { method: string; body: Record<string, unknown> }

function setup(failEdit = false) {
  const sent: Sent[] = []
  let nextId = 100
  let clock = new Date(2026, 10, 5, 10, 0).getTime()
  const fetch: TgFetch = async (url, init) => {
    const method = url.split('/').pop()!
    if (method === 'getUpdates') return new Promise(() => undefined)
    sent.push({ method, body: typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {} })
    if (method === 'editMessageText' && failEdit) return { ok: false, status: 400, json: async () => ({ ok: false, description: 'Bad Request: message to edit not found' }) }
    const result = method === 'getMe' ? { id: 42, username: 'orrery_bot' } : method === 'sendMessage' ? { message_id: nextId++ } : true
    return { ok: true, status: 200, json: async () => ({ ok: true, result }) }
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-digest-'))
  const tg = new TelegramNotifier({ file: path.join(dir, 'telegram.json'), crypt, fetch, locale: () => 'en', home: '', platform: 'win32', sleep: async () => undefined, now: () => clock })
  tg.set({ token: TOKEN, enabled: true })
  tg.setRoute({ project, chatId: '-1001', threadId: 7 })
  return { tg, sent, advance: (ms: number) => (clock += ms) }
}

let seq = 0
const ep = (reason: TelegramEpisodeMessage['reason'], terminalId = 't1'): TelegramEpisodeMessage => ({
  type: 'telegram',
  episode: `e${seq++}`,
  reason,
  terminalId,
  name: 'A',
  cwd: path.join(project, 'app'),
  worked: 10 * 60_000,
})
const only = (sent: Sent[], method: string) => sent.filter((s) => s.method === method)

describe('digest of finished reports', () => {
  it('off: two finishes are two messages', async () => {
    const { tg, sent } = setup()
    await tg.handle(ep('done'))
    await tg.handle(ep('done'))
    expect(only(sent, 'sendMessage')).toHaveLength(2)
    expect(only(sent, 'editMessageText')).toHaveLength(0)
  })

  it('on: second finish edits the first message, with a counter', async () => {
    const { tg, sent } = setup()
    tg.set({ digest: true })
    await tg.handle(ep('done'))
    await tg.handle(ep('done'))
    expect(only(sent, 'sendMessage')).toHaveLength(1)
    const edit = only(sent, 'editMessageText')
    expect(edit).toHaveLength(1)
    expect(edit[0]!.body.message_id).toBe(100)
    expect(String(edit[0]!.body.text)).toContain('done 2 times · 10:00')
    await tg.handle(ep('done'))
    expect(String(only(sent, 'editMessageText')[1]!.body.text)).toContain('done 3 times')
  })

  it('on: a permission in between is a new message and does not break the digest', async () => {
    const { tg, sent } = setup()
    tg.set({ digest: true })
    await tg.handle(ep('done'))
    await tg.handle(ep('permission'))
    expect(only(sent, 'sendMessage')).toHaveLength(2)
    await tg.handle(ep('done'))
    expect(only(sent, 'editMessageText')[0]!.body.message_id).toBe(100)
  })

  it('on: a new day starts a new message', async () => {
    const { tg, sent, advance } = setup()
    tg.set({ digest: true })
    await tg.handle(ep('done'))
    advance(24 * 3_600_000)
    await tg.handle(ep('done'))
    expect(only(sent, 'sendMessage')).toHaveLength(2)
    expect(only(sent, 'editMessageText')).toHaveLength(0)
  })

  it('on: two sessions have separate digests', async () => {
    const { tg, sent } = setup()
    tg.set({ digest: true })
    await tg.handle(ep('done', 't1'))
    await tg.handle(ep('done', 't2'))
    expect(only(sent, 'sendMessage')).toHaveLength(2)
    await tg.handle(ep('done', 't2'))
    expect(only(sent, 'editMessageText')[0]!.body.message_id).toBe(101)
  })

  it('on: a failed edit sends a new message and keeps going from it', async () => {
    const { tg, sent } = setup(true)
    tg.set({ digest: true })
    await tg.handle(ep('done'))
    await tg.handle(ep('done'))
    expect(only(sent, 'editMessageText')).toHaveLength(1)
    expect(only(sent, 'sendMessage')).toHaveLength(2)
    await tg.handle(ep('done'))
    expect(only(sent, 'editMessageText')[1]!.body.message_id).toBe(101)
  })

  it('patch and state carry digest as a boolean', () => {
    expect(sanitizeTelegramPatch({ digest: true })).toEqual({ digest: true })
    expect(sanitizeTelegramPatch({ digest: 'yes' })).toBeNull()
    const { tg } = setup()
    expect(tg.state().digest).toBe(false)
    tg.set({ digest: true })
    expect(tg.state().digest).toBe(true)
  })
})
