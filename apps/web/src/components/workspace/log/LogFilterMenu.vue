<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Check, ChevronDown } from 'lucide-vue-next'

const props = defineProps<{ label: string; value: string; active: boolean; options: { id: string; label: string; checked: boolean }[]; keepOpen?: string[] }>()
const emit = defineEmits<{ pick: [id: string] }>()
const open = ref(false)
const button = ref<HTMLButtonElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const ROW = 'flex h-7 w-full cursor-pointer items-center gap-2 rounded-inner px-2 text-left text-xs text-ink outline-none hover:bg-fill focus-visible:bg-accent focus-visible:text-on-accent'

function pick(id: string): void {
  emit('pick', id)
  if (props.keepOpen?.includes(id)) {
    // The choice needs more input (date range): keep the menu so its extra fields can be reached.
    void nextTick(() => menu.value?.querySelector<HTMLElement>('input, select')?.focus())
    return
  }
  open.value = false
  button.value?.focus()
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    open.value = false
    button.value?.focus()
    return
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  e.preventDefault()
  const items = [...(menu.value?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])]
  const at = items.indexOf(document.activeElement as HTMLElement)
  items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
}

function onPointerDown(e: PointerEvent): void {
  const target = e.target as Node
  if (open.value && !menu.value?.contains(target) && !button.value?.contains(target)) open.value = false
}
document.addEventListener('pointerdown', onPointerDown, true)
onBeforeUnmount(() => document.removeEventListener('pointerdown', onPointerDown, true))

watch(open, (v) => {
  if (v) void nextTick(() => menu.value?.querySelector<HTMLElement>('[aria-checked="true"], [role^="menuitem"]')?.focus())
})
defineExpose({ close: () => (open.value = false) })
</script>

<template>
  <div class="relative min-w-0 shrink">
    <button
      ref="button"
      type="button"
      class="ccm-btn-plain h-6 max-w-44 min-w-0 gap-1 px-1.5 text-xs"
      :class="active ? 'text-accent-ink' : 'text-ink-muted'"
      aria-haspopup="menu"
      :aria-expanded="open"
      :title="`${label}: ${value}`"
      @click="open = !open"
    >
      <span class="truncate">{{ active ? value : label }}</span>
      <ChevronDown :size="12" class="shrink-0" aria-hidden="true" />
    </button>
    <Transition name="ccm-menu">
      <div v-if="open" ref="menu" class="ccm-menu absolute top-full left-0 z-30 mt-1 flex max-h-80 w-60 flex-col overflow-y-auto p-1" style="--ccm-origin: top left" role="menu" :aria-label="label" @keydown="onKey">
        <button v-for="o in options" :key="o.id" type="button" role="menuitemradio" :aria-checked="o.checked" :class="ROW" :title="o.label" @click="pick(o.id)">
          <Check :size="13" class="shrink-0" :class="o.checked ? '' : 'invisible'" aria-hidden="true" />
          <span class="min-w-0 truncate">{{ o.label }}</span>
        </button>
        <slot name="extra" />
      </div>
    </Transition>
  </div>
</template>
