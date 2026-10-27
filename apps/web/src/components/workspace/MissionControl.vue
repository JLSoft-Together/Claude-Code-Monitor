<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Ban, BellRing, Folder, FolderOpen, Plus, Search, X } from 'lucide-vue-next'
import { usePaneInfo } from '../../composables/usePaneInfo'
import { useCompact } from '../../composables/useCompact'
import { useRail } from '../../composables/useRail'
import { hasRun } from '../../lib/desktop'
import { onDustLeave } from '../../lib/dust'
import type { MenuEntry, Rect } from '../../lib/menu'
import { pinLeaving } from '../../lib/motion'
import { lastRows, snapshotOf } from '../../lib/paneSnapshots'
import { isMac } from '../../lib/platform'
import {
  flipFrames,
  flipOnto,
  missionFilter,
  missionGrid,
  spatialStep,
  unionRect,
  type MissionCard as Card,
  type MissionDrop,
  type MissionPaneFacts,
  type MissionSection,
  type NavDir,
  type NavRect,
} from '../../lib/rail/mission'
import { cardMenu, menuPick, tileMenu } from '../../lib/rail/missionMenu'
import { isMenuKey } from '../../lib/rail/railMenu'
import { runState, type RailState } from '../../lib/rail/railModel'
import { leaves } from '../../lib/splitLayout'
import { useRunStore } from '../../stores/run'
import { useSettingsStore } from '../../stores/settings'
import { isTerm, useWorkspaceStore, type Pane, type Tab } from '../../stores/workspace'
import ArtImage from '../ArtImage.vue'
import ContextMenu from '../ui/ContextMenu.vue'
import MissionCard from './mission/MissionCard.vue'
import { bodyAspect, missionLayout } from './mission/missionLayout'
import { dur, ease, flipAll, stagger, stopFlip, viewportBox } from './mission/missionMotion'
import { useMissionDrag } from './mission/useMissionDrag'
import PaneIcon from './PaneIcon.vue'

const props = defineProps<{ open: boolean; paneRect: (key: string) => DOMRect | null }>()
const emit = defineEmits<{ close: [focusOpener: boolean] }>()

const { t } = useI18n()
const workspace = useWorkspaceStore()
const settings = useSettingsStore()
const run = useRunStore()
const rail = useRail()
const info = usePaneInfo()
const uid = useId()

const SNAP_ROWS = 48
const ANNOUNCE_MS = 400
const LAYOUT = { head: 36, gap: 12, sectionHead: 34, sectionGap: 24, min: 280, max: 720 } as const
const FLASH = new Set<RailState>(['asked', 'done', 'failed'])
const KEY_MENU_ECHO_MS = 300

const paneOf = (k: string): Pane | undefined => workspace.panes.find((p) => p.key === k)
const tabOf = (k: string): Tab | undefined => workspace.tabs.find((x) => x.key === k)
const alive = (keys: string | undefined): boolean => !!keys && keys.split(' ').some((k) => !!k && !!paneOf(k))

function factsOf(paneKey: string): MissionPaneFacts {
  const pane = paneOf(paneKey)
  if (!pane) return { state: null, run: null, subagents: 0 }
  if (pane.kind === 'run') {
    const badge = rail.runOf(pane)
    return { state: runState(badge), run: badge, subagents: 0 }
  }
  if (!isTerm(pane)) return { state: null, run: null, subagents: 0 }
  return { state: info.railStateOf(pane), run: null, subagents: info.subagentsOf(pane) }
}

const titleOfPane = (k: string): string => {
  const pane = paneOf(k)
  return pane ? info.titleOf(pane) : ''
}

const lead = ref<string | null>(null)
const sections = computed((): MissionSection[] => {
  if (!props.open) return []
  return missionGrid({
    clusters: rail.clusters.value,
    tabs: workspace.tabs,
    activeTabKey: workspace.activeTab?.key ?? null,
    lead: lead.value,
    tabTitle: (tab) => info.tabTitle(tab),
    paneTitle: titleOfPane,
    facts: factsOf,
  })
})
const cards = computed(() => sections.value.flatMap((s) => s.cards))
const cardByKey = (k: string): Card | undefined => cards.value.find((c) => c.tabKey === k)
const sectionOf = (k: string): MissionSection | undefined => sections.value.find((s) => s.cards.some((c) => c.tabKey === k))
const sectionName = (s: MissionSection): string => (s.key === 'home' ? t('workspace.side.home') : s.name)
const sectionPanes = (s: MissionSection): string => s.cards.flatMap((c) => c.tiles.map((x) => x.paneKey)).join(' ')
const sectionIds = computed(() => new Map(sections.value.map((s, i) => [s.key, `${uid}-s${i}`])))
const sectionId = (s: MissionSection): string => sectionIds.value.get(s.key) ?? `${uid}-s`

const query = ref('')
const filterEl = ref<HTMLInputElement | null>(null)
const visibleSections = computed(() => missionFilter(sections.value, query.value, sectionName))
const visibleCards = computed(() => visibleSections.value.flatMap((s) => s.cards))
const cardIndex = computed(() => new Map(visibleCards.value.slice(0, 9).map((c, i) => [c.tabKey, i + 1])))

const scroller = ref<HTMLElement | null>(null)
const view = ref({ width: 0, height: 0, aspect: 1.6 })
let resized = false

function readView(el: HTMLElement): { width: number; height: number; aspect: number } {
  const css = getComputedStyle(el)
  const width = el.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight)
  const height = el.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom)
  const box = root.value
  return { width, height, aspect: bodyAspect(box?.clientWidth ?? width, box?.clientHeight ?? height) }
}

