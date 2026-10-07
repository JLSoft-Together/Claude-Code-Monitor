<script setup lang="ts" generic="T extends string | number | null">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch, type Component } from 'vue'
import { Check, ChevronDown } from 'lucide-vue-next'

export interface SelectOption<V> {
  value: V
  label: string
  hint?: string
}

const props = withDefaults(
  defineProps<{
    options: SelectOption<T>[]
    label: string
    icon?: Component
    size?: 'sm' | 'md'
    /** Trigger shows this instead of the selected label (e.g. "25 / page"). */
    display?: string
  }>(),
  { size: 'md', icon: undefined, display: undefined },
)
const model = defineModel<T>({ required: true })

const id = useId()
const open = ref(false)
const active = ref(0)
const trigger = ref<HTMLButtonElement | null>(null)
const list = ref<HTMLElement | null>(null)
const pos = ref({ left: 0, y: 0, minWidth: 0, maxHeight: 320, up: false })

const selectedIndex = computed(() => props.options.findIndex((o) => o.value === model.value))
const selectedLabel = computed(() => props.display ?? props.options[selectedIndex.value]?.label ?? '')

const GAP = 6
const MARGIN = 12

function place(): void {
  const el = trigger.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const below = window.innerHeight - r.bottom - GAP - MARGIN
  const above = r.top - GAP - MARGIN
  const up = below < 200 && above > below
  const maxHeight = Math.min(320, up ? above : below)
  const minWidth = Math.max(r.width, 160)
  const left = Math.min(Math.max(MARGIN, r.left), window.innerWidth - minWidth - MARGIN)
  pos.value = { left, y: up ? window.innerHeight - r.top + GAP : r.bottom + GAP, minWidth, maxHeight, up }
}

async function show(index = selectedIndex.value): Promise<void> {
  if (props.options.length === 0) return
  place()
  active.value = Math.max(0, index)
  open.value = true
  await nextTick()
  scrollActive()
}

function hide(focusTrigger = true): void {
  if (!open.value) return
  open.value = false
  if (focusTrigger) trigger.value?.focus()
}

function choose(index: number): void {
  const option = props.options[index]
  if (option) model.value = option.value
  hide()
}

function scrollActive(): void {
  list.value?.querySelector<HTMLElement>(`[data-index="${active.value}"]`)?.scrollIntoView({ block: 'nearest' })
}

function move(to: number): void {
  const n = props.options.length
  active.value = (to + n) % n
  void nextTick(scrollActive)
}

let typed = ''
let typedTimer: number | undefined
function typeahead(ch: string): void {
  window.clearTimeout(typedTimer)
  typed += ch.toLowerCase()
  typedTimer = window.setTimeout(() => (typed = ''), 600)
  const n = props.options.length
  const start = open.value ? active.value + (typed.length === 1 ? 1 : 0) : selectedIndex.value + 1
  for (let i = 0; i < n; i++) {
    const idx = (start + i) % n
    if (props.options[idx]!.label.toLowerCase().startsWith(typed)) {
      if (open.value) move(idx)
      else model.value = props.options[idx]!.value
      return
    }
  }
}

function onKey(e: KeyboardEvent): void {
  if (!open.value) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault()
      void show(e.key === 'ArrowUp' ? selectedIndex.value - 1 : selectedIndex.value)
    } else if (e.key.length === 1) typeahead(e.key)
    return
  }
  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      move(active.value + 1)
      break
    case 'ArrowUp':
      e.preventDefault()
      move(active.value - 1)
      break
    case 'Home':
      e.preventDefault()
      move(0)
      break
    case 'End':
      e.preventDefault()
      move(props.options.length - 1)
      break
    case 'Enter':
    case ' ':
      e.preventDefault()
      choose(active.value)
      break
    case 'Escape':
      // Stop here so a surrounding dialog does not close too.
      e.preventDefault()
      e.stopPropagation()
      hide()
      break
    case 'Tab':
      hide(false)
      break
    default:
      if (e.key.length === 1) typeahead(e.key)
  }
}

function onOutside(e: PointerEvent): void {
  const target = e.target as Node
  if (trigger.value?.contains(target) || list.value?.contains(target)) return
  hide(false)
}

