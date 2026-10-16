<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { BellRing, ChevronRight, Ellipsis, Folder, FolderOpen, GitBranch, Plus, X } from 'lucide-vue-next'
import { useRailTabStop } from '../../../composables/useRail'
import { onDustLeave } from '../../../lib/dust'
import { motionMs, pinLeaving } from '../../../lib/motion'
import {
  checkoutId,
  headId,
  railItems,
  showsCheckouts,
  type RailCheckout,
  type RailCluster,
  type RailGroup,
  type RailItem,
  type RailRow as Row,
} from '../../../lib/rail/railModel'
import { folderName } from '../../../lib/sidebarRows'
import { isMac } from '../../../lib/platform'
import { keyCombo } from '../../../lib/shortcuts'
import { useWorkspaceStore } from '../../../stores/workspace'
import RunBadge from '../RunBadge.vue'
import RailGroupHead from './RailGroupHead.vue'
import RailRow from './RailRow.vue'

const props = defineProps<{
  cluster: RailCluster
  index: number
  collapsed: boolean
  narrow?: boolean
  newOpen?: boolean
  menuOpen?: boolean
  renaming?: string | null
}>()
const emit = defineEmits<{
  toggle: [open?: boolean]
  focus: [paneKey: string]
  close: [row: Row]
  activateGroup: [group: RailGroup]
  fold: [group: RailGroup, folded: boolean]
  closeGroup: [group: RailGroup]
  rename: [tabKey: string]
  renamed: [tabKey: string, saved: boolean]
  contextGroup: [group: RailGroup, event: MouseEvent]
  new: [event: MouseEvent]
  menu: [event: MouseEvent]
  forget: []
  checkout: [checkout: RailCheckout]
  contextHead: [event: MouseEvent]
  contextCheckout: [checkout: RailCheckout, event: MouseEvent]
  contextRow: [row: Row, event: MouseEvent]
}>()

const { t } = useI18n()
const MOVE_KEYS = { up: keyCombo(['Alt', '↑'], isMac), down: keyCombo(['Alt', '↓'], isMac) }
const name = computed(() => (props.cluster.key === 'home' ? t('workspace.side.home') : props.cluster.name))
/** Folder the header acts on: the active checkout, else the main one. Never assumed allowed beyond what is open. */
const headDir = computed(() => (props.cluster.checkouts.find((k) => k.active) ?? props.cluster.checkouts[0])?.path ?? props.cluster.root)
// A lone plain folder needs no checkout line; a branch, a worktree or a remembered project does.
const showCheckouts = computed(() => showsCheckouts(props.cluster))
const isStop = useRailTabStop()
const headStop = computed(() => (isStop(headId(props.cluster.key)) ? 0 : -1))

function checkoutLabel(k: RailCheckout): string {
  return k.branch ?? (k.path ? folderName(k.path) : '')
}

type Entry = RailItem | { kind: 'checkout'; key: string; checkout: RailCheckout }
const entries = computed<Entry[]>(() =>
  props.cluster.checkouts.flatMap((k): Entry[] => [...(showCheckouts.value && k.path ? [{ kind: 'checkout' as const, key: `co:${k.key}`, checkout: k }] : []), ...railItems(k)]),
)

const foldIndex = computed(() => {
  const out = new Map<string, number>()
  const seen = new Map<string, number>()
  for (const e of entries.value) {
    if (e.kind !== 'row' || !e.group) continue
    const n = seen.get(e.group.key) ?? 0
    out.set(e.key, n)
    seen.set(e.group.key, n + 1)
  }
  return out
})

const workspace = useWorkspaceStore()
function onLeave(el: Element, done: () => void): void {
  const node = el as HTMLElement
  const pane = node.dataset.leavePane
  const tab = node.dataset.leaveTab
  const gone = (!!pane && !workspace.panes.some((p) => p.key === pane)) || (!!tab && !workspace.tabs.some((t) => t.key === tab))
  if (gone) onDustLeave(el, done)
  else setTimeout(done, motionMs(150))
}

