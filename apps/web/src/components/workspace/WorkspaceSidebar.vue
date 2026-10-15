<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderPlus, LoaderCircle } from 'lucide-vue-next'
import { useClusterDrag } from '../../composables/useClusterDrag'
import { useOpenProject } from '../../composables/useOpenProject'
import { useRail } from '../../composables/useRail'
import { pinLeaving, retireOverlay } from '../../lib/motion'
import type { SavedLayout } from '../../lib/projects'
import type { RailCheckout, RailCluster, RailRow } from '../../lib/rail/railModel'
import { leaves } from '../../lib/splitLayout'
import { useWorkspaceStore, type SplitChoice } from '../../stores/workspace'
import ProjectMenu from './ProjectMenu.vue'
import RailClusterView from './rail/RailClusterView.vue'
import SplitMenu from './SplitMenu.vue'

/** `narrow`: run badges shrink to icons; `only`: one cluster (rail column flyout); `flat`: no material of its own. */
const props = defineProps<{ narrow?: boolean; only?: string; flat?: boolean }>()
const emit = defineEmits<{
  scripts: [root: string]
  run: [root: string]
  saveLayout: [root: string, name: string]
  manageLayouts: [root: string, name: string]
  openLayout: [layout: SavedLayout]
  close: [keys: string[]]
  closeProject: [cluster: RailCluster]
}>()

const { t } = useI18n()
const workspace = useWorkspaceStore()
const rail = useRail()
const { available: openable, picking, openProject: pickProject } = useOpenProject()
const clusters = computed(() => (props.only ? rail.clusters.value.filter((c) => c.key === props.only) : rail.clusters.value))

const COLLAPSED_KEY = 'ccm.workspace.sideCollapsed'
const collapsed = ref<Set<string>>(readCollapsed())
function readCollapsed(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]') as unknown
    return new Set(Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string') : [])
  } catch {
    return new Set()
  }
}
watch(
  collapsed,
  (set) => {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...set].slice(-50)))
    } catch {
      // preference only
    }
  },
  { deep: true },
)
function toggle(c: RailCluster, open?: boolean): void {
  const next = new Set(collapsed.value)
  const shut = open === undefined ? !next.has(c.key) : !open
  if (shut) next.add(c.key)
  else next.delete(c.key)
  collapsed.value = next
}

const nameOf = (c: RailCluster): string => (c.key === 'home' ? t('workspace.side.home') : c.name)
/** Folder the header acts on: the active checkout, else the main one (a worktree tab never gets the main checkout's root). */
const headDir = (c: RailCluster): string | null => (c.checkouts.find((k) => k.active) ?? c.checkouts[0])?.path ?? c.root

function closeRow(row: RailRow): void {
  if (row.key.startsWith('tab:')) {
    const tab = workspace.tabs.find((x) => x.key === row.tabKey)
    if (tab) emit('close', leaves(tab.root))
  } else emit('close', [row.paneKey])
}

function openCheckout(k: RailCheckout): void {
  const row = k.rows.find((r) => r.focused) ?? k.rows.find((r) => r.tabActive) ?? k.rows[0]
  if (row) workspace.activate(row.paneKey)
  else if (k.path) workspace.open(workspace.preset, k.path)
}

function forget(c: RailCluster): void {
  for (const dir of c.history) workspace.forget(dir)
}

const list = ref<HTMLElement | null>(null)
const drag = useClusterDrag(list, (from, to) => {
  if (!props.only) rail.move(from, to)
})
const announce = ref('')

async function moveBy(head: HTMLElement, step: number): Promise<void> {
  const key = head.dataset.orderKey
  const all = rail.clusters.value
  const from = all.findIndex((c) => c.key === key)
  const to = from + step
  if (props.only || from < 0 || to < 0 || to >= all.length) return
  rail.move(from, to)
  await nextTick()
  const moved = rail.clusters.value.find((c) => c.key === key)
  list.value?.querySelector<HTMLElement>(`[data-side-head][data-order-key="${CSS.escape(key!)}"]`)?.focus()
  if (moved) announce.value = t('workspace.rail.moved', { name: nameOf(moved), n: to + 1 })
}

