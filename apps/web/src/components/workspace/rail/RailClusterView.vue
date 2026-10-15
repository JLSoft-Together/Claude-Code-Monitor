<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { BellRing, ChevronRight, Ellipsis, Folder, FolderOpen, GitBranch, Plus, X } from 'lucide-vue-next'
import type { RailCheckout, RailCluster, RailRow as Row } from '../../../lib/rail/railModel'
import { folderName } from '../../../lib/sidebarRows'
import { isMac } from '../../../lib/platform'
import { keyCombo } from '../../../lib/shortcuts'
import RunBadge from '../RunBadge.vue'
import RailRow from './RailRow.vue'

const props = defineProps<{ cluster: RailCluster; index: number; collapsed: boolean; narrow?: boolean; newOpen?: boolean; menuOpen?: boolean }>()
const emit = defineEmits<{
  toggle: [open?: boolean]
  focus: [paneKey: string]
  close: [row: Row]
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
const showCheckouts = computed(
  () => props.cluster.checkouts.some((k) => k.path) && (props.cluster.checkouts.length > 1 || !props.cluster.live || props.cluster.checkouts.some((k) => k.branch || k.tag === 'worktree')),
)

function checkoutLabel(k: RailCheckout): string {
  return k.branch ?? (k.path ? folderName(k.path) : '')
}

const HEAD_BTN =
  'inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-ink-faint hover:bg-fill-strong hover:text-ink aria-expanded:bg-fill-strong aria-expanded:text-ink'
</script>

<template>
  <section
    class="flex flex-col rounded-control p-0.5 outline-1 -outline-offset-1 transition-[outline-color] duration-(--ccm-dur-fast)"
    :class="cluster.active ? 'outline-line-strong' : 'outline-transparent'"
    :data-group="cluster.key"
    :aria-labelledby="`ws-rail-${index}`"
  >
    <div class="group/head flex h-8 min-w-0 items-center gap-0.5 pr-0.5" @contextmenu.prevent.stop="emit('contextHead', $event)">
      <h3 :id="`ws-rail-${index}`" class="min-w-0 flex-1">
        <button
          type="button"
          data-side-item
          data-side-head
          :data-order-key="cluster.key"
          class="flex h-8 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-inner pl-1 text-left text-xs font-semibold hover:text-ink"
          :class="cluster.live ? 'text-ink-muted' : 'text-ink-faint'"
          :aria-expanded="!collapsed"
          :title="[cluster.root, t('workspace.rail.moveHint', MOVE_KEYS)].filter(Boolean).join('\n')"
          @click="emit('toggle')"
        >
          <ChevronRight
            :size="12"
            class="shrink-0 text-ink-faint transition-transform duration-(--ccm-dur-fast) ease-spring"
            :class="collapsed ? '' : 'rotate-90'"
            aria-hidden="true"
          />
          <component :is="cluster.active ? FolderOpen : Folder" :size="14" class="shrink-0" :class="cluster.active ? 'text-ink' : 'text-ink-faint'" aria-hidden="true" />
          <span class="min-w-0 truncate" :class="cluster.active ? 'text-ink' : ''" data-rail-name>{{ name }}</span>
        </button>
      </h3>
      <span
        v-if="cluster.needs"
        class="inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 text-2xs font-semibold tabular"
        :class="cluster.failed ? 'bg-st-error-soft text-st-error' : 'bg-st-waiting-soft text-st-waiting'"
        :title="t('workspace.rail.needs', { n: cluster.needs }, cluster.needs)"
        data-rail-needs
      >
        <BellRing :size="10" aria-hidden="true" />{{ cluster.needs }}<span class="sr-only"> {{ t('workspace.rail.needs', { n: cluster.needs }, cluster.needs) }}</span>
      </span>
      <RunBadge v-if="headDir" :dir="headDir" :compact="narrow" />
      <button
        v-if="headDir || cluster.key === 'home'"
        type="button"
        :class="HEAD_BTN"
        class="opacity-0 group-hover/head:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
        :title="t('workspace.rail.newIn', { name })"
        :aria-label="t('workspace.rail.newIn', { name })"
        aria-haspopup="true"
        :aria-expanded="!!newOpen"
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
        class="opacity-0 group-hover/head:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
        :title="t('workspace.projects.menuFor', { name })"
        :aria-label="t('workspace.projects.menuFor', { name })"
        aria-haspopup="true"
        :aria-expanded="!!menuOpen"
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
        class="opacity-0 group-hover/head:opacity-100 focus-visible:opacity-100"
        :title="t('workspace.rail.forget', { name })"
        :aria-label="t('workspace.rail.forget', { name })"
        data-rail-forget
        data-no-drag
        @click="emit('forget')"
      >
        <X :size="12" aria-hidden="true" />
      </button>
    </div>
    <div v-show="!collapsed" class="flex flex-col">
      <template v-for="k in cluster.checkouts" :key="k.key">
        <button
          v-if="showCheckouts && k.path"
          type="button"
          data-side-item
          data-side-checkout
          :data-checkout-key="k.key"
          class="flex h-6 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-inner pr-1.5 pl-5 text-left text-2xs text-ink-muted hover:bg-fill hover:text-ink"
          :title="k.path"
          @click="emit('checkout', k)"
          @contextmenu.prevent.stop="emit('contextCheckout', k, $event)"
        >
          <component :is="k.branch ? GitBranch : Folder" :size="11" class="shrink-0 text-ink-faint" aria-hidden="true" />
          <span class="min-w-0 truncate">{{ checkoutLabel(k) }}</span>
          <span v-if="k.tag" class="shrink-0 rounded-[4px] bg-fill px-1 text-ink-faint">{{ t(`workspace.rail.${k.tag}`) }}</span>
        </button>
        <ul class="flex flex-col" role="list">
          <li v-for="row in k.rows" :key="row.key">
            <RailRow :row="row" @focus="(key) => emit('focus', key)" @close="(r) => emit('close', r)" @menu="(r, e) => emit('contextRow', r, e)" />
          </li>
        </ul>
      </template>
    </div>
  </section>
</template>