function setView(next: { width: number; height: number; aspect: number }): boolean {
  const now = view.value
  if (Math.abs(now.width - next.width) < 0.5 && Math.abs(now.height - next.height) < 0.5 && Math.abs(now.aspect - next.aspect) < 0.005) return false
  view.value = next
  return true
}

function measure(): void {
  const el = scroller.value
  if (!el || !setView(readView(el))) return
  resized = true
  void nextTick(() => {
    resized = false
  })
}

const sizer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
watch(scroller, (el, old) => {
  if (old) sizer?.unobserve(old)
  if (el) sizer?.observe(el)
})
onBeforeUnmount(() => sizer?.disconnect())

const layout = computed(() =>
  missionLayout({
    ...LAYOUT,
    width: view.value.width,
    height: view.value.height - 2,
    aspect: view.value.aspect,
    counts: visibleSections.value.map((s) => s.cards.length),
  }),
)
const colsOf = (i: number): number => layout.value.cols[i] ?? 1
const gridStyle = (i: number): Record<string, string> => ({ gridTemplateColumns: `repeat(${colsOf(i)}, ${layout.value.cardW}px)` })
const cardH = computed(() => LAYOUT.head + layout.value.bodyH)

function runTail(paneKey: string): string {
  const pane = paneOf(paneKey)
  if (!hasRun || pane?.kind !== 'run' || !pane.cwd) return ''
  const session = run.focusedSession(pane.cwd)
  return session ? lastRows(run.linesFor(session.id).slice(-SNAP_ROWS * 4).map((l) => l.text), SNAP_ROWS) : ''
}
const snapOf = (k: string): string => snapshotOf(k, SNAP_ROWS) || runTail(k)

const snaps = ref<Record<string, string>>({})
const flashes = ref<Record<string, number>>({})
const highlights = ref<Record<string, number>>({})
let seq = 0

watch(
  () => workspace.panes.map((p) => p.key).join(' '),
  () => {
    if (!props.open) return
    const missing = workspace.panes.filter((p) => !(p.key in snaps.value))
    if (missing.length) snaps.value = { ...snaps.value, ...Object.fromEntries(missing.map((p) => [p.key, snapOf(p.key)])) }
  },
)

const tileStates = computed(() => new Map(cards.value.flatMap((c) => c.tiles.map((x) => [x.paneKey, x.state] as const))))
let seen = new Map<string, RailState | null>()
watch(tileStates, (now) => {
  if (!props.open) return
  let flash: Record<string, number> | null = null
  let fresh: Record<string, string> | null = null
  for (const [k, s] of now) {
    if (!seen.has(k) || seen.get(k) === s) continue
    ;(fresh ??= { ...snaps.value })[k] = snapOf(k)
    if (s && FLASH.has(s)) (flash ??= { ...flashes.value })[k] = ++seq
  }
  seen = now
  if (fresh) snaps.value = fresh
  if (flash) flashes.value = flash
})

const root = ref<HTMLElement | null>(null)
const LIVE_CARD = '[data-mission-card]:not(.mc-card-leave-active)'
const inLeavingSection = (el: HTMLElement): boolean => !!el.closest('.mc-section-leave-active')
const cardEls = (): HTMLElement[] => [...(root.value?.querySelectorAll<HTMLElement>(LIVE_CARD) ?? [])].filter((el) => !inLeavingSection(el))
const cardEl = (key: string | null): HTMLElement | null =>
  key
    ? ([...(root.value?.querySelectorAll<HTMLElement>(`[data-mission-card="${CSS.escape(key)}"]:not(.mc-card-leave-active)`) ?? [])].find((el) => !inLeavingSection(el)) ?? null)
    : null
const tileEl = (key: string): HTMLElement | null => root.value?.querySelector<HTMLElement>(`[data-mission-tile="${CSS.escape(key)}"]`) ?? null
function navRects(els: Iterable<HTMLElement>, key: (el: HTMLElement) => string): NavRect[] {
  return [...els].map((el) => {
    const r = el.getBoundingClientRect()
    return { key: key(el), left: r.left, top: r.top, width: r.width, height: r.height }
  })
}

const rovingKey = ref<string | null>(null)
const roving = computed(() => {
  const keys = visibleCards.value.map((c) => c.tabKey)
  if (rovingKey.value && keys.includes(rovingKey.value)) return rovingKey.value
  const active = workspace.activeTab?.key
  return active && keys.includes(active) ? active : (keys[0] ?? null)
})

function onFocusIn(e: FocusEvent): void {
  const key = (e.target as HTMLElement | null)?.closest?.<HTMLElement>('[data-mission-card]')?.dataset.missionCard
  if (key) rovingKey.value = key
}

function focusCard(key: string | null): void {
  const el = cardEl(key) ?? cardEls()[0]
  if (!el) return
  rovingKey.value = el.dataset.missionCard ?? null
  el.focus({ preventScroll: true })
  el.scrollIntoView({ block: 'nearest' })
}

const announcement = ref('')
function announce(text: string): void {
  announcement.value = ''
  void nextTick(() => {
    announcement.value = text
  })
}

let self = false
function own(change: () => void): void {
  self = true
  try {
    change()
  } finally {
    void nextTick(() => {
      self = false
    })
  }
}

