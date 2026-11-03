<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Info, TriangleAlert, X } from 'lucide-vue-next'
import { useToastsStore, type Toast } from '../stores/toasts'
import ArtImage, { type ArtName } from './ArtImage.vue'

const { t } = useI18n()
const toasts = useToastsStore()

const inline = (toast: Toast): boolean => !toast.title && !toast.art && !toast.meta && (toast.actions?.length ?? 0) <= 1
const iconOf = (toast: Toast) => toast.icon ?? (toast.kind === 'warning' || toast.kind === 'phoneFail' ? TriangleAlert : toast.kind === 'info' ? Info : null)

function onFocusOut(toast: Toast, e: FocusEvent): void {
  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) toasts.hold(toast.id, false)
}

// Esc belongs to a terminal or an open dialog first; the stack only takes it when focus is not in a field, terminal or editor.
function onWindowKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || e.defaultPrevented || !toasts.visible.length) return
  const target = e.target as Element | null
  if (target?.closest('input, textarea, select, [contenteditable], .xterm, .cm-editor')) return
  if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return
  e.preventDefault()
  toasts.dismissTop('esc')
}

onMounted(() => window.addEventListener('keydown', onWindowKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onWindowKey))
</script>

<template>
  <div
    class="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(360px,calc(100vw-2rem))] flex-col items-stretch gap-2"
    aria-live="polite"
    data-toast-host
  >
    <TransitionGroup
      enter-active-class="transition duration-(--ccm-dur-base) ease-out-quint"
      enter-from-class="opacity-0 motion-safe:translate-y-3"
      leave-active-class="transition duration-(--ccm-dur-fast) ease-exit"
      leave-to-class="opacity-0 motion-safe:translate-y-2"
      move-class="motion-safe:transition-transform motion-safe:duration-(--ccm-dur-base)"
    >
      <div
        v-for="toast in toasts.visible"
        :key="toast.id"
        class="ccm-sheet pointer-events-auto p-3"
        :data-toast="toast.kind"
        v-bind="toast.attrs"
        @pointerenter="toasts.hold(toast.id, true)"
        @pointerleave="toasts.hold(toast.id, false)"
        @focusin="toasts.hold(toast.id, true)"
        @focusout="onFocusOut(toast, $event)"
        @keydown.esc.stop.prevent="toasts.dismiss(toast.id, 'esc')"
      >
        <div class="flex gap-2.5" :class="inline(toast) ? 'items-center' : 'items-start'">
          <ArtImage v-if="toast.art" :name="toast.art" class="w-16 shrink-0 pt-0.5" />
          <component :is="iconOf(toast)" v-else-if="iconOf(toast)" :size="16" class="mt-0.5 shrink-0" :class="toast.kind === 'info' ? 'text-ink-muted' : 'text-warning'" aria-hidden="true" />
          <div class="min-w-0 flex-1">
            <h2 v-if="toast.title" class="text-sm font-semibold">{{ toast.title }}</h2>
            <p class="text-sm text-ink" :class="[toast.title ? 'mt-0.5 leading-relaxed text-ink-muted' : '', inline(toast) ? 'truncate' : '']">{{ toast.text }}</p>
            <p v-if="toast.detail" class="truncate text-2xs text-ink-muted" :class="inline(toast) ? '' : 'mt-1'">{{ toast.detail }}</p>
          </div>
          <template v-if="inline(toast)">
            <button
              v-for="action in toast.actions"
              :key="action.label"
              type="button"
              class="ccm-btn shrink-0"
              :title="action.title"
              v-bind="action.attrs"
              @click="action.run()"
            >
              <component :is="action.icon" v-if="action.icon" :size="14" aria-hidden="true" />
              <span>{{ action.label }}</span>
              <kbd v-if="action.keys" class="font-sans text-2xs text-ink-muted tabular">{{ action.keys }}</kbd>
            </button>
          </template>
          <button
            type="button"
            class="ccm-btn-plain shrink-0"
            :class="inline(toast) ? '' : '-mt-1 -mr-1'"
            :title="t('toast.close')"
            :aria-label="t('toast.close')"
            v-bind="toast.dismissAttrs"
            @click="toasts.dismiss(toast.id, 'close')"
          >
            <X :size="15" aria-hidden="true" />
          </button>
        </div>
        <div v-if="!inline(toast) && (toast.actions?.length || toast.meta)" class="mt-2.5 flex items-center justify-end gap-2">
          <span v-if="toast.meta" class="mr-auto text-xs text-ink-faint tabular">{{ toast.meta }}</span>
          <button
            v-for="action in toast.actions"
            :key="action.label"
            type="button"
            class="ccm-btn"
            :class="action.primary ? 'ccm-btn-primary' : ''"
            :title="action.title"
            v-bind="action.attrs"
            @click="action.run()"
          >
            <component :is="action.icon" v-if="action.icon" :size="14" aria-hidden="true" />
            <span>{{ action.label }}</span>
            <kbd v-if="action.keys" class="font-sans text-2xs text-ink-muted tabular">{{ action.keys }}</kbd>
          </button>
        </div>
      </div>
    </TransitionGroup>
  </div>
</template>
