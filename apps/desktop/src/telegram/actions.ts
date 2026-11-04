import { escapeHtml, type TelegramLocale } from './api'

export type ActionKind = 'ap' | 'dn' | 'go' | 'ts' | 'df' | 'st' | 'rs' | 'rn' | 'nw' | 'np' | 'lt' | 'lk' | 'lp'

export interface ActionEntry {
  kind: ActionKind
  terminalId: string
  project: string
  cwd: string
  name: string
  chatId: string
  threadId: number | null
  messageId?: number
  extra?: string
  label?: string
  since?: number
  tool?: string
}

export interface Button {
  text: string
  callback_data: string
}

export type Markup = { inline_keyboard: Button[][] }

export const ACTION_RE = /^(ap|dn|go|ts|df|st|rs|rn|nw|np|lt|lk|lp):([A-Za-z0-9]{6,16})$/

export const LABELS: Record<TelegramLocale, Record<ActionKind, string>> = {
  en: { ap: '✅ Allow', dn: '❌ Deny', go: '▶️ Continue', ts: '🧪 Run tests', df: '📄 Show diff', st: '⏹ Stop', rs: '↩️', rn: '▶️', nw: '➕ New session', np: '📨', lt: '💬', lk: '🔗', lp: '📁' },
  vi: { ap: '✅ Cho phép', dn: '❌ Từ chối', go: '▶️ Tiếp tục', ts: '🧪 Chạy test', df: '📄 Xem diff', st: '⏹ Dừng', rs: '↩️', rn: '▶️', nw: '➕ Mở session mới', np: '📨', lt: '💬', lk: '🔗', lp: '📁' },
}

