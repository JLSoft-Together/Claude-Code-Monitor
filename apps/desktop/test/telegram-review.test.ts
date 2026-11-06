import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseInbound, type TelegramEpisodeMessage, type TelegramInbound, type TelegramInboundResult, type TelegramState } from '@ccm/shared'
import type { McpDeskCall } from '../../../packages/shared/src/mcpDesk'
import { createDesk, type DeskDeps } from '../src/mcpDesk'
import { telegramReceive } from '../src/pty/mcpTools/telegramReceive'
import type { ToolHost } from '../src/pty/mcpTools/types'
import { projectDiff, saveInbound } from '../src/telegram/host'
import { TEXT, resultHtml } from '../src/telegram/inbound'
import { TelegramNotifier } from '../src/telegram/notifier'
import type { TgFetch } from '../src/telegram/api'

const crypt = { available: () => true, encrypt: (s: string) => Buffer.from(`sealed:${s}`), decrypt: (b: Buffer) => b.toString().replace(/^sealed:/, '') }
const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ'
const TOKEN2 = '987654321:BBHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ'
const CHAT = -1001234567890
const CHAT2 = '-1009999999999'
const OWNER = 555
const project = path.resolve(os.tmpdir(), 'tg-review', 'A')
const nested = path.join(project, 'apps', 'x')
const SINCE = Date.parse('2026-11-04T10:00:00Z')

type Sent = { method: string; body: Record<string, unknown> | FormData; url: string }

interface Opts {
  answer?: (req: TelegramInbound) => TelegramInboundResult
  extra?: Partial<ConstructorParameters<typeof TelegramNotifier>[0]>
  file?: string
  now?: () => number
  polls?: { token: string; offset: unknown }[]
}

function setup(opts: Opts = {}) {
  const sent: Sent[] = []
  const asked: TelegramInbound[] = []
  const firstPoll = new Set<string>()
  let nextId = 100
  const fetch: TgFetch = async (url, init) => {
    const method = url.split('/').pop()!
    const body = init.body instanceof FormData ? init.body : typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {}
    if (method === 'getUpdates') {
      opts.polls?.push({ token: url.includes(TOKEN2) ? 'two' : 'one', offset: (body as Record<string, unknown>).offset })
      if ((body as Record<string, unknown>).offset === 0 && !firstPoll.has(url)) {
        firstPoll.add(url)
        return { ok: true, status: 200, json: async () => ({ ok: true, result: [] }) }
      }
      return new Promise(() => undefined)
    }
    sent.push({ method, body, url })
    const result = method === 'getMe' ? { id: 42, username: 'orrery_bot' } : method === 'sendMessage' ? { message_id: nextId++ } : true
    return { ok: true, status: 200, json: async () => ({ ok: true, result }) }
  }
  const file = opts.file ?? path.join(mkdtempSync(path.join(os.tmpdir(), 'tg-review-')), 'telegram.json')
  const tg = new TelegramNotifier({
    file,
    crypt,
    fetch,
    locale: () => 'vi',
    home: '',
    platform: 'win32',
    now: opts.now,
    sleep: async () => undefined,
    askPage: async (req) => {
      asked.push(req)
      return (opts.answer ?? (() => ({ ok: true, action: 'keys', name: 'A', key: 'approve' })))(req)
    },
    ...opts.extra,
  })
  tg.set({ token: TOKEN, enabled: true })
  tg.setRoute({ project, chatId: String(CHAT), threadId: 7 })
  return { tg, sent, asked, file }
}

