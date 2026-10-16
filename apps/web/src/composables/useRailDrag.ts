import { onBeforeUnmount, type Ref } from 'vue'
import { dropTarget, type RailClusterBox, type RailDragSource, type RailDropAim, type RailDropSpot } from '../lib/rail/railDrag'
import { leaves } from '../lib/splitLayout'
import { useWorkspaceStore } from '../stores/workspace'

const THRESHOLD = 5

export type RailDrop = { type: 'merge'; tabKey: string } | { type: 'detach' }

export interface RailDragLabels {
  merge: (tabKey: string) => string
  detach: () => string
  blocked: () => string
}

export function useRailDrag(nav: Ref<HTMLElement | null>, labels: RailDragLabels, onDrop: (src: RailDragSource, drop: RailDrop) => void) {
  const workspace = useWorkspaceStore()
  let start: { x: number; y: number; id: number; el: HTMLElement; src: RailDragSource } | null = null
  let dragging = false
  let ghost: HTMLDivElement | null = null
  let ghostHint: HTMLSpanElement | null = null
  let line: HTMLDivElement | null = null
  let aim: RailDropAim = null
  let lit: HTMLElement[] = []

  function sourceOf(el: HTMLElement): RailDragSource | null {
    const cluster = el.closest<HTMLElement>('[data-group]')?.dataset.group
    const tabKey = el.dataset.dragTab
    if (!cluster || !tabKey) return null
    const tab = workspace.tabs.find((t) => t.key === tabKey)
    if (!tab) return null
    const kind = el.dataset.dragKind === 'tab' ? 'tab' : 'pane'
    const paneKey = kind === 'pane' ? (el.dataset.dragPane ?? null) : null
    return { kind, paneKey, tabKey, cluster, title: el.dataset.dragTitle ?? '', detachable: kind === 'pane' && !!paneKey && leaves(tab.root).length >= 2 }
  }

  function onDown(e: PointerEvent): void {
    const target = e.target as HTMLElement
    if (e.button !== 0 || target.closest('[data-no-drag], input, textarea, [data-side-head]')) return
    const el = target.closest<HTMLElement>('[data-rail-drag]')
    const src = el && sourceOf(el)
    if (!el || !src) return
    start = { x: e.clientX, y: e.clientY, id: e.pointerId, el, src }
  }

  function measure(): { clusters: RailClusterBox[]; spots: RailDropSpot[] } {
    const root = nav.value
    if (!root) return { clusters: [], spots: [] }
    const clusters = [...root.querySelectorAll<HTMLElement>('section[data-group]')].map((s) => {
      const r = s.getBoundingClientRect()
      return { key: s.dataset.group!, top: r.top, bottom: r.bottom }
    })
    const spots = [...root.querySelectorAll<HTMLElement>('[data-rail-drop]')].flatMap((el) => {
      const cluster = el.closest<HTMLElement>('[data-group]')?.dataset.group
      const tabKey = el.dataset.dropTab
      if (!cluster || !tabKey || el.closest('[inert]')) return []
      const r = el.getBoundingClientRect()
      return [{ tabKey, cluster, top: r.top, bottom: r.bottom }]
    })
    return { clusters, spots }
  }

  function begin(): void {
    dragging = true
    start!.el.setAttribute('data-dragging', '')
    nav.value?.setPointerCapture(start!.id)
    ghost = document.createElement('div')
    ghost.className = 'pointer-events-none fixed z-50 flex max-w-64 flex-col rounded-inner bg-raised px-2 py-1 text-xs text-ink shadow-pop'
    ghost.dataset.railDragGhost = ''
    const name = document.createElement('span')
    name.className = 'truncate font-medium'
    name.textContent = start!.src.title
    ghostHint = document.createElement('span')
    ghostHint.className = 'truncate text-2xs text-ink-muted'
    ghost.append(name, ghostHint)
    document.body.append(ghost)
    window.getSelection()?.removeAllRanges()
  }

  function light(tabKey: string | null): void {
    for (const el of lit) el.removeAttribute('data-drop-on')
    lit = tabKey && nav.value ? [...nav.value.querySelectorAll<HTMLElement>(`[data-rail-drop][data-drop-tab="${CSS.escape(tabKey)}"]`)] : []
    for (const el of lit) el.setAttribute('data-drop-on', '')
  }

  function paint(e: PointerEvent): void {
    if (!ghost || !start) return
    Object.assign(ghost.style, { left: `${e.clientX + 12}px`, top: `${e.clientY + 10}px` })
    const blocked = aim?.type === 'blocked'
    ghostHint!.textContent = aim?.type === 'merge' ? labels.merge(aim.tabKey) : aim?.type === 'detach' ? labels.detach() : blocked ? labels.blocked() : ''
    ghostHint!.hidden = !ghostHint!.textContent
    const cursor = blocked ? 'not-allowed' : 'grabbing'
    if (nav.value) nav.value.style.cursor = cursor
    document.body.style.cursor = cursor
    light(aim?.type === 'merge' ? aim.tabKey : null)
    if (aim?.type !== 'detach') {
      line?.remove()
      line = null
      return
    }
    if (!line) {
      line = document.createElement('div')
      line.className = 'pointer-events-none fixed z-50 h-0.5 rounded-full bg-accent'
      line.dataset.railDropLine = ''
      document.body.append(line)
    }
    const section = nav.value?.querySelector<HTMLElement>(`section[data-group="${CSS.escape(start.src.cluster)}"]`)
    const box = (section ?? nav.value)?.getBoundingClientRect()
    if (box) Object.assign(line.style, { top: `${aim.y - 1}px`, left: `${box.left + 20}px`, width: `${Math.max(0, box.width - 28)}px` })
  }

  function onMove(e: PointerEvent): void {
    if (!start || e.pointerId !== start.id) return
    if (!dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) < THRESHOLD) return
    if (!dragging) begin()
    e.preventDefault()
    const box = nav.value?.getBoundingClientRect()
    const inside = !!box && e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom
    const { clusters, spots } = inside ? measure() : { clusters: [], spots: [] }
    aim = dropTarget(start.src, e.clientY, clusters, spots)
    paint(e)
  }

  function finish(commit: boolean): void {
    const src = start?.src
    const drop: RailDrop | null = aim?.type === 'merge' ? { type: 'merge', tabKey: aim.tabKey } : aim?.type === 'detach' ? { type: 'detach' } : null
    if (dragging) {
      const swallow = (ev: Event): void => ev.stopPropagation()
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, true), 0)
      start?.el.removeAttribute('data-dragging')
      if (start && nav.value?.hasPointerCapture(start.id)) nav.value.releasePointerCapture(start.id)
    }
    const wasDragging = dragging
    light(null)
    ghost?.remove()
    line?.remove()
    ghost = ghostHint = line = null
    if (nav.value) nav.value.style.cursor = ''
    document.body.style.cursor = ''
    start = null
    dragging = false
    aim = null
    if (wasDragging && commit && src && drop) onDrop(src, drop)
  }

  const onUp = (e: PointerEvent): void => {
    if (start && e.pointerId === start.id) finish(true)
  }
  const onCancel = (): void => finish(false)
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && dragging) {
      e.preventDefault()
      e.stopPropagation()
      finish(false)
    }
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)
  window.addEventListener('keydown', onKey, true)
  onBeforeUnmount(() => {
    finish(false)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('keydown', onKey, true)
  })
  return { onDown }
}