export const MORE_TEXT: Record<TelegramLocale, {
  opened: (name: string) => string
  newPick: (count: number, prompt: boolean) => string
  resumeNone: string
  resumePick: string
  resumed: (name: string) => string
  runNone: string
  runPick: string
  runNoMatch: (name: string) => string
  runStarted: (config: string) => string
  runFail: (code: string) => string
  runShot: (config: string, device: string) => string
  allSent: (names: string[]) => string
  allNone: string
  lastNone: string
  pick: (count: number, what: 'send' | 'stop' | 'last') => string
  linkPick: string
  linked: (name: string) => string
  last: (name: string) => string
  pinHead: (name: string) => string
  pinEmpty: string
  pinLine: (name: string, status: string, tool: string | undefined, minutes: number | null) => string
}> = {
  en: {
    opened: (n) => `🆕 Opened a new Claude session in <b>${escapeHtml(n)}</b>.`,
    resumeNone: 'No ended session of this project to resume.',
    newPick: (c, p) => `This project already has ${c} open session${c > 1 ? 's' : ''}. ${p ? 'Open a new one, or send the prompt to one of them?' : 'Open another one?'}`,
    resumePick: 'Pick a session to resume:',
    resumed: (n) => `↩️ Resumed <b>${escapeHtml(n)}</b>.`,
    runNone: 'This project has no Run config that can be started from Telegram (shared or imported configs need a confirmation on the machine).',
    runPick: 'Pick a Run config:',
    runNoMatch: (n) => `No Run config named “${escapeHtml(n)}”.`,
    runStarted: (c) => `▶️ Starting <b>${escapeHtml(c)}</b>…`,
    runFail: (code) => `Could not start: ${escapeHtml(code)}`,
    runShot: (c, d) => `📱 <b>${escapeHtml(c)}</b> is running on ${escapeHtml(d)}`,
    allSent: (n) => `📨 Sent to ${n.map((x) => `<b>${escapeHtml(x)}</b>`).join(', ')}.`,
    allNone: 'No agent session of this project could take it (none open, or each has a message waiting).',
    lastNone: 'No finished reply of that session yet.',
    linkPick: 'This topic is not connected yet. Connect it to an open session (🔗) or a whole project (📁):',
    linked: (n) => `🔗 This topic is now connected to <b>${escapeHtml(n)}</b>. Tag me here to talk to it.`,
    pick: (c, w) => `This project has ${c} open sessions. ${w === 'send' ? 'Send to which one?' : w === 'stop' ? 'Stop which one?' : 'Last reply of which one?'}`,
    last: (n) => `💬 Last reply of <b>${escapeHtml(n)}</b>`,
    pinHead: (n) => `📌 <b>${escapeHtml(n)}</b>`,
    pinEmpty: 'No session open in Orrery.',
    pinLine: (n, s, t, m) => `• ${escapeHtml(n)} — ${escapeHtml(s)}${t ? ` · ${escapeHtml(t)}` : ''}${m !== null ? ` · ${m} min` : ''}`,
  },
  vi: {
    opened: (n) => `🆕 Đã mở session Claude mới ở <b>${escapeHtml(n)}</b>.`,
    resumeNone: 'Project này không có session đã kết thúc để mở lại.',
    newPick: (c, p) => `Project đang có ${c} session mở. ${p ? 'Mở session mới, hay gửi prompt vào session đang có?' : 'Vẫn mở thêm session mới?'}`,
    resumePick: 'Chọn session để mở lại:',
    resumed: (n) => `↩️ Đã mở lại <b>${escapeHtml(n)}</b>.`,
    runNone: 'Project này không có Run config chạy được từ Telegram (config chia sẻ / import cần xác nhận trên máy).',
    runPick: 'Chọn Run config:',
    runNoMatch: (n) => `Không có Run config tên “${escapeHtml(n)}”.`,
    runStarted: (c) => `▶️ Đang chạy <b>${escapeHtml(c)}</b>…`,
    runFail: (code) => `Không chạy được: ${escapeHtml(code)}`,
    runShot: (c, d) => `📱 <b>${escapeHtml(c)}</b> đang chạy trên ${escapeHtml(d)}`,
    allSent: (n) => `📨 Đã gửi vào ${n.map((x) => `<b>${escapeHtml(x)}</b>`).join(', ')}.`,
    allNone: 'Không session nào của project nhận được (chưa mở, hoặc đều đang có tin chờ gửi).',
    lastNone: 'Session này chưa có câu trả lời xong nào.',
    linkPick: 'Topic này chưa nối với gì. Nối với session đang mở (🔗) hoặc cả project (📁):',
    linked: (n) => `🔗 Đã nối topic này với <b>${escapeHtml(n)}</b>. Tag bot ở đây để làm việc với nó.`,
    pick: (c, w) => `Project đang có ${c} session mở. ${w === 'send' ? 'Gửi vào session nào?' : w === 'stop' ? 'Dừng session nào?' : 'Xem câu trả lời cuối của session nào?'}`,
    last: (n) => `💬 Câu trả lời cuối của <b>${escapeHtml(n)}</b>`,
    pinHead: (n) => `📌 <b>${escapeHtml(n)}</b>`,
    pinEmpty: 'Không có session nào mở trong Orrery.',
    pinLine: (n, s, t, m) => `• ${escapeHtml(n)} — ${escapeHtml(s)}${t ? ` · ${escapeHtml(t)}` : ''}${m !== null ? ` · ${m} phút` : ''}`,
  },
}

export const PROMPTS: Record<TelegramLocale, { go: string; ts: string }> = {
  en: { go: 'Continue.', ts: 'Run the tests of this project and report the result.' },
  vi: { go: 'Tiếp tục.', ts: 'Chạy test của project và báo kết quả.' },
}

const VIA_TELEGRAM: Record<TelegramLocale, string> = {
  en: '(Sent from Telegram. When done, send the result with the telegram_send tool, attaching the file if one was asked for, e.g. a built APK.)',
  vi: '(Tin này gửi từ Telegram. Xong việc, gửi kết quả bằng tool telegram_send, kèm file nếu được yêu cầu, ví dụ APK đã build.)',
}

const ONLY_COMMANDS = /^(\/[\w:.-]+\s*)+$/
const RAW_COMMANDS = /^\/(compact|clear)(\s|$)/i

