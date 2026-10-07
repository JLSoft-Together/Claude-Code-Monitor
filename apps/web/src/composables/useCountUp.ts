import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

const reducedMotion = (): boolean => {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return true
  }
}

/** Animates a displayed number toward its source value so changes read as motion, not a jump. */
export function useCountUp(source: Ref<number>, durationMs = 450): Ref<number> {
  const shown = ref(source.value)
  let frame = 0

  watch(source, (to) => {
    cancelAnimationFrame(frame)
    const from = shown.value
    if (from === to || reducedMotion() || typeof requestAnimationFrame !== 'function') {
      shown.value = to
      return
    }
    const start = performance.now()
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / durationMs)
      const eased = 1 - Math.pow(1 - k, 4)
      shown.value = from + (to - from) * eased
      if (k < 1) frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
  })

  onBeforeUnmount(() => cancelAnimationFrame(frame))
  return shown
}
