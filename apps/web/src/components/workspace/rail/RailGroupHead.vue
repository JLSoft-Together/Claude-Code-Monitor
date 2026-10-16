<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, LoaderCircle, X } from 'lucide-vue-next'
import { usePaneInfo, usePeerSweep } from '../../../composables/usePaneInfo'
import { useRailTabStop } from '../../../composables/useRail'
import { duration, now as clock } from '../../../lib/format'
import { stateWord, type RailGroup, type RailState } from '../../../lib/rail/railModel'
import { useWorkspaceStore } from '../../../stores/workspace'
import StatusIcon from '../../StatusIcon.vue'
import TabRenameInput from '../TabRenameInput.vue'
import TabLayoutGlyph from './TabLayoutGlyph.vue'

const props = defineProps<{ group: RailGroup; renaming?: boolean }>()
const emit = defineEmits<{
  activate: [group: RailGroup]
  fold: [group: RailGroup, folded: boolean]
  close: [group: RailGroup]
  rename: [group: RailGroup]
  renamed: [tabKey: string, saved: boolean]
  menu: [group: RailGroup, event: MouseEvent]
}>()

const { t } = useI18n()
const workspace = useWorkspaceStore()
const { activityOf, peerView } = usePaneInfo()
const isStop = useRailTabStop()
const stop = computed(() => (isStop(props.group.key) ? 0 : -1))

const BADGE: Partial<Record<RailState, string>> = { failed: 'error', asked: 'waiting', working: 'working', subagents: 'working', done: 'completed', ended: 'completed' }
const FLASH: Partial<Record<RailState, string>> = { asked: 'text-st-waiting', done: 'text-st-done', failed: 'text-st-error' }
const TONE: Partial<Record<RailState, string>> = { asked: 'text-st-waiting', failed: 'text-st-error' }
const unstamp = (el: Element): void => el.removeAttribute('data-rail-group-line')

const word = computed(() => {
  const w = stateWord(props.group.state, props.group.subagents)
  return w.n === undefined ? t(w.key) : t(w.key, { n: w.n }, w.n)
})
const leadPane = computed(() => (props.group.state === 'working' && props.group.lead ? workspace.panes.find((p) => p.key === props.group.lead) : undefined))
const peer = computed(() => (props.group.peer ? peerView(props.group.peer) : null))
const activity = computed(() => (leadPane.value && !peer.value ? activityOf(leadPane.value) : null))
const tool = computed(() => activity.value?.tool ?? null)
const line = computed(() => peer.value?.text ?? tool.value ?? word.value)
const elapsed = computed(() => (activity.value?.since ? duration(activity.value.since, clock.value) : null))
const tail = computed(() => (elapsed.value ? t('workspace.activity.tool', { tool: '', time: elapsed.value }) : ''))
const spoken = computed(() => (peer.value ? `${peer.value.label} (${word.value})` : tool.value ? `${tool.value} (${word.value})` : word.value))
const sweep = usePeerSweep(() => (props.group.folded ? props.group.peer : null))
const panes = computed(() => t('workspace.railGroup.panes', { n: props.group.count }, props.group.count))
const lit = computed(() => props.group.focused && (props.group.folded || !props.group.paneKeys.includes(workspace.activeKey ?? '')))
const activePane = computed(() => (props.group.tabActive && props.group.paneKeys.includes(workspace.activeKey ?? '') ? workspace.activeKey : null))
const tip = computed(() => `${props.group.title}\n${spoken.value}\n${t('workspace.railGroup.hint')}`)
const foldLabel = computed(() => t(props.group.folded ? 'workspace.railGroup.unfold' : 'workspace.railGroup.fold', { name: props.group.title }))

const titleKey = ref(0)
watch(
  () => props.group.title,
  (now, was) => {
    if (now !== was) titleKey.value++
  },
)
const flashKey = ref(0)
watch(
  () => props.group.state,
  (now, was) => {
    if (now !== was && props.group.folded && FLASH[now]) flashKey.value++
  },
)
</script>

