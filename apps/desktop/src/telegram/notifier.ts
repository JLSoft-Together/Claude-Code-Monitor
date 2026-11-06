import { promises as fsp, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_TELEGRAM_DONE_MIN,
  TELEGRAM_DONE_CHOICES,
  TELEGRAM_FILE_MAX,
  TELEGRAM_BIG_FILE_MAX,
  TELEGRAM_ROUTES_MAX,
  TELEGRAM_SESSION_ROUTES_MAX,
  TELEGRAM_STRANGER_MAX,
  DEFAULT_TELEGRAM_STRANGER,
  TELEGRAM_MEMBERS_MAX,
  parseTelegramMembers,
  type TelegramMember,
  type TelegramMemberLevel,
  type TelegramStrangerSeen,
  type TelegramStranger,
  isSessionId,
  type TelegramPaneLink,
  type TelegramSessionRoute,
  type TelegramSessionRouteInput,
  isChatId,
  isSecretFileName,
  isTelegramToken,
  isThreadId,
  parseTopicLink,
  type TelegramChat,
  type TelegramCreateTopicInput,
  type TelegramCreateTopicResult,
  type TelegramDiscoverResult,
  type TelegramEpisodeMessage,
  type TelegramError,
  type TelegramPatch,
  type TelegramRoute,
  type TelegramRouteInput,
  type TelegramSetResult,
  type TelegramState,
  type TelegramTestResult,
} from '@ccm/shared'
import { createHash, randomInt, randomUUID } from 'node:crypto'
import { DEFAULT_TELEGRAM_QUIET, DEFAULT_TELEGRAM_SUMMARY, inboundPrompt, maskSecrets, TELEGRAM_TAIL_DEFAULT, TELEGRAM_TAIL_MAX, inTelegramQuiet, isHhmm, type TelegramInbound, type TelegramInboundResult, type TelegramKey, type TelegramOwner, type TelegramHealth, type TelegramPaneInfo, type TelegramQuiet, type TelegramSummary, type TelegramTarget, type TelegramUserInput, type TelegramUserResult } from '@ccm/shared'
import { ACT_TEXT, ACTION_RE, viaTelegram, MORE_TEXT, dayKey, emptyCounts, FILE_KIND, hhmmMinute, markup, minuteOfDay, PLAN_LABELS, PROMPTS, summaryHtml, TAIL_BUTTON, type ActionEntry, type ActionKind, type DayCounts, type LimitText, type Markup, type PinState } from './actions'
import { isInsideOrSame } from '../agentData/fsTree'
import { COMMAND_MENU, commandOf, paneStatus, readMessage, resultHtml, tailHtml, TEXT as INBOUND_TEXT, type TgFile, type TgMessage } from './inbound'
import type { TokenCrypt } from '../github/accounts'
import { RateLimiter } from '../phone/send'
import type { BigUploadCreds, BigUploader } from './mtproto'
import type { UserScanKeys, UserScanner } from './userScan'
import {
  API_BASE,
  CAPTION_MAX,
  MESSAGE_MAX,
  bigFileHtml,
  escapeHtml,
  bigFailedHtml,
  bigUploadingHtml,
  bigDoneHtml,
  clean,
  quote,
  chatsFrom,
  episodeHtml,
  digestHtml,
  reportHtml,
  scanUpdates,
  testHtml,
  tgCall,
  threadFields,
  type Masker,
  type ScanSeen,
  type TelegramLocale,
  type TgCall,
  type TgFetch,
} from './api'

export const TELEGRAM_FILE = 'telegram.json'
export const TELEGRAM_PER_CHAT_MIN = 20
export const TELEGRAM_PER_HOUR = 120
const TIMEOUT_MS = 15_000
const UPLOAD_TIMEOUT_MS = 180_000
/** Restored panes start their agents with --resume and the collector needs a few seconds to see them. */
const STARTUP_SWEEP_MS = 3 * 60_000
/** Telegram rate-limits topic edits per group; one icon change per topic per 20 s is well under it. */
const ICON_EDIT_MS = 20_000
type TopicMood = 'working' | 'waiting' | 'idle'
const MOOD_RANK: Record<TopicMood, number> = { idle: 0, working: 1, waiting: 2 }
/** First one present in getForumTopicIconStickers wins (the bot may only use that set). Compared without U+FE0F. */
const MOOD_EMOJI: Record<TopicMood, string[]> = { working: ['⚡', '🔥', '💻'], waiting: ['❓', '❗', '⁉', '‼'], idle: ['✔', '✅', '💤', '🏁'] }
const MAX_EPISODES = 500
const KNOWN_TOPICS_MAX = 200
export const INBOUND_PER_CHAT_MIN = 10
const strangerHtml = (custom: string, owner: string, fallback: (owner: string) => string): string =>
  custom ? escapeHtml(custom).split('{owner}').join(escapeHtml(owner)) : fallback(owner)
const SESSION_BOUND = new Set(['send', 'file', 'stop', 'last', 'tail', 'compact', 'close', 'focus'])
/** Telegram edits of one message and sends to one group are both throttled; one pin edit per topic per 20 s stays well under. */
const PIN_EDIT_MS = 20_000
const PIN_KEY_RE = /^[-@\w]{1,40}:(\d+|null)$/
const HELD_MAX = 20
const HOLD_MAX_S = 3600
const HOLD_DEFAULT_S = 5
const TOPIC_HEALTH_MAX = 200
/** A working topic would otherwise push a new state to the page on every message; "sent 5 min ago" does not need that. */
const TOPIC_PUSH_MS = 30_000
const TELEGRAM_ERRORS = new Set<string>(['network', 'status', 'timeout', 'rate', 'keychain', 'config', 'token', 'chat', 'too-large', 'conflict'])
const WINDOW_MS = { five_hour: 5 * 3600_000, seven_day: 7 * 24 * 3600_000 }
export const PAIR_MS = 5 * 60_000
const POLL_TIMEOUT_S = 50
const POLL_MIN_GAP_MS = 1000
const CONFLICT_STOP = 3
const BACKLOG_PAGE = 100
const BACKLOG_PAGES = 5
const BACKLOG_MS = 60 * 60_000
const BACKLOG_PER_TOPIC = 8
const BACKLOG_LINE = 80
const BACKLOGS_MAX = 20
const SENT_MAP_MAX = 500
const REPLIES_MAX = 300
const ALBUM_MS = 1500
const ALBUM_MAX = 10
const HEAVY_AT_ONCE = 2
/** Telegram throttles edits of one message; one every 15 s keeps a 500 MB upload at ~20 edits. */
const PROGRESS_EDIT_MS = 15_000

interface KnownChat {
  title: string
  isForum: boolean
  topics: Record<string, string>
  botAdmin?: boolean
  canManageTopics?: boolean
}

interface FileShape {
  enabled: boolean
  token?: string
  bot?: string
  includeReply: boolean
  digest: boolean
  waiting: boolean
  doneMinutes: number
  routes: TelegramRoute[]
  known: Record<string, KnownChat>
  owner?: TelegramOwner
  quiet: TelegramQuiet
  summary: TelegramSummary
  alerts: boolean
  pinStatus: boolean
  topicIcons: boolean
  pins: Record<string, Pin>
  summaryDay?: string
  bigFiles: boolean
  sessionRoutes: TelegramSessionRoute[]
  /** Topics (`chatId:threadId`) whose last send failed with the topic / group gone or no rights. */
  broken?: string[]
  /** Last send per topic (`chatId:threadId`): when it worked, and the error code of the latest failure. */
  topicHealth?: Record<string, { at?: number; error?: TelegramError }>
  stranger: TelegramStranger
  members: TelegramMember[]
  replies: Record<string, string>
  /** Telegram confirms an update only on the next getUpdates, so the last batch before quitting comes back; this keeps it from being offered again. */
  lastUpdate?: number
  /** Hash of the "/" menu last accepted by Telegram for the current token; setMyCommands is skipped while it matches. */
  commandsHash?: string
  apiId?: number
  apiHash?: string
  mtSession?: string
  userSession?: string
  userName?: string
}

interface Pin {
  chatId: string
  messageId: number
}

interface HeldSend {
  route: TelegramRoute
  html: string
  target?: TelegramTarget
  keys?: Markup
  important: boolean
}

export interface TelegramLimitInfo {
  window?: 'five_hour' | 'seven_day'
  usedPct?: number
  /** Epoch ms. */
  resetsAt?: number
  hit?: boolean
}

export interface TelegramDeps {
  file?: string
  crypt: TokenCrypt
  fetch: TgFetch
  locale: () => TelegramLocale
  home: string
  platform: NodeJS.Platform
  now?: () => number
  base?: string | null
  commandInstalled?: () => boolean
  readFile?: (file: string) => Promise<Buffer>
  receiveInstalled?: () => boolean
  askPage?: (req: TelegramInbound) => Promise<TelegramInboundResult>
  sleep?: (ms: number) => Promise<void>
  albumMs?: number
  onInbound?: (entry: { from: string; project: string; result: TelegramInboundResult }) => void
  screenshot?: (serial?: string) => Promise<{ ok: true; png: string; device: string } | { ok: false; error: 'none' | 'failed' }>
  diff?: (cwd: string) => Promise<{ ok: true; text: string; files: number } | { ok: false; error: 'not-repo' | 'clean' | 'failed' }>
  saveFile?: (project: string, name: string, data: Buffer) => Promise<string | null>
  runConfigs?: (project: string) => Promise<{ id: string; name: string }[]>
  runStart?: (project: string, configId: string) => Promise<{ ok: true; sessionId: string } | { ok: false; error: string }>
  runLog?: (sessionId: string) => string[]
  onState?: (state: TelegramState) => void
  onFailure?: (error: TelegramError) => void
  bigUploader?: BigUploader
  userScanner?: UserScanner
  /** Brings the app window to the front; called after `/focus` found its pane. */
  focusApp?: () => void
}

export type SendOutcome = { ok: true; topic: string; file?: string; linkOnly?: boolean; uploading?: boolean } | { ok: false; error: TelegramError | 'telegram-off' | 'telegram-config' | 'no-topic' | 'outside' | 'missing' | 'secret' }

const DEFAULTS: FileShape = { enabled: false, includeReply: false, digest: false, waiting: true, doneMinutes: DEFAULT_TELEGRAM_DONE_MIN, routes: [], known: {}, quiet: { ...DEFAULT_TELEGRAM_QUIET }, summary: { ...DEFAULT_TELEGRAM_SUMMARY }, alerts: true, pinStatus: false, topicIcons: false, pins: {}, bigFiles: false, sessionRoutes: [], stranger: { ...DEFAULT_TELEGRAM_STRANGER }, replies: {}, members: [] }

function readPins(raw: unknown, routes: TelegramRoute[]): Record<string, Pin> {
  const out: Record<string, Pin> = {}
  const msgId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, TELEGRAM_ROUTES_MAX + TELEGRAM_SESSION_ROUTES_MAX)) {
    const o = v as Partial<Pin> | null
    if (o && typeof o === 'object' && isChatId(o.chatId) && msgId(o.messageId)) out[k] = { chatId: o.chatId, messageId: o.messageId }
    else if (msgId(v)) {
      const route = routes.find((r) => r.project === k)
      if (route) out[k] = { chatId: route.chatId, messageId: v }
    }
  }
  return out
}
const DOWNLOAD_MAX = 20 * 1024 * 1024
const IMAGE_NAME = /\.(png|jpe?g|gif|webp)$/i
const isImageFile = (f: TgFile): boolean => f.kind === 'photo' || (f.kind === 'document' && IMAGE_NAME.test(f.name))
const ACTIONS_MAX = 500
const PROJECT_CHOICES_MAX = 8
const CONFIRM_TTL_MS = 5 * 60_000
const WAITING_TAIL_LINES = 20
const RUN_SHOT_DELAY_MS = 8000
const RUN_LOG_LINES = 200
const RUN_DETAIL_MAX = 1500
const PAIR_TRIES = 5
const PAIR_TRIES_TOTAL = 50
const IGNORED_STATE_MS = 1000
const NOT_OWNER_PER_MIN = 5
const STRANGERS_SEEN_MAX = 20

type Role = 'owner' | TelegramMemberLevel
const READ_COMMANDS = new Set(['status', 'last', 'tail', 'help', 'where'])
const READ_BUTTONS = new Set<ActionKind>(['lt', 'tl', 'df'])
/** Allow / Deny run a tool on the owner's machine; links, the backlog and pairing change what the bot is. */
const OWNER_BUTTONS = new Set<ActionKind>(['ap', 'dn', 'lk', 'lp', 'bg', 'bx', 'ul', 'cl'])
const topicKey = (r: { chatId: string; threadId: number | null }): string => `${r.chatId}:${r.threadId}`
const OUTGOING = /^(send(?!ChatAction)|editMessage|(un)?pinChatMessage$|editForumTopic$)/
function field(body: Record<string, unknown> | FormData | null, name: string): unknown {
  return body instanceof FormData ? body.get(name) : (body?.[name] ?? null)
}
function chatOf(body: Record<string, unknown> | FormData | null): string | null {
  const v = field(body, 'chat_id')
  return typeof v === 'string' || typeof v === 'number' ? String(v) : null
}
function topicOf(body: Record<string, unknown> | FormData | null): string | null {
  const chat = chatOf(body)
  if (!chat) return null
  const t = Number(field(body, 'message_thread_id'))
  return `${chat}:${Number.isSafeInteger(t) && t > 0 ? t : null}`
}

const mayPress = (role: Role, kind: ActionKind): boolean => role === 'owner' || (role === 'full' ? !OWNER_BUTTONS.has(kind) : READ_BUTTONS.has(kind))

function readQuiet(raw: unknown): TelegramQuiet {
  const q = raw as Partial<TelegramQuiet> | null
  return q && typeof q === 'object' && isHhmm(q.from) && isHhmm(q.to) ? { enabled: q.enabled === true, from: q.from, to: q.to } : { ...DEFAULT_TELEGRAM_QUIET }
}

function readSummary(raw: unknown): TelegramSummary {
  const s = raw as Partial<TelegramSummary> | null
  return s && typeof s === 'object' && isHhmm(s.at) ? { enabled: s.enabled === true, at: s.at } : { ...DEFAULT_TELEGRAM_SUMMARY }
}

function readRoutes(raw: unknown): TelegramRoute[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, TELEGRAM_ROUTES_MAX).flatMap((r): TelegramRoute[] => {
    if (!r || typeof r !== 'object') return []
    const o = r as Record<string, unknown>
    if (typeof o.project !== 'string' || !o.project || !isChatId(o.chatId)) return []
    const threadId = isThreadId(o.threadId) ? o.threadId : null
    const label = typeof o.label === 'string' && o.label ? o.label.slice(0, 80) : path.basename(o.project)
    return [{ project: o.project, label, chatId: o.chatId, threadId }]
  })
}

function readStranger(raw: unknown): TelegramStranger {
  const s = raw as Partial<TelegramStranger> | null
  return s && typeof s === 'object' && typeof s.enabled === 'boolean' && typeof s.text === 'string' ? { enabled: s.enabled, text: s.text.slice(0, TELEGRAM_STRANGER_MAX) } : { ...DEFAULT_TELEGRAM_STRANGER }
}

function readMembers(raw: unknown): TelegramMember[] {
  if (!Array.isArray(raw)) return []
  const out: TelegramMember[] = []
  for (const m of raw.slice(0, TELEGRAM_MEMBERS_MAX)) {
    const one = parseTelegramMembers([m])?.[0]
    if (one && !out.some((x) => x.id === one.id)) out.push(one)
  }
  return out
}

function readSessionRoutes(raw: unknown): TelegramSessionRoute[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, TELEGRAM_SESSION_ROUTES_MAX).flatMap((r): TelegramSessionRoute[] => {
    const o = (r ?? {}) as Record<string, unknown>
    if (!isSessionId(o.session) || typeof o.project !== 'string' || !o.project || !isChatId(o.chatId)) return []
    const name = typeof o.name === 'string' && o.name ? o.name.slice(0, 80) : 'Claude'
    return [{ session: o.session, name, project: o.project, chatId: o.chatId, threadId: isThreadId(o.threadId) ? o.threadId : null, ...(o.keep === true ? { keep: true } : {}) }]
  })
}

function readReplies(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(-REPLIES_MAX)) if (/^-?\d+:\d+$/.test(k) && isSessionId(v)) out[k] = v.toLowerCase()
  return out
}

function readKnown(raw: unknown): Record<string, KnownChat> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, KnownChat> = {}
  for (const [id, v] of Object.entries(raw as Record<string, unknown>).slice(0, 50)) {
    if (!isChatId(id) || !v || typeof v !== 'object') continue
    const o = v as Record<string, unknown>
    const topics: Record<string, string> = {}
    if (o.topics && typeof o.topics === 'object')
      for (const [t, n] of Object.entries(o.topics as Record<string, unknown>).slice(0, KNOWN_TOPICS_MAX)) if (/^\d{1,10}$/.test(t) && typeof n === 'string') topics[t] = n.slice(0, 128)
    out[id] = { title: typeof o.title === 'string' ? o.title.slice(0, 120) : id, isForum: o.isForum === true, topics, botAdmin: o.botAdmin === true, canManageTopics: o.canManageTopics === true }
  }
  return out
}

