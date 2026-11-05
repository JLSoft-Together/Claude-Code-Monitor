import { SECRET_FILE_GLOBS } from './sensitive'

export const TELEGRAM_REASONS = ['done', 'waiting', 'question', 'permission'] as const
export type TelegramReason = (typeof TELEGRAM_REASONS)[number]

export interface TelegramEpisodeMessage {
  type: 'telegram'
  episode: string
  reason: TelegramReason
  terminalId: string
  name: string
  cwd: string
  since?: number
  worked?: number
  tool?: string
  reply?: string
  ask?: TelegramAsk
}

/** First AskUserQuestion question only: question + option labels, never description / preview. Goes to the owner's Telegram, never to the page (docs §11an-f). */
export interface TelegramAsk {
  question: string
  options: string[]
  multi: boolean
  /** More options than `TELEGRAM_ASK_OPTIONS_MAX`: the extra labels are dropped and no buttons are offered. */
  more?: true
}

export const TELEGRAM_ASK_QUESTION_MAX = 200
export const TELEGRAM_ASK_OPTIONS_MAX = 6
export const TELEGRAM_ASK_LABEL_MAX = 60

const oneLine = (v: string, max: number) => v.replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, max)

export function parseTelegramAsk(raw: unknown): TelegramAsk | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  if (typeof r.question !== 'string' || !Array.isArray(r.options) || typeof r.multi !== 'boolean') return undefined
  const question = oneLine(r.question, TELEGRAM_ASK_QUESTION_MAX)
  if (!question) return undefined
  const options: string[] = []
  for (const o of r.options) {
    if (typeof o !== 'string') return undefined
    const label = oneLine(o, TELEGRAM_ASK_LABEL_MAX)
    if (!label) return undefined
    options.push(label)
  }
  if (!options.length) return undefined
  const more = options.length > TELEGRAM_ASK_OPTIONS_MAX || r.more === true
  return { question, options: options.slice(0, TELEGRAM_ASK_OPTIONS_MAX), multi: r.multi, ...(more ? { more: true as const } : {}) }
}

export const TELEGRAM_DONE_CHOICES = [0, 1, 3, 5, 10] as const
export const DEFAULT_TELEGRAM_DONE_MIN = 1
export const TELEGRAM_REPLY_MAX = 3000
export const TELEGRAM_REPORT_MAX = 3000
export const TELEGRAM_FILE_MAX = 50 * 1024 * 1024
export const TELEGRAM_BIG_FILE_MAX = 2000 * 1024 * 1024
export const TELEGRAM_ROUTES_MAX = 100

export interface TelegramRoute {
  project: string
  label: string
  chatId: string
  threadId: number | null
  /** State only: "Group › Topic" as far as the bot has seen the names. */
  where?: string
  /** State only: the last send to this topic failed because the topic / group is gone or the bot lost its rights. */
  broken?: boolean
}

export type TelegramError = 'network' | 'status' | 'timeout' | 'rate' | 'keychain' | 'config' | 'token' | 'chat' | 'too-large' | 'conflict'

export interface TelegramOwner {
  id: number
  name: string
}

export interface TelegramState {
  receiving: boolean
  owner: TelegramOwner | null
  pairCode: string | null
  pairUntil: number | null
  ignored: number
  receiveInstalled: boolean
  enabled: boolean
  configured: boolean
  keychain: boolean
  bot: string | null
  includeReply: boolean
  digest: boolean
  waiting: boolean
  doneMinutes: number
  routes: TelegramRoute[]
  commandInstalled: boolean
  lastError: TelegramError | null
  /** getUpdates keeps answering 409: another program polls this bot. After 3 in a row the poll stops until a retry. */
  pollConflict: boolean
  quiet: TelegramQuiet
  summary: TelegramSummary
  alerts: boolean
  pinStatus: boolean
  /** Forum topic icon follows its sessions: working / waiting / idle. */
  topicIcons: boolean
  health: TelegramHealth
  bigFiles: TelegramBigFiles
  sessionRoutes: TelegramSessionRoute[]
  stranger: TelegramStranger
  members: TelegramMember[]
  /** In memory only: the last people (not owner, not member) who mentioned the bot, newest first, so the owner can add them. */
  recentStrangers: TelegramStrangerSeen[]
}

