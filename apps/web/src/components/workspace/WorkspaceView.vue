<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { BellRing, ChevronDown, History, PanelLeft, Plus, X } from 'lucide-vue-next'
import type { PtyPreset, TerminalSession } from '@ccm/shared'
import { usePaneInfo } from '../../composables/usePaneInfo'
import { useWorkspaceLinks } from '../../composables/useWorkspaceLinks'
import { shortPath } from '../../lib/format'
import { isMac } from '../../lib/platform'
import { boxes, clampRatio, dividers, leaves, type Box, type Divider, type SplitDir } from '../../lib/splitLayout'
import { workspaceAction } from '../../lib/workspaceKeys'
import { useTerminalsStore } from '../../stores/terminals'
import { useUiStore } from '../../stores/ui'
import { useWorkspaceStore, type Pane, type Tab } from '../../stores/workspace'
import StatusIcon from '../StatusIcon.vue'
import LaunchPicker from './LaunchPicker.vue'
import PresetIcon from './PresetIcon.vue'
import TermPane from './TermPane.vue'
import WorkspaceSidebar from './WorkspaceSidebar.vue'

const { t } = useI18n()
const ui = useUiStore()
const workspace = useWorkspaceStore()
const terminals = useTerminalsStore()
useWorkspaceLinks()
const { describe, isBusy } = usePaneInfo()

const SIDEBAR_KEY = 'ccm.workspace.sidebar'
const sidebarOpen = ref(readSidebar())
function readSidebar(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) !== '0'
  } catch {
    return true
  }
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
watch(
  () => workspace.pendingClose,
  async (keys) => {
    if (!keys) return
    await nextTick()
    confirmButton.value?.focus()
  },
)

function closeTab(tab: Tab): void {
  workspace.requestClose(leaves(tab.root), isBusy)
}

function clearSeenAttention(): void {
  const pane = workspace.active
  if (pane?.attention && ui.view === 'workspace' && document.hasFocus()) workspace.update(pane.key, { attention: undefined })
}
watch(() => [ui.view, workspace.activeKey, workspace.active?.attention], clearSeenAttention)

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

const tabBoxes = computed(() => (workspace.activeTab ? boxes(workspace.activeTab.root) : new Map<string, Box>()))
const tabDividers = computed(() => (workspace.activeTab ? dividers(workspace.activeTab.root) : []))
const multiPane = computed(() => tabBoxes.value.size > 1)

function launch(cwd: string | undefined): void {
  closeMenu(false)
  workspace.open(workspace.preset, cwd)
}

