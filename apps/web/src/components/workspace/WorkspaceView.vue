<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { BellRing, ChevronDown, History, PanelLeft, Plus, X } from 'lucide-vue-next'
import type { TerminalSession } from '@ccm/shared'
import { usePaneInfo } from '../../composables/usePaneInfo'
import { useWorkspaceLinks } from '../../composables/useWorkspaceLinks'
import type { LinkOpenOptions, LinkTarget } from '../../lib/fileLinks'
import { shortPath } from '../../lib/format'
import { changesStatus, hasPreview, pickFile, previewUrl, readFile, requestAccess } from '../../lib/preview'
import { pinLeaving, retireOverlay, withViewTransition } from '../../lib/motion'
import { isMac } from '../../lib/platform'
import { boxes, clampRatio, dividers, leaves, type Box, type Divider, type SplitDir } from '../../lib/splitLayout'
import { workspaceAction } from '../../lib/workspaceKeys'
import { useTerminalsStore } from '../../stores/terminals'
import { isTerm, primaryPaneKey, useWorkspaceStore, workCwd, type Pane, type PaneSpec, type SplitChoice, type Tab } from '../../stores/workspace'
import StatusIcon from '../StatusIcon.vue'
import LaunchPicker from './LaunchPicker.vue'
import BrowserPane from './BrowserPane.vue'
import ChangesPane from './ChangesPane.vue'
import FilePane from './FilePane.vue'
import PaneIcon from './PaneIcon.vue'
import PresetIcon from './PresetIcon.vue'
import QuickOpen from './QuickOpen.vue'
import TermPane from './TermPane.vue'
import ViewPaneControls from './ViewPaneControls.vue'
import WorkspaceSidebar from './WorkspaceSidebar.vue'

/** The view is on screen: App hides it with v-show for other views and in compact mode. */
const props = defineProps<{ visible: boolean }>()

const { t } = useI18n()
const workspace = useWorkspaceStore()
const terminals = useTerminalsStore()
useWorkspaceLinks(() => props.visible)
const { describe, isBusy, labelOf, viewDetail } = usePaneInfo()

const SIDEBAR_KEY = 'ccm.workspace.sidebar'
const sidebarOpen = ref(readSidebar())
function readSidebar(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== '0'
  } catch {
    return true
  }
}
function toggleSidebar(): void {
  withViewTransition(() => (sidebarOpen.value = !sidebarOpen.value))
}
watch(sidebarOpen, (open) => {
  try {
    localStorage.setItem(SIDEBAR_KEY, open ? '1' : '0')
  } catch {
    // preference only
  }
})

const closing = computed(() => (workspace.pendingClose ?? []).map((k) => workspace.panes.find((p) => p.key === k)).filter((p): p is Pane => !!p))
const confirmButton = ref<HTMLButtonElement | null>(null)
const confirmSheet = ref<HTMLElement | null>(null)
let confirmReturn: HTMLElement | null = null
watch(
  () => workspace.pendingClose,
  async (keys, before) => {
    if (keys && !before) confirmReturn = document.activeElement as HTMLElement | null
    await nextTick()
    if (keys) return confirmButton.value?.focus()
    if (!before) return
    const back = confirmReturn
    confirmReturn = null
    if (back?.isConnected && back.getClientRects().length) back.focus()
    else focusActivePane()
  },
)