/** `read`: status / last / tail / help and the 💬 📜 📄 buttons. `full`: everything but pairing, topic links, the off-time backlog and the Allow / Deny buttons. */
export const TELEGRAM_MEMBER_LEVELS = ['read', 'full'] as const
export type TelegramMemberLevel = (typeof TELEGRAM_MEMBER_LEVELS)[number]

export interface TelegramMember {
  id: number
  name: string
  level: TelegramMemberLevel
}

export interface TelegramStrangerSeen {
  id: number
  name: string
  at: number
  chat: string
}

export const TELEGRAM_MEMBERS_MAX = 20

export const isTelegramUserId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0

/** Every entry must be valid (a bad one rejects the whole list); `null` = reject. Duplicated ids are rejected too. */
export function parseTelegramMembers(raw: unknown): TelegramMember[] | null {
  if (!Array.isArray(raw) || raw.length > TELEGRAM_MEMBERS_MAX) return null
  const out: TelegramMember[] = []
  for (const m of raw) {
    const o = m as Record<string, unknown> | null
    if (!o || typeof o !== 'object' || !isTelegramUserId(o.id) || typeof o.name !== 'string' || !(TELEGRAM_MEMBER_LEVELS as readonly unknown[]).includes(o.level)) return null
    if (out.some((x) => x.id === o.id)) return null
    const name = o.name.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]+/g, ' ').trim().slice(0, NAME_MAX) || String(o.id)
    out.push({ id: o.id, name, level: o.level as TelegramMemberLevel })
  }
  return out
}

/** Fixed answer to anyone but the paired owner who mentions the bot; '' text = the built-in line, {owner} = the owner's name. */
export interface TelegramStranger {
  enabled: boolean
  text: string
}

export const TELEGRAM_STRANGER_MAX = 300
export const DEFAULT_TELEGRAM_STRANGER: TelegramStranger = { enabled: true, text: '' }

export interface TelegramBigFiles {
  enabled: boolean
  apiId: number | null
  hasHash: boolean
}

export interface TelegramHealth {
  lastSentAt: number | null
  lastReceivedAt: number | null
  lastPollAt: number | null
  sentToday: number
  errorsToday: number
}

export interface TelegramQuiet {
  enabled: boolean
  from: string
  to: string
}

export interface TelegramSummary {
  enabled: boolean
  at: string
}

export const DEFAULT_TELEGRAM_QUIET: TelegramQuiet = { enabled: false, from: '23:00', to: '07:00' }
export const DEFAULT_TELEGRAM_SUMMARY: TelegramSummary = { enabled: false, at: '21:00' }

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/
export const isHhmm = (v: unknown): v is string => typeof v === 'string' && HHMM.test(v)
const minuteOf = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))

export function inTelegramQuiet(q: TelegramQuiet, at: Date): boolean {
  if (!q.enabled) return false
  const now = at.getHours() * 60 + at.getMinutes()
  const from = minuteOf(q.from)
  const to = minuteOf(q.to)
  if (from === to) return false
  return from < to ? now >= from && now < to : now >= from || now < to
}

export interface TelegramPatch {
  receiving?: boolean
  enabled?: boolean
  token?: string
  includeReply?: boolean
  digest?: boolean
  waiting?: boolean
  doneMinutes?: number
  quiet?: TelegramQuiet
  summary?: TelegramSummary
  alerts?: boolean
  pinStatus?: boolean
  topicIcons?: boolean
  bigFiles?: boolean
  apiId?: number | null
  apiHash?: string
  stranger?: TelegramStranger
  members?: TelegramMember[]
}

export interface TelegramRouteInput {
  project: string
  link?: string
  chatId?: string
  threadId?: number | null
  label?: string
}

