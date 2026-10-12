<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { X } from 'lucide-vue-next'
import { SHORTCUTS, type Shortcut } from '../lib/shortcuts'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import ToggleSwitch from './ToggleSwitch.vue'

const { t } = useI18n()
const ui = useUiStore()
const settings = useSettingsStore()
const dialog = ref<HTMLElement | null>(null)
let restoreFocus: HTMLElement | null = null

const groups = computed(() =>
  (['panels', 'map', 'help'] as const).map((g) => ({ id: g, items: SHORTCUTS.filter((s: Shortcut) => s.group === g) })),
)

function close(): void {
  ui.shortcutsOpen = false
}

function trap(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
    return
  }
  if (e.key !== 'Tab' || !dialog.value) return
  const focusables = [...dialog.value.querySelectorAll<HTMLElement>('button:not([disabled])')]
  const first = focusables[0]
  const last = focusables.at(-1)
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last?.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first?.focus()
  }
}

watch(
  () => ui.shortcutsOpen,
  async (open) => {
    if (open) {
      restoreFocus = document.activeElement as HTMLElement | null
      await nextTick()
      dialog.value?.querySelector<HTMLElement>('button')?.focus()
    } else {
      if (restoreFocus?.isConnected) restoreFocus.focus()
      restoreFocus = null
    }
  },
)
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150 ease-out motion-reduce:transition-none"
      enter-from-class="opacity-0"
      leave-active-class="transition duration-100 ease-in motion-reduce:transition-none"
      leave-to-class="opacity-0"
    >
      <div v-if="ui.shortcutsOpen" class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 px-4 py-[6vh]" @mousedown.self="close">
        <div
          ref="dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="keys-title"
          class="ccm-pop w-full max-w-[520px] rounded-xl border border-line bg-surface shadow-lg"
          @keydown="trap"
        >
          <div class="flex items-center gap-2 border-b border-line px-5 py-4">
            <div class="mr-auto min-w-0">
              <h2 id="keys-title" class="text-lg font-semibold">{{ t('keys.title') }}</h2>
              <p class="text-xs text-ink-muted">{{ t('keys.subtitle') }}</p>
            </div>
            <button
              type="button"
              class="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-raised hover:text-ink"
              :aria-label="t('projects.close')"
              @click="close"
            >
              <X :size="18" aria-hidden="true" />
            </button>
          </div>

          <div class="border-b border-line px-5 py-2">
            <ToggleSwitch v-model="settings.keyHints" :label="t('keys.hints')" :hint="t('keys.hintsHint')" />
          </div>

          <div class="grid gap-5 px-5 py-4">
            <section v-for="g in groups" :key="g.id" :aria-labelledby="`keys-${g.id}`">
              <h3 :id="`keys-${g.id}`" class="mb-2 text-xs font-semibold text-ink-muted">{{ t(`keys.group.${g.id}`) }}</h3>
              <dl class="divide-y divide-line">
                <div v-for="s in g.items" :key="s.id" class="flex items-center justify-between gap-4 py-2 text-sm">
                  <dt class="min-w-0 text-ink">{{ t(`keys.item.${s.id}`) }}</dt>
                  <dd class="flex shrink-0 items-center gap-1">
                    <kbd
                      v-for="(k, i) in s.keys"
                      :key="i"
                      class="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-b-2 border-line-strong bg-raised px-1.5 font-sans text-xs font-medium text-ink-muted"
                    >{{ k }}</kbd>
                  </dd>
                </div>
              </dl>
            </section>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