function trapConfirm(e: KeyboardEvent): void {
  if (e.key !== 'Tab' || !confirmSheet.value) return
  const buttons = [...confirmSheet.value.querySelectorAll<HTMLElement>('button:not([disabled])')]
  const at = buttons.indexOf(document.activeElement as HTMLElement)
  const next = buttons[(at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]
  e.preventDefault()
  next?.focus()
}

function focusActivePane(): void {
  const key = workspace.activeKey
  if (key) canvas.value?.querySelector<HTMLElement>(`[data-pane="${CSS.escape(key)}"] .xterm-helper-textarea`)?.focus()
}

/** Folder the focused pane works in: Changes, Quick open and "Open file…" start from it. */
const contextCwd = computed(() => (workspace.active ? workCwd(workspace.active) : undefined))

const HTML = /\.html?$/i

/** Paths outside every open project folder are denied until the user allows that folder once. */
async function ensureReadable(path: string, html: boolean): Promise<void> {
  const ok = html ? !!(await previewUrl(path)) : (await readFile(path))?.kind !== 'denied'
  if (!ok) await requestAccess(path)
}

/** Ctrl/⌘+click in a terminal. Each target opens in its own tab, reusing one already showing it. */
async function openLink(from: Pane, target: LinkTarget, opts: Partial<LinkOpenOptions>): Promise<void> {
  if (target.kind === 'url') {
    withViewTransition(() => workspace.openBrowser(target.url, { cwd: workCwd(from) }))
    return
  }
  const html = HTML.test(target.path) && !opts.shift
  await ensureReadable(target.path, html)
  withViewTransition(() => {
    if (html) workspace.openBrowser(target.path, { cwd: workCwd(from) })
    else workspace.openFile(target.path, opts.line ?? target.line, { cwd: workCwd(from) })
  })
}

function openBrowserTab(url: string): void {
  closeMenu(false)
  workspace.openBrowser(url, { cwd: contextCwd.value })
}

async function openFileTab(): Promise<void> {
  closeMenu(false)
  const path = await pickFile('any')
  if (!path) return
  if (HTML.test(path)) workspace.openBrowser(path, { cwd: contextCwd.value })
  else workspace.openFile(path)
}

function openChangesTab(): void {
  closeMenu(false)
  if (contextCwd.value) workspace.openChanges(contextCwd.value)
}

const quickOpen = ref(false)
const quickRoot = ref<string | null>(null)

/** Root = git toplevel of the focused pane's folder (ls-files from a sub-folder lists only that sub-folder). */
async function openQuick(): Promise<void> {
  const pane = workspace.active
  const cwd = pane?.kind === 'changes' ? (pane.root ?? pane.cwd) : pane && workCwd(pane)
  quickRoot.value = cwd ?? null
  quickOpen.value = true
  if (!cwd) return
  const status = await changesStatus(cwd)
  if (status.ok && quickRoot.value === cwd) quickRoot.value = status.root
}

function onQuickPick(target: { path: string; line?: number; split: boolean }): void {
  const key = workspace.activeKey
  const cwd = quickRoot.value ?? undefined
  withViewTransition(() => workspace.openFile(target.path, target.line, target.split && key ? { cwd, split: { key, dir: 'row' } } : { cwd }))
}

/** Browser → agent target; several candidates in other tabs → a picker, none → a notice. */
const agentChoices = ref<{ from: string; text: string | null; panes: Pane[] } | null>(null)
const agentNotice = ref<string | null>(null)
let noticeTimer: ReturnType<typeof setTimeout> | null = null

function insertFromBrowser(browserKey: string, text: string | null): void {
  const res = workspace.resolveAgentPane(browserKey)
  if ('pane' in res) return deliver(res.pane.key, text)
  if (res.choices.length === 1) return deliver(res.choices[0]!.key, text)
  if (!res.choices.length) {
    agentNotice.value = t('workspace.handoff.noTarget')
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => (agentNotice.value = null), 4000)
    return
  }
  agentChoices.value = { from: browserKey, text, panes: res.choices }
}

function deliver(paneKey: string, text: string | null): void {
  agentChoices.value = null
  if (text === null) workspace.insertImage(paneKey)
  else workspace.insertInto(paneKey, text)
}

const choiceList = ref<HTMLElement | null>(null)
watch(agentChoices, async (c) => {
  if (!c) return
  await nextTick()
  choiceList.value?.querySelector<HTMLElement>('button')?.focus()
})

function onChoiceKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    agentChoices.value = null
    return
  }
  const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
  if (!step || !choiceList.value) return
  e.preventDefault()
  const items = [...choiceList.value.querySelectorAll<HTMLElement>('button')]
  const at = items.indexOf(document.activeElement as HTMLElement)
  items[(at + step + items.length) % items.length]?.focus()
}

/** Panes that close without asking morph away; a confirmation sheet opens without one. */
function closePanes(keys: string[]): void {
  const asks = keys.some((k) => {
    const pane = paneOf(k)
    return !!pane && isBusy(pane)
  })
  if (asks) workspace.requestClose(keys, isBusy)
  else withViewTransition(() => workspace.requestClose(keys, isBusy))
}

function closeTab(tab: Tab): void {
  closePanes(leaves(tab.root))
}

function clearSeenAttention(): void {
  const pane = workspace.active
  if (pane?.attention && props.visible && document.hasFocus()) workspace.update(pane.key, { attention: undefined })
}
watch(() => [props.visible, workspace.activeKey, workspace.active?.attention], clearSeenAttention)

const GAP = 8
// 24 columns of 13px mono plus the well padding: narrower panes stop being usable for an agent TUI.
const MIN_PANE_PX = 220
const MIN_PANE_H_PX = 140

const canvas = ref<HTMLElement | null>(null)
const canvasSize = ref({ w: 0, h: 0 })
let canvasObserver: ResizeObserver | null = null

const menuOpen = ref(false)
const menuTrigger = ref<HTMLButtonElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const menuPicker = ref<InstanceType<typeof LaunchPicker> | null>(null)
const emptyPicker = ref<InstanceType<typeof LaunchPicker> | null>(null)

