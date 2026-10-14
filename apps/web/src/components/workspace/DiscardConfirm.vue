<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { TriangleAlert } from 'lucide-vue-next'

defineProps<{ title: string; lines: string[]; preview?: string[] }>()
const emit = defineEmits<{ confirm: []; cancel: [] }>()

const { t } = useI18n()
const sheet = ref<HTMLElement | null>(null)
const cancelButton = ref<HTMLButtonElement | null>(null)
let restore: HTMLElement | null = null

function trap(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('cancel')
    return
  }
  if (e.key !== 'Tab') return
  const items = [...(sheet.value?.querySelectorAll<HTMLElement>('button') ?? [])]
  if (!items.length) return
  const at = items.indexOf(document.activeElement as HTMLElement)
  const next = (at + (e.shiftKey ? -1 : 1) + items.length) % items.length
  e.preventDefault()
  items[next]!.focus()
}

onMounted(async () => {
  restore = document.activeElement as HTMLElement | null
  await nextTick()
  cancelButton.value?.focus()
})
onBeforeUnmount(() => {
  if (restore?.isConnected) restore.focus()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="ccm-dialog" appear>
    <div class="ccm-scrim fixed inset-0 z-50 flex items-center justify-center p-4" @click.self="emit('cancel')">
      <div
        ref="sheet"
        class="ccm-sheet flex w-full max-w-[460px] flex-col gap-3 p-5"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ccm-discard-title"
        aria-describedby="ccm-discard-body"
        @keydown="trap"
      >
        <div class="flex items-start gap-3">
          <TriangleAlert :size="22" class="mt-0.5 shrink-0 text-st-error" aria-hidden="true" />
          <h2 id="ccm-discard-title" class="min-w-0 break-words text-base font-semibold text-ink">{{ title }}</h2>
        </div>
        <div id="ccm-discard-body" class="flex flex-col gap-2 text-sm text-ink-muted">
          <p v-for="(line, i) in lines" :key="i">{{ line }}</p>
          <pre
            v-if="preview?.length"
            class="ccm-scroll max-h-40 overflow-auto rounded-inner bg-well px-2.5 py-2 font-mono text-2xs leading-relaxed text-well-ink"
          ><template v-for="(p, i) in preview" :key="i">{{ p }}
</template></pre>
        </div>
        <div class="flex justify-end gap-2 pt-1">
          <button ref="cancelButton" type="button" class="ccm-btn" @click="emit('cancel')">{{ t('workspace.changes.confirm.cancel') }}</button>
          <button type="button" class="ccm-btn ccm-btn-danger" @click="emit('confirm')">{{ t('workspace.changes.confirm.discard') }}</button>
        </div>
      </div>
    </div>
    </Transition>
  </Teleport>
</template>