const lastRects = new Map<string, DOMRect>()
let rectGen = 0
function snapshot(): void {
  lastRects.clear()
  for (const el of root.value?.querySelectorAll<HTMLElement>('[data-mission-tile]') ?? []) lastRects.set(el.dataset.missionTile!, el.getBoundingClientRect())
  const gen = ++rectGen
  void nextTick(() =>
    setTimeout(() => {
      if (gen === rectGen) lastRects.clear()
    }, 0),
  )
}

function lift(el: HTMLElement, on: boolean): void {
  const card = el.closest<HTMLElement>('[data-mission-card]')
  if (card) Object.assign(card.style, { overflow: on ? 'visible' : '', zIndex: on ? '20' : '' })
  el.style.zIndex = on ? '1' : ''
}

function glide(el: HTMLElement, from: DOMRect, ms: number): Promise<void> {
  const frames = flipFrames(from, viewportBox(el))
  if (!frames) return Promise.resolve()
  lift(el, true)
  const timing = { duration: ms, easing: ease('out-quint') }
  const inner = el.querySelector<HTMLElement>('[data-mission-tile-inner]')
  if (frames.inner && inner) inner.animate(frames.inner, timing)
  return el
    .animate(frames.outer, timing)
    .finished.catch(() => undefined)
    .then(() => lift(el, false))
}

const tileMotion = {
  enter(el: Element, done: () => void): void {
    const node = el as HTMLElement
    const from = lastRects.get(node.dataset.missionTile ?? '')
    const ms = dur(from ? 'slow' : 'base')
    if (!ms) return done()
    if (from) {
      void glide(node, from, ms).then(done)
      return
    }
    node
      .animate([{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }], { duration: ms, easing: ease('out-quint') })
      .finished.catch(() => undefined)
      .then(done)
  },
  leave(el: Element, done: () => void): void {
    const node = el as HTMLElement
    if (alive(node.dataset.missionTile)) return done()
    onDustLeave(node, done)
  },
}

function onCardEnter(el: Element): void {
  const node = el as HTMLElement
  const ms = dur('slow')
  if (!ms) return
  let glided = false
  for (const tile of node.querySelectorAll<HTMLElement>('[data-mission-tile]')) {
    const from = lastRects.get(tile.dataset.missionTile ?? '')
    if (!from) continue
    glided = true
    void glide(tile, from, ms)
  }
  if (glided) node.classList.remove('mc-card-enter-from')
}

function fadeOut(node: HTMLElement, done: () => void): void {
  stopFlip(node)
  const ms = dur('fast')
  if (!ms) return done()
  node
    .animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(0.98)' }], { duration: ms, easing: ease('exit'), fill: 'forwards' })
    .finished.catch(() => undefined)
    .then(done)
}

function onCardLeave(el: Element, done: () => void): void {
  const node = el as HTMLElement
  if (node.dataset.missionSlot !== undefined) return done()
  if (!alive(node.dataset.panes)) return onDustLeave(node, done)
  fadeOut(node, done)
}

function onSectionLeave(el: Element, done: () => void): void {
  const node = el as HTMLElement
  if (!alive(node.dataset.panes)) return onDustLeave(node, done)
  fadeOut(node, done)
}

function intro(current: HTMLElement | null): void {
  const ms = dur('base')
  if (!ms) return
  const step = stagger()
  let i = 0
  for (const el of root.value?.querySelectorAll<HTMLElement>('[data-mission-section-head], [data-mission-card], [data-mission-empty]') ?? []) {
    if (el === current || el.closest('[data-mission-tile]')) continue
    el.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], {
      duration: ms,
      delay: Math.min(i++, 12) * step,
      easing: ease('out-quint'),
      fill: 'backwards',
    })
  }
  const tab = current ? tabOf(current.dataset.missionCard ?? '') : undefined
  const body = current?.querySelector<HTMLElement>('[data-mission-body]')
  const to = tab ? unionRect(leaves(tab.root).map((k) => props.paneRect(k))) : null
  if (!current || !body || !to) return
  current.style.zIndex = '20'
  current
    .animate([{ transform: flipOnto(current.getBoundingClientRect(), body.getBoundingClientRect(), to) }, { transform: 'none' }], {
      duration: dur('slow'),
      easing: ease('out-quint'),
    })
    .finished.catch(() => undefined)
    .then(() => {
      current.style.zIndex = ''
    })
}

type ViewBox = ReturnType<typeof viewportBox>
const MOVERS = '[data-mission-section], [data-mission-section-head], [data-mission-card]'
const LEAVING_SECTION = '.mc-section-leave-active'
const LEAVING_CARD = '.mc-card-leave-active'

const geometry = computed(() => {
  if (!props.open) return ''
  const l = layout.value
  return `${l.cardW}x${l.bodyH}|${visibleSections.value.map((s, i) => `${s.key}:${l.cols[i] ?? 1}:${s.cards.map((c) => c.tabKey).join(',')}`).join(';')}`
})
let first: Map<HTMLElement, ViewBox> | null = null
let refocus: HTMLElement | null = null

function settle(el: HTMLElement, from: ViewBox | undefined): void {
  if (!from) return
  const now = viewportBox(el)
  const dx = from.left - now.left
  const dy = from.top - now.top
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return
  el.style.left = `${(parseFloat(el.style.left) || 0) + dx}px`
  el.style.top = `${(parseFloat(el.style.top) || 0) + dy}px`
}