export interface TelegramTopic {
  threadId: number
  name: string
}

export interface TelegramChat {
  chatId: string
  title: string
  isForum: boolean
  botAdmin: boolean
  canManageTopics: boolean
  topics: TelegramTopic[]
}

export type TelegramDiscoverResult = { ok: true; chats: TelegramChat[] } | { ok: false; error: TelegramError }

export interface TelegramCreateTopicInput {
  chatId: string
  project: string
  name: string
}

export type TelegramCreateTopicResult = { ok: true; state: TelegramState; topic: TelegramTopic } | { ok: false; error: TelegramError | 'invalid-project' | 'no-rights' }

export type TelegramSetError = 'invalid-token' | 'invalid-link' | 'invalid-project' | 'too-many' | 'keychain' | 'failed'
export type TelegramSetResult = { ok: true; state: TelegramState } | { ok: false; error: TelegramSetError }
export type TelegramTestResult = { ok: true; bot: string } | { ok: false; error: TelegramError }
export type TelegramCommandResult = { ok: true; state: TelegramState } | { ok: false; error: 'cancelled' | 'failed' }

const SINCE_MAX = 8_640_000_000_000_000
const NAME_MAX = 80
const TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,64}$/
const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_]{3,31}$/

export const isTelegramToken = (v: string): boolean => TOKEN_RE.test(v)

