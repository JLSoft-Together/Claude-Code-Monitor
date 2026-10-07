<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronDown } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import type { LaneStatus } from '@ccm/shared'
import { duration, now } from '../../lib/format'
import { displayTitle } from '../../lib/title'
import { useHistoryStore } from '../../stores/history'
import { useTerminalsStore } from '../../stores/terminals'
import { useUiStore } from '../../stores/ui'
import StatusIcon from '../StatusIcon.vue'

const { t, locale } = useI18n()
const history = useHistoryStore()
const terminals = useTerminalsStore()
const ui = useUiStore()

const HOUR = 3_600_000
const STATUSES: LaneStatus[] = ['working', 'waiting', 'idle']
// Idle is the background state, so it is drawn as a quiet tint instead of competing with the two that matter.
const FILL: Record<LaneStatus, string> = { working: 'bg-st-working', waiting: 'bg-st-waiting', idle: 'bg-st-idle/30' }
const TEXT: Record<LaneStatus, string> = { working: 'text-st-working', waiting: 'text-st-waiting', idle: 'text-ink-muted' }
const clock = computed(() => new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit', hour12: false }))
const dur = (msVal: number) => duration(new Date(0).toISOString(), msVal) ?? ''

interface Seg {
  from: number
  to: number
  status: LaneStatus
  open: boolean
}

const lanes = computed(() => {
  const tl = history.timeline
  if (!tl) return []
  return tl.lanes
    .map((lane) => {
      const segs: Seg[] = lane.segments.map((s) => ({ from: Date.parse(s.from), to: s.to ? Date.parse(s.to) : now.value, status: s.status, open: !s.to }))
      const totals: Record<LaneStatus, number> = { working: 0, waiting: 0, idle: 0 }
      for (const s of segs) totals[s.status] += Math.max(0, s.to - s.from)
      const live = terminals.byId[lane.id]
      const current = segs.at(-1)?.open ? segs.at(-1)!.status : null
      return { id: lane.id, title: (live && displayTitle(live)) || lane.title, segs, totals, current, live: !!live && live.status !== 'stale', start: segs[0]?.from ?? 0 }
    })
    .filter((l) => l.segs.length)
    .sort((a, b) => a.start - b.start)
})

const overall = computed(() => {
  const out: Record<LaneStatus, number> = { working: 0, waiting: 0, idle: 0 }
  for (const l of lanes.value) for (const k of STATUSES) out[k] += l.totals[k]
  const sum = out.working + out.waiting + out.idle
  return { totals: out, sum }
})

const span = computed(() => {
  if (!lanes.value.length) return null
  const first = Math.min(...lanes.value.map((l) => l.start))
  const start = Math.floor(first / HOUR) * HOUR
  const end = Math.max(start + HOUR, Math.ceil(now.value / HOUR) * HOUR)
  const hours = (end - start) / HOUR
  const step = hours <= 6 ? 1 : hours <= 12 ? 2 : 3
  const ticks: { at: number; pct: number; label: string }[] = []
  for (let at = start; at <= end; at += step * HOUR) ticks.push({ at, pct: ((at - start) / (end - start)) * 100, label: clock.value.format(at) })
  return { start, end, ticks }
})

const pct = (at: number) => (span.value ? ((at - span.value.start) / (span.value.end - span.value.start)) * 100 : 0)
const pos = (s: Seg) => ({ left: `${pct(s.from)}%`, width: `max(3px, ${pct(s.to) - pct(s.from)}%)` })
const nowPct = computed(() => pct(now.value))

const hover = ref<{ lane: string; seg: Seg } | null>(null)
// Near the lane ends the tooltip hangs off the matching edge so it never leaves the lane.
const tipStyle = (s: Seg) => {
  const mid = (pct(s.from) + pct(s.to)) / 2
  if (mid < 25) return { left: '0' }
  if (mid > 75) return { right: '0' }
  return { left: `${mid}%`, transform: 'translateX(-50%)' }
}
const showHours = ref(false)

const short = (msVal: number) => {
  const min = Math.round(msVal / 60_000)
  if (min <= 0) return msVal > 0 ? t('history.dur.lt1') : '–'
  const h = Math.floor(min / 60)
  return h ? t('history.dur.hm', { h, m: min % 60 }) : t('history.dur.m', { m: min })
}

const rows = computed(() =>
  [...lanes.value]
    .map((l) => {
      const sum = l.totals.working + l.totals.waiting + l.totals.idle
      const share = (k: LaneStatus) => (sum ? (l.totals[k] / sum) * 100 : 0)
      return { ...l, sum, share: { working: share('working'), waiting: share('waiting'), idle: share('idle') } }
    })
    .sort((a, b) => b.totals.working - a.totals.working),
)

const range = (s: Seg) => `${clock.value.format(s.from)} – ${s.open ? t('history.now') : clock.value.format(s.to)}`
</script>

<template>
  <div>
    <p v-if="!lanes.length" class="py-6 text-center text-sm text-ink-muted">{{ t('history.timelineEmpty') }}</p>
    <template v-else-if="span">
      <div class="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3" :aria-label="t('history.legend')" role="list">
        <div v-for="k in STATUSES" :key="k" role="listitem" class="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5">
          <span class="h-8 w-1.5 shrink-0 rounded-full" :class="FILL[k]" aria-hidden="true" />
          <div class="min-w-0">
            <p class="inline-flex items-center gap-1.5 text-xs text-ink-muted">
              <StatusIcon :status="k" :size="13" :animate="false" />{{ t(`status.${k}`) }}
            </p>
            <p class="text-lg font-semibold leading-tight tabular" :class="k === 'idle' ? 'text-ink' : TEXT[k]">
              {{ dur(overall.totals[k]) }}
              <span v-if="overall.sum" class="text-xs font-normal text-ink-faint">{{ Math.round((overall.totals[k] / overall.sum) * 100) }}%</span>
            </p>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-[minmax(0,1fr)_repeat(3,minmax(3.5rem,auto))] items-center gap-x-3 border-b border-line pb-2 text-xs text-ink-muted sm:gap-x-6">
        <span>{{ t('history.col.session') }}</span>
        <span v-for="k in STATUSES" :key="k" class="inline-flex items-center justify-end gap-1.5">
          <span class="size-2 rounded-full" :class="k === 'idle' ? 'bg-st-idle/50' : FILL[k]" aria-hidden="true" />{{ t(`status.${k}`) }}
        </span>
      </div>
      <ul>
        <li v-for="r in rows" :key="r.id" class="border-b border-line py-3 last:border-b-0">
          <div class="grid grid-cols-[minmax(0,1fr)_repeat(3,minmax(3.5rem,auto))] items-center gap-x-3 sm:gap-x-6">
            <button
              type="button"
              class="inline-flex min-w-0 cursor-pointer items-center gap-1.5 text-left text-sm font-medium hover:underline disabled:cursor-default disabled:no-underline"
              :class="r.live ? 'text-ink' : 'text-ink-muted'"
              :title="r.title"
              :disabled="!r.live"
              @click="(ui.setView('monitor'), ui.focusTerminal(r.id))"
            >
              <StatusIcon v-if="r.current && r.live" :status="r.current" :size="13" :animate="false" class="shrink-0" />
              <span class="truncate">{{ r.title }}</span>
            </button>
            <span class="text-right text-sm font-semibold text-st-working tabular">{{ short(r.totals.working) }}</span>
            <span class="text-right text-sm tabular" :class="r.totals.waiting ? 'font-semibold text-st-waiting' : 'text-ink-faint'">{{ short(r.totals.waiting) }}</span>
            <span class="text-right text-sm text-ink-muted tabular">{{ short(r.totals.idle) }}</span>
          </div>
          <div class="mt-2 flex items-center gap-3">
            <div
              class="flex h-2.5 min-w-0 flex-1 gap-0.5 overflow-hidden rounded-full bg-raised"
              role="img"
              :aria-label="t('history.laneLabel', { title: r.title, working: short(r.totals.working), waiting: short(r.totals.waiting) })"
            >
              <span v-for="k in STATUSES" v-show="r.share[k] > 0" :key="k" class="h-full" :class="FILL[k]" :style="{ width: `${r.share[k]}%` }" />
            </div>
            <span class="w-20 shrink-0 text-right text-xs text-ink-muted tabular">{{ t('history.workShare', { p: Math.round(r.share.working) }) }}</span>
          </div>
        </li>
      </ul>

      <button
        type="button"
        class="mt-4 inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium text-ink-muted transition-colors hover:border-ink-faint hover:text-ink"
        :aria-expanded="showHours"
        @click="showHours = !showHours"
      >
        <ChevronDown :size="14" class="transition-transform" :class="showHours ? 'rotate-180' : ''" aria-hidden="true" />{{ showHours ? t('history.hideHours') : t('history.showHours') }}
      </button>

      <div v-if="showHours" class="mt-4">
      <p class="mb-3 text-xs text-ink-muted">{{ t('history.hoursHint') }}</p>
      <div class="relative mb-1 h-5 text-2xs text-ink-faint tabular" aria-hidden="true">
        <span
          v-for="(tk, i) in span.ticks"
          :key="tk.at"
          class="absolute top-0 whitespace-nowrap"
          :class="i === 0 ? '' : i === span.ticks.length - 1 ? '-translate-x-full' : '-translate-x-1/2'"
          :style="{ left: `${tk.pct}%` }"
        >{{ tk.label }}</span>
      </div>

      <ul class="space-y-1">
        <li v-for="lane in lanes" :key="lane.id" class="rounded-lg px-0 py-2">
          <div class="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <button
              type="button"
              class="inline-flex min-w-0 max-w-full cursor-pointer items-center gap-1.5 text-left text-sm font-medium hover:underline disabled:cursor-default disabled:no-underline"
              :class="lane.live ? 'text-ink' : 'text-ink-muted'"
              :title="lane.title"
              :disabled="!lane.live"
              @click="(ui.setView('monitor'), ui.focusTerminal(lane.id))"
            >
              <StatusIcon v-if="lane.current && lane.live" :status="lane.current" :size="13" :animate="false" class="shrink-0" />
              <span class="truncate">{{ lane.title }}</span>
            </button>
            <span class="ml-auto inline-flex items-center gap-3 text-xs tabular">
              <span class="inline-flex items-center gap-1 text-st-working">
                <span class="size-2 rounded-full bg-st-working" aria-hidden="true" />{{ t('history.worked', { d: dur(lane.totals.working) }) }}
              </span>
              <span v-if="lane.totals.waiting" class="inline-flex items-center gap-1 text-st-waiting">
                <span class="size-2 rounded-full bg-st-waiting" aria-hidden="true" />{{ t('history.waited', { d: dur(lane.totals.waiting) }) }}
              </span>
            </span>
          </div>
          <div
            class="relative h-7 rounded-md border border-line bg-canvas"
            role="img"
            :aria-label="t('history.laneLabel', { title: lane.title, working: dur(lane.totals.working), waiting: dur(lane.totals.waiting) })"
            @pointerleave="hover = null"
          >
            <span v-for="tk in span.ticks" :key="tk.at" class="absolute inset-y-0 w-px bg-line" :style="{ left: `${tk.pct}%` }" aria-hidden="true" />
            <span
              v-for="(s, i) in lane.segs"
              :key="i"
              class="ccm-grow-x absolute inset-y-1 origin-left rounded-[3px] ring-1 ring-surface transition-[filter]"
              :class="[FILL[s.status], hover?.lane === lane.id && hover.seg === s ? 'brightness-110 ring-ink/40' : '']"
              :style="pos(s)"
              tabindex="0"
              :aria-label="`${t(`status.${s.status}`)} ${range(s)}, ${dur(s.to - s.from)}`"
              @pointerenter="hover = { lane: lane.id, seg: s }"
              @focus="hover = { lane: lane.id, seg: s }"
              @blur="hover = null"
              @click="hover = { lane: lane.id, seg: s }"
            />
            <span class="absolute -inset-y-1 w-0.5 rounded-full bg-accent" :style="{ left: `${nowPct}%` }" aria-hidden="true" />
            <div
              v-if="hover?.lane === lane.id"
              class="pointer-events-none absolute bottom-full z-10 mb-2 whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-lg"
              :style="tipStyle(hover.seg)"
              role="tooltip"
            >
              <p class="inline-flex items-center gap-1.5 font-medium" :class="TEXT[hover.seg.status]">
                <StatusIcon :status="hover.seg.status" :size="12" :animate="false" />{{ t(`status.${hover.seg.status}`) }}
                <span class="font-semibold text-ink tabular">{{ dur(hover.seg.to - hover.seg.from) }}</span>
              </p>
              <p class="text-ink-muted tabular">{{ range(hover.seg) }}</p>
            </div>
          </div>
        </li>
      </ul>
      </div>
    </template>
  </div>
</template>