watch(
  geometry,
  (now, before) => {
    first = null
    const at = document.activeElement
    refocus = at instanceof HTMLElement && !!root.value?.contains(at) ? at : null
    if (resized || !now || !before || !root.value || !dur('slow')) return
    first = new Map([...root.value.querySelectorAll<HTMLElement>(MOVERS)].map((el) => [el, viewportBox(el)]))
  },
  { flush: 'pre' },
)
watch(
  geometry,
  () => {
    const from = first
    const back = refocus
    first = null
    refocus = null
    const leaving = (el: HTMLElement): boolean => !!el.closest(`${LEAVING_SECTION}, ${LEAVING_CARD}`)
    if (back?.isConnected && props.open && document.activeElement !== back && !leaving(back)) back.focus({ preventScroll: true })
    if (!from || !root.value) return
    const all = [...root.value.querySelectorAll<HTMLElement>(MOVERS)]
    for (const el of all) if (el.matches(LEAVING_SECTION) || (el.matches(LEAVING_CARD) && !el.closest(LEAVING_SECTION))) settle(el, from.get(el))
    const gliding = (el: HTMLElement): boolean => (el.dataset.panes ?? '').split(' ').some((k) => lastRects.has(k))
    void flipAll(
      all
        .filter((el) => !leaving(el) && !el.matches('[data-mission-section]') && !el.classList.contains('mc-card-enter-active') && !gliding(el))
        .map((el) => ({ el, from: from.get(el), scale: el.dataset.missionCard !== undefined })),
      { ms: dur('slow'), easing: ease('out-quint') },
    )
  },
  { flush: 'post' },
)

let choosing = false

async function enter(tabKey: string, paneKey?: string): Promise<void> {
  const tab = tabOf(tabKey)
  if (choosing || !tab || !props.open) return
  choosing = true
  drag.cancel()
  menu.value = null
  const node = cardEl(tabKey)
  workspace.activate(paneKey && leaves(tab.root).includes(paneKey) ? paneKey : tab.focus)
  await nextTick()
  const ms = dur('slow')
  const body = node?.querySelector<HTMLElement>('[data-mission-body]')
  const to = unionRect(leaves(tab.root).map((k) => props.paneRect(k)))
  if (ms && node && body && to) {
    stopFlip(node)
    for (const el of root.value?.querySelectorAll<HTMLElement>('[data-mission-card], [data-mission-section-head], [data-mission-empty]') ?? [])
      if (el !== node && !el.closest('[data-mission-tile]')) el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: dur('fast'), easing: ease('exit'), fill: 'forwards' })
    node.style.zIndex = '20'
    await node
      .animate([{ transform: 'none' }, { transform: flipOnto(node.getBoundingClientRect(), body.getBoundingClientRect(), to) }], {
        duration: ms,
        easing: ease('out-quint'),
        fill: 'forwards',
      })
      .finished.catch(() => undefined)
  }
  emit('close', false)
}

function apply(drop: MissionDrop): void {
  snapshot()
  if (drop.kind === 'move') {
    const from = workspace.tabOf(drop.paneKey)?.key ?? null
    const pane = titleOfPane(drop.paneKey)
    const tab = cardByKey(drop.tabKey)?.title ?? ''
    own(() => workspace.movePaneToTab(drop.paneKey, drop.tabKey))
    announce(t('workspace.paneDrop.moved', { pane, tab }))
    void nextTick(() => focusCard(from && tabOf(from) ? from : drop.tabKey))
    return
  }
  if (drop.kind === 'detach') {
    const pane = titleOfPane(drop.paneKey)
    own(() => workspace.detachPane(drop.paneKey))
    announce(t('workspace.paneDrop.detached', { pane }))
    void nextTick(() => focusCard(workspace.tabOf(drop.paneKey)?.key ?? null))
    return
  }
  const target = tabOf(drop.into)
  if (!target) return
  const tab = cardByKey(drop.tabKey)?.title ?? ''
  const into = cardByKey(drop.into)?.title ?? ''
  own(() => workspace.mergeTab(drop.tabKey, target.focus, 'right'))
  announce(t('workspace.paneDrop.merged', { tab, target: into }))
  void nextTick(() => focusCard(drop.into))
}

let closeFocus: string | null = null
async function closePanes(keys: string[], tabKey: string): Promise<void> {
  // v62: with auto save on, dirty file panes save first; only the ones that fail still ask.
  if (settings.autoSave !== 'off') await workspace.saveFiles(keys)
  const tab = tabOf(tabKey)
  const whole = !!tab && leaves(tab.root).every((k) => keys.includes(k))
  const list = cardEls()
  const at = list.findIndex((el) => el.dataset.missionCard === tabKey)
  closeFocus = whole ? ((list[at + 1] ?? list[at - 1])?.dataset.missionCard ?? null) : tabKey
  own(() => workspace.requestClose(keys, (p) => info.isBusy(p) || !!p.dirty))
  if (!workspace.pendingClose) void nextTick(() => focusCard(closeFocus))
}

watch(
  () => !!workspace.pendingClose,
  async (pending, was) => {
    if (pending || !was || !props.open) return
    await nextTick()
    await nextTick()
    if (props.open && !focusHolds()) focusCard(cardEl(closeFocus) ? closeFocus : roving.value)
  },
)

function focusHolds(): boolean {
  const at = document.activeElement as HTMLElement | null
  if (!at || !root.value?.contains(at)) return false
  const tileKey = at.closest<HTMLElement>('[data-mission-tile]')?.dataset.missionTile
  const cardKey = at.closest<HTMLElement>('[data-mission-card]')?.dataset.missionCard
  return !(tileKey && !paneOf(tileKey)) && !(cardKey && !cardEl(cardKey))
}

