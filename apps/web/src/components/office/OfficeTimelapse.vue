<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, CircleAlert, History, Info, LoaderCircle, Pause, Play } from 'lucide-vue-next'
import { fetchTimelineDay, fetchTimelineDays, TimelineReplay, type TimelineDayInfo } from '@ccm/habblaud/client/src/net/timeline'
import { animScale } from '@ccm/habblaud/client/src/world/playback'
import type { WorldPlayback } from '@ccm/habblaud/client/src/world/api'
import { dayKey, dayStart, shiftDay } from '@ccm/habblaud/shared/timeline'
import { officeFeed } from '../../office/feed'
import { chartPaths, DEFAULT_SPEED, hourTicks, isNotFound, PUSH_MS, SEEK_MS, sortDays, SPEEDS, STEP_S, type Speed } from '../../office/timelapse'
import { useOfficeStore } from '../../stores/office'
import SegmentedControl from '../ui/SegmentedControl.vue'

const { t, locale } = useI18n()
const office = useOfficeStore()

type Status = 'loading' | 'ready' | 'empty' | 'error'
type MessageKey = 'loadingDays' | 'loadingDay' | 'noHistory' | 'emptyDay' | 'errorDays' | 'errorDay' | ''
/** Orrery has no demo mode: every recorded agent is shown (upstream's demo toggle is not ported). */
const VIEW = { includeDemo: true }

const status = ref<Status>('loading')
const messageKey = ref<MessageKey>('loadingDays')
const days = ref<TimelineDayInfo[]>([])
const day = ref('')
const replay = shallowRef<TimelineReplay | null>(null)
const playing = ref(false)
const speed = ref<Speed>(DEFAULT_SPEED)
/** Replayed instant shown by the bar and badge; follows `cur` at the push rate, not every frame. */
const clock = ref(0)
const rangeValue = ref('0')
const noteKey = ref<'' | 'limited' | 'off'>('')
const announcement = ref('')

const root = ref<HTMLElement | null>(null)
const range = ref<HTMLInputElement | null>(null)

/** Replay clock (epoch ms) read by the world every frame. */
let cur = 0
/** The feed and the world are in replay mode. */
let active = false
let disposed = false
let raf = 0
let lastReal = 0
let lastPush = 0
let lastSeek = 0
let loadSeq = 0
let seekTimer: ReturnType<typeof setTimeout> | null = null
let abort: AbortController | null = null
/** Days loaded while the bar is open; today is fetched again on every opening (it keeps growing). */
const cache = new Map<string, TimelineReplay>()

const playback: WorldPlayback = {
  clock: () => cur,
  scale: () => (playing.value ? animScale(speed.value) : 0),
}

// ------------------------------------------------------------------ formatting

const hhmmFmt = computed(() => new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }))
const dayFmt = computed(() => new Intl.DateTimeFormat(locale.value, { weekday: 'short', day: 'numeric', month: 'short' }))
const hhmm = (at: number): string => hhmmFmt.value.format(at)

function dayLabel(key: string): string {
  const today = dayKey(Date.now())
  if (key === today) return t('officeV60.timelapse.today')
  if (key === shiftDay(today, -1)) return t('officeV60.timelapse.yesterday')
  return dayFmt.value.format(dayStart(key))
}

const dayOptions = computed(() =>
  days.value.map((d) => ({ value: d.day, label: t('officeV60.timelapse.dayOption', { day: dayLabel(d.day), from: hhmm(d.from), to: hhmm(d.to) }) })),
)
const speedOptions = computed(() =>
  SPEEDS.map((s) => ({ value: s, label: `${s}×`, title: t('officeV60.timelapse.speedHint', { speed: s, hours: s / 60 }) })),
)

const ready = computed(() => status.value === 'ready' && !!replay.value)
const message = computed(() => (messageKey.value ? t(`officeV60.timelapse.${messageKey.value}`) : ''))
const time = computed(() => (replay.value ? hhmm(clock.value) : '--:--'))
const span = computed(() => (replay.value ? `${hhmm(replay.value.from)}–${hhmm(replay.value.to)}` : ''))
const maxSec = computed(() => (replay.value ? Math.max(0, Math.round((replay.value.to - replay.value.from) / 1000)) : 0))
const progress = computed(() => {
  const r = replay.value
  return r && r.to > r.from ? Math.min(100, Math.max(0, ((clock.value - r.from) / (r.to - r.from)) * 100)) : 0
})
const replayDayLabel = computed(() => (replay.value && replay.value.day !== dayKey(Date.now()) ? dayLabel(replay.value.day) : ''))
const valueText = computed(() => (replayDayLabel.value ? `${time.value}, ${replayDayLabel.value}` : time.value))
const playLabel = computed(() =>
  t(playing.value ? 'officeV60.timelapse.pause' : replay.value && clock.value >= replay.value.to ? 'officeV60.timelapse.playAgain' : 'officeV60.timelapse.play'),
)

