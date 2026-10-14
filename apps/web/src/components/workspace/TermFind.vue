<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CaseSensitive, ChevronDown, ChevronUp, Regex, X } from 'lucide-vue-next'
import type { ISearchOptions, SearchAddon } from '@xterm/addon-search'
import { isMac } from '../../lib/platform'

const props = defineProps<{ addon: SearchAddon | null }>()
const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()
const HIGHLIGHT_LIMIT = 1000
const query = ref('')
const caseSensitive = ref(false)
const regex = ref(false)
const result = ref<{ index: number; count: number } | null>(null)
const invalid = ref(false)
const input = ref<HTMLInputElement | null>(null)
let sub: { dispose: () => void } | null = null

/** xterm decorations take #RRGGBB only; tokens are read from the live theme. */
function hexVar(name: string): string | null {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return /^#[0-9a-f]{6}$/i.test(v) ? v : null
}

function options(incremental: boolean): ISearchOptions {
  const match = hexVar('--ccm-well-selection')
  const active = hexVar('--ccm-ansi-3')
  const decorations =
    match && active ? { matchBackground: match, matchOverviewRuler: match, activeMatchBackground: active, activeMatchColorOverviewRuler: active, activeMatchBorder: active } : undefined
  return { caseSensitive: caseSensitive.value, regex: regex.value, incremental, decorations }
}

function validRegex(): boolean {
  if (!regex.value) return true
  try {
    new RegExp(query.value)
    return true
  } catch {
    return false
  }
}

function find(dir: 1 | -1, incremental = false): void {
  const addon = props.addon
  if (!addon) return
  invalid.value = !validRegex()
  if (!query.value || invalid.value) {
    addon.clearDecorations()
    result.value = null
    return
  }
  try {
    const found = dir === 1 ? addon.findNext(query.value, options(incremental)) : addon.findPrevious(query.value, options(false))
    if (!found) result.value = { index: -1, count: 0 }
  } catch {
    result.value = { index: -1, count: 0 }
  }
}

watch([query, caseSensitive, regex], () => find(1, true))

watch(
  () => props.addon,
  (addon) => {
    sub?.dispose()
    sub = addon?.onDidChangeResults((e) => (result.value = { index: e.resultIndex, count: e.resultCount })) ?? null
  },
  { immediate: true },
)

const status = computed(() => {
  const r = result.value
  if (!query.value || !r) return ''
  if (!r.count) return t('workspace.termFind.none')
  const current = r.index >= 0 ? r.index + 1 : '–'
  return r.count >= HIGHLIGHT_LIMIT ? t('workspace.termFind.countMany', { current, total: HIGHLIGHT_LIMIT }) : t('workspace.termFind.count', { current, total: r.count })
})

function close(): void {
  props.addon?.clearDecorations()
  emit('close')
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    e.preventDefault()
    find(e.shiftKey ? -1 : 1)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    close()
  } else if ((isMac ? e.metaKey : e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault()
    input.value?.select()
  }
}

function focus(): void {
  input.value?.focus()
  input.value?.select()
}

defineExpose({ focus })

onMounted(async () => {
  await nextTick()
  focus()
})

onBeforeUnmount(() => {
  sub?.dispose()
  props.addon?.clearDecorations()
})

const toggleClass = 'ccm-btn-plain shrink-0 min-h-6 min-w-6 px-1'
</script>

<template>
  <div class="ccm-material-pop flex h-8 min-w-0 items-center gap-0.5 rounded-control px-1 shadow-pop" role="search" :aria-label="t('workspace.termFind.label')" @keydown="onKey">
    <input
      ref="input"
      v-model="query"
      type="text"
      spellcheck="false"
      autocomplete="off"
      class="ccm-field h-6 w-40 min-w-0 flex-1 font-mono"
      :class="invalid ? 'text-st-error' : ''"
      :placeholder="t('workspace.termFind.placeholder')"
      :aria-label="t('workspace.termFind.label')"
      :aria-invalid="invalid"
    />
    <button
      type="button"
      :class="toggleClass"
      :aria-pressed="caseSensitive"
      :title="t('workspace.termFind.caseSensitive')"
      :aria-label="t('workspace.termFind.caseSensitive')"
      @click="caseSensitive = !caseSensitive"
    >
      <CaseSensitive :size="14" aria-hidden="true" />
    </button>
    <button type="button" :class="toggleClass" :aria-pressed="regex" :title="t('workspace.termFind.regex')" :aria-label="t('workspace.termFind.regex')" @click="regex = !regex">
      <Regex :size="14" aria-hidden="true" />
    </button>
    <span class="w-16 shrink-0 text-center text-2xs tabular text-ink-muted" aria-live="polite">{{ status }}</span>
    <button type="button" :class="toggleClass" :disabled="!result?.count" :title="t('workspace.termFind.prev')" :aria-label="t('workspace.termFind.prev')" @click="find(-1)">
      <ChevronUp :size="14" aria-hidden="true" />
    </button>
    <button type="button" :class="toggleClass" :disabled="!result?.count" :title="t('workspace.termFind.next')" :aria-label="t('workspace.termFind.next')" @click="find(1)">
      <ChevronDown :size="14" aria-hidden="true" />
    </button>
    <button type="button" :class="toggleClass" :title="t('workspace.termFind.close')" :aria-label="t('workspace.termFind.close')" @click="close">
      <X :size="14" aria-hidden="true" />
    </button>
  </div>
</template>
