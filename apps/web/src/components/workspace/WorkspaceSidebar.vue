<script setup lang="ts">
import { computed, nextTick, provide, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PtyPreset } from '@ccm/shared'
import { FolderPlus, LoaderCircle } from 'lucide-vue-next'
import { useClusterDrag } from '../../composables/useClusterDrag'
import { useCompact } from '../../composables/useCompact'
import { useOpenProject } from '../../composables/useOpenProject'
import { RAIL_TAB_STOP, useRail } from '../../composables/useRail'
import { useRailDrag, type RailDrop } from '../../composables/useRailDrag'
import { hasRun } from '../../lib/desktop'
import { onDustLeave } from '../../lib/dust'
import type { MenuEntry } from '../../lib/menu'
import { motionMs, pinLeaving, retireOverlay } from '../../lib/motion'
import { isMac } from '../../lib/platform'
import { hasChanges, hasEnvCheck, hasExplorer, hasI18nScan, hasLog, hasPreview, hasReveal, pickFile, revealPath } from '../../lib/preview'
import { hasPermAdvisor } from '../../lib/permAdvisor'
import { hasLayouts, hasScripts, listLayouts, type SavedLayout } from '../../lib/projects'
import type { RailDragSource } from '../../lib/rail/railDrag'
import { rowLines, tabStopOf, type RailCheckout, type RailCluster, type RailGroup, type RailRow } from '../../lib/rail/railModel'
import { emptyMenu, groupMenu, isMenuKey, projectMenu as buildProjectMenu, rowMenu } from '../../lib/rail/railMenu'
import { leaves, type SplitDir } from '../../lib/splitLayout'
import { useRunStore } from '../../stores/run'
import { useUiStore } from '../../stores/ui'
import { isTerm, useWorkspaceStore, workCwd, type SplitChoice } from '../../stores/workspace'
import ContextMenu from '../ui/ContextMenu.vue'
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
  split: [paneKey: string, dir: SplitDir, choice: SplitChoice]
  explorer: [paneKey: string]
  mission: []
}>()

const { t } = useI18n()
const workspace = useWorkspaceStore()
const rail = useRail()
const { available: openable, picking, openProject: pickProjectFolder } = useOpenProject()
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

const lastFocus = ref<string | null>(null)
const tabStop = computed(() => tabStopOf(clusters.value, (k) => collapsed.value.has(k), lastFocus.value))
provide(RAIL_TAB_STOP, (id) => tabStop.value === id)

function onFocusIn(e: FocusEvent): void {
  const id = (e.target as HTMLElement).closest<HTMLElement>('[data-side-item]')?.dataset.sideId
  if (id) lastFocus.value = id
}

const nameOf = (c: RailCluster): string => (c.key === 'home' ? t('workspace.side.home') : c.name)
/** Folder the header acts on: the active checkout, else the main one (a worktree tab never gets the main checkout's root). */
const headDir = (c: RailCluster): string | null => (c.checkouts.find((k) => k.active) ?? c.checkouts[0])?.path ?? c.root

function tabLeaves(tabKey: string): string[] {
  const tab = workspace.tabs.find((x) => x.key === tabKey)
  return tab ? leaves(tab.root) : []
}

function closeGroup(group: RailGroup): void {
  const keys = tabLeaves(group.tabKey)
  if (keys.length) emit('close', keys)
}

function activateGroup(group: RailGroup): void {
  const tab = workspace.tabs.find((x) => x.key === group.tabKey)
  if (tab) workspace.activate(tab.focus)
}

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
const navEl = ref<HTMLElement | null>(null)
const drag = useClusterDrag(list, (from, to) => {
  if (!props.only) rail.move(from, to)
})
const announce = ref('')

const railDrag = useRailDrag(
  navEl,
  {
    merge: (tabKey) => t('workspace.paneDrop.merge', { name: rail.tabTitleOf(tabKey) }),
    detach: () => t('workspace.paneDrop.detach'),
    blocked: () => t('workspace.paneDrop.otherProject'),
  },
  onRailDrop,
)

function onPointerDown(e: PointerEvent): void {
  drag.onDown(e)
  railDrag.onDown(e)
}