const pct = (at: number): string => {
  const r = replay.value!
  return `${(((at - r.from) / Math.max(1, r.to - r.from)) * 100).toFixed(2)}%`
}
const chart = computed(() => (replay.value ? chartPaths(replay.value.buckets(VIEW), replay.value.from, replay.value.to) : null))
const peaks = computed(() =>
  (replay.value?.peaks(VIEW) ?? []).map((p) => ({
    at: p.at,
    left: pct(p.at),
    label: t('officeV60.timelapse.peak', { time: hhmm(p.at), working: t('officeV60.timelapse.working', { n: p.working }, p.working) }),
  })),
)
const ticks = computed(() => (replay.value ? hourTicks(replay.value.from, replay.value.to).map((at) => ({ at, left: pct(at), label: hhmm(at) })) : []))

// ------------------------------------------------------------------ loading

function setMessage(s: Status, key: MessageKey): void {
  status.value = s
  messageKey.value = key
}

async function start(): Promise<void> {
  setMessage('loading', 'loadingDays')
  const ctl = (abort = new AbortController())
  let list: TimelineDayInfo[]
  try {
    list = sortDays((await fetchTimelineDays(ctl.signal)).days)
  } catch (err) {
    if (disposed || ctl.signal.aborted) return
    if (isNotFound(err)) return setMessage('empty', 'noHistory')
    console.warn('[timelapse]', err)
    return setMessage('error', 'errorDays')
  }
  if (disposed) return
  days.value = list
  if (!list.length) return setMessage('empty', 'noHistory')
  const today = dayKey(Date.now())
  await loadDay(list.find((d) => d.day === today)?.day ?? list[0]!.day, true)
}

async function loadDay(key: string, autoplay = false): Promise<void> {
  day.value = key
  const wasPlaying = playing.value || autoplay
  const seq = ++loadSeq
  pause()
  let next = cache.get(key)
  if (!next) {
    setMessage('loading', 'loadingDay')
    const signal = abort?.signal
    try {
      next = new TimelineReplay(key, await fetchTimelineDay(key, signal))
    } catch (err) {
      if (disposed || signal?.aborted || seq !== loadSeq) return
      leaveReplay()
      if (isNotFound(err)) return setMessage('empty', 'emptyDay')
      console.warn('[timelapse]', err)
      return setMessage('error', 'errorDay')
    }
    if (disposed) return
    cache.set(key, next)
    if (seq !== loadSeq) return
  }
  if (next.empty) {
    leaveReplay()
    return setMessage('empty', 'emptyDay')
  }
  replay.value = next
  setMessage('ready', '')
  seek(next.from)
  if (wasPlaying) play()
}

function onDayChange(e: Event): void {
  void loadDay((e.target as HTMLSelectElement).value)
}

// ------------------------------------------------------------------ playback

function togglePlay(): void {
  if (playing.value) pause()
  else play()
}

function play(): void {
  const r = replay.value
  if (!r || playing.value) return
  if (cur >= r.to) seek(r.from)
  playing.value = true
  lastReal = performance.now()
  lastPush = lastReal
  if (!raf) raf = requestAnimationFrame(loop)
}

function pause(): void {
  playing.value = false
  if (raf) cancelAnimationFrame(raf)
  raf = 0
  // The exact last moment for the bar (a pause freezes the world on it).
  if (active) push()
}

/** Replay clock; with the window hidden rAF stops and the replay waits with it. */
function loop(): void {
  raf = 0
  const r = replay.value
  if (!playing.value || !r) return
  const real = performance.now()
  const dt = Math.min(250, Math.max(0, real - lastReal))
  lastReal = real
  cur = Math.min(r.to, cur + dt * speed.value)
  const end = cur >= r.to
  if (end || real - lastPush >= PUSH_MS) {
    lastPush = real
    push()
  }
  if (end) {
    playing.value = false
    announcement.value = t('officeV60.timelapse.ended')
    return
  }
  raf = requestAnimationFrame(loop)
}

