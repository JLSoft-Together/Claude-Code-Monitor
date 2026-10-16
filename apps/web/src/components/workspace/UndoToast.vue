<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Undo2, X } from 'lucide-vue-next'

export interface UndoInfo {
  id: number
  text: string
  shells: number
}

const props = defineProps<{ info: UndoInfo | null; keys: string }>()
const emit = defineEmits<{ undo: []; dismiss: [refocus: boolean] }>()

const { t } = useI18n()
const SHOW_MS = 6000
const root = ref<HTMLElement | null>(null)
const held = ref(false)
let timer = 0

function arm(): void {
  window.clearTimeout(timer)
  if (props.info && !held.value) timer = window.setTimeout(() => emit('dismiss', false), SHOW_MS)
}

function hold(on: boolean): void {
  held.value = on
  arm()
}

function onFocusOut(e: FocusEvent): void {
  if (!root.value?.contains(e.relatedTarget as Node | null)) hold(false)
}

watch(() => props.info?.id, arm, { immediate: true })
onBeforeUnmount(() => window.clearTimeout(timer))
</script>

<template>
  <Transition
    enter-active-class="transition duration-(--ccm-dur-base) ease-out-quint"
    enter-from-class="opacity-0 translate-y-2"
    leave-active-class="transition duration-(--ccm-dur-fast) ease-exit"
    leave-to-class="opacity-0"
  >
    <div
      v-if="info"
      ref="root"
      class="ccm-sheet pointer-events-auto flex max-w-full min-w-0 items-center gap-2 py-1.5 pr-1.5 pl-3"
      role="status"
      aria-live="polite"
      data-undo-toast
      @pointerenter="hold(true)"
      @pointerleave="hold(false)"
      @focusin="hold(true)"
      @focusout="onFocusOut"
      @keydown.esc.stop.prevent="emit('dismiss', true)"
    >
      <span class="grid min-w-0 flex-1 *:[grid-area:1/1]">
        <Transition name="ccm-fade">
          <span :key="info.id" class="flex min-w-0 flex-col">
            <span class="truncate text-sm text-ink">{{ info.text }}</span>
            <span v-if="info.shells" class="truncate text-2xs text-ink-muted">{{ t('workspace.undo.shellNote', info.shells) }}</span>
          </span>
        </Transition>
      </span>
      <button
        type="button"
        class="ccm-btn shrink-0"
        :title="[t('workspace.undo.actionTitle', { keys }), info.shells ? t('workspace.undo.shellNote', info.shells) : ''].filter(Boolean).join('\n')"
        data-undo
        @click="emit('undo')"
      >
        <Undo2 :size="14" aria-hidden="true" />
        <span>{{ t('workspace.undo.action') }}</span>
        <kbd class="font-sans text-2xs text-ink-muted tabular">{{ keys }}</kbd>
      </button>
      <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.undo.dismiss')" :aria-label="t('workspace.undo.dismiss')" data-undo-dismiss @click="emit('dismiss', true)">
        <X :size="14" aria-hidden="true" />
      </button>
    </div>
  </Transition>
</template>
