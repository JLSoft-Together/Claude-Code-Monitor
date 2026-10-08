<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { LayoutDashboard, X } from 'lucide-vue-next'
import { duration, now } from '../lib/format'
import { statusMeta } from '../lib/status'
import { displayTitle } from '../lib/title'
import { useConnectionStore } from '../stores/connection'
import { useSnoozeStore } from '../stores/snooze'
import { useTerminalsStore } from '../stores/terminals'
import { useUiStore } from '../stores/ui'
import StatusIcon from './StatusIcon.vue'

const { t } = useI18n()
const terminals = useTerminalsStore()
const ui = useUiStore()
const snooze = useSnoozeStore()
const connection = useConnectionStore()
const strip = ref<HTMLElement | null>(null)

const tabs = computed(() =>
  terminals.list.map((x) => {
    const waiting = x.status === 'waiting' && !snooze.isSnoozed(x, now.value)
    return {
      id: x.id,
      title: displayTitle(x) || x.id,
      status: x.status,
      ended: x.status === 'stale',
      waiting,
      waited: waiting ? duration(x.statusSince, now.value) : null,
      meta: statusMeta(x.status),
    }
  }),
)
const ids = computed(() => [null, ...tabs.value.map((x) => x.id)])
const liveCount = computed(() => terminals.live.length)
const waitingCount = computed(() => tabs.value.filter((x) => x.waiting).length)

watch(
  () => ui.sessionTab && !terminals.byId[ui.sessionTab],
  (gone) => {
    if (gone && connection.hasData) ui.openSessionTab(null)
  },
  { immediate: true },
)

function select(id: string | null): void {
  ui.openSessionTab(id)
}

async function reveal(): Promise<void> {
  await nextTick()
  strip.value?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}
watch(() => ui.sessionTab, reveal)

function onKey(e: KeyboardEvent): void {
  const list = ids.value
  const at = list.indexOf(ui.sessionTab)
  let next: number | null = null
  if (e.key === 'ArrowRight') next = (at + 1) % list.length
  else if (e.key === 'ArrowLeft') next = (at - 1 + list.length) % list.length
  else if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = list.length - 1
  if (next === null) return
  e.preventDefault()
  select(list[next] ?? null)
  void nextTick(() => strip.value?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus())
}

function close(id: string): void {
  if (ui.sessionTab === id) select(null)
  connection.dismissEnded(id)
}
</script>

<template>
  <nav
    class="sticky z-20 -mx-4 border-b border-line bg-canvas/95 px-4 backdrop-blur-sm sm:-mx-6 sm:px-6"
    :style="{ top: 'var(--ccm-header-h, 4.5rem)' }"
    :aria-label="t('tabs.label')"
  >
    <div
      ref="strip"
      role="tablist"
      :aria-label="t('tabs.label')"
      class="ccm-scroll -mb-px flex items-end gap-1 overflow-x-auto pt-2"
      @keydown="onKey"
    >
      <button
        type="button"
        role="tab"
        :aria-selected="ui.sessionTab === null"
        :tabindex="ui.sessionTab === null ? 0 : -1"
        class="inline-flex h-10 shrink-0 cursor-pointer items-center gap-2 rounded-t-lg border border-b-0 px-3.5 text-sm transition-colors"
        :class="ui.sessionTab === null ? 'border-line bg-surface font-semibold text-ink' : 'border-transparent text-ink-muted hover:bg-raised hover:text-ink'"
        @click="select(null)"
      >
        <LayoutDashboard :size="15" aria-hidden="true" />
        {{ t('tabs.all') }}
        <span class="rounded-full bg-raised px-1.5 text-2xs text-ink-muted tabular">{{ liveCount }}</span>
        <span v-if="waitingCount" class="rounded-full bg-st-waiting-soft px-1.5 text-2xs font-semibold text-st-waiting tabular" :title="t('tabs.waiting', { n: waitingCount })">
          {{ waitingCount }}
        </span>
      </button>
      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="group/tab relative flex h-10 max-w-[240px] min-w-[120px] shrink-0 items-center rounded-t-lg border border-b-0 transition-colors"
        :class="[
          ui.sessionTab === tab.id ? 'border-line bg-surface' : 'border-transparent hover:bg-raised',
          tab.waiting && ui.sessionTab !== tab.id ? 'bg-st-waiting-soft/60' : '',
          tab.ended ? 'opacity-60' : '',
        ]"
      >
        <span v-if="ui.sessionTab === tab.id" class="absolute inset-x-2 top-0 h-0.5 rounded-full" :class="tab.waiting ? 'bg-st-waiting' : 'bg-accent'" aria-hidden="true" />
        <button
          type="button"
          role="tab"
          :aria-selected="ui.sessionTab === tab.id"
          :tabindex="ui.sessionTab === tab.id ? 0 : -1"
          :title="tab.title"
          class="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 pr-1.5 pl-3 text-left text-sm"
          :class="ui.sessionTab === tab.id ? 'font-semibold text-ink' : 'text-ink-muted hover:text-ink'"
          @click="select(tab.id)"
        >
          <StatusIcon :status="tab.status" :size="14" class="shrink-0" />
          <span class="min-w-0 flex-1 truncate">{{ tab.title }}</span>
          <span class="sr-only">{{ t(tab.meta.labelKey) }}</span>
          <span v-if="tab.waited" class="shrink-0 text-2xs font-semibold text-st-waiting tabular">{{ tab.waited }}</span>
        </button>
        <button
          v-if="tab.ended"
          type="button"
          tabindex="-1"
          class="mr-1.5 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-raised hover:text-st-error"
          :aria-label="t('terminal.dismiss', { title: tab.title })"
          :title="t('terminal.dismiss', { title: tab.title })"
          @click="close(tab.id)"
        >
          <X :size="13" aria-hidden="true" />
        </button>
      </div>
    </div>
  </nav>
</template>
