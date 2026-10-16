import { onBeforeUnmount, shallowRef } from 'vue'
import { missionDrop, type MissionDragSource, type MissionDrop, type MissionDropTarget } from '../../../lib/rail/mission'

export interface MissionDragState {
  source: MissionDragSource
  target: MissionDropTarget | null
  drop: MissionDrop | null
  blocked: boolean
  x: number
  y: number
}

interface Options {
  sourceAt(target: HTMLElement): { source: MissionDragSource; handle: HTMLElement } | null
  targetAt(x: number, y: number): MissionDropTarget | null
  onDrop(source: MissionDragSource, drop: MissionDrop): void
}

const THRESHOLD = 5
const NO_DRAG = 'a, input, select, textarea, [contenteditable], [data-no-drag]'

function capture(el: HTMLElement, id: number, on: boolean): boolean {
  try {
    if (on) el.setPointerCapture(id)
    else el.releasePointerCapture(id)
    return true
  } catch {
    return false
  }
}

export function useMissionDrag(opts: Options) {
  const state = shallowRef<MissionDragState | null>(null)
  let start: { x: number; y: number; id: number; source: MissionDragSource; handle: HTMLElement } | null = null

  function onDown(e: PointerEvent): void {
    if (e.button !== 0 || start) return
    const target = e.target as HTMLElement
    if (target.closest(NO_DRAG)) return
    const hit = opts.sourceAt(target)
    if (!hit) return
    start = { x: e.clientX, y: e.clientY, id: e.pointerId, ...hit }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey, true)
  }

  function onMove(e: PointerEvent): void {
    if (!start || e.pointerId !== start.id) return
    if (!state.value) {
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < THRESHOLD) return
      window.getSelection()?.removeAllRanges()
      capture(start.handle, start.id, true)
    }
    const target = opts.targetAt(e.clientX, e.clientY)
    const { drop, blocked } = missionDrop(start.source, target)
    state.value = { source: start.source, target, drop, blocked, x: e.clientX, y: e.clientY }
    const cursor = blocked ? 'not-allowed' : 'grabbing'
    start.handle.style.cursor = cursor
    document.body.style.cursor = cursor
  }

  function finish(commit: boolean): void {
    const dragged = state.value
    if (start) {
      capture(start.handle, start.id, false)
      start.handle.style.cursor = ''
    }
    document.body.style.cursor = ''
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
    window.removeEventListener('keydown', onKey, true)
    start = null
    state.value = null
    if (!dragged) return
    const swallow = (ev: Event): void => ev.stopPropagation()
    window.addEventListener('click', swallow, { capture: true, once: true })
    setTimeout(() => window.removeEventListener('click', swallow, true), 0)
    if (commit && dragged.drop) opts.onDrop(dragged.source, dragged.drop)
  }

  const onUp = (e: PointerEvent): void => {
    if (start && e.pointerId === start.id) finish(true)
  }
  const onCancel = (e: PointerEvent): void => {
    if (start && e.pointerId === start.id) finish(false)
  }
  function onKey(e: KeyboardEvent): void {
    if (!state.value || e.key !== 'Escape') return
    e.preventDefault()
    e.stopPropagation()
    finish(false)
  }

  const cancel = (): void => finish(false)
  onBeforeUnmount(cancel)
  return { state, onDown, cancel }
}