function readTopicHealth(raw: unknown): Record<string, { at?: number; error?: TelegramError }> {
  const out: Record<string, { at?: number; error?: TelegramError }> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>).slice(0, TOPIC_HEALTH_MAX)) {
    const o = (v ?? {}) as { at?: unknown; error?: unknown }
    if (!PIN_KEY_RE.test(k)) continue
    const at = typeof o.at === 'number' && Number.isFinite(o.at) && o.at > 0 ? o.at : undefined
    const error = typeof o.error === 'string' && TELEGRAM_ERRORS.has(o.error) ? (o.error as TelegramError) : undefined
    if (at !== undefined || error) out[k] = { ...(at !== undefined ? { at } : {}), ...(error ? { error } : {}) }
  }
  return out
}

function readShape(file: string | undefined): FileShape {
  if (!file) return { ...DEFAULTS, routes: [], known: {}, quiet: { ...DEFAULT_TELEGRAM_QUIET }, summary: { ...DEFAULT_TELEGRAM_SUMMARY }, pins: {}, sessionRoutes: [], replies: {}, members: [] }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<FileShape>
    const routes = readRoutes(raw.routes)
    return {
      enabled: raw.enabled === true,
      token: typeof raw.token === 'string' && raw.token.length < 4096 ? raw.token : undefined,
      bot: typeof raw.bot === 'string' ? raw.bot.slice(0, 64) : undefined,
      includeReply: raw.includeReply === true,
      digest: raw.digest === true,
      waiting: raw.waiting !== false,
      doneMinutes: (TELEGRAM_DONE_CHOICES as readonly unknown[]).includes(raw.doneMinutes) ? (raw.doneMinutes as number) : DEFAULT_TELEGRAM_DONE_MIN,
      routes,
      known: readKnown(raw.known),
      quiet: readQuiet(raw.quiet),
      summary: readSummary(raw.summary),
      alerts: raw.alerts !== false,
      pinStatus: raw.pinStatus === true,
      topicIcons: raw.topicIcons === true,
      pins: readPins(raw.pins, routes),
      bigFiles: raw.bigFiles === true,
      sessionRoutes: readSessionRoutes(raw.sessionRoutes),
      topicHealth: readTopicHealth(raw.topicHealth),
      ...(Array.isArray(raw.broken) ? { broken: raw.broken.filter((k): k is string => typeof k === 'string' && /^[-@\w]{1,40}:(\d+|null)$/.test(k)).slice(0, TELEGRAM_ROUTES_MAX * 2) } : {}),
      stranger: readStranger(raw.stranger),
      members: readMembers(raw.members),
      replies: readReplies(raw.replies),
      ...(Number.isSafeInteger(raw.lastUpdate) && (raw.lastUpdate as number) >= 0 ? { lastUpdate: raw.lastUpdate } : {}),
      ...(typeof raw.commandsHash === 'string' && /^[0-9a-f]{16}$/.test(raw.commandsHash) ? { commandsHash: raw.commandsHash } : {}),
      ...(Number.isSafeInteger(raw.apiId) && (raw.apiId as number) > 0 ? { apiId: raw.apiId } : {}),
      ...(typeof raw.apiHash === 'string' && raw.apiHash.length < 4096 ? { apiHash: raw.apiHash } : {}),
      ...(typeof raw.mtSession === 'string' && raw.mtSession.length < 8192 ? { mtSession: raw.mtSession } : {}),
      ...(typeof raw.userSession === 'string' && raw.userSession.length < 8192 ? { userSession: raw.userSession } : {}),
      ...(typeof raw.userName === 'string' ? { userName: raw.userName.slice(0, 64) } : {}),
      ...(typeof raw.summaryDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.summaryDay) ? { summaryDay: raw.summaryDay } : {}),
      ...(raw.owner && typeof raw.owner.id === 'number' && Number.isSafeInteger(raw.owner.id) && typeof raw.owner.name === 'string' ? { owner: { id: raw.owner.id, name: raw.owner.name.slice(0, 80) } } : {}),
    }
  } catch {
    return { ...DEFAULTS, routes: [], known: {}, quiet: { ...DEFAULT_TELEGRAM_QUIET }, summary: { ...DEFAULT_TELEGRAM_SUMMARY }, pins: {}, sessionRoutes: [], replies: {}, members: [] }
  }
}

export class TelegramNotifier {
  private data: FileShape
  private readonly total: RateLimiter
  private readonly perChat = new Map<string, RateLimiter>()
  private readonly sent = new Set<string>()
  private readonly reportedAt = new Map<string, number>()
  private lastError: TelegramError | null = null
  private botId: number | null = null
  private receiving = false
  private pollRun = 0
  private pollConflict = false
  private commandsBusy = false
  private conflictRuns = 0
  private readonly backlogs = new Map<string, unknown[]>()
  private pollSeen: ScanSeen | null = null
  private pairCode: string | null = null
  private pairUntil: number | null = null
  private ignored = 0
  private readonly inboundLimit = new Map<string, RateLimiter>()
  private readonly sentTo = new Map<string, TelegramTarget>()
  private readonly actions = new Map<string, ActionEntry>()
  private counts = new Map<string, DayCounts>()
  private countsDay = ''
  private readonly startedAt: number
  private readonly pairTries = new Map<number, number>()
  private pairTriesTotal = 0
  private ignoredAt = -Infinity
  private readonly notOwnerLimit: RateLimiter
  private readonly strangerLimit: RateLimiter
  private readonly readOnlyLimit: RateLimiter
  private readonly strangers = new Map<number, TelegramStrangerSeen>()
  private readonly runFailed = new Set<string>()
  private readonly lastReplies = new Map<string, { name: string; reply: string }>()
  private readonly runWatch = new Map<string, { project: string; chatId: string; threadId: number | null; config: string; shot: boolean }>()
  private readonly pinText = new Map<string, string>()
  private readonly digestMsgs = new Map<string, { chatId: string; messageId: number; day: string; n: number }>()
  private pinBusy = false
  private readonly pinAt = new Map<string, number>()
  private readonly holdUntil = new Map<string, number>()
  private readonly held = new Map<string, HeldSend[]>()
  private readonly heldTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private flushing = false
  private topicSavedAt = 0
  private readonly limitSent = new Set<string>()
  private iconBusy = false
  private iconIds: Partial<Record<TopicMood, string>> | null = null
  private readonly iconSet = new Map<string, { chatId: string; threadId: number; id: string }>()
  private readonly iconAt = new Map<string, number>()
  private readonly iconOff = new Set<string>()
  private health: TelegramHealth = { lastSentAt: null, lastReceivedAt: null, lastPollAt: null, sentToday: 0, errorsToday: 0 }
  private healthDay = ''
  private readonly agentOfPane = new Map<string, string>()
  private readonly agentOfTerminal = new Map<string, string>()
  private readonly terminalOfAgent = new Map<string, string>()
  private openSessions: { agent: string; name: string; cwd: string }[] = []
  private endedTopics = new Map<string, string>()
  private panesSeen = false
  private swept = false
  private readonly albums = new Map<string, { items: TgMessage[]; timer?: ReturnType<typeof setTimeout> }>()
  private lightChain: Promise<void> = Promise.resolve()
  private heavyRunning = 0
  private readonly heavyWaiting: (() => void)[] = []

  constructor(private readonly deps: TelegramDeps) {
    this.data = readShape(deps.file)
    this.total = new RateLimiter(TELEGRAM_PER_HOUR, 60 * 60_000, deps.now ?? Date.now)
    this.notOwnerLimit = new RateLimiter(NOT_OWNER_PER_MIN, 60_000, deps.now ?? Date.now)
    this.strangerLimit = new RateLimiter(NOT_OWNER_PER_MIN, 60_000, deps.now ?? Date.now)
    this.readOnlyLimit = new RateLimiter(NOT_OWNER_PER_MIN, 60_000, deps.now ?? Date.now)
    this.startedAt = this.now
  }

  private get now(): number {
    return (this.deps.now ?? Date.now)()
  }

  private get masker(): Masker {
    return { home: this.deps.home, platform: this.deps.platform }
  }

  private sealed(value: string | undefined): string | null {
    if (!value) return null
    try {
      return this.deps.crypt.decrypt(Buffer.from(value, 'base64'))
    } catch {
      return null
    }
  }

  private token(): string | null {
    if (!this.data.token) return null
    try {
      return this.deps.crypt.decrypt(Buffer.from(this.data.token, 'base64'))
    } catch {
      return null
    }
  }

  private async call(method: string, body: Record<string, unknown> | FormData | null, timeoutMs = TIMEOUT_MS): Promise<TgCall> {
    const token = this.token()
    if (!token) return { ok: false, error: 'config' }
    const chat = OUTGOING.test(method) ? chatOf(body) : null
    if (chat && this.holdLeft(chat) > 0) return { ok: false, error: 'rate' }
    const res = await tgCall(this.deps.fetch, this.deps.base || API_BASE, token, method, body, timeoutMs)
    this.noteHealth(method, res)
    if (chat) {
      if (!res.ok && res.error === 'rate') this.hold(chat, res.retryAfter)
      if (method.startsWith('send')) this.noteTopic(topicOf(body), res)
    }
    return res
  }

  private holdLeft(chatId: string): number {
    const until = this.holdUntil.get(chatId)
    if (until === undefined) return 0
    const left = until - this.now
    if (left <= 0) this.holdUntil.delete(chatId)
    return Math.max(0, left)
  }

  /** Telegram answered 429: nothing goes to that chat for the `retry_after` it named. */
  private hold(chatId: string, retryAfter: number | undefined): void {
    const secs = Math.min(HOLD_MAX_S, Math.max(1, retryAfter ?? HOLD_DEFAULT_S))
    const until = this.now + secs * 1000
    if (until > (this.holdUntil.get(chatId) ?? 0)) this.holdUntil.set(chatId, until)
  }

  private routed(key: string): boolean {
    return this.data.routes.some((r) => topicKey(r) === key) || this.data.sessionRoutes.some((r) => topicKey(r) === key)
  }

  /** Only the error code is kept, never the message text or Telegram's description. */
  private noteTopic(key: string | null, res: TgCall): void {
    if (!key || !this.routed(key)) return
    const all = (this.data.topicHealth ??= {})
    const prev = all[key]
    const next = res.ok ? { at: this.now } : { ...(prev?.at !== undefined ? { at: prev.at } : {}), error: res.error }
    const errorChanged = prev?.error !== (res.ok ? undefined : res.error)
    all[key] = next
    const keys = Object.keys(all)
    if (keys.length > TOPIC_HEALTH_MAX) for (const k of keys) if (!this.routed(k)) delete all[k]
    if (!errorChanged && this.now - this.topicSavedAt <= TOPIC_PUSH_MS) return
    this.topicSavedAt = this.now
    this.save()
    this.deps.onState?.(this.state())
  }

  private healthOf(r: { chatId: string; threadId: number | null }): { lastSentAt?: number; lastError?: TelegramError } {
    const h = this.data.topicHealth?.[topicKey(r)]
    return h ? { ...(h.at !== undefined ? { lastSentAt: h.at } : {}), ...(h.error ? { lastError: h.error } : {}) } : {}
  }

  private noteHealth(method: string, res: TgCall): void {
    const day = dayKey(new Date(this.now))
    if (day !== this.healthDay) {
      this.healthDay = day
      this.health = { ...this.health, sentToday: 0, errorsToday: 0 }
    }
    if (method === 'getUpdates') {
      if (res.ok) this.health.lastPollAt = this.now
      else if (res.error !== 'timeout') this.health.errorsToday++
      return
    }
    if (!method.startsWith('send') && method !== 'editMessageText') return
    if (res.ok) {
      this.health.lastSentAt = this.now
      this.health.sentToday++
    } else this.health.errorsToday++
  }

  state(): TelegramState {
    const pairing = this.pairCode !== null && (this.pairUntil ?? 0) > this.now
    return {
      receiving: this.receiving,
      owner: this.data.owner ? { ...this.data.owner } : null,
      pairCode: pairing ? this.pairCode : null,
      pairUntil: pairing ? this.pairUntil : null,
      ignored: this.ignored,
      receiveInstalled: this.deps.receiveInstalled?.() ?? false,
      enabled: this.data.enabled,
      configured: this.token() !== null,
      keychain: this.deps.crypt.available(),
      bot: this.data.bot ?? null,
      includeReply: this.data.includeReply,
      digest: this.data.digest,
      waiting: this.data.waiting,
      doneMinutes: this.data.doneMinutes,
      routes: this.data.routes.map((r) => ({ ...r, where: this.topicName(r), ...(this.isBroken(r) ? { broken: true } : {}), ...this.healthOf(r) })),
      commandInstalled: this.deps.commandInstalled?.() ?? false,
      lastError: this.lastError,
      pollConflict: this.pollConflict,
      quiet: { ...this.data.quiet },
      summary: { ...this.data.summary },
      alerts: this.data.alerts,
      pinStatus: this.data.pinStatus,
      topicIcons: this.data.topicIcons,
      health: { ...this.health },
      userAccount: this.data.userSession ? (this.data.userName ?? 'Telegram') : null,
      bigFiles: { enabled: this.data.bigFiles, apiId: this.data.apiId ?? null, hasHash: this.sealed(this.data.apiHash) !== null },
      sessionRoutes: this.data.sessionRoutes.map((r) => ({ ...r, where: this.topicName(r), ...(this.isBroken(r) ? { broken: true } : {}), ...this.healthOf(r) })),
      stranger: { ...this.data.stranger },
      members: this.members().map((m) => ({ ...m })),
      recentStrangers: [...this.strangers.values()]
        .filter((s) => s.id !== this.data.owner?.id && !this.data.members.some((m) => m.id === s.id))
        .reverse()
        .map((s) => ({ ...s })),
    }
  }

  private isBroken(r: { chatId: string; threadId: number | null }): boolean {
    return !!this.data.broken?.includes(topicKey(r))
  }

  /** Remembers whether the topic still takes messages; the Settings rows turn to a warning while it does not. */
  private markTopic(r: { chatId: string; threadId: number | null }, broken: boolean): void {
    if (this.isBroken(r) === broken) return
    const key = topicKey(r)
    const rest = (this.data.broken ?? []).filter((k) => k !== key)
    this.data.broken = broken ? [...rest, key] : rest
    this.save()
    this.deps.onState?.(this.state())
  }

  private members(): TelegramMember[] {
    return this.data.members.filter((m) => m.id !== this.data.owner?.id)
  }

  /** Read on every message and button press, so removing a member takes effect on their next tap. No owner = nobody, members included. */
  private roleOf(id: unknown): Role | null {
    const owner = this.data.owner
    if (!owner || typeof id !== 'number') return null
    if (id === owner.id) return 'owner'
    return this.data.members.find((m) => m.id === id)?.level ?? null
  }

  private nameOf(id: number): string {
    return id === this.data.owner?.id ? this.data.owner.name : (this.data.members.find((m) => m.id === id)?.name ?? '')
  }

