<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { X } from 'lucide-vue-next'
import { desktop, hasTerminals } from '../lib/desktop'
import { isMac } from '../lib/platform'
import { retireOverlay } from '../lib/motion'
import { formatKeys, SHORTCUTS, viewShortcuts, workspaceShortcuts, type Shortcut } from '../lib/shortcuts'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import ToggleSwitch from './ToggleSwitch.vue'

const { t } = useI18n()
const ui = useUiStore()
const settings = useSettingsStore()
const dialog = ref<HTMLElement | null>(null)
let restoreFocus: HTMLElement | null = null

const groups = computed(() => {
  const list: { id: Shortcut['group']; items: Shortcut[] }[] = (['panels', 'map', 'help'] as const).map((g) => ({
    id: g,
    items: SHORTCUTS.filter((s: Shortcut) => s.group === g),
  }))
  if (hasTerminals) list.splice(2, 0, { id: 'workspace', items: workspaceShortcuts(isMac) })
  if (desktop) list.splice(list.length - 1, 0, { id: 'view', items: viewShortcuts(isMac) })
  return list
})

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
    <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div v-if="ui.shortcutsOpen" class="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto ccm-scrim px-4 py-[6vh]" @mousedown.self="close">
        <div
          ref="dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="keys-title"
          class="w-full max-w-[520px] ccm-sheet"
          @keydown="trap"
        >
          <div class="flex items-center gap-2 border-b border-line px-5 py-4">
            <div class="mr-auto min-w-0">
              <h2 id="keys-title" class="text-base font-semibold">{{ t('keys.title') }}</h2>
              <p class="text-2xs text-ink-muted">{{ t('keys.subtitle') }}</p>
            </div>
            <button
              type="button"
              class="ccm-btn-plain"
              :aria-label="t('projects.close')"
              @click="close"
            >
              <X :size="16" aria-hidden="true" />
            </button>
          </div>

          <div class="grid gap-5 bg-canvas px-5 py-4 rounded-b-card">
            <div class="ccm-group">
              <ToggleSwitch v-model="settings.keyHints" :label="t('keys.hints')" :hint="t('keys.hintsHint')" class="px-3" />
            </div>
            <section v-for="g in groups" :key="g.id" :aria-labelledby="`keys-${g.id}`">
              <h3 :id="`keys-${g.id}`" class="mb-1.5 px-3 text-2xs font-semibold text-ink-muted">{{ t(`keys.group.${g.id}`) }}</h3>
              <p v-if="g.id === 'workspace'" class="-mt-1 mb-1.5 px-3 text-2xs text-ink-faint">{{ t('keys.workspaceNote') }}</p>
              <dl class="ccm-group">
                <div v-for="s in g.items" :key="s.id" class="flex items-center justify-between gap-4 px-3 py-2 text-sm">
                  <dt class="min-w-0 text-ink">{{ t(`keys.item.${s.id}`) }}</dt>
                  <dd class="flex shrink-0 items-center gap-1">
                    <kbd
                      v-for="(k, i) in formatKeys(s.keys, isMac)"
                      :key="i"
                      class="inline-flex h-5 min-w-5 items-center justify-center rounded-inner bg-fill px-1.5 font-sans text-2xs font-medium text-ink-muted"
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