const renaming = ref<{ tabKey: string; before: string | undefined; initial: string } | null>(null)

function startRename(tabKey: string): void {
  const tab = tabOf(tabKey)
  if (!tab || choosing) return
  rovingKey.value = tabKey
  renaming.value = { tabKey, before: tab.name, initial: info.tabTitle(tab) }
}

function onRenamed(tabKey: string, saved: boolean): void {
  const r = renaming.value
  if (!r || r.tabKey !== tabKey) return
  renaming.value = null
  const tab = tabOf(tabKey)
  if (saved && tab) {
    if (tab.name !== r.before) {
      highlights.value = { ...highlights.value, [tabKey]: ++seq }
      announce(t(tab.name ? 'workspace.tabName.renamed' : 'workspace.tabName.reset', { name: info.tabTitle(tab) }))
    }
  }
  void nextTick(() => {
    const at = document.activeElement
    if (props.open && (!at || at === document.body)) focusCard(tabKey)
  })
}

const menu = shallowRef<{ at: Rect; trigger: HTMLElement | null; label: string; entries: MenuEntry[]; pick: (id: string) => void } | null>(null)
let keyMenuAt = 0
const echo = (): boolean => !!menu.value && performance.now() - keyMenuAt < KEY_MENU_ECHO_MS

function openMenu(tabKey: string, paneKey: string | undefined, at: Rect, trigger: HTMLElement | null): void {
  const section = sectionOf(tabKey)
  const card = cardByKey(tabKey)
  if (!section || !card || choosing) return
  const targets = section.cards.filter((c) => c.tabKey !== tabKey).map((c) => ({ key: c.tabKey, title: c.title }))
  rovingKey.value = tabKey
  const tile = paneKey ? card.tiles.find((x) => x.paneKey === paneKey) : undefined
  if (tile)
    menu.value = {
      at,
      trigger,
      label: t('workspace.tabActions.label', { name: tile.title }),
      entries: tileMenu({ mac: isMac, alone: card.tiles.length < 2, targets, compact: compactFlow.stateOf(paneOf(tile.paneKey)) }, t),
      pick: (id) => pickTile(id, tabKey, tile.paneKey),
    }
  else
    menu.value = {
      at,
      trigger,
      label: t('workspace.tabActions.label', { name: card.title }),
      entries: cardMenu({ mac: isMac, panes: card.tiles.length, targets }, t),
      pick: (id) => pickCard(id, tabKey),
    }
}

function onMenu(card: Card, e: MouseEvent, paneKey?: string): void {
  if (echo()) return
  openMenu(card.tabKey, paneKey, new DOMRect(e.clientX, e.clientY, 0, 0), paneKey ? tileEl(paneKey) : cardEl(card.tabKey))
}

function pickCard(id: string, tabKey: string): void {
  const { action, target } = menuPick(id)
  const card = cardByKey(tabKey)
  const tab = tabOf(tabKey)
  if (!card || !tab) return
  switch (action) {
    case 'open':
      void enter(tabKey)
      break
    case 'rename':
      startRename(tabKey)
      break
    case 'ungroup': {
      const n = card.tiles.length
      snapshot()
      own(() => workspace.ungroup(tabKey))
      announce(t('workspace.paneDrop.ungrouped', { tab: card.title, n }))
      void nextTick(() => focusCard(tabKey))
      break
    }
    case 'merge':
      if (target) apply({ kind: 'merge', tabKey, into: target })
      break
    case 'close':
      void closePanes(leaves(tab.root), tabKey)
      break
  }
}

const compactFlow = useCompact()

function pickTile(id: string, tabKey: string, paneKey: string): void {
  const { action, target } = menuPick(id)
  switch (action) {
    case 'focus':
      void enter(tabKey, paneKey)
      break
    case 'move':
      if (target) apply({ kind: 'move', paneKey, tabKey: target })
      break
    case 'detach':
      apply({ kind: 'detach', paneKey })
      break
    case 'compact':
      compactFlow.start(paneKey)
      break
    case 'compact-cancel':
      compactFlow.cancel(paneKey)
      break
    case 'close-pane':
      void closePanes([paneKey], tabKey)
      break
  }
}

const drag = useMissionDrag({
  sourceAt(el) {
    const node = el.closest<HTMLElement>('[data-mission-card]')
    const key = node?.dataset.missionCard
    const section = key ? sectionOf(key) : undefined
    const card = section?.cards.find((c) => c.tabKey === key)
    if (!node || !section || !card || choosing || renaming.value?.tabKey === key) return null
    const others = section.cards.length > 1
    const tile = el.closest<HTMLElement>('[data-mission-tile]')
    if (tile) {
      const alone = card.tiles.length < 2
      return others || !alone ? { source: { kind: 'tile', paneKey: tile.dataset.missionTile!, tabKey: card.tabKey, section: section.key, alone }, handle: tile } : null
    }
    const head = el.closest<HTMLElement>('[data-mission-card-head]')
    return head && others ? { source: { kind: 'card', tabKey: card.tabKey, section: section.key }, handle: head } : null
  },
  targetAt(x, y) {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-mission-card], [data-mission-slot]')
    if (!el || !root.value?.contains(el)) return null
    if (el.dataset.missionSlot !== undefined) return { kind: 'slot', section: el.dataset.missionSlot }
    return { kind: 'card', tabKey: el.dataset.missionCard ?? '', section: el.dataset.section ?? '' }
  },
  onDrop: (_source, drop) => apply(drop),
})