const tabBoxes = computed(() => (workspace.activeTab ? boxes(workspace.activeTab.root) : new Map<string, Box>()))
const tabDividers = computed(() => (workspace.activeTab ? dividers(workspace.activeTab.root) : []))
const multiPane = computed(() => tabBoxes.value.size > 1)

function launch(cwd: string | undefined): void {
  closeMenu(false)
  workspace.open(workspace.preset, cwd)
}

async function openMenu(): Promise<void> {
  // No tabs: the picker is already on screen, inline in the empty state.
  if (!workspace.tabs.length) return emptyPicker.value?.focusFirst()
  menuOpen.value = true
  await nextTick()
  menuPicker.value?.focusFirst()
}

function closeMenu(focusTrigger = true): void {
  if (!menuOpen.value) return
  menuOpen.value = false
  if (focusTrigger) menuTrigger.value?.focus()
}

function onFocusOut(e: FocusEvent): void {
  const next = e.relatedTarget as Node | null
  if (next && !menu.value?.contains(next) && !menuTrigger.value?.contains(next)) closeMenu(false)
}

function onOutside(e: PointerEvent): void {
  const target = e.target as Node
  if (!menu.value?.contains(target) && !menuTrigger.value?.contains(target)) closeMenu(false)
}

watch(menuOpen, (open) => {
  if (open) document.addEventListener('pointerdown', onOutside, true)
  else document.removeEventListener('pointerdown', onOutside, true)
})
watch(
  () => workspace.tabs.length,
  (n) => {
    if (!n) menuOpen.value = false
  },
)
watch(
  () => props.visible,
  (shown) => {
    if (!shown) menuOpen.value = false
  },
)

/** The monitor session living in this pane, while it still runs. */
function linked(pane: Pane | undefined): TerminalSession | undefined {
  const term = pane?.terminalId ? terminals.byId[pane.terminalId] : undefined
  return term && term.status !== 'stale' ? term : undefined
}

const paneOf = (key: string): Pane | undefined => workspace.panes.find((p) => p.key === key)

// The tab shows whoever needs the user most: a waiting agent beats a working one.
const RANK: Record<string, number> = { waiting: 4, error: 3, working: 2, idle: 1 }
function tabSession(tab: Tab): TerminalSession | undefined {
  return leaves(tab.root)
    .map((k) => linked(paneOf(k)))
    .filter((s): s is TerminalSession => !!s)
    .sort((a, b) => (RANK[b.status] ?? 0) - (RANK[a.status] ?? 0))[0]
}

function tabAttention(tab: Tab): Pane['attention'] {
  const kinds = leaves(tab.root).map((k) => paneOf(k)?.attention)
  return kinds.includes('waiting') ? 'waiting' : kinds.includes('done') ? 'done' : undefined
}

function tabEnded(tab: Tab): boolean {
  return leaves(tab.root).every((k) => {
    const s = paneOf(k)?.state
    return s === 'exited' || s === 'error' || s === 'gone'
  })
}

function boxStyle(box: Box): Record<string, string> {
  const edge = (v: number): boolean => v < 1e-6 || v > 1 - 1e-6
  const left = edge(box.x) ? 0 : GAP / 2
  const right = edge(box.x + box.w) ? 0 : GAP / 2
  const top = edge(box.y) ? 0 : GAP / 2
  const bottom = edge(box.y + box.h) ? 0 : GAP / 2
  return {
    left: `calc(${box.x * 100}% + ${left}px)`,
    top: `calc(${box.y * 100}% + ${top}px)`,
    width: `calc(${box.w * 100}% - ${left + right}px)`,
    height: `calc(${box.h * 100}% - ${top + bottom}px)`,
  }
}

function dividerStyle(d: Divider): Record<string, string> {
  if (d.dir === 'row') {
    const x = d.box.x + d.box.w * d.ratio
    return { left: `calc(${x * 100}% - ${GAP / 2}px)`, top: `${d.box.y * 100}%`, width: `${GAP}px`, height: `${d.box.h * 100}%` }
  }
  const y = d.box.y + d.box.h * d.ratio
  return { top: `calc(${y * 100}% - ${GAP / 2}px)`, left: `${d.box.x * 100}%`, height: `${GAP}px`, width: `${d.box.w * 100}%` }
}

