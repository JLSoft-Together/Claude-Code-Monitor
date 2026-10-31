import { maskSecrets, type PhoneChannel, type PhoneEpisodeMessage } from '@ccm/shared'

export type PhoneLocale = 'en' | 'vi'

export interface PhoneDestination {
  channel: PhoneChannel
  /** ntfy server base or Discord webhook URL. */
  url: string
  topic?: string
}

export interface PhoneText {
  title: string
  body: string
}

const TOPIC_RE = /^[A-Za-z0-9_-]{1,64}$/
const DISCORD_HOSTS = new Set(['discord.com', 'discordapp.com', 'ptb.discord.com', 'canary.discord.com'])

/** http(s) only, no credentials in the URL; returns the base without a trailing slash. */
export function cleanNtfyServer(raw: string): string | null {
  try {
    const u = new URL(raw)
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || u.search || u.hash) return null
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

export const cleanTopic = (raw: string): string | null => (TOPIC_RE.test(raw) ? raw : null)

export function cleanDiscordUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'https:' || !DISCORD_HOSTS.has(u.hostname) || !/^\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+\/?$/.test(u.pathname) || u.username) return null
    return `${u.origin}${u.pathname.replace(/\/$/, '')}`
  } catch {
    return null
  }
}

export const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

const minutes = (ms: number): number => Math.max(0, Math.round(ms / 60_000))

const TEXT: Record<PhoneLocale, { [K in PhoneEpisodeMessage['reason']]: (m: PhoneEpisodeMessage, waited: number | null) => string } & { test: string; title: (name: string) => string }> = {
  en: {
    title: (name) => `Orrery · ${name}`,
    waiting: (_, w) => (w ? `Waiting for your input for ${w} min` : 'Waiting for your input'),
    question: (_, w) => (w ? `Asking you a question (${w} min)` : 'Asking you a question'),
    permission: (m, w) => `${m.tool ? `Needs approval: ${m.tool}` : 'Needs approval'}${w ? ` (${w} min)` : ''}`,
    done: (_, w) => (w ? `Finished after ${w} min of work` : 'Finished'),
    job: () => 'A background job needs you',
    limit: () => 'Usage limit is about to run out',
    test: 'Test from Orrery: phone notifications work.',
  },
  vi: {
    title: (name) => `Orrery · ${name}`,
    waiting: (_, w) => (w ? `Đang chờ chủ nhân trả lời ${w} phút` : 'Đang chờ chủ nhân trả lời'),
    question: (_, w) => (w ? `Đang hỏi chủ nhân (${w} phút)` : 'Đang hỏi chủ nhân'),
    permission: (m, w) => `${m.tool ? `Cần duyệt: ${m.tool}` : 'Cần duyệt'}${w ? ` (${w} phút)` : ''}`,
    done: (_, w) => (w ? `Đã xong sau ${w} phút làm việc` : 'Đã xong'),
    job: () => 'Job nền cần chủ nhân',
    limit: () => 'Hạn mức sắp hết',
    test: 'Thử từ Orrery: báo ra điện thoại đang chạy.',
  },
}

/** Only app name, session / folder name, reason, tool name and minutes; everything goes through maskSecrets. */
export function phoneText(m: PhoneEpisodeMessage, locale: PhoneLocale, nowMs: number, home: string, platform: string): PhoneText {
  const text = TEXT[locale]
  const waited = m.since !== undefined ? minutes(nowMs - m.since) : null
  const mask = (s: string) => maskSecrets(s, home, platform).replace(/[\r\n]+/g, ' ').slice(0, 200)
  return { title: mask(text.title(m.name)), body: mask(text[m.reason](m, waited)) }
}

export function testText(locale: PhoneLocale): PhoneText {
  return { title: 'Orrery', body: TEXT[locale].test }
}

export interface PhoneRequest {
  url: string
  init: { method: 'POST'; headers: Record<string, string>; body: string }
}

/** ntfy JSON publish at the server root (UTF-8 safe, unlike the Title header); Discord webhook without mentions. */
export function buildRequest(dest: PhoneDestination, msg: PhoneText, override?: string | null): PhoneRequest {
  const headers = { 'Content-Type': 'application/json' }
  if (dest.channel === 'ntfy') {
    const body = JSON.stringify({ topic: dest.topic, title: msg.title, message: msg.body, tags: ['robot'] })
    return { url: override || dest.url, init: { method: 'POST', headers, body } }
  }
  const body = JSON.stringify({ username: 'Orrery', content: `**${msg.title}**\n${msg.body}`, allowed_mentions: { parse: [] } })
  return { url: override || dest.url, init: { method: 'POST', headers, body } }
}

/** Sliding window: at most `max` sends per `windowMs`. */
export class RateLimiter {
  private readonly times: number[] = []

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(): boolean {
    const t = this.now()
    while (this.times.length && t - this.times[0]! >= this.windowMs) this.times.shift()
    if (this.times.length >= this.max) return false
    this.times.push(t)
    return true
  }
}

/** E2E only: a loopback http URL replaces the real destination. */
export function e2eOverride(raw: string | undefined): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw)
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost') ? u.toString() : null
  } catch {
    return null
  }
}