const msgUpdate = (text: string, from = OWNER, threadId = 7) => ({
  update_id: 1,
  message: { message_id: 50, chat: { id: CHAT, type: 'supergroup' }, message_thread_id: threadId, is_topic_message: true, from: { id: from, first_name: 'Chủ' }, text },
})
const cbUpdate = (data: string, from = OWNER) => ({ update_id: 2, callback_query: { id: 'cb1', from: { id: from }, data, message: { message_id: 100 } } })
const ep = (patch: Partial<TelegramEpisodeMessage>): TelegramEpisodeMessage => ({ type: 'telegram', episode: 'e1', reason: 'permission', terminalId: 'term-1', name: 'A', cwd: project, tool: 'Bash', since: SINCE, ...patch })
const buttons = (s: Sent) => ((s.body as Record<string, unknown>).reply_markup as { inline_keyboard: { callback_data: string; text: string }[][] } | undefined)?.inline_keyboard.flat() ?? []
const lastMessage = (sent: Sent[]) => sent.filter((s) => s.method === 'sendMessage').at(-1)!
const lastText = (sent: Sent[]) => String((lastMessage(sent).body as Record<string, unknown>).text)
const flush = async () => {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0))
}

async function receiving(tg: TelegramNotifier) {
  const code = (tg.pair(true) as { ok: true; state: { pairCode: string } }).state.pairCode
  await tg.onUpdate(msgUpdate(`@orrery_bot pair ${code}`))
  tg.set({ receiving: true })
}

describe('approve buttons are bound to their permission prompt (WP-1 #1)', () => {
  it('sends the episode start and tool with the keys, and offers no approve button without a start', async () => {
    const { tg, sent, asked } = setup()
    await receiving(tg)
    await tg.handle(ep({ episode: 'p0', since: undefined }))
    expect(buttons(lastMessage(sent)).map((b) => b.callback_data.slice(0, 3))).toEqual(['tl:'])
    await tg.handle(ep({ episode: 'p1' }))
    const keys = buttons(lastMessage(sent))
    await tg.onUpdate(cbUpdate(keys[0]!.callback_data))
    expect(asked.at(-1)).toMatchObject({ action: 'keys', key: 'approve', since: SINCE, tool: 'Bash' })
    tg.stop()
  })

  it('stop carries the working start but not the tool', async () => {
    const { tg, sent, asked } = setup({
      answer: (req) => (req.action === 'status' ? { ok: true, action: 'status', panes: [{ name: 'A', status: 'working', terminalId: 'term-1', tool: 'Bash', since: SINCE }] } : { ok: true, action: 'keys', name: 'A', key: 'stop' }),
    })
    await receiving(tg)
    await tg.onUpdate(msgUpdate('@orrery_bot stop'))
    await tg.onUpdate(cbUpdate(buttons(lastMessage(sent))[0]!.callback_data))
    const keys = asked.at(-1) as Extract<TelegramInbound, { action: 'keys' }>
    expect(keys).toMatchObject({ action: 'keys', key: 'stop', since: SINCE })
    expect(keys.tool).toBeUndefined()
    tg.stop()
  })

  it('shared parse keeps since / tool / nested and drops bad values', () => {
    expect(parseInbound({ id: 'x', action: 'keys', project, key: 'approve', since: SINCE, tool: 'Bash', nested: [nested, 1, 'a\nb'] })).toEqual({ id: 'x', action: 'keys', project, key: 'approve', since: SINCE, tool: 'Bash', nested: [nested] })
    expect(parseInbound({ id: 'x', action: 'keys', project, key: 'deny', since: -5, tool: 'rm -rf' })).toEqual({ id: 'x', action: 'keys', project, key: 'deny' })
  })
})

describe('nested project routes (WP-2)', () => {
  it('tells the page which sub-projects have their own topic', async () => {
    const { tg, asked } = setup({ answer: () => ({ ok: true, action: 'status', panes: [] }) })
    tg.setRoute({ project: nested, chatId: String(CHAT), threadId: 8 })
    await receiving(tg)
    await tg.onUpdate(msgUpdate('@orrery_bot status'))
    expect(asked.at(-1)).toMatchObject({ action: 'status', project, nested: [nested] })
    await tg.onUpdate(msgUpdate('@orrery_bot status', OWNER, 8))
    expect(asked.at(-1)).toMatchObject({ action: 'status', project: nested })
    expect(asked.at(-1)!.nested).toBeUndefined()
    tg.stop()
  })

  it('answers all with nobody free as "none could take it"', async () => {
    const { tg, sent } = setup({ answer: () => ({ ok: false, error: 'busy' }) })
    await receiving(tg)
    await tg.onUpdate(msgUpdate('@orrery_bot all chạy test'))
    expect(lastText(sent)).toContain('Không session nào của project nhận được')
    tg.stop()
  })
})

