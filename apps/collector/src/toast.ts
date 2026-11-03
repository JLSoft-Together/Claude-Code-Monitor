import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import {
  CONTEXT_THRESHOLDS,
  DEFAULT_IDLE_MINUTES,
  DEFAULT_QUIET,
  DEFAULT_STUCK_MINUTES,
  DEFAULT_TOAST_KINDS,
  TOAST_KINDS,
  errorLoops,
  formatGb,
  inQuietHours,
  quietFor,
  remindersDue,
  sanitizeIdle,
  sanitizeKinds,
  sanitizeQuiet,
  sanitizeStuck,
  type ActivityEvent,
  type BackgroundJob,
  type AgentNoteMessage,
  type DiskAlertMessage,
  type JobState,
  type NotifySettings,
  type PhoneEpisodeMessage,
  type PhoneReason,
  type PlanLimits,
  type QuietHours,
  type ResourceReport,
  type ServerRes,
  type TerminalSession,
  type TerminalStatus,
  waitReason,
  type ToastHealth,
  type ToastKind,
  type ToastState,
  type ToastTestResult,
} from '@ccm/shared'
import path from 'node:path'
import { JsonFile } from './json-file'
import { PsHost } from './ps-host'

export type ToastLocale = 'en' | 'vi'

export interface ToastContent {
  tag: string
  title: string
  body: string
  url: string
  open: string
  dismiss: string
  persistent: boolean
  snoozeUrl?: string
  snoozeLabel?: string
}

export interface ToastDeps {
  show: (content: ToastContent) => Promise<boolean>
  hide: (tag: string) => Promise<boolean>
  now: () => number
  health?: () => Promise<ToastHealth>
}

const APP_ID = String.raw`{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe`

