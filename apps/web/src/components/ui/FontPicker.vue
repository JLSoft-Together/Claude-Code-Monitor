<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronDown } from 'lucide-vue-next'
import { desktop } from '../../lib/desktop'
import { fontEntry, fontStack, isInstalled, visibleFonts, type FontEntry, type FontKind } from '../../lib/fonts'
import { useSettingsStore } from '../../stores/settings'

const props = defineProps<{ kind: FontKind }>()

const { t } = useI18n()
const settings = useSettingsStore()
const open = ref(false)
const list = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const uid = `font-${props.kind}`

const platform = desktop?.platform ?? (navigator.platform.toLowerCase().startsWith('mac') ? 'darwin' : 'win32')
const fonts = computed(() => visibleFonts(props.kind, platform).map((f) => ({ ...f, ok: isInstalled(f), stack: fontStack(f) })))
const current = computed(() => (props.kind === 'code' ? settings.codeFont : settings.uiFont))
const currentEntry = computed(() => fontEntry(props.kind, current.value))
const label = computed(() => t(props.kind === 'code' ? 'fonts.code' : 'fonts.ui'))
const sample = computed(() => t(props.kind === 'code' ? 'fonts.sampleCode' : 'fonts.sampleUi'))
const nameOf = (f: FontEntry): string => (f.id === 'system' ? t('fonts.system') : f.name)

function select(f: FontEntry & { ok: boolean }): void {
  if (!f.ok) return
  if (props.kind === 'code') settings.setCodeFont(f.id)
  else settings.setUiFont(f.id)
}

async function toggle(): Promise<void> {
  open.value = !open.value
  if (!open.value) return
  await nextTick()
  const items = options()
  ;(items.find((el) => el.getAttribute('aria-selected') === 'true') ?? items[0])?.focus()
}

function close(): void {
  open.value = false
  trigger.value?.focus()
}

const options = (): HTMLElement[] => [...(list.value?.querySelectorAll<HTMLElement>('[role=option]') ?? [])]

// Listbox keys: arrows move focus, Enter / Space choose, letters jump to the next name, Esc closes.
let typed = ''
let typedAt = 0
function onKey(e: KeyboardEvent, index: number): void {
  const items = options()
  let target = -1
  if (e.key === 'ArrowDown') target = Math.min(items.length - 1, index + 1)
  else if (e.key === 'ArrowUp') target = Math.max(0, index - 1)
  else if (e.key === 'Home') target = 0
  else if (e.key === 'End') target = items.length - 1
  else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    select(fonts.value[index]!)
    return
  } else if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    return close()
  } else if (e.key.length === 1 && /\S/.test(e.key)) {
    const at = performance.now()
    typed = at - typedAt < 600 ? typed + e.key.toLowerCase() : e.key.toLowerCase()
    typedAt = at
    const order = [...fonts.value.slice(index + 1), ...fonts.value.slice(0, index + 1)]
    const hit = order.find((f) => nameOf(f).toLowerCase().startsWith(typed))
    target = hit ? fonts.value.indexOf(hit) : -1
  }
  if (target < 0) return
  e.preventDefault()
  items[target]?.focus()
}
</script>

<template>
  <div class="px-3 py-2">
    <div class="flex items-center gap-3">
      <div class="min-w-0 flex-1">
        <p :id="`${uid}-label`" class="text-sm">{{ label }}</p>
        <p class="mt-0.5 text-2xs text-ink-faint">{{ t(kind === 'code' ? 'fonts.codeHint' : 'fonts.uiHint') }}</p>
      </div>
      <button
        ref="trigger"
        type="button"
        class="ccm-btn max-w-[55%] shrink-0"
        :aria-expanded="open"
        :aria-controls="`${uid}-list`"
        :aria-label="`${t('fonts.choose', { what: label })}: ${nameOf(currentEntry)}`"
        :data-font-picker="kind"
        @click="toggle"
      >
        <span class="min-w-0 truncate" :style="{ fontFamily: fontStack(currentEntry) }">{{ nameOf(currentEntry) }}</span>
        <ChevronDown :size="14" class="shrink-0 transition-transform duration-(--ccm-dur-fast)" :class="open ? 'rotate-180' : ''" aria-hidden="true" />
      </button>
    </div>
    <div
      v-if="open"
      :id="`${uid}-list`"
      ref="list"
      role="listbox"
      :aria-labelledby="`${uid}-label`"
      class="ccm-scroll mt-2 max-h-72 overflow-y-auto rounded-inner border border-line bg-surface p-1"
    >
      <div
        v-for="(f, i) in fonts"
        :key="f.id"
        role="option"
        :aria-selected="current === f.id"
        :aria-disabled="!f.ok || undefined"
        :tabindex="-1"
        :data-font-option="f.id"
        class="flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-1.5 outline-none transition-colors duration-(--ccm-dur-fast) hover:bg-fill focus-visible:bg-fill focus-visible:ring-2 focus-visible:ring-focus aria-selected:bg-accent-soft aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
        @click="select(f)"
        @keydown="onKey($event, i)"
      >
        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm" :class="current === f.id ? 'text-accent-ink' : 'text-ink'" :style="{ fontFamily: f.stack }">{{ nameOf(f) }}</span>
          <span class="ccm-no-liga block truncate text-xs text-ink-muted" :style="{ fontFamily: f.stack }">{{ sample }}</span>
        </span>
        <span v-if="!f.ok" class="shrink-0 text-2xs text-ink-faint">{{ t('fonts.notInstalled') }}</span>
        <Check v-else-if="current === f.id" :size="14" class="shrink-0 text-accent-ink" aria-hidden="true" />
      </div>
    </div>
  </div>
</template>