/** Snapshot of the current instant to the feed (raw: the feed localizes it) and the bar's clock. */
function push(): void {
  const r = replay.value
  if (!r) return
  r.moveTo(cur)
  officeFeed.pushReplay(r.snapshot(cur, VIEW))
  noteKey.value = r.isOff(cur) ? (r.limited ? 'limited' : 'off') : ''
  syncClock()
}

function syncClock(): void {
  clock.value = cur
  const r = replay.value
  // Vue re-applies `value` on every render, so the bound value always follows the replay clock.
  rangeValue.value = String(r ? Math.round((cur - r.from) / 1000) : 0)
}

/** Jump to `at`: restart the world (everyone already in place) and publish that instant. */
function seek(at: number): void {
  const r = replay.value
  if (!r) return
  cur = Math.min(r.to, Math.max(r.from, at))
  active = true
  office.replaying = true
  office.world?.setPlayback?.(playback)
  push()
  lastPush = performance.now()
}

/** Scrubbing: the clock follows the thumb, the world restarts at most every SEEK_MS. */
function scrub(final: boolean): void {
  const r = replay.value
  if (!r || !range.value) return
  cur = Math.min(r.to, Math.max(r.from, r.from + Number(range.value.value) * 1000))
  clock.value = cur
  // Keep the thumb where the pointer or arrow key put it when the clock change re-renders the bar.
  rangeValue.value = range.value.value
  if (seekTimer) clearTimeout(seekTimer)
  seekTimer = null
  const wait = SEEK_MS - (performance.now() - lastSeek)
  if (final || wait <= 0) {
    lastSeek = performance.now()
    seek(cur)
    return
  }
  seekTimer = setTimeout(() => {
    seekTimer = null
    lastSeek = performance.now()
    seek(cur)
  }, wait)
}

function onRangeKey(e: KeyboardEvent): void {
  if (e.key !== ' ') return
  e.preventDefault()
  togglePlay()
}

function seekPeak(at: number): void {
  seek(at)
}

/** Back to the live office: world playback off, feed back on the live snapshots. Keeps the bar open. */
function leaveReplay(): void {
  pause()
  if (seekTimer) clearTimeout(seekTimer)
  seekTimer = null
  replay.value = null
  noteKey.value = ''
  if (!active) return
  active = false
  office.replaying = false
  office.world?.setPlayback?.(null)
  officeFeed.stopReplay()
}

/** "Back to live" / Escape: leave the replay and close the bar, handing focus back to the toolbar button. */
function close(): void {
  const hadFocus = !!root.value?.contains(document.activeElement)
  abort?.abort()
  abort = null
  leaveReplay()
  office.timelapse = false
  if (hadFocus) document.querySelector<HTMLElement>('[data-office-timelapse-toggle]')?.focus()
}

function onBarKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || e.defaultPrevented) return
  e.preventDefault()
  close()
}

// A language switch re-creates the world: the new one gets the replay clock too.
watch(
  () => office.world,
  (w) => {
    if (active && w) w.setPlayback?.(playback)
  },
)

onMounted(() => void start())
onBeforeUnmount(() => {
  disposed = true
  abort?.abort()
  abort = null
  leaveReplay()
})
</script>