// Bare commands (/hand-off, /clear …) and /compact's own instructions are typed as is: the note would become their argument.
// A skill with a task ("/skill-a /skill-b build the login screen") keeps it, so the result still comes back.
export const viaTelegram = (text: string, locale: TelegramLocale): string =>
  text && !ONLY_COMMANDS.test(text.trim()) && !RAW_COMMANDS.test(text.trim()) ? `${text}\n\n${VIA_TELEGRAM[locale]}` : text

export const ACT_TEXT: Record<TelegramLocale, {
  notOwner: string
  expired: string
  approved: (name: string) => string
  denied: (name: string) => string
  stopAsk: (name: string) => string
  sessionClosed: (name: string) => string
  stopped: (name: string) => string
  state: string
  keysBusy: string
  screenNone: string
  screenFail: string
  screenCaption: (device: string) => string
  fileSaved: (name: string, file: string) => string
  fileTooBig: string
  fileFail: string
  filePrompt: (kind: string, file: string, caption: string) => string
  diffClean: string
  diffNotRepo: string
  diffFail: string
  diffCaption: (name: string, files: number) => string
  limit: string
  disk: (label: string, free: string) => string
  runFailed: (config: string, code: string) => string
  summaryHead: (date: string) => string
  summaryLine: (name: string, s: DayCounts) => string
  summaryEmpty: string
}> = {
  en: {
    notOwner: 'Only the paired account can use these buttons.',
    expired: 'This button is no longer valid.',
    approved: (n) => `✅ Allowed in <b>${escapeHtml(n)}</b>.`,
    denied: (n) => `❌ Denied in <b>${escapeHtml(n)}</b>.`,
    stopAsk: (n) => `Stop the agent in <b>${escapeHtml(n)}</b>?`,
    sessionClosed: (n) => `Session <b>${escapeHtml(n)}</b> of this topic is not open in Orrery. Send <code>resume</code> to reopen it.`,
    stopped: (n) => `⏹ Sent Esc to <b>${escapeHtml(n)}</b>.`,
    state: 'That session is not in that state any more.',
    keysBusy: 'A previous button of that session is still being typed; try again in a moment.',
    screenNone: 'No Android device is connected to Orrery.',
    screenFail: 'Orrery could not take the screenshot.',
    screenCaption: (d) => `📱 ${escapeHtml(d)}`,
    fileSaved: (n, f) => `📥 Saved and sent to <b>${escapeHtml(n)}</b>: <code>${escapeHtml(f)}</code>`,
    fileTooBig: 'Telegram lets bots download files up to 20 MB only.',
    fileFail: 'Orrery could not save that file.',
    filePrompt: (k, f, c) => `The user sent a ${k} over Telegram, saved at ${f}.${c ? `\n${c}` : ''}`,
    diffClean: 'No uncommitted changes.',
    diffNotRepo: 'That project is not a git repository.',
    diffFail: 'Orrery could not build the diff.',
    diffCaption: (n, f) => `📄 <b>${escapeHtml(n)}</b>: ${f} file(s) changed`,
    limit: '⚠️ Claude usage limit is about to run out.',
    disk: (l, f) => `💾 Disk ${escapeHtml(l)} is almost full: ${escapeHtml(f)} left.`,
    runFailed: (c, code) => `❌ <b>${escapeHtml(c)}</b> failed: ${escapeHtml(code)}`,
    summaryHead: (d) => `📊 <b>Day summary ${escapeHtml(d)}</b>`,
    summaryLine: (n, s) => `• <b>${escapeHtml(n)}</b>: ${s.done} finished, ${Math.round(s.workedMs / 60_000)} min, ${s.waits} waits, ${s.permissions} approvals${s.runFails ? `, ${s.runFails} build failures` : ''}`,
    summaryEmpty: 'No session activity today.',
  },
  vi: {
    notOwner: 'Chỉ tài khoản đã ghép mới dùng được các nút này.',
    expired: 'Nút này không còn hiệu lực.',
    approved: (n) => `✅ Đã cho phép ở <b>${escapeHtml(n)}</b>.`,
    denied: (n) => `❌ Đã từ chối ở <b>${escapeHtml(n)}</b>.`,
    stopAsk: (n) => `Dừng agent ở <b>${escapeHtml(n)}</b>?`,
    sessionClosed: (n) => `Session <b>${escapeHtml(n)}</b> gắn với topic này chưa mở trong Orrery. Gõ <code>resume</code> để mở lại.`,
    stopped: (n) => `⏹ Đã gửi Esc vào <b>${escapeHtml(n)}</b>.`,
    state: 'Session đó không còn ở trạng thái này nữa.',
    keysBusy: 'Nút bấm trước của session đó còn đang được gõ, chủ nhân thử lại sau giây lát.',
    screenNone: 'Không có máy Android nào kết nối với Orrery.',
    screenFail: 'Orrery không chụp được màn hình.',
    screenCaption: (d) => `📱 ${escapeHtml(d)}`,
    fileSaved: (n, f) => `📥 Đã lưu và gửi vào <b>${escapeHtml(n)}</b>: <code>${escapeHtml(f)}</code>`,
    fileTooBig: 'Bot Telegram chỉ tải được file tối đa 20 MB.',
    fileFail: 'Orrery không lưu được file đó.',
    filePrompt: (k, f, c) => `Chủ nhân gửi ${k} qua Telegram, đã lưu ở ${f}.${c ? `\n${c}` : ''}`,
    diffClean: 'Không có thay đổi chưa commit.',
    diffNotRepo: 'Project này không phải git repo.',
    diffFail: 'Orrery không tạo được diff.',
    diffCaption: (n, f) => `📄 <b>${escapeHtml(n)}</b>: ${f} file thay đổi`,
    limit: '⚠️ Hạn mức Claude sắp hết.',
    disk: (l, f) => `💾 Ổ ${escapeHtml(l)} sắp đầy: còn ${escapeHtml(f)}.`,
    runFailed: (c, code) => `❌ <b>${escapeHtml(c)}</b> lỗi: ${escapeHtml(code)}`,
    summaryHead: (d) => `📊 <b>Tổng kết ngày ${escapeHtml(d)}</b>`,
    summaryLine: (n, s) => `• <b>${escapeHtml(n)}</b>: ${s.done} lần xong, ${Math.round(s.workedMs / 60_000)} phút, ${s.waits} lần chờ, ${s.permissions} lần xin quyền${s.runFails ? `, ${s.runFails} lần build lỗi` : ''}`,
    summaryEmpty: 'Hôm nay không có session nào chạy.',
  },
}