const HEAD_BTN =
  'inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-ink-faint hover:bg-fill-strong hover:text-ink aria-expanded:bg-fill-strong aria-expanded:text-ink'
</script>

<template>
  <section
    class="flex flex-col rounded-control p-0.5 outline-1 -outline-offset-1 transition-[outline-color] duration-(--ccm-dur-fast)"
    :class="cluster.active ? 'outline-line-strong' : 'outline-transparent'"
    :data-group="cluster.key"
  >
    <div class="group/head flex h-8 min-w-0 items-center gap-0.5 pr-0.5" @contextmenu.prevent.stop="emit('contextHead', $event)">
      <h3 :id="`ws-rail-${index}`" class="min-w-0 flex-1" role="none">
        <button
          type="button"
          data-side-item
          data-side-head
          :data-side-id="headId(cluster.key)"
          :data-order-key="cluster.key"
          class="flex h-8 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-inner pl-1 text-left text-xs font-semibold hover:text-ink"
          :class="cluster.live ? 'text-ink-muted' : 'text-ink-faint'"
          role="treeitem"
          aria-level="1"
          :aria-expanded="!collapsed"
          :tabindex="headStop"
          :title="[cluster.root, t('workspace.rail.moveHint', MOVE_KEYS)].filter(Boolean).join('\n')"
          @click="emit('toggle')"
        >
          <ChevronRight
            :size="12"
            class="shrink-0 text-ink-faint transition-transform duration-(--ccm-dur-fast) ease-out-quint"
            :class="collapsed ? '' : 'rotate-90'"
            aria-hidden="true"
          />
          <component
            :is="cluster.active ? FolderOpen : Folder"
            :size="14"
            class="shrink-0 transition-colors duration-(--ccm-dur-base)"
            :class="cluster.live ? 'fill-accent-soft text-accent' : 'fill-fill text-ink-faint'"
            aria-hidden="true"
            data-rail-folder
          />
          <span class="min-w-0 truncate" :class="cluster.active ? 'text-ink' : ''" data-rail-name>{{ name }}</span>
        </button>
      </h3>
      <span role="group" class="flex shrink-0 items-center gap-0.5" :aria-label="t('workspace.rail.menu.label', { name })">
        <span
          v-if="cluster.needs"
          class="inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 text-2xs font-semibold tabular"
          :class="cluster.failed ? 'bg-st-error-soft text-st-error' : 'bg-st-waiting-soft text-st-waiting'"
          :title="t('workspace.rail.needs', { n: cluster.needs }, cluster.needs)"
          data-rail-needs
        >
          <BellRing :size="10" aria-hidden="true" />{{ cluster.needs }}<span class="sr-only"> {{ t('workspace.rail.needs', { n: cluster.needs }, cluster.needs) }}</span>
        </span>
        <RunBadge v-if="headDir" :dir="headDir" :compact="narrow" :tabindex="headStop" />
        <button
          v-if="headDir || cluster.key === 'home'"
          type="button"
          :class="HEAD_BTN"
          class="opacity-0 transition-opacity duration-(--ccm-dur-fast) ease-out-quint group-hover/head:opacity-100 group-focus-within/head:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
          :title="t('workspace.rail.newIn', { name })"
          :aria-label="t('workspace.rail.newIn', { name })"
          aria-haspopup="true"
          :aria-expanded="!!newOpen"
          :tabindex="headStop"
          data-side-new
          data-no-drag
          @click="emit('new', $event)"
        >
          <Plus :size="13" aria-hidden="true" />
        </button>
        <button
          v-if="cluster.live && headDir"
          type="button"
          :class="HEAD_BTN"
          class="opacity-0 transition-opacity duration-(--ccm-dur-fast) ease-out-quint group-hover/head:opacity-100 group-focus-within/head:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
          :title="t('workspace.projects.menuFor', { name })"
          :aria-label="t('workspace.projects.menuFor', { name })"
          aria-haspopup="true"
          :aria-expanded="!!menuOpen"
          :tabindex="headStop"
          data-side-menu
          data-no-drag
          @click="emit('menu', $event)"
        >
          <Ellipsis :size="14" aria-hidden="true" />
        </button>
        <button
          v-if="!cluster.live"
          type="button"
          :class="HEAD_BTN"
          class="opacity-0 transition-opacity duration-(--ccm-dur-fast) ease-out-quint group-hover/head:opacity-100 group-focus-within/head:opacity-100 focus-visible:opacity-100"
          :title="t('workspace.rail.forget', { name })"
          :aria-label="t('workspace.rail.forget', { name })"
          :tabindex="headStop"
          data-rail-forget
          data-no-drag
          @click="emit('forget')"
        >
          <X :size="12" aria-hidden="true" />
        </button>
      </span>
    </div>
    <div class="ccm-rail-fold" :data-folded="collapsed ? '' : undefined" :inert="collapsed" data-rail-cluster-body>
      <div class="flex flex-col">
      <TransitionGroup tag="ul" name="ccm-list" class="relative flex flex-col" role="group" :aria-labelledby="`ws-rail-${index}`" @before-leave="pinLeaving" @leave="onLeave">
        <li
          v-for="item in entries"
          :key="item.key"
          role="none"
          :class="item.kind === 'row' && item.group ? 'ccm-rail-fold' : ''"
          :data-folded="item.kind === 'row' && item.group?.folded ? '' : undefined"
          :inert="item.kind === 'row' && !!item.group?.folded"
          :style="item.kind === 'row' && item.group ? { '--fold-i': foldIndex.get(item.key) ?? 0 } : undefined"
          :data-leave-pane="item.kind === 'row' ? item.row.paneKey : undefined"
          :data-leave-tab="item.kind === 'group' ? item.group.tabKey : undefined"
        >
          <button
            v-if="item.kind === 'checkout'"
            type="button"
            data-side-item
            data-side-checkout
            :data-side-id="checkoutId(cluster.key, item.checkout.key)"
            :data-checkout-key="item.checkout.key"
            role="treeitem"
            aria-level="2"
            :tabindex="isStop(checkoutId(cluster.key, item.checkout.key)) ? 0 : -1"
            class="flex h-6 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-inner pr-1.5 pl-5 text-left text-2xs text-ink-muted hover:bg-fill hover:text-ink"
            :title="item.checkout.path ?? undefined"
            @click="emit('checkout', item.checkout)"
            @contextmenu.prevent.stop="emit('contextCheckout', item.checkout, $event)"
          >
            <component :is="item.checkout.branch ? GitBranch : Folder" :size="11" class="shrink-0" :class="item.checkout.branch ? 'text-ink-faint' : 'fill-accent-soft text-accent'" aria-hidden="true" />
            <span class="min-w-0 truncate">{{ checkoutLabel(item.checkout) }}</span>
            <span v-if="item.checkout.tag" class="shrink-0 rounded-[4px] bg-fill px-1 text-ink-faint">{{ t(`workspace.rail.${item.checkout.tag}`) }}</span>
          </button>
          <RailGroupHead
            v-else-if="item.kind === 'group'"
            :group="item.group"
            :renaming="renaming === item.group.tabKey"
            @activate="(g) => emit('activateGroup', g)"
            @fold="(g, f) => emit('fold', g, f)"
            @close="(g) => emit('closeGroup', g)"
            @rename="(g) => emit('rename', g.tabKey)"
            @renamed="(k, saved) => emit('renamed', k, saved)"
            @menu="(g, e) => emit('contextGroup', g, e)"
          />
          <div v-else>
            <RailRow
              :row="item.row"
              :member="!!item.group"
              :renaming="!item.group && renaming === item.row.tabKey"
              @focus="(key) => emit('focus', key)"
              @close="(r) => emit('close', r)"
              @menu="(r, e) => emit('contextRow', r, e)"
              @renamed="(k, saved) => emit('renamed', k, saved)"
            />
          </div>
        </li>
      </TransitionGroup>
      </div>
    </div>
  </section>
</template>
