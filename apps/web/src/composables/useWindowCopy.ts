import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { isMac } from '../lib/platform'
import { isTyping } from '../lib/shortcuts'
import { comparePos, pointToPos, posToPoint, renderedRows, sliceRows, type DomPoint, type TextPos } from '../lib/windowCopy'

export interface WindowCopyOptions {
  /** Element whose children are the rows (`[data-i]`, text in `.c`) and spacers. */
  container: () => HTMLElement | null
  /** Focus inside it (or on an ancestor of the container) makes Ctrl/⌘+A and copy act on this view. */
  scope: () => HTMLElement | null
  /** Only while rows are windowed; small views keep the browser's own selection. */
  enabled: () => boolean
  rowText: (i: number) => string | null
  allText: () => string
}

/**
 * Selection and copy for a windowed view: Ctrl/⌘+A marks "all selected" (CSS) and copy writes `allText`; a drag
 * selection is kept as model points so rows recycled by scrolling still copy, and is put back after each re-render.
 */
export function useWindowCopy(o: WindowCopyOptions): { allSelected: Ref<boolean>; capture: () => void; restore: () => void } {
  const allSelected = ref(false)
  let model: { anchor: TextPos; focus: TextPos } | null = null
  let synth: { anchor: DomPoint | null; focus: DomPoint | null } = { anchor: null, focus: null }

  const reset = (): void => {
    model = null
    synth = { anchor: null, focus: null }
  }
  const same = (p: DomPoint | null, node: Node | null, offset: number): boolean => !!p && p.node === node && p.offset === offset

  function inScope(): boolean {
    const a = document.activeElement
    const scope = o.scope()
    const c = o.container()
    if (!a || a === document.body || !scope || !c || isTyping(a)) return false
    return scope.contains(a) || a.contains(c)
  }

  /** Reads the DOM selection into model points (before the rows change, and on every selectionchange). */
  function capture(): void {
    const c = o.container()
    const sel = window.getSelection()
    if (!o.enabled() || !c || !sel?.rangeCount) {
      reset()
      return
    }
    const inA = !!sel.anchorNode && c.contains(sel.anchorNode)
    const inF = !!sel.focusNode && c.contains(sel.focusNode)
    if (!inA && !inF) {
      reset()
      return
    }
    const synthA = same(synth.anchor, sel.anchorNode, sel.anchorOffset)
    const synthF = same(synth.focus, sel.focusNode, sel.focusOffset)
    // Both ends scrolled out on the same side: the DOM range is collapsed, the selection is not.
    if (synthA && synthF) return
    if (sel.isCollapsed) {
      reset()
      return
    }
    allSelected.value = false
    const anchor = synthA ? (model?.anchor ?? null) : inA ? pointToPos(c, sel.anchorNode!, sel.anchorOffset) : null
    const focus = synthF ? (model?.focus ?? null) : inF ? pointToPos(c, sel.focusNode!, sel.focusOffset) : null
    model = anchor && focus ? { anchor, focus } : null
    if (!synthA) synth.anchor = null
    if (!synthF) synth.focus = null
  }

  /** After a re-render: the old row nodes are gone, so the selection is rebuilt from the model (clamped to the window). */
  function restore(): void {
    const c = o.container()
    const sel = window.getSelection()
    if (!model || !c || !sel || !o.enabled()) return
    const a = posToPoint(c, model.anchor)
    const f = posToPoint(c, model.focus)
    if (!a || !f) return
    synth = { anchor: a.clamped ? { node: a.node, offset: a.offset } : null, focus: f.clamped ? { node: f.node, offset: f.offset } : null }
    try {
      sel.setBaseAndExtent(a.node, a.offset, f.node, f.offset)
    } catch {
      // node detached between render and restore
    }
  }

  /** The DOM alone cannot produce the text: an end of the selection is outside the rendered rows. */
  function needsModel(): boolean {
    const c = o.container()
    if (!model || !c) return false
    const shown = renderedRows(c)
    if (!shown || synth.anchor || synth.focus) return true
    const [s, e] = comparePos(model.anchor, model.focus) <= 0 ? [model.anchor, model.focus] : [model.focus, model.anchor]
    return s.row < shown[0] || e.row > shown[1]
  }

  function onSelectionChange(): void {
    capture()
  }

  function onKey(e: KeyboardEvent): void {
    if (!o.enabled()) return
    const mod = isMac ? e.metaKey : e.ctrlKey
    if (mod && !e.altKey && !e.shiftKey && e.code === 'KeyA') {
      if (!inScope()) {
        allSelected.value = false
        return
      }
      e.preventDefault()
      e.stopPropagation()
      window.getSelection()?.removeAllRanges()
      reset()
      allSelected.value = true
      return
    }
    // No DOM selection to copy from: run the copy command so the `copy` handler below fills the clipboard.
    if (allSelected.value && mod && !e.altKey && !e.shiftKey && (e.code === 'KeyC' || e.code === 'KeyX') && inScope()) {
      e.preventDefault()
      document.execCommand('copy')
      return
    }
    if (allSelected.value && e.key === 'Escape') allSelected.value = false
  }

  function onCopy(e: ClipboardEvent): void {
    if (!o.enabled() || !e.clipboardData) return
    let text: string | null = null
    if (allSelected.value && inScope()) text = o.allText()
    else if (needsModel()) text = sliceRows(o.rowText, model!.anchor, model!.focus)
    if (text === null) return
    e.clipboardData.setData('text/plain', text)
    e.preventDefault()
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button === 0) allSelected.value = false
  }

  watch(
    () => o.enabled(),
    (on) => {
      if (!on) {
        allSelected.value = false
        reset()
      }
    },
  )

  onMounted(() => {
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('copy', onCopy)
    window.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onPointerDown, true)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('selectionchange', onSelectionChange)
    document.removeEventListener('copy', onCopy)
    window.removeEventListener('keydown', onKey, true)
    document.removeEventListener('pointerdown', onPointerDown, true)
  })

  return { allSelected, capture, restore }
}