/** Ratio bounds that keep both sides of a split at least the minimum pane size. */
function ratioBounds(d: Divider): [number, number] {
  const span = d.dir === 'row' ? d.box.w * canvasSize.value.w : d.box.h * canvasSize.value.h
  const min = d.dir === 'row' ? MIN_PANE_PX : MIN_PANE_H_PX
  const lo = span > 0 ? Math.max(clampRatio(0), min / span) : clampRatio(0)
  const hi = span > 0 ? Math.min(clampRatio(1), 1 - min / span) : clampRatio(1)
  return lo <= hi ? [lo, hi] : [0.5, 0.5]
}

function setDivider(d: Divider, ratio: number): void {
  const tab = workspace.activeTab
  if (!tab) return
  const [lo, hi] = ratioBounds(d)
  workspace.setRatio(tab.key, d.path, Math.min(hi, Math.max(lo, ratio)))
}

function startDrag(d: Divider, e: PointerEvent): void {
  const el = canvas.value
  if (!el) return
  const handle = e.currentTarget as HTMLElement
  handle.setPointerCapture(e.pointerId)
  const rect = el.getBoundingClientRect()
  let frame = 0
  const move = (ev: PointerEvent): void => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      const r = d.dir === 'row' ? ((ev.clientX - rect.left) / rect.width - d.box.x) / d.box.w : ((ev.clientY - rect.top) / rect.height - d.box.y) / d.box.h
      setDivider(d, r)
    })
  }
  const end = (): void => {
    handle.removeEventListener('pointermove', move)
    handle.removeEventListener('pointerup', end)
    handle.removeEventListener('pointercancel', end)
  }
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
}

function onDividerKey(d: Divider, e: KeyboardEvent): void {
  const back = d.dir === 'row' ? 'ArrowLeft' : 'ArrowUp'
  const fwd = d.dir === 'row' ? 'ArrowRight' : 'ArrowDown'
  if (e.key !== back && e.key !== fwd) return
  e.preventDefault()
  setDivider(d, d.ratio + (e.key === fwd ? 0.05 : -0.05))
}

/** Splits along the longer side unless told otherwise; refuses when the halves would be too small to use. */
function splitActive(dir?: SplitDir, choice?: SplitChoice, key = workspace.activeKey): void {
  const box = key ? tabBoxes.value.get(key) : undefined
  if (!key || !box) return
  const w = box.w * canvasSize.value.w
  const h = box.h * canvasSize.value.h
  const fits = (d: SplitDir): boolean => (d === 'row' ? w / 2 >= MIN_PANE_PX : h / 2 >= MIN_PANE_H_PX)
  const want: SplitDir = dir ?? (w >= h * 1.4 ? 'row' : 'col')
  const other: SplitDir = want === 'row' ? 'col' : 'row'
  const chosen = fits(want) ? want : !dir && fits(other) ? other : null
  const spec: PaneSpec | undefined = !choice ? undefined : choice === 'browser' ? { kind: 'browser', url: '' } : { kind: 'term', preset: choice }
  if (chosen) withViewTransition(() => workspace.split(key, chosen, spec))
}

function onGlobalKey(e: KeyboardEvent): void {
  if (!props.visible || e.defaultPrevented) return
  const action = workspaceAction(e, isMac, multiPane.value)
  if (!action) return
  e.preventDefault()
  e.stopPropagation()
  switch (action.t) {
    case 'newTab':
      void openMenu()
      break
    case 'split':
      splitActive(action.dir)
      break
    case 'closePane':
      if (workspace.activeKey) closePanes([workspace.activeKey])
      break
    case 'attention':
      workspace.nextAttention()
      break
    case 'cycleTab':
      workspace.cycleTab(action.step)
      break
    case 'tab': {
      const tab = workspace.tabs[action.index]
      if (tab) workspace.activateTab(tab.key)
      break
    }
    case 'focus':
      workspace.moveFocus(action.dir)
      break
    case 'quickOpen':
      if (quickOpen.value) quickOpen.value = false
      else if (hasPreview) void openQuick()
      break
  }
}

function onTabKey(e: KeyboardEvent, index: number): void {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
  e.preventDefault()
  const n = workspace.tabs.length
  const next = workspace.tabs[(index + (e.key === 'ArrowRight' ? 1 : -1) + n) % n]
  if (!next) return
  workspace.activateTab(next.key)
  ;(e.currentTarget as HTMLElement).parentElement?.parentElement?.querySelector<HTMLElement>(`[data-tab="${next.key}"]`)?.focus()
}

const lastSummary = computed(() => {
  const snap = workspace.last
  if (!snap) return null
  return {
    tabs: snap.tabs.length,
    panes: snap.panes.length,
    agents: snap.panes.filter((p) => p.resume).length,
  }
})