<template>
  <div class="pointer-events-none absolute inset-0" data-office-timelapse>
    <div
      v-if="office.replaying && replay"
      class="ccm-menu absolute top-14 left-1/2 flex max-w-[calc(100%-32px)] -translate-x-1/2 items-center gap-2 px-3 py-1.5 text-ink"
      role="status"
      aria-live="off"
      data-lapse-badge
    >
      <History :size="15" class="shrink-0 text-accent-ink" aria-hidden="true" />
      <span class="text-xs font-semibold tracking-[0.12em]">{{ t('officeV60.timelapse.badge') }}</span>
      <strong class="text-sm font-semibold tabular-nums">{{ time }}</strong>
      <span v-if="replayDayLabel" class="truncate text-xs text-ink-muted">{{ replayDayLabel }}</span>
      <span v-if="noteKey" class="truncate text-xs text-warning">{{ t(`officeV60.timelapse.${noteKey}`) }}</span>
    </div>

    <div class="absolute inset-x-0 bottom-3 flex justify-center px-4">
      <section
        ref="root"
        class="ccm-menu pointer-events-auto w-full max-w-[780px] min-w-0 px-3 pt-2.5 pb-2"
        :aria-label="t('officeV60.timelapse.label')"
        :aria-busy="status === 'loading'"
        data-lapse-bar
        @keydown="onBarKey"
      >
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            class="ccm-press inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-control bg-accent-soft text-accent-ink transition-colors disabled:cursor-not-allowed disabled:opacity-45"
            :disabled="!ready"
            :aria-label="playLabel"
            :title="t('officeV60.timelapse.playHint', { action: playLabel })"
            data-lapse-play
            @click="togglePlay()"
          >
            <component :is="playing ? Pause : Play" :size="18" aria-hidden="true" />
          </button>
          <div class="flex min-w-16 flex-col gap-0.5">
            <strong class="text-lg leading-none font-semibold text-ink tabular-nums">{{ time }}</strong>
            <span class="text-2xs leading-none text-ink-muted tabular-nums">{{ span }}</span>
          </div>
          <select
            class="ccm-field h-7 max-w-[230px] min-w-0 cursor-pointer truncate disabled:cursor-not-allowed disabled:opacity-45"
            :value="day"
            :disabled="!days.length"
            :aria-label="t('officeV60.timelapse.day')"
            :title="t('officeV60.timelapse.day')"
            @change="onDayChange"
          >
            <option v-for="o in dayOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
          <span class="flex-1" />
          <div data-lapse-speed class="shrink-0">
            <SegmentedControl v-model="speed" :options="speedOptions" :label="t('officeV60.timelapse.speed')" />
          </div>
          <button type="button" class="ccm-btn shrink-0" :title="t('officeV60.timelapse.liveHint')" data-lapse-live @click="close()">
            <span class="size-2 rounded-full bg-success" aria-hidden="true" />
            {{ t('officeV60.timelapse.live') }}
          </button>
        </div>

        <p
          v-if="!ready && message"
          class="mt-2 flex items-start gap-1.5 px-0.5 text-xs text-ink-muted"
          role="status"
          aria-live="polite"
          :data-lapse-error="status === 'error' ? '' : undefined"
        >
          <LoaderCircle v-if="status === 'loading'" :size="14" class="ccm-spin mt-px shrink-0 text-ink-faint" aria-hidden="true" />
          <CircleAlert v-else-if="status === 'error'" :size="14" class="mt-px shrink-0 text-st-error" aria-hidden="true" />
          <Info v-else :size="14" class="mt-px shrink-0 text-ink-faint" aria-hidden="true" />
          <span data-lapse-msg>{{ message }}</span>
        </p>

        <div class="relative pt-3.5 pb-4">
          <div
            class="relative h-[38px] rounded-inner bg-fill has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-focus"
            :class="status === 'loading' ? 'opacity-50' : ''"
          >
            <svg
              v-if="chart"
              class="absolute inset-0 h-full w-full overflow-hidden rounded-inner"
              :viewBox="`0 0 ${chart.width} ${chart.height}`"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path class="fill-fill-strong" :d="chart.present" />
              <path class="fill-st-working" :d="chart.working" />
              <path class="fill-st-waiting" :d="chart.waiting" />
            </svg>
            <div v-if="replay" class="pointer-events-none absolute inset-y-0 left-0 rounded-inner bg-accent-soft" :style="{ width: `${progress}%` }" aria-hidden="true" />
            <div v-if="replay" class="pointer-events-none absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-accent" :style="{ left: `${progress}%` }" aria-hidden="true" />
            <input
              ref="range"
              type="range"
              class="absolute inset-0 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
              min="0"
              :max="maxSec"
              :step="STEP_S"
              :value="rangeValue"
              :disabled="!ready"
              :aria-label="t('officeV60.timelapse.moment')"
              :aria-valuetext="valueText"
              @input="scrub(false)"
              @change="scrub(true)"
              @keydown="onRangeKey"
            />
            <div v-if="replay" class="pointer-events-none absolute inset-x-0 -top-3.5 h-3">
              <button
                v-for="p in peaks"
                :key="p.at"
                type="button"
                class="pointer-events-auto absolute top-0 flex h-3.5 w-5 -translate-x-1/2 cursor-pointer items-center justify-center text-ink-muted hover:text-ink"
                :style="{ left: p.left }"
                :aria-label="p.label"
                :title="p.label"
                data-lapse-peak
                @click="seekPeak(p.at)"
              >
                <ChevronDown :size="14" :stroke-width="3" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div class="pointer-events-none absolute inset-x-0 bottom-0 h-3" aria-hidden="true">
            <span v-for="k in ticks" :key="k.at" class="absolute -translate-x-1/2 text-2xs leading-none text-ink-faint tabular-nums" :style="{ left: k.left }">{{ k.label }}</span>
          </div>
        </div>
        <p class="sr-only" aria-live="polite">{{ announcement }}</p>
      </section>
    </div>
  </div>
</template>