const onViewport = (e: Event) => {
  if (e.type === 'scroll' && list.value?.contains(e.target as Node)) return
  hide(false)
}

watch(open, (value) => {
  if (value) {
    document.addEventListener('pointerdown', onOutside, true)
    window.addEventListener('resize', onViewport)
    window.addEventListener('scroll', onViewport, true)
  } else {
    document.removeEventListener('pointerdown', onOutside, true)
    window.removeEventListener('resize', onViewport)
    window.removeEventListener('scroll', onViewport, true)
  }
})

onBeforeUnmount(() => {
  open.value = false
  window.clearTimeout(typedTimer)
  document.removeEventListener('pointerdown', onOutside, true)
  window.removeEventListener('resize', onViewport)
  window.removeEventListener('scroll', onViewport, true)
})

const triggerCls = computed(() =>
  props.size === 'sm' ? 'h-8 gap-1.5 rounded-lg pl-2.5 pr-2 text-xs' : 'h-11 gap-2 rounded-xl pl-3 pr-2.5 text-sm',
)
</script>

<template>
  <button
    ref="trigger"
    type="button"
    role="combobox"
    :aria-label="label"
    :title="label"
    aria-haspopup="listbox"
    :aria-expanded="open"
    :aria-controls="`${id}-list`"
    :aria-activedescendant="open ? `${id}-opt-${active}` : undefined"
    class="inline-flex max-w-full min-w-0 cursor-pointer items-center border bg-surface text-ink transition-[border-color,box-shadow] duration-150 outline-none hover:border-line-strong focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--ccm-accent-soft)]"
    :class="[triggerCls, open ? 'border-accent shadow-[0_0_0_3px_var(--ccm-accent-soft)]' : 'border-line']"
    @click="open ? hide() : show()"
    @keydown="onKey"
  >
    <component :is="icon" v-if="icon" :size="size === 'sm' ? 14 : 16" class="shrink-0 text-ink-faint" aria-hidden="true" />
    <span class="min-w-0 flex-1 truncate text-left">{{ selectedLabel }}</span>
    <ChevronDown
      :size="size === 'sm' ? 14 : 16"
      class="shrink-0 text-ink-faint transition-transform duration-200 motion-reduce:transition-none"
      :class="open ? 'rotate-180 text-accent' : ''"
      aria-hidden="true"
    />
  </button>

  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150 ease-out motion-reduce:transition-none"
      :enter-from-class="pos.up ? 'opacity-0 translate-y-1 scale-[0.98]' : 'opacity-0 -translate-y-1 scale-[0.98]'"
      leave-active-class="transition duration-100 ease-in motion-reduce:transition-none"
      leave-to-class="opacity-0"
    >
      <ul
        v-if="open"
        :id="`${id}-list`"
        ref="list"
        role="listbox"
        :aria-label="label"
        tabindex="-1"
        class="fixed z-[70] overflow-y-auto overscroll-contain rounded-xl border border-line bg-surface p-1 text-sm shadow-[0_12px_32px_-8px_rgb(0_0_0/0.35)]"
        :class="pos.up ? 'origin-bottom' : 'origin-top'"
        :style="{ left: `${pos.left}px`, [pos.up ? 'bottom' : 'top']: `${pos.y}px`, minWidth: `${pos.minWidth}px`, maxWidth: `calc(100vw - ${2 * MARGIN}px)`, maxHeight: `${pos.maxHeight}px` }"
        @mousedown.prevent
      >
        <li
          v-for="(o, i) in options"
          :id="`${id}-opt-${i}`"
          :key="String(o.value)"
          :data-index="i"
          role="option"
          :aria-selected="i === selectedIndex"
          class="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2"
          :class="[i === active ? 'bg-raised' : '', i === selectedIndex ? 'font-medium text-accent' : 'text-ink']"
          @pointermove="active = i"
          @click="choose(i)"
        >
          <span class="min-w-0 flex-1 truncate">{{ o.label }}</span>
          <span v-if="o.hint" class="shrink-0 text-xs text-ink-faint tabular">{{ o.hint }}</span>
          <Check :size="15" class="shrink-0" :class="i === selectedIndex ? '' : 'invisible'" aria-hidden="true" />
        </li>
      </ul>
    </Transition>
  </Teleport>
</template>
