<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePaneInfo } from '../../../composables/usePaneInfo'
import { retireOverlay } from '../../../lib/motion'
import { presetOf, type Pane } from '../../../stores/workspace'
import PresetIcon from '../PresetIcon.vue'

const props = defineProps<{ choices: { from: string; text: string | null; panes: Pane[] } | null }>()
const emit = defineEmits<{ cancel: []; pick: [paneKey: string, text: string | null] }>()

const { t } = useI18n()
const { describe } = usePaneInfo()
const choiceList = ref<HTMLElement | null>(null)

watch(
  () => props.choices,
  async (c) => {
    if (!c) return
    await nextTick()
    choiceList.value?.querySelector<HTMLElement>('button')?.focus()
  },
)

function onChoiceKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('cancel')
    return
  }
  const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0
  if (!step || !choiceList.value) return
  e.preventDefault()
  const items = [...choiceList.value.querySelectorAll<HTMLElement>('button')]
  const at = items.indexOf(document.activeElement as HTMLElement)
  items[(at + step + items.length) % items.length]?.focus()
}
</script>

<template>
  <Teleport to="body">
    <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div v-if="choices" class="ccm-scrim fixed inset-0 z-50 flex items-center justify-center p-4" @click.self="emit('cancel')">
        <div class="ccm-sheet flex w-full max-w-[360px] flex-col gap-2 p-3" role="dialog" aria-modal="true" aria-labelledby="ws-agent-title" @keydown="onChoiceKey">
          <h2 id="ws-agent-title" class="px-1 text-sm font-semibold text-ink">{{ t('workspace.handoff.pickTarget') }}</h2>
          <ul ref="choiceList" class="flex flex-col" role="list">
            <li v-for="p in choices.panes" :key="p.key">
              <button
                type="button"
                class="group flex h-8 w-full min-w-0 cursor-pointer items-center gap-2 rounded-inner px-2 text-left text-sm text-ink hover:bg-fill focus-visible:bg-accent focus-visible:text-on-accent focus-visible:outline-none"
                @click="emit('pick', p.key, choices.text)"
              >
                <PresetIcon :preset="presetOf(p)" :size="14" class="shrink-0 group-focus-visible:text-on-accent" />
                <span class="truncate" :title="p.cwd">{{ describe(p) }}</span>
              </button>
            </li>
          </ul>
          <div class="flex justify-end">
            <button type="button" class="ccm-btn" @click="emit('cancel')">{{ t('workspace.closeConfirm.cancel') }}</button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
