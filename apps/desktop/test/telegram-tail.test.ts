import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseInbound, parseInboundResult, type TelegramInbound, type TelegramInboundResult } from '@ccm/shared'
import { commandOf, readMessage, tailHtml } from '../src/telegram/inbound'
import { TelegramNotifier } from '../src/telegram/notifier'
import type { TgFetch } from '../src/telegram/api'

const crypt = { available: () => true, encrypt: (s: string) => Buffer.from(`sealed:${s}`), decrypt: (b: Buffer) => b.toString().replace(/^sealed:/, '') }
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ'
const CHAT = -1001234567890
const OWNER = 555
const project = path.resolve(os.tmpdir(), 'tg-tail', 'A')

type Sent = { method: string; body: Record<string, unknown> }

function setup(answer: (req: TelegramInbound) => TelegramInboundResult, opts: { locale?: 'en' | 'vi'; failCommands?: boolean; file?: string; reuse?: boolean } = {}) {
  const sent: Sent[] = []
  const asked: TelegramInbound[] = []
  let nextId = 100
  const fetch: TgFetch = async (url, init) => {
    const method = url.split('/').pop()!
    if (method === 'getUpdates') return new Promise(() => undefined)
    sent.push({ method, body: typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {} })
    if (method === 'setMyCommands' && opts.failCommands) return { ok: false, status: 500, json: async () => ({ ok: false }) }
    const result = method === 'getMe' ? { id: 42, username: 'orrery_bot' } : method === 'sendMessage' ? { message_id: nextId++ } : true
    return { ok: true, status: 200, json: async () => ({ ok: true, result }) }
  }
  const file = opts.file ?? path.join(mkdtempSync(path.join(os.tmpdir(), 'tg-tail-')), 'telegram.json')
  const tg = new TelegramNotifier({
    file,
    crypt,
    fetch,
    locale: () => opts.locale ?? 'vi',
    home: '',
    platform: 'win32',
    sleep: async () => undefined,
    askPage: async (req) => {
      asked.push(req)
      return answer(req)
    },
  })
  if (!opts.reuse) {
    tg.set({ token: TOKEN, enabled: true })
    tg.setRoute({ project, chatId: String(CHAT), threadId: 7 })
  }
  return { tg, sent, asked, file }
}

const msg = (text: string) => ({
  update_id: 1,
  message: { message_id: 50, chat: { id: CHAT, type: 'supergroup' }, message_thread_id: 7, is_topic_message: true, from: { id: OWNER, first_name: 'Chủ' }, text },
})
const cb = (data: string) => ({ update_id: 2, callback_query: { id: 'cb', from: { id: OWNER }, data, message: { message_id: 101 } } })
const messages = (sent: Sent[]) => sent.filter((s) => s.method === 'sendMessage')
const lastText = (sent: Sent[]) => String(messages(sent).at(-1)!.body.text)
const keysOf = (sent: Sent[]) => (messages(sent).at(-1)!.body.reply_markup as { inline_keyboard: { callback_data: string; text: string }[][] }).inline_keyboard.flat()
const flush = () => new Promise((r) => setTimeout(r, 0))

async function pairOnly(tg: TelegramNotifier) {
  const code = (tg.pair(true) as { ok: true; state: { pairCode: string } }).state.pairCode
  await tg.onUpdate(msg(`@orrery_bot pair ${code}`))
}

async function receiving(tg: TelegramNotifier) {
  await pairOnly(tg)
  tg.set({ receiving: true })
  await flush()
}

const commandCalls = (sent: Sent[]) => sent.filter((s) => s.method === 'setMyCommands')

