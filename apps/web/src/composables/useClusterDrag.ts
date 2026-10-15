import { onBeforeUnmount, type Ref } from 'vue'

const THRESHOLD = 5

/** Drag a cluster by its header; `onDrop(from, to)` gets indexes in the rendered order. Esc cancels. */
export function useClusterDrag(list: Ref<HTMLElement | null>, onDrop: (from: number, to: number) => void) {
  let start: { x: number; y: number; from: number; id: number } | null = null
  let dragging = false
  let line: HTMLDivElement | null = null
  let slot = -1
  const heads = (): HTMLElement[] => [...(list.value?.querySelectorAll<HTMLElement>('[data-side-head]') ?? [])]

  function onDown(e: PointerEvent): void {
    const target = e.target as HTMLElement
    const head = target.closest<HTMLElement>('[data-side-head]')
    if (!head || e.button !== 0 || target.closest('[data-no-drag]')) return
    start = { x: e.clientX, y: e.clientY, from: heads().indexOf(head), id: e.pointerId }
  }

  function onMove(e: PointerEvent): void {
    if (!start || e.pointerId !== start.id || !list.value) return
    if (!dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) < THRESHOLD) return
    if (!dragging) {
      dragging = true
      line = document.createElement('div')
      line.className = 'pointer-events-none fixed z-50 h-0.5 rounded-full bg-accent'
      document.body.append(line)
    }
    const sections = heads().map((h) => (h.closest('section') ?? h).getBoundingClientRect())
    if (!sections.length) return
    slot = sections.findIndex((r) => e.clientY < r.top + r.height / 2)
    if (slot < 0) slot = sections.length
    const edge = slot < sections.length ? sections[slot]!.top - 3 : sections.at(-1)!.bottom + 3
    const box = list.value.getBoundingClientRect()
    Object.assign(line!.style, { top: `${edge}px`, left: `${box.left + 8}px`, width: `${box.width - 16}px` })
  }

  function finish(commit: boolean): void {
    if (dragging && commit && start) {
      const to = slot > start.from ? slot - 1 : slot
      if (to !== start.from) onDrop(start.from, to)
      // The pointerup turns into a click on the header (toggle): swallow that one.
      const swallow = (ev: Event): void => ev.stopPropagation()
      window.addEventListener('click', swallow, { capture: true, once: true })
      setTimeout(() => window.removeEventListener('click', swallow, true), 0)
    }
    line?.remove()
    line = null
    start = null
    dragging = false
  }

  const onUp = (): void => finish(true)
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