async function openMenu(): Promise<void> {
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
function splitActive(dir?: SplitDir, preset?: PtyPreset, key = workspace.activeKey): void {
  const box = key ? tabBoxes.value.get(key) : undefined
  if (!key || !box) return
  const w = box.w * canvasSize.value.w
  const h = box.h * canvasSize.value.h
  const fits = (d: SplitDir): boolean => (d === 'row' ? w / 2 >= MIN_PANE_PX : h / 2 >= MIN_PANE_H_PX)
  const want: SplitDir = dir ?? (w >= h * 1.4 ? 'row' : 'col')
  const other: SplitDir = want === 'row' ? 'col' : 'row'
  const chosen = fits(want) ? want : !dir && fits(other) ? other : null
  if (chosen) workspace.split(key, chosen, preset)
}

function onGlobalKey(e: KeyboardEvent): void {
  if (ui.view !== 'workspace' || e.defaultPrevented) return
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
      if (workspace.activeKey) workspace.requestClose([workspace.activeKey], isBusy)
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

function tabLabel(tab: Tab): string {
  const pane = paneOf(tab.focus)
  return pane ? t(`workspace.preset.${pane.preset}`) : ''
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
        @click="sidebarOpen = !sidebarOpen"
      >
        <PanelLeft :size="15" aria-hidden="true" />
      </button>
      <div class="ccm-scroll flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" role="tablist" :aria-label="t('workspace.tabs')">
        <div
          v-for="(tab, i) in workspace.tabs"
          :key="tab.key"
          class="group inline-flex h-7 shrink-0 items-center rounded-inner text-xs"
          :class="tab === workspace.activeTab ? 'bg-control text-ink shadow-control' : 'text-ink-muted hover:bg-fill'"
        >
          <button
            type="button"
            role="tab"
            :data-tab="tab.key"
            :aria-selected="tab === workspace.activeTab"
            :tabindex="tab === workspace.activeTab ? 0 : -1"
            class="inline-flex h-full max-w-[260px] min-w-0 cursor-pointer items-center gap-1.5 pr-1 pl-2.5"
            :title="paneOf(tab.focus)?.cwd"
            @click="workspace.activateTab(tab.key)"
            @keydown="onTabKey($event, i)"
          >
            <StatusIcon v-if="tabSession(tab)" :status="tabSession(tab)!.status" :size="13" />
            <PresetIcon v-else-if="paneOf(tab.focus)" :preset="paneOf(tab.focus)!.preset" :size="13" class="shrink-0" />
            <span class="truncate font-medium">{{ tabLabel(tab) }}</span>
            <span v-if="paneOf(tab.focus)?.cwd" class="truncate text-ink-faint">{{ shortPath(paneOf(tab.focus)!.cwd) }}</span>
            <span v-if="leaves(tab.root).length > 1" class="shrink-0 rounded-[4px] bg-fill px-1 text-2xs text-ink-muted tabular">
              {{ leaves(tab.root).length }}<span class="sr-only"> {{ t('workspace.panes') }}</span>
            </span>
            <span
              v-if="leaves(tab.root).some((k) => paneOf(k)?.attention)"
              class="size-1.5 shrink-0 rounded-full"
              :class="leaves(tab.root).some((k) => paneOf(k)?.attention === 'waiting') ? 'bg-st-waiting' : 'bg-st-done'"
              aria-hidden="true"
            />
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
          :title="t('workspace.newHint', { keys: isMac ? '⌘T' : 'Ctrl+Shift+T' })"
          @click="menuOpen ? closeMenu() : openMenu()"
        >
          <Plus :size="14" aria-hidden="true" />
          <span>{{ t('workspace.new') }}</span>
          <ChevronDown :size="13" class="opacity-60" aria-hidden="true" />
        </button>
        <div
          v-if="menuOpen"
          ref="menu"
          class="ccm-menu ccm-pop absolute top-full right-0 z-40 mt-1.5 w-[min(380px,calc(100vw-24px))] p-2"
          role="dialog"
          :aria-label="t('workspace.launch.title')"
        >
          <LaunchPicker ref="menuPicker" @launch="launch" />
        </div>
      </div>
    </div>

    <div v-if="!workspace.tabs.length" class="ccm-scroll flex min-h-0 flex-1 flex-col items-center overflow-y-auto py-6">
      <div class="my-auto flex w-full max-w-[400px] flex-col gap-3">
        <div class="px-1 text-center">
          <h2 class="text-base font-semibold text-ink">{{ t('workspace.empty.title') }}</h2>
          <p class="mt-1 text-sm text-ink-muted">{{ t('workspace.empty.body') }}</p>
        </div>
        <section v-if="lastSummary" class="flex items-center gap-3 rounded-control bg-surface p-3 shadow-card" :aria-label="t('workspace.restore.title')">
          <History :size="18" class="shrink-0 text-accent" aria-hidden="true" />
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
          <LaunchPicker @launch="launch" />
        </div>
      </div>
    </div>

    <!-- Every pane lives here flat, placed by its box: splitting or switching tabs never remounts a terminal. -->
    <div v-show="workspace.tabs.length" ref="canvas" class="relative min-h-0 flex-1">
      <TermPane
        v-for="pane in workspace.panes"
        v-show="tabBoxes.has(pane.key)"
        :key="pane.key"
        class="absolute"
        :style="tabBoxes.has(pane.key) ? boxStyle(tabBoxes.get(pane.key)!) : undefined"
        :pane="pane"
        :visible="tabBoxes.has(pane.key)"
        :focused="pane.key === workspace.activeKey"
        :multi="multiPane"
        @split="(preset) => splitActive(undefined, preset, pane.key)"
      />
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
      <div v-if="closing.length" class="ccm-scrim fixed inset-0 z-50 flex items-center justify-center p-4" @click.self="workspace.cancelClose()">
        <div
          class="ccm-sheet ccm-pop flex w-full max-w-[440px] flex-col gap-3 p-5"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="ws-close-title"
          aria-describedby="ws-close-body"
          @keydown.esc.stop="workspace.cancelClose()"
        >
          <h2 id="ws-close-title" class="text-base font-semibold text-ink">{{ t('workspace.closeConfirm.title', { n: closing.length }, closing.length) }}</h2>
          <div id="ws-close-body" class="flex flex-col gap-2 text-sm text-ink-muted">
            <p>{{ t('workspace.closeConfirm.body') }}</p>
            <ul class="flex flex-col gap-1 rounded-inner bg-fill p-2 text-xs text-ink">
              <li v-for="p in closing" :key="p.key" class="flex min-w-0 items-center gap-1.5" :class="isBusy(p) ? '' : 'opacity-60'">
                <PresetIcon :preset="p.preset" :size="13" class="shrink-0" />
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
    </Teleport>
  </main>
</template>
