import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CONTEXT_THRESHOLDS, inQuietHours, remindersDue, type TerminalSession, type TerminalStatus, type ToastKind } from '@ccm/shared'
import { quietFor } from '../lib/attention'
import { duration, now } from '../lib/format'
import { playChime } from '../lib/sound'
import { displayTitle } from '../lib/title'
import { useAgentsStore } from '../stores/agents'
import { useAttentionStore } from '../stores/attention'
import { useConnectionStore } from '../stores/connection'
import { useExtrasStore } from '../stores/extras'
import { useSettingsStore } from '../stores/settings'
import { useSnoozeStore } from '../stores/snooze'
import { useTerminalsStore } from '../stores/terminals'
import { useUsageStore } from '../stores/usage'
import { useUiStore } from '../stores/ui'

export type NotifyKind = 'waiting' | 'done' | 'reminder' | 'context' | 'stuck' | 'job' | 'limit' | 'loop'

const THROTTLE_MS = 30_000
export { LONG_WAIT_MS, MAX_REMINDERS, remindersDue } from '@ccm/shared'

export function transitionKind(before: TerminalStatus | undefined, after: TerminalStatus): NotifyKind | null {
  if (before === undefined || before === after) return null
  if (after === 'waiting') return 'waiting'
  if (before === 'working' && after === 'idle') return 'done'
  return null
}

const TOAST_KIND: Partial<Record<NotifyKind, ToastKind>> = { waiting: 'waiting', reminder: 'waiting', done: 'done', job: 'job', loop: 'loop', stuck: 'stuck', context: 'context' }

