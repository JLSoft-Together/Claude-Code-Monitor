<script setup lang="ts" generic="T extends string | number">
import type { Component } from 'vue'

export interface Segment<V> {
  value: V
  label: string
  icon?: Component
  lang?: string
  title?: string
}

const props = withDefaults(defineProps<{ options: Segment<T>[]; label: string; fill?: boolean; iconOnly?: boolean }>(), {
  fill: false,
  iconOnly: false,
})
const model = defineModel<T>({ required: true })

function onKey(e: KeyboardEvent): void {
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
  if (!step) return
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
    class="rounded-control bg-fill p-0.5"
    :class="fill ? 'grid auto-cols-fr grid-flow-col' : 'inline-flex'"
    role="radiogroup"
    :aria-label="label"
    @keydown="onKey"
  >
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
      class="inline-flex h-6 min-w-0 cursor-pointer items-center justify-center gap-1.5 rounded-inner px-2.5 text-xs font-medium whitespace-nowrap transition-[background-color,color,box-shadow] duration-150 ease-out-quint"
      :class="model === o.value ? 'bg-control text-ink shadow-control' : 'text-ink-muted hover:text-ink'"
      @click="model = o.value"
    >
      <component :is="o.icon" v-if="o.icon" :size="14" aria-hidden="true" />
      <span v-if="!iconOnly" class="truncate">{{ o.label }}</span>
    </button>
  </div>
</template>