describe('run failure caption (WP-1 #3)', () => {
  it('stays valid HTML within 1024 characters for a long detail with & < >', async () => {
    const { tg, sent } = setup({ extra: { runLog: () => ['FAILURE'] } })
    const detail = 'a & b < c > d '.repeat(400).slice(0, 5000)
    expect(await tg.runFailedReport({ id: 'r1', cwd: project, configName: 'app <debug>', failure: { code: 'gradle', detail } })).toBe(true)
    const caption = String((sent.find((s) => s.method === 'sendDocument')!.body as FormData).get('caption'))
    expect(caption.length).toBeLessThanOrEqual(1024)
    expect(caption.match(/<blockquote expandable>/g)).toHaveLength(1)
    expect(caption.endsWith('</blockquote>')).toBe(true)
    expect(caption).not.toMatch(/&(?!(amp|lt|gt);)/)
    expect(caption.replace(/<\/?(b|blockquote)( expandable)?>/g, '')).not.toMatch(/[<>]/)
  })

  it('keeps the text fallback under the message limit', async () => {
    const { tg, sent } = setup()
    const detail = '&'.repeat(5000)
    expect(await tg.runFailedReport({ id: 'r2', cwd: project, configName: 'app', failure: { code: 'gradle', detail } })).toBe(true)
    const text = lastText(sent)
    expect(text.length).toBeLessThanOrEqual(4096)
    expect(text.endsWith('</blockquote>')).toBe(true)
    expect(text).not.toMatch(/&(?!(amp|lt|gt);)/)
  })
})

describe('git helpers (WP-1 #4, #5)', () => {
  function repo(): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-rv-git-'))
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
    git('init', '-q')
    git('config', 'user.email', 't@t')
    git('config', 'user.name', 't')
    git('config', 'core.autocrlf', 'false')
    return dir
  }

  it('ignores .orrery of a project in a sub-folder of the repo', async () => {
    const dir = repo()
    const sub = path.join(dir, 'apps', 'x')
    mkdirSync(sub, { recursive: true })
    const file = await saveInbound(sub, 'shot.png', Buffer.from('x'))
    expect(file).not.toBeNull()
    expect(() => execFileSync('git', ['check-ignore', '-q', file!], { cwd: dir, stdio: 'ignore' })).not.toThrow()
  })

  it('diffs hundreds of long file names without passing them on the command line, still without secret files', async () => {
    const dir = repo()
    const names = Array.from({ length: 700 }, (_, i) => path.join('src', `a-rather-long-module-name-for-the-command-line-${String(i).padStart(4, '0')}.txt`))
    mkdirSync(path.join(dir, 'src', 'cfg'), { recursive: true })
    for (const n of names) writeFileSync(path.join(dir, n), 'one\n')
    writeFileSync(path.join(dir, 'src', 'cfg', '.Env.local'), 'X=1\n')
    execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'ignore' })
    execFileSync('git', ['commit', '-qm', 'init'], { cwd: dir, stdio: 'ignore' })
    for (const n of names) writeFileSync(path.join(dir, n), 'two\n')
    writeFileSync(path.join(dir, 'src', 'cfg', '.Env.local'), 'X=SECRET2\n')
    const res = await projectDiff(dir, '', 'linux')
    expect(res.ok && res.files).toBe(700)
    expect(res.ok && res.text).not.toContain('SECRET2')
  }, 60_000)
})

