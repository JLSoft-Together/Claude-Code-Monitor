<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight, Ellipsis, Folder, FolderOpen, LoaderCircle, Plus } from 'lucide-vue-next'
import { usePaneInfo } from '../../composables/usePaneInfo'
import { useProjectRoots } from '../../composables/useProjectRoots'
import { relativeTime } from '../../lib/format'
import { pinLeaving, retireOverlay } from '../../lib/motion'
import { hasLayouts, hasScripts, type SavedLayout } from '../../lib/projects'
import { rowActivity, rowStatus, shellTitle, shortAge, sideGroups, type SideGroup } from '../../lib/sidebarRows'
import { leaves } from '../../lib/splitLayout'
import { statusMeta } from '../../lib/status'
import { displayTitle } from '../../lib/title'
import { isTerm, useWorkspaceStore, workCwd, type Pane, type SplitChoice } from '../../stores/workspace'
import StatusIcon from '../StatusIcon.vue'
import PaneIcon from './PaneIcon.vue'
import ProjectMenu from './ProjectMenu.vue'
import RunBadge from './RunBadge.vue'
import SplitMenu from './SplitMenu.vue'

const emit = defineEmits<{ scripts: [root: string]; run: [root: string]; saveLayout: [root: string, name: string]; manageLayouts: [root: string, name: string]; openLayout: [layout: SavedLayout] }>()

const { t, locale } = useI18n()
const workspace = useWorkspaceStore()
const { sessionOf, labelOf, viewDetail } = usePaneInfo()
const { rootOf } = useProjectRoots()

// Ages only need minute precision; one shared tick keeps the list from re-rendering every second.
const tick = ref(Date.now())
const timer = setInterval(() => (tick.value = Date.now()), 30_000)
onBeforeUnmount(() => clearInterval(timer))
// Status changes flash once; rows already there when the list first paints do not.
const settled = ref(false)
onMounted(() => requestAnimationFrame(() => (settled.value = true)))

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
function toggle(g: SideGroup, open?: boolean): void {
  const next = new Set(collapsed.value)
  const shut = open === undefined ? !next.has(g.key) : !open
  if (shut) next.add(g.key)
  else next.delete(g.key)
  collapsed.value = next
}

const groups = computed(() => sideGroups(workspace.tabs, workspace.panes, workspace.activeKey, rootOf))
const activeTabPanes = computed(() => new Set(workspace.activeTab ? leaves(workspace.activeTab.root) : []))

function groupName(g: SideGroup): string {
  return g.root ? g.name : t('workspace.side.home')
}

function waitingIn(g: SideGroup): number {
  return g.panes.filter((p) => p.attention === 'waiting' || sessionOf(p)?.status === 'waiting').length
}

function title(pane: Pane): string {
  if (!isTerm(pane)) return labelOf(pane)
  const session = sessionOf(pane)
  if (session) return displayTitle(session) || t(`workspace.preset.${pane.preset}`)
  if (pane.preset === 'shell') return shellTitle(pane) ?? t('workspace.preset.shell')
  return t(`workspace.preset.${pane.preset}`)
}

function activity(pane: Pane): number | undefined {
  return rowActivity(pane, sessionOf(pane), workspace.lastSeen[pane.key])
}

function age(pane: Pane): string {
  const at = activity(pane)
  if (at === undefined) return ''
  const a = shortAge(at, Math.max(tick.value, at))
  return a.unit === 'now' ? t('workspace.projects.age.now') : t(`workspace.projects.age.${a.unit}`, { n: a.n })
}

function statusOf(pane: Pane) {
  return rowStatus(pane, sessionOf(pane))
}

/** Status shown by the glyph; '' for starting / viewer rows. Keyed so a change flashes once. */
function glyphKey(pane: Pane): string {
  const s = statusOf(pane)
  return s?.kind === 'status' ? s.status : ''
}

function tooltip(pane: Pane): string {
  const at = activity(pane)
  const where = isTerm(pane) ? workCwd(pane) : viewDetail(pane)
  const when = at === undefined ? null : relativeTime(at, locale.value, tick.value)
  return [title(pane), where, when && t('workspace.projects.lastActive', { when })].filter(Boolean).join('\n')
}