export function parseTopicLink(raw: string): { chatId: string; threadId: number | null } | null {
  const text = raw.trim()
  const pair = /^(-100\d{5,15}|@[A-Za-z][A-Za-z0-9_]{3,31})(?::(\d{1,10}))?$/.exec(text)
  if (pair) return { chatId: pair[1]!, threadId: pair[2] ? Number(pair[2]) : null }
  const m = /^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/([^?#\s]*)(?:\?([^#\s]*))?(?:#\S*)?$/i.exec(text)
  if (!m) return null
  const parts = (m[1] ?? '').split('/').filter(Boolean)
  const thread = /(?:^|&)thread=(\d{1,10})(?:&|$)/.exec(m[2] ?? '')?.[1] ?? null
  const num = (s: string | undefined | null): number | null => (s && /^\d{1,10}$/.test(s) ? Number(s) : null)
  if (parts[0] === 'c') {
    if (!parts[1] || !/^\d{5,15}$/.test(parts[1])) return null
    const chatId = `-100${parts[1]}`
    if (parts.length >= 4) return num(parts[2]) !== null && num(parts[3]) !== null ? { chatId, threadId: num(parts[2]) } : null
    if (parts.length === 3) return num(parts[2]) !== null ? { chatId, threadId: num(thread) } : null
    return parts.length === 2 ? { chatId, threadId: null } : null
  }
  if (!parts[0] || !USERNAME_RE.test(parts[0])) return null
  const chatId = `@${parts[0]}`
  if (parts.length >= 3) return num(parts[1]) !== null && num(parts[2]) !== null ? { chatId, threadId: num(parts[1]) } : null
  if (parts.length === 2) return num(parts[1]) !== null ? { chatId, threadId: num(thread) } : null
  return { chatId, threadId: null }
}

export function parseTelegramEpisode(raw: unknown): TelegramEpisodeMessage | null {
  const r = raw as Partial<TelegramEpisodeMessage> | null
  if (!r || typeof r !== 'object' || r.type !== 'telegram') return null
  if (typeof r.episode !== 'string' || !r.episode || r.episode.length > 300) return null
  if (!(TELEGRAM_REASONS as readonly string[]).includes(r.reason as string)) return null
  if (typeof r.terminalId !== 'string' || !r.terminalId || r.terminalId.length > 200) return null
  if (typeof r.name !== 'string' || !r.name) return null
  if (typeof r.cwd !== 'string' || !r.cwd || r.cwd.length > 4096 || /[\0\r\n]/.test(r.cwd)) return null
  const ms = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < max ? v : undefined)
  const since = ms(r.since, SINCE_MAX)
  const worked = ms(r.worked, SINCE_MAX)
  const tool = typeof r.tool === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(r.tool) ? r.tool : undefined
  const reply = typeof r.reply === 'string' && r.reply.trim() ? r.reply.slice(0, TELEGRAM_REPLY_MAX) : undefined
  const ask = parseTelegramAsk(r.ask)
  return {
    type: 'telegram',
    episode: r.episode,
    reason: r.reason as TelegramReason,
    terminalId: r.terminalId,
    name: r.name.slice(0, NAME_MAX),
    cwd: r.cwd,
    ...(since !== undefined ? { since } : {}),
    ...(worked !== undefined ? { worked } : {}),
    ...(tool ? { tool } : {}),
    ...(reply ? { reply } : {}),
    ...(ask ? { ask } : {}),
  }
}

export function sanitizeTelegramPatch(raw: unknown): TelegramPatch | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const out: TelegramPatch = {}
  for (const k of ['enabled', 'includeReply', 'digest', 'waiting', 'receiving', 'alerts', 'pinStatus', 'topicIcons', 'bigFiles'] as const) {
    if (r[k] === undefined) continue
    if (typeof r[k] !== 'boolean') return null
    out[k] = r[k] as boolean
  }
  if (r.doneMinutes !== undefined) {
    if (!(TELEGRAM_DONE_CHOICES as readonly unknown[]).includes(r.doneMinutes)) return null
    out.doneMinutes = r.doneMinutes as number
  }
  if (r.token !== undefined) {
    if (typeof r.token !== 'string' || r.token.length > 200) return null
    out.token = r.token.trim()
  }
  if (r.apiId !== undefined) {
    if (r.apiId !== null && !(Number.isSafeInteger(r.apiId) && (r.apiId as number) > 0 && (r.apiId as number) < 2 ** 31)) return null
    out.apiId = r.apiId as number | null
  }
  if (r.apiHash !== undefined) {
    if (typeof r.apiHash !== 'string' || !/^([0-9a-f]{32})?$/i.test(r.apiHash.trim())) return null
    out.apiHash = r.apiHash.trim().toLowerCase()
  }
  if (r.stranger !== undefined) {
    const s = r.stranger as Record<string, unknown> | null
    if (!s || typeof s.enabled !== 'boolean' || typeof s.text !== 'string' || s.text.length > TELEGRAM_STRANGER_MAX) return null
    out.stranger = { enabled: s.enabled, text: s.text.replace(/[\x00-\x09\x0b-\x1f\x7f]+/g, ' ').trim() }
  }
  if (r.members !== undefined) {
    const members = parseTelegramMembers(r.members)
    if (!members) return null
    out.members = members
  }
  if (r.quiet !== undefined) {
    const q = r.quiet as Record<string, unknown> | null
    if (!q || typeof q.enabled !== 'boolean' || !isHhmm(q.from) || !isHhmm(q.to)) return null
    out.quiet = { enabled: q.enabled, from: q.from, to: q.to }
  }
  if (r.summary !== undefined) {
    const s = r.summary as Record<string, unknown> | null
    if (!s || typeof s.enabled !== 'boolean' || !isHhmm(s.at)) return null
    out.summary = { enabled: s.enabled, at: s.at }
  }
  return out
}

export function sanitizeRouteInput(raw: unknown): TelegramRouteInput | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.project !== 'string' || !r.project || r.project.length > 4096 || /[\0\r\n]/.test(r.project)) return null
  const label = typeof r.label === 'string' ? r.label.replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, NAME_MAX) : undefined
  const base = { project: r.project, ...(label ? { label } : {}) }
  if (typeof r.link === 'string') return r.link.length > 300 ? null : { ...base, link: r.link }
  if (!isChatId(r.chatId)) return null
  const threadId = r.threadId === null || r.threadId === undefined ? null : isThreadId(r.threadId) ? r.threadId : undefined
  return threadId === undefined ? null : { ...base, chatId: r.chatId, threadId }
}