describe('day summary after a restart (WP-1 #6)', () => {
  it('does not send twice when the app restarts the same evening', async () => {
    let now = new Date(2026, 10, 4, 21, 1).getTime()
    const first = setup({ now: () => now })
    first.tg.set({ summary: { enabled: true, at: '21:00' } })
    await first.tg.handle(ep({ episode: 's1', reason: 'done', worked: 30 * 60_000 }))
    expect(await first.tg.tick()).toBe(true)
    now = new Date(2026, 10, 4, 22, 0).getTime()
    const again = setup({ now: () => now, file: first.file })
    expect(await again.tg.tick()).toBe(false)
    expect(again.sent.filter((s) => s.method === 'sendMessage')).toHaveLength(0)
  })

  it('skips the summary of a day it has no counts for when opened after the summary time', async () => {
    let now = new Date(2026, 10, 4, 22, 0).getTime()
    const { tg, sent } = setup({ now: () => now })
    tg.set({ summary: { enabled: true, at: '21:00' } })
    expect(await tg.tick()).toBe(false)
    expect(sent.filter((s) => s.method === 'sendMessage')).toHaveLength(0)
    now = new Date(2026, 10, 5, 21, 5).getTime()
    expect(await tg.tick()).toBe(true)
  })
})

describe('token change while receiving (WP-1 #7)', () => {
  it('restarts polling from the pending updates of the new bot', async () => {
    const polls: { token: string; offset: unknown }[] = []
    const { tg } = setup({ polls })
    await receiving(tg)
    await flush()
    expect(polls).toContainEqual({ token: 'one', offset: 0 })
    tg.set({ token: TOKEN2 })
    await flush()
    expect(polls).toContainEqual({ token: 'two', offset: 0 })
    tg.stop()
  })
})

describe('reply texts (WP-1 #8, #13, #14)', () => {
  it('keeps $ patterns of a session alias literal in "last"', async () => {
    const { tg, sent } = setup({ answer: () => ({ ok: true, action: 'status', panes: [{ name: "x$'y", status: 'idle', terminalId: 't1' }] }) })
    await receiving(tg)
    await tg.handle({ type: 'telegram', episode: 'e', reason: 'done', terminalId: 't1', name: "x$'y", cwd: project, worked: 10, reply: 'Xong' })
    await tg.onUpdate(msgUpdate('@orrery_bot last'))
    const text = lastText(sent)
    expect(text.split('\n')[0]).toBe("💬 Câu trả lời cuối của <b>x$'y</b>")
    expect(text.match(/<blockquote/g)).toHaveLength(1)
    tg.stop()
  })

  it('shows plain characters in button popups', async () => {
    const { tg, sent } = setup({ answer: () => ({ ok: false, error: 'many', panes: [{ name: 'A&B <x>', status: 'waiting' }] }) })
    await receiving(tg)
    await tg.handle(ep({ episode: 'p2' }))
    await tg.onUpdate(cbUpdate(buttons(lastMessage(sent))[0]!.callback_data))
    const popup = String((sent.filter((s) => s.method === 'answerCallbackQuery').at(-1)!.body as Record<string, unknown>).text)
    expect(popup).toContain('A&B <x>')
    expect(popup).not.toContain('&amp;')
    tg.stop()
  })

  it('says a previous key press is still being typed when the page answers busy for keys', async () => {
    const { tg, sent } = setup({ answer: () => ({ ok: false, error: 'busy', panes: [{ name: 'A', status: 'waiting' }] }) })
    await receiving(tg)
    await tg.handle(ep({ episode: 'p3' }))
    await tg.onUpdate(cbUpdate(buttons(lastMessage(sent))[0]!.callback_data))
    const popup = String((sent.filter((s) => s.method === 'answerCallbackQuery').at(-1)!.body as Record<string, unknown>).text)
    expect(popup).toContain('Nút bấm trước của session đó còn đang được gõ')
    expect(popup).not.toContain('đang mở rồi')
    tg.stop()
  })

  it('says a resumed session is already open instead of an empty busy name', () => {
    expect(resultHtml({ ok: false, error: 'busy' }, 'vi')).toBe(TEXT.vi.open)
    expect(resultHtml({ ok: false, error: 'busy', panes: [{ name: 'A', status: 'idle' }] }, 'en')).toBe(TEXT.en.busy('A'))
  })
})