function movePane(paneKey: string, name: string, tabKey: string): void {
  const title = rail.tabTitleOf(tabKey)
  workspace.movePaneToTab(paneKey, tabKey)
  flash(t('workspace.paneDrop.moved', { pane: name, tab: title }))
}

function mergeTab(tabKey: string, targetKey: string): void {
  const target = workspace.tabs.find((x) => x.key === targetKey)
  if (!target) return
  const name = rail.tabTitleOf(tabKey)
  const title = rail.tabTitleOf(targetKey)
  workspace.mergeTab(tabKey, target.focus, 'right')
  flash(t('workspace.paneDrop.merged', { tab: name, target: title }))
}

function detach(paneKey: string, name: string): void {
  workspace.detachPane(paneKey)
  flash(t('workspace.paneDrop.detached', { pane: name }))
}

function onRailDrop(src: RailDragSource, drop: RailDrop): void {
  if (drop.type === 'detach') {
    if (src.paneKey) detach(src.paneKey, src.title)
    return
  }
  if (!rail.sameProject(src.tabKey, drop.tabKey)) return
  if (src.kind === 'tab') mergeTab(src.tabKey, drop.tabKey)
  else if (src.paneKey) movePane(src.paneKey, src.title, drop.tabKey)
}

const renaming = ref<string | null>(null)

function startRename(tabKey: string): void {
  const c = clusters.value.find((x) => x.tabKeys.includes(tabKey))
  if (c && collapsed.value.has(c.key)) toggle(c, true)
  renaming.value = tabKey
}

async function onRenamed(tabKey: string, saved: boolean): Promise<void> {
  const wasFocused = !!navEl.value?.contains(document.activeElement)
  renaming.value = null
  if (saved) {
    const tab = workspace.tabs.find((x) => x.key === tabKey)
    if (tab) flash(t(tab.name ? 'workspace.tabName.renamed' : 'workspace.tabName.reset', { name: rail.tabTitleOf(tabKey) }))
  }
  await nextTick()
  if (!wasFocused) return
  const key = CSS.escape(tabKey)
  navEl.value?.querySelector<HTMLElement>(`[data-side-group][data-tab-key="${key}"], [data-side-row][data-tab-key="${key}"]`)?.focus()
}

function onClusterLeave(el: Element, done: () => void): void {
  const key = (el as HTMLElement).dataset.group
  if (key && rail.clusters.value.some((c) => c.aliases.includes(key))) setTimeout(done, motionMs(150))
  else onDustLeave(el, done)
}

async function moveBy(head: HTMLElement, step: number): Promise<void> {
  if (!props.only && head.dataset.orderKey) await moveCluster(head.dataset.orderKey, step)
}

async function moveCluster(key: string, step: number): Promise<void> {
  const all = rail.clusters.value
  const from = all.findIndex((c) => c.key === key)
  const to = from + step
  if (from < 0 || to < 0 || to >= all.length) return
  rail.move(from, to)
  await nextTick()
  const moved = rail.clusters.value.find((c) => c.key === key)
  list.value?.querySelector<HTMLElement>(`[data-side-head][data-order-key="${CSS.escape(key)}"]`)?.focus()
  if (moved) announce.value = t('workspace.rail.moved', { name: nameOf(moved), n: to + 1 })
}

const ui = useUiStore()
const run = useRunStore()
const status = ref('')
let statusTimer: ReturnType<typeof setTimeout> | undefined
function flash(text: string): void {
  status.value = announce.value = text
  clearTimeout(statusTimer)
  statusTimer = setTimeout(() => (status.value = ''), 2500)
}

async function copyPath(path: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(path)
    flash(t('workspace.rail.menu.copied'))
  } catch {
    flash(t('workspace.rail.menu.copyFailed'))
  }
}

/** Pane a checkout's actions anchor to (Explorer root, Mission Control): its focused row, else the active tab's, else the first. */
const anchorOf = (k: RailCheckout | undefined): RailRow | undefined => k && (k.rows.find((r) => r.focused) ?? k.rows.find((r) => r.tabActive) ?? k.rows[0])

