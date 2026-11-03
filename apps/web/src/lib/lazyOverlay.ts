import { defineAsyncComponent, ref, watch, type Component, type Ref } from 'vue'

const idle = (run: () => void): void => {
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 4000 })
  else window.setTimeout(run, 1500)
}

/**
 * Dialog opened only by a store flag: its chunk loads when the browser is idle, so the first open is instant, and
 * it stays mounted afterwards so the leave transition and focus return still run. Opening before the prefetch ends
 * mounts it right away (the component's own watch is `immediate` to catch that flag).
 */
export function lazyOverlay(load: () => Promise<{ default: Component }>, open: () => boolean): { Comp: Component; mounted: Ref<boolean> } {
  const mounted = ref(false)
  watch(open, (o) => o && (mounted.value = true), { immediate: true })
  idle(() => void load().then(() => (mounted.value = true)).catch(() => undefined))
  return { Comp: defineAsyncComponent(load), mounted }
}