export const isChatId = (v: unknown): v is string => typeof v === 'string' && /^(-\d{5,20}|@[A-Za-z][A-Za-z0-9_]{3,31})$/.test(v)
export const isThreadId = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 2 ** 31

export function sanitizeCreateTopic(raw: unknown): TelegramCreateTopicInput | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!isChatId(r.chatId) || typeof r.project !== 'string' || !r.project || r.project.length > 4096 || /[\0\r\n]/.test(r.project)) return null
  if (typeof r.name !== 'string') return null
  const name = r.name.replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, 128)
  return name ? { chatId: r.chatId, project: r.project, name } : null
}

export const TELEGRAM_INBOUND_MAX = 2000

export const TELEGRAM_KEYS = ['approve', 'deny', 'stop', 'option'] as const
export type TelegramKey = (typeof TELEGRAM_KEYS)[number]

export type TelegramTarget = { kind: 'terminal'; terminalId: string } | { kind: 'pane'; sessionId: string }

export const TELEGRAM_NESTED_MAX = 20

export type TelegramInbound = (
  | { id: string; action: 'send'; project: string; text: string; target?: TelegramTarget; from: string }
  | { id: string; action: 'status'; project: string }
  | { id: string; action: 'keys'; project: string; key: TelegramKey; option?: number; target?: TelegramTarget; since?: number; tool?: string }
  | { id: string; action: 'new'; project: string; text?: string; from: string }
  | { id: string; action: 'all'; project: string; text: string; from: string }
  | { id: string; action: 'resumeList'; project: string }
  | { id: string; action: 'resume'; project: string; sessionId: string; cwd: string }
  | { id: string; action: 'tail'; project: string; lines: number; target?: TelegramTarget }
) & { nested?: string[] }

export const TELEGRAM_TAIL_DEFAULT = 30
export const TELEGRAM_TAIL_MAX = 80
const TAIL_TEXT_MAX = 20_000

export interface TelegramResumeItem {
  id: string
  name: string
  cwd: string
  endedAt: string
}

export interface TelegramPaneInfo {
  name: string
  status: string
  terminalId?: string
  tool?: string
  since?: number
}

export type TelegramInboundResult =
  | { ok: true; action: 'send'; name: string; queued: boolean; terminalId?: string }
  | { ok: true; action: 'status'; panes: TelegramPaneInfo[] }
  | { ok: true; action: 'keys'; name: string; key: TelegramKey; option?: number }
  | { ok: true; action: 'new'; name: string }
  | { ok: true; action: 'all'; names: string[] }
  | { ok: true; action: 'resumeList'; items: TelegramResumeItem[] }
  | { ok: true; action: 'resume'; name: string }
  | { ok: true; action: 'tail'; name: string; text: string }
  | { ok: false; error: 'none' | 'many' | 'busy' | 'gone' | 'unavailable' | 'state'; panes?: TelegramPaneInfo[] }

const optionOf = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= TELEGRAM_ASK_OPTIONS_MAX ? v : undefined)

const INBOUND_ERRORS =['none', 'many', 'busy', 'gone', 'unavailable', 'state'] as const

function paneInfos(raw: unknown): TelegramPaneInfo[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 20).flatMap((p): TelegramPaneInfo[] => {
    if (!p || typeof p !== 'object') return []
    const o = p as Record<string, unknown>
    if (typeof o.name !== 'string' || !o.name || typeof o.status !== 'string') return []
    const terminalId = typeof o.terminalId === 'string' && o.terminalId.length < 200 ? o.terminalId : undefined
    const tool = typeof o.tool === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(o.tool) ? o.tool : undefined
    const since = typeof o.since === 'number' && Number.isFinite(o.since) && o.since > 0 ? o.since : undefined
    return [{ name: o.name.replace(/[\x00-\x1f\x7f]+/g, ' ').slice(0, NAME_MAX), status: o.status.slice(0, 20), ...(terminalId ? { terminalId } : {}), ...(tool ? { tool } : {}), ...(since ? { since } : {}) }]
  })
}