// Roving focus over group headers and rows, in screen order.
function onKey(e: KeyboardEvent): void {
  const el = document.activeElement as HTMLElement | null
  if (!el?.matches('[data-side-item]')) return
  const items = [...((e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-side-item]'))].filter((n) => n.offsetParent)
  const at = items.indexOf(el)
  const group = groups.value.find((g) => g.key === el.closest<HTMLElement>('[data-group]')?.dataset.group)
  const isHeader = el.hasAttribute('data-side-head')
  let next: HTMLElement | undefined
  if (e.key === 'ArrowDown') next = items[(at + 1) % items.length]
  else if (e.key === 'ArrowUp') next = items[(at - 1 + items.length) % items.length]
  else if (e.key === 'Home') next = items[0]
  else if (e.key === 'End') next = items.at(-1)
  else if (e.key === 'ArrowLeft' && group) {
    if (isHeader) toggle(group, false)
    else next = el.closest('[data-group]')?.querySelector<HTMLElement>('[data-side-head]') ?? undefined
  } else if (e.key === 'ArrowRight' && group && isHeader) {
    if (collapsed.value.has(group.key)) toggle(group, true)
    else next = items[at + 1]
  } else return
  e.preventDefault()
  next?.focus()
}

const newMenu = ref<{ anchor: DOMRect; group: SideGroup; trigger: HTMLElement } | null>(null)
const projectMenu = ref<{ anchor: DOMRect; group: SideGroup; trigger: HTMLElement } | null>(null)

function openNew(g: SideGroup, e: MouseEvent): void {
  const trigger = e.currentTarget as HTMLElement
  newMenu.value = newMenu.value?.group.key === g.key ? null : { anchor: trigger.getBoundingClientRect(), group: g, trigger }
}

function openProject(g: SideGroup, e: MouseEvent): void {
  const trigger = e.currentTarget as HTMLElement
  projectMenu.value = projectMenu.value?.group.key === g.key ? null : { anchor: trigger.getBoundingClientRect(), group: g, trigger }
}

function pickNew(choice: SplitChoice): void {
  const root = newMenu.value?.group.root
  if (!root) return
  if (choice === 'browser') workspace.openBrowser('', { cwd: root })
  else workspace.open(choice, root)
}

const HEAD_BTN =
  'inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-ink-faint hover:bg-fill-strong hover:text-ink aria-expanded:bg-fill-strong aria-expanded:text-ink'
</script>

<template>
  <nav class="ccm-material ccm-scroll flex h-full w-full flex-col gap-1.5 overflow-y-auto rounded-card p-1.5" :aria-label="t('workspace.side.title')" @keydown="onKey">
    <!-- A pane whose git toplevel arrives late changes group: rows and groups slide instead of jumping. -->
    <TransitionGroup tag="div" name="ccm-list" class="relative flex flex-col gap-1.5" @before-leave="pinLeaving">
      <section
        v-for="(g, gi) in groups"
        :key="g.key"
        class="flex flex-col rounded-control p-0.5 outline-1 -outline-offset-1 transition-[outline-color] duration-(--ccm-dur-fast)"
        :class="g.active ? 'outline-line-strong' : 'outline-transparent'"
        :data-group="g.key"
        :aria-labelledby="`ws-side-${gi}`"
      >
        <div class="group/head flex h-8 min-w-0 items-center gap-0.5 pr-0.5">
          <h3 :id="`ws-side-${gi}`" class="min-w-0 flex-1">
            <button
              type="button"
              data-side-item
              data-side-head
              class="flex h-8 w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-inner pl-1 text-left text-xs font-semibold text-ink-muted hover:text-ink"
              :aria-expanded="!collapsed.has(g.key)"
              :title="g.root ?? undefined"
              @click="toggle(g)"
            >
              <ChevronRight
                :size="12"
                class="shrink-0 text-ink-faint transition-transform duration-(--ccm-dur-fast) ease-spring"
                :class="collapsed.has(g.key) ? '' : 'rotate-90'"
                aria-hidden="true"
              />
              <component :is="g.active ? FolderOpen : Folder" :size="14" class="shrink-0" :class="g.active ? 'text-ink' : 'text-ink-faint'" aria-hidden="true" />
              <span class="min-w-0 truncate" :class="g.active ? 'text-ink' : ''">{{ groupName(g) }}</span>
            </button>
          </h3>
          <span
            v-if="waitingIn(g)"
            class="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-st-waiting-soft px-1.5 text-2xs font-semibold text-st-waiting tabular"
            :title="t('workspace.side.waiting', { n: waitingIn(g) }, waitingIn(g))"
          >
            <StatusIcon status="waiting" :size="10" :animate="false" />{{ waitingIn(g) }}<span class="sr-only"> {{ t('workspace.side.waiting', { n: waitingIn(g) }, waitingIn(g)) }}</span>
          </span>
          <RunBadge v-if="g.root" :dir="g.root" />
          <button
            v-if="g.root"
            type="button"
            :class="HEAD_BTN"
            class="opacity-0 group-hover/head:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
            :title="t('workspace.projects.newTab', { name: g.name })"
            :aria-label="t('workspace.projects.newTab', { name: g.name })"
            aria-haspopup="true"
            :aria-expanded="newMenu?.group.key === g.key"
            data-side-new
            @click="openNew(g, $event)"
          >
            <Plus :size="13" aria-hidden="true" />
          </button>
          <button
            v-if="g.root && (hasScripts || hasLayouts)"
            type="button"
            :class="HEAD_BTN"
            class="opacity-0 group-hover/head:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
            :title="t('workspace.projects.menuFor', { name: g.name })"
            :aria-label="t('workspace.projects.menuFor', { name: g.name })"
            aria-haspopup="true"
            :aria-expanded="projectMenu?.group.key === g.key"
            data-side-menu
            @click="openProject(g, $event)"
          >
            <Ellipsis :size="14" aria-hidden="true" />
          </button>
        </div>
        <TransitionGroup v-show="!collapsed.has(g.key)" tag="ul" name="ccm-list" class="relative flex flex-col" @before-leave="pinLeaving">
          <li v-for="pane in g.panes" :key="pane.key">
            <button
              type="button"
              data-side-row
              data-side-item
              :data-side-pane="pane.key"
              class="flex h-[34px] w-full min-w-0 cursor-pointer items-center gap-2 rounded-inner pr-2 pl-2.5 text-left text-xs transition-colors duration-(--ccm-dur-fast)"
              :class="activeTabPanes.has(pane.key) ? 'bg-accent-soft text-accent-ink' : 'text-ink hover:bg-fill'"
              :aria-current="pane.key === workspace.activeKey ? 'true' : undefined"
              :title="tooltip(pane)"
              @click="workspace.activate(pane.key)"
            >
              <span :key="glyphKey(pane)" class="inline-flex size-4 shrink-0 items-center justify-center rounded-full" :class="glyphKey(pane) ? ['relative', settled ? 'ccm-flash' : '', statusMeta(glyphKey(pane)).text] : ''">
                <LoaderCircle v-if="statusOf(pane)?.kind === 'starting'" :size="13" class="ccm-spin text-ink-faint" aria-hidden="true" />
                <StatusIcon v-else-if="glyphKey(pane)" :status="glyphKey(pane)" :size="13" />
              </span>
              <span class="min-w-0 flex-1 truncate" :class="pane.key === workspace.activeKey ? 'font-medium' : ''" data-side-title>{{ title(pane) }}</span>
              <span class="shrink-0 text-2xs text-ink-faint tabular" data-side-age>{{ age(pane) }}</span>
              <PaneIcon :pane="pane" :size="14" class="shrink-0" />
              <span v-if="statusOf(pane)" class="sr-only">{{ t(statusOf(pane)!.label, { code: pane.exitCode ?? 0 }) }}</span>
              <span v-else class="sr-only">{{ labelOf(pane) }}</span>
            </button>
          </li>
        </TransitionGroup>
      </section>
    </TransitionGroup>

    <Teleport to="body">
      <Transition name="ccm-menu" @before-leave="retireOverlay">
        <SplitMenu
          v-if="newMenu"
          :anchor="newMenu.anchor"
          :current="null"
          :trigger="newMenu.trigger"
          :title="t('workspace.projects.newTab', { name: newMenu.group.name })"
          @pick="pickNew"
          @close="newMenu = null"
        />
      </Transition>
      <Transition name="ccm-menu" @before-leave="retireOverlay">
        <ProjectMenu
          v-if="projectMenu"
          :anchor="projectMenu.anchor"
          :root="projectMenu.group.root!"
          :name="projectMenu.group.name"
          :trigger="projectMenu.trigger"
          @scripts="emit('scripts', projectMenu!.group.root!)"
          @run="emit('run', projectMenu!.group.root!)"
          @save="emit('saveLayout', projectMenu!.group.root!, projectMenu!.group.name)"
          @manage="emit('manageLayouts', projectMenu!.group.root!, projectMenu!.group.name)"
          @open="(l) => emit('openLayout', l)"
          @close="projectMenu = null"
        />
      </Transition>
    </Teleport>
  </nav>
</template>
