import { defineStore } from 'pinia'
import { ref, shallowRef, watch } from 'vue'
import type { ActivityEvent, TerminalStatus } from '@ccm/shared'
import { useActivityStore } from './activity'
import { useAttentionStore } from './attention'
import { useExtrasStore } from './extras'
import { useTerminalsStore } from './terminals'

export const AWAY_MIN_MS = 2 * 60_000

export interface AwaySummary {
  since: number
  until: number
  /** Sessions that finished a reply (working → idle) while away. */
  done: string[]
  /** Sessions still waiting on return, oldest wait first. */
  waiting: string[]
  started: number
  ended: number
  compactions: number
  failedAgents: number
  completedAgents: number
  jobsDone: number
  loops: string[]
  /** Change of the 5-hour limit in percentage points (status line bridge). */
  limitDelta: number | null
}

export function summarizeActivity(items: ActivityEvent[], since: number): Pick<AwaySummary, 'started' | 'ended' | 'compactions' | 'failedAgents' | 'completedAgents' | 'jobsDone'> {
  const out = { started: 0, ended: 0, compactions: 0, failedAgents: 0, completedAgents: 0, jobsDone: 0 }
  for (const e of items) {
    const at = Date.parse(e.at)
    if (!Number.isFinite(at) || at < since) continue
    if (e.kind === 'terminal.started') out.started++
    else if (e.kind === 'terminal.ended') out.ended++
    else if (e.kind === 'terminal.compacted') out.compactions++
    else if (e.kind === 'agent.failed') out.failedAgents++
    else if (e.kind === 'agent.completed') out.completedAgents++
    else if (e.kind === 'job.done') out.jobsDone++
  }
  return out
}

const isAway = () => document.visibilityState === 'hidden' || !document.hasFocus()

/** "While you were away": tracks what changed between leaving the tab (hidden or unfocused) and coming back. */
export const useAwayStore = defineStore('away', () => {
  const terminals = useTerminalsStore()
  const activity = useActivityStore()
  const attention = useAttentionStore()
  const extras = useExtrasStore()

  const summary = shallowRef<AwaySummary | null>(null)
  const awaySince = ref<number | null>(null)
  let limitAtLeave: number | null = null
  let done = new Set<string>()
  let installed = false

  function leave(): void {
    if (awaySince.value !== null) return
    awaySince.value = Date.now()
    limitAtLeave = extras.limits?.fiveHour?.usedPct ?? null
    done = new Set()
  }

  function back(): void {
    const since = awaySince.value
    if (since === null || isAway()) return
    awaySince.value = null
    const until = Date.now()
    if (until - since < AWAY_MIN_MS) return
    const waiting = terminals.live
      .filter((x) => x.status === 'waiting')
      .sort((a, b) => (a.statusSince ?? '').localeCompare(b.statusSince ?? ''))
      .map((x) => x.id)
    const pct = extras.limits?.fiveHour?.usedPct
    const next: AwaySummary = {
      since,
      until,
      done: [...done].filter((id) => terminals.byId[id] && !waiting.includes(id)),
      waiting,
      loops: [...attention.loops.keys()],
      limitDelta: pct !== undefined && limitAtLeave !== null && pct >= limitAtLeave ? Math.round(pct - limitAtLeave) : null,
      ...summarizeActivity(activity.items, since),
    }
    const quiet =
      !next.done.length && !next.waiting.length && !next.loops.length && !next.started && !next.ended && !next.compactions &&
      !next.failedAgents && !next.jobsDone && !next.limitDelta
    summary.value = quiet ? null : next
  }

  function dismiss(): void {
    summary.value = null
  }

  function install(): void {
    if (installed) return
    installed = true
    const sync = () => (isAway() ? leave() : back())
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('blur', sync)
    window.addEventListener('focus', sync)
    if (isAway()) leave()

    const prev = new Map<string, TerminalStatus>()
    watch(
      () => terminals.list.map((x) => [x.id, x.status] as const),
      (list) => {
        for (const [id, status] of list) {
          if (awaySince.value !== null && prev.get(id) === 'working' && status === 'idle') done.add(id)
          prev.set(id, status)
        }
      },
      { immediate: true },
    )
  }

  return { summary, awaySince, install, dismiss }
})
