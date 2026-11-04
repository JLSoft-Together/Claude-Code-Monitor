import { maskSecrets, TELEGRAM_TAIL_DEFAULT, TELEGRAM_TAIL_MAX, type TelegramInboundResult, type TelegramPaneInfo } from '@ccm/shared'
import { escapeHtml, type TelegramLocale } from './api'

export interface TgMessage {
  messageId: number
  chatId: string
  chatType: string
  threadId: number | null
  fromId: number
  fromName: string
  fromBot: boolean
  text: string
  replyTo: number | null
  replyToBot: boolean
  file?: TgFile
  /** Telegram `media_group_id`: every photo of an album arrives as its own update, only the first has the caption. */
  group?: string
  /** Send time in ms; only the backlog check after a restart reads it. */
  date?: number
}

export interface TgFile {
  fileId: string
  kind: 'photo' | 'voice' | 'audio' | 'document' | 'video'
  name: string
  size: number
}

const FILE_NAME_RE = /[^A-Za-z0-9._-]+/g

function fileOf(m: Record<string, unknown>): TgFile | undefined {
  const size = (o: Record<string, unknown>) => (typeof o.file_size === 'number' ? o.file_size : 0)
  if (Array.isArray(m.photo) && m.photo.length) {
    const best = m.photo.filter(isObj).sort((a, b) => size(b) - size(a))[0]
    if (best && typeof best.file_id === 'string') return { fileId: best.file_id, kind: 'photo', name: 'photo.jpg', size: size(best) }
  }
  for (const kind of ['voice', 'audio', 'video', 'document'] as const) {
    const o = m[kind]
    if (!isObj(o) || typeof o.file_id !== 'string') continue
    const ext = kind === 'voice' ? 'voice.ogg' : kind === 'video' ? 'video.mp4' : kind === 'audio' ? 'audio.mp3' : 'file.bin'
    const raw = typeof o.file_name === 'string' && o.file_name ? o.file_name : ext
    const name = raw.replace(FILE_NAME_RE, '_').replace(/^\.+/, '').slice(-80) || ext
    return { fileId: o.file_id, kind, name, size: size(o) }
  }
  return undefined
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export function readMessage(update: unknown, botId: number | null): TgMessage | null {
  if (!isObj(update) || !isObj(update.message)) return null
  const m = update.message
  const chat = isObj(m.chat) ? m.chat : null
  const from = isObj(m.from) ? m.from : null
  if (!chat || !from || typeof m.message_id !== 'number' || typeof chat.id !== 'number' || typeof from.id !== 'number') return null
  const text = typeof m.text === 'string' ? m.text : typeof m.caption === 'string' ? m.caption : ''
  const file = fileOf(m)
  if (!text && !file) return null
  const reply = isObj(m.reply_to_message) ? m.reply_to_message : null
  const replyFrom = reply && isObj(reply.from) ? reply.from : null
  const topicStart = reply && isObj(reply.forum_topic_created)
  const name = [from.first_name, from.last_name].filter((s) => typeof s === 'string' && s).join(' ') || (typeof from.username === 'string' ? from.username : String(from.id))
  return {
    messageId: m.message_id,
    chatId: String(chat.id),
    chatType: typeof chat.type === 'string' ? chat.type : '',
    threadId: m.is_topic_message === true && typeof m.message_thread_id === 'number' ? m.message_thread_id : null,
    fromId: from.id,
    fromName: name.slice(0, 80),
    fromBot: from.is_bot === true,
    text,
    replyTo: reply && !topicStart && typeof reply.message_id === 'number' ? reply.message_id : null,
    replyToBot: !!replyFrom && botId !== null && replyFrom.id === botId,
    ...(typeof m.date === 'number' && Number.isFinite(m.date) ? { date: m.date * 1000 } : {}),
    ...(file ? { file } : {}),
    ...(file && typeof m.media_group_id === 'string' && m.media_group_id.length < 64 ? { group: m.media_group_id } : {}),
  }
}

export type Command =
  | { kind: 'pair'; code: string }
  | { kind: 'status' }
  | { kind: 'help' }
  | { kind: 'stop' }
  | { kind: 'new'; text: string }
  | { kind: 'resume' }
  | { kind: 'run'; config: string }
  | { kind: 'all'; text: string }
  | { kind: 'last' }
  | { kind: 'tail'; lines: number }
  | { kind: 'screen'; serial?: string }
  | { kind: 'send'; text: string }
  | { kind: 'file'; file: TgFile; text: string; more?: TgFile[] }

export function commandOf(msg: TgMessage, bot: string): Command | null {
  const at = `@${bot}`.toLowerCase()
  const lower = msg.text.toLowerCase()
  // Picking from the "/" menu in a group with one bot sends `/status` without `@bot`; only the bot's own menu commands count as addressed.
  const menuCommand = /^\/([a-z]+)(\s|$)/.exec(lower)?.[1]
  const mentioned = lower.includes(at) || (!!menuCommand && COMMAND_MENU.en.some(([name]) => name === menuCommand))
  if (!mentioned && !msg.replyToBot && msg.chatType !== 'private') return null
  const stripped = msg.text
    .replace(new RegExp(`@${bot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), ' ')
    .replace(/^\s+|\s+$/g, '')
  const word = /^\/?([a-z]+)(?:\s+([\s\S]*))?$/i.exec(stripped)
  const head = word?.[1]?.toLowerCase()
  const rest = (word?.[2] ?? '').trim()
  if (head === 'pair' && /^\d{6}$/.test(rest)) return { kind: 'pair', code: rest }
  if ((head === 'status' || head === 'list') && !rest) return { kind: 'status' }
  if ((head === 'help' || head === 'start') && !rest && !msg.file) return { kind: 'help' }
  if (msg.chatType === 'private') return null
  if (msg.file) return { kind: 'file', file: msg.file, text: stripped }
  if (head === 'stop' && !rest) return { kind: 'stop' }
  if (head === 'new') return { kind: 'new', text: rest }
  if (head === 'resume' && !rest) return { kind: 'resume' }
  if (head === 'run') return { kind: 'run', config: rest.slice(0, 80) }
  if (head === 'all') return rest ? { kind: 'all', text: rest } : { kind: 'help' }
  if (head === 'last' && !rest) return { kind: 'last' }
  if (head === 'tail' && /^\d{0,4}$/.test(rest)) return { kind: 'tail', lines: Math.min(TELEGRAM_TAIL_MAX, Math.max(1, Number(rest) || TELEGRAM_TAIL_DEFAULT)) }
  if ((head === 'screen' || head === 'screenshot') && /^[A-Za-z0-9._:-]{0,80}$/.test(rest)) return { kind: 'screen', ...(rest ? { serial: rest } : {}) }
  return stripped ? { kind: 'send', text: stripped } : { kind: 'help' }
}

const STATUS_VI: Record<string, string> = { working: 'đang làm', idle: 'rảnh', waiting: 'đang chờ', stale: 'mất kết nối', unknown: 'không rõ' }

export const paneStatus = (status: string, locale: TelegramLocale): string => (locale === 'vi' ? (STATUS_VI[status] ?? status) : status)

const paneLine = (p: TelegramPaneInfo, locale: TelegramLocale): string => `• <b>${escapeHtml(p.name)}</b> — ${paneStatus(p.status, locale)}`

export const TEXT: Record<TelegramLocale, {
  paired: (name: string) => string
  stranger: (owner: string) => string
  readOnly: string
  help: (bot: string) => string
  noTopic: string
  rate: string
  sent: (name: string) => string
  queued: (name: string) => string
  none: string
  many: (lines: string) => string
  busy: (name: string) => string
  open: string
  gone: string
  unavailable: string
  status: (lines: string) => string
  statusEmpty: string
}> = {
  en: {
    paired: (n) => `🔗 Paired with ${escapeHtml(n)}. Only you can send to sessions now.`,
    stranger: (n) => `Sorry, I only answer my owner ${escapeHtml(n)}. Send more money to negotiate 🐮`,
    help: (b) => [
      `🤖 <b>Commands of @${escapeHtml(b)}</b>`,
      `Mention the bot in a project topic, then type. Example: <code>@${escapeHtml(b)} new write login tests</code>`,
      '',
      '💬 <b>Send work</b>',
      '<code>your message</code> — to the project\'s session',
      'reply to a bot report — to that exact session',
      '<code>all &lt;message&gt;</code> — to every session of the project',
      'photo / file with a caption mentioning the bot — saved into the project',
      '',
      '🧭 <b>Sessions</b>',
      '<code>status</code> — open sessions of the project',
      '<code>new [prompt]</code> — open a new Claude session',
      '<code>resume</code> — reopen a finished session',
      '<code>last</code> — last reply of the session',
      '<code>tail [lines]</code> — last lines of the session terminal (default 30, max 80)',
      '<code>stop</code> — stop the running work (Esc)',
      '',
      '📱 <b>App</b>',
      '<code>run [config]</code> — run the app with a Run config',
      '<code>screen [serial]</code> — screenshot of the Android device',
    ].join('\n'),
    noTopic: 'This topic is not assigned to a project in Orrery.',
    readOnly: 'You can only view here: status, last, tail, help.',
    rate: 'Too many messages in the last minute; wait a little.',
    sent: (n) => `📨 Sent to <b>${escapeHtml(n)}</b>.`,
    queued: (n) => `⏳ <b>${escapeHtml(n)}</b> is busy; the message is sent when it finishes.`,
    none: 'No session of this project is open in an Orrery Workspace pane (sessions in other terminals cannot be written to).',
    many: (l) => `Several sessions of this project are open; reply to a report of the one you mean:\n${l}`,
    busy: (n) => `<b>${escapeHtml(n)}</b> already has a message waiting to be sent.`,
    open: 'That session is already open (in an Orrery pane or another terminal).',
    gone: 'That session is not open in Orrery any more.',
    unavailable: 'Orrery is not ready (window closed?).',
    status: (l) => `Sessions of this project:\n${l}`,
    statusEmpty: 'No session of this project is open in Orrery.',
  },
  vi: {
    paired: (n) => `🔗 Đã ghép với ${escapeHtml(n)}. Từ giờ chỉ chủ nhân gửi được vào session.`,
    stranger: (n) => `Xin lỗi bạn, tôi chỉ trả lời chủ nhân ${escapeHtml(n)}, gửi thêm tiền để thương lượng 🐮`,
    help: (b) => [
      `🤖 <b>Lệnh của @${escapeHtml(b)}</b>`,
      `Tag bot trong topic của project rồi gõ lệnh. Ví dụ: <code>@${escapeHtml(b)} new viết test cho login</code>`,
      '',
      '💬 <b>Giao việc</b>',
      '<code>nội dung</code> — gửi vào session của project',
      'reply vào tin báo của bot — gửi đúng session đó',
      '<code>all &lt;nội dung&gt;</code> — gửi vào mọi session của project',
      'ảnh / file kèm caption tag bot — lưu vào project',
      '',
      '🧭 <b>Session</b>',
      '<code>status</code> — các session đang mở của project',
      '<code>new [prompt]</code> — mở session Claude mới',
      '<code>resume</code> — mở lại session đã kết thúc',
      '<code>last</code> — câu trả lời cuối của session',
      '<code>tail [số dòng]</code> — các dòng cuối của terminal session (mặc định 30, tối đa 80)',
      '<code>stop</code> — dừng việc đang chạy (Esc)',
      '',
      '📱 <b>App</b>',
      '<code>run [config]</code> — chạy app theo Run config',
      '<code>screen [serial]</code> — chụp màn hình máy Android',
    ].join('\n'),
    noTopic: 'Topic này chưa được gán project trong Orrery.',
    readOnly: 'Bạn chỉ có quyền xem: status, last, tail, help.',
    rate: 'Gửi nhanh quá, chủ nhân chờ chút nhé.',
    sent: (n) => `📨 Đã gửi vào <b>${escapeHtml(n)}</b>.`,
    queued: (n) => `⏳ <b>${escapeHtml(n)}</b> đang làm, xong việc sẽ gửi tiếp.`,
    none: 'Không có session nào của project này mở trong pane Workspace của Orrery (session ở terminal khác thì không gửi vào được).',
    many: (l) => `Project này có nhiều session, chủ nhân reply vào tin báo của session muốn gửi:\n${l}`,
    busy: (n) => `<b>${escapeHtml(n)}</b> đã có một tin đang chờ gửi.`,
    open: 'Session đó đang mở rồi (trong pane Orrery hoặc terminal khác).',
    gone: 'Session đó không còn mở trong Orrery.',
    unavailable: 'Orrery chưa sẵn sàng (cửa sổ đang đóng?).',
    status: (l) => `Các session của project:\n${l}`,
    statusEmpty: 'Không có session nào của project này mở trong Orrery.',
  },
}

export const COMMAND_MENU: Record<TelegramLocale, [string, string][]> = {
  en: [
    ['status', 'Open sessions of this project'],
    ['new', 'Open a new Claude session'],
    ['stop', 'Stop the running work (Esc)'],
    ['last', 'Last reply of the session'],
    ['tail', 'Last lines of the session terminal'],
    ['resume', 'Reopen a finished session'],
    ['run', 'Run the app with a Run config'],
    ['all', 'Send a message to every session'],
    ['screen', 'Screenshot of the Android device'],
    ['help', 'List the commands'],
  ],
  vi: [
    ['status', 'Các session đang mở của project'],
    ['new', 'Mở session Claude mới'],
    ['stop', 'Dừng việc đang chạy (Esc)'],
    ['last', 'Câu trả lời cuối của session'],
    ['tail', 'Các dòng cuối của terminal session'],
    ['resume', 'Mở lại session đã kết thúc'],
    ['run', 'Chạy app theo Run config'],
    ['all', 'Gửi tin vào mọi session'],
    ['screen', 'Chụp màn hình máy Android'],
    ['help', 'Danh sách lệnh'],
  ],
}

const TAIL_HTML_MAX = 3500
const TAIL_ESCAPED_MAX = 3900

const TAIL_TEXT: Record<TelegramLocale, { head: (name: string) => string; empty: string }> = {
  en: { head: (n) => `📜 Terminal of <b>${escapeHtml(n)}</b>`, empty: 'The terminal screen is empty.' },
  vi: { head: (n) => `📜 Terminal của <b>${escapeHtml(n)}</b>`, empty: 'Màn hình terminal đang trống.' },
}

/** Masks first (a secret cut in half would escape the masker), then keeps the end of the text and escapes it. */
export function tailHtml(name: string, text: string, locale: TelegramLocale, home: string, platform: string, token?: string | null): string {
  const t = TAIL_TEXT[locale]
  let raw = maskSecrets(token ? text.split(token).join('[masked]') : text, home, platform).replace(/\s+$/, '')
  if (!raw.trim()) return `${t.head(name)}\n${t.empty}`
  let cut = false
  if (raw.length > TAIL_HTML_MAX) {
    raw = raw.slice(-TAIL_HTML_MAX)
    cut = true
  }
  let html = escapeHtml(raw)
  while (html.length > TAIL_ESCAPED_MAX) {
    raw = raw.slice(Math.ceil((html.length - TAIL_ESCAPED_MAX) / 5) + 1)
    cut = true
    html = escapeHtml(raw)
  }
  if (cut && raw.includes('\n')) html = escapeHtml(raw.slice(raw.indexOf('\n') + 1))
  return `${t.head(name)}\n<pre>${html}</pre>`
}

export function resultHtml(res: TelegramInboundResult, locale: TelegramLocale): string {
  const t = TEXT[locale]
  if (res.ok) {
    if (res.action === 'tail') return TAIL_TEXT[locale].head(res.name)
    if (res.action === 'status') return res.panes.length ? t.status(res.panes.map((p) => paneLine(p, locale)).join('\n')) : t.statusEmpty
    if (res.action === 'send') return res.queued ? t.queued(res.name) : t.sent(res.name)
    if (res.action === 'all') return res.names.length ? t.sent(res.names.join(', ')) : t.none
    if (res.action === 'resumeList') return res.items.length ? t.status(res.items.map((i) => `• ${escapeHtml(i.name)}`).join('\n')) : t.statusEmpty
    return t.sent(res.name)
  }
  if (res.error === 'state') return t.gone
  if (res.error === 'many') return t.many((res.panes ?? []).map((p) => paneLine(p, locale)).join('\n'))
  if (res.error === 'busy') return res.panes?.[0] ? t.busy(res.panes[0].name) : t.open
  return t[res.error]
}
