import { nextTick } from 'vue'

export function reducedMotion(): boolean {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return true
  }
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