describe('pinned status follows the route (WP-1 #9)', () => {
  it('drops the pin when the route moves to another chat and posts a new one there', async () => {
    const { tg, sent } = setup({ answer: () => ({ ok: true, action: 'status', panes: [{ name: 'A', status: 'idle' }] }) })
    tg.set({ pinStatus: true })
    await tg.pinTick()
    const first = lastMessage(sent)
    expect((first.body as Record<string, unknown>).chat_id).toBe(String(CHAT))
    tg.setRoute({ project, chatId: CHAT2, threadId: null })
    expect(sent.at(-1)).toMatchObject({ method: 'unpinChatMessage', body: { chat_id: String(CHAT) } })
    await tg.pinTick()
    expect(sent.filter((s) => s.method === 'editMessageText')).toHaveLength(0)
    expect((lastMessage(sent).body as Record<string, unknown>).chat_id).toBe(CHAT2)
  })

  it('unpins a pin saved by the previous version (per project) once and pins the topic instead', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-review-pin-'))
    const file = path.join(dir, 'telegram.json')
    writeFileSync(file, JSON.stringify({ enabled: true, token: Buffer.from(`sealed:${TOKEN}`).toString('base64'), pinStatus: true, routes: [{ project, label: 'A', chatId: String(CHAT), threadId: 7 }], pins: { [project]: 77 } }))
    const { tg, sent } = setup({ file, answer: () => ({ ok: true, action: 'status', panes: [] }) })
    await tg.pinTick()
    expect(sent.find((s) => s.method === 'unpinChatMessage')).toMatchObject({ body: { chat_id: String(CHAT), message_id: 77 } })
    expect(sent.some((s) => s.method === 'editMessageText')).toBe(false)
    expect(sent.filter((s) => s.method === 'pinChatMessage')).toHaveLength(1)
    await tg.pinTick()
    expect(sent.filter((s) => s.method === 'unpinChatMessage')).toHaveLength(1)
  })
})

describe('strangers (WP-1 #10, #11)', () => {
  it('a stranger guessing wrong does not cancel the owner pairing, and is blocked after 5 tries', async () => {
    const { tg } = setup()
    const code = (tg.pair(true) as { ok: true; state: { pairCode: string } }).state.pairCode
    const wrong = code === '000000' ? '111111' : '000000'
    for (let i = 0; i < 8; i++) await tg.onUpdate(msgUpdate(`@orrery_bot pair ${wrong}`, 900))
    expect(tg.state().pairCode).toBe(code)
    await tg.onUpdate(msgUpdate(`@orrery_bot pair ${code}`, 900))
    expect(tg.state().owner).toBeNull()
    await tg.onUpdate(msgUpdate(`@orrery_bot pair ${code}`))
    expect(tg.state().owner).toMatchObject({ id: OWNER })
    tg.stop()
  })

  it('cancels the code after 50 wrong tries from many accounts', async () => {
    const { tg } = setup()
    const code = (tg.pair(true) as { ok: true; state: { pairCode: string } }).state.pairCode
    const wrong = code === '000000' ? '111111' : '000000'
    for (let i = 0; i < 50; i++) await tg.onUpdate(msgUpdate(`@orrery_bot pair ${wrong}`, 1000 + Math.floor(i / 5)))
    expect(tg.state().pairCode).toBeNull()
    tg.stop()
  })

  it('answers strangers with the owner’s own line, or not at all when turned off', async () => {
    const { tg, sent } = setup({ now: () => 2_000_000 })
    await receiving(tg)
    expect(tg.set({ stranger: { enabled: true, text: 'Chỉ <b>{owner}</b> thôi' } }).ok).toBe(true)
    await tg.onUpdate(msgUpdate('@orrery_bot hi', 999))
    const last = () => String((sent.filter((s) => s.method === 'sendMessage').at(-1)?.body as Record<string, unknown> | undefined)?.text)
    expect(last()).toMatch(/^Chỉ &lt;b&gt;.+&lt;\/b&gt; thôi$/)
    const count = sent.length
    tg.set({ stranger: { enabled: false, text: '' } })
    await tg.onUpdate(msgUpdate('@orrery_bot hi', 999))
    expect(sent.length).toBe(count)
    expect(tg.state().stranger).toEqual({ enabled: false, text: '' })
    tg.stop()
  })

  it('throttles state broadcasts and "not yours" answers for strangers', async () => {
    const states: TelegramState[] = []
    const { tg, sent } = setup({ now: () => 1_000_000, extra: { onState: (s) => states.push(s) } })
    await receiving(tg)
    const before = states.length
    for (let i = 0; i < 10; i++) await tg.onUpdate(msgUpdate('@orrery_bot hi', 999))
    for (let i = 0; i < 10; i++) await tg.onUpdate(cbUpdate('ap:abcdef123456', 999))
    expect(states.length - before).toBeLessThanOrEqual(1)
    expect(tg.state().ignored).toBe(20)
    expect(sent.filter((s) => s.method === 'answerCallbackQuery')).toHaveLength(5)
    expect(sent.filter((s) => s.method === 'sendMessage' && JSON.stringify(s.body).includes('gửi thêm tiền'))).toHaveLength(5)
    tg.stop()
  })
})

