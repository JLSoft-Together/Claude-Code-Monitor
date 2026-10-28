<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { Box, Braces, Hash, Heading, KeyRound, Shapes, SquareFunction } from 'lucide-vue-next'
import { fuzzyScore, highlightRuns } from '../../lib/fuzzy'
import type { OutlineItem, SymbolKind } from '../../lib/editor/outline'

const props = defineProps<{ items: readonly OutlineItem[] | null }>()
const emit = defineEmits<{ pick: [line: number]; close: [] }>()
const { t } = useI18n()

const ICON: Record<SymbolKind, Component> = { class: Box, function: SquareFunction, method: Braces, type: Shapes, heading: Heading, key: KeyRound, selector: Hash }
const query = ref('')
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)
const list = ref<HTMLElement | null>(null)
const box = ref<HTMLElement | null>(null)
const onFocusOut = (e: FocusEvent): void => void (!box.value?.contains(e.relatedTarget as Node | null) && emit('close'))

const rows = computed(() => {
  const all = props.items ?? []
  const q = query.value.trim()
  if (!q) return all.map((item) => ({ item, positions: [] as number[] }))
  return all
    .map((item) => ({ item, hit: fuzzyScore(q, item.name) }))
    .filter((x) => x.hit)
    .sort((a, b) => b.hit!.score - a.hit!.score || a.item.line - b.item.line)
    .map((x) => ({ item: x.item, positions: x.hit!.positions }))
})
watch(query, () => (active.value = 0))

function onKey(e: KeyboardEvent): void {
  const n = rows.value.length
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
  } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n) {
    e.preventDefault()
    active.value = (active.value + (e.key === 'ArrowDown' ? 1 : -1) + n) % n
    void nextTick(() => list.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }))
  } else if (e.key === 'Enter') {
    e.preventDefault()
    const row = rows.value[active.value]
    if (row) emit('pick', row.item.line)
  }
}

onMounted(() => input.value?.focus())
</script>

<template>
  <div class="ccm-menu absolute top-10 left-1/2 z-30 flex max-h-[min(60%,420px)] w-[min(92%,460px)] -translate-x-1/2 flex-col overflow-hidden" role="dialog" :aria-label="t('workspace.outline.title')" data-outline @keydown="onKey" ref="box" @focusout="onFocusOut">
    <input
      ref="input"
      v-model="query"
      class="h-9 shrink-0 border-b border-line bg-transparent px-3 text-sm text-ink outline-none placeholder:text-ink-faint"
      :placeholder="t('workspace.outline.search')"
      :aria-label="t('workspace.outline.search')"
      role="combobox"
      aria-controls="outline-rows"
      :aria-expanded="true"
      autocomplete="off"
      spellcheck="false"
      data-outline-search
    />
    <ul id="outline-rows" ref="list" class="ccm-scroll min-h-0 flex-1 overflow-y-auto py-1" role="listbox" :aria-label="t('workspace.outline.title')">
      <li
        v-for="(r, i) in rows"
        :key="`${r.item.line}:${r.item.name}`"
        role="option"
        :aria-selected="i === active"
        class="mx-1 flex h-7 cursor-pointer items-center gap-2 rounded-inner pr-2 text-xs"
        :class="i === active ? 'bg-accent-soft text-accent-ink' : 'text-ink hover:bg-fill'"
        :style="{ paddingLeft: `${8 + (query ? 0 : Math.min(r.item.depth, 6) * 12)}px` }"
        :data-outline-row="r.item.name"
        @mousedown.prevent
        @click="emit('pick', r.item.line)"
        @mousemove="active = i"
      >
        <component :is="ICON[r.item.kind]" :size="13" class="shrink-0 opacity-70" :aria-label="t(`workspace.outline.kind.${r.item.kind}`)" />
        <span class="min-w-0 flex-1 truncate font-mono"><template v-for="(run, k) in highlightRuns(r.item.name, r.positions)" :key="k"><mark v-if="run.hit" class="bg-transparent font-semibold text-accent-ink">{{ run.text }}</mark><template v-else>{{ run.text }}</template></template></span>
        <span class="shrink-0 text-2xs tabular" :class="i === active ? 'text-accent-ink' : 'text-ink-faint'">{{ r.item.line }}</span>
      </li>
      <li v-if="!rows.length" class="px-3 py-2 text-xs text-ink-faint">{{ items === null ? t('workspace.outline.unsupported') : items.length ? t('workspace.outline.noMatch') : t('workspace.outline.empty') }}</li>
    </ul>
    <p class="shrink-0 border-t border-line px-3 py-1 text-2xs text-ink-faint">{{ t('workspace.outline.hint') }}</p>
  </div>
</template>
