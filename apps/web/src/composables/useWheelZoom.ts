import { onBeforeUnmount, onMounted, ref } from 'vue'
import { desktop } from '../lib/desktop'
import { useSettingsStore } from '../stores/settings'

export type WheelZone = 'code' | 'map' | 'app'

/** Ctrl+wheel over code (terminal, file view, diff) sizes the code font; the Agent Map keeps its own zoom; anything else zooms the app. */
export function wheelZone(target: EventTarget | null): WheelZone {
  const el = target instanceof Element ? target : null
  if (el?.closest('[data-code-zoom]')) return 'code'
  if (el?.closest('.vue-flow')) return 'map'
  return 'app'
}

/** Mouse wheels send ±100 per notch, trackpads many small deltas: one step per STEP px, at most one per event. */
export const WHEEL_STEP_PX = 50

export function createWheelStepper(step = WHEEL_STEP_PX): (deltaY: number) => -1 | 0 | 1 {
  let acc = 0
  return (deltaY) => {
    if (Math.sign(deltaY) !== Math.sign(acc)) acc = 0
    acc += deltaY
    if (Math.abs(acc) < step) return 0
    acc = 0
    // Wheel down = smaller, like browsers.
    return deltaY > 0 ? -1 : 1
  }
}

/** Physical keys (e.code), so layouts where Ctrl+Alt is AltGr still match. */
export function codeSizeKey(e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>): -1 | 0 | 1 | null {
  if (!(e.ctrlKey || e.metaKey) || !e.altKey) return null
  if (e.code === 'Equal' || e.code === 'NumpadAdd') return 1
  if (e.code === 'Minus' || e.code === 'NumpadSubtract') return -1
  if ((e.code === 'Digit0' || e.code === 'Numpad0') && !e.shiftKey) return 0
  return null
}

export interface ZoomHud {
  kind: 'code' | 'app'
  value: number
  /** Bumped on every change so the HUD restarts its timer. */
  seq: number
}

export const zoomHud = ref<ZoomHud | null>(null)
let seq = 0

export function showZoomHud(kind: ZoomHud['kind'], value: number): void {
  zoomHud.value = { kind, value, seq: ++seq }
}

export async function zoomApp(action: 'in' | 'out' | 'reset'): Promise<void> {
  const pct = await desktop?.zoomApp?.(action)
  if (typeof pct === 'number') showZoomHud('app', pct)
}

export function stepCodeSize(settings: ReturnType<typeof useSettingsStore>, delta: -1 | 0 | 1): void {
  settings.stepCodeSize(delta)
  showZoomHud('code', settings.codeFontSize)
}

/** Installed once (App.vue). Capture phase so xterm never sees the event as a scroll. */
export function useWheelZoom(): void {
  const settings = useSettingsStore()
  const step = createWheelStepper()

  function onWheel(e: WheelEvent): void {
    if (!e.ctrlKey || e.deltaY === 0) return
    const zone = wheelZone(e.target)
    // Map zooms itself; outside the desktop app there is no app zoom to take over from the browser's.
    if (zone === 'map' || (zone === 'app' && !desktop?.zoomApp)) return
    e.preventDefault()
    e.stopPropagation()
    const dir = step(e.deltaY)
    if (!dir) return
    if (zone === 'code') stepCodeSize(settings, dir)
    else void zoomApp(dir > 0 ? 'in' : 'out')
  }

  // Ctrl/⌘+Alt + = - 0: code size (plain Ctrl +/-/0 is the app zoom, handled by the main process).
  function onKey(e: KeyboardEvent): void {
    const action = codeSizeKey(e)
    if (action === null) return
    e.preventDefault()
    e.stopPropagation()
    stepCodeSize(settings, action)
  }

  onMounted(() => {
    window.addEventListener('wheel', onWheel, { capture: true, passive: false })
    window.addEventListener('keydown', onKey, { capture: true })
  })
  onBeforeUnmount(() => {
    window.removeEventListener('wheel', onWheel, { capture: true })
    window.removeEventListener('keydown', onKey, { capture: true })
  })
}
