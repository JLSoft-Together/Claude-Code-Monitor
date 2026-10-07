<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bell, BellOff, Check, Copy, Settings2 } from 'lucide-vue-next'
import { playChime } from '../lib/sound'
import { useExtrasStore } from '../stores/extras'
import { STUCK_CHOICES, useSettingsStore, type Palette } from '../stores/settings'
import LottieArt from './LottieArt.vue'

const { t } = useI18n()
const settings = useSettingsStore()
const extras = useExtrasStore()
const open = ref(false)
const root = ref<HTMLElement | null>(null)

const palettes = computed<{ id: Palette; label: string; swatch: string[] }[]>(() => [
  { id: 'ember', label: t('settings.paletteEmber'), swatch: ['ember-1', 'ember-2', 'ember-3'] },
  { id: 'cobalt', label: t('settings.paletteCobalt'), swatch: ['cobalt-1', 'cobalt-2', 'cobalt-3'] },
])

const stuckOptions = computed(() => STUCK_CHOICES.map((m) => ({ value: m, label: m ? t('settings.minutes', { n: m }) : t('settings.off') })))

function toggleSound(): void {
  settings.sound = !settings.sound
  // The click is the user gesture that unlocks audio; the preview confirms the volume.
  if (settings.sound) playChime('waiting')
}

const snippet = computed(() =>
  extras.statusLineCommand ? JSON.stringify({ statusLine: { type: 'command', command: extras.statusLineCommand } }, null, 2) : '',
)
const copied = ref(false)
async function copySnippet(): Promise<void> {
  try {
    await navigator.clipboard.writeText(snippet.value)
    copied.value = true
    window.setTimeout(() => (copied.value = false), 1500)
  } catch {
    copied.value = false
  }
}

const blocked = computed(() => settings.notifyPermission === 'denied')
const unsupported = computed(() => settings.notifyPermission === 'unsupported')
const bellLabel = computed(() => (settings.notifyEnabled ? t('settings.notifyOff') : t('settings.notifyOn')))

function onDocClick(e: MouseEvent): void {
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') open.value = false
}

watch(open, (value) => {
  if (value) {
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
  } else {
    document.removeEventListener('mousedown', onDocClick)
    document.removeEventListener('keydown', onKey)
  }
})
onBeforeUnmount(() => (open.value = false))

const ringing = ref(0)
let ringTimer: number | undefined
watch(
  () => settings.notifyEnabled,
  (on) => {
    window.clearTimeout(ringTimer)
    if (!on) return void (ringing.value = 0)
    ringing.value++
    ringTimer = window.setTimeout(() => (ringing.value = 0), 900)
  },
)
onBeforeUnmount(() => window.clearTimeout(ringTimer))
</script>