const ctxMenu = ref<{ at: DOMRect; trigger: HTMLElement | null; label: string; entries: MenuEntry[]; pick: (id: string) => void } | null>(null)
/** Windows fires a native `contextmenu` right after the ContextMenu / Shift+F10 keydown that already opened the menu. */
const KEY_MENU_ECHO_MS = 300
let keyMenuAt = 0
let menuSeq = 0
const echo = (): boolean => !!ctxMenu.value && performance.now() - keyMenuAt < KEY_MENU_ECHO_MS
const cursorAt = (e: MouseEvent): DOMRect => new DOMRect(e.clientX, e.clientY, 0, 0)

// Layouts and Run detection are async: fetched before the menu shows so its height never changes once measured.
async function showProjectMenu(c: RailCluster, k: RailCheckout | undefined, at: DOMRect, trigger: HTMLElement | null): Promise<void> {
  const seq = ++menuSeq
  const dir = k?.path ?? headDir(c)
  const settle = <T,>(p: Promise<T>, fallback: T): Promise<T> => Promise.race([p.catch(() => fallback), new Promise<T>((r) => setTimeout(() => r(fallback), 400))])
  const [layouts] = await Promise.all([
    hasLayouts && dir ? settle(listLayouts(dir), []) : Promise.resolve(null),
    hasRun && dir && !run.detected(dir) ? settle(run.detect(dir), null) : Promise.resolve(null),
  ])
  if (seq !== menuSeq) return
  const all = rail.clusters.value
  const at_ = all.findIndex((x) => x.key === c.key)
  const anchor = anchorOf(k ?? c.checkouts.find((x) => x.active) ?? c.checkouts[0])
  const entries = buildProjectMenu(
    {
      mac: isMac,
      dir,
      home: c.key === 'home',
      live: c.live,
      anchored: !!anchor,
      viewers: { file: hasPreview, changes: hasChanges, log: hasLog },
      scripts: hasScripts,
      run: hasRun && !!dir && run.runnable(dir),
      layouts,
      explorer: hasExplorer,
      env: hasEnvCheck,
      i18n: hasI18nScan,
      perms: hasPermAdvisor,
      reveal: hasReveal,
      canUp: at_ > 0,
      canDown: at_ >= 0 && at_ < all.length - 1,
      collapsed: collapsed.value.has(c.key),
    },
    t,
  )
  const name = k && k.path && k.path !== headDir(c) ? `${nameOf(c)} · ${k.branch ?? k.path}` : nameOf(c)
  ctxMenu.value = { at, trigger, label: t('workspace.rail.menu.label', { name }), entries, pick: (id) => void pickProject(id, c, dir, anchor, layouts ?? []) }
}

async function pickProject(id: string, c: RailCluster, dir: string | null, anchor: RailRow | undefined, layouts: SavedLayout[]): Promise<void> {
  const cwd = dir ?? undefined
  if (id.startsWith('new:')) {
    const choice = id.slice(4)
    if (choice === 'browser') workspace.openBrowser('', { cwd })
    else if (choice === 'changes' && dir) workspace.openChanges(dir)
    else if (choice === 'log' && dir) workspace.openLog(dir)
    else if (choice === 'file') {
      const path = await pickFile('any', cwd)
      if (path && /\.html?$/i.test(path)) workspace.openBrowser(path, { cwd })
      else if (path) workspace.openFile(path, undefined, { cwd })
    } else workspace.open(choice as PtyPreset, cwd)
    return
  }
  if (id.startsWith('layout:')) {
    const layout = layouts.find((l) => `layout:${l.id}` === id)
    if (layout) emit('openLayout', layout)
    return
  }
  switch (id) {
    case 'run':
      if (dir) emit('run', dir)
      break
    case 'scripts':
      if (dir) emit('scripts', dir)
      break
    case 'plan':
      if (dir) ui.planBoard = { dir }
      break
    case 'env':
      if (dir) ui.envCheck = { dir }
      break
    case 'i18n':
      if (dir) ui.i18nScan = { dir }
      break
    case 'perms':
      if (dir) ui.permAdvisor = { dir }
      break
    case 'layout-save':
      if (dir) emit('saveLayout', dir, nameOf(c))
      break
    case 'layout-manage':
      if (dir) emit('manageLayouts', dir, nameOf(c))
      break
    case 'explorer':
      if (anchor) emit('explorer', anchor.paneKey)
      break
    case 'mission':
      if (anchor) workspace.activate(anchor.paneKey)
      await nextTick()
      emit('mission')
      break
    case 'copy-path':
      if (dir) await copyPath(dir)
      break
    case 'reveal':
      if (dir) void revealPath(dir)
      break
    case 'move-up':
    case 'move-down':
      await moveCluster(c.key, id === 'move-up' ? -1 : 1)
      break
    case 'toggle':
      toggle(c)
      break
    case 'close-project':
      emit('closeProject', c)
      break
    case 'forget':
      forget(c)
      break
  }
}

