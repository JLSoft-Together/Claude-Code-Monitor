import { mkdtempSync, readFileSync, truncateSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  isSecretFileName,
  parseTelegramEpisode,
  parseTopicLink,
  sanitizeCreateTopic,
  sanitizeRouteInput,
  sanitizeTelegramPatch,
  type TelegramEpisodeMessage,
} from '@ccm/shared'
import { episodeHtml, errorOf, escapeHtml, reportHtml, scanUpdates } from '../src/telegram/api'
import { TelegramNotifier, TELEGRAM_PER_CHAT_MIN } from '../src/telegram/notifier'
import type { TgFetch } from '../src/telegram/api'
import type { BigUploadCreds, BigUploader, BigUploadRequest, BigUploadResult } from '../src/telegram/mtproto'

const crypt = {
  available: () => true,
  encrypt: (s: string) => Buffer.from(`sealed:${s}`),
  decrypt: (b: Buffer) => b.toString().replace(/^sealed:/, ''),
}

const TOKEN = '123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawQ'
const root = path.resolve(os.tmpdir(), 'tg-proj')
const projA = path.join(root, 'A')

type Sent = { method: string; body: Record<string, unknown> | FormData | null }

function fakeFetch(answers: Record<string, unknown> = {}, status: Record<string, number> = {}): { fetch: TgFetch; sent: Sent[] } {
  const sent: Sent[] = []
  const fetch: TgFetch = async (url, init) => {
    const method = url.split('/').pop()!
    const body = init.body instanceof FormData ? init.body : init.body ? (JSON.parse(init.body) as Record<string, unknown>) : null
    sent.push({ method, body })
    const code = status[method] ?? 200
    const result = answers[method] ?? (method === 'getMe' ? { id: 42, username: 'orrery_bot' } : true)
    return { ok: code === 200, status: code, json: async () => (code === 200 ? { ok: true, result } : { ok: false, description: 'Bad Request: chat not found' }) }
  }
  return { fetch, sent }
}

function notifier(fetch: TgFetch, extra: Partial<ConstructorParameters<typeof TelegramNotifier>[0]> = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-'))
  const tg = new TelegramNotifier({ file: path.join(dir, 'telegram.json'), crypt, fetch, locale: () => 'vi', home: 'C:\\Users\\me', platform: 'win32', ...extra })
  return { tg, file: path.join(dir, 'telegram.json') }
}

const done = (patch: Partial<TelegramEpisodeMessage> = {}): TelegramEpisodeMessage => ({
  type: 'telegram',
  episode: 'td:t1|a',
  reason: 'done',
  terminalId: 't1',
  name: 'A',
  cwd: path.join(projA, 'app'),
  worked: 5 * 60_000,
  ...patch,
})

describe('shared parsing', () => {
  it('reads topic links', () => {
    expect(parseTopicLink('https://t.me/c/1234567890/45/678')).toEqual({ chatId: '-1001234567890', threadId: 45 })
    expect(parseTopicLink('t.me/c/1234567890/678')).toEqual({ chatId: '-1001234567890', threadId: null })
    expect(parseTopicLink('https://t.me/c/1234567890/678?thread=45')).toEqual({ chatId: '-1001234567890', threadId: 45 })
    expect(parseTopicLink('https://t.me/mygroup/12/34')).toEqual({ chatId: '@mygroup', threadId: 12 })
    expect(parseTopicLink('-1001234567890:7')).toEqual({ chatId: '-1001234567890', threadId: 7 })
    expect(parseTopicLink('https://t.me/+AbCdEf123')).toBeNull()
    expect(parseTopicLink('https://evil.com/c/1234567890/1/2')).toBeNull()
  })

  it('checks episodes, patches and routes', () => {
    expect(parseTelegramEpisode({ ...done(), reply: 'x'.repeat(5000) })?.reply).toHaveLength(3000)
    expect(parseTelegramEpisode({ ...done(), reason: 'note' })).toBeNull()
    expect(parseTelegramEpisode({ ...done(), cwd: 'a\nb' })).toBeNull()
    expect(sanitizeTelegramPatch({ doneMinutes: 7 })).toBeNull()
    expect(sanitizeTelegramPatch({ doneMinutes: 3, token: ` ${TOKEN} ` })).toEqual({ doneMinutes: 3, token: TOKEN })
    expect(sanitizeRouteInput({ project: projA, chatId: '-1001', threadId: 3 })).toBeNull()
    expect(sanitizeRouteInput({ project: projA, chatId: '-1001234567890', threadId: 3 })).toEqual({ project: projA, chatId: '-1001234567890', threadId: 3 })
    expect(sanitizeCreateTopic({ chatId: '-1001234567890', project: projA, name: '  ' })).toBeNull()
    expect(isSecretFileName('.env.local')).toBe(true)
    expect(isSecretFileName('release.keystore')).toBe(true)
    expect(isSecretFileName('app-release.apk')).toBe(false)
  })
})

