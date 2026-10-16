<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useRunnerBudget } from '../composables/useMapNode'
import { treePath } from '../lib/layout'
import { reducedMotion } from '../lib/motion'

defineOptions({ inheritAttrs: false })

type PulseDir = 'down' | 'up'

const props = defineProps<{
  id: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  data?: { pulse?: { n: number; dir: PulseDir } }
}>()

const PULSE_MS = 620
const DOWN_DELAY_MS = 200

const runners = useRunnerBudget()
const d = computed(() => treePath(props.sourceX, props.sourceY, props.targetX, props.targetY))
const pathEl = ref<SVGPathElement | null>(null)
const dot = ref<{ x: number; y: number; dir: PulseDir } | null>(null)
let frame = 0
let timer = 0
let holding = false

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

function release(): void {
  if (!holding) return
  holding = false
  runners?.give()
}

function stop(): void {
  cancelAnimationFrame(frame)
  window.clearTimeout(timer)
  dot.value = null
  release()
}

function run(dir: PulseDir): void {
  stop()
  if (reducedMotion()) return
  const start = () => {
    const el = pathEl.value
    if (!el) return
    const len = el.getTotalLength()
    if (!len) return
    if (runners && !runners.take()) return
    holding = true
    const t0 = performance.now()
    const step = (at: number) => {
      const k = Math.min(1, (at - t0) / PULSE_MS)
      const p = el.getPointAtLength(len * (dir === 'down' ? ease(k) : 1 - ease(k)))
      dot.value = { x: p.x, y: p.y, dir }
      if (k < 1) frame = requestAnimationFrame(step)
      else {
        dot.value = null
        release()
      }
    }
    frame = requestAnimationFrame(step)
  }
  if (dir === 'down') timer = window.setTimeout(start, DOWN_DELAY_MS)
  else start()
}

watch(
  () => props.data?.pulse?.n,
  (n) => {
    const pulse = props.data?.pulse
    if (n && pulse) run(pulse.dir)
  },
  { immediate: true, flush: 'post' },
)

onBeforeUnmount(stop)
</script>

<template>
  <path :id="id" ref="pathEl" class="vue-flow__edge-path" :d="d" fill="none" />
  <g v-if="dot" class="pointer-events-none" aria-hidden="true">
    <circle :cx="dot.x" :cy="dot.y" r="7" :class="dot.dir === 'down' ? 'fill-st-working' : 'fill-st-done'" opacity="0.2" />
    <circle :cx="dot.x" :cy="dot.y" r="3.5" :class="dot.dir === 'down' ? 'fill-st-working' : 'fill-st-done'" />
  </g>
</template>