const compactFlow = useCompact()

function showRowMenu(row: RailRow, at: DOMRect, trigger: HTMLElement | null): void {
  ++menuSeq
  const tab = workspace.tabs.find((x) => x.key === row.tabKey)
  const cwd = workCwd(row.pane) ?? null
  const entries = rowMenu(
    {
      tabRow: row.key.startsWith('tab:'),
      cwd,
      explorer: hasExplorer,
      agent: isTerm(row.pane) && (row.kind === 'agent' || !!row.pane.terminalId),
      linked: !!row.pane.terminalId,
      others: tab ? leaves(tab.root).length - 1 : 0,
      targets: rail.projectTabs(row.tabKey),
      compact: compactFlow.stateOf(row.pane),
    },
    t,
  )
  ctxMenu.value = { at, trigger, label: t('workspace.rail.menu.label', { name: rowName(row) }), entries, pick: (id) => pickRow(id, row, cwd) }
}

const rowName = (row: RailRow): string => rowLines(row, '').first

function pickRow(id: string, row: RailRow, cwd: string | null): void {
  if (id.startsWith('split:')) {
    const [, dir, choice] = id.split(':') as [string, SplitDir, SplitChoice]
    emit('split', row.paneKey, dir, choice)
    return
  }
  if (id.startsWith('move-to:')) {
    const target = id.slice('move-to:'.length)
    if (row.key.startsWith('tab:')) mergeTab(row.tabKey, target)
    else movePane(row.paneKey, rowName(row), target)
    return
  }
  switch (id) {
    case 'rename-tab':
      startRename(row.tabKey)
      break
    case 'move-out':
      detach(row.paneKey, rowName(row))
      break
    case 'focus':
      workspace.activate(row.paneKey)
      break
    case 'compact':
      compactFlow.start(row.paneKey)
      break
    case 'compact-cancel':
      compactFlow.cancel(row.paneKey)
      break
    case 'copy-cwd':
      if (cwd) void copyPath(cwd)
      break
    case 'explorer':
      emit('explorer', row.paneKey)
      break
    case 'monitor':
      if (row.pane.terminalId) {
        ui.setView('monitor')
        ui.focusTerminal(row.pane.terminalId)
      }
      break
    case 'close':
      closeRow(row)
      break
    case 'close-others': {
      const tab = workspace.tabs.find((x) => x.key === row.tabKey)
      const others = tab ? leaves(tab.root).filter((k) => k !== row.paneKey) : []
      if (others.length) emit('close', others)
      break
    }
  }
}

function showGroupMenu(group: RailGroup, at: DOMRect, trigger: HTMLElement | null): void {
  ++menuSeq
  ctxMenu.value = {
    at,
    trigger,
    label: t('workspace.tabActions.label', { name: group.title }),
    entries: groupMenu({ folded: group.folded }, t),
    pick: (id) => pickGroup(id, group),
  }
}

function pickGroup(id: string, group: RailGroup): void {
  switch (id) {
    case 'open':
      activateGroup(group)
      break
    case 'rename':
      startRename(group.tabKey)
      break
    case 'fold':
    case 'unfold':
      workspace.setFolded(group.tabKey, id === 'fold')
      break
    case 'ungroup': {
      const n = tabLeaves(group.tabKey).length
      workspace.ungroup(group.tabKey)
      flash(t('workspace.paneDrop.ungrouped', { tab: group.title, n }))
      break
    }
    case 'close':
      closeGroup(group)
      break
  }
}

function onGroupMenu(group: RailGroup, e: MouseEvent): void {
  if (echo()) return
  const el = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('[data-side-group]')
  showGroupMenu(group, cursorAt(e), el)
}

const groupOf = (cluster: RailCluster, el: HTMLElement): RailGroup | undefined =>
  cluster.checkouts.flatMap((k) => k.groups).find((g) => g.key === el.dataset.groupKey)

