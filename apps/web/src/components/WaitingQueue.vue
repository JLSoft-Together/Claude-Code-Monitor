<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlarmClock, AppWindow, BellOff, BellRing, Hand, LoaderCircle } from 'lucide-vue-next'
import { duration, now } from '../lib/format'
import { displayTitle } from '../lib/title'
import { waitDisplay } from '../lib/wait'
import { useAgentsStore } from '../stores/agents'
import { useConnectionStore } from '../stores/connection'
import { useExtrasStore } from '../stores/extras'
import { SNOOZE_CHOICES, useSnoozeStore } from '../stores/snooze'
import { useTerminalsStore } from '../stores/terminals'
import { useUiStore } from '../stores/ui'
import { LONG_WAIT_MS } from '../composables/useNotifications'

const { t, locale } = useI18n()
const snooze = useSnoozeStore()
const agents = useAgentsStore()
const clock = computed(() => new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit', hour12: false }))

function toggleSnooze(id: string): void {
  const x = terminals.byId[id]
  if (!x) return
  if (snooze.isSnoozed(x, now.value)) snooze.clear(id)
  else snooze.snooze(x, SNOOZE_CHOICES[0])
}
const terminals = useTerminalsStore()
const ui = useUiStore()
const extras = useExtrasStore()
const connection = useConnectionStore()

function jump(id: string): void {
  if (!connection.focusWindow(id)) ui.reportWindowResult(id, 'offline')
}

const queue = computed(() =>
  terminals.live
    .filter((x) => x.status === 'waiting')
    .map((x) => {
      const since = x.statusSince ? Date.parse(x.statusSince) : NaN
      const waitedMs = Number.isFinite(since) ? now.value - since : null
      const until = snooze.until(x, now.value)
      const wait = waitDisplay(x.waitingFor, agents.mainOf(x.id)?.currentTool, t)
      return {
        snoozedUntil: until === null ? null : clock.value.format(until),
        id: x.id,
        title: displayTitle(x),
        reason: wait?.text,
        icon: wait && wait.reason !== 'other' ? wait.icon : null,
        raw: wait?.reason === 'other',
        waited: x.statusSince ? duration(x.statusSince, now.value) : null,
        long: waitedMs !== null && waitedMs >= LONG_WAIT_MS,
        since: Number.isFinite(since) ? since : Number.MAX_SAFE_INTEGER,
        job: false,
        canJump: !!x.processId,
      }
    })
    .concat(
      extras.blockedJobs.map((j) => {
        const since = j.stateSince ? Date.parse(j.stateSince) : NaN
        const waitedMs = Number.isFinite(since) ? now.value - since : null
        return {
          snoozedUntil: null as string | null,
          id: `job:${j.id}`,
          title: j.name ?? j.id,
          reason: t('jobs.blockedReason') as string | undefined,
          icon: null,
          raw: false,
          waited: j.stateSince ? duration(j.stateSince, now.value) : null,
          long: waitedMs !== null && waitedMs >= LONG_WAIT_MS,
          since: Number.isFinite(since) ? since : Number.MAX_SAFE_INTEGER,
          job: true,
          canJump: false,
        }
      }),
    )
    .sort((a, b) => Number(!!a.snoozedUntil) - Number(!!b.snoozedUntil) || a.since - b.since || a.title.localeCompare(b.title)),
)
const active = computed(() => queue.value.filter((q) => !q.snoozedUntil).length)
</script>

<template>
  <Transition
    enter-active-class="transition duration-(--ccm-dur-base) ease-out-quint"
    enter-from-class="opacity-0 -translate-y-1"
    leave-active-class="transition duration-(--ccm-dur-fast) ease-exit"
    leave-to-class="opacity-0"
  >
    <section
      v-if="queue.length"
      aria-labelledby="waiting-title"
      class="rounded-card bg-st-waiting-soft px-3 py-2.5 sm:px-4"
    >
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="waiting-title" class="inline-flex items-center gap-1.5 text-sm font-semibold text-st-waiting">
          <Hand :size="16" aria-hidden="true" />{{ t('waiting.title', { n: active }) }}
        </h2>
        <TransitionGroup tag="ul" name="ccm-list" class="ccm-list-inflow relative flex min-w-0 flex-1 flex-wrap gap-2">
          <li
            v-for="item in queue"
            :key="item.id"
            class="flex h-7 min-w-0 items-stretch rounded-inner bg-control shadow-control *:first:rounded-l-inner *:last:rounded-r-inner"
            :class="[item.snoozedUntil ? 'text-ink-muted' : '', item.long && !item.snoozedUntil ? 'ring-1 ring-st-error/50' : '']"
          >
            <component
              :is="item.job ? 'span' : 'button'"
              :type="item.job ? undefined : 'button'"
              class="inline-flex h-full max-w-full min-w-0 items-center gap-2 px-2.5 text-xs transition-colors"
              :class="item.job ? 'cursor-default' : 'cursor-pointer hover:bg-fill'"
              :title="item.reason ? (item.raw ? t('terminal.waitingFor', { reason: item.reason }) : item.reason) : undefined"
              :aria-label="t('waiting.focus', { title: item.title, waited: item.waited ?? '—' })"
              @click="item.job ? undefined : ui.focusTerminal(item.id)"
            >
              <span v-if="item.job" class="shrink-0 rounded-[4px] bg-fill px-1.5 text-2xs font-medium text-ink-muted">{{ t('jobs.badge') }}</span>
              <span class="min-w-0 truncate font-medium">{{ item.title }}</span>
              <span v-if="item.reason" class="hidden max-w-[22ch] items-center gap-1 text-xs text-ink-muted sm:inline-flex">
                <component :is="item.icon" v-if="item.icon" :size="13" class="shrink-0" aria-hidden="true" />
                <span class="truncate">{{ item.reason }}</span>
              </span>
              <span v-if="item.snoozedUntil" class="inline-flex shrink-0 items-center gap-1 text-xs text-ink-muted tabular">
                <BellOff :size="13" aria-hidden="true" />{{ item.snoozedUntil }}
              </span>
              <span
                v-else-if="item.waited"
                class="inline-flex shrink-0 items-center gap-1 text-xs tabular"
                :class="item.long ? 'font-semibold text-st-error' : 'text-st-waiting'"
              >
                <AlarmClock v-if="item.long" :size="13" aria-hidden="true" />{{ item.waited }}
              </span>
            </component>
            <button
              v-if="!item.job"
              type="button"
              class="inline-flex w-7 shrink-0 cursor-pointer items-center justify-center border-l border-line text-ink-muted transition-colors hover:bg-fill hover:text-ink"
              :aria-label="item.snoozedUntil ? t('snooze.clear', { title: item.title }) : t('snooze.action', { title: item.title, n: SNOOZE_CHOICES[0] })"
              :title="item.snoozedUntil ? t('snooze.clearTitle', { at: item.snoozedUntil }) : t('snooze.title', { n: SNOOZE_CHOICES[0] })"
              :aria-pressed="!!item.snoozedUntil"
              @click="toggleSnooze(item.id)"
            >
              <BellRing v-if="item.snoozedUntil" :size="14" aria-hidden="true" />
              <BellOff v-else :size="14" aria-hidden="true" />
            </button>
            <button
              v-if="item.canJump"
              type="button"
              class="inline-flex w-7 shrink-0 cursor-pointer items-center justify-center border-l border-line text-ink-muted transition-colors hover:bg-fill hover:text-ink"
              :class="ui.windowResult?.terminalId === item.id && ui.windowResult.result !== 'ok' && ui.windowResult.result !== 'appOnly' ? 'bg-st-error-soft text-st-error' : ''"
              :aria-label="t('terminal.jump', { title: item.title })"
              :title="ui.windowResult?.terminalId === item.id && ui.windowResult.result !== 'ok' ? t(`terminal.jumpError.${ui.windowResult.result}`) : t('terminal.jumpTitle')"
              @click="jump(item.id)"
            >
              <LoaderCircle v-if="ui.focusingWindow === item.id" :size="14" class="animate-spin" aria-hidden="true" />
              <AppWindow v-else :size="14" aria-hidden="true" />
            </button>
          </li>
        </TransitionGroup>
      </div>
    </section>
  </Transition>
</template>
