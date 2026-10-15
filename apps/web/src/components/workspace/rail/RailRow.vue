<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { LoaderCircle, X } from 'lucide-vue-next'
import { usePaneInfo } from '../../../composables/usePaneInfo'
import { rowLines, type RailRow, type RailState } from '../../../lib/rail/railModel'
import { waitDisplay } from '../../../lib/wait'
import StatusIcon from '../../StatusIcon.vue'
import PaneIcon from '../PaneIcon.vue'

const props = defineProps<{ row: RailRow }>()
const emit = defineEmits<{ focus: [paneKey: string]; close: [row: RailRow]; menu: [row: RailRow, event: MouseEvent] }>()

const { t } = useI18n()
const { sessionOf } = usePaneInfo()

const word = computed(() => {
  const row = props.row
  if (row.run) return t(`run.badge.${row.run}`)
  if (row.state === 'asked') {
    const s = sessionOf(row.pane)
    const wait = s?.status === 'waiting' ? waitDisplay(s.waitingFor, undefined, t) : null
    if (wait) return wait.text
  }
  return t(`workspace.rail.state.${row.state}`)
})
const lines = computed(() => rowLines(props.row, word.value))

// StatusIcon statuses; idle draws no badge, starting a spinner.
const BADGE: Partial<Record<RailState, string>> = { failed: 'error', asked: 'waiting', working: 'working', done: 'completed', ended: 'completed' }
</script>

<template>
  <div
    class="group/row relative grid min-h-10 grid-cols-[16px_minmax(0,1fr)_20px] items-center gap-x-2 rounded-inner py-1 pr-1 pl-5 transition-colors duration-(--ccm-dur-fast)"
    :class="row.focused ? 'bg-accent-soft text-accent-ink' : 'text-ink hover:bg-fill'"
    data-rail-row
    :data-state="row.state"
    @contextmenu.prevent.stop="emit('menu', row, $event)"
  >
    <button
      type="button"
      data-side-item
      data-side-row
      :data-side-pane="row.paneKey"
      :data-row-key="row.key"
      class="absolute inset-0 cursor-pointer rounded-inner"
      :aria-current="row.focused ? 'true' : undefined"
      :aria-label="t('workspace.rail.rowLabel', lines)"
      :title="`${lines.first}\n${lines.second}`"
      @click="emit('focus', row.paneKey)"
    />
    <span class="pointer-events-none relative inline-flex size-4 items-center justify-center">
      <PaneIcon :pane="row.pane" :size="15" />
      <span v-if="row.state === 'starting'" class="absolute -bottom-1 -left-1 inline-flex rounded-full bg-surface">
        <LoaderCircle :size="9" class="ccm-spin text-ink-faint" aria-hidden="true" />
      </span>
      <span v-else-if="BADGE[row.state]" class="absolute -bottom-1 -left-1 inline-flex rounded-full bg-surface">
        <StatusIcon :status="BADGE[row.state]!" :size="9" />
      </span>
    </span>
    <span class="pointer-events-none min-w-0">
      <span class="block truncate text-xs" :class="row.focused ? 'font-medium' : ''" data-rail-first>{{ lines.first }}</span>
      <span
        class="block truncate text-2xs"
        :class="row.state === 'failed' ? 'text-st-error' : row.state === 'asked' ? 'text-st-waiting' : row.focused ? 'text-accent-ink' : 'text-ink-muted'"
        data-rail-second
        >{{ lines.second }}</span
      >
    </span>
    <button
      type="button"
      class="relative z-10 inline-flex size-5 cursor-pointer items-center justify-center rounded-[5px] text-ink-faint opacity-0 group-hover/row:opacity-100 hover:bg-fill-strong hover:text-ink focus-visible:opacity-100"
      :title="t('workspace.rail.closeRow', { name: lines.first })"
      :aria-label="t('workspace.rail.closeRow', { name: lines.first })"
      data-rail-close
      @click.stop="emit('close', row)"
    >
      <X :size="12" aria-hidden="true" />
    </button>
  </div>
</template>