function showEmptyMenu(e: MouseEvent): void {
  if (props.only || (e.target as Element).closest('[data-group], [data-rail-open-project]')) return
  e.preventDefault()
  if (echo()) return
  ++menuSeq
  const entries = emptyMenu({ open: openable, any: clusters.value.length > 0 }, t)
  if (!entries.length) return
  ctxMenu.value = {
    at: cursorAt(e),
    trigger: null,
    label: t('workspace.rail.menu.empty'),
    entries,
    pick: (id) => {
      if (id === 'open-project') void pickProjectFolder()
      else collapsed.value = id === 'collapse-all' ? new Set([...collapsed.value, ...clusters.value.map((c) => c.key)]) : new Set()
    },
  }
}

function onHeadMenu(c: RailCluster, e: MouseEvent): void {
  if (echo()) return
  const head = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('[data-side-head]')
  void showProjectMenu(c, undefined, cursorAt(e), head)
}

function onCheckoutMenu(c: RailCluster, k: RailCheckout, e: MouseEvent): void {
  if (echo()) return
  void showProjectMenu(c, k, cursorAt(e), e.currentTarget as HTMLElement)
}

function onRowMenu(row: RailRow, e: MouseEvent): void {
  if (echo()) return
  const el = (e.currentTarget as HTMLElement).querySelector<HTMLElement>('[data-side-row]')
  showRowMenu(row, cursorAt(e), el)
}

/** Keyboard: menu under the focused header / checkout line / row. */
function openMenuFromKey(el: HTMLElement): void {
  const cluster = clusters.value.find((c) => c.key === el.closest<HTMLElement>('[data-group]')?.dataset.group)
  if (!cluster) return
  const r = el.getBoundingClientRect()
  const at = new DOMRect(r.left + 24, r.bottom, 0, 0)
  keyMenuAt = performance.now()
  if (el.hasAttribute('data-side-head')) void showProjectMenu(cluster, undefined, at, el)
  else if (el.hasAttribute('data-side-group')) {
    const g = groupOf(cluster, el)
    if (g) showGroupMenu(g, at, el)
  } else if (el.hasAttribute('data-side-checkout')) {
    const k = cluster.checkouts.find((x) => x.key === el.dataset.checkoutKey)
    if (k) void showProjectMenu(cluster, k, at, el)
  } else {
    const row = cluster.checkouts.flatMap((k) => k.rows).find((x) => x.key === el.dataset.rowKey)
    if (row) showRowMenu(row, at, el)
  }
}