/** Desktop notifications + "(N)" tab title for sessions that need the user. Install once at app root. */
export function useNotifications(): void {
  const { t } = useI18n()
  const terminals = useTerminalsStore()
  const agents = useAgentsStore()
  const settings = useSettingsStore()
  const connection = useConnectionStore()
  const ui = useUiStore()
  const extras = useExtrasStore()
  const attention = useAttentionStore()
  const usage = useUsageStore()
  const snooze = useSnoozeStore()
  const baseTitle = document.title

  const waiting = computed(
    () => terminals.list.filter((x) => x.status === 'waiting' && !snooze.isSnoozed(x, now.value)).length + extras.blockedJobs.length,
  )
  const hidden = ref(document.visibilityState !== 'visible')
  document.addEventListener('visibilitychange', () => (hidden.value = document.visibilityState !== 'visible'))
  watch(
    [waiting, hidden, now],
    ([n, h, nowMs]) => {
      const blink = h && n > 0 && Math.floor(nowMs / 1000) % 2 === 1
      document.title = blink ? `🔔 ${t('notify.tabWaiting', { n })}` : n ? `(${n}) ${baseTitle}` : baseTitle
    },
    { immediate: true },
  )
  watch(
    waiting,
    (n) => {
      // Taskbar badge when installed as an app; missing API or a browser tab just ignores it.
      const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
      void (n ? nav.setAppBadge?.(n) : nav.clearAppBadge?.())?.catch(() => undefined)
    },
    { immediate: true },
  )

  const lastSent = new Map<string, number>()

  function enabled(kind: NotifyKind): boolean {
    if (!settings.notifyEnabled) return false
    if (kind === 'done') return settings.notifyDone
    if (kind === 'context') return settings.notifyContext
    if (kind === 'stuck') return settings.notifyStuck
    if (kind === 'limit') return settings.notifyLimit
    if (kind === 'loop') return settings.notifyLoop
    return settings.notifyWaiting
  }

  // Sound plays even while the tab has focus: it is for when eyes are on the terminal, not the dashboard.
  function chime(kind: NotifyKind): void {
    if (!settings.sound) return
    if (kind === 'waiting' || kind === 'job') playChime('waiting')
    else if (kind === 'stuck' || kind === 'loop' || kind === 'limit') playChime('alert')
  }

  function notify(terminal: TerminalSession | null, kind: NotifyKind, title: string, body: string, key = terminal?.id ?? ''): void {
    const tag = `${key}|${kind}`
    const at = Date.now()
    if (at - (lastSent.get(tag) ?? 0) < THROTTLE_MS) return
    if (terminal && snooze.isSnoozed(terminal, at)) return
    if (inQuietHours(extras.notify?.quiet, new Date(at))) return
    lastSent.set(tag, at)
    if (lastSent.size > 200) for (const [k, v] of lastSent) if (at - v >= THROTTLE_MS) lastSent.delete(k)
    chime(kind)
    if (!enabled(kind)) return
    const toastKind = key === 'limit5h' ? 'limit' : TOAST_KIND[kind]
    if (toastKind && extras.toastCovers(toastKind)) return
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    if (document.visibilityState === 'visible' && document.hasFocus()) return
    try {
      const n = new Notification(title, { body, tag, icon: '/favicon.svg' })
      n.onclick = () => {
        window.focus()
        ui.setView('monitor')
        if (terminal) ui.focusTerminal(terminal.id)
        n.close()
      }
    } catch {
      // Some browsers only allow notifications from a service worker; the tab title still shows the count.
    }
  }

  const nameOf = (x: TerminalSession) => displayTitle(x) || x.id
  const waitingBody = (x: TerminalSession) =>
    x.waitingFor ? t('notify.waitingBody', { reason: x.waitingFor }) : t('notify.waitingBodyGeneric')

  const prevStatus = new Map<string, TerminalStatus>()
  watch(
    () => terminals.list.map((x) => [x.id, x.status] as const),
    (list) => {
      if (!connection.hasData) return
      const alive = new Set<string>()
      for (const [id, status] of list) {
        alive.add(id)
        const kind = transitionKind(prevStatus.get(id), status)
        prevStatus.set(id, status)
        const x = terminals.byId[id]
        if (!kind || !x) continue
        if (kind === 'waiting') notify(x, kind, t('notify.waitingTitle', { title: nameOf(x) }), waitingBody(x))
        else notify(x, kind, t('notify.doneTitle', { title: nameOf(x) }), t('notify.doneBody'))
      }
      for (const id of prevStatus.keys()) if (!alive.has(id)) prevStatus.delete(id)
    },
    { immediate: true },
  )

  const stuckSent = new Set<string>()
  const prevJobs = new Map<string, string>()
  watch(
    () => extras.jobs.map((j) => [j.id, j.state, j.name] as const),
    (list) => {
      if (!connection.hasData) return
      for (const [id, state, name] of list) {
        const before = prevJobs.get(id)
        prevJobs.set(id, state)
        if (before === undefined || before === state) continue
        if (state === 'blocked') notify(null, 'job', t('notify.jobBlockedTitle', { title: name ?? id }), t('notify.jobBlockedBody'), id)
      }
    },
  )

  const reminded = new Map<string, number>()
  watch(now, (nowMs) => {
    for (const x of terminals.live) {
      const quiet = quietFor(x, nowMs, settings.stuckMinutes)
      const episode = `${x.id}|${x.lastActivityAt}`
      if (quiet === null || stuckSent.has(episode)) continue
      stuckSent.add(episode)
      notify(x, 'stuck', t('notify.stuckTitle', { title: nameOf(x) }), t('notify.stuckBody', { quiet: duration(x.lastActivityAt, nowMs) ?? '' }))
    }
    // Keep only episodes that can still recur; an episode key never comes back once its session moves on.
    const liveEpisodes = new Set(terminals.live.map((x) => `${x.id}|${x.lastActivityAt}`))
    for (const e of stuckSent) if (!liveEpisodes.has(e)) stuckSent.delete(e)
    for (const x of terminals.live) {
      if (x.status !== 'waiting' || !x.statusSince) continue
      const episode = `${x.id}|${x.statusSince}`
      const due = remindersDue(x.statusSince, nowMs)
      if (due <= (reminded.get(episode) ?? 0) || snooze.isSnoozed(x, nowMs)) continue
      reminded.set(episode, due)
      notify(
        x,
        'reminder',
        t('notify.reminderTitle', { title: nameOf(x), waited: duration(x.statusSince, nowMs) ?? '' }),
        waitingBody(x),
      )
    }
    const waitingEpisodes = new Set(terminals.live.filter((x) => x.status === 'waiting').map((x) => `${x.id}|${x.statusSince}`))
    for (const e of reminded.keys()) if (!waitingEpisodes.has(e)) reminded.delete(e)
  })

  const loopSent = new Set<string>()
  watch(
    () => [...attention.loops].map(([id, l]) => `${id}|${l.since}`),
    (episodes) => {
      for (const episode of episodes) {
        if (loopSent.has(episode)) continue
        loopSent.add(episode)
        const id = episode.slice(0, episode.lastIndexOf('|'))
        const x = terminals.byId[id]
        const l = attention.loops.get(id)
        if (x && l) notify(x, 'loop', t('notify.loopTitle', { title: nameOf(x) }), t('notify.loopBody', { n: l.failures, tool: l.tool ?? t('activity.unknownTool') }))
      }
      const current = new Set(episodes)
      for (const e of loopSent) if (!current.has(e)) loopSent.delete(e)
    },
  )

  // One warning per limit window (keyed by its reset time), only when the projection lands within the hour.
  const limitSent = new Set<string>()
  watch(
    () => [extras.limits?.fiveHour, Math.floor(now.value / 60_000)] as const,
    ([w, minute]) => {
      const f = w?.forecast
      const full = f?.fullAt ? Date.parse(f.fullAt) : NaN
      const nowMs = minute * 60_000
      if (!w || !f?.beforeReset || !Number.isFinite(full) || w.usedPct >= 100 || full - nowMs > 60 * 60_000) return
      const key = w.resetsAt ?? 'unknown'
      if (limitSent.has(key)) return
      limitSent.add(key)
      notify(
        null,
        'limit',
        t('notify.limitTitle', { pct: Math.round(w.usedPct) }),
        t('notify.limitBody', { at: new Date(full).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), in: duration(new Date(nowMs).toISOString(), full) ?? '' }),
        'limit5h',
      )
    },
  )

  const budgetSent = new Set<string>()
  watch(
    () => [usage.todayCost, settings.dailyBudget, usage.today] as const,
    ([cost, budget, day]) => {
      if (budget <= 0 || !usage.received) return
      const level = cost >= budget ? 100 : cost >= budget * 0.8 ? 80 : 0
      const key = `${day}|${budget}|${level}`
      if (!level || budgetSent.has(key)) return
      budgetSent.add(key)
      notify(null, 'limit', t('notify.budgetTitle', { pct: level }), t('notify.budgetBody', { cost: cost.toFixed(2), budget: budget.toFixed(2) }), 'budget')
    },
  )

  const critical = new Set<string>()
  watch(
    () =>
      terminals.live.map((x) => {
        const main = agents.mainOf(x.id)
        const pct = main?.contextTokens !== undefined && main.contextWindow ? (main.contextTokens / main.contextWindow) * 100 : 0
        return [x.id, pct] as const
      }),
    (list) => {
      for (const [id, pct] of list) {
        const over = pct >= CONTEXT_THRESHOLDS.critical
        if (!over) {
          critical.delete(id)
          continue
        }
        if (critical.has(id)) continue
        critical.add(id)
        const x = terminals.byId[id]
        if (x) notify(x, 'context', t('notify.contextTitle', { title: nameOf(x), pct: `${Math.round(pct)}%` }), t('notify.contextBody'))
      }
    },
  )
}
