<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useSlots } from 'vue'
import { useI18n } from 'vue-i18n'
import { LoaderCircle, X } from 'lucide-vue-next'
import TextCompare from './TextCompare.vue'

/** Modal diff: `a` (left) vs `b` (right), optional list in the `side` slot, Cancel + one primary action. */
const props = defineProps<{
  title: string
  subtitle?: string
  a: string | null
  b: string | null
  labels: { a: string; b: string }
  grammar: string | null
  primary: string
  primaryDisabled?: boolean
  loading?: boolean
  message?: string | null
  error?: boolean
}>()
const emit = defineEmits<{ primary: []; close: [] }>()
const { t } = useI18n()
const slots = useSlots()
const sheet = ref<HTMLElement | null>(null)
let restore: HTMLElement | null = null

function onKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return
  e.preventDefault()
  e.stopPropagation()
  emit('close')
}

onMounted(async () => {
  restore = document.activeElement as HTMLElement | null
  await nextTick()
  sheet.value?.focus()
})
onBeforeUnmount(() => {
  if (restore?.isConnected) restore.focus({ preventScroll: true })
})
const same = (): boolean => props.a !== null && props.a === props.b
</script>

<template>
  <Teleport to="body">
    <Transition name="ccm-dialog" appear>
      <div class="ccm-scrim fixed inset-0 z-50 flex items-center justify-center p-4" @click.self="emit('close')">
        <div
          ref="sheet"
          tabindex="-1"
          class="ccm-sheet flex h-[min(86vh,900px)] w-full max-w-[1200px] flex-col overflow-hidden outline-none"
          role="dialog"
          aria-modal="true"
          aria-labelledby="ccm-compare-title"
          @keydown="onKey"
        >
          <header class="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5">
            <div class="min-w-0 flex-1">
              <h2 id="ccm-compare-title" class="truncate text-sm font-semibold text-ink">{{ title }}</h2>
              <p v-if="subtitle" class="truncate text-2xs text-ink-faint" :title="subtitle">{{ subtitle }}</p>
            </div>
            <button type="button" class="ccm-btn-plain shrink-0" :aria-label="t('workspace.compare.close')" :title="t('workspace.compare.close')" @click="emit('close')"><X :size="15" aria-hidden="true" /></button>
          </header>
          <div class="flex min-h-0 flex-1">
            <aside v-if="slots.side" class="ccm-scroll w-56 shrink-0 overflow-y-auto border-r border-line">
              <slot name="side" />
            </aside>
            <div class="flex min-h-0 min-w-0 flex-1 flex-col">
              <div v-if="a !== null && b !== null" class="grid shrink-0 grid-cols-2 border-b border-line text-2xs font-medium text-ink-muted">
                <span class="truncate px-3 py-1" :title="labels.a">{{ labels.a }}</span>
                <span class="truncate border-l border-line px-3 py-1" :title="labels.b">{{ labels.b }}</span>
              </div>
              <div v-if="loading" class="grid flex-1 place-items-center text-xs text-ink-muted" role="status">
                <LoaderCircle :size="18" class="animate-spin" aria-hidden="true" />
              </div>
              <TextCompare v-else-if="a !== null && b !== null" :a="a" :b="b" :grammar="grammar" />
              <div v-else class="flex-1" />
            </div>
          </div>
          <footer class="flex shrink-0 items-center gap-2 border-t border-line px-4 py-2.5">
            <p v-if="message || same()" class="min-w-0 flex-1 truncate text-xs" :class="error ? 'text-st-error' : 'text-ink-muted'" :role="error ? 'alert' : 'status'" :title="message ?? ''">
              {{ message || t('workspace.compare.same') }}
            </p>
            <span v-else class="flex-1" />
            <button type="button" class="ccm-btn shrink-0" @click="emit('close')">{{ t('workspace.compare.cancel') }}</button>
            <button type="button" class="ccm-btn ccm-btn-primary shrink-0" :disabled="primaryDisabled || loading || a === null || b === null" data-compare-primary @click="emit('primary')">
              {{ primary }}
            </button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
