<script setup lang="ts" generic="T extends string | number">
import { onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'

export interface Segment<V> {
  value: V
  label: string
  icon?: Component
  iconClass?: string
  lang?: string
  title?: string
}

const props = withDefaults(defineProps<{ options: Segment<T>[]; label: string; fill?: boolean; iconOnly?: boolean; disabled?: boolean }>(), {
  fill: false,
  iconOnly: false,
  disabled: false,
})
const model = defineModel<T>({ required: true })

// One thumb slides to the picked segment (NSSegmentedControl) instead of the highlight jumping between buttons.
const root = ref<HTMLElement | null>(null)
const thumb = ref<{ x: number; y: number; w: number; h: number } | null>(null)
const thumbReady = ref(false)
function measure(): void {
  const el = root.value?.querySelector<HTMLElement>('[aria-checked="true"]')
  if (!el) return void (thumb.value = null)
  if (!el.offsetWidth) return
  thumb.value = { x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight }
  if (!thumbReady.value) requestAnimationFrame(() => (thumbReady.value = true))
}
const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => measure())
watch([model, () => props.options.map((o) => o.label).join()], measure, { flush: 'post' })
onMounted(() => {
  measure()
  if (root.value) observer?.observe(root.value)
})
onBeforeUnmount(() => observer?.disconnect())

function onKey(e: KeyboardEvent): void {
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
  if (!step || props.disabled) return
  e.preventDefault()
  const n = props.options.length
  const at = props.options.findIndex((o) => o.value === model.value)
  const next = (at + step + n) % n
  model.value = props.options[next]!.value
  ;(e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
}
</script>

<template>
  <div
    ref="root"
    class="relative rounded-control bg-fill p-0.5 transition-opacity duration-(--ccm-dur-fast) ease-out-quint"
    :class="[fill ? 'grid auto-cols-fr grid-flow-col' : 'inline-flex', disabled ? 'opacity-50' : '']"
    role="radiogroup"
    :aria-label="label"
    :aria-disabled="disabled || undefined"
    @keydown="onKey"
  >
    <span
      v-if="thumb"
      aria-hidden="true"
      class="pointer-events-none absolute top-0 left-0 rounded-inner bg-control shadow-control"
      :class="thumbReady ? 'transition-[transform,width] duration-(--ccm-dur-slow) ease-spring' : ''"
      :style="{ width: `${thumb.w}px`, height: `${thumb.h}px`, transform: `translate(${thumb.x}px, ${thumb.y}px)` }"
    />
    <button
      v-for="o in options"
      :key="String(o.value)"
      type="button"
      role="radio"
      :aria-checked="model === o.value"
      :aria-label="iconOnly ? o.label : undefined"
      :title="o.title ?? (iconOnly ? o.label : undefined)"
      :tabindex="model === o.value ? 0 : -1"
      :lang="o.lang"
      :disabled="disabled"
      class="relative inline-flex h-6 min-w-0 cursor-pointer disabled:cursor-default items-center justify-center gap-1.5 rounded-inner px-2.5 text-xs font-medium whitespace-nowrap transition-colors duration-(--ccm-dur-fast) ease-out-quint"
      :class="model === o.value ? (thumb ? 'text-ink' : 'bg-control text-ink shadow-control') : disabled ? 'text-ink-muted' : 'text-ink-muted hover:text-ink'"
      @click="model = o.value"
    >
      <component :is="o.icon" v-if="o.icon" :size="14" :class="o.iconClass" aria-hidden="true" />
      <span v-if="!iconOnly" class="truncate">{{ o.label }}</span>
    </button>
  </div>
</template>