export const FILE_KIND: Record<TelegramLocale, Record<string, string>> = {
  en: { photo: 'a photo', voice: 'a voice message', audio: 'an audio file', video: 'a video', document: 'a file', album: 'several files' },
  vi: { photo: 'ảnh', voice: 'tin nhắn thoại', audio: 'file âm thanh', video: 'video', document: 'file', album: 'nhiều file' },
}

export function markup(locale: TelegramLocale, rows: ([ActionKind, string] | [ActionKind, string, string])[][]): Markup {
  return {
    inline_keyboard: rows.map((row) => row.map(([kind, key, text]) => ({ text: (text ? `${LABELS[locale][kind]} ${text}` : LABELS[locale][kind]).slice(0, 60), callback_data: `${kind}:${key}` }))),
  }
}

export interface DayCounts {
  done: number
  workedMs: number
  waits: number
  permissions: number
  runFails: number
}

export const emptyCounts = (): DayCounts => ({ done: 0, workedMs: 0, waits: 0, permissions: 0, runFails: 0 })

export const dayKey = (at: Date): string => `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`

export const minuteOfDay = (at: Date): number => at.getHours() * 60 + at.getMinutes()

export const hhmmMinute = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))

export function summaryHtml(locale: TelegramLocale, day: string, rows: { name: string; counts: DayCounts }[]): string {
  const t = ACT_TEXT[locale]
  const active = rows.filter((r) => r.counts.done || r.counts.waits || r.counts.permissions || r.counts.runFails)
  if (!active.length) return `${t.summaryHead(day)}\n${t.summaryEmpty}`
  return [t.summaryHead(day), ...active.map((r) => t.summaryLine(r.name, r.counts))].join('\n')
}