describe('v85 menu "/" commands', () => {
  it('sets the menu once with every command, for default and app locale', async () => {
    const { tg, sent } = setup(() => ({ ok: false, error: 'none' }))
    await receiving(tg)
    const calls = commandCalls(sent)
    expect(calls).toHaveLength(2)
    expect(calls[0]!.body).toMatchObject({ scope: { type: 'all_group_chats' } })
    expect(calls[0]!.body.language_code).toBeUndefined()
    expect(calls[1]!.body.language_code).toBe('vi')
    const names = (calls[0]!.body.commands as { command: string }[]).map((c) => c.command)
    expect(names).toEqual(['status', 'new', 'stop', 'last', 'tail', 'resume', 'run', 'all', 'screen', 'help'])
    for (const c of calls[1]!.body.commands as { command: string; description: string }[]) expect(c.description.length).toBeGreaterThan(0)
    tg.set({ receiving: false })
    tg.set({ receiving: true })
    await flush()
    expect(commandCalls(sent)).toHaveLength(2)
    tg.stop()
  })

  it('does not repeat after a restart, but does for a new token', async () => {
    const first = setup(() => ({ ok: false, error: 'none' }), { locale: 'en' })
    await receiving(first.tg)
    expect(commandCalls(first.sent)).toHaveLength(1)
    expect(JSON.parse(readFileSync(first.file, 'utf8')).commandsHash).toMatch(/^[0-9a-f]{16}$/)
    first.tg.stop()
    const again = setup(() => ({ ok: false, error: 'none' }), { locale: 'en', file: first.file, reuse: true })
    again.tg.set({ receiving: true })
    await flush()
    expect(commandCalls(again.sent)).toHaveLength(0)
    again.tg.set({ token: '987654321:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ', receiving: true })
    await flush()
    expect(commandCalls(again.sent)).toHaveLength(1)
    again.tg.stop()
  })

  it('keeps receiving and retries later when Telegram refuses the menu', async () => {
    const { tg, sent, file } = setup(() => ({ ok: false, error: 'none' }), { failCommands: true })
    await receiving(tg)
    expect(tg.isReceiving).toBe(true)
    expect(commandCalls(sent).length).toBeGreaterThan(0)
    expect(JSON.parse(readFileSync(file, 'utf8')).commandsHash).toBeUndefined()
    tg.stop()
  })

  it('understands /status@bot in a group', () => {
    const c = (t: string) => commandOf(readMessage(msg(t), 42)!, 'orrery_bot')
    expect(c('/status@orrery_bot')).toEqual({ kind: 'status' })
    expect(c('/tail@orrery_bot 50')).toEqual({ kind: 'tail', lines: 50 })
    expect(c('/Status@Orrery_Bot')).toEqual({ kind: 'status' })
    expect(c('/status@other_bot')).toBeNull()
  })

  it('takes a bare menu command picked from "/" in a one-bot group, not other slash text', () => {
    const c = (t: string) => commandOf(readMessage(msg(t), 42)!, 'orrery_bot')
    expect(c('/status')).toEqual({ kind: 'status' })
    expect(c('/tail 20')).toEqual({ kind: 'tail', lines: 20 })
    expect(c('/compact')).toBeNull()
    expect(c('status')).toBeNull()
  })
})