describe('api', () => {
  it('escapes and masks messages', () => {
    expect(escapeHtml('<b>&')).toBe('&lt;b&gt;&amp;')
    const html = episodeHtml(done({ name: '<A>', reply: 'Xong ở C:\\Users\\me\\x token=abcdef123456' }), 'vi', { home: 'C:\\Users\\me', platform: 'win32' }, true)
    expect(html).toContain('✅ <b>&lt;A&gt;</b> đã xong sau 5 phút')
    expect(html).toContain('<blockquote expandable>Xong ở ~\\x token=[masked]</blockquote>')
    expect(episodeHtml(done({ reply: 'secret' }), 'en', { home: '', platform: 'linux' }, false)).not.toContain('secret')
    expect(reportHtml('A', 'y'.repeat(5000), 'en', { home: '', platform: 'linux' }).length).toBeLessThanOrEqual(4096)
  })

  it('maps errors', () => {
    expect(errorOf(401, {})).toBe('token')
    expect(errorOf(400, { description: 'Bad Request: chat not found' })).toBe('chat')
    expect(errorOf(429, {})).toBe('rate')
    expect(errorOf(500, {})).toBe('status')
  })

  it('finds groups and topic names in updates', () => {
    const chat = { id: -1001234567890, type: 'supergroup', title: 'Test Bot', is_forum: true }
    const seen = scanUpdates([
      { my_chat_member: { chat, new_chat_member: { status: 'administrator' } } },
      { message: { chat, message_thread_id: 5, is_topic_message: true, reply_to_message: { forum_topic_created: { name: 'Project A' } } } },
      { message: { chat, message_thread_id: 9, is_topic_message: true } },
      { message: { chat: { id: 7, type: 'private' } } },
    ])
    expect([...seen.chats.keys()]).toEqual(['-1001234567890'])
    expect([...seen.topics.get('-1001234567890')!.entries()]).toEqual([
      [5, 'Project A'],
      [9, '#9'],
    ])
  })
})

