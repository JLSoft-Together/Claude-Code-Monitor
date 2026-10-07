<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDownUp, Trash2 } from 'lucide-vue-next'
import { readSessionSort, saveSessionSort, SESSION_SORTS, sortSessions } from '../lib/sessionSort'
import { useConnectionStore } from '../stores/connection'
import { useTerminalsStore } from '../stores/terminals'
import AppSelect from './AppSelect.vue'
import ArtImage from './ArtImage.vue'
import FavoritesList from './FavoritesList.vue'
import JobsList from './JobsList.vue'
import LottieArt from './LottieArt.vue'
import PanelHeader from './PanelHeader.vue'
import SessionCard from './SessionCard.vue'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'

const { t } = useI18n()
const terminals = useTerminalsStore()
const connection = useConnectionStore()
const ui = useUiStore()
const settings = useSettingsStore()

const sortBy = ref(readSessionSort())
watch(sortBy, saveSessionSort)
const sortOptions = computed(() => SESSION_SORTS.map((s) => ({ value: s, label: t(`sessions.sort.${s}`) })))
// While the pointer or focus is inside the list the order is frozen, so a card never moves under a click or a rename.
const frozen = ref(false)
const frozenOrder = ref<string[]>([])
const liveSorted = computed(() => sortSessions(terminals.list, sortBy.value, settings.pinned))
const sorted = computed(() => {
  if (!frozen.value) return liveSorted.value
  const pos = new Map(frozenOrder.value.map((id, i) => [id, i]))
  return [...terminals.list].sort((a, b) => (pos.get(a.id) ?? Infinity) - (pos.get(b.id) ?? Infinity))
})
function freeze(on: boolean): void {
  if (on && !frozen.value) frozenOrder.value = liveSorted.value.map((x) => x.id)
  frozen.value = on
}
watch(sortBy, () => freeze(false))
watch(
  () => settings.pinned,
  () => {
    if (frozen.value) frozenOrder.value = liveSorted.value.map((x) => x.id)
  },
)
watch(
  () => connection.hasData && terminals.list.map((x) => x.id),
  (ids) => {
    if (ids) settings.prunePins(ids)
  },
)
function onPointerLeave(e: PointerEvent): void {
  freeze((e.currentTarget as HTMLElement).contains(document.activeElement))
}
function onFocusOut(e: FocusEvent): void {
  const list = e.currentTarget as HTMLElement
  if (!list.contains(e.relatedTarget as Node | null) && !list.matches(':hover')) freeze(false)
}
const endedCount = computed(() => terminals.list.length - terminals.live.length)
</script>

<template>
  <section id="sessions" aria-labelledby="sessions-title" class="flex min-h-0 flex-col lg:h-full">
    <PanelHeader
      panel="sessions"
      rail="lg"
      title-id="sessions-title"
      body-id="sessions-body"
      :title="t('sessions.title')"
      :meta="t('sessions.count', { n: terminals.live.length })"
    />

    <div v-show="!ui.isCollapsed('sessions')" id="sessions-body">
    <FavoritesList />
    <JobsList />
    <div v-if="connection.hasData && terminals.list.length > 1" class="mb-2.5 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
      <AppSelect v-model="sortBy" :options="sortOptions" :label="t('sessions.sortLabel')" :icon="ArrowDownUp" size="sm" />
      <button
        v-if="endedCount > 0"
        type="button"
        class="ms-auto inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 font-medium text-ink-muted transition-colors hover:bg-raised hover:text-st-error"
        @click="connection.dismissEnded()"
      >
        <Trash2 :size="14" aria-hidden="true" />{{ t('sessions.clearEnded', { n: endedCount }) }}
      </button>
    </div>
    <div v-if="!connection.hasData" class="rounded-xl border border-dashed border-line-strong px-4 py-6 text-sm">
      <template v-if="connection.state === 'disconnected'">
        <p class="font-medium text-st-error">{{ t('sessions.offline') }}</p>
        <p class="mt-1 text-xs text-ink-muted">{{ t('sessions.offlineHint') }}</p>
      </template>
      <div v-else class="flex items-center gap-3">
        <LottieArt name="radar-scan" loop class="size-10 shrink-0" />
        <p class="text-ink-muted">{{ t('sessions.loading') }}</p>
      </div>
    </div>

    <div
      v-else-if="terminals.list.length === 0"
      class="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong px-4 py-6 text-center"
    >
      <ArtImage name="empty-sessions" class="w-40 max-w-full" />
      <p class="text-sm font-medium">{{ t('sessions.empty') }}</p>
      <p class="text-xs text-ink-muted">{{ t('sessions.emptyHint') }}</p>
    </div>

    <TransitionGroup
      v-else
      tag="ul"
      name="ccm-list"
      class="relative grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-1"
      @pointerenter="freeze(true)"
      @pointerleave="onPointerLeave"
      @focusin="freeze(true)"
      @focusout="onFocusOut"
    >
      <li v-for="terminal in sorted" :key="terminal.id">
        <SessionCard :terminal="terminal" />
      </li>
    </TransitionGroup>
    </div>
  </section>
</template>
