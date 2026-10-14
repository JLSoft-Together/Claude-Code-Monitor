<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check } from 'lucide-vue-next'
import { withViewTransition } from '../../lib/motion'
import { THEMES, type ThemeId } from '../../lib/themes'
import { useSettingsStore } from '../../stores/settings'

const { t } = useI18n()
const settings = useSettingsStore()
const root = ref<HTMLElement | null>(null)

const groups = computed(() =>
  (['light', 'dark'] as const).map((mode) => ({ mode, label: t(mode === 'light' ? 'settings.themeLight' : 'settings.themeDark'), themes: THEMES.filter((th) => th.mode === mode) })),
)

function pick(id: ThemeId): void {
  if (id !== settings.theme) withViewTransition(() => settings.setTheme(id))
}

// One radiogroup across both groups: arrows move and select, like any radio set.
function onKey(e: KeyboardEvent, index: number): void {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
  const target = e.key === 'Home' ? 0 : e.key === 'End' ? THEMES.length - 1 : step === undefined ? -1 : (index + step + THEMES.length) % THEMES.length
  if (target < 0) return
  e.preventDefault()
  pick(THEMES[target]!.id)
  root.value?.querySelectorAll<HTMLElement>('[role=radio]')[target]?.focus()
}
</script>

<template>
  <div ref="root" role="radiogroup" :aria-label="t('settings.theme')" class="flex flex-col gap-2.5">
    <div v-for="g in groups" :key="g.mode" role="presentation">
      <p class="mb-1 text-2xs font-semibold text-ink-faint" aria-hidden="true">{{ g.label }}</p>
      <div class="grid grid-cols-2 gap-1.5" role="presentation">
        <button
          v-for="th in g.themes"
          :key="th.id"
          type="button"
          role="radio"
          :aria-checked="settings.theme === th.id"
          :aria-label="`${th.name} · ${g.label}`"
          :tabindex="settings.theme === th.id ? 0 : -1"
          :data-theme-option="th.id"
          class="group flex min-w-0 cursor-pointer items-center gap-2 rounded-inner p-1.5 text-left text-xs transition-colors duration-(--ccm-dur-fast) hover:bg-fill aria-checked:bg-accent-soft aria-checked:text-accent-ink"
          @click="pick(th.id)"
          @keydown="onKey($event, THEMES.indexOf(th))"
        >
          <!-- Preview of the theme itself, so its own colours (data, not this theme's tokens). -->
          <span
            class="relative inline-flex h-7 w-10 shrink-0 overflow-hidden rounded-[5px] shadow-control"
            :style="{ background: th.swatch[0] }"
            aria-hidden="true"
          >
            <span class="absolute top-1 left-1 h-2 w-5 rounded-[2px]" :style="{ background: th.swatch[1] }" />
            <span class="absolute top-1 right-1 size-2 rounded-full" :style="{ background: th.swatch[2] }" />
            <span class="absolute inset-x-1 bottom-1 h-2 rounded-[2px]" :style="{ background: th.swatch[3] }" />
          </span>
          <span class="min-w-0 flex-1 truncate font-medium">{{ th.name }}</span>
          <Check v-if="settings.theme === th.id" :size="14" class="shrink-0" aria-hidden="true" />
        </button>
      </div>
    </div>
  </div>
</template>