export function parseInboundResult(raw: unknown): TelegramInboundResult {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'unavailable' }
  const r = raw as Record<string, unknown>
  if (r.ok !== true) {
    const error = (INBOUND_ERRORS as readonly unknown[]).includes(r.error) ? (r.error as (typeof INBOUND_ERRORS)[number]) : 'unavailable'
    const panes = paneInfos(r.panes)
    return { ok: false, error, ...(panes.length ? { panes } : {}) }
  }
  if (r.action === 'status') return { ok: true, action: 'status', panes: paneInfos(r.panes) }
  if (r.action === 'keys') {
    if (typeof r.name !== 'string' || !r.name || !(TELEGRAM_KEYS as readonly unknown[]).includes(r.key)) return { ok: false, error: 'unavailable' }
    const option = optionOf(r.option)
    if (r.key === 'option' && !option) return { ok: false, error: 'unavailable' }
    return { ok: true, action: 'keys', name: r.name.slice(0, NAME_MAX), key: r.key as TelegramKey, ...(option && r.key === 'option' ? { option } : {}) }
  }
  const nm = (v: unknown) => (typeof v === 'string' && v ? v.replace(/[\x00-\x1f\x7f]+/g, ' ').slice(0, NAME_MAX) : null)
  if (r.action === 'tail') {
    const name = nm(r.name)
    if (!name || typeof r.text !== 'string') return { ok: false, error: 'unavailable' }
    return { ok: true, action: 'tail', name, text: r.text.replace(/[\x00-\x09\x0b-\x1f\x7f]+/g, '').slice(-TAIL_TEXT_MAX) }
  }
  if (r.action === 'new' || r.action === 'resume') {
    const name = nm(r.name)
    return name ? { ok: true, action: r.action, name } : { ok: false, error: 'unavailable' }
  }
  if (r.action === 'all') return { ok: true, action: 'all', names: (Array.isArray(r.names) ? r.names : []).slice(0, 20).map(nm).filter((n): n is string => !!n) }
  if (r.action === 'resumeList') {
    const items = (Array.isArray(r.items) ? r.items : []).slice(0, 8).flatMap((i): TelegramResumeItem[] => {
      const o = (i ?? {}) as Record<string, unknown>
      const name = nm(o.name)
      if (!name || typeof o.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(o.id) || typeof o.cwd !== 'string' || !o.cwd || o.cwd.length > 4096 || /[\0\r\n]/.test(o.cwd)) return []
      return [{ id: o.id, name, cwd: o.cwd, endedAt: typeof o.endedAt === 'string' ? o.endedAt.slice(0, 40) : '' }]
    })
    return { ok: true, action: 'resumeList', items }
  }
  if (r.action !== 'send' || typeof r.name !== 'string' || !r.name) return { ok: false, error: 'unavailable' }
  const terminalId = typeof r.terminalId === 'string' && r.terminalId.length < 200 ? r.terminalId : undefined
  return { ok: true, action: 'send', name: r.name.slice(0, NAME_MAX), queued: r.queued === true, ...(terminalId ? { terminalId } : {}) }
}

function targetOf(v: unknown): TelegramTarget | undefined {
  const t = v as Record<string, unknown> | undefined
  if (t && t.kind === 'terminal' && typeof t.terminalId === 'string' && t.terminalId.length < 200) return { kind: 'terminal', terminalId: t.terminalId }
  if (t && t.kind === 'pane' && typeof t.sessionId === 'string' && t.sessionId.length < 200) return { kind: 'pane', sessionId: t.sessionId }
  return undefined
}

const isDir = (v: unknown): v is string => typeof v === 'string' && !!v && v.length <= 4096 && !/[\0\r\n]/.test(v)

export function parseInbound(raw: unknown): TelegramInbound | null {
  const req = parseInboundBody(raw)
  if (!req) return null
  const list = (raw as Record<string, unknown>).nested
  const nested = Array.isArray(list) ? list.slice(0, TELEGRAM_NESTED_MAX).filter(isDir) : []
  return nested.length ? { ...req, nested } : req
}