// One highlight slides between tabs (as in SessionTabs) instead of each tab switching its own background.
const tabStrip = ref<HTMLElement | null>(null)
const tabPill = ref<{ x: number; w: number } | null>(null)
const pillReady = ref(false)
let pillTarget: HTMLElement | null = null
const pillObserver = new ResizeObserver(() => measurePill())
function measurePill(): void {
  const el = tabStrip.value?.querySelector<HTMLElement>('[data-selected]') ?? null
  if (el !== pillTarget) {
    if (pillTarget) pillObserver.unobserve(pillTarget)
    if (el) pillObserver.observe(el)
    pillTarget = el
  }
  if (el && !el.offsetWidth) return
  tabPill.value = el ? { x: el.offsetLeft, w: el.offsetWidth } : null
  if (tabPill.value && !pillReady.value) requestAnimationFrame(() => (pillReady.value = true))
}
watch(() => [workspace.activeTab?.key, workspace.tabs.map((tab) => tab.key).join(), props.visible], measurePill, { flush: 'post' })

const tabPrimary = (tab: Tab): Pane | undefined => paneOf(primaryPaneKey(tab.root, paneOf))

function tabLabel(tab: Tab): string {
  const pane = tabPrimary(tab)
  if (!pane) return ''
  return isTerm(pane) ? t(`workspace.preset.${pane.preset}`) : labelOf(pane)
}

function tabTitle(tab: Tab): string | undefined {
  const keys = leaves(tab.root)
  if (keys.length > 1) return keys.map((k) => paneOf(k)).filter((p): p is Pane => !!p).map(describe).join('\n')
  const pane = paneOf(keys[0]!)
  return pane && !isTerm(pane) ? viewDetail(pane) : pane && workCwd(pane)
}

onMounted(() => {
  // Capture: runs before xterm's own handler sees the key.
  window.addEventListener('keydown', onGlobalKey, true)
  window.addEventListener('focus', clearSeenAttention)
  canvasObserver = new ResizeObserver(([entry]) => {
    if (entry) canvasSize.value = { w: entry.contentRect.width, h: entry.contentRect.height }
  })
  if (canvas.value) canvasObserver.observe(canvas.value)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKey, true)
  window.removeEventListener('focus', clearSeenAttention)
  document.removeEventListener('pointerdown', onOutside, true)
  canvasObserver?.disconnect()
  pillObserver.disconnect()
  if (noticeTimer) clearTimeout(noticeTimer)
})
</script>

