<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { TerminalSession } from '@ccm/shared'
import { AlarmClock, AppWindow, BellOff, BellRing, Hand, LoaderCircle } from 'lucide-vue-next'
import { duration, now } from '../lib/format'
import { statusMeta } from '../lib/status'
import { displayTitle } from '../lib/title'
import { LONG_WAIT_MS } from '../composables/useNotifications'
import { useConnectionStore } from '../stores/connection'
import { useExtrasStore } from '../stores/extras'
import { SNOOZE_CHOICES, useSnoozeStore } from '../stores/snooze'
import { useTerminalsStore } from '../stores/terminals'
import { useUiStore } from '../stores/ui'
import StatusIcon from './StatusIcon.vue'

const { t, locale } = useI18n()
const terminals = useTerminalsStore()
const extras = useExtrasStore()
const snooze = useSnoozeStore()
const connection = useConnectionStore()
const ui = useUiStore()

const clock = computed(() => new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit', hour12: false }))
const sinceMs = (iso?: string) => {
  const v = iso ? Date.parse(iso) : NaN
  return Number.isFinite(v) ? v : Number.MAX_SAFE_INTEGER
}

interface Row {
  id: string
  title: string
  status: string
  detail?: string
  elapsed: string | null
  long: boolean
  snoozedUntil: string | null
  since: number
  job: boolean
  canJump: boolean
}

function row(x: TerminalSession): Row {
  const since = sinceMs(x.statusSince)
  const until = snooze.until(x, now.value)
  return {
    id: x.id,
    title: displayTitle(x),
    status: x.status,
    detail: x.status === 'waiting' ? x.waitingFor : x.gitBranch,
    elapsed: duration(x.statusSince, now.value),
    long: x.status === 'waiting' && now.value - since >= LONG_WAIT_MS,
    snoozedUntil: until === null ? null : clock.value.format(until),
    since,
    job: false,
    canJump: !!x.processId,
  }
}

const byAge = (a: Row, b: Row) => a.since - b.since || a.title.localeCompare(b.title)

const waiting = computed(() =>
  terminals.live
    .filter((x) => x.status === 'waiting')
    .map(row)
    .concat(
      extras.blockedJobs.map((j) => {
        const since = sinceMs(j.stateSince)
        return {
          id: `job:${j.id}`,
          title: j.name ?? j.id,
          status: 'waiting',
          detail: t('jobs.blockedReason'),
          elapsed: duration(j.stateSince, now.value),
          long: now.value - since >= LONG_WAIT_MS,
          snoozedUntil: null,
          since,
          job: true,
          canJump: false,
        }
      }),
    )
    .sort((a, b) => Number(!!a.snoozedUntil) - Number(!!b.snoozedUntil) || byAge(a, b)),
)
const activeWaiting = computed(() => waiting.value.filter((r) => !r.snoozedUntil).length)
const working = computed(() => terminals.live.filter((x) => x.status === 'working').map(row).sort(byAge))
const others = computed(() => terminals.live.filter((x) => x.status !== 'waiting' && x.status !== 'working').map(row).sort(byAge))

function open(r: Row): void {
  if (r.job) return
  if (r.canJump) {
    if (!connection.focusWindow(r.id)) ui.reportWindowResult(r.id, 'offline')
    return
  }
  ui.setView('monitor')
  ui.focusTerminal(r.id)
}

function toggleSnooze(id: string): void {
  const x = terminals.byId[id]
  if (!x) return
  if (snooze.isSnoozed(x, now.value)) snooze.clear(id)
  else snooze.snooze(x, SNOOZE_CHOICES[0])
}

const jumpError = (id: string) => (ui.windowResult?.terminalId === id && ui.windowResult.result !== 'ok' ? t(`terminal.jumpError.${ui.windowResult.result}`) : null)
const openLabel = (r: Row) => (r.canJump ? t('terminal.jump', { title: r.title }) : t('compact.show', { title: r.title }))
</script>

<template>
  <main class="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-4 py-4 sm:px-6">
    <section aria-labelledby="compact-waiting" class="flex flex-col gap-2">
      <h2 id="compact-waiting" class="inline-flex items-center gap-2 text-base font-semibold" :class="activeWaiting ? 'text-st-waiting' : 'text-ink-muted'">
        <Hand :size="18" aria-hidden="true" />{{ t('waiting.title', { n: activeWaiting }) }}
      </h2>
      <p v-if="!waiting.length" class="rounded-xl border border-line bg-surface px-4 py-5 text-base text-ink-muted">
        {{ t('compact.allClear') }}
      </p>
      <TransitionGroup v-else tag="ul" name="ccm-list" class="relative flex flex-col gap-2">
        <li
          v-for="r in waiting"
          :key="r.id"
          class="flex min-w-0 items-stretch overflow-hidden rounded-xl border bg-surface"
          :class="[r.snoozedUntil ? 'border-line opacity-60' : r.long ? 'border-st-error/60' : 'border-st-waiting/50']"
        >
          <component
            :is="r.job ? 'div' : 'button'"
            :type="r.job ? undefined : 'button'"
            class="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left"
            :class="r.job ? '' : 'cursor-pointer transition-colors hover:bg-raised'"
            :aria-label="r.job ? undefined : openLabel(r)"
            :title="jumpError(r.id) ?? (r.job ? undefined : openLabel(r))"
            @click="open(r)"
          >
            <span v-if="r.job" class="shrink-0 rounded-md bg-raised px-1.5 text-xs font-medium text-ink-muted">{{ t('jobs.badge') }}</span>
            <StatusIcon v-else status="waiting" :size="20" />
            <span class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-lg font-semibold leading-snug">{{ r.title }}</span>
              <span v-if="r.detail" class="truncate text-sm text-ink-muted">{{ r.detail }}</span>
              <span v-if="jumpError(r.id)" class="text-sm text-st-error">{{ jumpError(r.id) }}</span>
            </span>
            <span v-if="r.snoozedUntil" class="inline-flex shrink-0 items-center gap-1.5 text-base text-ink-muted tabular">
              <BellOff :size="16" aria-hidden="true" />{{ r.snoozedUntil }}
            </span>
            <span v-else-if="r.elapsed" class="inline-flex shrink-0 items-center gap-1.5 text-xl tabular" :class="r.long ? 'font-semibold text-st-error' : 'text-st-waiting'">
              <AlarmClock v-if="r.long" :size="18" aria-hidden="true" />{{ r.elapsed }}
            </span>
          </component>
          <button
            v-if="!r.job"
            type="button"
            class="inline-flex w-12 shrink-0 cursor-pointer items-center justify-center border-l border-line text-ink-muted transition-colors hover:bg-raised hover:text-ink"
            :aria-label="r.snoozedUntil ? t('snooze.clear', { title: r.title }) : t('snooze.action', { title: r.title, n: SNOOZE_CHOICES[0] })"
            :title="r.snoozedUntil ? t('snooze.clearTitle', { at: r.snoozedUntil }) : t('snooze.title', { n: SNOOZE_CHOICES[0] })"
            :aria-pressed="!!r.snoozedUntil"
            @click="toggleSnooze(r.id)"
          >
            <BellRing v-if="r.snoozedUntil" :size="18" aria-hidden="true" />
            <BellOff v-else :size="18" aria-hidden="true" />
          </button>
          <span v-if="ui.focusingWindow === r.id" class="inline-flex w-12 shrink-0 items-center justify-center border-l border-line text-ink-muted">
            <LoaderCircle :size="18" class="animate-spin" aria-hidden="true" />
          </span>
        </li>
      </TransitionGroup>
    </section>

    <section v-for="group in [{ key: 'working', rows: working }, { key: 'other', rows: others }]" v-show="group.rows.length" :key="group.key" :aria-labelledby="`compact-${group.key}`" class="flex flex-col gap-2">
      <h2 :id="`compact-${group.key}`" class="text-sm font-semibold text-ink-muted">{{ t(`compact.${group.key}`, { n: group.rows.length }) }}</h2>
      <TransitionGroup tag="ul" name="ccm-list" class="relative flex flex-col overflow-hidden rounded-xl border border-line bg-surface">
        <li v-for="r in group.rows" :key="r.id" class="border-b border-line last:border-b-0">
          <button
            type="button"
            class="flex w-full min-w-0 cursor-pointer items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-raised"
            :aria-label="openLabel(r)"
            :title="jumpError(r.id) ?? openLabel(r)"
            @click="open(r)"
          >
            <StatusIcon :status="r.status" :size="17" />
            <span class="min-w-0 flex-1 truncate text-base font-medium">{{ r.title }}</span>
            <span v-if="r.detail" class="hidden max-w-[18ch] truncate text-sm text-ink-muted sm:inline">{{ r.detail }}</span>
            <span class="shrink-0 text-sm" :class="statusMeta(r.status).text">{{ t(statusMeta(r.status).labelKey) }}</span>
            <span v-if="r.elapsed" class="w-[8ch] shrink-0 text-right text-sm text-ink-muted tabular">{{ r.elapsed }}</span>
            <LoaderCircle v-if="ui.focusingWindow === r.id" :size="16" class="shrink-0 animate-spin text-ink-muted" aria-hidden="true" />
          </button>
        </li>
      </TransitionGroup>
    </section>

    <p v-if="!terminals.live.length" class="py-8 text-center text-base text-ink-muted">{{ t('compact.empty') }}</p>
  </main>
</template>
