import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

/** Sliding highlight under the active tab, sideways wheel scroll and edge fades of the tab strip. */
export function useTabStripVisuals(tabStrip: Ref<HTMLElement | null>, trigger: () => unknown[]) {
  // One highlight slides between tabs (as in SessionTabs) instead of each tab switching its own background.
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
  watch(trigger, measurePill, { flush: 'post' })

  // A plain mouse wheel only sends deltaY; the strip scrolls sideways. Trackpad sideways swipes keep their native path.
  function onStripWheel(e: WheelEvent): void {
    const el = tabStrip.value
    if (!el || e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY) || el.scrollWidth <= el.clientWidth) return
    const step = e.deltaMode === WheelEvent.DOM_DELTA_LINE ? e.deltaY * 16 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? e.deltaY * el.clientWidth : e.deltaY
    const before = el.scrollLeft
    el.scrollLeft += step
    if (el.scrollLeft !== before) e.preventDefault()
  }

  const stripFade = ref({ start: false, end: false })
  let fadeFrame = 0
  function measureFade(): void {
    cancelAnimationFrame(fadeFrame)
    fadeFrame = requestAnimationFrame(() => {
      const el = tabStrip.value
      const max = el ? el.scrollWidth - el.clientWidth : 0
      const start = !!el && max > 1 && el.scrollLeft > 1
      const end = !!el && max > 1 && el.scrollLeft < max - 1
      if (start !== stripFade.value.start || end !== stripFade.value.end) stripFade.value = { start, end }
    })
  }
  const stripObserver = new ResizeObserver(measureFade)
  watch(
    tabStrip,
    (el) => {
      stripObserver.disconnect()
      if (el) {
        stripObserver.observe(el)
        const list = el.querySelector(':scope > [role="presentation"]')
        if (list) stripObserver.observe(list)
      }
      measureFade()
    },
    { flush: 'post' },
  )

  onBeforeUnmount(() => {
    pillObserver.disconnect()
    stripObserver.disconnect()
    cancelAnimationFrame(fadeFrame)
  })

  return { tabPill, pillReady, stripFade, onStripWheel, measureFade }
}