const dragged = computed(() => drag.state.value)
const slotSection = computed(() => {
  const src = dragged.value?.source
  return src?.kind === 'tile' && !src.alone ? src.section : null
})
const slotHot = computed(() => dragged.value?.drop?.kind === 'detach')
const dropKey = computed(() => (dragged.value?.drop && dragged.value.target?.kind === 'card' ? dragged.value.target.tabKey : null))
function draggingIn(card: Card): string | null {
  const src = dragged.value?.source
  if (!src || src.tabKey !== card.tabKey) return null
  return src.kind === 'card' ? 'card' : src.paneKey
}

const ghost = computed(() => {
  const d = dragged.value
  if (!d) return null
  const src = d.source
  const card = cardByKey(src.tabKey)
  const paneKey = src.kind === 'tile' ? src.paneKey : (card?.focus ?? '')
  const label = src.kind === 'tile' ? titleOfPane(src.paneKey) : (card?.title ?? '')
  const word = d.blocked
    ? t('workspace.paneDrop.otherProject')
    : d.drop?.kind === 'detach'
      ? t('workspace.paneDrop.detach')
      : d.drop
        ? t('workspace.paneDrop.merge', { name: cardByKey(d.drop.kind === 'move' ? d.drop.tabKey : d.drop.into)?.title ?? '' })
        : ''
  const right = d.x > window.innerWidth / 2
  const style = { top: `${d.y + 14}px`, ...(right ? { right: `${window.innerWidth - d.x + 14}px` } : { left: `${d.x + 14}px` }) }
  return { pane: paneOf(paneKey), label, word, blocked: d.blocked, style }
})

const DIRS: Record<string, NavDir | 'home' | 'end'> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', Home: 'home', End: 'end' }

function trap(e: KeyboardEvent): void {
  const items = [...(root.value?.querySelectorAll<HTMLElement>('button:not([disabled]):not([tabindex="-1"]), input:not([tabindex="-1"]), [tabindex="0"]') ?? [])].filter(
    (el) => el.getClientRects().length > 0 && !el.closest('.mc-card-leave-active, .mc-section-leave-active'),
  )
  if (!items.length) return
  e.preventDefault()
  const at = items.indexOf(document.activeElement as HTMLElement)
  items[(at + (e.shiftKey ? -1 : 1) + items.length) % items.length]?.focus()
}

const typing = (el: EventTarget | null): boolean => el instanceof HTMLElement && !!el.closest('input, textarea, select, [contenteditable]')

function typeIntoFilter(text: string): void {
  query.value += text
  const field = filterEl.value
  if (!field) return
  field.focus({ preventScroll: true })
  void nextTick(() => field.setSelectionRange(field.value.length, field.value.length))
}

function clearFilter(focus: boolean): void {
  query.value = ''
  if (focus) filterEl.value?.focus({ preventScroll: true })
}

function pickIndex(n: number): boolean {
  const card = visibleCards.value[n - 1]
  if (!card) return false
  void enter(card.tabKey)
  return true
}

function onFilterKey(e: KeyboardEvent): void {
  if (e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    e.stopPropagation()
    focusCard(visibleCards.value[0]?.tabKey ?? null)
    return
  }
  if (e.key === 'Enter' && query.value.trim()) {
    e.preventDefault()
    e.stopPropagation()
    pickIndex(1)
  }
}

let announceTimer: ReturnType<typeof setTimeout> | undefined
watch(query, (q) => {
  clearTimeout(announceTimer)
  if (!props.open || !q.trim()) return
  announceTimer = setTimeout(() => {
    const n = visibleCards.value.length
    announce(t('workspace.missionV2.matches', { n }, n))
  }, ANNOUNCE_MS)
})
onBeforeUnmount(() => clearTimeout(announceTimer))

function keyAnchor(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect()
  const x = r.left + Math.min(24, r.width / 2)
  const y = r.top + Math.min(28, r.height / 2)
  return { left: x, right: x, top: y, bottom: y }
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    if (query.value) return clearFilter(typing(e.target))
    emit('close', true)
    return
  }
  if (e.key === 'Tab') return trap(e)
  if (!e.isComposing && !e.altKey && !e.ctrlKey && !e.metaKey && !typing(e.target) && !choosing && !menu.value && !drag.state.value) {
    if (/^[1-9]$/.test(e.key)) {
      e.preventDefault()
      e.stopPropagation()
      pickIndex(Number(e.key))
      return
    }
    if (e.key.length === 1 && e.key !== ' ') {
      e.preventDefault()
      e.stopPropagation()
      typeIntoFilter(e.key)
      return
    }
  }
  const el = document.activeElement as HTMLElement | null
  const card = el?.closest<HTMLElement>('[data-mission-card]')
  if (!el || !card || !root.value?.contains(card) || choosing) return
  const tabKey = card.dataset.missionCard!
  const tile = el.closest<HTMLElement>('[data-mission-tile]')
  if (isMenuKey(e)) {
    e.preventDefault()
    e.stopPropagation()
    keyMenuAt = performance.now()
    const anchor = tile ?? card
    openMenu(tabKey, tile?.dataset.missionTile, keyAnchor(anchor), anchor)
    return
  }
  if (e.altKey || e.ctrlKey || e.metaKey) return
  if (e.key === 'F2' && !e.shiftKey) {
    e.preventDefault()
    startRename(tabKey)
    return
  }
  if (el === card && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault()
    void enter(tabKey)
    return
  }
  const dir = DIRS[e.key]
  if (!dir) return
  e.preventDefault()
  if (tile && dir !== 'home' && dir !== 'end') {
    const tiles = navRects(card.querySelectorAll<HTMLElement>('[data-mission-tile]'), (n) => n.dataset.missionTile!)
    const next = spatialStep(tiles, tile.dataset.missionTile!, dir)
    if (next) return tileEl(next)?.focus()
  }
  const list = navRects(cardEls(), (n) => n.dataset.missionCard!)
  const next = dir === 'home' ? list[0]?.key : dir === 'end' ? list.at(-1)?.key : spatialStep(list, tabKey, dir, true)
  if (next) focusCard(next)
}