function parseInboundBody(raw: unknown): TelegramInbound | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || !r.id || r.id.length > 100) return null
  if (!isDir(r.project)) return null
  if (r.action === 'status') return { id: r.id, action: 'status', project: r.project }
  const t0 = targetOf(r.target)
  if (r.action === 'keys') {
    if (!(TELEGRAM_KEYS as readonly unknown[]).includes(r.key)) return null
    const since = typeof r.since === 'number' && Number.isFinite(r.since) && r.since > 0 && r.since < SINCE_MAX ? r.since : undefined
    const tool = typeof r.tool === 'string' && /^[A-Za-z0-9_.:-]{1,80}$/.test(r.tool) ? r.tool : undefined
    const option = optionOf(r.option)
    if (r.key === 'option' && !option) return null
    return { id: r.id, action: 'keys', project: r.project, key: r.key as TelegramKey, ...(option && r.key === 'option' ? { option } : {}), ...(t0 ? { target: t0 } : {}), ...(since !== undefined ? { since } : {}), ...(tool ? { tool } : {}) }
  }
  if (r.action === 'resumeList') return { id: r.id, action: 'resumeList', project: r.project }
  if (r.action === 'tail') {
    const n = typeof r.lines === 'number' && Number.isFinite(r.lines) ? Math.floor(r.lines) : TELEGRAM_TAIL_DEFAULT
    return { id: r.id, action: 'tail', project: r.project, lines: Math.min(TELEGRAM_TAIL_MAX, Math.max(1, n)), ...(t0 ? { target: t0 } : {}) }
  }
  if (r.action === 'resume') {
    if (typeof r.sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(r.sessionId) || typeof r.cwd !== 'string' || !r.cwd || r.cwd.length > 4096 || /[\0\r\n]/.test(r.cwd)) return null
    return { id: r.id, action: 'resume', project: r.project, sessionId: r.sessionId, cwd: r.cwd }
  }
  const from = typeof r.from === 'string' ? r.from.slice(0, NAME_MAX) : null
  if (r.action === 'new') {
    if (!from || (r.text !== undefined && (typeof r.text !== 'string' || r.text.length > TELEGRAM_INBOUND_MAX))) return null
    return { id: r.id, action: 'new', project: r.project, from, ...(typeof r.text === 'string' && r.text.trim() ? { text: r.text } : {}) }
  }
  if (r.action === 'all') {
    if (!from || typeof r.text !== 'string' || !r.text.trim() || r.text.length > TELEGRAM_INBOUND_MAX) return null
    return { id: r.id, action: 'all', project: r.project, text: r.text, from }
  }
  if (r.action !== 'send' || typeof r.text !== 'string' || !r.text.trim() || r.text.length > TELEGRAM_INBOUND_MAX) return null
  if (typeof r.from !== 'string') return null
  const t = r.target as Record<string, unknown> | undefined
  const target: TelegramTarget | undefined =
    t && t.kind === 'terminal' && typeof t.terminalId === 'string' && t.terminalId.length < 200
      ? { kind: 'terminal', terminalId: t.terminalId }
      : t && t.kind === 'pane' && typeof t.sessionId === 'string' && t.sessionId.length < 200
        ? { kind: 'pane', sessionId: t.sessionId }
        : undefined
  return { id: r.id, action: 'send', project: r.project, text: r.text, from: r.from.slice(0, NAME_MAX), ...(target ? { target } : {}) }
}

export function inboundPrompt(text: string): string {
  return text
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[\]P^_][\s\S]*?(\x07|\x1b\\)/g, '')
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '')
    .replace(/[\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, TELEGRAM_INBOUND_MAX)
}

