import { onBeforeUnmount, ref, shallowRef, type Ref } from 'vue'
import { dropTargetAt, type Edge, type Rect } from '../lib/splitLayout'
import { caretAt, slotMoves, stripSlot, type StripItem } from '../lib/tabStrip'

export type PaneDragSource = { kind: 'pane'; key: string } | { kind: 'tab'; key: string }
export type PaneDropAction = { kind: 'dock'; key: string; edge: Edge } | { kind: 'swap'; key: string } | { kind: 'newTab' } | { kind: 'reorder'; slot: number }

/** Drop preview in canvas pixels; a swap (no `edge`) covers the whole target pane. */
export interface PaneDropPreview {
  left: number
  top: number
  width: number
  height: number
  edge?: Edge
}

interface Options {
  canvas: Ref<HTMLElement | null>
  /** Row holding the tabs: a pane dropped there gets a tab of its own. */
  strip: Ref<HTMLElement | null>
  tabList?: Ref<HTMLElement | null>
  /** Source under a pointerdown target, or null when it must not start a drag. */
  sourceAt(target: HTMLElement): PaneDragSource | null
  canDock?(source: PaneDragSource): boolean
  /** Hold to swap instead of dock (Ctrl, ⌘ on macOS). */
  swapKey(e: { ctrlKey: boolean; metaKey: boolean }): boolean
  onDrop(source: PaneDragSource, action: PaneDropAction): void
}

const THRESHOLD = 5
const TAB_GAP = 4
const STRIP_SLACK = 4
// Text, links and controls in a header keep their own pointer behaviour.
const NO_DRAG = 'button, a, input, select, textarea, [contenteditable], [data-no-drag]'

/** Drag a pane by its header, or a tab by its button, and dock it onto an edge of a pane on the canvas. Esc cancels. */
export function usePaneDrag(opts: Options) {
  const source = shallowRef<PaneDragSource | null>(null)
  const preview = ref<PaneDropPreview | null>(null)
  const toStrip = ref(false)
  const pointer = ref({ x: 0, y: 0 })
  const swapping = ref(false)
  const caret = ref<number | null>(null)

  let start: { x: number; y: number; id: number; src: PaneDragSource; el: HTMLElement } | null = null
  let rects = new Map<string, Rect>()
  let items: StripItem[] = []
  let action: PaneDropAction | null = null
  let last = { x: 0, y: 0 }

  function onDown(e: PointerEvent): void {
    const target = e.target as HTMLElement
    if (e.button !== 0 || start) return
    // A control inside a header is not a handle; the tab button itself is one.
    const control = target.closest(NO_DRAG)
    if (control && !control.matches('[data-tab], [data-pane-grip]')) return
    const src = opts.sourceAt(target)
    if (!src) return
    start = { x: e.clientX, y: e.clientY, id: e.pointerId, src, el: e.currentTarget as HTMLElement }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onKey, true)
  }

  /** Visible panes only: hidden ones (other tabs) have an empty box. */
  function measure(): void {
    rects = new Map()
    for (const el of opts.canvas.value?.querySelectorAll<HTMLElement>('[data-pane]') ?? []) {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) rects.set(el.dataset.pane!, r)
    }
  }

  function measureTabs(): void {
    items = []
    for (const el of opts.tabList?.value?.querySelectorAll<HTMLElement>('[data-tab-item]') ?? []) {
      if (!el.classList.contains('ccm-tab-leave-active') && el.dataset.tabItem) items.push({ key: el.dataset.tabItem, left: el.offsetLeft, width: el.offsetWidth })
    }
  }

  function reorderAt(key: string, x: number): void {
    const list = opts.tabList?.value
    if (!list) return
    const slot = stripSlot(items, x - list.getBoundingClientRect().left + list.scrollLeft)
    if (!slotMoves(items.map((it) => it.key), key, slot)) return
    action = { kind: 'reorder', slot }
    caret.value = caretAt(items, slot, TAB_GAP)
  }

  function begin(): void {
    if (!start) return
    source.value = start.src
    measure()
    if (start.src.kind === 'tab') measureTabs()
    window.getSelection()?.removeAllRanges()
    try {
      // Browser panes (webview) and xterm would otherwise take the pointer as it passes over them.
      start.el.setPointerCapture(start.id)
    } catch {
      // Released already.
    }
  }

  function hitTest(x: number, y: number): void {
    const src = source.value
    const box = opts.canvas.value?.getBoundingClientRect()
    action = null
    preview.value = null
    toStrip.value = false
    caret.value = null
    if (!src || !box) return
    const strip = opts.strip.value?.getBoundingClientRect()
    if (src.kind === 'pane' && strip && x >= strip.left && x <= strip.right && y >= strip.top && y <= strip.bottom) {
      action = { kind: 'newTab' }
      toStrip.value = true
      return
    }
    if (src.kind === 'tab' && strip && x >= strip.left && x <= strip.right && y <= strip.bottom + STRIP_SLACK) {
      reorderAt(src.key, x)
      return
    }
    if (opts.canDock && !opts.canDock(src)) return
    const hit = dropTargetAt(rects, x, y, src.kind === 'pane' ? src.key : null)
    if (!hit) return
    const r = rects.get(hit.key)!
    const swap = src.kind === 'pane' && swapping.value
    action = swap ? { kind: 'swap', key: hit.key } : { kind: 'dock', key: hit.key, edge: hit.edge }
    let left = r.left - box.left
    let top = r.top - box.top
    let width = r.right - r.left
    let height = r.bottom - r.top
    if (!swap) {
      if (hit.edge === 'left' || hit.edge === 'right') width /= 2
      else height /= 2
      if (hit.edge === 'right') left += width
      if (hit.edge === 'bottom') top += height
    }
    preview.value = { left, top, width, height, edge: swap ? undefined : hit.edge }
  }

  function onMove(e: PointerEvent): void {
    if (!start || e.pointerId !== start.id) return
    if (!source.value) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < THRESHOLD) return
      begin()
    }
    swapping.value = opts.swapKey(e)
    last = { x: e.clientX, y: e.clientY }
    pointer.value = last
    hitTest(e.clientX, e.clientY)
  }

  function finish(commit: boolean): void {
    const src = source.value
    const act = action
    if (start) {
      try {
        start.el.releasePointerCapture(start.id)
      } catch {
        // Never captured.
      }
    }
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('keydown', onKey, true)
    window.removeEventListener('keyup', onKey, true)
    start = null
    action = null
    source.value = null
    preview.value = null
    toStrip.value = false
    caret.value = null
    swapping.value = false
    items = []
    if (!src) return
    // The pointerup turns into a click on the tab or header: swallow that one.
    const swallow = (ev: Event): void => ev.stopPropagation()
    window.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', swallow, true), 0)
    if (commit && act) opts.onDrop(src, act)
  }

  const onUp = (e: PointerEvent): void => {
    if (start && e.pointerId === start.id) finish(true)
  }
  const onCancel = (e: PointerEvent): void => {
    if (start && e.pointerId === start.id) finish(false)
  }
  function onKey(e: KeyboardEvent): void {
    if (!source.value) return
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      finish(false)
      return
    }
    const next = opts.swapKey(e)
    if (next === swapping.value) return
    swapping.value = next
    hitTest(last.x, last.y)
  }

  onBeforeUnmount(() => finish(false))
  return { source, preview, toStrip, pointer, swapping, caret, onDown }
}