async function onOpen(): Promise<void> {
  choosing = false
  self = false
  menu.value = null
  renaming.value = null
  closeFocus = null
  const active = workspace.activeTab?.key ?? null
  lead.value = rail.clusters.value.find((c) => !!active && c.tabKeys.includes(active))?.key ?? null
  rovingKey.value = active
  query.value = ''
  flashes.value = {}
  highlights.value = {}
  snaps.value = Object.fromEntries(workspace.panes.map((p) => [p.key, snapOf(p.key)]))
  seen = new Map(tileStates.value)
  await nextTick()
  measure()
  await nextTick()
  const current = cardEl(roving.value)
  current?.scrollIntoView({ block: 'nearest' })
  if (current) current.focus({ preventScroll: true })
  else filterEl.value?.focus({ preventScroll: true })
  intro(current)
}

watch(
  () => props.open,
  (open) => {
    if (open) return void onOpen()
    drag.cancel()
    menu.value = null
    renaming.value = null
    query.value = ''
  },
  { immediate: true },
)

watch(
  () => workspace.activeTab?.key ?? null,
  (now, before) => {
    if (!props.open || choosing || self || now === before) return
    if (before && tabOf(before)) emit('close', false)
  },
)
watch(
  () => workspace.tabs.length,
  (n) => {
    if (props.open && !n) emit('close', false)
  },
)
</script>

