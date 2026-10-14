<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FilePlus, FolderPlus, X } from 'lucide-vue-next'
import { checkEntryName } from '@ccm/shared'
import { retireOverlay } from '../../lib/motion'

const props = defineProps<{
  /** Null = closed. `where` is the target folder relative to the project ('' = its root). */
  request: { kind: 'file' | 'directory'; where: string; rootName: string } | null
}>()
const emit = defineEmits<{ create: [name: string]; close: [] }>()

const { t } = useI18n()
const name = ref('')
const touched = ref(false)
const sheet = ref<HTMLElement | null>(null)
const input = ref<HTMLInputElement | null>(null)
let restoreFocus: HTMLElement | null = null

const check = computed(() => checkEntryName(name.value))
const problem = computed(() => (touched.value && !check.value.ok ? t(`workspace.explorer.name.${check.value.reason}`) : null))
const location = computed(() => (props.request ? `${props.request.rootName}${props.request.where ? `/${props.request.where}` : ''}` : ''))

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
    touched.value = false
    await nextTick()
    input.value?.focus()
  },
)

function submit(): void {
  touched.value = true
  if (check.value.ok) emit('create', name.value)
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
          aria-labelledby="ws-create-title"
          class="ccm-sheet flex w-full max-w-[420px] flex-col overflow-hidden"
          data-create-entry
          @keydown.esc.stop="emit('close')"
          @keydown="trap"
        >
          <header class="flex items-center gap-2 border-b border-line px-4 py-3">
            <component :is="request.kind === 'file' ? FilePlus : FolderPlus" :size="16" class="shrink-0 text-ink-muted" aria-hidden="true" />
            <div class="min-w-0 flex-1">
              <h2 id="ws-create-title" class="truncate text-sm font-semibold text-ink">
                {{ request.kind === 'file' ? t('workspace.explorer.create.titleFile') : t('workspace.explorer.create.titleFolder') }}
              </h2>
              <p class="truncate text-xs text-ink-faint" :title="location">{{ t('workspace.explorer.create.in', { path: location }) }}</p>
            </div>
            <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.explorer.create.cancel')" :aria-label="t('workspace.explorer.create.cancel')" @click="emit('close')">
              <X :size="14" aria-hidden="true" />
            </button>
          </header>
          <form class="flex flex-col gap-2 px-4 py-3" novalidate @submit.prevent="submit">
            <label class="flex flex-col gap-1 text-xs font-medium text-ink-muted">
              {{ t('workspace.explorer.create.name') }}
              <input
                ref="input"
                v-model="name"
                type="text"
                spellcheck="false"
                autocomplete="off"
                class="ccm-field h-8 font-mono text-sm"
                :aria-invalid="!!problem"
                aria-describedby="ws-create-problem"
                data-create-name
                @input="touched = true"
              />
            </label>
            <p id="ws-create-problem" class="min-h-4 text-xs text-st-error" role="status">{{ problem ?? '' }}</p>
            <div class="flex justify-end gap-2">
              <button type="button" class="ccm-btn" @click="emit('close')">{{ t('workspace.explorer.create.cancel') }}</button>
              <button type="submit" class="ccm-btn ccm-btn-primary" :disabled="!check.ok" data-create-submit>{{ t('workspace.explorer.create.action') }}</button>
            </div>
          </form>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
