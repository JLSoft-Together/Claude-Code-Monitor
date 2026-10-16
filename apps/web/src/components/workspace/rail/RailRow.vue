<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { LoaderCircle, Network, X } from 'lucide-vue-next'
import { usePaneInfo, usePeerSweep } from '../../../composables/usePaneInfo'
import { useRailTabStop } from '../../../composables/useRail'
import { duration, now as clock } from '../../../lib/format'
import { isBusyState, peerSlot, rowId, rowLines, stateWord, type RailRow, type RailState } from '../../../lib/rail/railModel'
import { waitDisplay } from '../../../lib/wait'
import StatusIcon from '../../StatusIcon.vue'
import PaneIcon from '../PaneIcon.vue'
import TabRenameInput from '../TabRenameInput.vue'

const props = defineProps<{ row: RailRow; member?: boolean; renaming?: boolean }>()
const emit = defineEmits<{ focus: [paneKey: string]; close: [row: RailRow]; menu: [row: RailRow, event: MouseEvent]; renamed: [tabKey: string, saved: boolean] }>()

const { t } = useI18n()
const { sessionOf, activityOf, peerView, peerLines, coordinatingOf } = usePaneInfo()
const isStop = useRailTabStop()
const stop = computed(() => (isStop(rowId(props.row.key)) ? 0 : -1))

const word = computed(() => {
  const row = props.row
  if (row.run) return t(`run.badge.${row.run}`)
  if (row.state === 'asked') {
    const s = sessionOf(row.pane)
    const wait = s?.status === 'waiting' ? waitDisplay(s.waitingFor, undefined, t) : null
    if (wait) return wait.text
  }
  const w = stateWord(row.state, row.subagents)
  return w.n === undefined ? t(w.key) : t(w.key, { n: w.n }, w.n)
})
const activity = computed(() => (props.row.run ? null : activityOf(props.row.pane)))
const working = computed(() => props.row.state === 'working')
const peer = computed(() => (props.row.peer ? peerView(props.row.peer) : null))
const slot = computed(() => peerSlot(props.row.state, peer.value))
const peerLine = computed(() => (slot.value === 'line' ? peer.value : null))
const tool = computed(() => (working.value && !peerLine.value ? (activity.value?.tool ?? null) : null))
const lines = computed(() => rowLines(props.row, peerLine.value?.text ?? tool.value ?? word.value))
const peerPrefix = computed(() => (peerLine.value ? rowLines(props.row, '').second : ''))
const plainFirst = computed(() => rowLines({ ...props.row, twin: undefined }, '').first)
const elapsed = computed(() => (working.value && !peerLine.value && activity.value?.since ? duration(activity.value.since, clock.value) : null))
const tail = computed(() => (elapsed.value ? t('workspace.activity.tool', { tool: '', time: elapsed.value }) : ''))
const diff = computed(() => {
  const d = activity.value?.diff
  return d && d.files > 0 ? d : null
})
const diffTitle = computed(() =>
  diff.value ? t('workspace.activity.diffTitle', { files: diff.value.files, ins: diff.value.insertions, del: diff.value.deletions }, diff.value.files) : '',
)
const coordinating = computed(() => (props.row.run ? null : coordinatingOf(props.row.pane)))
const relations = computed(() => (props.row.run ? [] : peerLines(props.row.pane)))
const peerSpoken = computed(() => (peerLine.value ? peerLine.value.label : ''))
const spoken = computed(() => {
  if (peerLine.value) return peerPrefix.value + peerSpoken.value
  const base = tool.value ? `${lines.value.second} (${word.value})` : lines.value.second
  return slot.value === 'badge' && peer.value ? `${base}, ${peer.value.label}` : base
})
const label = computed(() => [t('workspace.rail.rowLabel', { first: lines.value.first, second: spoken.value }), coordinating.value?.label].filter(Boolean).join(', '))
const tip = computed(() => [...new Set([lines.value.first, spoken.value, diffTitle.value, ...relations.value].filter(Boolean))].join('\n'))
const tone = computed(() =>
  props.row.state === 'failed'
    ? 'text-st-error'
    : props.row.state === 'asked'
      ? 'text-st-waiting'
      : props.row.focused
        ? 'text-accent-ink'
        : peerLine.value
          ? 'text-ink'
          : 'text-ink-muted',
)
const sweep = usePeerSweep(() => props.row.peer)
const busy = computed(() => isBusyState(props.row.state))

// StatusIcon statuses; idle draws no badge, starting a spinner.
const BADGE: Partial<Record<RailState, string>> = { failed: 'error', asked: 'waiting', working: 'working', subagents: 'working', done: 'completed', ended: 'completed' }
const FLASH: Partial<Record<RailState, string>> = { asked: 'text-st-waiting', done: 'text-st-done', failed: 'text-st-error' }

const flashKey = ref(0)
watch(
  () => props.row.state,
  (now, was) => {
    if (now !== was && FLASH[now]) flashKey.value++
  },
)
const renameKey = ref(0)
watch(
  () => lines.value.first,
  (now, was) => {
    if (now !== was) renameKey.value++
  },
)

const unstamp = (el: Element): void => el.removeAttribute('data-rail-second')
</script>