  private seeStranger(msg: TgMessage): void {
    this.strangers.delete(msg.fromId)
    const name = msg.fromName.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]+/g, ' ').trim().slice(0, 80) || String(msg.fromId)
    const chat = this.data.known[msg.chatId]?.title ?? (msg.chatType === 'private' ? '' : msg.chatId)
    this.strangers.set(msg.fromId, { id: msg.fromId, name, at: this.now, chat })
    if (this.strangers.size > STRANGERS_SEEN_MAX) this.strangers.delete(this.strangers.keys().next().value as number)
  }

  get enabled(): boolean {
    return this.data.enabled
  }

  private commit(clearError = false): TelegramSetResult {
    if (clearError) this.lastError = null
    if (!this.save()) return { ok: false, error: 'failed' }
    const state = this.state()
    this.deps.onState?.(state)
    return { ok: true, state }
  }

  set(patch: TelegramPatch): TelegramSetResult {
    if (patch.apiHash && !this.deps.crypt.available()) return { ok: false, error: 'keychain' }
    if (patch.token !== undefined) {
      if (patch.token && !this.deps.crypt.available()) return { ok: false, error: 'keychain' }
      if (patch.token && !isTelegramToken(patch.token)) return { ok: false, error: 'invalid-token' }
      this.data.token = patch.token ? this.deps.crypt.encrypt(patch.token).toString('base64') : undefined
      this.data.mtSession = undefined
      this.data.lastUpdate = undefined
      this.data.bot = undefined
      this.data.commandsHash = undefined
      this.botId = null
      this.pollRun = 0
      if (!patch.token) {
        this.data.enabled = false
        this.receiving = false
      }
    }
    if (patch.receiving !== undefined) this.receiving = patch.receiving && this.token() !== null && this.data.owner !== undefined
    if (patch.includeReply !== undefined) this.data.includeReply = patch.includeReply
    if (patch.digest !== undefined) this.data.digest = patch.digest
    if (patch.waiting !== undefined) this.data.waiting = patch.waiting
    if (patch.doneMinutes !== undefined) this.data.doneMinutes = patch.doneMinutes
    if (patch.enabled !== undefined) this.data.enabled = patch.enabled
    if (patch.quiet) this.data.quiet = { ...patch.quiet }
    if (patch.summary) this.data.summary = { ...patch.summary }
    if (patch.alerts !== undefined) this.data.alerts = patch.alerts
    if (patch.pinStatus !== undefined) this.data.pinStatus = patch.pinStatus
    if (patch.topicIcons !== undefined) {
      if (!patch.topicIcons && this.data.topicIcons) void this.clearIcons([...this.iconSet.keys()])
      this.data.topicIcons = patch.topicIcons
    }
    if (patch.apiHash !== undefined) {
      this.data.apiHash = patch.apiHash ? this.deps.crypt.encrypt(patch.apiHash).toString('base64') : undefined
      this.data.mtSession = undefined
    }
    if (patch.apiId !== undefined) {
      if ((patch.apiId ?? undefined) !== this.data.apiId) {
        this.data.mtSession = undefined
        this.dropUser()
      }
      this.data.apiId = patch.apiId ?? undefined
    }
    if (patch.bigFiles !== undefined) this.data.bigFiles = patch.bigFiles
    if (patch.stranger) this.data.stranger = { ...patch.stranger }
    if (patch.members) this.data.members = patch.members.filter((m) => m.id !== this.data.owner?.id).slice(0, TELEGRAM_MEMBERS_MAX).map((m) => ({ ...m }))
    const result = this.commit(patch.token !== undefined)
    if (patch.token) void this.whoAmI()
    this.syncPoll(patch.receiving === true || !!patch.token)
    if (this.receiving && (patch.receiving === true || patch.token)) void this.syncCommands()
    return result
  }

  private async syncCommands(): Promise<void> {
    if (this.commandsBusy) return
    const sets = [{ lang: '', list: COMMAND_MENU.en }, ...(this.deps.locale() === 'vi' ? [{ lang: 'vi', list: COMMAND_MENU.vi }] : [])]
    const hash = createHash('sha256').update(JSON.stringify(sets)).digest('hex').slice(0, 16)
    if (this.data.commandsHash === hash) return
    const sealed = this.data.token
    this.commandsBusy = true
    try {
      for (const s of sets) {
        const res = await this.call('setMyCommands', { commands: s.list.map(([command, description]) => ({ command, description })), scope: { type: 'all_group_chats' }, ...(s.lang ? { language_code: s.lang } : {}) })
        if (!res.ok) return
      }
      if (this.data.token !== sealed) return
      this.data.commandsHash = hash
      this.save()
    } catch {
      // the menu is a convenience; typed commands keep working
    } finally {
      this.commandsBusy = false
    }
  }

  get isReceiving(): boolean {
    return this.receiving
  }

  pair(on: boolean): TelegramSetResult {
    if (on && !this.token()) return { ok: false, error: 'failed' }
    this.pairCode = on ? String(randomInt(0, 1_000_000)).padStart(6, '0') : null
    this.pairUntil = on ? this.now + PAIR_MS : null
    this.pairTries.clear()
    this.pairTriesTotal = 0
    const res = this.commit()
    this.syncPoll()
    return res
  }

  unpair(): TelegramSetResult {
    this.data.owner = undefined
    this.receiving = false
    const res = this.commit()
    this.syncPoll()
    return res
  }

  private get pairing(): boolean {
    return this.pairCode !== null && (this.pairUntil ?? 0) > this.now
  }

  /** `retry`: only an explicit receive-on (or a new token) restarts a poll that stopped on conflict; other setting changes must not. */
  private syncPoll(retry = false): void {
    const want = !!this.token() && (this.receiving || this.pairing)
    if (want && !this.pollRun && (!this.pollConflict || retry)) {
      const run = Date.now() + Math.random()
      this.pollRun = run
      this.conflictRuns = 0
      void this.pollLoop(run)
    } else if (!want) {
      this.pollRun = 0
      if (this.pollConflict) {
        this.pollConflict = false
        this.deps.onState?.(this.state())
      }
    }
  }

  private pollFailed(error: TelegramError, run: number): boolean {
    if (error !== 'conflict') return false
    const first = !this.pollConflict
    this.pollConflict = true
    this.fail('conflict')
    const stop = ++this.conflictRuns >= CONFLICT_STOP
    if (stop && this.pollRun === run) this.pollRun = 0
    if (first || stop) this.deps.onState?.(this.state())
    return stop
  }

  private pollOk(): void {
    this.conflictRuns = 0
    if (!this.pollConflict) return
    this.pollConflict = false
    if (this.lastError === 'conflict') this.lastError = null
    this.deps.onState?.(this.state())
  }

  stop(): void {
    this.pollRun = 0
    for (const t of this.heldTimers.values()) clearTimeout(t)
    this.heldTimers.clear()
  }

  private async pollLoop(run: number): Promise<void> {
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
    let offset: number | null = null
    let backoff = 2000
    this.pollSeen = { chats: new Map(), topics: new Map() }
    while (this.pollRun === run) {
      if (!this.receiving && !this.pairing) {
        this.pollRun = 0
        this.deps.onState?.(this.state())
        break
      }
      if (this.botId === null) {
        const me = await this.whoAmI()
        if (!me.ok) {
          await sleep(backoff)
          backoff = Math.min(backoff * 2, 60_000)
          continue
        }
      }
      if (offset === null) {
        const first = await this.call('getUpdates', { offset: 0, limit: BACKLOG_PAGE, timeout: 0, allowed_updates: ['message', 'my_chat_member', 'callback_query'] })
        if (!first.ok) {
          if (this.pollFailed(first.error, run)) break
          await sleep(backoff)
          backoff = Math.min(backoff * 2, 60_000)
          continue
        }
        this.pollOk()
        const waiting: unknown[] = []
        let next = 0
        let list = Array.isArray(first.result) ? first.result : []
        for (let page = 0; ; page++) {
          for (const u of list) {
            waiting.push(u)
            const id = (u as { update_id?: unknown })?.update_id
            if (typeof id === 'number' && id >= next) next = id + 1
          }
          if (list.length < BACKLOG_PAGE || page >= BACKLOG_PAGES - 1) break
          const more = await this.call('getUpdates', { offset: next, limit: BACKLOG_PAGE, timeout: 0, allowed_updates: ['message', 'my_chat_member', 'callback_query'] })
          if (!more.ok) break
          list = Array.isArray(more.result) ? more.result : []
        }
        offset = next
        if (this.pollRun === run) await this.offerBacklog(waiting)
        await sleep(POLL_MIN_GAP_MS)
        continue
      }
      const startedAt = Date.now()
      const res = await this.call('getUpdates', { offset, timeout: POLL_TIMEOUT_S, allowed_updates: ['message', 'my_chat_member', 'callback_query'] }, (POLL_TIMEOUT_S + 15) * 1000)
      if (this.pollRun !== run) break
      const quick = Date.now() - startedAt
      if (quick < POLL_MIN_GAP_MS) await sleep(POLL_MIN_GAP_MS - quick)
      if (this.pollRun !== run) break
      if (!res.ok) {
        if (this.pollFailed(res.error, run)) break
        await sleep(backoff)
        backoff = Math.min(backoff * 2, 60_000)
        continue
      }
      this.pollOk()
      backoff = 2000
      const updates = Array.isArray(res.result) ? res.result : []
      scanUpdates(updates, this.pollSeen)
      this.learn(this.pollSeen)
      for (const u of updates) {
        if (this.pollRun !== run) break
        const id = (u as { update_id?: unknown })?.update_id
        if (typeof id === 'number' && id >= offset) offset = id + 1
        this.dispatch(u)
      }
      if (updates.length && offset - 1 !== this.data.lastUpdate) {
        this.data.lastUpdate = offset - 1
        this.save()
      }
    }
  }

  /** Owner commands sent while the app was off are not run on their own: a prompt typed an hour ago may no longer fit what the session is doing. */
  private async offerBacklog(updates: unknown[]): Promise<void> {
    const bot = this.data.bot
    const owner = this.data.owner
    if (!bot || !owner || !this.receiving) return
    const groups = new Map<string, { chatId: string; threadId: number | null; items: { update: unknown; line: string }[] }>()
    for (const update of updates) {
      const uid = (update as { update_id?: unknown } | null)?.update_id
      if (typeof uid === 'number' && this.data.lastUpdate !== undefined && uid <= this.data.lastUpdate) continue
      const msg = readMessage(update, this.botId)
      if (!msg || msg.fromBot || msg.fromId !== owner.id || msg.chatType === 'private' || msg.date === undefined || this.now - msg.date > BACKLOG_MS) continue
      const cmd = commandOf(msg, bot)
      if (!cmd || cmd.kind === 'pair' || cmd.kind === 'help') continue
      const known = this.data.sessionRoutes.some((r) => r.chatId === msg.chatId && r.threadId === msg.threadId) || this.data.routes.some((r) => r.chatId === msg.chatId && r.threadId === msg.threadId)
      if (!known) continue
      const key = `${msg.chatId}:${msg.threadId ?? ''}`
      const group = groups.get(key) ?? { chatId: msg.chatId, threadId: msg.threadId, items: [] }
      if (group.items.length < BACKLOG_PER_TOPIC) group.items.push({ update, line: this.backlogLine(msg, bot) })
      groups.set(key, group)
    }
    const locale = this.deps.locale()
    for (const group of groups.values()) {
      const key = this.addAction({ kind: 'bg', terminalId: '', project: '', cwd: '', name: '', chatId: group.chatId, threadId: group.threadId })
      this.backlogs.set(key, group.items.map((i) => i.update))
      if (this.backlogs.size > BACKLOGS_MAX) this.backlogs.delete(this.backlogs.keys().next().value as string)
      const html = [MORE_TEXT[locale].backlogHead(group.items.length), ...group.items.map((i, n) => `${n + 1}. ${i.line}`)].join('\n')
      await this.post(group, html, { reply_markup: markup(locale, [[['bg', key], ['bx', key]]]) })
    }
  }

  private backlogLine(msg: TgMessage, bot: string): string {
    const raw = msg.text.replace(new RegExp(`@${bot}`, 'gi'), ' ').replace(/\s+/g, ' ').trim() || msg.file?.name || ''
    const text = maskSecrets(raw, this.deps.home, this.deps.platform)
    return escapeHtml(text.length > BACKLOG_LINE ? `${text.slice(0, BACKLOG_LINE - 1)}…` : text)
  }

  private async onBacklog(id: string, kind: 'bg' | 'bx', key: string, entry: ActionEntry, cb: Record<string, unknown>): Promise<void> {
    const items = this.backlogs.get(key)
    if (!items) return this.answer(id, ACT_TEXT[this.deps.locale()].expired)
    this.backlogs.delete(key)
    this.actions.delete(key)
    await this.answer(id)
    const msgId = (cb.message as { message_id?: unknown } | undefined)?.message_id
    if (typeof msgId === 'number') await this.call('editMessageReplyMarkup', { chat_id: entry.chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } })
    if (kind === 'bx') return void (await this.post(entry, MORE_TEXT[this.deps.locale()].backlogSkipped(items.length)))
    for (const update of items) await this.onUpdate(update).catch(() => undefined)
  }

  /** Buttons and file / screen work run beside the poll so a 20 MB download never holds back ⏹; plain messages stay in order. */
  private dispatch(update: unknown): void {
    const u = update as { callback_query?: unknown; message?: Record<string, unknown> } | null
    const m = u?.message
    const heavy = !!m && (Array.isArray(m.photo) || ['document', 'video', 'audio', 'voice'].some((k) => !!m[k]) || (typeof m.text === 'string' && /\bscreen(shot)?\b/i.test(m.text)))
    if (u?.callback_query || heavy) return void this.onUpdate(update).catch(() => undefined)
    this.lightChain = this.lightChain.then(() => this.onUpdate(update)).catch(() => undefined)
  }

  private async heavySlot<T>(work: () => Promise<T>): Promise<T> {
    if (this.heavyRunning >= HEAVY_AT_ONCE) await new Promise<void>((r) => this.heavyWaiting.push(r))
    this.heavyRunning++
    try {
      return await work()
    } finally {
      this.heavyRunning--
      this.heavyWaiting.shift()?.()
    }
  }

  async onUpdate(update: unknown): Promise<void> {
    if (this.botId === null || !this.data.bot) await this.whoAmI()
    const cb = (update as { callback_query?: unknown } | null)?.callback_query
    if (cb && typeof cb === 'object') return this.onCallback(cb as Record<string, unknown>)
    const msg = readMessage(update, this.botId)
    if (!msg || msg.fromBot || !this.data.bot) return
    if (msg.group) return this.collectAlbum(msg)
    return this.onMessage(msg)
  }

  private collectAlbum(msg: TgMessage): void {
    const key = `${msg.chatId}:${msg.group}`
    const album = this.albums.get(key) ?? { items: [] }
    if (album.items.length < ALBUM_MAX) album.items.push(msg)
    if (album.timer) clearTimeout(album.timer)
    album.timer = setTimeout(() => {
      this.albums.delete(key)
      const bot = this.data.bot
      const head = bot ? album.items.find((m) => commandOf(m, bot)?.kind === 'file') : undefined
      if (!head) return
      const more = album.items.filter((m) => m !== head && m.fromId === head.fromId && m.file).map((m) => m.file!)
      void this.onMessage(head, more).catch(() => undefined)
    }, this.deps.albumMs ?? ALBUM_MS)
    this.albums.set(key, album)
  }

  private async onMessage(msg: TgMessage, more: TgFile[] = []): Promise<void> {
    if (!this.data.bot) return
    const cmd = commandOf(msg, this.data.bot)
    if (!cmd) return
    const locale = this.deps.locale()
    const t = INBOUND_TEXT[locale]
    if (cmd.kind === 'pair') {
      if (!this.pairing) return
      const tries = this.pairTries.get(msg.fromId) ?? 0
      if (tries >= PAIR_TRIES) return
      if (cmd.code !== this.pairCode) {
        this.pairTries.set(msg.fromId, tries + 1)
        if (++this.pairTriesTotal < PAIR_TRIES_TOTAL) return
        this.pairCode = null
        this.pairUntil = null
        this.commit()
        return
      }
      this.data.owner = { id: msg.fromId, name: msg.fromName }
      this.data.members = this.data.members.filter((m) => m.id !== msg.fromId)
      this.strangers.delete(msg.fromId)
      this.pairCode = null
      this.pairUntil = null
      this.commit()
      await this.reply(msg, t.paired(msg.fromName))
      return
    }
    const role = this.roleOf(msg.fromId)
    if (!role) {
      this.seeStranger(msg)
      this.noteIgnored()
      // Owner decision 2026-11-05: answer strangers once in a while instead of staying silent (still never forwarded).
      if (this.data.owner && this.data.stranger.enabled && this.strangerLimit.take()) await this.reply(msg, strangerHtml(this.data.stranger.text, this.data.owner.name, t.stranger))
      return
    }
    this.health.lastReceivedAt = this.now
    if (!this.receiving || msg.chatType === 'private') {
      if (cmd.kind === 'help') await this.reply(msg, t.help(this.data.bot))
      return
    }
    if (cmd.kind === 'help') return void (await this.reply(msg, t.help(this.data.bot)))
    if (role === 'read' && !READ_COMMANDS.has(cmd.kind)) {
      if (this.readOnlyLimit.take()) await this.reply(msg, t.readOnly)
      return
    }
    if (cmd.kind === 'close' && role !== 'owner') {
      if (this.readOnlyLimit.take()) await this.reply(msg, ACT_TEXT[locale].notAllowed)
      return
    }
    const from = role === 'owner' ? msg.fromName : this.nameOf(msg.fromId)
    // Several sessions can share a topic (an old one left linked): an open one wins, else the latest linked.
    const onTopic = this.data.sessionRoutes.filter((r) => r.chatId === msg.chatId && r.threadId === msg.threadId)
    const session = [...onTopic].reverse().find((r) => this.terminalOfAgent.has(r.session)) ?? onTopic.at(-1)
    const ended = cmd.kind === 'resume' ? this.endedTopics.get(`${msg.chatId}:${msg.threadId}`) : undefined
    const route = session
      ? { project: session.project, label: session.name, chatId: session.chatId, threadId: session.threadId }
      : (this.data.routes.find((r) => r.chatId === msg.chatId && r.threadId === msg.threadId) ?? (ended ? { project: ended, label: path.basename(ended) || ended, chatId: msg.chatId, threadId: msg.threadId } : undefined))
    if (cmd.kind === 'where') return this.whereReply(msg, role === 'owner', session, route)
    const newText = cmd.kind === 'new' ? cmd.text : ''
    const choices = cmd.kind === 'new' && !session ? this.projectChoices(msg) : []
    if (choices.length) {
      if (!this.takeInbound(msg.chatId)) return void (await this.reply(msg, t.rate))
      const text = newText ? viaTelegram(inboundPrompt(newText), locale) : ''
      const group = randomUUID().slice(0, 8)
      const rows = choices.map((r): [ActionKind, string, string][] => [
        ['pj', this.addAction({ kind: 'pj', terminalId: '', project: r.project, cwd: r.project, name: r.label, chatId: msg.chatId, threadId: msg.threadId, extra: text, by: msg.fromId, group }), r.label],
      ])
      return void (await this.reply(msg, MORE_TEXT[locale].projectPick(!!text), markup(locale, rows)))
    }
    if (!route) {
      const keys = role === 'owner' ? this.linkMarkup(msg) : undefined
      return void (await this.reply(msg, keys ? MORE_TEXT[locale].linkPick : t.noTopic, keys))
    }
    if (!this.takeInbound(msg.chatId)) return void (await this.reply(msg, t.rate))
    const ask = this.asker()
    if (!ask) return void (await this.reply(msg, t.unavailable))
    const a = ACT_TEXT[locale]
    const sessionTerminal = session ? this.terminalOfAgent.get(session.session) : undefined
    const repliedKey = msg.replyTo !== null ? `${msg.chatId}:${msg.replyTo}` : null
    const repliedAgent = repliedKey ? this.data.replies[repliedKey] : undefined
    const replied = repliedKey ? this.liveTarget(repliedAgent, this.sentTo.get(repliedKey)) : undefined
    const target: TelegramTarget | undefined = replied ?? (sessionTerminal ? { kind: 'terminal', terminalId: sessionTerminal } : undefined)
    if (repliedAgent && !replied && SESSION_BOUND.has(cmd.kind)) return void (await this.reply(msg, a.sessionClosed(this.data.sessionRoutes.find((r) => r.session === repliedAgent)?.name ?? '')))
    if (session && !sessionTerminal && SESSION_BOUND.has(cmd.kind)) return void (await this.reply(msg, a.sessionClosed(session.name)))
    if (cmd.kind === 'screen') return this.heavySlot(() => this.sendScreen(msg, cmd.serial))
    const m = MORE_TEXT[locale]
    const askSafe = (req: TelegramInbound) => ask(req).catch((): TelegramInboundResult => ({ ok: false, error: 'unavailable' }))
    const panesOf = async (): Promise<TelegramPaneInfo[]> => {
      const res = await askSafe({ id: randomUUID(), action: 'status', project: route.project })
      const panes = res.ok && res.action === 'status' ? res.panes : []
      return sessionTerminal ? panes.filter((p) => p.terminalId === sessionTerminal) : panes
    }
    if (cmd.kind === 'new') {
      const text = cmd.text ? viaTelegram(inboundPrompt(cmd.text), locale) : ''
      const open = (await panesOf()).filter((p) => p.terminalId)
      return this.startNew({ chatId: msg.chatId, threadId: msg.threadId }, route.project, text, from, msg.fromId, open, (html, keys) => this.reply(msg, html, keys))
    }
    if (cmd.kind === 'all') {
      const text = viaTelegram(inboundPrompt(cmd.text), locale)
      if (!text) return
      const res = await askSafe({ id: randomUUID(), action: 'all', project: route.project, text, from })
      return void (await this.reply(msg, res.ok && res.action === 'all' ? (res.names.length ? m.allSent(res.names) : m.allNone) : !res.ok && res.error === 'busy' ? m.allNone : resultHtml(res, locale)))
    }
    if (cmd.kind === 'resume') {
      const res = await askSafe({ id: randomUUID(), action: 'resumeList', project: route.project })
      const items = res.ok && res.action === 'resumeList' ? res.items : []
      if (!items.length) return void (await this.reply(msg, res.ok ? m.resumeNone : resultHtml(res, locale)))
      const rows = items.map((i): [ActionKind, string, string][] => [
        ['rs', this.addAction({ kind: 'rs', terminalId: '', project: route.project, cwd: i.cwd, name: i.name, chatId: msg.chatId, threadId: msg.threadId, extra: i.id }), i.name],
      ])
      return void (await this.reply(msg, m.resumePick, markup(locale, rows)))
    }
    if (cmd.kind === 'last') {
      const panes = await panesOf()
      const pick = target?.kind === 'terminal' ? target.terminalId : panes.length === 1 ? panes[0]!.terminalId : undefined
      if (!pick) {
        const open = panes.filter((p) => p.terminalId)
        if (open.length > 1) return void (await this.reply(msg, m.pick(open.length, 'last'), this.pickMarkup('lt', open, route.project, msg)))
        return void (await this.reply(msg, resultHtml({ ok: false, error: 'none' }, locale)))
      }
      return void (await this.reply(msg, this.lastHtml(pick, route.project)))
    }
    if (cmd.kind === 'tail') {
      const panes = await panesOf()
      const pick = target?.kind === 'terminal' ? target.terminalId : panes.length === 1 ? panes[0]!.terminalId : undefined
      if (!pick) {
        const open = panes.filter((p) => p.terminalId)
        if (open.length > 1) return void (await this.reply(msg, m.pick(open.length, 'tail'), this.pickMarkup('tl', open, route.project, msg, String(cmd.lines))))
        return void (await this.reply(msg, resultHtml({ ok: false, error: 'none' }, locale)))
      }
      return void (await this.reply(msg, await this.tailText(pick, route.project, cmd.lines)))
    }
    if (cmd.kind === 'run') {
      const configs = this.deps.runConfigs ? await this.deps.runConfigs(route.project).catch(() => []) : []
      if (!configs.length) return void (await this.reply(msg, m.runNone))
      const want = cmd.config.trim().toLowerCase()
      const match = want ? configs.filter((c) => c.name.toLowerCase() === want || c.name.toLowerCase().includes(want)) : configs
      if (want && !match.length) return void (await this.reply(msg, m.runNoMatch(cmd.config)))
      if (match.length > 1) {
        const rows = match.slice(0, 8).map((c): [ActionKind, string, string][] => [
          ['rn', this.addAction({ kind: 'rn', terminalId: '', project: route.project, cwd: route.project, name: c.name, chatId: msg.chatId, threadId: msg.threadId, extra: c.id }), c.name],
        ])
        return void (await this.reply(msg, m.runPick, markup(locale, rows)))
      }
      return void (await this.startRun(route.project, match[0]!, { chatId: msg.chatId, threadId: msg.threadId }))
    }
    if (cmd.kind === 'stop') {
      const panes = await panesOf()
      const pick = target?.kind === 'terminal' ? panes.find((p) => p.terminalId === target.terminalId) : panes.length === 1 ? panes[0] : undefined
      if (!pick?.terminalId) {
        const open = panes.filter((p) => p.terminalId)
        if (!target && open.length > 1) return void (await this.reply(msg, m.pick(open.length, 'stop'), this.pickMarkup('st', open, route.project, msg)))
        return void (await this.reply(msg, resultHtml({ ok: false, error: target ? 'gone' : 'none' }, locale)))
      }
      const key = this.addAction({ kind: 'st', terminalId: pick.terminalId, project: route.project, cwd: route.project, name: pick.name, chatId: msg.chatId, threadId: msg.threadId, ...(pick.since ? { since: pick.since } : {}) })
      await this.reply(msg, a.stopAsk(pick.name), markup(locale, [[['st', key]]]))
      return
    }
    if (cmd.kind === 'compact' || cmd.kind === 'close' || cmd.kind === 'focus') {
      const kind: ActionKind = cmd.kind === 'compact' ? 'cp' : cmd.kind === 'close' ? 'cl' : 'fc'
      const panes = await panesOf()
      const pick = target ? (target.kind === 'terminal' ? panes.find((p) => p.terminalId === target.terminalId) : undefined) : panes.length === 1 ? panes[0] : undefined
      if (!pick?.terminalId) {
        const open = panes.filter((p) => p.terminalId)
        if (!target && open.length > 1) return void (await this.reply(msg, m.pick(open.length, cmd.kind), this.pickMarkup(kind, open, route.project, msg)))
        return void (await this.reply(msg, resultHtml({ ok: false, error: target ? 'gone' : 'none' }, locale)))
      }
      const entry = { kind, terminalId: pick.terminalId, project: route.project, cwd: route.project, name: pick.name, chatId: msg.chatId, threadId: msg.threadId, by: msg.fromId, group: randomUUID().slice(0, 8), ...(pick.since ? { since: pick.since } : {}) }
      if (kind === 'fc') return this.runPaneCommand(kind, entry, (html) => this.reply(msg, html))
      await this.reply(msg, kind === 'cl' ? a.closeAsk(pick.name) : a.compactAsk(pick.name), markup(locale, [[[kind, this.addAction(entry)]]]))
      return
    }
    let req: TelegramInbound
    if (cmd.kind === 'status') req = { id: randomUUID(), action: 'status', project: route.project }
    else if (cmd.kind === 'file') {
      const files = [cmd.file, ...more]
      const results = await Promise.all(files.map((f) => this.heavySlot(() => this.download(route.project, f))))
      const paths = results.flatMap((r) => (r.ok ? [r.path] : []))
      if (!paths.length) return void (await this.reply(msg, results.some((r) => !r.ok && r.error === 'big') ? a.fileTooBig : a.fileFail))
      const caption = inboundPrompt(cmd.text)
      const kind = more.length ? FILE_KIND[locale].album! : FILE_KIND[locale][cmd.file.kind] ?? cmd.file.kind
      const text = viaTelegram(inboundPrompt(a.filePrompt(kind, paths.join(', '), caption)), locale)
      // The page attaches images to the agent's tray when it can; otherwise it sends `text`, which names every path.
      const images = results.flatMap((r, i) => (r.ok && isImageFile(files[i]!) ? [r.path] : []))
      const others = results.flatMap((r, i) => (r.ok && !isImageFile(files[i]!) ? [r.path] : []))
      const otherFile = files.find((f, i) => results[i]!.ok && !isImageFile(f))
      const lead = a.imagePrompt(images.length)
      const body = otherFile ? a.filePrompt(FILE_KIND[locale][otherFile.kind] ?? otherFile.kind, others.join(', '), caption) : caption
      const imageText = images.length ? viaTelegram(inboundPrompt(body ? `${lead}\n${body}` : lead), locale) : ''
      req = { id: randomUUID(), action: 'send', project: route.project, text, from, ...(target ? { target } : {}), ...(imageText ? { images, imageText } : {}) }
    } else {
      const text = viaTelegram(inboundPrompt(cmd.text), locale)
      if (!text) return
      req = { id: randomUUID(), action: 'send', project: route.project, text, from, ...(target ? { target } : {}) }
    }
    const result = await ask(req).catch((): TelegramInboundResult => ({ ok: false, error: 'unavailable' }))
    if (req.action === 'send' && !result.ok && result.error === 'many' && result.panes?.some((p) => p.terminalId)) {
      const open = result.panes.filter((p) => p.terminalId)
      return void (await this.reply(msg, m.pick(open.length, 'send'), this.pickMarkup('np', open, route.project, msg, req.text)))
    }
    if (req.action === 'send') this.deps.onInbound?.({ from, project: route.project, result })
    const sent = await this.reply(msg, resultHtml(result, locale))
    if (sent !== null && result.ok && result.action === 'send' && result.terminalId) this.rememberSent(msg.chatId, sent, { kind: 'terminal', terminalId: result.terminalId })
  }

  private takeInbound(chatId: string): boolean {
    let lim = this.inboundLimit.get(chatId)
    if (!lim) {
      lim = new RateLimiter(INBOUND_PER_CHAT_MIN, 60_000, this.deps.now ?? Date.now)
      this.inboundLimit.set(chatId, lim)
    }
    return lim.take()
  }

  /** `/new` where the topic does not name one project (General, or several routes on it): the routes to pick from. */
  private projectChoices(msg: TgMessage): TelegramRoute[] {
    const here = this.data.routes.filter((r) => r.chatId === msg.chatId && r.threadId === msg.threadId)
    if (here.length === 1 || (!here.length && msg.threadId !== null)) return []
    const list = here.length ? here : this.data.routes.filter((r) => r.chatId === msg.chatId)
    const seen = new Set<string>()
    return list.filter((r) => !seen.has(r.project) && !!seen.add(r.project)).slice(0, PROJECT_CHOICES_MAX)
  }

  private async startNew(where: { chatId: string; threadId: number | null }, project: string, text: string, from: string, by: number, open: TelegramPaneInfo[], say: (html: string, keys?: Markup) => Promise<unknown>): Promise<void> {
    const locale = this.deps.locale()
    const m = MORE_TEXT[locale]
    if (open.length) {
      const base = { project, cwd: project, ...where, extra: text, by, group: randomUUID().slice(0, 8) }
      const rows: ([ActionKind, string] | [ActionKind, string, string])[][] = [[['nw', this.addAction({ kind: 'nw', terminalId: '', name: '', ...base })]]]
      if (text) for (const p of open.slice(0, 8)) rows.push([['np', this.addAction({ kind: 'np', terminalId: p.terminalId!, name: p.name, ...base }), this.paneLabel(p, locale)]])
      return void (await say(m.newPick(open.length, !!text), markup(locale, rows)))
    }
    const ask = this.asker()
    if (!ask) return void (await say(INBOUND_TEXT[locale].unavailable))
    const res = await ask({ id: randomUUID(), action: 'new', project, from, ...(text ? { text } : {}) }).catch((): TelegramInboundResult => ({ ok: false, error: 'unavailable' }))
    await say(res.ok && res.action === 'new' ? m.opened(res.name) : resultHtml(res, locale))
  }

  /** Runs compact / close / focus on the pane the entry names; a button press (`cb`) also answers the callback and retires its siblings. */
  private async runPaneCommand(kind: 'cp' | 'cl' | 'fc', entry: ActionEntry, say: (html: string) => Promise<unknown>, cb?: { id: string; messageId: unknown; key: string }): Promise<void> {
    const locale = this.deps.locale()
    const a = ACT_TEXT[locale]
    const ask = this.asker()
    if (!ask) return void (await (cb ? this.answer(cb.id, INBOUND_TEXT[locale].unavailable) : say(INBOUND_TEXT[locale].unavailable)))
    const action = kind === 'cp' ? 'compact' : kind === 'cl' ? 'close' : 'focus'
    const res = await ask({ id: randomUUID(), action, project: entry.project, target: { kind: 'terminal', terminalId: entry.terminalId }, ...(kind !== 'fc' && entry.since !== undefined ? { since: entry.since } : {}) }).catch((): TelegramInboundResult => ({ ok: false, error: 'unavailable' }))
    if (!res.ok || res.action !== action) {
      const html = res.ok ? INBOUND_TEXT[locale].unavailable : res.error === 'state' ? a.state : resultHtml(res, locale)
      return void (await (cb ? this.answer(cb.id, html) : say(html)))
    }
    if (kind === 'fc') this.deps.focusApp?.()
    if (cb) {
      this.retire(cb.key, entry)
      await this.answer(cb.id)
      if (typeof cb.messageId === 'number') await this.call('editMessageReplyMarkup', { chat_id: entry.chatId, message_id: cb.messageId, reply_markup: { inline_keyboard: [] } })
    }
    await say(kind === 'cp' ? a.compacted(res.name) : kind === 'cl' ? a.closed(res.name) : a.focused(res.name))
  }

  /** A pressed button takes down the other buttons of its own message only. */
  private retire(key: string, entry: ActionEntry): void {
    this.actions.delete(key)
    if (entry.group) for (const [k, e] of this.actions) if (e.group === entry.group) this.actions.delete(k)
  }

  /** Buttons that connect an unassigned topic to an open session or its project, so no link has to be copied into the app. */
  private linkMarkup(msg: TgMessage): Markup | undefined {
    if (!this.receiving || msg.threadId === null || !this.openSessions.length) return undefined
    return markup(this.deps.locale(), this.linkRows(msg))
  }

  private async whereReply(msg: TgMessage, owner: boolean, session: TelegramSessionRoute | undefined, route: TelegramRoute | undefined): Promise<void> {
    const locale = this.deps.locale()
    const m = MORE_TEXT[locale]
    if (!route) {
      const keys = owner ? this.linkMarkup(msg) : undefined
      return void (await this.reply(msg, keys ? m.linkPick : INBOUND_TEXT[locale].noTopic, keys))
    }
    const name = session ? session.name : route.label
    const base = { terminalId: '', chatId: msg.chatId, threadId: msg.threadId, project: route.project, cwd: route.project, name }
    const rows: [ActionKind, string][][] = owner && this.receiving ? [[['ul', this.addAction({ kind: 'ul', ...base, ...(session ? { extra: session.session } : {}) })]]] : []
    const html = session ? m.whereSession(session.name, session.project, this.terminalOfAgent.has(session.session), !!session.keep) : m.whereProject(route.label, route.project)
    await this.reply(msg, html, rows.length ? markup(locale, rows) : undefined)
  }

  /** Connect buttons for open sessions (`onlyFree`: those without a topic), then their projects. */
  private linkRows(where: { chatId: string; threadId: number | null }, onlyFree = false): [ActionKind, string, string][][] {
    const base = { terminalId: '', chatId: where.chatId, threadId: where.threadId }
    const linked = new Set(onlyFree ? this.data.sessionRoutes.map((r) => r.session) : [])
    const rows: [ActionKind, string, string][][] = this.openSessions.filter((s) => !linked.has(s.agent)).slice(0, 6).map((s) => [['lk', this.addAction({ kind: 'lk', ...base, project: s.cwd, cwd: s.cwd, name: s.name, extra: s.agent }), s.name]])
    const projects = [...new Set(this.openSessions.map((s) => s.cwd))].slice(0, 4)
    for (const p of projects) rows.push([['lp', this.addAction({ kind: 'lp', ...base, project: p, cwd: p, name: path.basename(p) || p }), path.basename(p) || p]])
    return rows
  }

  private async tailText(terminalId: string, project: string, lines: number): Promise<string> {
    const locale = this.deps.locale()
    const ask = this.asker()
    if (!ask) return INBOUND_TEXT[locale].unavailable
    const res = await ask({ id: randomUUID(), action: 'tail', project, lines, target: { kind: 'terminal', terminalId } }).catch((): TelegramInboundResult => ({ ok: false, error: 'unavailable' }))
    return res.ok && res.action === 'tail' ? tailHtml(res.name, res.text, locale, this.deps.home, this.deps.platform, this.token()) : resultHtml(res, locale)
  }

  /** Button text "name · state · age" (age = time in that state; no terminal text), kept within the 60 characters markup() leaves after the action prefix. */
  private paneLabel(p: TelegramPaneInfo, locale: TelegramLocale): string {
    const min = p.since ? Math.max(0, Math.floor((this.now - p.since) / 60_000)) : null
    const vi = locale === 'vi'
    const age = min === null ? '' : min < 1 ? (vi ? 'vừa xong' : 'just now') : min < 60 ? (vi ? `${min} phút` : `${min}m`) : min < 1440 ? (vi ? `${Math.floor(min / 60)} giờ` : `${Math.floor(min / 60)}h`) : vi ? `${Math.floor(min / 1440)} ngày` : `${Math.floor(min / 1440)}d`
    const tail = [paneStatus(p.status, locale), age].filter(Boolean).join(' · ')
    const room = 48 - [...tail].length - 3
    const name = [...p.name]
    return `${name.length > room ? `${name.slice(0, Math.max(1, room - 1)).join('')}…` : p.name} · ${tail}`
  }

  private pickMarkup(kind: 'st' | 'lt' | 'tl' | 'np' | 'cp' | 'cl' | 'fc', panes: TelegramPaneInfo[], project: string, msg: TgMessage, text?: string): Markup {
    const locale = this.deps.locale()
    const own = kind === 'cp' || kind === 'cl' || kind === 'fc' || kind === 'np' ? { by: msg.fromId, group: randomUUID().slice(0, 8) } : {}
    const rows = panes.slice(0, 8).map((p): [ActionKind, string, string][] => [
      [kind, this.addAction({ kind, terminalId: p.terminalId!, project, cwd: project, name: p.name, chatId: msg.chatId, threadId: msg.threadId, ...own, ...(p.since ? { since: p.since } : {}), ...(text !== undefined ? { extra: text } : {}) }), this.paneLabel(p, locale)],
    ])
    return markup(locale, rows)
  }

  private lastHtml(terminalId: string, project: string): string {
    const locale = this.deps.locale()
    const m = MORE_TEXT[locale]
    const last = this.lastReplies.get(terminalId)
    if (!last) return m.lastNone
    return episodeHtml({ type: 'telegram', episode: '', reason: 'done', terminalId, name: last.name, cwd: project, reply: last.reply }, locale, this.masker, true).replace(/^[^\n]*/, () => m.last(last.name))
  }

  private addAction(entry: ActionEntry): string {
    const key = randomUUID().replace(/-/g, '').slice(0, 12)
    this.actions.set(key, entry.at === undefined ? { ...entry, at: this.now } : entry)
    if (this.actions.size > ACTIONS_MAX) this.actions.delete(this.actions.keys().next().value as string)
    return key
  }

  private nestedOf(project: string): string[] {
    const key = (p: string) => (this.deps.platform === 'win32' ? p.toLowerCase() : p)
    return this.data.routes.filter((r) => key(r.project) !== key(project) && isInsideOrSame(project, r.project, this.deps.platform)).map((r) => r.project)
  }

  private asker(): ((req: TelegramInbound) => Promise<TelegramInboundResult>) | undefined {
    const ask = this.deps.askPage
    if (!ask) return undefined
    return (req) => {
      const nested = this.nestedOf(req.project)
      return ask(nested.length ? { ...req, nested } : req)
    }
  }

  private noteIgnored(): void {
    this.ignored++
    if (this.now - this.ignoredAt < IGNORED_STATE_MS) return
    this.ignoredAt = this.now
    this.deps.onState?.(this.state())
  }

  private async answer(id: string, text?: string): Promise<void> {
    const plain = text?.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').slice(0, 190)
    await this.call('answerCallbackQuery', { callback_query_id: id, ...(plain ? { text: plain } : {}) })
  }

  private async onCallback(cb: Record<string, unknown>): Promise<void> {
    const id = typeof cb.id === 'string' ? cb.id : null
    const from = cb.from as { id?: unknown } | undefined
    const data = typeof cb.data === 'string' ? cb.data : ''
    if (!id) return
    const locale = this.deps.locale()
    const a = ACT_TEXT[locale]
    const role = this.roleOf(from?.id)
    if (!role) {
      this.noteIgnored()
      if (this.notOwnerLimit.take()) await this.answer(id, a.notOwner)
      return
    }
    const m = ACTION_RE.exec(data)
    if (m && !mayPress(role, m[1] as ActionKind)) {
      if (this.readOnlyLimit.take()) await this.answer(id, a.notAllowed)
      return
    }
    const entry = m ? this.actions.get(m[2]!) : undefined
    if (!m || !entry || !this.receiving) return this.answer(id, a.expired)
    const kind = m[1] as ActionKind
    const who = this.nameOf(from!.id as number)
    if (kind === 'lk' || kind === 'lp') return this.linkTopic(id, kind, entry, cb)
    if (kind === 'ul') return this.unlinkTopic(id, m[2]!, entry, cb)
    if (kind === 'bg' || kind === 'bx') return this.onBacklog(id, kind, m[2]!, entry, cb)
    const ask = this.asker()
    if (!ask) return this.answer(id, INBOUND_TEXT[locale].unavailable)
    const msg = (cb.message ?? {}) as { message_id?: unknown }
    const where = { chatId: entry.chatId, threadId: entry.threadId }
    const target: TelegramTarget = { kind: 'terminal', terminalId: entry.terminalId }
    if (kind === 'rs' || kind === 'rn') {
      this.actions.delete(m[2]!)
      await this.answer(id)
      if (typeof msg.message_id === 'number') await this.call('editMessageReplyMarkup', { chat_id: entry.chatId, message_id: msg.message_id, reply_markup: { inline_keyboard: [] } })
      if (kind === 'rn') return void (await this.startRun(entry.project, { id: entry.extra ?? '', name: entry.name }, where))
      const res = await ask({ id: randomUUID(), action: 'resume', project: entry.project, sessionId: entry.extra ?? '', cwd: entry.cwd }).catch((): TelegramInboundResult => ({ ok: false, error: 'unavailable' }))
      return void (await this.post(where, res.ok && res.action === 'resume' ? MORE_TEXT[locale].resumed(res.name) : resultHtml(res, locale)))
    }
    if (kind === 'df') {
      await this.answer(id)
      return this.sendDiff(entry)
    }
    if (kind === 'lt') {
      await this.answer(id)
      return void (await this.post(where, this.lastHtml(entry.terminalId, entry.project)))
    }
    if (kind === 'tl') {
      await this.answer(id)
      return void (await this.post(where, await this.tailText(entry.terminalId, entry.project, Math.min(TELEGRAM_TAIL_MAX, Math.max(1, Number(entry.extra) || TELEGRAM_TAIL_DEFAULT)))))
    }
    if (entry.by !== undefined && role !== 'owner' && from!.id !== entry.by) return this.answer(id, a.notAllowed)
    if ((kind === 'cp' || kind === 'cl') && this.now - (entry.at ?? 0) > CONFIRM_TTL_MS) {
      this.retire(m[2]!, entry)
      return this.answer(id, a.expired)
    }
    if (kind === 'cp' || kind === 'cl' || kind === 'fc') return this.runPaneCommand(kind, entry, (html) => this.post(where, html), { id, messageId: msg.message_id, key: m[2]! })
    if (kind === 'pj') {
      this.retire(m[2]!, entry)
      await this.answer(id)
      if (typeof msg.message_id === 'number') await this.call('editMessageReplyMarkup', { chat_id: entry.chatId, message_id: msg.message_id, reply_markup: { inline_keyboard: [] } })
      const status = await ask({ id: randomUUID(), action: 'status', project: entry.project }).catch((): TelegramInboundResult => ({ ok: false, error: 'unavailable' }))
      const open = status.ok && status.action === 'status' ? status.panes.filter((p) => p.terminalId) : []
      return this.startNew(where, entry.project, entry.extra ?? '', who, from!.id as number, open, (html, keys) => this.post(where, html, keys ? { reply_markup: keys } : {}))
    }
    if (kind === 'nw' || kind === 'np') {
      if (entry.group) this.retire(m[2]!, entry)
      else for (const [k, e] of this.actions) if ((e.kind === 'nw' || e.kind === 'np') && e.chatId === entry.chatId && e.extra === entry.extra && e.threadId === entry.threadId) this.actions.delete(k)
      await this.answer(id)
      if (typeof msg.message_id === 'number') await this.call('editMessageReplyMarkup', { chat_id: entry.chatId, message_id: msg.message_id, reply_markup: { inline_keyboard: [] } })
      const text = entry.extra ?? ''
      const result = await ask(kind === 'nw'
        ? { id: randomUUID(), action: 'new', project: entry.project, from: who, ...(text ? { text } : {}) }
        : { id: randomUUID(), action: 'send', project: entry.project, text, from: who, target }).catch((): TelegramInboundResult => ({ ok: false, error: 'unavailable' }))
      if (kind === 'np') this.deps.onInbound?.({ from: who, project: entry.project, result })
      return void (await this.post(where, result.ok && result.action === 'new' ? MORE_TEXT[locale].opened(result.name) : resultHtml(result, locale)))
    }
    if (kind === 'go' || kind === 'ts') {
      const text = PROMPTS[locale][kind]
      const result = await ask({ id: randomUUID(), action: 'send', project: entry.project, text, from: who, target }).catch((): TelegramInboundResult => ({ ok: false, error: 'unavailable' }))
      this.deps.onInbound?.({ from: who, project: entry.project, result })
      await this.answer(id)
      await this.post(where, resultHtml(result, locale))
      return
    }
    const key: TelegramKey = kind === 'ap' ? 'approve' : kind === 'dn' ? 'deny' : kind === 'qa' ? 'option' : kind === 'es' ? 'esc' : 'stop'
    const option = kind === 'qa' ? Number(entry.extra) : undefined
    const episode = { ...(entry.since !== undefined ? { since: entry.since } : {}), ...(entry.tool && key !== 'stop' && key !== 'option' && key !== 'esc' ? { tool: entry.tool } : {}) }
    const result = await ask({ id: randomUUID(), action: 'keys', project: entry.project, key, ...(option ? { option } : {}), target, ...episode }).catch((): TelegramInboundResult => ({ ok: false, error: 'unavailable' }))
    if (!result.ok) {
      await this.answer(id, result.error === 'state' ? a.state : result.error === 'busy' ? a.keysBusy : resultHtml(result, locale))
      return
    }
    this.actions.delete(m[2]!)
    if (kind === 'qa') for (const [k, e] of this.actions) if (e.kind === 'qa' && e.terminalId === entry.terminalId && e.since === entry.since) this.actions.delete(k)
    if (typeof msg.message_id === 'number') await this.call('editMessageReplyMarkup', { chat_id: entry.chatId, message_id: msg.message_id, reply_markup: { inline_keyboard: [] } })
    const done = kind === 'ap' ? a.approved(entry.name) : kind === 'dn' ? a.denied(entry.name) : kind === 'qa' ? a.chose(entry.name, entry.label ?? String(option)) : kind === 'es' ? a.escaped(entry.name) : a.stopped(entry.name)
    await this.answer(id)
    await this.post(where, done)
  }

  private async unlinkTopic(id: string, key: string, entry: ActionEntry, cb: Record<string, unknown>): Promise<void> {
    this.actions.delete(key)
    const res = entry.extra ? this.removeSessionRoute(entry.extra) : this.removeRoute(entry.project)
    await this.answer(id)
    const msgId = (cb.message as { message_id?: unknown } | undefined)?.message_id
    if (typeof msgId === 'number') await this.call('editMessageReplyMarkup', { chat_id: entry.chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } })
    const locale = this.deps.locale()
    await this.post(entry, res.ok ? MORE_TEXT[locale].unlinked(entry.name) : ACT_TEXT[locale].expired)
  }

  private async linkTopic(id: string, kind: 'lk' | 'lp', entry: ActionEntry, cb: Record<string, unknown>): Promise<void> {
    for (const [k, e] of this.actions) if ((e.kind === 'lk' || e.kind === 'lp') && e.chatId === entry.chatId && e.threadId === entry.threadId) this.actions.delete(k)
    const project = this.normProject(entry.project)
    const res: TelegramSetResult = !project
      ? { ok: false, error: 'invalid-project' }
      : kind === 'lk'
        ? this.linkSession({ session: entry.extra ?? '', name: entry.name, project, chatId: entry.chatId, threadId: entry.threadId })
        : this.setRoute({ project, chatId: entry.chatId, threadId: entry.threadId })
    await this.answer(id)
    const msgId = (cb.message as { message_id?: unknown } | undefined)?.message_id
    if (typeof msgId === 'number') await this.call('editMessageReplyMarkup', { chat_id: entry.chatId, message_id: msgId, reply_markup: { inline_keyboard: [] } })
    const locale = this.deps.locale()
    await this.post({ chatId: entry.chatId, threadId: entry.threadId }, res.ok ? MORE_TEXT[locale].linked(entry.name) : ACT_TEXT[locale].expired)
  }

  private async post(where: { chatId: string; threadId: number | null }, html: string, extra: Record<string, unknown> = {}): Promise<number | null> {
    const res = await this.call('sendMessage', { ...threadFields(where.chatId, where.threadId), text: html, parse_mode: 'HTML', disable_web_page_preview: true, ...extra })
    const id = res.ok ? (res.result as { message_id?: unknown })?.message_id : undefined
    return typeof id === 'number' ? id : null
  }

  private async sendScreen(msg: TgMessage, serial?: string): Promise<void> {
    const a = ACT_TEXT[this.deps.locale()]
    const shot = this.deps.screenshot ? await this.deps.screenshot(serial).catch(() => ({ ok: false as const, error: 'failed' as const })) : ({ ok: false, error: 'failed' } as const)
    if (!shot.ok) return void (await this.reply(msg, shot.error === 'none' ? a.screenNone : a.screenFail))
    const buf = await (this.deps.readFile ?? fsp.readFile)(shot.png).catch(() => null)
    if (!buf) return void (await this.reply(msg, a.screenFail))
    const form = new FormData()
    for (const [k, v] of Object.entries(threadFields(msg.chatId, msg.threadId))) form.append(k, String(v))
    form.append('caption', a.screenCaption(shot.device))
    form.append('parse_mode', 'HTML')
    form.append('photo', new Blob([new Uint8Array(buf)], { type: 'image/png' }), 'screen.png')
    const res = await this.call('sendPhoto', form, UPLOAD_TIMEOUT_MS)
    if (!res.ok) await this.reply(msg, a.screenFail)
  }

  private async sendDiff(entry: ActionEntry): Promise<void> {
    const a = ACT_TEXT[this.deps.locale()]
    const where = { chatId: entry.chatId, threadId: entry.threadId }
    const diff = this.deps.diff ? await this.deps.diff(entry.cwd).catch(() => ({ ok: false as const, error: 'failed' as const })) : ({ ok: false, error: 'failed' } as const)
    if (!diff.ok) return void (await this.post(where, diff.error === 'clean' ? a.diffClean : diff.error === 'not-repo' ? a.diffNotRepo : a.diffFail))
    const data = Buffer.from(diff.text, 'utf8')
    if (data.length > TELEGRAM_FILE_MAX) return void (await this.post(where, a.diffFail))
    const form = new FormData()
    for (const [k, v] of Object.entries(threadFields(entry.chatId, entry.threadId))) form.append(k, String(v))
    form.append('caption', a.diffCaption(entry.name, diff.files))
    form.append('parse_mode', 'HTML')
    form.append('document', new Blob([new Uint8Array(data)], { type: 'text/x-diff' }), 'changes.diff')
    const res = await this.call('sendDocument', form, UPLOAD_TIMEOUT_MS)
    if (!res.ok) await this.post(where, a.diffFail)
  }

  private async download(project: string, file: { fileId: string; name: string; size: number }): Promise<{ ok: true; path: string } | { ok: false; error: 'big' | 'failed' }> {
    if (file.size > DOWNLOAD_MAX) return { ok: false, error: 'big' }
    const token = this.token()
    if (!token || !this.deps.saveFile) return { ok: false, error: 'failed' }
    const info = await this.call('getFile', { file_id: file.fileId })
    const filePath = info.ok ? (info.result as { file_path?: unknown; file_size?: unknown })?.file_path : undefined
    if (typeof filePath !== 'string' || !/^[A-Za-z0-9_./-]{1,300}$/.test(filePath) || filePath.includes('..')) return { ok: false, error: 'failed' }
    let buf: Buffer
    try {
      const res = await this.deps.fetch(`${(this.deps.base || API_BASE).replace(/\/+$/, '')}/file/bot${token}/${filePath}`, { method: 'GET', signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS) })
      if (!res.ok || !res.arrayBuffer) return { ok: false, error: 'failed' }
      buf = Buffer.from(await res.arrayBuffer())
    } catch {
      return { ok: false, error: 'failed' }
    }
    if (buf.length > DOWNLOAD_MAX) return { ok: false, error: 'big' }
    const saved = await this.deps.saveFile(project, file.name, buf).catch(() => null)
    return saved ? { ok: true, path: saved } : { ok: false, error: 'failed' }
  }

  private quietNow(): boolean {
    return inTelegramQuiet(this.data.quiet, new Date(this.now))
  }

  private countsFor(project: string): DayCounts {
    const day = dayKey(new Date(this.now))
    if (day !== this.countsDay) {
      this.counts = new Map()
      this.countsDay = day
    }
    let c = this.counts.get(project)
    if (!c) {
      c = emptyCounts()
      this.counts.set(project, c)
    }
    return c
  }

  private async broadcastGeneral(html: string): Promise<void> {
    const chats = [...new Set(this.data.routes.map((r) => r.chatId))]
    for (const chatId of chats) if (this.take(chatId)) await this.post({ chatId, threadId: null }, html)
  }

  async alert(kind: 'limit', info?: TelegramLimitInfo): Promise<boolean>
  async alert(kind: 'disk', detail?: { label: string; free: string }): Promise<boolean>
  async alert(kind: 'limit' | 'disk', detail?: { label: string; free: string } | TelegramLimitInfo): Promise<boolean> {
    if (!this.data.enabled || !this.data.alerts || !this.token()) return false
    if (kind === 'limit') return this.limitAlert((detail ?? {}) as TelegramLimitInfo)
    const d = detail as { label: string; free: string } | undefined
    await this.broadcastGeneral(ACT_TEXT[this.deps.locale()].disk(d?.label ?? '', d?.free ?? ''))
    return true
  }

  /** Account-wide limit: it goes to the topic of every project with an open session (once per topic and reset period), else to each chat's General. */
  private async limitAlert(info: TelegramLimitInfo): Promise<boolean> {
    const locale = this.deps.locale()
    const a = ACT_TEXT[locale]
    const text: LimitText = {
      ...(info.window ? { window: info.window } : {}),
      ...(info.usedPct !== undefined ? { usedPct: info.usedPct } : {}),
      ...(info.hit ? { hit: true } : {}),
      ...(info.resetsAt ? { reset: this.resetLabel(info.resetsAt) } : {}),
    }
    const html = a.limit(info.window || info.usedPct !== undefined || info.resetsAt || info.hit ? text : null)
    const period = info.resetsAt ? Math.floor(info.resetsAt / 60_000) : Math.floor(this.now / WINDOW_MS[info.window ?? 'five_hour'])
    const kindKey = `${info.hit ? 'hit' : 'forecast'}|${info.window ?? '?'}|${period}`
    const targets = new Map<string, { chatId: string; threadId: number | null }>()
    for (const s of this.openSessions) {
      const r = this.sessionRouteOf(s.agent) ?? this.routeFor(s.cwd)
      if (r) targets.set(topicKey(r), { chatId: r.chatId, threadId: r.threadId })
    }
    if (!targets.size) for (const r of this.data.routes) targets.set(`${r.chatId}:null`, { chatId: r.chatId, threadId: null })
    if (this.limitSent.size > 500) this.limitSent.clear()
    let sent = false
    for (const [key, where] of targets) {
      const once = `${kindKey}|${key}`
      if (this.limitSent.has(once)) continue
      if ((await this.sendText({ project: '', label: '', ...where }, html, undefined, undefined, true)) !== null) continue
      this.limitSent.add(once)
      sent = true
    }
    return sent
  }

  private resetLabel(at: number): string {
    const d = new Date(at)
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    const now = new Date(this.now)
    return dayKey(d) === dayKey(now) ? hhmm : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${hhmm}`
  }

  private async startRun(project: string, config: { id: string; name: string }, where: { chatId: string; threadId: number | null }): Promise<void> {
    const m = MORE_TEXT[this.deps.locale()]
    if (!this.deps.runStart) return void (await this.post(where, m.runFail('unavailable')))
    const res = await this.deps.runStart(project, config.id).catch(() => ({ ok: false as const, error: 'failed' }))
    if (!res.ok) return void (await this.post(where, m.runFail(res.error)))
    this.runWatch.set(res.sessionId, { project, ...where, config: config.name, shot: false })
    if (this.runWatch.size > 50) this.runWatch.delete(this.runWatch.keys().next().value as string)
    await this.post(where, m.runStarted(config.name))
  }

  async runState(session: { id: string; state: string; configName: string; deviceId: string | null }): Promise<void> {
    const w = this.runWatch.get(session.id)
    if (!w || w.shot || session.state !== 'running') return
    w.shot = true
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
    await sleep(RUN_SHOT_DELAY_MS)
    const shot = this.deps.screenshot ? await this.deps.screenshot(session.deviceId ?? undefined).catch(() => null) : null
    if (!shot?.ok) return
    const buf = await (this.deps.readFile ?? fsp.readFile)(shot.png).catch(() => null)
    if (!buf) return
    const form = new FormData()
    for (const [k, v] of Object.entries(threadFields(w.chatId, w.threadId))) form.append(k, String(v))
    form.append('caption', MORE_TEXT[this.deps.locale()].runShot(w.config, shot.device))
    form.append('parse_mode', 'HTML')
    form.append('photo', new Blob([new Uint8Array(buf)], { type: 'image/png' }), 'screen.png')
    await this.call('sendPhoto', form, UPLOAD_TIMEOUT_MS)
  }

  /** One pinned message per topic, listing every session that reports there (project route or session route). */
  async pinTick(): Promise<void> {
    const ask = this.asker()
    if (this.pinBusy || !this.data.enabled || !this.token()) return
    this.pinBusy = true
    try {
      await this.migratePins()
      if (!this.data.pinStatus || !ask) return
      const locale = this.deps.locale()
      const m = MORE_TEXT[locale]
      const statuses = new Map<string, TelegramPaneInfo[] | null>()
      const panesOf = async (project: string): Promise<TelegramPaneInfo[] | null> => {
        if (!statuses.has(project)) {
          const res = await ask({ id: randomUUID(), action: 'status', project }).catch((): TelegramInboundResult => ({ ok: false, error: 'unavailable' }))
          statuses.set(project, res.ok && res.action === 'status' ? res.panes : null)
        }
        return statuses.get(project) ?? null
      }
      const own = new Set(this.data.sessionRoutes.map((s) => this.terminalOfAgent.get(s.session)).filter((t): t is string => !!t))
      const topics = new Map<string, { chatId: string; threadId: number | null; label: string; routes: TelegramRoute[]; sessions: TelegramSessionRoute[] }>()
      const topic = (r: { chatId: string; threadId: number | null }, label: string) => {
        const key = topicKey(r)
        if (!topics.has(key)) topics.set(key, { chatId: r.chatId, threadId: r.threadId, label, routes: [], sessions: [] })
        return topics.get(key)!
      }
      for (const r of this.data.routes) topic(r, r.label).routes.push(r)
      for (const s of this.data.sessionRoutes) topic(s, s.name).sessions.push(s)
      for (const [key, t] of topics) {
        const lines: string[] = []
        const seen = new Set<string>()
        let complete = true
        const minutes = (p: TelegramPaneInfo) => (p.since ? Math.max(0, Math.round((this.now - p.since) / 60_000)) : null)
        const state = (p: TelegramPaneInfo): PinState => (p.status === 'working' || p.status === 'waiting' || p.status === 'idle' ? p.status : 'unknown')
        for (const r of t.routes) {
          const all = await panesOf(r.project)
          if (!all) {
            complete = false
            break
          }
          for (const p of all) {
            const id = p.terminalId ?? `${r.project}\n${p.name}`
            if (seen.has(id) || (p.terminalId && own.has(p.terminalId))) continue
            seen.add(id)
            lines.push(m.pinLine(p.name, state(p), p.tool, minutes(p)))
          }
        }
        for (const s of t.sessions) {
          if (!complete) break
          const all = await panesOf(s.project)
          if (!all) {
            complete = false
            break
          }
          const terminal = this.terminalOfAgent.get(s.session)
          const p = terminal ? all.find((x) => x.terminalId === terminal) : undefined
          if (p) {
            if (seen.has(p.terminalId!)) continue
            seen.add(p.terminalId!)
            lines.push(m.pinLine(s.name || p.name, state(p), p.tool, minutes(p)))
          } else lines.push(m.pinLine(s.name, 'closed', undefined, null))
        }
        if (!complete) continue
        const html = [m.pinHead(t.routes[0]?.label ?? t.label), ...(lines.length ? lines : [m.pinEmpty])].join('\n')
        if (this.pinText.get(key) === html || this.now - (this.pinAt.get(key) ?? -Infinity) < PIN_EDIT_MS || this.holdLeft(t.chatId) > 0) continue
        this.pinAt.set(key, this.now)
        const pin = this.data.pins[key]
        if (pin && pin.chatId === t.chatId) {
          const edit = await this.call('editMessageText', { chat_id: t.chatId, message_id: pin.messageId, text: html, parse_mode: 'HTML', disable_web_page_preview: true })
          if (edit.ok || edit.error === 'status') {
            this.pinText.set(key, html)
            this.noteTopic(key, edit.ok ? edit : { ok: true, result: null })
            continue
          }
          this.noteTopic(key, edit)
          if (edit.error !== 'chat') continue
        }
        const sent = await this.post({ chatId: t.chatId, threadId: t.threadId }, html, { disable_notification: true })
        if (sent === null) continue
        this.pinText.set(key, html)
        this.data.pins = { ...this.data.pins, [key]: { chatId: t.chatId, messageId: sent } }
        this.save()
        await this.call('pinChatMessage', { chat_id: t.chatId, message_id: sent, disable_notification: true })
      }
    } finally {
      this.pinBusy = false
    }
  }

  /** Pins saved by an older version are per project / per session; they are unpinned once and the topic pin takes over. */
  private async migratePins(): Promise<void> {
    const old = Object.entries(this.data.pins).filter(([k]) => !PIN_KEY_RE.test(k))
    if (!old.length) return
    this.data.pins = Object.fromEntries(Object.entries(this.data.pins).filter(([k]) => PIN_KEY_RE.test(k)))
    this.save()
    for (const [, pin] of old) await this.call('unpinChatMessage', { chat_id: pin.chatId, message_id: pin.messageId })
  }

  runLogFile(sessionId: string): Buffer | null {
    const lines = this.deps.runLog?.(sessionId) ?? []
    return lines.length ? Buffer.from(lines.slice(-RUN_LOG_LINES).join('\n'), 'utf8') : null
  }

  async runFailedReport(session: { id: string; cwd: string; configName: string; failure: { code: string; detail?: string } | null }): Promise<boolean> {
    if (this.runFailed.has(session.id)) return false
    this.runFailed.add(session.id)
    if (this.runFailed.size > MAX_EPISODES) this.runFailed.delete(this.runFailed.values().next().value as string)
    const route = this.routeFor(session.cwd)
    if (route) this.countsFor(route.project).runFails++
    if (!this.data.enabled || !this.data.alerts || !route) return false
    const a = ACT_TEXT[this.deps.locale()]
    const detail = (session.failure?.detail ?? '').slice(0, RUN_DETAIL_MAX)
    const head = a.runFailed(session.configName, session.failure?.code ?? 'failed')
    const html = `${head}${quote(detail, this.masker, MESSAGE_MAX - head.length)}`
    const log = this.runLogFile(session.id)
    if (!log) return (await this.sendText(route, html)) === null
    if (!this.take(route.chatId)) return false
    const form = new FormData()
    for (const [k, v] of Object.entries(threadFields(route.chatId, route.threadId))) form.append(k, String(v))
    form.append('caption', `${head}${quote(detail, this.masker, CAPTION_MAX - head.length)}`)
    form.append('parse_mode', 'HTML')
    form.append('document', new Blob([new Uint8Array(Buffer.from(maskSecrets(log.toString('utf8'), this.deps.home, this.deps.platform), 'utf8'))], { type: 'text/plain' }), 'run.log')
    const res = await this.call('sendDocument', form, UPLOAD_TIMEOUT_MS)
    if (!res.ok) return (await this.sendText(route, html)) === null
    return true
  }

  /** Topic icon shows the most urgent state of the sessions it reports: waiting > working > idle. General (no thread) has no icon. */
  async iconTick(): Promise<void> {
    const ask = this.asker()
    if (this.iconBusy || !this.data.enabled || !this.data.topicIcons || !this.token() || !ask) return
    this.iconBusy = true
    try {
      const ids = await this.topicIconIds()
      if (!ids) return
      const moods = await this.topicMoods(ask)
      if (!moods) return
      await this.clearIcons([...this.iconSet.keys()].filter((k) => !moods.has(k)))
      for (const [key, { chatId, threadId, mood }] of moods) {
        const id = ids[mood]
        if (!id || this.iconSet.get(key)?.id === id || this.iconOff.has(chatId) || this.now - (this.iconAt.get(key) ?? 0) < ICON_EDIT_MS) continue
        this.iconAt.set(key, this.now)
        const res = await this.call('editForumTopic', { chat_id: chatId, message_thread_id: threadId, icon_custom_emoji_id: id })
        // 'status' is mostly TOPIC_NOT_MODIFIED: the topic already has that icon.
        if (res.ok || res.error === 'status') this.iconSet.set(key, { chatId, threadId, id })
        else if (res.error === 'chat') this.iconOff.add(chatId)
      }
    } finally {
      this.iconBusy = false
    }
  }

  private async topicIconIds(): Promise<Partial<Record<TopicMood, string>> | null> {
    if (this.iconIds) return this.iconIds
    const res = await this.call('getForumTopicIconStickers', {})
    if (!res.ok || !Array.isArray(res.result)) return null
    const byEmoji = new Map<string, string>()
    for (const s of res.result as { emoji?: unknown; custom_emoji_id?: unknown }[]) {
      if (typeof s.emoji === 'string' && typeof s.custom_emoji_id === 'string') byEmoji.set(s.emoji.replace(/\uFE0F/g, ''), s.custom_emoji_id)
    }
    const ids: Partial<Record<TopicMood, string>> = {}
    for (const mood of Object.keys(MOOD_EMOJI) as TopicMood[]) {
      const id = MOOD_EMOJI[mood].map((e) => byEmoji.get(e)).find((v) => v !== undefined)
      if (id) ids[mood] = id
    }
    return (this.iconIds = ids)
  }

  private async topicMoods(ask: (req: TelegramInbound) => Promise<TelegramInboundResult>): Promise<Map<string, { chatId: string; threadId: number; mood: TopicMood }> | null> {
    const statuses = new Map<string, TelegramPaneInfo[] | null>()
    const panesOf = async (project: string): Promise<TelegramPaneInfo[] | null> => {
      if (!statuses.has(project)) {
        const res = await ask({ id: randomUUID(), action: 'status', project }).catch((): TelegramInboundResult => ({ ok: false, error: 'unavailable' }))
        statuses.set(project, res.ok && res.action === 'status' ? res.panes : null)
      }
      return statuses.get(project) ?? null
    }
    const own = new Set(this.data.sessionRoutes.map((s) => this.terminalOfAgent.get(s.session)).filter((t): t is string => !!t))
    const targets = [
      ...this.data.routes.map((r) => ({ route: r, terminal: undefined as string | undefined, agent: false })),
      ...this.data.sessionRoutes.map((s) => ({ route: s, terminal: this.terminalOfAgent.get(s.session), agent: true })),
    ]
    const out = new Map<string, { chatId: string; threadId: number; mood: TopicMood }>()
    for (const { route: r, terminal, agent } of targets) {
      if (r.threadId === null) continue
      const all = await panesOf(r.project)
      if (!all) return null
      // A session with its own topic counts there, not in its project's topic.
      const panes = agent ? all.filter((p) => !!terminal && p.terminalId === terminal) : all.filter((p) => !p.terminalId || !own.has(p.terminalId))
      const mood: TopicMood = panes.some((p) => p.status === 'waiting') ? 'waiting' : panes.some((p) => p.status === 'working') ? 'working' : 'idle'
      const key = topicKey(r)
      const prev = out.get(key)
      if (!prev || MOOD_RANK[mood] > MOOD_RANK[prev.mood]) out.set(key, { chatId: r.chatId, threadId: r.threadId, mood })
    }
    return out
  }

  private async clearIcons(keys: string[]): Promise<void> {
    for (const key of keys) {
      const set = this.iconSet.get(key)
      this.iconSet.delete(key)
      this.iconAt.delete(key)
      if (set) await this.call('editForumTopic', { chat_id: set.chatId, message_thread_id: set.threadId, icon_custom_emoji_id: '' })
    }
  }

  async tick(): Promise<boolean> {
    void this.flushHeld()
    void this.pinTick()
    void this.iconTick()
    if (this.sweepStale()) this.commit()
    const s = this.data.summary
    if (!this.data.enabled || !s.enabled || !this.token()) return false
    const at = new Date(this.now)
    const day = dayKey(at)
    if (this.data.summaryDay === day || minuteOfDay(at) < hhmmMinute(s.at)) return false
    this.data.summaryDay = day
    this.save()
    if (this.quietNow()) return false
    const counts = day === this.countsDay ? this.counts : new Map<string, DayCounts>()
    const started = new Date(this.startedAt)
    if (!counts.size && dayKey(started) === day && minuteOfDay(started) >= hhmmMinute(s.at)) return false
    const locale = this.deps.locale()
    const byChat = new Map<string, { name: string; counts: DayCounts }[]>()
    for (const r of this.data.routes) {
      const list = byChat.get(r.chatId) ?? []
      list.push({ name: r.label, counts: counts.get(r.project) ?? emptyCounts() })
      byChat.set(r.chatId, list)
    }
    for (const [chatId, rows] of byChat) if (this.take(chatId)) await this.post({ chatId, threadId: null }, summaryHtml(locale, day, rows))
    return true
  }

  private rememberSent(chatId: string, messageId: number, target: TelegramTarget): void {
    const key = `${chatId}:${messageId}`
    this.sentTo.set(key, target)
    if (this.sentTo.size > SENT_MAP_MAX) this.sentTo.delete(this.sentTo.keys().next().value as string)
    const agent = target.kind === 'terminal' ? this.agentOfTerminal.get(target.terminalId) : this.agentOfPane.get(target.sessionId)
    if (!agent) return
    this.data.replies[key] = agent
    const keys = Object.keys(this.data.replies)
    for (const old of keys.slice(0, Math.max(0, keys.length - REPLIES_MAX))) delete this.data.replies[old]
    this.save()
  }

  /** A reply follows the Claude session across restarts and resumes; the in-memory target covers panes without one. */
  private liveTarget(agent: string | undefined, sent: TelegramTarget | undefined): TelegramTarget | undefined {
    const terminal = agent ? this.terminalOfAgent.get(agent) : undefined
    if (terminal) return { kind: 'terminal', terminalId: terminal }
    if (agent) return undefined
    if (sent?.kind === 'pane') {
      const live = this.terminalOfAgent.get(this.agentOfPane.get(sent.sessionId) ?? '')
      if (live) return { kind: 'terminal', terminalId: live }
    }
    return sent
  }

  private async reply(msg: TgMessage, html: string, keys?: Markup): Promise<number | null> {
    const res = await this.call('sendMessage', {
      ...threadFields(msg.chatId, msg.threadId),
      text: html,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_parameters: { message_id: msg.messageId, allow_sending_without_reply: true },
      ...(keys ? { reply_markup: keys } : {}),
    })
    const id = res.ok ? (res.result as { message_id?: unknown })?.message_id : undefined
    return typeof id === 'number' ? id : null
  }

  private normProject(p: string): string | null {
    if (!path.isAbsolute(p)) return null
    return path.resolve(p)
  }

  setRoute(input: TelegramRouteInput): TelegramSetResult {
    const project = this.normProject(input.project)
    if (!project) return { ok: false, error: 'invalid-project' }
    let target: { chatId: string; threadId: number | null } | null
    if (input.link !== undefined) target = parseTopicLink(input.link)
    else target = input.chatId ? { chatId: input.chatId, threadId: input.threadId ?? null } : null
    if (!target) return { ok: false, error: 'invalid-link' }
    const same = (r: TelegramRoute) => (this.deps.platform === 'win32' ? r.project.toLowerCase() === project.toLowerCase() : r.project === project)
    const rest = this.data.routes.filter((r) => !same(r))
    if (rest.length >= TELEGRAM_ROUTES_MAX) return { ok: false, error: 'too-many' }
    const moved = this.data.routes.filter((old) => same(old) && (old.chatId !== target.chatId || old.threadId !== target.threadId))
    this.data.routes = [...rest, { project, label: input.label || path.basename(project) || project, chatId: target.chatId, threadId: target.threadId }]
    for (const old of moved) this.releasePin(old)
    return this.commit()
  }

  setSessionRoute(input: TelegramSessionRouteInput): TelegramSetResult {
    const project = this.normProject(input.project)
    if (!project) return { ok: false, error: 'invalid-project' }
    const target = input.link !== undefined ? parseTopicLink(input.link) : input.chatId ? { chatId: input.chatId, threadId: input.threadId ?? null } : null
    if (!target) return { ok: false, error: 'invalid-link' }
    return this.linkSession({ session: input.session, name: input.name, project, ...target, ...(input.keep !== undefined ? { keep: input.keep } : {}) })
  }

  private linkSession(route: TelegramSessionRoute): TelegramSetResult {
    if (!isSessionId(route.session)) return { ok: false, error: 'invalid-project' }
    // One session per topic: a topic still tied to an older session would keep taking its messages.
    const displaced = this.data.sessionRoutes.filter((r) => r.session !== route.session && r.chatId === route.chatId && r.threadId === route.threadId)
    const rest = this.data.sessionRoutes.filter((r) => r.session !== route.session && !displaced.includes(r))
    if (rest.length >= TELEGRAM_SESSION_ROUTES_MAX) return { ok: false, error: 'too-many' }
    const old = this.data.sessionRoutes.find((r) => r.session === route.session)
    const keep = route.keep ?? old?.keep
    this.data.sessionRoutes = [...rest, { session: route.session, name: route.name, project: route.project, chatId: route.chatId, threadId: route.threadId, ...(keep ? { keep: true } : {}) }]
    if (old && (old.chatId !== route.chatId || old.threadId !== route.threadId)) this.releasePin(old)
    this.endedTopics.delete(topicKey(route))
    return this.commit()
  }

  removeSessionRoute(session: string): TelegramSetResult {
    const gone = this.data.sessionRoutes.find((r) => r.session === session.toLowerCase())
    this.data.sessionRoutes = this.data.sessionRoutes.filter((r) => r.session !== session.toLowerCase())
    if (gone) this.releasePin(gone)
    return this.commit()
  }

  setPanes(links: TelegramPaneLink[]): void {
    const before = new Map(this.agentOfTerminal)
    this.agentOfPane.clear()
    this.agentOfTerminal.clear()
    this.terminalOfAgent.clear()
    this.openSessions = links.flatMap((l) => (l.terminal && l.cwd ? [{ agent: l.agent, name: l.name || path.basename(l.cwd), cwd: l.cwd }] : []))
    for (const l of links) {
      if (l.pane) this.agentOfPane.set(l.pane, l.agent)
      if (l.terminal) {
        this.agentOfTerminal.set(l.terminal, l.agent)
        this.terminalOfAgent.set(l.agent, l.terminal)
      }
    }
    this.panesSeen = true
    const followed = this.followSessions(links, before)
    const ended = this.dropEnded(links, before)
    if (this.sweepStale() || ended || followed) this.commit()
  }

  /** Once per run, after restored panes had time to start: a link whose session did not come back (it ended while the app was off) is freed. */
  private sweepStale(): boolean {
    if (this.swept || !this.panesSeen || this.now - this.startedAt < STARTUP_SWEEP_MS) return false
    this.swept = true
    const stale = this.data.sessionRoutes.filter((r) => !r.keep && !this.terminalOfAgent.has(r.session))
    for (const r of stale) this.unlinkEnded(r, 'ended')
    return stale.length > 0
  }

  /** A new session id in the same pane (/clear, some resumes): a kept link follows it, any other lets go of its topic. */
  private followSessions(links: TelegramPaneLink[], before: Map<string, string>): boolean {
    let changed = false
    for (const l of links) {
      const prev = l.terminal ? before.get(l.terminal) : undefined
      if (!prev || prev === l.agent || this.data.sessionRoutes.some((r) => r.session === l.agent)) continue
      const old = this.data.sessionRoutes.find((r) => r.session === prev)
      if (!old) continue
      if (old.keep) old.session = l.agent
      else this.unlinkEnded(old, 'cleared', l)
      changed = true
    }
    for (const l of links) {
      const name = l.name
      const r = name ? this.data.sessionRoutes.find((s) => s.session === l.agent) : undefined
      if (r && name && r.name !== name) {
        r.name = name
        changed = true
      }
    }
    return changed
  }

  /** A session seen running that left (agent quit, pane closed) frees its topic unless its link is kept. */
  private dropEnded(links: TelegramPaneLink[], before: Map<string, string>): boolean {
    const now = new Set(links.flatMap((l) => (l.terminal ? [l.agent] : [])))
    const gone = new Set([...before.values()].filter((a) => !now.has(a)))
    const ended = this.data.sessionRoutes.filter((r) => gone.has(r.session) && !r.keep)
    for (const r of ended) this.unlinkEnded(r, 'ended')
    return ended.length > 0
  }

  private unlinkEnded(r: TelegramSessionRoute, why: 'ended' | 'cleared', next?: TelegramPaneLink): void {
    this.data.sessionRoutes = this.data.sessionRoutes.filter((x) => x !== r)
    this.releasePin(r)
    this.endedTopics.set(topicKey(r), r.project)
    void this.noticeUnlinked(r, why, next)
  }

  /** One silent line in the topic, so the owner sees why it stopped answering and can relink with a tap. */
  private async noticeUnlinked(r: TelegramSessionRoute, why: 'ended' | 'cleared', next?: TelegramPaneLink): Promise<void> {
    if (!this.data.enabled || !this.token() || !this.take(r.chatId)) return
    const locale = this.deps.locale()
    const m = MORE_TEXT[locale]
    const base = { terminalId: '', chatId: r.chatId, threadId: r.threadId }
    const rows: [ActionKind, string, string][][] = []
    if (this.receiving) {
      if (why === 'ended') {
        rows.push([['rs', this.addAction({ kind: 'rs', ...base, project: r.project, cwd: r.project, name: r.name, extra: r.session }), r.name]])
        rows.push(...this.linkRows(r, true).filter((row) => row[0]![0] === 'lk'))
      } else if (next) {
        const cwd = next.cwd ?? r.project
        rows.push([['lk', this.addAction({ kind: 'lk', ...base, project: cwd, cwd, name: next.name ?? r.name, extra: next.agent }), next.name ?? r.name]])
      }
    }
    await this.post(r, why === 'ended' ? m.ended(r.name) : m.cleared(r.name), { disable_notification: true, ...(rows.length ? { reply_markup: markup(locale, rows) } : {}) })
  }

  private sessionRouteOf(agent: string | undefined): TelegramRoute | null {
    const s = agent ? this.data.sessionRoutes.find((r) => r.session === agent) : undefined
    return s ? { project: s.project, label: s.name, chatId: s.chatId, threadId: s.threadId } : null
  }

  removeRoute(project: string): TelegramSetResult {
    const norm = this.normProject(project)
    if (!norm) return { ok: false, error: 'invalid-project' }
    const key = (p: string) => (this.deps.platform === 'win32' ? p.toLowerCase() : p)
    const gone = this.data.routes.filter((r) => key(r.project) === key(norm))
    this.data.routes = this.data.routes.filter((r) => key(r.project) !== key(norm))
    for (const r of gone) this.releasePin(r)
    return this.commit()
  }

  /** Call after the route is gone from `data`: the pin stays while another route still reports into the topic. */
  private releasePin(r: { chatId: string; threadId: number | null }): void {
    const key = topicKey(r)
    if (this.routed(key)) return
    this.pinText.delete(key)
    this.pinAt.delete(key)
    const pin = this.data.pins[key]
    if (!pin) return
    const rest = { ...this.data.pins }
    delete rest[key]
    this.data.pins = rest
    if (this.token()) void this.call('unpinChatMessage', { chat_id: pin.chatId, message_id: pin.messageId })
  }

  routeFor(cwd: string): TelegramRoute | null {
    let best: TelegramRoute | null = null
    for (const r of this.data.routes) if (isInsideOrSame(r.project, cwd, this.deps.platform) && (!best || r.project.length > best.project.length)) best = r
    return best
  }

  topicName(r: { chatId: string; threadId: number | null }): string {
    const known = this.data.known[r.chatId]
    const topic = r.threadId ? known?.topics[String(r.threadId)] ?? `#${r.threadId}` : 'General'
    return `${known?.title ?? r.chatId} › ${topic}`
  }

  private async whoAmI(): Promise<{ ok: true; bot: string; id: number } | { ok: false; error: TelegramError }> {
    const me = await this.call('getMe', null)
    if (!me.ok) return this.failed(me.error)
    const r = me.result as { id?: unknown; username?: unknown }
    if (typeof r?.id !== 'number' || typeof r.username !== 'string') return this.failed('status')
    this.botId = r.id
    if (this.data.bot !== r.username) {
      this.data.bot = r.username.slice(0, 64)
      this.commit()
    }
    return { ok: true, bot: r.username, id: r.id }
  }

  async test(project?: string, session?: string): Promise<TelegramTestResult> {
    if (!this.token()) return { ok: false, error: 'config' }
    const me = await this.whoAmI()
    if (!me.ok) return me
    const route = session ? this.sessionRouteOf(session.toLowerCase()) : project ? this.routeFor(project) : this.data.routes[0]
    if (route) {
      const error = await this.sendText(route, testHtml(this.deps.locale()))
      if (error) return { ok: false, error }
    }
    this.ok()
    return { ok: true, bot: me.bot }
  }

  /** `cached`: the groups and topics of the last scan, with no Telegram call, so pickers fill at once. */
  async discover(cached = false): Promise<TelegramDiscoverResult> {
    if (!this.token()) return { ok: false, error: 'config' }
    if (cached) {
      const seen: ScanSeen = { chats: new Map(), topics: new Map() }
      const rights = new Map<string, { botAdmin: boolean; canManageTopics: boolean }>()
      for (const [id, k] of Object.entries(this.data.known)) {
        seen.chats.set(id, { title: k.title, isForum: k.isForum })
        seen.topics.set(id, new Map(Object.entries(k.topics).map(([t, n]) => [Number(t), n])))
        rights.set(id, { botAdmin: !!k.botAdmin, canManageTopics: !!k.canManageTopics })
      }
      return { ok: true, chats: chatsFrom(seen, rights) }
    }
    const me = await this.whoAmI()
    if (!me.ok) return me
    const seen: ScanSeen = { chats: new Map(), topics: new Map() }
    for (const [id, k] of Object.entries(this.data.known)) {
      seen.chats.set(id, { title: k.title, isForum: k.isForum })
      seen.topics.set(id, new Map(Object.entries(k.topics).map(([t, n]) => [Number(t), n])))
    }
    for (const r of this.data.routes) if (!seen.chats.has(r.chatId)) seen.chats.set(r.chatId, { title: r.chatId, isForum: r.threadId !== null })
    if (this.pollRun && this.pollSeen) {
      for (const [id, c] of this.pollSeen.chats) seen.chats.set(id, c)
      for (const [id, t] of this.pollSeen.topics) seen.topics.set(id, new Map([...(seen.topics.get(id) ?? new Map<number, string>()), ...t]))
    } else {
      const updates = await this.call('getUpdates', { limit: 100, timeout: 0, allowed_updates: ['message', 'edited_message', 'my_chat_member'] })
      if (!updates.ok) return this.failed(updates.error)
      scanUpdates(updates.result, seen)
    }
    await this.scanAsUser(seen)
    const rights = new Map<string, { botAdmin: boolean; canManageTopics: boolean; title?: string; isForum?: boolean }>()
    for (const chatId of [...seen.chats.keys()]) {
      const chat = await this.call('getChat', { chat_id: chatId })
      if (!chat.ok) {
        if (chat.error === 'chat') {
          seen.chats.delete(chatId)
          continue
        }
        return this.failed(chat.error)
      }
      const c = chat.result as { title?: unknown; is_forum?: unknown }
      const member = await this.call('getChatMember', { chat_id: chatId, user_id: me.id })
      const m = (member.ok ? member.result : {}) as { status?: unknown; can_manage_topics?: unknown }
      const admin = m.status === 'administrator' || m.status === 'creator'
      rights.set(chatId, {
        botAdmin: admin,
        canManageTopics: m.status === 'creator' || (admin && m.can_manage_topics === true),
        ...(typeof c.title === 'string' ? { title: c.title.slice(0, 120) } : {}),
        isForum: c.is_forum === true,
      })
    }
    const chats = chatsFrom(seen, rights)
    this.remember(chats)
    this.ok()
    return { ok: true, chats }
  }

  private learn(seen: ScanSeen): void {
    let changed = false
    for (const [id, c] of seen.chats) {
      const old = this.data.known[id]
      if (!old && Object.keys(this.data.known).length >= 50) continue
      const k = old ?? { title: c.title, isForum: c.isForum, topics: {} }
      if (!old || (c.title !== id && k.title !== c.title)) changed = true
      if (c.title !== id) k.title = c.title
      for (const [t, n] of seen.topics.get(id) ?? []) {
        if (k.topics[String(t)] === n || Object.keys(k.topics).length >= KNOWN_TOPICS_MAX) continue
        k.topics[String(t)] = n
        changed = true
      }
      this.data.known[id] = k
    }
    if (changed && this.save()) this.deps.onState?.(this.state())
  }

  private remember(chats: TelegramChat[]): void {
    const known: Record<string, KnownChat> = {}
    for (const c of chats.slice(0, 50))
      known[c.chatId] = { title: c.title, isForum: c.isForum, topics: Object.fromEntries(c.topics.slice(0, KNOWN_TOPICS_MAX).map((t) => [String(t.threadId), t.name])), botAdmin: c.botAdmin, canManageTopics: c.canManageTopics }
    this.data.known = known
    this.save()
  }

  async createTopic(input: TelegramCreateTopicInput): Promise<TelegramCreateTopicResult> {
    const project = this.normProject(input.project)
    if (!project) return { ok: false, error: 'invalid-project' }
    const res = await this.call('createForumTopic', { chat_id: input.chatId, name: input.name })
    if (!res.ok) return res.error === 'chat' ? { ok: false, error: 'no-rights' } : this.failed(res.error)
    const r = res.result as { message_thread_id?: unknown; name?: unknown }
    if (!isThreadId(r?.message_thread_id)) return { ok: false, error: 'status' }
    const topic = { threadId: r.message_thread_id, name: typeof r.name === 'string' ? r.name.slice(0, 128) : input.name }
    const k = this.data.known[input.chatId] ?? { title: input.chatId, isForum: true, topics: {} }
    k.topics[String(topic.threadId)] = topic.name
    this.data.known[input.chatId] = k
    const set = this.setRoute({ project, chatId: input.chatId, threadId: topic.threadId, label: path.basename(project) })
    if (!set.ok) return { ok: false, error: set.error === 'invalid-project' ? 'invalid-project' : 'status' }
    return { ok: true, state: set.state, topic }
  }

  async handle(e: TelegramEpisodeMessage): Promise<boolean> {
    const counted = this.routeFor(e.cwd)
    if (e.reason === 'done' && e.reply) {
      this.lastReplies.set(e.terminalId, { name: e.name, reply: e.reply })
      if (this.lastReplies.size > 200) this.lastReplies.delete(this.lastReplies.keys().next().value as string)
    }
    if (counted && !this.sent.has(`c:${e.episode}`)) {
      this.sent.add(`c:${e.episode}`)
      const c = this.countsFor(counted.project)
      if (e.reason === 'done') {
        c.done++
        c.workedMs += e.worked ?? 0
      } else if (e.reason === 'permission') c.permissions++
      else c.waits++
    }
    if (!this.data.enabled || this.sent.has(e.episode)) return false
    if (e.reason !== 'done' && !this.data.waiting) return false
    if (e.reason === 'done' && (e.worked ?? 0) < this.data.doneMinutes * 60_000) return false
    if (this.quietNow()) return false
    const route = this.sessionRouteOf(this.agentOfTerminal.get(e.terminalId)) ?? counted
    if (!route) return false
    if (e.reason === 'done') {
      const reported = this.reportedAt.get(route.project)
      if (reported !== undefined && reported >= this.now - (e.worked ?? 0)) return false
    }
    this.sent.add(e.episode)
    if (this.sent.size > MAX_EPISODES) this.sent.delete(this.sent.values().next().value as string)
    const locale = this.deps.locale()
    let keys: Markup | undefined
    if (this.receiving) {
      const entry = { terminalId: e.terminalId, project: route.project, cwd: e.cwd, name: e.name, chatId: route.chatId, threadId: route.threadId, ...(e.since !== undefined ? { since: e.since } : {}), ...(e.tool ? { tool: e.tool } : {}) }
      const k = (kind: ActionKind) => this.addAction({ kind, ...entry })
      type Row = ([ActionKind, string] | [ActionKind, string, string])[]
      const tail = (): [ActionKind, string, string] => ['tl', this.addAction({ kind: 'tl', ...entry, extra: String(WAITING_TAIL_LINES) }), TAIL_BUTTON[locale]]
      const escTail: Row = e.since !== undefined ? [['es', k('es')], tail()] : [tail()]
      if (e.reason === 'done') keys = markup(locale, [[['go', k('go')], ['ts', k('ts')], ['df', k('df')]]])
      else if (e.reason === 'question') {
        const ask = e.ask
        const rows: Row[] = []
        if (ask && !ask.multi && !ask.more && e.since !== undefined)
          for (const [i, o] of ask.options.entries()) {
            const label = clean(o, this.masker)
            rows.push([['qa', this.addAction({ kind: 'qa', ...entry, extra: String(i + 1), label }), `${i + 1} · ${label}`]])
          }
        keys = markup(locale, [...rows, escTail])
      } else if (e.reason === 'permission') {
        const rows: Row[] = e.since !== undefined ? [[['ap', k('ap')], ['dn', k('dn')]]] : []
        keys = markup(locale, [...rows, escTail])
        if (e.since !== undefined && e.tool === 'ExitPlanMode') {
          const [approve, deny] = keys.inline_keyboard[0]!
          approve!.text = PLAN_LABELS[locale].ap
          deny!.text = PLAN_LABELS[locale].dn
        }
      } else keys = markup(locale, [escTail])
    }
    const target: TelegramTarget = { kind: 'terminal', terminalId: e.terminalId }
    if (e.reason === 'done' && this.data.digest) return this.digestDone(route, e, locale, target, keys)
    return (await this.sendText(route, episodeHtml(e, locale, this.masker, this.data.includeReply), target, keys, e.reason !== 'done')) === null
  }

  private async digestDone(route: TelegramRoute, e: TelegramEpisodeMessage, locale: TelegramLocale, target: TelegramTarget, keys: Markup | undefined): Promise<boolean> {
    const key = this.agentOfTerminal.get(e.terminalId) ?? e.terminalId
    const at = new Date(this.now)
    const day = dayKey(at)
    const prev = this.digestMsgs.get(key)
    if (prev && prev.day === day && prev.chatId === route.chatId) {
      const n = prev.n + 1
      const hhmm = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
      const edit = await this.call('editMessageText', {
        chat_id: route.chatId,
        message_id: prev.messageId,
        text: digestHtml(e, locale, this.masker, this.data.includeReply, n, hhmm),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: keys ?? { inline_keyboard: [] },
      })
      if (edit.ok) {
        this.ok()
        prev.n = n
        this.track(route.chatId, { message_id: prev.messageId }, target)
        return true
      }
    }
    const sent = await this.sendTextId(route, episodeHtml(e, locale, this.masker, this.data.includeReply), target, keys, false)
    if (sent.id !== null) {
      this.digestMsgs.set(key, { chatId: route.chatId, messageId: sent.id, day, n: 1 })
      if (this.digestMsgs.size > SENT_MAP_MAX) this.digestMsgs.delete(this.digestMsgs.keys().next().value as string)
    } else this.digestMsgs.delete(key)
    return sent.error === null
  }

  async report(cwd: string, text: string, file?: string, sessionId?: string): Promise<SendOutcome> {
    const target: TelegramTarget | undefined = sessionId ? { kind: 'pane', sessionId } : undefined
    if (!this.data.enabled) return { ok: false, error: 'telegram-off' }
    if (!this.token()) return { ok: false, error: 'telegram-config' }
    const route = this.sessionRouteOf(sessionId ? this.agentOfPane.get(sessionId) : undefined) ?? this.routeFor(cwd)
    if (!route) return { ok: false, error: 'no-topic' }
    const name = route.label
    const locale = this.deps.locale()
    const topic = this.topicName(route)
    if (!file) {
      const error = await this.sendText(route, reportHtml(name, text, locale, this.masker), target)
      if (error) return { ok: false, error }
      this.reportedAt.set(route.project, this.now)
      return { ok: true, topic }
    }
    if (!isInsideOrSame(cwd, file, this.deps.platform)) return { ok: false, error: 'outside' }
    const base = path.basename(file)
    if (isSecretFileName(base)) return { ok: false, error: 'secret' }
    const stat = await fsp.stat(file).catch(() => null)
    if (!stat?.isFile()) return { ok: false, error: 'missing' }
    const rel = path.relative(cwd, file) || base
    if (stat.size > TELEGRAM_FILE_MAX && stat.size <= TELEGRAM_BIG_FILE_MAX) {
      const big = this.bigUpload(route, file, base, stat.size, rel, reportHtml(name, text, locale, this.masker, CAPTION_MAX), target)
      if (big) {
        const sent = await this.sendTextId(route, bigUploadingHtml(locale, rel, stat.size, this.masker), target)
        if (sent.error) return { ok: false, error: sent.error }
        void big(sent.id)
        this.reportedAt.set(route.project, this.now)
        return { ok: true, topic, file: rel, uploading: true }
      }
    }
    if (stat.size > TELEGRAM_FILE_MAX) {
      const error = await this.sendText(route, `${reportHtml(name, text, locale, this.masker, 3500)}\n${bigFileHtml(locale, rel, stat.size, this.masker)}`, target)
      if (error) return { ok: false, error }
      this.reportedAt.set(route.project, this.now)
      return { ok: true, topic, file: rel, linkOnly: true }
    }
    if (!this.take(route.chatId)) return { ok: false, error: this.fail('rate') }
    const buf = await (this.deps.readFile ?? fsp.readFile)(file).catch(() => null)
    if (!buf) return { ok: false, error: 'missing' }
    const form = new FormData()
    for (const [k, v] of Object.entries(threadFields(route.chatId, route.threadId))) form.append(k, String(v))
    form.append('caption', reportHtml(name, text, locale, this.masker, CAPTION_MAX))
    form.append('parse_mode', 'HTML')
    form.append('document', new Blob([new Uint8Array(buf)]), base)
    const res = await this.call('sendDocument', form, UPLOAD_TIMEOUT_MS)
    if (!res.ok) return { ok: false, error: this.fail(res.error) }
    this.ok()
    this.track(route.chatId, res.result, target)
    this.reportedAt.set(route.project, this.now)
    return { ok: true, topic, file: rel }
  }

  private userKeys(): UserScanKeys | null {
    const apiHash = this.sealed(this.data.apiHash)
    return apiHash && this.data.apiId ? { apiId: this.data.apiId, apiHash } : null
  }

  private dropUser(): void {
    this.data.userSession = undefined
    this.data.userName = undefined
  }

  /** The signed-in account lists every topic of its forum groups; groups the bot is not in drop out at the rights check. */
  private async scanAsUser(seen: ScanSeen): Promise<void> {
    const scanner = this.deps.userScanner
    const keys = this.userKeys()
    const session = this.sealed(this.data.userSession)
    if (!scanner || !keys || !session) return
    const res = await scanner.topics(keys, session)
    if (!res.ok) {
      if (res.error === 'auth') {
        this.dropUser()
        this.save()
      }
      return
    }
    for (const c of res.chats) {
      seen.chats.set(c.chatId, { title: c.title || seen.chats.get(c.chatId)?.title || c.chatId, isForum: true })
      seen.topics.set(c.chatId, new Map(c.topics.map((t) => [t.threadId, t.name])))
    }
  }

  async user(input: TelegramUserInput): Promise<TelegramUserResult> {
    const scanner = this.deps.userScanner
    if (!scanner) return { ok: false, error: 'failed' }
    if (input.action === 'logout') {
      const keys = this.userKeys()
      const session = this.sealed(this.data.userSession)
      this.dropUser()
      const result = this.commit(false)
      if (keys && session) await scanner.logout(keys, session)
      return result.ok ? { ok: true, state: result.state } : { ok: false, error: 'failed' }
    }
    const keys = this.userKeys()
    if (!keys) return { ok: false, error: 'keys' }
    if (!this.deps.crypt.available()) return { ok: false, error: 'keychain' }
    const res = input.action === 'code' ? await scanner.sendCode(keys, input.phone) : input.action === 'signin' ? await scanner.signIn(input.code) : await scanner.password(input.password)
    if (!res.ok) return res
    if ('next' in res) return { ok: true, state: this.state(), next: res.next }
    this.data.userSession = this.deps.crypt.encrypt(res.session).toString('base64')
    this.data.userName = res.name
    const result = this.commit(false)
    return result.ok ? { ok: true, state: result.state } : { ok: false, error: 'failed' }
  }

  private mtCreds(): BigUploadCreds | null {
    const token = this.token()
    const apiHash = this.sealed(this.data.apiHash)
    const apiId = this.data.apiId
    if (!token || !apiHash || !apiId) return null
    return {
      apiId,
      apiHash,
      token,
      session: this.sealed(this.data.mtSession),
      onSession: (session: string | null) => {
        this.data.mtSession = session && this.deps.crypt.available() ? this.deps.crypt.encrypt(session).toString('base64') : undefined
        this.save()
      },
    }
  }

  private bigUpload(route: TelegramRoute, file: string, name: string, size: number, rel: string, caption: string, target: TelegramTarget | undefined): ((statusId: number | null) => Promise<void>) | null {
    const uploader = this.deps.bigUploader
    const creds = this.mtCreds()
    if (!this.data.bigFiles || !uploader || !creds) return null
    return async (statusId) => {
      const locale = this.deps.locale()
      const status = (html: string) => (statusId === null ? Promise.resolve() : this.call('editMessageText', { chat_id: route.chatId, message_id: statusId, text: html, parse_mode: 'HTML' }).then(() => undefined))
      let editedAt = this.now
      let shown = 0
      let editing: Promise<void> = Promise.resolve()
      const onProgress = (fraction: number) => {
        const pct = Math.floor(Math.min(1, Math.max(0, fraction)) * 100)
        if (pct <= shown || pct >= 100 || this.now - editedAt < PROGRESS_EDIT_MS) return
        shown = pct
        editedAt = this.now
        editing = editing.then(() => status(bigUploadingHtml(locale, rel, size, this.masker, pct)))
      }
      const res = await uploader.upload({ chatId: route.chatId, threadId: route.threadId, file, name, size, caption, onProgress }, creds).catch(() => ({ ok: false as const, error: 'failed' as const }))
      await editing
      if (res.ok) {
        this.ok()
        this.health.lastSentAt = this.now
        this.health.sentToday++
        await status(bigDoneHtml(locale, rel, size, this.masker))
        return
      }
      this.health.errorsToday++
      const failed = bigFailedHtml(locale, rel, res.error, this.masker)
      await status(failed)
      await this.sendText(route, failed, target)
    }
  }

  private take(chatId: string): boolean {
    let lim = this.perChat.get(chatId)
    if (!lim) {
      lim = new RateLimiter(TELEGRAM_PER_CHAT_MIN, 60_000, this.deps.now ?? Date.now)
      this.perChat.set(chatId, lim)
    }
    return lim.take() && this.total.take()
  }

  private track(chatId: string, result: unknown, target: TelegramTarget | undefined): void {
    const id = (result as { message_id?: unknown } | null)?.message_id
    if (target && typeof id === 'number') this.rememberSent(chatId, id, target)
  }

  private async sendText(route: TelegramRoute, html: string, target?: TelegramTarget, keys?: Markup, important?: boolean): Promise<TelegramError | null> {
    return (await this.sendTextId(route, html, target, keys, important)).error
  }

  /** A message with buttons, or one that says a session needs the owner, counts as important when the chat's queue overflows. */
  private async sendTextId(route: TelegramRoute, html: string, target?: TelegramTarget, keys?: Markup, important = !!keys): Promise<{ error: TelegramError | null; id: number | null }> {
    const item: HeldSend = { route, html, important, ...(target ? { target } : {}), ...(keys ? { keys } : {}) }
    if (this.holdLeft(route.chatId) > 0) return this.enqueue(item)
    if (!this.take(route.chatId)) return { error: this.fail('rate'), id: null }
    const out = await this.deliver(item)
    return out.held ? this.enqueue(item) : out
  }

  private async deliver(item: HeldSend): Promise<{ error: TelegramError | null; id: number | null; held?: true }> {
    const { route, html, target, keys } = item
    const res = await this.call('sendMessage', { ...threadFields(route.chatId, route.threadId), text: html, parse_mode: 'HTML', disable_web_page_preview: true, ...(keys ? { reply_markup: keys } : {}) })
    if (!res.ok) {
      if (res.error === 'rate' && this.holdLeft(route.chatId) > 0) return { error: null, id: null, held: true }
      if (res.error === 'chat') this.markTopic(route, true)
      return { error: this.fail(res.error), id: null }
    }
    this.markTopic(route, false)
    this.ok()
    this.track(route.chatId, res.result, target)
    const id = (res.result as { message_id?: unknown } | null)?.message_id
    return { error: null, id: typeof id === 'number' ? id : null }
  }

  /** Over 20 waiting messages the oldest ordinary one goes first; an important one only when nothing else is left to drop. */
  private enqueue(item: HeldSend): { error: null; id: null } {
    const list = this.held.get(item.route.chatId) ?? []
    if (list.length >= HELD_MAX) {
      const at = list.findIndex((h) => !h.important)
      list.splice(at < 0 ? 0 : at, 1)
    }
    list.push(item)
    this.held.set(item.route.chatId, list)
    this.armHeld(item.route.chatId)
    return { error: null, id: null }
  }

  private armHeld(chatId: string, retryMs = 10_000): void {
    if (this.heldTimers.has(chatId)) return
    const left = this.holdLeft(chatId)
    const timer = setTimeout(() => {
      this.heldTimers.delete(chatId)
      void this.flushHeld()
    }, left > 0 ? left + 200 : retryMs)
    timer.unref?.()
    this.heldTimers.set(chatId, timer)
  }

  /** Sends what waited out a 429, oldest first; stops at the next 429 or when the per-chat rate limit is used up. */
  async flushHeld(): Promise<void> {
    if (this.flushing || !this.data.enabled || !this.token()) return
    this.flushing = true
    try {
      for (const [chatId, list] of [...this.held]) {
        while (list.length && this.holdLeft(chatId) === 0 && this.take(chatId)) {
          const item = list.shift()!
          const out = await this.deliver(item)
          if (out.held) {
            list.unshift(item)
            break
          }
        }
        if (list.length) this.armHeld(chatId)
        else this.held.delete(chatId)
      }
    } finally {
      this.flushing = false
    }
  }

  private ok(): void {
    if (!this.lastError) return
    this.lastError = null
    this.deps.onState?.(this.state())
  }

  private fail(error: TelegramError): TelegramError {
    const first = this.lastError === null
    this.lastError = error
    if (first) {
      this.deps.onFailure?.(error)
      this.deps.onState?.(this.state())
    }
    return error
  }

  private failed(error: TelegramError): { ok: false; error: TelegramError } {
    return { ok: false, error: this.fail(error) }
  }

  private save(): boolean {
    const file = this.deps.file
    if (!file) return true
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      const tmp = `${file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 })
      renameSync(tmp, file)
      return true
    } catch {
      return false
    }
  }
}