describe('v85 tail', () => {
  it('parses the line count', () => {
    const c = (t: string) => commandOf(readMessage(msg(t), 42)!, 'orrery_bot')
    expect(c('@orrery_bot tail')).toEqual({ kind: 'tail', lines: 30 })
    expect(c('@orrery_bot tail 50')).toEqual({ kind: 'tail', lines: 50 })
    expect(c('@orrery_bot tail 500')).toEqual({ kind: 'tail', lines: 80 })
    expect(c('@orrery_bot /tail 0')).toEqual({ kind: 'tail', lines: 30 })
    expect(c('@orrery_bot tail the build log')).toEqual({ kind: 'send', text: 'tail the build log' })
  })

  it('contract: request clamps lines, result drops control characters', () => {
    expect(parseInbound({ id: 'x', action: 'tail', project, lines: 999 })).toMatchObject({ action: 'tail', lines: 80 })
    expect(parseInbound({ id: 'x', action: 'tail', project, lines: 'x' })).toMatchObject({ action: 'tail', lines: 30 })
    expect(parseInboundResult({ ok: true, action: 'tail', name: 'A', text: 'a\u001b[31mb\nc' })).toEqual({ ok: true, action: 'tail', name: 'A', text: 'a[31mb\nc' })
    expect(parseInboundResult({ ok: true, action: 'tail', name: 'A' })).toEqual({ ok: false, error: 'unavailable' })
  })

  it('sends the last lines of the only pane in <pre>, with secrets masked', async () => {
    const text = `build ok\nANTHROPIC key sk-ant-api03-abcdefghijklmnop1234\nbot ${TOKEN}\nif a < b && c > d`
    const { tg, sent, asked } = setup((req) => (req.action === 'status' ? { ok: true, action: 'status', panes: [{ name: 'A', status: 'idle', terminalId: 't1' }] } : { ok: true, action: 'tail', name: 'A', text }))
    await receiving(tg)
    await tg.onUpdate(msg('@orrery_bot tail 12'))
    expect(asked.at(-1)).toMatchObject({ action: 'tail', lines: 12, target: { kind: 'terminal', terminalId: 't1' } })
    const out = lastText(sent)
    expect(out).toContain('<pre>')
    expect(out).toContain('build ok')
    expect(out).toContain('a &lt; b &amp;&amp; c &gt; d')
    expect(out).not.toContain('sk-ant-api03')
    expect(out).not.toContain('AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ')
    tg.stop()
  })

  it('offers buttons when several panes are open, and the button sends the tail', async () => {
    const panes = [{ name: 'A', status: 'idle', terminalId: 't1' }, { name: 'A 2', status: 'working', terminalId: 't2' }]
    const { tg, sent, asked } = setup((req) => (req.action === 'status' ? { ok: true, action: 'status', panes } : { ok: true, action: 'tail', name: 'A 2', text: 'line' }))
    await receiving(tg)
    await tg.onUpdate(msg('@orrery_bot tail'))
    expect(asked.map((a) => a.action)).toEqual(['status'])
    const keys = keysOf(sent)
    expect(keys.map((k) => k.text)).toEqual(['📜 A · rảnh', '📜 A 2 · đang làm'])
    await tg.onUpdate(cb(keys[1]!.callback_data))
    expect(asked.at(-1)).toMatchObject({ action: 'tail', lines: 30, target: { kind: 'terminal', terminalId: 't2' } })
    expect(lastText(sent)).toContain('<pre>line</pre>')
    tg.stop()
  })

  it('tail 500 asks the page for 80 lines', async () => {
    const { tg, asked } = setup((req) => (req.action === 'status' ? { ok: true, action: 'status', panes: [{ name: 'A', status: 'idle', terminalId: 't1' }] } : { ok: true, action: 'tail', name: 'A', text: 'x' }))
    await receiving(tg)
    await tg.onUpdate(msg('@orrery_bot tail 500'))
    expect(asked.at(-1)).toMatchObject({ action: 'tail', lines: 80 })
    tg.stop()
  })

  it('says so when the pane is gone or there is no pane', async () => {
    const { tg, sent } = setup((req) => (req.action === 'status' ? { ok: true, action: 'status', panes: [{ name: 'A', status: 'idle', terminalId: 't1' }] } : { ok: false, error: 'gone' }))
    await receiving(tg)
    await tg.onUpdate(msg('@orrery_bot tail'))
    expect(lastText(sent)).toContain('không còn mở')
    tg.stop()
    const none = setup(() => ({ ok: true, action: 'status', panes: [] }))
    await receiving(none.tg)
    await none.tg.onUpdate(msg('@orrery_bot tail'))
    expect(lastText(none.sent)).toContain('Không có session')
    none.tg.stop()
  })
})

describe('v85 tailHtml', () => {
  it('keeps the end, stays under the limit and never splits an escape', () => {
    const text = Array.from({ length: 400 }, (_, i) => `line ${i} <&> padding padding padding`).join('\n')
    const html = tailHtml('A', text, 'en', '', 'win32')
    expect(html.length).toBeLessThan(4096)
    expect(html).toContain('line 399')
    expect(html).not.toContain('line 0 ')
    expect(html).not.toMatch(/&(?!amp;|lt;|gt;)/)
  })

  it('handles an empty screen and HTML in the terminal output', () => {
    expect(tailHtml('A', '  \n \n', 'en', '', 'win32')).toContain('empty')
    expect(tailHtml('<b>x</b>', '</pre><b>hi</b>', 'en', '', 'win32')).toContain('<pre>&lt;/pre&gt;&lt;b&gt;hi&lt;/b&gt;</pre>')
  })
})
