<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlarmClock, AppWindow, Hand, LoaderCircle } from 'lucide-vue-next'
import { duration, now } from '../lib/format'
import { displayTitle } from '../lib/title'
import { useConnectionStore } from '../stores/connection'
import { useExtrasStore } from '../stores/extras'
import { useTerminalsStore } from '../stores/terminals'
import { useUiStore } from '../stores/ui'
import { LONG_WAIT_MS } from '../composables/useNotifications'

const { t } = useI18n()
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
      return {
        id: x.id,
        title: displayTitle(x),
        reason: x.waitingFor,
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
          id: `job:${j.id}`,
          title: j.name ?? j.id,
          reason: t('jobs.blockedReason'),
          waited: j.stateSince ? duration(j.stateSince, now.value) : null,
          long: waitedMs !== null && waitedMs >= LONG_WAIT_MS,
          since: Number.isFinite(since) ? since : Number.MAX_SAFE_INTEGER,
          job: true,
          canJump: false,
        }
      }),
    )
    .sort((a, b) => a.since - b.since || a.title.localeCompare(b.title)),
)
</script>

<template>
  <Transition
    enter-active-class="transition duration-200 ease-out motion-reduce:transition-none"
    enter-from-class="opacity-0 -translate-y-1"
    leave-active-class="transition duration-150 ease-in motion-reduce:transition-none"
    leave-to-class="opacity-0"
  >
    <section
      v-if="queue.length"
      aria-labelledby="waiting-title"
      class="rounded-xl border border-st-waiting/40 bg-st-waiting-soft px-3 py-2.5 sm:px-4"
    >
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="waiting-title" class="inline-flex items-center gap-1.5 text-sm font-semibold text-st-waiting">
          <Hand :size="16" aria-hidden="true" />{{ t('waiting.title', { n: queue.length }) }}
        </h2>
        <TransitionGroup tag="ul" name="ccm-list" class="relative flex min-w-0 flex-1 flex-wrap gap-2">
          <li v-for="item in queue" :key="item.id" class="flex min-w-0 items-center">
            <component
              :is="item.job ? 'span' : 'button'"
              :type="item.job ? undefined : 'button'"
              class="inline-flex h-9 max-w-full items-center gap-2 rounded-lg border bg-surface px-3 text-sm transition-colors hover:border-st-waiting"
              :class="[item.long ? 'border-st-error/50' : 'border-line', item.job ? 'cursor-default' : 'cursor-pointer', item.canJump ? 'rounded-r-none' : '']"
              :title="item.reason ? t('terminal.waitingFor', { reason: item.reason }) : undefined"
              :aria-label="t('waiting.focus', { title: item.title, waited: item.waited ?? '—' })"
              @click="item.job ? undefined : ui.focusTerminal(item.id)"
            >
              <span v-if="item.job" class="shrink-0 rounded-md bg-raised px-1.5 text-2xs font-medium text-ink-muted">{{ t('jobs.badge') }}</span>
              <span class="min-w-0 truncate font-medium">{{ item.title }}</span>
              <span v-if="item.reason" class="hidden max-w-[16ch] truncate text-xs text-ink-muted sm:inline">{{ item.reason }}</span>
              <span
                v-if="item.waited"
                class="inline-flex shrink-0 items-center gap-1 text-xs tabular"
                :class="item.long ? 'font-semibold text-st-error' : 'text-st-waiting'"
              >
                <AlarmClock v-if="item.long" :size="13" aria-hidden="true" />{{ item.waited }}
              </span>
            </component>
            <button
              v-if="item.canJump"
              type="button"
              class="-ml-px inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-l-none rounded-r-lg border border-line bg-surface text-ink-muted transition-colors hover:border-st-waiting hover:text-ink"
              :class="ui.windowResult?.terminalId === item.id && ui.windowResult.result !== 'ok' ? 'border-st-error text-st-error' : ''"
              :aria-label="t('terminal.jump', { title: item.title })"
              :title="ui.windowResult?.terminalId === item.id && ui.windowResult.result !== 'ok' ? t(`terminal.jumpError.${ui.windowResult.result}`) : t('terminal.jumpTitle')"
              @click="jump(item.id)"
            >
              <LoaderCircle v-if="ui.focusingWindow === item.id" :size="15" class="animate-spin" aria-hidden="true" />
              <AppWindow v-else :size="15" aria-hidden="true" />
            </button>
          </li>
        </TransitionGroup>
      </div>
    </section>
  </Transition>
</template>
