<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { X } from 'lucide-vue-next'
import { usePaneInfo } from '../../../composables/usePaneInfo'
import { retireOverlay } from '../../../lib/motion'
import { baseName } from '../../../lib/preview'
import type { Pane } from '../../../stores/workspace'
import PaneIcon from '../PaneIcon.vue'

defineProps<{
  closing: Pane[]
  dirty: Pane[]
  busy: Pane[]
  errors: string[]
  saving: boolean
  out: boolean
}>()
const emit = defineEmits<{ cancel: []; confirm: []; save: [] }>()

const { t } = useI18n()
const { describe, isBusy } = usePaneInfo()
const confirmButton = ref<HTMLButtonElement | null>(null)
const confirmSheet = ref<HTMLElement | null>(null)

function trapConfirm(e: KeyboardEvent): void {
  if (e.key !== 'Tab' || !confirmSheet.value) return
  const buttons = [...confirmSheet.value.querySelectorAll<HTMLElement>('button:not([disabled])')]
  const at = buttons.indexOf(document.activeElement as HTMLElement)
  const next = buttons[(at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]
  e.preventDefault()
  next?.focus()
}

defineExpose({ focus: () => confirmButton.value?.focus() })
</script>

<template>
  <Teleport to="body">
    <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div v-if="closing.length && !out" class="ccm-scrim fixed inset-0 z-50 flex items-center justify-center p-4" @click.self="emit('cancel')">
        <div
          ref="confirmSheet"
          class="ccm-sheet flex w-full max-w-[440px] flex-col gap-3 p-5"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="ws-close-title"
          aria-describedby="ws-close-body"
          @keydown.esc.stop="emit('cancel')"
          @keydown="trapConfirm"
        >
          <template v-if="dirty.length">
            <h2 id="ws-close-title" class="text-base font-semibold text-ink" data-close-unsaved>{{ t('editor.close.title', { n: dirty.length }, dirty.length) }}</h2>
            <div id="ws-close-body" class="flex flex-col gap-2 text-sm text-ink-muted">
              <p>{{ t('editor.close.body') }}</p>
              <ul class="flex flex-col gap-1 rounded-inner bg-fill p-2 text-xs text-ink">
                <li v-for="p in dirty" :key="p.key" class="flex min-w-0 items-center gap-1.5">
                  <PaneIcon :pane="p" :size="13" class="shrink-0" />
                  <span class="truncate" :title="p.path">{{ baseName(p.path ?? '') }}</span>
                  <span class="shrink-0 text-warning" aria-hidden="true">●</span>
                </li>
              </ul>
              <template v-if="busy.length">
                <p>{{ t('editor.close.busy') }}</p>
                <ul class="flex flex-col gap-1 rounded-inner bg-fill p-2 text-xs text-ink">
                  <li v-for="p in busy" :key="p.key" class="flex min-w-0 items-center gap-1.5">
                    <PaneIcon :pane="p" :size="13" class="shrink-0" />
                    <span class="truncate" :title="p.cwd">{{ describe(p) }}</span>
                  </li>
                </ul>
              </template>
              <p v-for="(err, i) in errors" :key="i" class="flex items-start gap-1.5 text-xs text-st-error" role="alert">
                <X :size="13" class="mt-0.5 shrink-0" aria-hidden="true" /><span class="min-w-0">{{ err }}</span>
              </p>
            </div>
            <div class="flex justify-end gap-2">
              <button type="button" class="ccm-btn" @click="emit('cancel')">{{ t('editor.close.cancel') }}</button>
              <button type="button" class="ccm-btn ccm-btn-danger" :disabled="saving" data-close-discard @click="emit('confirm')">{{ t('editor.close.discard') }}</button>
              <button ref="confirmButton" type="button" class="ccm-btn ccm-btn-primary" :disabled="saving" data-close-save @click="emit('save')">{{ t('editor.close.save') }}</button>
            </div>
          </template>
          <template v-else>
            <h2 id="ws-close-title" class="text-base font-semibold text-ink">{{ t('workspace.closeConfirm.title', { n: closing.length }, closing.length) }}</h2>
            <div id="ws-close-body" class="flex flex-col gap-2 text-sm text-ink-muted">
              <p>{{ t('workspace.closeConfirm.body') }}</p>
              <ul class="flex flex-col gap-1 rounded-inner bg-fill p-2 text-xs text-ink">
                <li v-for="p in closing" :key="p.key" class="flex min-w-0 items-center gap-1.5" :class="isBusy(p) ? '' : 'text-ink-muted'">
                  <PaneIcon :pane="p" :size="13" class="shrink-0" />
                  <span class="truncate" :title="p.cwd">{{ describe(p) }}</span>
                </li>
              </ul>
            </div>
            <div class="flex justify-end gap-2">
              <button type="button" class="ccm-btn" @click="emit('cancel')">{{ t('workspace.closeConfirm.cancel') }}</button>
              <button ref="confirmButton" type="button" class="ccm-btn ccm-btn-danger" @click="emit('confirm')">
                {{ t('workspace.closeConfirm.action', { n: closing.length }, closing.length) }}
              </button>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
