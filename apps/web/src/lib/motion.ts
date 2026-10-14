import { nextTick } from 'vue'

export function reducedMotion(): boolean {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return true
  }
}

/** Animation length for camera moves and other JS-driven motion; 0 when the user asked for less motion. */
export function motionMs(ms: number): number {
  return reducedMotion() ? 0 : ms
}

/** `@before-leave` for menus and dialogs: a closing overlay stops being one for assistive tech and queries. */
export function retireOverlay(el: Element): void {
  el.removeAttribute('role')
  el.removeAttribute('aria-modal')
  el.setAttribute('aria-hidden', 'true')
}

/**
 * `@before-leave` for TransitionGroups whose leaving item goes `position: absolute` (ccm-list, ccm-tab): pins it
 * where it stood, since flex and grid parents would otherwise drop it at their start edge.
 */
export function pinLeaving(el: Element): void {
  const item = el as HTMLElement
  Object.assign(item.style, { top: `${item.offsetTop}px`, left: `${item.offsetLeft}px`, width: `${item.offsetWidth}px`, margin: '0' })
}

/** Runs a state change inside a View Transition when the browser supports it. */
export function withViewTransition(change: () => void): void {
  const doc = document as Document & { startViewTransition?: (cb: () => Promise<void>) => unknown }
  if (!doc.startViewTransition || reducedMotion()) {
    change()
    return
  }
  doc.startViewTransition(async () => {
    change()
    await nextTick()
  })
}

const STAGGER_WINDOW_MS = 600
let firstNodeAt = 0
let nodeCount = 0

/** Delay for agent nodes mounted in the first batch after the app opens, so the map fills in sequence. */
export function bootNodeDelay(step = 30, cap = 450): number {
  const at = performance.now()
  if (!firstNodeAt) firstNodeAt = at
  if (at - firstNodeAt > STAGGER_WINDOW_MS) return 0
  return Math.min(nodeCount++ * step, cap)
}

let barShown = false
/** True only for the first session bar mount; later mounts (dock switch) skip the entrance. */
export function takeBarEntrance(): boolean {
  if (barShown) return false
  barShown = true
  return true
}

let mapMounts = 0
/** False for the very first Agent Map, true for maps opened later by switching tabs. */
export function nextMapIsSwitch(): boolean {
  return mapMounts++ > 0
}
