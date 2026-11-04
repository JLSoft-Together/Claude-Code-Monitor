import { maskSecrets, type TelegramChat, type TelegramEpisodeMessage, type TelegramError, type TelegramTopic } from '@ccm/shared'

export type TelegramLocale = 'en' | 'vi'

export type TgBody = string | FormData

export type TgFetch = (
  url: string,
  init: { method: 'POST' | 'GET'; headers?: Record<string, string>; body?: TgBody; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; arrayBuffer?: () => Promise<ArrayBuffer> }>

export const API_BASE = 'https://api.telegram.org'
export const MESSAGE_MAX = 4096
export const CAPTION_MAX = 1024

export type TgCall = { ok: true; result: unknown } | { ok: false; error: TelegramError; retryAfter?: number }

export const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function errorOf(status: number, body: unknown): TelegramError {
  const desc = isObj(body) && typeof body.description === 'string' ? body.description.toLowerCase() : ''
  if (status === 401 || status === 404) return 'token'
  if (status === 429) return 'rate'
  if (status === 409) return 'conflict'
  if (status === 403 || desc.includes('chat not found') || desc.includes('message to edit not found') || desc.includes("message can't be edited") || desc.includes('thread not found') || desc.includes('not enough rights')) return 'chat'
  if (status === 413) return 'too-large'
  return 'status'
}

export async function tgCall(fetch: TgFetch, base: string, token: string, method: string, body: Record<string, unknown> | FormData | null, timeoutMs: number): Promise<TgCall> {
  const url = `${base.replace(/\/+$/, '')}/bot${token}/${method}`
  const init =
    body instanceof FormData
      ? { method: 'POST' as const, body, signal: AbortSignal.timeout(timeoutMs) }
      : { method: 'POST' as const, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(timeoutMs) }
  let res: Awaited<ReturnType<TgFetch>>
  try {
    res = await fetch(url, init)
  } catch (err) {
    return { ok: false, error: (err as Error)?.name === 'TimeoutError' ? 'timeout' : 'network' }
  }
  const json = await res.json().catch(() => null)
  if (res.ok && isObj(json) && json.ok === true) return { ok: true, result: json.result }
  const retry = isObj(json) && isObj(json.parameters) && typeof json.parameters.retry_after === 'number' ? json.parameters.retry_after : undefined
  return { ok: false, error: errorOf(res.status, json), ...(retry ? { retryAfter: retry } : {}) }
}

const minutes = (ms: number): number => Math.max(0, Math.round(ms / 60_000))

const TEXT: Record<TelegramLocale, {
  done: (name: string, worked: number) => string
  waiting: (name: string) => string
  question: (name: string) => string
  permission: (name: string, tool?: string) => string
  report: (name: string) => string
  test: string
  bigFile: (file: string, mb: string) => string
  bigUploading: (file: string, mb: string, pct?: number) => string
  bigDone: (file: string, mb: string) => string
  bigFailed: (file: string, why: string) => string
  bigWhy: Record<'auth' | 'chat' | 'network' | 'failed', string>
}> = {
  en: {
    done: (n, w) => `✅ <b>${n}</b> finished${w ? ` after ${w} min` : ''}`,
    waiting: (n) => `⏳ <b>${n}</b> is waiting for your input`,
    question: (n) => `❓ <b>${n}</b> is asking you a question`,
    permission: (n, t) => `🔐 <b>${n}</b> needs approval${t ? `: ${t}` : ''}`,
    report: (n) => `📝 <b>${n}</b>`,
    test: '🤖 Test from Orrery: Telegram reports work in this topic.',
    bigFile: (f, mb) => `📦 ${f} (${mb} MB) is larger than Telegram allows bots to send; it stays on the machine.`,
    bigUploading: (f, mb, pct) => `⏫ Uploading ${f} (${mb} MB)…${pct === undefined ? '' : ` ${pct}%`}`,
    bigDone: (f, mb) => `✅ Sent ${f} (${mb} MB).`,
    bigFailed: (f, why) => `⚠️ Could not send ${f}: ${why}. The file stays on the machine.`,
    bigWhy: { auth: 'api_id / api_hash or the bot token was refused (Settings › Telegram › Large files)', chat: 'the bot cannot post in this topic', network: 'Telegram could not be reached', failed: 'upload failed' },
  },
  vi: {
    done: (n, w) => `✅ <b>${n}</b> đã xong${w ? ` sau ${w} phút` : ''}`,
    waiting: (n) => `⏳ <b>${n}</b> đang chờ chủ nhân trả lời`,
    question: (n) => `❓ <b>${n}</b> đang hỏi chủ nhân`,
    permission: (n, t) => `🔐 <b>${n}</b> cần duyệt${t ? `: ${t}` : ''}`,
    report: (n) => `📝 <b>${n}</b>`,
    test: '🤖 Thử từ Orrery: báo Telegram vào topic này đang chạy.',
    bigFile: (f, mb) => `📦 ${f} (${mb} MB) vượt giới hạn gửi file của bot Telegram, file vẫn nằm trên máy.`,
    bigUploading: (f, mb, pct) => `⏫ Đang gửi ${f} (${mb} MB)…${pct === undefined ? '' : ` ${pct}%`}`,
    bigDone: (f, mb) => `✅ Đã gửi ${f} (${mb} MB).`,
    bigFailed: (f, why) => `⚠️ Không gửi được ${f}: ${why}. File vẫn nằm trên máy.`,
    bigWhy: { auth: 'api_id / api_hash hoặc token bot bị từ chối (Settings › Telegram › File lớn)', chat: 'bot không gửi được vào topic này', network: 'không kết nối được Telegram', failed: 'upload lỗi' },
  },
}

export interface Masker {
  home: string
  platform: string
}

const clean = (s: string, m: Masker): string => maskSecrets(s, m.home, m.platform)

function clip(html: string, max: number): string {
  if (html.length <= max) return html
  return `${html.slice(0, max - 1).replace(/&[a-z]*$/i, '')}…`
}

export function quote(body: string, m: Masker, room: number): string {
  const text = escapeHtml(clean(body, m).trim())
  if (!text) return ''
  const open = '\n<blockquote expandable>'
  const close = '</blockquote>'
  const space = room - open.length - close.length
  if (space < 20) return ''
  return `${open}${clip(text, space)}${close}`
}

export function episodeHtml(e: TelegramEpisodeMessage, locale: TelegramLocale, m: Masker, reply: boolean): string {
  const t = TEXT[locale]
  const name = escapeHtml(clean(e.name, m))
  let head: string
  if (e.reason === 'done') head = t.done(name, e.worked !== undefined ? minutes(e.worked) : 0)
  else if (e.reason === 'question') head = t.question(name)
  else if (e.reason === 'permission') head = t.permission(name, e.tool)
  else head = t.waiting(name)
  return reply && e.reply ? `${head}${quote(e.reply, m, MESSAGE_MAX - head.length)}` : head
}

export function reportHtml(name: string, text: string, locale: TelegramLocale, m: Masker, max = MESSAGE_MAX): string {
  const head = TEXT[locale].report(escapeHtml(clean(name, m)))
  const body = escapeHtml(clean(text, m).trim())
  return clip(body ? `${head}\n${body}` : head, max)
}

export const testHtml = (locale: TelegramLocale): string => TEXT[locale].test

export const bigUploadingHtml = (locale: TelegramLocale, file: string, bytes: number, m: Masker, pct?: number): string =>
  TEXT[locale].bigUploading(escapeHtml(clean(file, m)), (bytes / 1024 ** 2).toFixed(1), pct)

export const bigDoneHtml = (locale: TelegramLocale, file: string, bytes: number, m: Masker): string =>
  TEXT[locale].bigDone(escapeHtml(clean(file, m)), (bytes / 1024 ** 2).toFixed(1))

export const bigFailedHtml = (locale: TelegramLocale, file: string, why: 'auth' | 'chat' | 'network' | 'failed', m: Masker): string =>
  TEXT[locale].bigFailed(escapeHtml(clean(file, m)), TEXT[locale].bigWhy[why])

export const bigFileHtml = (locale: TelegramLocale, file: string, bytes: number, m: Masker): string =>
  TEXT[locale].bigFile(escapeHtml(clean(file, m)), (bytes / 1024 ** 2).toFixed(1))

export function threadFields(chatId: string, threadId: number | null): Record<string, unknown> {
  return threadId ? { chat_id: chatId, message_thread_id: threadId } : { chat_id: chatId }
}

export interface ScanSeen {
  chats: Map<string, { title: string; isForum: boolean }>
  topics: Map<string, Map<number, string>>
}

export function scanUpdates(updates: unknown, into: ScanSeen = { chats: new Map(), topics: new Map() }): ScanSeen {
  if (!Array.isArray(updates)) return into
  for (const u of updates) {
    if (!isObj(u)) continue
    const member = isObj(u.my_chat_member) ? u.my_chat_member : null
    const msg = [u.message, u.edited_message, u.channel_post].find(isObj) as Record<string, unknown> | undefined
    const chat = (member && isObj(member.chat) ? member.chat : msg && isObj(msg.chat) ? msg.chat : null) as Record<string, unknown> | null
    if (!chat || (chat.type !== 'supergroup' && chat.type !== 'group')) continue
    const id = typeof chat.id === 'number' ? String(chat.id) : null
    if (!id) continue
    if (member && isObj(member.new_chat_member) && (member.new_chat_member.status === 'left' || member.new_chat_member.status === 'kicked')) {
      into.chats.delete(id)
      into.topics.delete(id)
      continue
    }
    into.chats.set(id, { title: typeof chat.title === 'string' ? chat.title.slice(0, 120) : id, isForum: chat.is_forum === true })
    if (!msg) continue
    const topics = into.topics.get(id) ?? new Map<number, string>()
    into.topics.set(id, topics)
    const created = isObj(msg.forum_topic_created) ? msg.forum_topic_created : null
    const replyTo = isObj(msg.reply_to_message) ? msg.reply_to_message : null
    const fromReply = replyTo && isObj(replyTo.forum_topic_created) ? replyTo.forum_topic_created : null
    const edited = isObj(msg.forum_topic_edited) ? msg.forum_topic_edited : null
    const thread = typeof msg.message_thread_id === 'number' && msg.is_topic_message === true ? msg.message_thread_id : null
    if (thread === null) continue
    const name = [created, edited, fromReply].map((c) => (c && typeof c.name === 'string' ? c.name : null)).find((n) => n)
    if (name) topics.set(thread, name.slice(0, 128))
    else if (!topics.has(thread)) topics.set(thread, `#${thread}`)
  }
  return into
}

export function chatsFrom(seen: ScanSeen, rights: Map<string, { botAdmin: boolean; canManageTopics: boolean; title?: string; isForum?: boolean }>): TelegramChat[] {
  return [...seen.chats.entries()].map(([chatId, c]) => {
    const r = rights.get(chatId)
    const topics: TelegramTopic[] = [...(seen.topics.get(chatId)?.entries() ?? [])].map(([threadId, name]) => ({ threadId, name })).sort((a, b) => a.name.localeCompare(b.name))
    return { chatId, title: r?.title ?? c.title, isForum: r?.isForum ?? c.isForum, botAdmin: r?.botAdmin ?? false, canManageTopics: r?.canManageTopics ?? false, topics }
  })
}