describe('TelegramNotifier', () => {
  it('keeps the token sealed and out of the state', () => {
    const { fetch } = fakeFetch()
    const { tg, file } = notifier(fetch)
    expect(tg.set({ token: 'nope' })).toEqual({ ok: false, error: 'invalid-token' })
    const res = tg.set({ token: TOKEN })
    expect(res.ok && res.state.configured).toBe(true)
    expect(JSON.stringify(tg.state())).not.toContain(TOKEN)
    expect(readFileSync(file, 'utf8')).not.toContain(TOKEN)
  })

  it('sends a done episode only when on, routed, long enough and not reported', async () => {
    const { fetch, sent } = fakeFetch()
    const { tg } = notifier(fetch)
    tg.set({ token: TOKEN })
    expect(await tg.handle(done())).toBe(false)
    tg.set({ enabled: true })
    expect(await tg.handle(done())).toBe(false)
    tg.setRoute({ project: projA, link: 'https://t.me/c/1234567890/45/1' })
    expect(await tg.handle(done({ worked: 10_000, episode: 'short' }))).toBe(false)
    expect(await tg.handle(done({ cwd: path.join(root, 'C'), episode: 'other' }))).toBe(false)
    expect(await tg.handle(done())).toBe(true)
    expect(await tg.handle(done())).toBe(false)
    const msg = sent.filter((s) => s.method === 'sendMessage')
    expect(msg).toHaveLength(1)
    expect(msg[0]!.body).toMatchObject({ chat_id: '-1001234567890', message_thread_id: 45, parse_mode: 'HTML' })
    expect(await tg.report(projA, 'Đã build xong')).toMatchObject({ ok: true })
    expect(await tg.handle(done({ episode: 'after-report' }))).toBe(false)
  })

  it('leaves the reply out unless the owner turned it on', async () => {
    const { fetch, sent } = fakeFetch()
    const { tg } = notifier(fetch)
    tg.set({ token: TOKEN, enabled: true })
    tg.setRoute({ project: projA, chatId: '-1001234567890', threadId: null })
    await tg.handle(done({ reply: 'last answer', episode: 'e1' }))
    tg.set({ includeReply: true })
    await tg.handle(done({ reply: 'last answer', episode: 'e2' }))
    const texts = sent.filter((s) => s.method === 'sendMessage').map((s) => (s.body as Record<string, unknown>).text as string)
    expect(texts[0]).not.toContain('last answer')
    expect(texts[1]).toContain('last answer')
    expect((sent[sent.length - 1]!.body as Record<string, unknown>).message_thread_id).toBeUndefined()
  })

  it('skips waiting episodes when turned off and caps sends per chat', async () => {
    const { fetch } = fakeFetch()
    const { tg } = notifier(fetch)
    tg.set({ token: TOKEN, enabled: true, waiting: false })
    tg.setRoute({ project: projA, chatId: '-1001234567890', threadId: 3 })
    expect(await tg.handle(done({ reason: 'permission', episode: 'w' }))).toBe(false)
    let ok = 0
    for (let i = 0; i < TELEGRAM_PER_CHAT_MIN + 5; i++) if (await tg.handle(done({ episode: `d${i}` }))) ok++
    expect(ok).toBe(TELEGRAM_PER_CHAT_MIN)
    expect(tg.state().lastError).toBe('rate')
  })

  it('sends files from the project, refuses secrets and outside files, reports big files by path', async () => {
    const { fetch, sent } = fakeFetch()
    const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-files-'))
    writeFileSync(path.join(dir, 'app.apk'), 'apk')
    writeFileSync(path.join(dir, '.env'), 'X=1')
    const { tg } = notifier(fetch, { readFile: async () => Buffer.from('apk') })
    expect(await tg.report(dir, 'x')).toEqual({ ok: false, error: 'telegram-off' })
    tg.set({ token: TOKEN, enabled: true })
    expect(await tg.report(dir, 'x')).toEqual({ ok: false, error: 'no-topic' })
    tg.setRoute({ project: dir, chatId: '-1001234567890', threadId: 3 })
    expect(await tg.report(dir, 'x', path.join(dir, '.env'))).toEqual({ ok: false, error: 'secret' })
    expect(await tg.report(dir, 'x', path.join(os.tmpdir(), 'elsewhere.apk'))).toEqual({ ok: false, error: 'outside' })
    expect(await tg.report(dir, 'build ok', path.join(dir, 'app.apk'))).toMatchObject({ ok: true, file: 'app.apk' })
    const doc = sent.find((s) => s.method === 'sendDocument')!.body as FormData
    expect(doc.get('message_thread_id')).toBe('3')
    expect(String(doc.get('caption'))).toContain('build ok')
  })

  it('uploads big files over MTProto in the background when large files are on, else reports the path', async () => {
    const { fetch, sent } = fakeFetch()
    const dir = mkdtempSync(path.join(os.tmpdir(), 'tg-big-'))
    const apk = path.join(dir, 'app-release.apk')
    writeFileSync(apk, '')
    truncateSync(apk, 60 * 1024 * 1024)
    const calls: { req: BigUploadRequest; creds: BigUploadCreds }[] = []
    let answer: BigUploadResult = { ok: true }
    const bigUploader: BigUploader = { upload: async (req, creds) => (calls.push({ req, creds }), creds.onSession('sess-1'), answer), close: async () => undefined }
    const { tg, file } = notifier(fetch, { bigUploader })
    tg.set({ token: TOKEN, enabled: true })
    tg.setRoute({ project: dir, chatId: '-1001234567890', threadId: 3 })
    expect(await tg.report(dir, 'build ok', apk)).toMatchObject({ ok: true, file: 'app-release.apk', linkOnly: true })
    expect(calls).toHaveLength(0)

    expect(tg.set({ bigFiles: true, apiId: 123456, apiHash: '0123456789abcdef0123456789abcdef' }).ok).toBe(true)
    expect(tg.state().bigFiles).toEqual({ enabled: true, apiId: 123456, hasHash: true })
    expect(readFileSync(file, 'utf8')).not.toContain('0123456789abcdef0123456789abcdef')
    expect(await tg.report(dir, 'build ok', apk)).toMatchObject({ ok: true, file: 'app-release.apk', uploading: true })
    await new Promise((r) => setTimeout(r, 0))
    expect(calls[0]!.req).toMatchObject({ chatId: '-1001234567890', threadId: 3, file: apk, name: 'app-release.apk', size: 60 * 1024 * 1024 })
    expect(calls[0]!.req.caption).toContain('build ok')
    expect(calls[0]!.creds).toMatchObject({ apiId: 123456, apiHash: '0123456789abcdef0123456789abcdef', token: TOKEN, session: null })
    expect(String((sent.filter((s) => s.method === 'sendMessage').at(-1)!.body as Record<string, unknown>).text)).toContain('Đang gửi app-release.apk (60.0 MB)')

    answer = { ok: false, error: 'chat' }
    await tg.report(dir, 'lần 2', apk)
    await new Promise((r) => setTimeout(r, 0))
    expect(calls[1]!.creds.session).toBe('sess-1')
    expect(String((sent.filter((s) => s.method === 'sendMessage').at(-1)!.body as Record<string, unknown>).text)).toContain('Không gửi được app-release.apk')

    tg.set({ apiHash: 'fedcba9876543210fedcba9876543210' })
    await tg.report(dir, 'lần 3', apk)
    await new Promise((r) => setTimeout(r, 0))
    expect(calls[2]!.creds.session).toBeNull()
    expect(sanitizeTelegramPatch({ apiHash: 'nope' })).toBeNull()
    expect(sanitizeTelegramPatch({ apiId: -1 })).toBeNull()
    expect(sanitizeTelegramPatch({ apiId: null, apiHash: '', bigFiles: false })).toEqual({ apiId: null, apiHash: '', bigFiles: false })
  })

  it('discovers groups with bot rights and creates a topic as a route', async () => {
    const chat = { id: -1001234567890, type: 'supergroup', title: 'Test Bot', is_forum: true }
    const { fetch } = fakeFetch({
      getUpdates: [{ message: { chat, message_thread_id: 5, is_topic_message: true, reply_to_message: { forum_topic_created: { name: 'A' } } } }],
      getChat: chat,
      getChatMember: { status: 'administrator', can_manage_topics: true },
      createForumTopic: { message_thread_id: 77, name: 'B' },
    })
    const { tg } = notifier(fetch)
    expect(await tg.discover()).toEqual({ ok: false, error: 'config' })
    tg.set({ token: TOKEN })
    const found = await tg.discover()
    expect(found).toEqual({ ok: true, chats: [{ chatId: '-1001234567890', title: 'Test Bot', isForum: true, botAdmin: true, canManageTopics: true, topics: [{ threadId: 5, name: 'A' }] }] })
    const made = await tg.createTopic({ chatId: '-1001234567890', project: path.join(root, 'B'), name: 'B' })
    expect(made.ok && made.state.routes).toEqual([{ project: path.join(root, 'B'), label: 'B', chatId: '-1001234567890', threadId: 77, where: 'Test Bot › B' }])
    expect(tg.topicName(tg.routeFor(path.join(root, 'B', 'src'))!)).toBe('Test Bot › B')
  })

  it('reports a refused chat once', async () => {
    const failures: string[] = []
    const { fetch } = fakeFetch({}, { sendMessage: 400 })
    const { tg } = notifier(fetch, { onFailure: (e) => failures.push(e) })
    tg.set({ token: TOKEN, enabled: true })
    tg.setRoute({ project: projA, chatId: '-1001234567890', threadId: 1 })
    await tg.handle(done({ episode: 'a' }))
    await tg.handle(done({ episode: 'b' }))
    expect(failures).toEqual(['chat'])
  })
})