<template>
  <div
    v-if="open"
    ref="root"
    class="absolute inset-0 z-30 grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-card bg-canvas"
    role="dialog"
    aria-modal="true"
    :aria-label="t('workspace.rail.mission.title')"
    data-mission
    @keydown="onKey"
    @focusin="onFocusIn"
    @pointerdown="drag.onDown"
  >
    <div class="flex h-10 min-w-0 items-center gap-3 pr-1.5 pl-4">
      <h2 class="shrink-0 text-xs font-semibold text-ink">{{ t('workspace.rail.mission.title') }}</h2>
      <p class="min-w-0 flex-1 truncate text-2xs text-ink-faint" :title="t('workspace.missionV2.hint')">{{ t('workspace.missionV2.hint') }}</p>
      <div class="relative w-56 min-w-28 shrink" role="search">
        <Search :size="13" class="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
        <input
          ref="filterEl"
          v-model="query"
          type="search"
          class="ccm-field w-full pr-7! pl-7! [&::-webkit-search-cancel-button]:hidden"
          :placeholder="t('workspace.missionV2.filter')"
          :aria-label="t('workspace.missionV2.filterLabel')"
          autocomplete="off"
          spellcheck="false"
          data-mission-filter
          @keydown="onFilterKey"
        />
        <Transition name="ccm-fade">
          <button
            v-if="query"
            type="button"
            class="absolute top-1/2 right-0.5 inline-flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-inner text-ink-faint hover:bg-fill-strong hover:text-ink"
            :title="t('workspace.missionV2.clear')"
            :aria-label="t('workspace.missionV2.clear')"
            data-mission-filter-clear
            @click="clearFilter(true)"
          >
            <X :size="13" aria-hidden="true" />
          </button>
        </Transition>
      </div>
      <button
        type="button"
        class="ccm-btn-plain shrink-0"
        :title="t('workspace.missionGrid.closeKeys')"
        :aria-label="t('workspace.missionGrid.close')"
        data-mission-close
        @click="emit('close', true)"
      >
        <X :size="15" aria-hidden="true" />
      </button>
    </div>
    <div ref="scroller" class="ccm-scroll flex min-h-0 flex-col overflow-x-hidden overflow-y-auto px-4 pt-1 pb-4">
      <TransitionGroup
        tag="div"
        name="mc-section"
        class="relative mx-auto my-auto flex max-w-full min-w-0 shrink-0 flex-col gap-6"
        :style="{ width: `${layout.contentW}px` }"
        @before-leave="pinLeaving"
        @leave="onSectionLeave"
      >
        <section
          v-for="(s, si) in visibleSections"
          :key="s.key"
          class="flex min-w-0 flex-col gap-2.5"
          :aria-labelledby="sectionId(s)"
          :data-mission-section="s.key"
          :data-panes="sectionPanes(s)"
        >
          <h3 :id="sectionId(s)" class="flex h-6 min-w-0 items-center gap-1.5 text-xs font-semibold text-ink" data-mission-section-head>
            <component :is="s.current ? FolderOpen : Folder" :size="14" class="shrink-0 text-ink-muted" aria-hidden="true" />
            <span class="min-w-0 truncate" :title="s.root ?? undefined">{{ sectionName(s) }}</span>
            <span class="shrink-0 font-normal text-ink-faint tabular">{{ t('workspace.missionGrid.tabs', { n: s.cards.length }, s.cards.length) }}</span>
            <span
              v-if="s.needs"
              class="inline-flex h-5 shrink-0 items-center gap-1 rounded-inner px-1.5 text-2xs font-medium tabular"
              :class="s.failed ? 'bg-st-error-soft text-st-error' : 'bg-st-waiting-soft text-st-waiting'"
              data-mission-needs
            >
              <BellRing :size="11" aria-hidden="true" />{{ t('workspace.rail.needs', { n: s.needs }, s.needs) }}
            </span>
          </h3>
          <TransitionGroup
            tag="div"
            name="mc-card"
            class="relative grid gap-3"
            :style="gridStyle(si)"
            @before-leave="pinLeaving"
            @enter="onCardEnter"
            @leave="onCardLeave"
          >
            <MissionCard
              v-for="c in s.cards"
              :key="c.tabKey"
              :card="c"
              :section="s.key"
              :roving="c.tabKey === roving"
              :draggable="s.cards.length > 1"
              :renaming="renaming?.tabKey === c.tabKey ? { initial: renaming.initial } : null"
              :highlight="highlights[c.tabKey] ?? 0"
              :snaps="snaps"
              :flashes="flashes"
              :drop="dropKey === c.tabKey"
              :dragging="draggingIn(c)"
              :index="cardIndex.get(c.tabKey) ?? null"
              :body-h="layout.bodyH"
              :row-cap="SNAP_ROWS"
              :motion="tileMotion"
              @open="enter(c.tabKey)"
              @open-tile="(k: string) => enter(c.tabKey, k)"
              @close="pickCard('close', c.tabKey)"
              @rename="startRename(c.tabKey)"
              @renamed="(saved: boolean) => onRenamed(c.tabKey, saved)"
              @menu="(e: MouseEvent, k?: string) => onMenu(c, e, k)"
            />
            <div
              v-if="slotSection === s.key"
              key="mc-slot"
              class="flex flex-col items-center justify-center gap-1.5 rounded-card border-2 border-dashed px-4 text-center text-xs transition-colors duration-(--ccm-dur-fast)"
              :class="slotHot ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line-strong text-ink-muted'"
              :style="{ height: `${cardH}px` }"
              :data-mission-slot="s.key"
              :data-drop="slotHot ? 'valid' : undefined"
            >
              <Plus :size="16" aria-hidden="true" />
              <span class="font-medium">{{ t('workspace.missionGrid.newTab') }}</span>
              <span class="text-2xs" :class="slotHot ? 'text-accent-ink' : 'text-ink-faint'">{{ t('workspace.missionGrid.newTabHint') }}</span>
            </div>
          </TransitionGroup>
        </section>
      </TransitionGroup>
      <Transition name="mc-empty" @before-leave="pinLeaving">
        <div
          v-if="!visibleSections.length"
          class="my-auto flex shrink-0 flex-col items-center gap-2 px-6 py-8 text-center"
          role="status"
          :data-mission-empty="query.trim() ? 'filter' : 'none'"
        >
          <ArtImage :name="query.trim() ? 'empty-project-search' : 'empty-sessions'" class="w-32 max-w-full" />
          <p class="max-w-[48ch] text-sm font-medium break-words text-ink">
            {{ query.trim() ? t('workspace.missionV2.noMatch', { query: query.trim() }) : t('workspace.missionV2.noTabs') }}
          </p>
          <p class="max-w-[48ch] text-xs text-ink-muted">{{ query.trim() ? t('workspace.missionV2.noMatchHint') : t('workspace.missionV2.noTabsHint') }}</p>
        </div>
      </Transition>
    </div>
    <p class="sr-only" aria-live="polite" data-mission-live>{{ announcement }}</p>
    <ContextMenu v-if="menu" :at="menu.at" :entries="menu.entries" :label="menu.label" :trigger="menu.trigger" @pick="menu.pick" @close="menu = null" />
    <Teleport to="body">
      <div
        v-if="ghost"
        class="pointer-events-none fixed z-50 inline-flex h-7 max-w-[44ch] items-center gap-1.5 rounded-inner bg-control px-2 text-xs text-ink shadow-control"
        :style="ghost.style"
        aria-hidden="true"
        data-mission-ghost
        :data-blocked="ghost.blocked ? '' : undefined"
      >
        <PaneIcon v-if="ghost.pane" :pane="ghost.pane" :size="13" class="shrink-0" />
        <span class="min-w-0 truncate font-medium">{{ ghost.label }}</span>
        <span v-if="ghost.word" class="inline-flex shrink-0 items-center gap-1" :class="ghost.blocked ? 'text-ink-muted' : 'text-accent-ink'">
          <Ban v-if="ghost.blocked" :size="12" aria-hidden="true" />{{ ghost.word }}
        </span>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.mc-card-enter-active,
.mc-section-enter-active {
  transform-origin: center;
  transition:
    opacity var(--ccm-dur-base) var(--ease-out-quint),
    transform var(--ccm-dur-base) var(--ease-out-quint);
}
.mc-card-enter-from,
.mc-section-enter-from {
  opacity: 0;
  transform: scale(0.98);
}
.mc-card-leave-active,
.mc-section-leave-active {
  position: absolute;
  pointer-events: none;
  transform-origin: center;
}
.mc-empty-enter-active {
  transition: opacity var(--ccm-dur-base) var(--ease-out-quint);
}
.mc-empty-leave-active {
  position: absolute;
  pointer-events: none;
  transition: opacity var(--ccm-dur-fast) var(--ease-exit);
}
.mc-empty-enter-from,
.mc-empty-leave-to {
  opacity: 0;
}
</style>