// Roving focus over headers, checkout lines and rows, in screen order; Alt+↑/↓ on a header reorders projects.
function onKey(e: KeyboardEvent): void {
  const el = document.activeElement as HTMLElement | null
  if (!el?.matches('[data-side-item]')) return
  const isHeader = el.hasAttribute('data-side-head')
  if (isHeader && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault()
    void moveBy(el, e.key === 'ArrowUp' ? -1 : 1)
    return
  }
  if (e.altKey || e.ctrlKey || e.metaKey) return
  const items = [...((e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-side-item]'))].filter((n) => n.offsetParent)
  const at = items.indexOf(el)
  const cluster = clusters.value.find((c) => c.key === el.closest<HTMLElement>('[data-group]')?.dataset.group)
  let next: HTMLElement | undefined
  if (e.key === 'ArrowDown') next = items[(at + 1) % items.length]
  else if (e.key === 'ArrowUp') next = items[(at - 1 + items.length) % items.length]
  else if (e.key === 'Home') next = items[0]
  else if (e.key === 'End') next = items.at(-1)
  else if (e.key === 'ArrowLeft' && cluster) {
    if (isHeader) toggle(cluster, false)
    else next = el.closest('[data-group]')?.querySelector<HTMLElement>('[data-side-head]') ?? undefined
  } else if (e.key === 'ArrowRight' && cluster && isHeader) {
    if (collapsed.value.has(cluster.key)) toggle(cluster, true)
    else next = items[at + 1]
  } else return
  e.preventDefault()
  next?.focus()
}

/** `dir` null: the Home cluster, whose new tabs start in the default folder. */
const newMenu = ref<{ anchor: DOMRect; cluster: RailCluster; dir: string | null; trigger: HTMLElement } | null>(null)
const projectMenu = ref<{ anchor: DOMRect; cluster: RailCluster; dir: string; trigger: HTMLElement } | null>(null)

function openNew(c: RailCluster, e: MouseEvent): void {
  const trigger = e.currentTarget as HTMLElement
  const dir = headDir(c)
  newMenu.value = newMenu.value?.cluster.key === c.key || (!dir && c.key !== 'home') ? null : { anchor: trigger.getBoundingClientRect(), cluster: c, dir, trigger }
}

function openProject(c: RailCluster, e: MouseEvent): void {
  const trigger = e.currentTarget as HTMLElement
  const dir = headDir(c)
  projectMenu.value = projectMenu.value?.cluster.key === c.key || !dir ? null : { anchor: trigger.getBoundingClientRect(), cluster: c, dir, trigger }
}

function pickNew(choice: SplitChoice): void {
  if (!newMenu.value) return
  const dir = newMenu.value.dir ?? undefined
  if (choice === 'browser') workspace.openBrowser('', { cwd: dir })
  else workspace.open(choice, dir)
}
</script>

<template>
  <nav
    class="flex h-full w-full flex-col gap-1.5 p-1.5"
    :class="flat ? '' : 'ccm-material rounded-card'"
    :aria-label="t('workspace.rail.title')"
    data-rail
    @keydown="onKey"
    @pointerdown="drag.onDown"
  >
    <button
      v-if="!only && openable"
      type="button"
      class="inline-flex h-8 w-full shrink-0 cursor-pointer items-center gap-2 rounded-inner border border-dashed border-line px-2 text-left text-xs text-ink-muted transition-colors duration-(--ccm-dur-fast) hover:bg-fill hover:text-ink disabled:cursor-default disabled:text-ink-faint"
      :title="t('workspace.rail.openProjectHint')"
      :disabled="picking"
      data-rail-open-project
      @click="pickProject"
    >
      <LoaderCircle v-if="picking" :size="14" class="ccm-spin shrink-0" aria-hidden="true" />
      <FolderPlus v-else :size="14" class="shrink-0" aria-hidden="true" />
      <span class="min-w-0 truncate">{{ t('workspace.rail.openProject') }}</span>
    </button>
    <div ref="list" class="ccm-scroll min-h-0 flex-1 overflow-y-auto">
    <TransitionGroup tag="div" name="ccm-list" class="relative flex flex-col gap-1.5" @before-leave="pinLeaving">
      <RailClusterView
        v-for="(c, ci) in clusters"
        :key="c.key"
        :cluster="c"
        :index="ci"
        :collapsed="collapsed.has(c.key)"
        :narrow="narrow"
        :new-open="newMenu?.cluster.key === c.key"
        :menu-open="projectMenu?.cluster.key === c.key"
        @toggle="(open) => toggle(c, open)"
        @focus="(key) => workspace.activate(key)"
        @close="closeRow"
        @new="(e) => openNew(c, e)"
        @menu="(e) => openProject(c, e)"
        @forget="forget(c)"
        @checkout="openCheckout"
      />
    </TransitionGroup>
    </div>
    <span class="sr-only" aria-live="polite">{{ announce }}</span>

    <Teleport to="body">
      <Transition name="ccm-menu" @before-leave="retireOverlay">
        <SplitMenu
          v-if="newMenu"
          :anchor="newMenu.anchor"
          :current="null"
          :trigger="newMenu.trigger"
          :title="t('workspace.rail.newIn', { name: nameOf(newMenu.cluster) })"
          @pick="pickNew"
          @close="newMenu = null"
        />
      </Transition>
      <Transition name="ccm-menu" @before-leave="retireOverlay">
        <ProjectMenu
          v-if="projectMenu"
          :anchor="projectMenu.anchor"
          :root="projectMenu.dir"
          :name="nameOf(projectMenu.cluster)"
          :trigger="projectMenu.trigger"
          closable
          @scripts="emit('scripts', projectMenu!.dir)"
          @run="emit('run', projectMenu!.dir)"
          @save="emit('saveLayout', projectMenu!.dir, nameOf(projectMenu!.cluster))"
          @manage="emit('manageLayouts', projectMenu!.dir, nameOf(projectMenu!.cluster))"
          @open="(l) => emit('openLayout', l)"
          @close-project="emit('closeProject', projectMenu!.cluster)"
          @close="projectMenu = null"
        />
      </Transition>
    </Teleport>
  </nav>
</template>