describe('telegram_receive on needs a native confirm (DECISIONS 2026-11-04)', () => {
  function desk(answer: number | 'throw') {
    let receiving = false
    const asks: { message: string; buttons: string[] }[] = []
    const tg = {
      state: () => ({ configured: true, owner: { id: 1, name: 'Chủ' }, receiving }),
      set: (p: { receiving?: boolean }) => {
        receiving = p.receiving === true
        return { ok: true }
      },
    } as unknown as TelegramNotifier
    const deps: DeskDeps = {
      render: null,
      writeShot: async () => null,
      fallbackDir: os.tmpdir(),
      report: () => null,
      procRows: async () => null,
      home: '',
      locale: () => 'vi',
      kill: async () => ({ ok: false, error: 'cancelled' }),
      telegram: () => tg,
      confirm: async (spec) => {
        asks.push(spec)
        if (answer === 'throw') throw new Error('x')
        return answer
      },
    }
    const call = (state: 'on' | 'off' | 'status'): McpDeskCall => ({ id: 'i', from: 'pty-1', cwd: project, pid: null, name: 'A', tool: 'telegram_receive', state })
    return { ask: createDesk(deps), call, asks, receiving: () => receiving }
  }

  it('turns on only after the owner confirms; cancel leaves it off', async () => {
    const no = desk(1)
    expect(await no.ask(no.call('on'))).toEqual({ ok: false, error: 'cancelled' })
    expect(no.receiving()).toBe(false)
    expect(no.asks[0]!.message).toContain('“A”')
    expect(no.asks[0]!.buttons).toEqual(['Bật', 'Huỷ'])
    const broken = desk('throw')
    expect(await broken.ask(broken.call('on'))).toEqual({ ok: false, error: 'cancelled' })
    const yes = desk(0)
    expect(await yes.ask(yes.call('on'))).toMatchObject({ ok: true, tool: 'telegram_receive', receiving: true })
    expect(await yes.ask(yes.call('on'))).toMatchObject({ ok: true, receiving: true })
    expect(await yes.ask(yes.call('off'))).toMatchObject({ ok: true, receiving: false })
    expect(await yes.ask(yes.call('status'))).toMatchObject({ ok: true, receiving: false })
    expect(yes.asks).toHaveLength(1)
  })

  it('the MCP tool tells the agent the owner cancelled', async () => {
    const host = { root: project, take: () => true, desk: async () => ({ ok: false as const, error: 'cancelled' as const }) } as unknown as ToolHost
    const res = await telegramReceive.call({ state: 'on' }, host)
    expect(res.isError).toBe(true)
    expect(res.content[0]!.text).toContain('did not allow')
  })
})
