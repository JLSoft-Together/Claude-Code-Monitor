import { execFile } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  CONTEXT_THRESHOLDS,
  DEFAULT_QUIET,
  DEFAULT_STUCK_MINUTES,
  DEFAULT_TOAST_KINDS,
  TOAST_KINDS,
  errorLoops,
  inQuietHours,
  quietFor,
  remindersDue,
  sanitizeKinds,
  sanitizeQuiet,
  sanitizeStuck,
  type ActivityEvent,
  type BackgroundJob,
  type JobState,
  type NotifySettings,
  type PlanLimits,
  type QuietHours,
  type TerminalSession,
  type TerminalStatus,
  type ToastHealth,
  type ToastKind,
  type ToastState,
  type ToastTestResult,
} from '@ccm/shared'
import { JsonFile } from './json-file'

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

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
$app = $env:CCM_TOAST_APP
if ($env:CCM_TOAST_MODE -eq 'health') {
  $g = (Get-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\PushNotifications' -Name ToastEnabled -ErrorAction SilentlyContinue).ToastEnabled
  $a = (Get-ItemProperty -LiteralPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Notifications\Settings\$app" -Name Enabled -ErrorAction SilentlyContinue).Enabled
  if ($g -eq 0) { 'globalOff' } elseif ($a -eq 0) { 'appOff' } else { 'ok' }
  exit
}
if ($env:CCM_TOAST_MODE -eq 'hide') {
  [Windows.UI.Notifications.ToastNotificationManager]::History.Remove($env:CCM_TOAST_TAG, 'ccm', $app)
  'ok'; exit
}
[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime]
function Esc([string]$v) { [System.Security.SecurityElement]::Escape($v) }
$url = Esc $env:CCM_TOAST_URL
$snooze = if ($env:CCM_TOAST_SNOOZE_URL) { "<action content='$(Esc $env:CCM_TOAST_SNOOZE_LABEL)' arguments='$(Esc $env:CCM_TOAST_SNOOZE_URL)' activationType='protocol'/>" } else { '' }
$scenario = if ($env:CCM_TOAST_PERSIST -eq '1') { " scenario='reminder'" } else { '' }
$xml = "<toast$scenario activationType='protocol' launch='$url'><visual><binding template='ToastGeneric'><text>$(Esc $env:CCM_TOAST_TITLE)</text><text>$(Esc $env:CCM_TOAST_BODY)</text></binding></visual><actions><action content='$(Esc $env:CCM_TOAST_OPEN)' arguments='$url' activationType='protocol'/>$snooze<action content='$(Esc $env:CCM_TOAST_DISMISS)' arguments='dismiss' activationType='system'/></actions></toast>"
$doc = [Windows.Data.Xml.Dom.XmlDocument]::new()
$doc.LoadXml($xml)
$toast = [Windows.UI.Notifications.ToastNotification]::new($doc)
$toast.Tag = $env:CCM_TOAST_TAG
$toast.Group = 'ccm'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show($toast)
'ok'
`

function runPs(env: Record<string, string>): Promise<string | null> {
  if (process.platform !== 'win32') return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT],
      { timeout: 15_000, windowsHide: true, maxBuffer: 64_000, env: { ...process.env, CCM_TOAST_APP: APP_ID, ...env } },
      (err, stdout) => resolve(err ? null : (stdout.trim().split(/\r?\n/).at(-1)?.trim() ?? null)),
    )
  })
}

const runScript = async (env: Record<string, string>): Promise<boolean> => (await runPs(env)) === 'ok'

export function showToast(c: ToastContent): Promise<boolean> {
  return runScript({
    CCM_TOAST_MODE: 'show',
    CCM_TOAST_TAG: c.tag,
    CCM_TOAST_TITLE: c.title,
    CCM_TOAST_BODY: c.body,
    CCM_TOAST_URL: c.url,
    CCM_TOAST_OPEN: c.open,
    CCM_TOAST_DISMISS: c.dismiss,
    CCM_TOAST_PERSIST: c.persistent ? '1' : '0',
    CCM_TOAST_SNOOZE_URL: c.snoozeUrl ?? '',
    CCM_TOAST_SNOOZE_LABEL: c.snoozeLabel ?? '',
  })
}

export async function toastHealth(): Promise<ToastHealth> {
  const out = await runPs({ CCM_TOAST_MODE: 'health' })
  return out === 'ok' || out === 'globalOff' || out === 'appOff' ? out : 'unknown'
}

export function hideToast(tag: string): Promise<boolean> {
  return runScript({ CCM_TOAST_MODE: 'hide', CCM_TOAST_TAG: tag })
}

export const defaultToastDeps: ToastDeps = { show: showToast, hide: hideToast, now: () => Date.now(), health: toastHealth }

interface Texts {
  waitingTitle: (name: string) => string
  waitingBody: (reason?: string) => string
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
  testTitle: string
  testBody: string
  snooze: (minutes: number) => string
  open: string
  openDashboard: string
  dismiss: string
  page: { opening: string; opened: string; snoozed: (minutes: number) => string }
}

export const TEXT: Record<ToastLocale, Texts> = {
  en: {
    waitingTitle: (name) => `${name} needs you`,
    waitingBody: (reason) => (reason ? `Waiting for ${reason}` : 'Claude is waiting for your input'),
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
    testTitle: 'Test notification',
    testBody: 'Windows notifications from Claude Code Monitor work.',
    snooze: (minutes) => `Snooze ${minutes} min`,
    open: 'Open terminal',
    openDashboard: 'Open dashboard',
    dismiss: 'Dismiss',
    page: {
      opening: 'Opening terminal…',
      opened: 'Terminal opened. You can close this tab.',
      snoozed: (minutes) => `Snoozed for ${minutes} min. You can close this tab.`,
    },
  },
  vi: {
    waitingTitle: (name) => `${name} đang chờ chủ nhân`,
    waitingBody: (reason) => (reason ? `Đang chờ ${reason}` : 'Claude đang chờ chủ nhân trả lời'),
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
    testTitle: 'Thông báo thử',
    testBody: 'Thông báo Windows của Claude Code Monitor đang chạy.',
    snooze: (minutes) => `Hoãn ${minutes} phút`,
    open: 'Mở terminal',
    openDashboard: 'Mở dashboard',
    dismiss: 'Bỏ qua',
    page: {
      opening: 'Đang mở terminal…',
      opened: 'Đã mở terminal. Bạn có thể đóng tab này.',
      snoozed: (minutes) => `Đã hoãn nhắc ${minutes} phút. Bạn có thể đóng tab này.`,
    },
  },
}

export function toastTag(key: string): string {
  return createHash('sha1').update(key).digest('hex').slice(0, 16)
}

const nameOf = (t: TerminalSession) => (t.alias || t.title || t.id).slice(0, 80)

export function toastContent(terminal: TerminalSession, locale: ToastLocale, url: string): ToastContent {
  const text = TEXT[locale]
  return {
    tag: toastTag(`waiting:${terminal.id}`),
    title: text.waitingTitle(nameOf(terminal)),
    body: text.waitingBody(terminal.waitingFor?.slice(0, 120)),
    url,
    open: text.open,
    dismiss: text.dismiss,
    persistent: true,
  }
}

export const TOAST_THROTTLE_MS = 30_000
export const TOAST_SNOOZE_MIN = 15

export interface ToastSnapshot {
  terminals: Iterable<TerminalSession>
  jobs?: readonly BackgroundJob[]
  limits?: PlanLimits | null
  contextPct?: (terminalId: string) => number | null
}

export interface NotifyPatch {
  toast?: boolean
  kinds?: Partial<Record<ToastKind, boolean>>
  quiet?: QuietHours
  stuckMinutes?: number
}

export class Toaster {
  readonly key = randomBytes(16).toString('hex')
  snoozed: (terminal: TerminalSession) => boolean = () => false
  private enabled = true
  private kinds: Record<ToastKind, boolean> = { ...DEFAULT_TOAST_KINDS }
  private quiet: QuietHours = { ...DEFAULT_QUIET }
  private stuckMinutes = DEFAULT_STUCK_MINUTES
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
  private readonly ops = new Map<string, Promise<boolean>>()
  private readonly file: JsonFile | null

  constructor(
    private readonly options: { supported: boolean; port: number; file?: string },
    private readonly deps: ToastDeps = defaultToastDeps,
  ) {
    this.file = options.file ? new JsonFile(options.file, 500) : null
  }

  async load(): Promise<void> {
    const raw = (await this.file?.read()) as { toast?: unknown; locale?: unknown; kinds?: unknown; quiet?: unknown; stuckMinutes?: unknown } | null
    if (typeof raw?.toast === 'boolean') this.enabled = raw.toast
    if (raw?.locale === 'en' || raw?.locale === 'vi') this.localeValue = raw.locale
    Object.assign(this.kinds, sanitizeKinds(raw?.kinds) ?? {})
    this.quiet = sanitizeQuiet(raw?.quiet) ?? this.quiet
    this.stuckMinutes = sanitizeStuck(raw?.stuckMinutes) ?? this.stuckMinutes
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
    return `http://127.0.0.1:${this.options.port}/snooze?k=${this.key}&t=${encodeURIComponent(terminalId)}&m=${minutes}`
  }

  get state(): ToastState {
    if (!this.options.supported) return 'unsupported'
    return this.enabled ? 'on' : 'off'
  }

  get locale(): ToastLocale {
    return this.localeValue
  }

  settings(): NotifySettings {
    const out: NotifySettings = { toast: this.state, kinds: { ...this.kinds }, quiet: { ...this.quiet }, stuckMinutes: this.stuckMinutes }
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
    this.save()
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
    const base = `http://127.0.0.1:${this.options.port}/focus?k=${this.key}`
    return terminalId ? `${base}&t=${encodeURIComponent(terminalId)}` : base
  }

  accepts(key: string | null): boolean {
    return key === this.key
  }

  hideFor(terminalId: string): void {
    for (const kind of ['waiting', 'done', 'loop', 'stuck', 'context'] as const) this.hideKey(`${kind}:${terminalId}`)
  }

  observe(snap: ToastSnapshot): void {
    const nowMs = this.deps.now()
    const alive = new Set<string>()
    for (const t of snap.terminals) {
      alive.add(t.id)
      this.terms.set(t.id, t)
      const before = this.prev.get(t.id)
      this.prev.set(t.id, t.status)
      this.watchStuck(t, before, nowMs)
      this.watchContext(t, before, snap.contextPct?.(t.id) ?? null)
      if (t.status !== 'idle' || t.endedAt) this.hideKey(`done:${t.id}`)
      if (t.status !== 'waiting' || t.endedAt) {
        this.hideKey(`waiting:${t.id}`)
        if (before === 'working' && t.status === 'idle' && !t.endedAt) this.showDone(t)
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
        this.showWaiting(t, nowMs)
        continue
      }
      this.remind(t, episode, nowMs)
    }
    for (const id of [...this.prev.keys()]) {
      if (alive.has(id)) continue
      this.prev.delete(id)
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

  private showWaiting(t: TerminalSession, nowMs: number): void {
    if (!this.can('waiting') || this.snoozed(t)) return
    if (nowMs - (this.lastAt.get(t.id) ?? -Infinity) < TOAST_THROTTLE_MS) return
    this.lastAt.set(t.id, nowMs)
    const content = { ...toastContent(t, this.localeValue, this.linkFor(t.id)), ...this.snoozeAction(t.id) }
    this.shown.set(`waiting:${t.id}`, content.tag)
    void this.queue(content.tag, () => this.deps.show(content))
  }

  private remind(t: TerminalSession, episode: string, nowMs: number): void {
    const due = remindersDue(t.statusSince, nowMs)
    const sent = this.reminded.get(episode)
    if (sent === undefined) {
      this.reminded.set(episode, due)
      return
    }
    if (due <= sent) return
    this.reminded.set(episode, due)
    if (!this.can('waiting') || this.snoozed(t)) return
    const text = TEXT[this.localeValue]
    const since = t.statusSince ? Date.parse(t.statusSince) : nowMs
    this.lastAt.set(t.id, nowMs)
    this.show(`waiting:${t.id}`, {
      title: text.reminderTitle(nameOf(t), Math.max(1, Math.round((nowMs - since) / 60_000))),
      body: text.waitingBody(t.waitingFor?.slice(0, 120)),
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
      if (before === undefined || before === 'blocked' || !this.can('job')) continue
      const text = TEXT[this.localeValue]
      const owner = job.sessionId ? [...this.terms.values()].find((t) => t.claudeSessionId === job.sessionId) : undefined
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
    if (!primed || !this.can('limit')) return
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
    this.file?.schedule(() => ({ toast: this.enabled, locale: this.localeValue, kinds: this.kinds, quiet: this.quiet, stuckMinutes: this.stuckMinutes }))
  }
}