<template>
  <div
    class="group/row relative grid min-h-10 grid-cols-[16px_minmax(0,1fr)_24px] items-center gap-x-2 rounded-inner py-1 pr-0.5 outline-1 -outline-offset-1 outline-transparent transition-[background-color,outline-color] duration-(--ccm-dur-fast) data-dragging:bg-fill data-drop-on:bg-accent-soft"
    :class="[member ? 'pl-9' : 'pl-5 data-drop-on:outline-accent', row.focused ? 'bg-accent-soft text-accent-ink' : 'text-ink hover:bg-fill']"
    data-rail-row
    :data-rail-member="member ? row.tabKey : undefined"
    :data-state="row.state"
    data-rail-drag
    :data-drag-kind="row.key.startsWith('tab:') ? 'tab' : 'pane'"
    :data-drag-pane="row.paneKey"
    :data-drag-tab="row.tabKey"
    :data-drag-title="lines.first"
    data-rail-drop
    :data-drop-tab="row.tabKey"
    @contextmenu.prevent.stop="emit('menu', row, $event)"
  >
    <span v-if="member" class="pointer-events-none absolute inset-y-0 left-[27px] w-px bg-line" aria-hidden="true" />
    <span v-if="busy" class="ccm-rail-bar" aria-hidden="true" />
    <span v-if="sweep" :key="sweep" class="ccm-peer-sweep absolute top-1.5 bottom-1.5 left-[3px] w-0.5" aria-hidden="true" data-rail-peer-sweep />
    <span v-if="flashKey" :key="flashKey" class="ccm-flash pointer-events-none absolute inset-0 rounded-inner" :class="FLASH[row.state]" aria-hidden="true" />
    <button
      v-if="!renaming"
      type="button"
      data-side-item
      data-side-row
      :data-side-id="rowId(row.key)"
      :data-side-pane="row.paneKey"
      :data-row-key="row.key"
      :data-tab-key="row.tabKey"
      class="absolute inset-0 cursor-pointer rounded-inner"
      role="treeitem"
      :aria-level="member ? 3 : 2"
      :aria-selected="row.focused"
      :aria-current="row.focused ? 'true' : undefined"
      :aria-label="label"
      :tabindex="stop"
      :title="tip"
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
      <Transition name="ccm-fade">
        <span v-if="slot === 'badge' && peer" class="absolute -top-1 -right-1 inline-flex rounded-full bg-surface p-px" aria-hidden="true" data-rail-peer-badge>
          <component :is="peer.glyph" :size="8" :class="peer.tone" />
        </span>
      </Transition>
    </span>
    <span class="min-w-0" :class="renaming ? 'relative z-10' : 'pointer-events-none'">
      <TabRenameInput v-if="renaming" :tab-key="row.tabKey" :initial="plainFirst" @done="(saved) => emit('renamed', row.tabKey, saved)" />
      <span
        v-else
        :key="renameKey"
        class="block truncate rounded-[4px] text-xs"
        :class="[row.focused ? 'font-medium' : '', renameKey ? 'ccm-highlight' : '']"
        data-rail-first
        >{{ lines.first }}</span
      >
      <span class="flex h-4 min-w-0 flex-wrap items-center overflow-hidden text-2xs" :class="tone">
        <span class="flex min-w-[min(100%,14ch)] flex-1 basis-0 items-center">
          <span class="relative min-w-0 overflow-hidden">
            <Transition name="ccm-rail-word" @before-leave="unstamp">
              <span v-if="peerLine" :key="lines.second" class="block truncate" data-rail-second :data-rail-peer="row.peer?.dir"
                >{{ peerPrefix }}<component :is="peerLine.glyph" :size="12" class="mr-1 inline-block align-[-2px]" :class="peerLine.tone" aria-hidden="true" />{{
                  peerLine.text
                }}</span
              >
              <span v-else :key="lines.second" class="block truncate" data-rail-second
                >{{ lines.second }}<span v-if="tool" class="sr-only"> ({{ word }})</span></span
              >
            </Transition>
          </span>
          <Transition name="ccm-fade">
            <span v-if="tail" class="shrink-0 whitespace-pre tabular-nums" data-rail-activity>{{ tail }}</span>
          </Transition>
        </span>
        <Transition name="ccm-fade">
          <span v-if="diff" class="shrink-0 pl-1.5 tabular-nums" aria-hidden="true" data-rail-diff
            ><span class="text-diff-add">+{{ diff.insertions }}</span> <span class="text-diff-del">−{{ diff.deletions }}</span></span
          >
        </Transition>
        <Transition name="ccm-fade">
          <span v-if="coordinating" class="inline-flex shrink-0 items-center pl-1.5 text-ink-faint" aria-hidden="true" :data-rail-coordinating="coordinating.n"
            ><Network :size="10"
          /></span>
        </Transition>
      </span>
    </span>
    <button
      type="button"
      class="relative z-10 inline-flex size-6 cursor-pointer items-center justify-center rounded-[6px] text-ink-faint opacity-0 transition-opacity duration-(--ccm-dur-fast) ease-out-quint group-hover/row:opacity-100 group-focus-within/row:opacity-100 hover:bg-fill-strong hover:text-ink focus-visible:opacity-100"
      :title="t('workspace.rail.closeRow', { name: lines.first })"
      :aria-label="t('workspace.rail.closeRow', { name: lines.first })"
      :tabindex="stop"
      data-rail-close
      data-no-drag
      @click.stop="emit('close', row)"
    >
      <X :size="12" aria-hidden="true" />
    </button>
  </div>
</template>
