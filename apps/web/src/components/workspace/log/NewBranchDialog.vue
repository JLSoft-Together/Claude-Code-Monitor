<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { GitBranchPlus, X } from 'lucide-vue-next'
import { checkBranchName } from '@ccm/shared'
import { retireOverlay } from '../../../lib/motion'

const props = defineProps<{ request: { base: string; baseLabel: string } | null }>()
const emit = defineEmits<{ create: [name: string, checkout: boolean]; close: [] }>()
const { t } = useI18n()
const name = ref('')
const checkout = ref(true)
const touched = ref(false)
const sheet = ref<HTMLElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
let restoreFocus: HTMLElement | null = null
const check = computed(() => checkBranchName(name.value))
const problem = computed(() => (touched.value && !check.value.ok ? t(`workspace.log.branches.name.${check.value.reason}`) : null))

watch(
  () => props.request,
  async (req) => {
    if (!req) {
      if (restoreFocus?.isConnected) restoreFocus.focus()
      restoreFocus = null
      return
    }
    restoreFocus = document.activeElement as HTMLElement | null
    name.value = ''
    checkout.value = true
    touched.value = false
    await nextTick()
    input.value?.focus()
  },
)

function submit(): void {
  touched.value = true
  if (check.value.ok) emit('create', name.value, checkout.value)
}

function trap(e: KeyboardEvent): void {
  if (e.key !== 'Tab' || !sheet.value) return
  const items = [...sheet.value.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])')].filter((n) => n.offsetParent)
  const at = items.indexOf(document.activeElement as HTMLElement)
  e.preventDefault()
  items[(at + (e.shiftKey ? -1 : 1) + items.length) % items.length]?.focus()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div v-if="request" class="ccm-scrim fixed inset-0 z-50 flex items-start justify-center px-3 pt-[8vh] sm:px-4 sm:pt-[12vh]" @mousedown.self="emit('close')">
        <div
          ref="sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="log-new-branch"
          class="ccm-sheet flex w-full max-w-[420px] flex-col overflow-hidden"
          data-new-branch
          @keydown.esc.stop="emit('close')"
          @keydown="trap"
        >
          <header class="flex items-center gap-2 border-b border-line px-4 py-3">
            <GitBranchPlus :size="16" class="shrink-0 text-ink-muted" aria-hidden="true" />
            <div class="min-w-0 flex-1">
              <h2 id="log-new-branch" class="truncate text-sm font-semibold text-ink">{{ t('workspace.log.branches.newTitle') }}</h2>
              <p class="truncate text-xs text-ink-faint" :title="request.baseLabel">{{ t('workspace.log.branches.from', { base: request.baseLabel }) }}</p>
            </div>
            <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.log.branches.cancel')" :aria-label="t('workspace.log.branches.cancel')" @click="emit('close')">
              <X :size="14" aria-hidden="true" />
            </button>
          </header>
          <form class="flex flex-col gap-2 px-4 py-3" novalidate @submit.prevent="submit">
            <label class="flex flex-col gap-1 text-xs font-medium text-ink-muted">
              {{ t('workspace.log.branches.nameLabel') }}
              <input
                ref="input"
                v-model="name"
                type="text"
                spellcheck="false"
                autocomplete="off"
                class="ccm-field h-8 font-mono text-sm"
                :aria-invalid="!!problem"
                aria-describedby="log-new-branch-problem"
                data-new-branch-name
                @input="touched = true"
              />
            </label>
            <p id="log-new-branch-problem" class="min-h-4 text-xs text-st-error" role="status">{{ problem ?? '' }}</p>
            <label class="flex cursor-pointer items-center gap-2 text-xs text-ink">
              <input v-model="checkout" type="checkbox" class="accent-[var(--ccm-accent)]" data-new-branch-checkout />{{ t('workspace.log.branches.checkout') }}
            </label>
            <div class="flex justify-end gap-2">
              <button type="button" class="ccm-btn" @click="emit('close')">{{ t('workspace.log.branches.cancel') }}</button>
              <button type="submit" class="ccm-btn ccm-btn-primary" :disabled="!check.ok" data-new-branch-submit>{{ t('workspace.log.branches.create') }}</button>
            </div>
          </form>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