<template>
  <main class="flex h-[calc(100dvh-var(--ccm-header-h,52px))] min-h-0 w-full gap-3 px-3 pt-2 pb-3 sm:px-4">
    <aside v-if="workspace.tabs.length && sidebarOpen" class="hidden w-56 shrink-0 md:block">
      <WorkspaceSidebar />
    </aside>
    <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
    <div v-if="workspace.tabs.length" class="flex min-w-0 items-center gap-2">
      <button
        type="button"
        class="ccm-btn-plain hidden shrink-0 md:inline-flex"
        :aria-pressed="sidebarOpen"
        :title="t('workspace.side.toggle')"
        :aria-label="t('workspace.side.toggle')"
        @click="toggleSidebar"
      >
        <PanelLeft :size="15" aria-hidden="true" />
      </button>
      <div ref="tabStrip" class="ccm-scroll relative flex min-w-0 flex-1 items-center overflow-x-auto" role="tablist" :aria-label="t('workspace.tabs')">
        <span
          v-if="tabPill"
          aria-hidden="true"
          class="pointer-events-none absolute top-0 left-0 h-7 rounded-inner bg-control shadow-control"
          :class="pillReady ? 'transition-[transform,width] duration-(--ccm-dur-slow) ease-spring' : ''"
          :style="{ width: `${tabPill.w}px`, transform: `translateX(${tabPill.x}px)` }"
        />
        <TransitionGroup name="ccm-tab" tag="div" role="presentation" class="flex items-center gap-1" @before-leave="pinLeaving">
        <div
          v-for="(tab, i) in workspace.tabs"
          :key="tab.key"
          role="presentation"
          :data-selected="tab === workspace.activeTab || undefined"
          class="group relative inline-flex h-7 shrink-0 items-center rounded-inner text-xs transition-colors duration-(--ccm-dur-fast)"
          :class="tab === workspace.activeTab ? 'text-ink' : 'text-ink-muted hover:bg-fill'"
        >
          <button
            type="button"
            role="tab"
            :data-tab="tab.key"
            :aria-selected="tab === workspace.activeTab"
            :tabindex="tab === workspace.activeTab ? 0 : -1"
            class="inline-flex h-full max-w-[260px] min-w-0 cursor-pointer items-center gap-1.5 pr-1 pl-2.5"
            :title="tabTitle(tab)"
            @click="workspace.activateTab(tab.key)"
            @keydown="onTabKey($event, i)"
          >
            <StatusIcon v-if="tabSession(tab)" :status="tabSession(tab)!.status" :size="13" />
            <PaneIcon v-else-if="tabPrimary(tab)" :pane="tabPrimary(tab)!" :size="13" class="shrink-0" />
            <span class="max-w-[20ch] shrink-0 truncate font-medium" data-tab-label>{{ tabLabel(tab) }}</span>
            <span v-if="tabPrimary(tab) && isTerm(tabPrimary(tab)!) && workCwd(tabPrimary(tab)!)" class="min-w-0 truncate text-ink-faint">{{ shortPath(workCwd(tabPrimary(tab)!)) }}</span>
            <span v-if="leaves(tab.root).length > 1" class="shrink-0 rounded-[4px] bg-fill px-1 text-2xs text-ink-muted tabular" data-pane-count>
              {{ leaves(tab.root).length }}<span class="sr-only"> {{ t('workspace.panes') }}</span>
            </span>
            <span
              v-if="tabAttention(tab)"
              :key="tabAttention(tab)"
              class="ccm-flash relative inline-flex shrink-0 rounded-full"
              :class="tabAttention(tab) === 'waiting' ? 'text-st-waiting' : 'text-st-done'"
              aria-hidden="true"
            >
              <StatusIcon :status="tabAttention(tab) === 'waiting' ? 'waiting' : 'completed'" :size="12" :animate="false" />
            </span>
            <span v-if="tabSession(tab)" class="sr-only">{{ t(`status.${tabSession(tab)!.status}`) }}</span>
            <span v-else-if="tabEnded(tab)" class="sr-only">{{ t('workspace.ended') }}</span>
          </button>
          <button
            type="button"
            class="mr-1 inline-flex size-5 cursor-pointer items-center justify-center rounded-[5px] text-ink-faint hover:bg-fill-strong hover:text-ink"
            :title="t('workspace.closeTab')"
            :aria-label="`${t('workspace.closeTab')}: ${tabLabel(tab)}`"
            @click="closeTab(tab)"
          >
            <X :size="12" aria-hidden="true" />
          </button>
        </div>
        </TransitionGroup>
      </div>
      <button
        v-if="workspace.attentionPanes.length"
        type="button"
        class="ccm-btn shrink-0 text-st-waiting!"
        :title="t('workspace.attention.jump', { keys: isMac ? '⌘⇧A' : 'Ctrl+Shift+A' })"
        @click="workspace.nextAttention()"
      >
        <BellRing :size="14" aria-hidden="true" />
        <span>{{ t('workspace.attention.chip', { n: workspace.attentionPanes.length }, workspace.attentionPanes.length) }}</span>
      </button>
      <div class="relative shrink-0" @keydown.esc.stop="closeMenu()" @focusout="onFocusOut">
        <button
          ref="menuTrigger"
          type="button"
          class="ccm-btn"
          aria-haspopup="dialog"
          :aria-expanded="menuOpen"
          :aria-label="t('workspace.newLabel')"
          :title="t('workspace.newHint', { keys: isMac ? '⌘T' : 'Ctrl+Shift+T' })"
          @click="menuOpen ? closeMenu() : openMenu()"
        >
          <Plus :size="14" aria-hidden="true" />
          <span>{{ t('workspace.new') }}</span>
          <ChevronDown :size="13" class="text-ink-muted" aria-hidden="true" />
        </button>
        <Transition name="ccm-menu" @before-leave="retireOverlay">
          <div
            v-if="menuOpen"
            ref="menu"
            class="ccm-menu absolute top-full right-0 z-40 mt-1.5 w-[min(380px,calc(100vw-24px))] p-2 [--ccm-origin:top_right]"
            role="dialog"
            :aria-label="t('workspace.launch.title')"
          >
            <LaunchPicker ref="menuPicker" :cwd="contextCwd" @launch="launch" @browser="openBrowserTab" @open-file="openFileTab" @changes="openChangesTab" />
          </div>
        </Transition>
      </div>
    </div>

    <div v-if="!workspace.tabs.length" class="ccm-scroll flex min-h-0 flex-1 flex-col items-center overflow-y-auto py-6">
      <div class="my-auto flex w-full max-w-[400px] flex-col gap-3">
        <div class="px-1 text-center">
          <h2 class="text-base font-semibold text-ink">{{ t('workspace.empty.title') }}</h2>
          <p class="mt-1 text-sm text-ink-muted">{{ t('workspace.empty.body') }}</p>
        </div>
        <section v-if="lastSummary" class="flex items-center gap-3 rounded-control bg-surface p-3 shadow-card" :aria-label="t('workspace.restore.title')">
          <History :size="18" class="shrink-0 text-accent-ink" aria-hidden="true" />
          <div class="min-w-0 flex-1">
            <p class="text-sm font-semibold text-ink">{{ t('workspace.restore.title') }}</p>
            <p class="text-xs text-ink-muted">
              {{ t('workspace.restore.summary', { tabs: lastSummary.tabs }, lastSummary.tabs) }}
              <template v-if="lastSummary.agents"> · {{ t('workspace.restore.agents', { n: lastSummary.agents }, lastSummary.agents) }}</template>
            </p>
          </div>
          <button type="button" class="ccm-btn ccm-btn-primary shrink-0" @click="workspace.restoreLast()">{{ t('workspace.restore.action') }}</button>
          <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.restore.dismiss')" :aria-label="t('workspace.restore.dismiss')" @click="workspace.dismissLast()">
            <X :size="14" aria-hidden="true" />
          </button>
        </section>
        <div class="ccm-group p-2">
          <LaunchPicker ref="emptyPicker" @launch="launch" @browser="openBrowserTab" @open-file="openFileTab" />
        </div>
      </div>
    </div>

    <!-- Every pane lives here flat, placed by its box: splitting or switching tabs never remounts a terminal. -->
    <div v-show="workspace.tabs.length" ref="canvas" class="relative min-h-0 flex-1">
      <template v-for="pane in workspace.panes" :key="pane.key">
        <TermPane
          v-if="isTerm(pane)"
          v-show="tabBoxes.has(pane.key)"
          class="absolute"
          :style="tabBoxes.has(pane.key) ? boxStyle(tabBoxes.get(pane.key)!) : undefined"
          :pane="pane"
          :visible="visible && tabBoxes.has(pane.key)"
          :focused="pane.key === workspace.activeKey"
          :multi="multiPane"
          @split="(choice) => splitActive(undefined, choice, pane.key)"
          @close="closePanes([pane.key])"
          @open-link="(target, opts) => openLink(pane, target, opts)"
        />
        <!-- Viewer panes carry their own toolbar; the wrapper only places, focuses and rings them. -->
        <div
          v-else
          v-show="tabBoxes.has(pane.key)"
          class="absolute flex min-h-0 min-w-0 flex-col rounded-card outline-1 -outline-offset-1 transition-[outline-color] duration-(--ccm-dur-fast)"
          :class="multiPane && pane.key === workspace.activeKey ? 'outline-focus' : 'outline-transparent'"
          :style="[tabBoxes.has(pane.key) ? boxStyle(tabBoxes.get(pane.key)!) : {}, visible && tabBoxes.has(pane.key) ? { viewTransitionName: `ccm-pane-${pane.key}`, viewTransitionClass: 'ccm-pane' } : {}]"
          :data-pane="pane.key"
          :data-kind="pane.kind"
          @pointerdown="workspace.activate(pane.key)"
          @focusin="workspace.activate(pane.key)"
        >
          <BrowserPane
            v-if="pane.kind === 'browser'"
            class="min-h-0 flex-1"
            :url="pane.url ?? ''"
            :active="visible && tabBoxes.has(pane.key)"
            @navigate="(url) => workspace.update(pane.key, { url })"
            @title="(title) => workspace.update(pane.key, { title })"
            @favicon="(favicon) => workspace.update(pane.key, { favicon })"
            @insert-text="(text) => insertFromBrowser(pane.key, text)"
            @insert-image="insertFromBrowser(pane.key, null)"
          >
            <template #toolbar-end>
              <ViewPaneControls @split="(choice) => splitActive(undefined, choice, pane.key)" @close="closePanes([pane.key])" />
            </template>
          </BrowserPane>
          <FilePane
            v-else-if="pane.kind === 'file'"
            class="min-h-0 flex-1"
            :path="pane.path!"
            :line="pane.line"
            :active="visible && tabBoxes.has(pane.key)"
            @open="(path) => workspace.openFile(path, undefined, { cwd: pane.cwd })"
          >
            <template #end>
              <ViewPaneControls @split="(choice) => splitActive(undefined, choice, pane.key)" @close="closePanes([pane.key])" />
            </template>
          </FilePane>
          <ChangesPane
            v-else
            class="min-h-0 flex-1"
            :cwd="pane.cwd!"
            :active="visible && tabBoxes.has(pane.key)"
            @open="(path, line) => workspace.openFile(path, line, { cwd: pane.root ?? pane.cwd })"
            @count="(count) => workspace.update(pane.key, { count })"
            @root="(root) => workspace.update(pane.key, { root })"
          >
            <template #end>
              <ViewPaneControls @split="(choice) => splitActive(undefined, choice, pane.key)" @close="closePanes([pane.key])" />
            </template>
          </ChangesPane>
        </div>
      </template>
      <div
        v-for="d in tabDividers"
        :key="`${workspace.activeTab?.key}:${d.path}`"
        class="group/div absolute z-10 flex touch-none items-center justify-center outline-none"
        :class="d.dir === 'row' ? 'cursor-col-resize' : 'cursor-row-resize'"
        :style="dividerStyle(d)"
        role="separator"
        tabindex="0"
        :aria-orientation="d.dir === 'row' ? 'vertical' : 'horizontal'"
        :aria-valuenow="Math.round(d.ratio * 100)"
        aria-valuemin="15"
        aria-valuemax="85"
        :aria-label="t('workspace.resize')"
        @pointerdown.prevent="startDrag(d, $event)"
        @keydown="onDividerKey(d, $event)"
      >
        <span
          class="rounded-full bg-transparent transition-colors duration-150 group-hover/div:bg-accent group-focus-visible/div:bg-accent group-active/div:bg-accent"
          :class="d.dir === 'row' ? 'h-full w-0.5' : 'h-0.5 w-full'"
        />
      </div>
    </div>
    </div>

    <Teleport to="body">
      <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div v-if="closing.length" class="ccm-scrim fixed inset-0 z-50 flex items-center justify-center p-4" @click.self="workspace.cancelClose()">
        <div
          ref="confirmSheet"
          class="ccm-sheet flex w-full max-w-[440px] flex-col gap-3 p-5"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="ws-close-title"
          aria-describedby="ws-close-body"
          @keydown.esc.stop="workspace.cancelClose()"
          @keydown="trapConfirm"
        >
          <h2 id="ws-close-title" class="text-base font-semibold text-ink">{{ t('workspace.closeConfirm.title', { n: closing.length }, closing.length) }}</h2>
          <div id="ws-close-body" class="flex flex-col gap-2 text-sm text-ink-muted">
            <p>{{ t('workspace.closeConfirm.body') }}</p>
            <ul class="flex flex-col gap-1 rounded-inner bg-fill p-2 text-xs text-ink">
              <li v-for="p in closing" :key="p.key" class="flex min-w-0 items-center gap-1.5" :class="isBusy(p) ? '' : 'text-ink-muted'">
                <PaneIcon :pane="p" :size="13" class="shrink-0" />
                <span class="truncate" :title="p.cwd">{{ describe(p) }}</span>
              </li>
            </ul>
          </div>
          <div class="flex justify-end gap-2">
            <button type="button" class="ccm-btn" @click="workspace.cancelClose()">{{ t('workspace.closeConfirm.cancel') }}</button>
            <button ref="confirmButton" type="button" class="ccm-btn ccm-btn-danger" @click="workspace.confirmClose()">
              {{ t('workspace.closeConfirm.action', { n: closing.length }, closing.length) }}
            </button>
          </div>
        </div>
      </div>
      </Transition>
    </Teleport>

    <QuickOpen :open="quickOpen" :root="quickRoot" @close="quickOpen = false" @open="onQuickPick" />

    <Teleport to="body">
      <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
        <div v-if="agentChoices" class="ccm-scrim fixed inset-0 z-50 flex items-center justify-center p-4" @click.self="agentChoices = null">
          <div class="ccm-sheet flex w-full max-w-[360px] flex-col gap-2 p-3" role="dialog" aria-modal="true" aria-labelledby="ws-agent-title" @keydown="onChoiceKey">
            <h2 id="ws-agent-title" class="px-1 text-sm font-semibold text-ink">{{ t('workspace.handoff.pickTarget') }}</h2>
            <ul ref="choiceList" class="flex flex-col" role="list">
              <li v-for="p in agentChoices.panes" :key="p.key">
                <button
                  type="button"
                  class="group flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-inner px-2 text-left text-sm text-ink hover:bg-fill focus-visible:bg-accent focus-visible:text-on-accent focus-visible:outline-none"
                  @click="deliver(p.key, agentChoices!.text)"
                >
                  <PresetIcon :preset="p.preset" :size="14" class="shrink-0 group-focus-visible:text-on-accent" />
                  <span class="truncate" :title="p.cwd">{{ describe(p) }}</span>
                </button>
              </li>
            </ul>
            <div class="flex justify-end">
              <button type="button" class="ccm-btn" @click="agentChoices = null">{{ t('workspace.closeConfirm.cancel') }}</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
    <Transition name="ccm-fade">
      <p
        v-if="agentNotice"
        class="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-control bg-raised px-3 py-2 text-xs text-ink shadow-pop"
        role="status"
      >
        {{ agentNotice }}
      </p>
    </Transition>
  </main>
</template>