<template>
  <div
    class="group/ghead relative grid h-10 min-w-0 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-2 rounded-inner pr-1 pl-5 outline-1 -outline-offset-1 outline-transparent transition-[background-color,outline-color] duration-(--ccm-dur-base) ease-(--ease-out-quint) data-dragging:bg-fill data-drop-on:bg-accent-soft data-drop-on:outline-accent"
    :class="lit ? 'bg-accent-soft text-accent-ink' : group.tabActive ? 'text-ink hover:bg-fill' : 'text-ink-muted hover:bg-fill'"
    data-rail-group
    :data-tab-key="group.tabKey"
    :data-state="group.state"
    :data-folded="group.folded ? '' : undefined"
    data-rail-drag
    data-drag-kind="tab"
    :data-drag-tab="group.tabKey"
    :data-drag-title="group.title"
    data-rail-drop
    :data-drop-tab="group.tabKey"
    @contextmenu.prevent.stop="emit('menu', group, $event)"
  >
    <span v-if="flashKey" :key="flashKey" class="ccm-flash pointer-events-none absolute inset-0 rounded-inner" :class="FLASH[group.state]" aria-hidden="true" />
    <span v-if="sweep" :key="sweep" class="ccm-peer-sweep absolute top-1.5 bottom-1.5 left-[3px] w-0.5" aria-hidden="true" data-rail-peer-sweep />
    <span class="ccm-rail-stem pointer-events-none absolute bottom-0 left-[27px] top-[calc(50%+7px)] w-px bg-line" :data-folded="group.folded ? '' : undefined" aria-hidden="true" />
    <button
      v-if="!renaming"
      type="button"
      data-side-item
      data-side-group
      :data-side-id="group.key"
      :data-group-key="group.key"
      :data-tab-key="group.tabKey"
      class="absolute inset-0 cursor-pointer rounded-inner"
      role="treeitem"
      aria-level="2"
      :aria-expanded="!group.folded"
      :aria-selected="lit"
      :aria-current="lit ? 'true' : undefined"
      :aria-label="t('workspace.railGroup.label', { name: group.title, panes, state: spoken })"
      :tabindex="stop"
      :title="tip"
      @click="emit('activate', group)"
      @dblclick.prevent="emit('rename', group)"
    />
    <TabLayoutGlyph
      :tab-key="group.tabKey"
      :active-pane="activePane"
      class="pointer-events-none relative"
      :class="lit ? 'text-accent-ink' : group.tabActive ? 'text-ink-muted' : 'text-ink-faint'"
      data-rail-group-glyph
    />
    <span v-if="renaming" class="relative z-10 min-w-0">
      <TabRenameInput :tab-key="group.tabKey" :initial="group.title" @done="(saved) => emit('renamed', group.tabKey, saved)" />
    </span>
    <span v-else class="pointer-events-none flex min-w-0 flex-col">
      <span class="block min-w-0 transition-transform duration-(--ccm-dur-base) ease-out-quint" :class="group.folded ? '' : 'translate-y-2'">
        <span :key="titleKey" class="block truncate rounded-[4px] text-xs font-medium" :class="titleKey ? 'ccm-highlight' : ''" data-rail-group-title>{{ group.title }}</span>
      </span>
      <span
        class="flex h-4 min-w-0 items-center text-2xs font-normal transition-[opacity,translate] duration-(--ccm-dur-base) ease-out-quint"
        :class="[group.folded ? '' : '-translate-y-1 opacity-0', TONE[group.state] ?? (lit ? 'text-accent-ink' : peer ? 'text-ink' : 'text-ink-muted')]"
        :aria-hidden="group.folded ? undefined : 'true'"
      >
        <span class="relative min-w-0 overflow-hidden">
          <Transition name="ccm-rail-word" @before-leave="unstamp">
            <span v-if="peer" :key="`p:${line}`" class="block truncate" data-rail-group-line :data-rail-peer="group.peer?.dir"
              ><component :is="peer.glyph" :size="12" class="mr-1 inline-block align-[-2px]" :class="peer.tone" aria-hidden="true" />{{ line }}</span
            >
            <span v-else :key="line" class="block truncate" data-rail-group-line>{{ line }}<span v-if="tool" class="sr-only"> ({{ word }})</span></span>
          </Transition>
        </span>
        <Transition name="ccm-fade">
          <span v-if="tail" class="shrink-0 whitespace-pre tabular-nums" data-rail-activity>{{ tail }}</span>
        </Transition>
      </span>
    </span>
    <span class="flex shrink-0 items-center gap-0.5">
      <span class="pointer-events-none relative inline-flex size-3 shrink-0 items-center justify-center" :data-rail-group-state="group.state" data-rail-group-badge>
        <Transition name="ccm-rail-word">
          <LoaderCircle v-if="group.state === 'starting'" key="starting" :size="11" class="ccm-spin text-ink-faint" aria-hidden="true" />
          <StatusIcon v-else-if="BADGE[group.state]" :key="BADGE[group.state]" :status="BADGE[group.state]!" :size="11" />
        </Transition>
      </span>
      <button
        type="button"
        class="relative z-10 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-ink-faint opacity-0 transition-opacity duration-(--ccm-dur-fast) ease-out-quint group-hover/ghead:opacity-100 group-focus-within/ghead:opacity-100 hover:bg-fill-strong hover:text-ink focus-visible:opacity-100"
        :title="t('workspace.railGroup.close', { name: group.title })"
        :aria-label="t('workspace.railGroup.close', { name: group.title })"
        :tabindex="stop"
        data-rail-group-close
        data-no-drag
        @click.stop="emit('close', group)"
      >
        <X :size="12" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="relative z-10 inline-flex h-5 shrink-0 cursor-pointer items-center gap-0.5 rounded-[5px] pr-0.5 pl-1.5 text-ink-muted hover:bg-fill-strong hover:text-ink aria-[expanded=false]:bg-fill"
        :aria-expanded="!group.folded"
        :aria-label="foldLabel"
        :title="foldLabel"
        :tabindex="stop"
        data-rail-group-chevron
        data-no-drag
        @click.stop="emit('fold', group, !group.folded)"
      >
        <span class="text-2xs tabular" data-rail-group-count>{{ group.count }}</span>
        <ChevronDown :size="12" class="ccm-rail-chevron" :data-folded="group.folded ? '' : undefined" aria-hidden="true" />
      </button>
    </span>
  </div>
</template>