<template>
  <button
    type="button"
    class="relative inline-flex size-10 cursor-pointer items-center justify-center rounded-lg transition-colors hover:bg-raised"
    :class="settings.notifyEnabled ? 'text-accent' : 'text-ink-muted hover:text-ink'"
    :aria-label="bellLabel"
    :aria-pressed="settings.notifyEnabled"
    :title="blocked ? t('settings.notifyBlocked') : bellLabel"
    :disabled="unsupported"
    @click="settings.toggleNotifications()"
  >
    <LottieArt v-if="ringing" name="notification-bell" :play-key="ringing" class="size-6" />
    <Bell v-else-if="settings.notifyEnabled" :size="18" aria-hidden="true" />
    <BellOff v-else :size="18" aria-hidden="true" />
  </button>

  <div ref="root" class="relative">
    <button
      type="button"
      class="inline-flex size-10 cursor-pointer items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-raised hover:text-ink"
      :aria-label="t('settings.title')"
      :title="t('settings.title')"
      :aria-expanded="open"
      aria-controls="settings-panel"
      @click="open = !open"
    >
      <Settings2 :size="18" aria-hidden="true" />
    </button>
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 -translate-y-1 scale-[0.98]"
      leave-active-class="transition duration-100 ease-in"
      leave-to-class="opacity-0 -translate-y-1"
    >
      <div
        v-if="open"
        id="settings-panel"
        class="absolute right-0 z-40 mt-2 max-h-[calc(100dvh-6rem)] w-[min(340px,calc(100vw-2rem))] origin-top-right overflow-y-auto rounded-xl border border-line bg-surface p-4 text-sm shadow-lg"
      >
        <fieldset>
          <legend class="mb-2 font-semibold">{{ t('settings.palette') }}</legend>
          <div class="grid grid-cols-2 gap-2">
            <label
              v-for="p in palettes"
              :key="p.id"
              class="flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
              :class="settings.palette === p.id ? 'border-accent bg-accent-soft' : 'border-line hover:border-line-strong'"
            >
              <input v-model="settings.palette" type="radio" name="palette" :value="p.id" class="sr-only" />
              <span class="flex -space-x-1" aria-hidden="true">
                <span v-for="c in p.swatch" :key="c" class="size-4 rounded-full border border-line" :style="{ background: `var(--ccm-swatch-${c})` }" />
              </span>
              <span class="min-w-0 flex-1 truncate">{{ p.label }}</span>
              <Check v-if="settings.palette === p.id" :size="15" class="text-accent" aria-hidden="true" />
            </label>
          </div>
        </fieldset>

        <div class="my-4 border-t border-line" aria-hidden="true" />
        <fieldset>
          <legend class="mb-2 font-semibold">{{ t('settings.notifications') }}</legend>
          <label class="flex cursor-pointer items-center justify-between gap-3 py-1">
            <span>{{ t('settings.notifyEnable') }}</span>
            <input
              type="checkbox"
              class="size-4 cursor-pointer accent-[var(--ccm-accent)]"
              :checked="settings.notifyEnabled"
              :disabled="unsupported"
              @change="settings.toggleNotifications()"
            />
          </label>
          <label class="flex cursor-pointer items-center justify-between gap-3 py-1" :class="settings.notifyEnabled ? '' : 'opacity-60'">
            <span>{{ t('settings.notifyWaiting') }}</span>
            <input v-model="settings.notifyWaiting" type="checkbox" class="size-4 cursor-pointer accent-[var(--ccm-accent)]" />
          </label>
          <label class="flex cursor-pointer items-center justify-between gap-3 py-1" :class="settings.notifyEnabled ? '' : 'opacity-60'">
            <span>{{ t('settings.notifyDone') }}</span>
            <input v-model="settings.notifyDone" type="checkbox" class="size-4 cursor-pointer accent-[var(--ccm-accent)]" />
          </label>
          <label class="flex cursor-pointer items-center justify-between gap-3 py-1" :class="settings.notifyEnabled ? '' : 'opacity-60'">
            <span>{{ t('settings.notifyContext') }}</span>
            <input v-model="settings.notifyContext" type="checkbox" class="size-4 cursor-pointer accent-[var(--ccm-accent)]" />
          </label>
          <label class="flex cursor-pointer items-center justify-between gap-3 py-1" :class="settings.notifyEnabled ? '' : 'opacity-60'">
            <span>{{ t('settings.notifyStuck') }}</span>
            <input v-model="settings.notifyStuck" type="checkbox" class="size-4 cursor-pointer accent-[var(--ccm-accent)]" />
          </label>
          <label class="flex cursor-pointer items-center justify-between gap-3 py-1" :class="settings.notifyEnabled ? '' : 'opacity-60'">
            <span>{{ t('settings.notifyLoop') }}</span>
            <input v-model="settings.notifyLoop" type="checkbox" class="size-4 cursor-pointer accent-[var(--ccm-accent)]" />
          </label>
          <label class="flex cursor-pointer items-center justify-between gap-3 py-1" :class="settings.notifyEnabled ? '' : 'opacity-60'">
            <span>{{ t('settings.notifyLimit') }}</span>
            <input v-model="settings.notifyLimit" type="checkbox" class="size-4 cursor-pointer accent-[var(--ccm-accent)]" />
          </label>
          <p class="mt-2 text-xs text-ink-faint">
            {{ unsupported ? t('settings.notifyUnsupported') : blocked ? t('settings.notifyBlocked') : t('settings.notifyHint') }}
          </p>
          <label class="mt-3 flex cursor-pointer items-center justify-between gap-3 py-1">
            <span>{{ t('settings.sound') }}</span>
            <input type="checkbox" class="size-4 cursor-pointer accent-[var(--ccm-accent)]" :checked="settings.sound" @change="toggleSound" />
          </label>
          <p class="text-xs text-ink-faint">{{ t('settings.soundHint') }}</p>
        </fieldset>

        <div class="my-4 border-t border-line" aria-hidden="true" />
        <fieldset>
          <legend class="mb-1 font-semibold">{{ t('settings.stuck') }}</legend>
          <p class="mb-2 text-xs text-ink-faint">{{ t('settings.stuckHint') }}</p>
          <div class="grid grid-cols-5 gap-1">
            <label
              v-for="o in stuckOptions"
              :key="o.value"
              class="flex h-8 cursor-pointer items-center justify-center rounded-lg border text-xs transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent"
              :class="settings.stuckMinutes === o.value ? 'border-accent bg-accent-soft font-semibold text-accent' : 'border-line hover:border-line-strong'"
            >
              <input v-model="settings.stuckMinutes" type="radio" name="stuck" :value="o.value" class="sr-only" />{{ o.label }}
            </label>
          </div>
        </fieldset>

        <div class="my-4 border-t border-line" aria-hidden="true" />
        <fieldset>
          <legend class="mb-1 font-semibold">{{ t('settings.budget') }}</legend>
          <p class="mb-2 text-xs text-ink-faint">{{ t('settings.budgetHint') }}</p>
          <label class="flex items-center gap-2">
            <span class="text-ink-muted">$</span>
            <input
              :value="settings.dailyBudget || ''"
              type="number"
              min="0"
              step="1"
              inputmode="decimal"
              :placeholder="t('settings.off')"
              :aria-label="t('settings.budget')"
              class="h-9 w-28 rounded-lg border border-line bg-canvas px-2.5 text-sm tabular outline-none focus:border-accent"
              @change="settings.dailyBudget = Math.max(0, Number(($event.target as HTMLInputElement).value) || 0)"
            />
            <span class="text-xs text-ink-faint">{{ t('settings.perDay') }}</span>
          </label>
        </fieldset>

        <template v-if="snippet">
          <div class="my-4 border-t border-line" aria-hidden="true" />
          <section aria-labelledby="limits-setup-title">
            <h3 id="limits-setup-title" class="mb-1 font-semibold">{{ t('limits.setupTitle') }}</h3>
            <p class="mb-2 text-xs text-ink-muted">{{ extras.limits ? t('limits.setupActive') : t('limits.setupHint') }}</p>
            <pre class="max-h-32 overflow-auto rounded-lg border border-line bg-canvas p-2 font-mono text-2xs whitespace-pre-wrap break-all text-ink-muted">{{ snippet }}</pre>
            <div class="mt-2 flex items-center gap-2">
              <button
                type="button"
                class="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-medium transition-colors hover:border-accent hover:text-accent"
                @click="copySnippet"
              >
                <Check v-if="copied" :size="14" class="ccm-pop text-st-done" aria-hidden="true" /><Copy v-else :size="14" aria-hidden="true" />{{ copied ? t('limits.copied') : t('limits.copy') }}
              </button>
              <span class="text-2xs text-ink-faint">{{ t('limits.chainHint') }}</span>
            </div>
          </section>
        </template>
      </div>
    </Transition>
  </div>
</template>
