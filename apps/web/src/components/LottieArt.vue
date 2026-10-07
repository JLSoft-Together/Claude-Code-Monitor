<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { AnimationItem } from 'lottie-web'

export type LottieName = 'radar-scan' | 'check-pop' | 'notification-bell'

const props = withDefaults(defineProps<{ name: LottieName; loop?: boolean; playKey?: number }>(), { loop: false, playKey: 0 })

const files = import.meta.glob<unknown>('../assets/art/*.json', { import: 'default' })

// Source colours baked into the exported files → theme tokens, resolved at load time.
const SOURCE: [number[], string][] = [
  [[0.702, 0.325, 0.184], '--ccm-accent'],
  [[0.106, 0.106, 0.098], '--ccm-ink'],
  [[0.247, 0.478, 0.231], '--ccm-done'],
]

const host = ref<HTMLElement | null>(null)
let anim: AnimationItem | null = null
let disposed = false

function tokenRgb(el: HTMLElement, token: string): number[] | null {
  const hex = getComputedStyle(el).getPropertyValue(token).trim()
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  return m ? [m[1], m[2], m[3]].map((x) => parseInt(x!, 16) / 255) : null
}

function recolor(node: unknown, map: [number[], number[]][]): void {
  if (Array.isArray(node)) {
    for (const child of node) recolor(child, map)
    return
  }
  if (!node || typeof node !== 'object') return
  const obj = node as Record<string, unknown>
  const k = obj.k
  if (Array.isArray(k) && k.length === 4 && k.every((x) => typeof x === 'number')) {
    const hit = map.find(([from]) => from.every((v, i) => Math.abs(v - (k[i] as number)) < 0.005))
    if (hit) obj.k = [...hit[1], k[3]]
  }
  for (const value of Object.values(obj)) recolor(value, map)
}

async function load(): Promise<void> {
  const el = host.value
  const loader = Object.entries(files).find(([path]) => path.endsWith(`-${props.name}.json`))?.[1]
  if (!el || !loader) return
  const [{ default: lottie }, data] = await Promise.all([import('lottie-web/build/player/lottie_light'), loader()])
  if (disposed) return
  const animationData = structuredClone(data)
  const map = SOURCE.flatMap(([from, token]) => {
    const to = tokenRgb(el, token)
    return to ? [[from, to] as [number[], number[]]] : []
  })
  recolor(animationData, map)
  anim?.destroy()
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  anim = lottie.loadAnimation({ container: el, renderer: 'svg', loop: props.loop && !reduced, autoplay: !reduced, animationData })
  if (reduced) anim.goToAndStop(props.loop ? 0 : anim.totalFrames - 1, true)
}

onMounted(load)
watch(() => props.playKey, load)
onBeforeUnmount(() => {
  disposed = true
  anim?.destroy()
})
</script>

<template>
  <span ref="host" class="block [&>svg]:block" aria-hidden="true" />
</template>