// Request fields arrive as data (base64 JSON on stdin, see ps-host.ts), never inside the script text.
const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime]
$app = $env:CCM_TOAST_APP
function Esc([string]$v) { [System.Security.SecurityElement]::Escape($v) }
function Run($r) {
  if ($r.mode -eq 'health') {
    $g = (Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PushNotifications' -Name ToastEnabled -ErrorAction SilentlyContinue).ToastEnabled
    $a = (Get-ItemProperty -LiteralPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\$app" -Name Enabled -ErrorAction SilentlyContinue).Enabled
    if ($g -eq 0) { return 'globalOff' } elseif ($a -eq 0) { return 'appOff' } else { return 'ok' }
  }
  if ($r.mode -eq 'hide') {
    [Windows.UI.Notifications.ToastNotificationManager]::History.Remove([string]$r.tag, 'ccm', $app)
    return 'ok'
  }
  $url = Esc $r.url
  $snooze = if ($r.snoozeUrl) { "<action content='$(Esc $r.snoozeLabel)' arguments='$(Esc $r.snoozeUrl)' activationType='protocol'/>" } else { '' }
  $scenario = if ($r.persist -eq '1') { " scenario='reminder'" } else { '' }
  $xml = "<toast$scenario activationType='protocol' launch='$url'><visual><binding template='ToastGeneric'><text>$(Esc $r.title)</text><text>$(Esc $r.body)</text></binding></visual><actions><action content='$(Esc $r.open)' arguments='$url' activationType='protocol'/>$snooze<action content='$(Esc $r.dismiss)' arguments='dismiss' activationType='system'/></actions></toast>"
  $doc = [Windows.Data.Xml.Dom.XmlDocument]::new()
  $doc.LoadXml($xml)
  $toast = [Windows.UI.Notifications.ToastNotification]::new($doc)
  $toast.Tag = [string]$r.tag
  $toast.Group = 'ccm'
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show($toast)
  'ok'
}
$in = [Console]::In
while ($null -ne ($line = $in.ReadLine())) {
  $id = 0
  try {
    $r = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line)) | ConvertFrom-Json
    $id = [int]$r.id
    $res = Run $r
  } catch { $res = 'error' }
  [Console]::Out.WriteLine("$id$([char]9)$res")
  [Console]::Out.Flush()
}
`

let host: PsHost | null = null

function runPs(request: Record<string, string>): Promise<string | null> {
  if (process.platform !== 'win32') return Promise.resolve(null)
  host ??= new PsHost({ script: SCRIPT, env: { CCM_TOAST_APP: APP_ID } })
  return host.run(request)
}

const runScript = async (request: Record<string, string>): Promise<boolean> => (await runPs(request)) === 'ok'

export function showToast(c: ToastContent): Promise<boolean> {
  return runScript({
    mode: 'show',
    tag: c.tag,
    title: c.title,
    body: c.body,
    url: c.url,
    open: c.open,
    dismiss: c.dismiss,
    persist: c.persistent ? '1' : '0',
    snoozeUrl: c.snoozeUrl ?? '',
    snoozeLabel: c.snoozeLabel ?? '',
  })
}

export async function toastHealth(): Promise<ToastHealth> {
  const out = await runPs({ mode: 'health' })
  return out === 'ok' || out === 'globalOff' || out === 'appOff' ? out : 'unknown'
}

export function hideToast(tag: string): Promise<boolean> {
  return runScript({ mode: 'hide', tag })
}

export const defaultToastDeps: ToastDeps = { show: showToast, hide: hideToast, now: () => Date.now(), health: toastHealth }

interface Texts {
  waitingTitle: (name: string) => string
  waitingBody: (reason?: string, tool?: string) => string
  reminderTitle: (name: string, minutes: number) => string
  doneTitle: (name: string) => string
  doneBody: string
  jobTitle: (name: string) => string
  jobBody: string
  loopTitle: (name: string) => string
  loopBody: (n: number, tool: string) => string
  limitTitle: (pct: number) => string
  limitBody: (at: string) => string
  stuckTitle: (name: string) => string
  stuckBody: (minutes: number) => string
  contextTitle: (name: string, pct: number) => string
  contextBody: string
  idleTitle: (n: number, size: string) => string
  idleBody: (names: string) => string
  sensitiveTitle: (name: string) => string
  sensitiveBody: (rule: string, tool: string, path?: string) => string
  diskTitle: (label: string, free: string) => string
  diskBody: (danger: boolean) => string
  noteTitle: (name: string, done: boolean) => string
  noteMore: (n: number) => string
  testTitle: string
  testBody: string
  snooze: (minutes: number) => string
  open: string
  openDashboard: string
  dismiss: string
}

export const TEXT: Record<ToastLocale, Texts> = {
  en: {
    waitingTitle: (name) => `${name} needs you`,
    waitingBody: (reason, tool) => {
      const kind = waitReason(reason)
      if (kind === 'question') return 'Asking you'
      if (kind === 'permission') return tool === 'ExitPlanMode' ? 'Plan needs approval' : tool ? `Needs approval: ${tool}` : 'Needs approval'
      return reason ? `Waiting for ${reason}` : 'Claude is waiting for your input'
    },
    reminderTitle: (name, minutes) => `${name} still needs you (${minutes} min)`,
    doneTitle: (name) => `${name} finished`,
    doneBody: 'Claude finished replying',
    jobTitle: (name) => `Background job needs you: ${name}`,
    jobBody: 'Open it with claude agents to answer.',
    loopTitle: (name) => `${name} keeps failing`,
    loopBody: (n, tool) => `${tool} failed ${n} times in 5 minutes.`,
    limitTitle: (pct) => `5-hour limit at ${pct}%`,
    limitBody: (at) => `At this pace it runs out around ${at}, before the window resets.`,
    stuckTitle: (name) => `${name} has gone quiet`,
    stuckBody: (minutes) => `Working but no output for ${minutes} min.`,
    contextTitle: (name, pct) => `${name} context at ${pct}%`,
    contextBody: 'Run /compact before Claude compacts on its own.',
    idleTitle: (n, size) => (n === 1 ? `1 forgotten item uses ${size}` : `${n} forgotten items use ${size}`),
    idleBody: (names) => `${names}. Open Orrery to review and stop them.`,
    sensitiveTitle: (name) => `${name} touched something sensitive`,
    sensitiveBody: (rule, tool, path) => `${tool} · ${ruleLabel(rule, 'en')}${path ? ` · ${path}` : ''}`,
    diskTitle: (label, free) => `Drive ${label} almost full: ${free} left`,
    diskBody: (danger) => (danger ? 'Builds and agents may fail soon. Open Orrery to clean build output or agent data.' : 'Open Orrery to see what can be cleaned.'),
    noteTitle: (name, done) => (done ? `${name} reports done` : `${name} asks for your attention`),
    noteMore: (n) => ` (+${n} more)`,
    testTitle: 'Test notification',
    testBody: 'Windows notifications from Orrery work.',
    snooze: (minutes) => `Snooze ${minutes} min`,
    open: 'Open terminal',
    openDashboard: 'Open dashboard',
    dismiss: 'Dismiss',
  },
  vi: {
    waitingTitle: (name) => `${name} đang chờ chủ nhân`,
    waitingBody: (reason, tool) => {
      const kind = waitReason(reason)
      if (kind === 'question') return 'Đang hỏi bạn'
      if (kind === 'permission') return tool === 'ExitPlanMode' ? 'Cần duyệt plan' : tool ? `Cần duyệt: ${tool}` : 'Cần duyệt'
      return reason ? `Đang chờ ${reason}` : 'Claude đang chờ chủ nhân trả lời'
    },
    reminderTitle: (name, minutes) => `${name} vẫn đang chờ chủ nhân (${minutes} phút)`,
    doneTitle: (name) => `${name} đã xong`,
    doneBody: 'Claude đã trả lời xong',
    jobTitle: (name) => `Job nền cần chủ nhân: ${name}`,
    jobBody: 'Mở bằng claude agents để trả lời.',
    loopTitle: (name) => `${name} lỗi liên tục`,
    loopBody: (n, tool) => `${tool} lỗi ${n} lần trong 5 phút.`,
    limitTitle: (pct) => `Giới hạn 5h đã dùng ${pct}%`,
    limitBody: (at) => `Với tốc độ này sẽ hết vào khoảng ${at}, trước khi reset.`,
    stuckTitle: (name) => `${name} không có output`,
    stuckBody: (minutes) => `Đang chạy nhưng không có output ${minutes} phút.`,
    contextTitle: (name, pct) => `${name} đã dùng ${pct}% context`,
    contextBody: 'Nên /compact trước khi Claude tự compact.',
    idleTitle: (n, size) => `${n} mục bỏ quên đang dùng ${size}`,
    idleBody: (names) => `${names}. Mở Orrery để xem và tắt.`,
    sensitiveTitle: (name) => `${name} vừa đụng vào thứ nhạy cảm`,
    sensitiveBody: (rule, tool, path) => `${tool} · ${ruleLabel(rule, 'vi')}${path ? ` · ${path}` : ''}`,
    diskTitle: (label, free) => `Ổ ${label} sắp đầy: còn ${free}`,
    diskBody: (danger) => (danger ? 'Build và agent sắp lỗi vì hết chỗ. Mở Orrery để dọn đồ build hoặc dữ liệu agent.' : 'Mở Orrery để xem có thể dọn gì.'),
    noteTitle: (name, done) => (done ? `${name} báo đã xong` : `${name} cần chủ nhân xem`),
    noteMore: (n) => ` (+${n} tin nữa)`,
    testTitle: 'Thông báo thử',
    testBody: 'Thông báo Windows của Orrery đang chạy.',
    snooze: (minutes) => `Hoãn ${minutes} phút`,
    open: 'Mở terminal',
    openDashboard: 'Mở dashboard',
    dismiss: 'Bỏ qua',
  },
}

const RULE_LABELS: Record<string, [string, string]> = {
  'outside-project': ['file outside the project', 'file ngoài project'],
  'git-force-push': ['git push --force', 'git push --force'],
  'git-reset-hard': ['git reset --hard', 'git reset --hard'],
  'git-clean': ['git clean -fd', 'git clean -fd'],
  'rm-rf': ['rm -rf outside the project', 'rm -rf ngoài project'],
  'del-s': ['del /s outside the project', 'del /s ngoài project'],
  'remove-item-recurse': ['Remove-Item -Recurse outside the project', 'Remove-Item -Recurse ngoài project'],
  'adb-uninstall': ['adb uninstall', 'adb uninstall'],
  'drop-table': ['DROP TABLE', 'DROP TABLE'],
}

export function ruleLabel(rule: string, locale: ToastLocale): string {
  const pair = RULE_LABELS[rule]
  if (pair) return pair[locale === 'vi' ? 1 : 0]
  return rule.replace(/^custom:/, '')
}

/** Phone messages leave the machine: the alias the owner typed or the folder name, never the auto title. */
export function phoneName(t: Pick<TerminalSession, 'alias' | 'cwd'>): string {
  if (t.alias) return t.alias.slice(0, 80)
  const base = t.cwd ? path.win32.basename(t.cwd.replace(/[\\/]+$/, '')) : ''
  return (base || 'Claude').slice(0, 80)
}

export const LONG_JOB_MS = 5 * 60_000

export function toastTag(key: string): string {
  return createHash('sha1').update(key).digest('hex').slice(0, 16)
}

const nameOf = (t: TerminalSession) => (t.alias || t.title || t.id).slice(0, 80)

export function toastContent(terminal: TerminalSession, locale: ToastLocale, url: string, tool?: string): ToastContent {
  const text = TEXT[locale]
  return {
    tag: toastTag(`waiting:${terminal.id}`),
    title: text.waitingTitle(nameOf(terminal)),
    body: text.waitingBody(terminal.waitingFor?.slice(0, 120), tool),
    url,
    open: text.open,
    dismiss: text.dismiss,
    persistent: true,
  }
}

export function formatBytes(bytes: number, locale: ToastLocale): string {
  const gb = bytes / 1024 ** 3
  const [value, unit] = gb >= 1 ? [gb.toFixed(1), 'GB'] : [String(Math.max(1, Math.round(bytes / 1024 ** 2))), 'MB']
  return `${locale === 'vi' ? value.replace('.', ',') : value} ${unit}`
}

const DAEMON_LABEL = { gradle: 'Gradle daemon', kotlin: 'Kotlin daemon', dart: 'Dart analysis server', flutter: 'Flutter daemon', emulator: 'Emulator' } as const

export function serverLabel(s: ServerRes): string {
  const d = s.daemon
  if (!d) return s.name.replace(/\.exe$/i, '')
  const extra = d.type === 'emulator' ? d.avd : d.version
  return extra ? `${DAEMON_LABEL[d.type]} ${extra}` : DAEMON_LABEL[d.type]
}

const IDLE_LIST_MAX = 3

export const TOAST_THROTTLE_MS = 30_000
export const TOAST_SNOOZE_MIN = 15

export interface ToastSnapshot {
  terminals: Iterable<TerminalSession>
  jobs?: readonly BackgroundJob[]
  limits?: PlanLimits | null
  contextPct?: (terminalId: string) => number | null
  toolOf?: (terminalId: string) => string | undefined
}

export interface NotifyPatch {
  toast?: boolean
  kinds?: Partial<Record<ToastKind, boolean>>
  quiet?: QuietHours
  stuckMinutes?: number
  idleMinutes?: number
}

export class Toaster {
  private keyValue = randomBytes(16).toString('hex')
  snoozed: (terminal: TerminalSession) => boolean = () => false
  private enabled = true
  private kinds: Record<ToastKind, boolean> = { ...DEFAULT_TOAST_KINDS }
  private quiet: QuietHours = { ...DEFAULT_QUIET }
  private stuckMinutes = DEFAULT_STUCK_MINUTES
  private idleMinutesValue = DEFAULT_IDLE_MINUTES
  private readonly idleSent = new Set<string>()
  private idlePrimed = false
  private health: ToastHealth | undefined
  private readonly stuckSent = new Set<string>()
  private readonly contextHigh = new Set<string>()
  private localeValue: ToastLocale = 'vi'
  private readonly prev = new Map<string, TerminalStatus>()
  private readonly terms = new Map<string, TerminalSession>()
  private readonly shown = new Map<string, string>()
  private readonly lastAt = new Map<string, number>()
  private readonly reminded = new Map<string, number>()
  private readonly jobPrev = new Map<string, JobState>()
  private readonly loopSent = new Set<string>()
  private readonly limitSent = new Set<string>()
  private limitsPrimed = false
  private readonly presence = new Map<number, boolean>()
  private readonly workSince = new Map<string, number>()
  /** Desktop main forwards these to the phone when the owner enabled it and the machine is idle. */
  onPhone: ((m: PhoneEpisodeMessage) => void) | null = null
  private readonly ops = new Map<string, Promise<boolean>>()
  private readonly file: JsonFile | null

  constructor(
    private readonly options: { supported: boolean; port: number; file?: string; link?: string | null },
    private readonly deps: ToastDeps = defaultToastDeps,
  ) {
    this.file = options.file ? new JsonFile(options.file, 500) : null
  }

  async load(): Promise<void> {
    const raw = (await this.file?.read()) as { toast?: unknown; locale?: unknown; kinds?: unknown; quiet?: unknown; stuckMinutes?: unknown; idleMinutes?: unknown; key?: unknown } | null
    // Toasts still in the Action Center carry the key of the run that showed them.
    if (typeof raw?.key === 'string' && /^[0-9a-f]{32}$/.test(raw.key)) this.keyValue = raw.key
    else this.save()
    if (typeof raw?.toast === 'boolean') this.enabled = raw.toast
    if (raw?.locale === 'en' || raw?.locale === 'vi') this.localeValue = raw.locale
    Object.assign(this.kinds, sanitizeKinds(raw?.kinds) ?? {})
    this.quiet = sanitizeQuiet(raw?.quiet) ?? this.quiet
    this.stuckMinutes = sanitizeStuck(raw?.stuckMinutes) ?? this.stuckMinutes
    this.idleMinutesValue = sanitizeIdle(raw?.idleMinutes) ?? this.idleMinutesValue
  }

  async refreshHealth(): Promise<ToastHealth | undefined> {
    if (!this.options.supported || !this.deps.health) return this.health
    this.health = await this.deps.health().catch((): ToastHealth => 'unknown')
    return this.health
  }

  async test(): Promise<{ result: ToastTestResult; health?: ToastHealth }> {
    if (!this.options.supported) return { result: 'unsupported' }
    const text = TEXT[this.localeValue]
    const tag = toastTag('test')
    const ok = await this.queue(tag, () =>
      this.deps.show({ tag, title: text.testTitle, body: text.testBody, url: this.linkFor(), open: text.openDashboard, dismiss: text.dismiss, persistent: false }),
    )
    const health = await this.refreshHealth()
    return { result: ok ? 'ok' : 'failed', health }
  }

  snoozeLink(terminalId: string, minutes = TOAST_SNOOZE_MIN): string {
    return `${this.linkBase}snooze?k=${this.key}&t=${encodeURIComponent(terminalId)}&m=${minutes}`
  }

  get key(): string {
    return this.keyValue
  }

  get state(): ToastState {
    if (!this.options.supported) return 'unsupported'
    return this.enabled ? 'on' : 'off'
  }

  get locale(): ToastLocale {
    return this.localeValue
  }

  settings(): NotifySettings {
    const out: NotifySettings = { toast: this.state, kinds: { ...this.kinds }, quiet: { ...this.quiet }, stuckMinutes: this.stuckMinutes, idleMinutes: this.idleMinutesValue }
    if (this.health) out.health = this.health
    return out
  }

  update(patch: NotifyPatch): void {
    if (patch.toast !== undefined && this.options.supported) {
      this.enabled = patch.toast
      if (!patch.toast) this.hideAll()
    }
    for (const kind of TOAST_KINDS) {
      const on = patch.kinds?.[kind]
      if (on === undefined) continue
      this.kinds[kind] = on
      if (!on) this.hideKind(kind)
    }
    if (patch.quiet) this.quiet = { ...patch.quiet }
    const stuck = sanitizeStuck(patch.stuckMinutes)
    if (stuck !== null) this.stuckMinutes = stuck
    const idle = sanitizeIdle(patch.idleMinutes)
    if (idle !== null) {
      this.idleMinutesValue = idle
      if (idle === 0) this.hideKey('idle:all')
    }
    this.save()
  }

  get idleMinutes(): number {
    return this.idleMinutesValue
  }

  /** The sampler keeps running without a window only for this. */
  get idleWatch(): boolean {
    return this.state === 'on' && this.kinds.idle && this.idleMinutesValue > 0
  }

  /** One grouped toast whenever an item becomes forgotten; an item counts once per idle episode. */
  observeIdle(report: ResourceReport): void {
    const items: { key: string; label: string }[] = []
    for (const s of report.sessions) {
      if (!s.forgotten) continue
      const t = this.terms.get(s.sessionId)
      items.push({ key: `s:${s.sessionId}|${s.idleSinceMs ?? ''}`, label: t ? nameOf(t) : s.sessionId })
    }
    for (const s of report.servers) {
      if (!s.forgotten) continue
      items.push({ key: `p:${s.pid}:${s.start}|${s.orphan ? 'orphan' : (s.idleSinceMs ?? '')}`, label: serverLabel(s) })
    }
    const fresh = items.filter((i) => !this.idleSent.has(i.key))
    const current = new Set(items.map((i) => i.key))
    for (const key of [...this.idleSent]) if (!current.has(key)) this.idleSent.delete(key)
    for (const key of current) this.idleSent.add(key)
    const primed = this.idlePrimed
    this.idlePrimed = true
    if (items.length === 0) return this.hideKey('idle:all')
    if (!primed || fresh.length === 0 || report.idleMinutes <= 0 || !this.can('idle')) return
    const text = TEXT[this.localeValue]
    const names = items.slice(0, IDLE_LIST_MAX).map((i) => i.label)
    const more = items.length - names.length
    this.show('idle:all', {
      title: text.idleTitle(items.length, formatBytes(report.totals.forgottenRamBytes, this.localeValue)),
      body: text.idleBody(more > 0 ? `${names.join(', ')} +${more}` : names.join(', ')),
      url: this.linkFor(),
      open: text.openDashboard,
      persistent: false,
    })
  }

  setEnabled(on: boolean): void {
    this.update({ toast: on })
  }

  setPresence(clientId: number, attentive: boolean, locale?: ToastLocale): void {
    this.presence.set(clientId, attentive)
    if (locale && locale !== this.localeValue) {
      this.localeValue = locale
      this.save()
    }
    if (attentive) this.hideAll()
  }

  dropClient(clientId: number): void {
    this.presence.delete(clientId)
  }

  get attentive(): boolean {
    for (const on of this.presence.values()) if (on) return true
    return false
  }

  linkFor(terminalId?: string): string {
    const base = `${this.linkBase}focus?k=${this.key}`
    return terminalId ? `${base}&t=${encodeURIComponent(terminalId)}` : base
  }

  /** agent-monitor:// in the desktop app (opens the app, not a browser); http for `npm run dev`. */
  private get linkBase(): string {
    return this.options.link ?? `http://127.0.0.1:${this.options.port}/`
  }

  accepts(key: string | null): boolean {
    if (key === null) return false
    const digest = (v: string) => createHash('sha256').update(v).digest()
    return timingSafeEqual(digest(key), digest(this.keyValue))
  }

  flush(): Promise<void> {
    return this.file?.flush() ?? Promise.resolve()
  }

  hideFor(terminalId: string): void {
    for (const kind of ['waiting', 'done', 'loop', 'stuck', 'context', 'sensitive', 'note'] as const) this.hideKey(`${kind}:${terminalId}`)
  }

  observe(snap: ToastSnapshot): void {
    const nowMs = this.deps.now()
    const alive = new Set<string>()
    for (const t of snap.terminals) {
      alive.add(t.id)
      this.terms.set(t.id, t)
      const before = this.prev.get(t.id)
      this.prev.set(t.id, t.status)
      const worked = this.trackWork(t, before, nowMs)
      this.watchStuck(t, before, nowMs)
      this.watchContext(t, before, snap.contextPct?.(t.id) ?? null)
      if (t.status !== 'idle' || t.endedAt) this.hideKey(`done:${t.id}`)
      if (t.status !== 'waiting' || t.endedAt) {
        this.hideKey(`waiting:${t.id}`)
        if (before === 'working' && t.status === 'idle' && !t.endedAt) {
          this.showDone(t)
          if (worked !== null && worked >= LONG_JOB_MS) this.phone({ episode: `d:${t.id}|${t.statusSince ?? ''}`, reason: 'done', name: phoneName(t), since: nowMs - worked })
        }
        continue
      }
      if (this.snoozed(t)) this.hideKey(`waiting:${t.id}`)
      const episode = `${t.id}|${t.statusSince ?? ''}`
      if (before === undefined) {
        this.reminded.set(episode, remindersDue(t.statusSince, nowMs))
        continue
      }
      if (before !== 'waiting') {
        this.reminded.set(episode, 0)
        this.showWaiting(t, nowMs, snap.toolOf?.(t.id))
        continue
      }
      this.remind(t, episode, nowMs, snap.toolOf?.(t.id))
    }
    for (const id of [...this.prev.keys()]) {
      if (alive.has(id)) continue
      this.prev.delete(id)
      this.workSince.delete(id)
      this.terms.delete(id)
      this.lastAt.delete(id)
      this.hideFor(id)
    }
    const waiting = new Set([...this.terms.values()].filter((t) => t.status === 'waiting').map((t) => `${t.id}|${t.statusSince ?? ''}`))
    for (const e of this.reminded.keys()) if (!waiting.has(e)) this.reminded.delete(e)
    const live = new Set([...this.terms.values()].map((t) => `${t.id}|${t.lastActivityAt ?? ''}`))
    for (const e of this.stuckSent) if (!live.has(e)) this.stuckSent.delete(e)
    for (const id of this.contextHigh) if (!this.terms.has(id)) this.contextHigh.delete(id)
    if (snap.jobs) this.observeJobs(snap.jobs)
    if (snap.limits !== undefined) this.observeLimits(snap.limits, nowMs)
  }

  checkLoops(events: Iterable<ActivityEvent>): void {
    const loops = errorLoops(events, this.deps.now())
    const current = new Set<string>()
    for (const [id, l] of loops) {
      const episode = `${id}|${l.since}`
      current.add(episode)
      if (this.loopSent.has(episode)) continue
      this.loopSent.add(episode)
      const t = this.terms.get(id)
      if (!t || !this.can('loop')) continue
      const text = TEXT[this.localeValue]
      this.show(`loop:${id}`, {
        title: text.loopTitle(nameOf(t)),
        body: text.loopBody(l.failures, l.tool ?? '?'),
        url: this.linkFor(id),
        open: text.open,
        persistent: false,
      })
    }
    for (const e of this.loopSent) if (!current.has(e)) this.loopSent.delete(e)
  }

  async clear(): Promise<void> {
    const tags = [...this.shown.values()]
    this.shown.clear()
    await Promise.all(tags.map((tag) => this.queue(tag, () => this.deps.hide(tag))))
  }

  private can(kind: ToastKind): boolean {
    return this.state === 'on' && this.kinds[kind] && !this.attentive && !inQuietHours(this.quiet, new Date(this.deps.now()))
  }

  /** Sensitive hit (R5): one toast per hit, the watch already drops repeats of a rule + path. */
  observeSensitive(e: ActivityEvent): void {
    if (e.kind !== 'sensitive' || !e.terminalId || !e.data?.rule) return
    const t = this.terms.get(e.terminalId)
    if (!t || !this.can('sensitive')) return
    const text = TEXT[this.localeValue]
    this.show(`sensitive:${t.id}`, {
      title: text.sensitiveTitle(nameOf(t)),
      body: text.sensitiveBody(e.data.rule, e.data.tool ?? '?', e.data.path),
      url: this.linkFor(t.id),
      open: text.open,
      persistent: false,
    })
  }

  /** Low disk (v77 R9): desktop main already sends one alert per drive per crossing. */
  observeDisk(m: DiskAlertMessage): void {
    if (m.level === 'danger') this.phone({ episode: `disk:${m.label}:${this.deps.now()}`, reason: 'disk', name: m.label, freeBytes: m.freeBytes }, 'disk')
    if (!this.can('disk')) return
    const text = TEXT[this.localeValue]
    this.show(`disk:${m.label}`, { title: text.diskTitle(m.label, formatGb(m.freeBytes)), body: text.diskBody(m.level === 'danger'), url: this.linkFor(), open: text.openDashboard, persistent: false })
  }

  /** notify_owner (v80): `attention` follows the "needs you" switch, `done` the done one (off by default); `info` stays in the Inbox. */
  observeNote(m: AgentNoteMessage): void {
    if (m.level === 'info') return
    const kind: ToastKind = m.level === 'done' ? 'done' : 'waiting'
    const t = m.terminalId ? this.terms.get(m.terminalId) : undefined
    const text = TEXT[this.localeValue]
    const body = `${m.text}${m.merged ? text.noteMore(m.merged) : ''}`
    this.phone({ episode: `n:${m.episode}`, reason: 'note', name: t ? phoneName(t) : m.name, text: body.slice(0, 200) }, kind)
    if (!this.can(kind) || (t && this.snoozed(t))) return
    this.show(`note:${t?.id ?? m.name}`, { title: text.noteTitle(t ? nameOf(t) : m.name, m.level === 'done'), body, url: this.linkFor(t?.id), open: t ? text.open : text.openDashboard, persistent: false })
  }

  private trackWork(t: TerminalSession, before: TerminalStatus | undefined, nowMs: number): number | null {
    if (t.status === 'working') {
      if (before !== 'working' || !this.workSince.has(t.id)) {
        const since = t.statusSince ? Date.parse(t.statusSince) : NaN
        // First sight of a session already working: its start is unknown, so it never counts as a long job.
        this.workSince.set(t.id, before === undefined ? Infinity : Number.isFinite(since) ? since : nowMs)
      }
      return null
    }
    const since = this.workSince.get(t.id)
    this.workSince.delete(t.id)
    return since === undefined || !Number.isFinite(since) ? null : Math.max(0, nowMs - since)
  }

  private phone(m: Omit<PhoneEpisodeMessage, 'type'>, kind?: ToastKind): void {
    if (!this.onPhone || (kind && !this.kinds[kind]) || inQuietHours(this.quiet, new Date(this.deps.now()))) return
    this.onPhone({ type: 'phone', ...m })
  }

  private phoneWaiting(t: TerminalSession, nowMs: number, tool?: string): void {
    if (this.snoozed(t)) return
    const kind = waitReason(t.waitingFor)
    const reason: PhoneReason = kind === 'question' ? 'question' : kind === 'permission' ? 'permission' : 'waiting'
    const since = t.statusSince ? Date.parse(t.statusSince) : nowMs
    this.phone({ episode: `w:${t.id}|${t.statusSince ?? ''}`, reason, name: phoneName(t), ...(tool ? { tool } : {}), since: Number.isFinite(since) ? since : nowMs }, 'waiting')
  }

  private showWaiting(t: TerminalSession, nowMs: number, tool?: string): void {
    this.phoneWaiting(t, nowMs, tool)
    if (!this.can('waiting') || this.snoozed(t)) return
    if (nowMs - (this.lastAt.get(t.id) ?? -Infinity) < TOAST_THROTTLE_MS) return
    this.lastAt.set(t.id, nowMs)
    const content = { ...toastContent(t, this.localeValue, this.linkFor(t.id), tool), ...this.snoozeAction(t.id) }
    this.shown.set(`waiting:${t.id}`, content.tag)
    void this.queue(content.tag, () => this.deps.show(content))
  }

  private remind(t: TerminalSession, episode: string, nowMs: number, tool?: string): void {
    const due = remindersDue(t.statusSince, nowMs)
    const sent = this.reminded.get(episode)
    if (sent === undefined) {
      this.reminded.set(episode, due)
      return
    }
    if (due <= sent) return
    this.reminded.set(episode, due)
    this.phoneWaiting(t, nowMs, tool)
    if (!this.can('waiting') || this.snoozed(t)) return
    const text = TEXT[this.localeValue]
    const since = t.statusSince ? Date.parse(t.statusSince) : nowMs
    this.lastAt.set(t.id, nowMs)
    this.show(`waiting:${t.id}`, {
      title: text.reminderTitle(nameOf(t), Math.max(1, Math.round((nowMs - since) / 60_000))),
      body: text.waitingBody(t.waitingFor?.slice(0, 120), tool),
      url: this.linkFor(t.id),
      open: text.open,
      persistent: true,
      ...this.snoozeAction(t.id),
    })
  }

  private snoozeAction(terminalId: string): Pick<ToastContent, 'snoozeUrl' | 'snoozeLabel'> {
    return { snoozeUrl: this.snoozeLink(terminalId), snoozeLabel: TEXT[this.localeValue].snooze(TOAST_SNOOZE_MIN) }
  }

  private watchStuck(t: TerminalSession, before: TerminalStatus | undefined, nowMs: number): void {
    const quiet = t.endedAt ? null : quietFor(t, nowMs, this.stuckMinutes)
    if (quiet === null) {
      this.hideKey(`stuck:${t.id}`)
      return
    }
    const episode = `${t.id}|${t.lastActivityAt ?? ''}`
    if (this.stuckSent.has(episode)) return
    this.stuckSent.add(episode)
    if (before === undefined || !this.can('stuck')) return
    const text = TEXT[this.localeValue]
    this.show(`stuck:${t.id}`, {
      title: text.stuckTitle(nameOf(t)),
      body: text.stuckBody(Math.round(quiet / 60_000)),
      url: this.linkFor(t.id),
      open: text.open,
      persistent: false,
    })
  }

  private watchContext(t: TerminalSession, before: TerminalStatus | undefined, pct: number | null): void {
    if (pct === null || pct < CONTEXT_THRESHOLDS.critical || t.endedAt) {
      this.contextHigh.delete(t.id)
      return
    }
    if (this.contextHigh.has(t.id)) return
    this.contextHigh.add(t.id)
    if (before === undefined || !this.can('context')) return
    const text = TEXT[this.localeValue]
    this.show(`context:${t.id}`, {
      title: text.contextTitle(nameOf(t), Math.round(pct)),
      body: text.contextBody,
      url: this.linkFor(t.id),
      open: text.open,
      persistent: false,
    })
  }

  private showDone(t: TerminalSession): void {
    if (!this.can('done')) return
    const text = TEXT[this.localeValue]
    this.show(`done:${t.id}`, { title: text.doneTitle(nameOf(t)), body: text.doneBody, url: this.linkFor(t.id), open: text.open, persistent: false })
  }

  private observeJobs(jobs: readonly BackgroundJob[]): void {
    const alive = new Set<string>()
    for (const job of jobs) {
      alive.add(job.id)
      const before = this.jobPrev.get(job.id)
      this.jobPrev.set(job.id, job.state)
      if (job.state !== 'blocked') {
        this.hideKey(`job:${job.id}`)
        continue
      }
      if (before === undefined || before === 'blocked') continue
      const owner = job.sessionId ? [...this.terms.values()].find((t) => t.claudeSessionId === job.sessionId) : undefined
      const since = job.stateSince ? Date.parse(job.stateSince) : NaN
      this.phone({ episode: `j:${job.id}|${job.stateSince ?? ''}`, reason: 'job', name: owner ? phoneName(owner) : 'Claude', ...(Number.isFinite(since) ? { since } : {}) }, 'job')
      if (!this.can('job')) continue
      const text = TEXT[this.localeValue]
      this.show(`job:${job.id}`, {
        title: text.jobTitle((job.name ?? job.id).slice(0, 80)),
        body: text.jobBody,
        url: this.linkFor(owner?.id),
        open: owner ? text.open : text.openDashboard,
        persistent: true,
      })
    }
    for (const id of [...this.jobPrev.keys()]) {
      if (alive.has(id)) continue
      this.jobPrev.delete(id)
      this.hideKey(`job:${id}`)
    }
  }

  private observeLimits(limits: PlanLimits | null, nowMs: number): void {
    const w = limits?.fiveHour
    const f = w?.forecast
    const full = f?.fullAt ? Date.parse(f.fullAt) : NaN
    const primed = this.limitsPrimed
    if (limits) this.limitsPrimed = true
    if (!w || !f?.beforeReset || !Number.isFinite(full) || w.usedPct >= 100 || full - nowMs > 60 * 60_000) return
    const key = w.resetsAt ?? 'unknown'
    if (this.limitSent.has(key)) return
    this.limitSent.add(key)
    if (!primed) return
    this.phone({ episode: `l:${key}`, reason: 'limit', name: 'Claude' }, 'limit')
    if (!this.can('limit')) return
    const text = TEXT[this.localeValue]
    const at = new Date(full).toLocaleTimeString(this.localeValue === 'vi' ? 'vi-VN' : 'en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    this.show('limit:5h', { title: text.limitTitle(Math.round(w.usedPct)), body: text.limitBody(at), url: this.linkFor(), open: text.openDashboard, persistent: false })
  }

  private show(key: string, c: Omit<ToastContent, 'tag' | 'dismiss'>): void {
    const content: ToastContent = { ...c, tag: toastTag(key), dismiss: TEXT[this.localeValue].dismiss }
    this.shown.set(key, content.tag)
    void this.queue(content.tag, () => this.deps.show(content))
  }

  private hideKey(key: string): void {
    const tag = this.shown.get(key)
    if (!tag) return
    this.shown.delete(key)
    void this.queue(tag, () => this.deps.hide(tag))
  }

  private hideKind(kind: ToastKind): void {
    for (const key of [...this.shown.keys()]) if (key.startsWith(`${kind}:`)) this.hideKey(key)
  }

  private queue(tag: string, op: () => Promise<boolean>): Promise<boolean> {
    const fail = () => false
    const next = (this.ops.get(tag) ?? Promise.resolve(true)).then(op, op).catch(fail)
    this.ops.set(tag, next)
    void next.then(() => {
      if (this.ops.get(tag) === next) this.ops.delete(tag)
    })
    return next
  }

  private hideAll(): void {
    for (const key of [...this.shown.keys()]) this.hideKey(key)
  }

  private save(): void {
    this.file?.schedule(() => ({ toast: this.enabled, locale: this.localeValue, kinds: this.kinds, quiet: this.quiet, stuckMinutes: this.stuckMinutes, idleMinutes: this.idleMinutesValue, key: this.keyValue }))
  }
}