function globRe(glob: string): RegExp {
  const body = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${body}$`, 'i')
}

const SECRET_RES = SECRET_FILE_GLOBS.map(globRe)

export const isSecretFileName = (name: string): boolean => SECRET_RES.some((re) => re.test(name))

/** Same-named panes (several sessions of one folder) get " #1", " #2" in list order so a button or line tells them apart. */
export function uniquePaneNames<T extends { name: string }>(panes: T[]): T[] {
  const total = new Map<string, number>()
  for (const p of panes) total.set(p.name, (total.get(p.name) ?? 0) + 1)
  const seen = new Map<string, number>()
  return panes.map((p) => {
    if ((total.get(p.name) ?? 0) < 2) return p
    const n = (seen.get(p.name) ?? 0) + 1
    seen.set(p.name, n)
    return { ...p, name: `${p.name} #${n}` }
  })
}

export const TELEGRAM_SESSION_ROUTES_MAX = 50
export const TELEGRAM_PANE_LINKS_MAX = 100
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** One agent session (Claude session id, kept across resume) posting to and taking commands from its own topic. */
export interface TelegramSessionRoute {
  session: string
  name: string
  project: string
  chatId: string
  threadId: number | null
  /** Link survives the session ending and follows a new session id in the same pane (/clear, resume). */
  keep?: boolean
  where?: string
  broken?: boolean
}

/** Topic from `link`, or `chatId` / `threadId` from a scanned topic list. `keep` left out keeps the current value. */
export interface TelegramSessionRouteInput {
  session: string
  name: string
  project: string
  link?: string
  chatId?: string
  threadId?: number | null
  keep?: boolean
}

/** Page → main: which Workspace pane / monitor terminal runs which agent session right now. */
export interface TelegramPaneLink {
  agent: string
  pane?: string
  terminal?: string
  /** Shown on the bot's "connect this topic" buttons. */
  name?: string
  cwd?: string
}

export function sanitizeSessionRouteInput(raw: unknown): TelegramSessionRouteInput | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.session !== 'string' || !SESSION_ID.test(r.session)) return null
  if (typeof r.project !== 'string' || !r.project || r.project.length > 4096 || /[\0\r\n]/.test(r.project)) return null
  const name = typeof r.name === 'string' ? r.name.replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, NAME_MAX) : ''
  const base = { session: r.session.toLowerCase(), name: name || 'Claude', project: r.project, ...(typeof r.keep === 'boolean' ? { keep: r.keep } : {}) }
  if (typeof r.link === 'string') return r.link.length > 300 ? null : { ...base, link: r.link }
  if (!isChatId(r.chatId)) return null
  const threadId = r.threadId === null || r.threadId === undefined ? null : isThreadId(r.threadId) ? r.threadId : undefined
  return threadId === undefined ? null : { ...base, chatId: r.chatId, threadId }
}

export const isSessionId = (v: unknown): v is string => typeof v === 'string' && SESSION_ID.test(v)

export function sanitizePaneLinks(raw: unknown): TelegramPaneLink[] | null {
  if (!Array.isArray(raw)) return null
  const id = (v: unknown) => (typeof v === 'string' && v.length > 0 && v.length <= 128 && !/[\0-\x1f]/.test(v) ? v : undefined)
  return raw.slice(0, TELEGRAM_PANE_LINKS_MAX).flatMap((l): TelegramPaneLink[] => {
    if (!l || typeof l !== 'object') return []
    const o = l as Record<string, unknown>
    if (!isSessionId(o.agent)) return []
    const pane = id(o.pane)
    const terminal = id(o.terminal)
    const name = typeof o.name === 'string' ? o.name.replace(/[\x00-\x1f\x7f]+/g, ' ').trim().slice(0, 80) : ''
    const cwd = typeof o.cwd === 'string' && o.cwd && o.cwd.length <= 4096 && !/[\0\r\n]/.test(o.cwd) ? o.cwd : ''
    return [{ agent: o.agent.toLowerCase(), ...(pane ? { pane } : {}), ...(terminal ? { terminal } : {}), ...(name ? { name } : {}), ...(cwd ? { cwd } : {}) }]
  })
}
