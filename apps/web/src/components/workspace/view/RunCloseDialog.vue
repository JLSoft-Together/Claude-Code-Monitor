<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { retireOverlay } from '../../../lib/motion'
import type { RailCluster } from '../../../lib/rail/railModel'

defineProps<{ cluster: RailCluster | null; busy: boolean }>()
const emit = defineEmits<{ cancel: []; confirm: [] }>()

const { t } = useI18n()
const confirmButton = ref<HTMLButtonElement | null>(null)

function trapTab(e: KeyboardEvent): void {
  if (e.key !== 'Tab') return
  const buttons = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button:not([disabled])')]
  const at = buttons.indexOf(document.activeElement as HTMLElement)
  e.preventDefault()
  buttons[(at + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus()
}

defineExpose({ focus: () => confirmButton.value?.focus() })
</script>

<template>
  <Teleport to="body">
    <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div v-if="cluster" class="ccm-scrim fixed inset-0 z-50 flex items-center justify-center p-4" @click.self="emit('cancel')">
        <div
          class="ccm-sheet flex w-full max-w-[440px] flex-col gap-3 p-5"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="ws-runclose-title"
          aria-describedby="ws-runclose-body"
          data-run-close
          @keydown.esc.stop="emit('cancel')"
          @keydown="trapTab"
        >
          <h2 id="ws-runclose-title" class="text-base font-semibold text-ink">{{ t('workspace.rail.runConfirm.title', { name: cluster.name || t('workspace.side.home') }) }}</h2>
          <p id="ws-runclose-body" class="text-sm text-ink-muted">{{ t('workspace.rail.runConfirm.body') }}</p>
          <div class="flex justify-end gap-2">
            <button type="button" class="ccm-btn" @click="emit('cancel')">{{ t('workspace.rail.runConfirm.cancel') }}</button>
            <button ref="confirmButton" type="button" class="ccm-btn ccm-btn-danger" :disabled="busy" @click="emit('confirm')">
              {{ t('workspace.rail.runConfirm.action') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