// Roving focus over headers, checkout lines and rows, in screen order; Alt+↑/↓ on a header reorders projects.
function onKey(e: KeyboardEvent): void {
  const el = document.activeElement as HTMLElement | null
  if (!el?.matches('[data-side-item]')) return
  if (isMenuKey(e)) {
    e.preventDefault()
    e.stopPropagation()
    openMenuFromKey(el)
    return
  }
  const isHeader = el.hasAttribute('data-side-head')
  if (isHeader && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault()
    void moveBy(el, e.key === 'ArrowUp' ? -1 : 1)
    return
  }
  if (e.altKey || e.ctrlKey || e.metaKey) return
  if (e.key === 'F2' && !e.shiftKey && el.dataset.tabKey) {
    e.preventDefault()
    e.stopPropagation()
    startRename(el.dataset.tabKey)
    return
  }
  const items = [...((e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[data-side-item]'))].filter((n) => n.offsetParent && !n.closest('[inert]'))
  const at = items.indexOf(el)
  const cluster = clusters.value.find((c) => c.key === el.closest<HTMLElement>('[data-group]')?.dataset.group)
  const group = cluster && el.hasAttribute('data-side-group') ? groupOf(cluster, el) : undefined
  const section = el.closest('[data-group]')
  const memberOf = el.closest<HTMLElement>('[data-rail-member]')?.dataset.railMember
  const after = items[at + 1]
  let next: HTMLElement | undefined
  if (e.key === 'ArrowDown') next = items[(at + 1) % items.length]
  else if (e.key === 'ArrowUp') next = items[(at - 1 + items.length) % items.length]
  else if (e.key === 'Home') next = items[0]
  else if (e.key === 'End') next = items.at(-1)
  else if (e.key === 'ArrowLeft' && cluster) {
    if (isHeader) toggle(cluster, false)
    else if (group && !group.folded) workspace.setFolded(group.tabKey, true)
    else if (memberOf) next = section?.querySelector<HTMLElement>(`[data-side-group][data-tab-key="${CSS.escape(memberOf)}"]`) ?? undefined
    else next = section?.querySelector<HTMLElement>('[data-side-head]') ?? undefined
  } else if (e.key === 'ArrowRight' && cluster && isHeader) {
    if (collapsed.value.has(cluster.key)) toggle(cluster, true)
    else if (after?.closest('[data-group]') === section) next = after
  } else if (e.key === 'ArrowRight' && group) {
    if (group.folded) workspace.setFolded(group.tabKey, false)
    else if (after?.closest<HTMLElement>('[data-rail-member]')?.dataset.railMember === group.tabKey) next = after
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
    ref="navEl"
    class="flex h-full w-full flex-col gap-1.5 p-1.5"
    :class="flat ? '' : 'ccm-material rounded-card'"
    :aria-label="t('workspace.rail.title')"
    data-rail
    @keydown="onKey"
    @focusin="onFocusIn"
    @pointerdown="onPointerDown"
    @contextmenu="showEmptyMenu"
  >
    <button
      v-if="!only && openable"
      type="button"
      class="inline-flex h-8 w-full shrink-0 cursor-pointer items-center gap-2 rounded-inner border border-dashed border-line px-2 text-left text-xs text-ink-muted transition-colors duration-(--ccm-dur-fast) hover:bg-fill hover:text-ink disabled:cursor-default disabled:text-ink-faint"
      :title="t('workspace.rail.openProjectHint')"
      :disabled="picking"
      data-rail-open-project
      @click="pickProjectFolder"
    >
      <LoaderCircle v-if="picking" :size="14" class="ccm-spin shrink-0" aria-hidden="true" />
      <FolderPlus v-else :size="14" class="shrink-0" aria-hidden="true" />
      <span class="min-w-0 truncate">{{ t('workspace.rail.openProject') }}</span>
    </button>
    <div ref="list" class="ccm-scroll min-h-0 flex-1 overflow-y-auto">
    <TransitionGroup
      tag="div"
      name="ccm-list"
      class="relative flex flex-col gap-1.5"
      :role="clusters.length ? 'tree' : undefined"
      :aria-label="clusters.length ? t('workspace.railTree.label') : undefined"
      @before-leave="pinLeaving"
      @leave="onClusterLeave"
    >
      <RailClusterView
        v-for="(c, ci) in clusters"
        :key="c.key"
        :cluster="c"
        :index="ci"
        :collapsed="collapsed.has(c.key)"
        :narrow="narrow"
        :new-open="newMenu?.cluster.key === c.key"
        :menu-open="projectMenu?.cluster.key === c.key"
        :renaming="renaming"
        @toggle="(open) => toggle(c, open)"
        @focus="(key) => workspace.activate(key)"
        @close="closeRow"
        @activate-group="activateGroup"
        @fold="(g, folded) => workspace.setFolded(g.tabKey, folded)"
        @close-group="closeGroup"
        @rename="startRename"
        @renamed="onRenamed"
        @context-group="onGroupMenu"
        @new="(e) => openNew(c, e)"
        @menu="(e) => openProject(c, e)"
        @forget="forget(c)"
        @checkout="openCheckout"
        @context-head="(e) => onHeadMenu(c, e)"
        @context-checkout="(k, e) => onCheckoutMenu(c, k, e)"
        @context-row="onRowMenu"
      />
    </TransitionGroup>
    </div>
    <p v-if="status" class="shrink-0 truncate px-1 text-2xs text-ink-muted" aria-hidden="true" data-rail-status>{{ status }}</p>
    <span class="sr-only" aria-live="polite">{{ announce }}</span>
    <ContextMenu
      v-if="ctxMenu"
      :at="ctxMenu.at"
      :entries="ctxMenu.entries"
      :label="ctxMenu.label"
      :trigger="ctxMenu.trigger"
      @pick="ctxMenu.pick"
      @close="ctxMenu = null"
    />

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
