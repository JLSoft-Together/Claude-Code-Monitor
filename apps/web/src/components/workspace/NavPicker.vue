<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bookmark, FileText, Pencil, X } from 'lucide-vue-next'
import { fuzzyScore, highlightRuns } from '../../lib/fuzzy'
import { baseName, dirOf } from '../../lib/preview'
import type { NoteSpot } from '../../lib/navigation'
import { useNavigationStore, type NavTab } from '../../stores/navigation'
import { useWorkspaceStore } from '../../stores/workspace'
import { isMac } from '../../lib/platform'

const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const nav = useNavigationStore()
const workspace = useWorkspaceStore()

const TABS: NavTab[] = ['recent', 'edits', 'bookmarks']
const ICON = { recent: FileText, edits: Pencil, bookmarks: Bookmark }
const tab = ref<NavTab>(nav.picker ?? 'recent')
const query = ref('')
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)
const list = ref<HTMLElement | null>(null)
const box = ref<HTMLElement | null>(null)

interface Row {
  key: string
  name: string
  dir: string
  line?: number
  text?: string
  spot?: NoteSpot
  path: string
  cwd?: string
  positions: number[]
}

const source = computed<Omit<Row, 'positions'>[]>(() => {
  if (tab.value === 'recent') return nav.recent.map((f) => ({ key: f.path, name: baseName(f.path), dir: dirOf(f.path), path: f.path, cwd: f.cwd }))
  const spots = tab.value === 'edits' ? nav.edits : nav.bookmarks
  return spots.map((s) => ({ key: `${s.path}:${s.line}`, name: baseName(s.path), dir: dirOf(s.path), line: s.line, text: s.text, spot: s, path: s.path, cwd: s.cwd }))
})

const rows = computed<Row[]>(() => {
  const q = query.value.trim()
  if (!q) return source.value.map((r) => ({ ...r, positions: [] }))
  const lower = q.toLowerCase()
  return source.value
    .map((r) => ({ r, hit: fuzzyScore(q, r.name) ?? (r.text?.toLowerCase().includes(lower) ? { score: -1, positions: [] } : null) }))
    .filter((x) => x.hit)
    .sort((a, b) => b.hit!.score - a.hit!.score)
    .map((x) => ({ ...x.r, positions: x.hit!.positions }))
})
watch([query, tab], () => (active.value = 0))

function pick(r: Row | undefined): void {
  if (!r) return
  if (r.line) void nav.go({ path: r.path, line: r.line, cwd: r.cwd })
  else workspace.openFile(r.path, undefined, r.cwd ? { cwd: r.cwd } : {})
  emit('close')
}

function cycle(step: 1 | -1): void {
  tab.value = TABS[(TABS.indexOf(tab.value) + step + TABS.length) % TABS.length]!
}

function onKey(e: KeyboardEvent): void {
  const n = rows.value.length
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
  } else if (e.key === 'Tab' || (e.code === 'KeyE' && (isMac ? e.metaKey : e.ctrlKey || (e.altKey && e.shiftKey)))) {
    e.preventDefault()
    e.stopPropagation()
    cycle(e.shiftKey && e.key === 'Tab' ? -1 : 1)
  } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && n) {
    e.preventDefault()
    active.value = (active.value + (e.key === 'ArrowDown' ? 1 : -1) + n) % n
    void nextTick(() => list.value?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }))
  } else if (e.key === 'Enter') {
    e.preventDefault()
    pick(rows.value[active.value])
  } else if (e.key === 'Delete' && tab.value === 'bookmarks' && !query.value) {
    const spot = rows.value[active.value]?.spot
    if (!spot) return
    e.preventDefault()
    nav.removeBookmark(spot)
    active.value = Math.min(active.value, Math.max(0, rows.value.length - 1))
  }
}

const onFocusOut = (e: FocusEvent): void => void (!box.value?.contains(e.relatedTarget as Node | null) && emit('close'))
onMounted(() => input.value?.focus())
</script>

<template>
  <div ref="box" class="ccm-menu fixed top-16 left-1/2 z-50 flex max-h-[min(70vh,480px)] w-[min(calc(100vw-32px),560px)] -translate-x-1/2 flex-col overflow-hidden" role="dialog" :aria-label="t('workspace.nav.title')" data-nav-picker @keydown="onKey" @focusout="onFocusOut">
    <div class="flex shrink-0 items-center gap-1 border-b border-line px-2 py-1.5" role="tablist">
      <button
        v-for="k in TABS"
        :key="k"
        type="button"
        role="tab"
        :aria-selected="tab === k"
        class="flex h-6 items-center gap-1.5 rounded-inner px-2 text-xs"
        :class="tab === k ? 'bg-accent-soft text-accent-ink' : 'text-ink-muted hover:bg-fill'"
        :data-nav-tab="k"
        @mousedown.prevent
        @click="tab = k"
      >
        <component :is="ICON[k]" :size="12" aria-hidden="true" />{{ t(`workspace.nav.tab.${k}`) }}
      </button>
    </div>
    <input
      ref="input"
      v-model="query"
      class="h-9 shrink-0 border-b border-line bg-transparent px-3 text-sm text-ink outline-none placeholder:text-ink-faint"
      :placeholder="t('workspace.nav.search')"
      :aria-label="t('workspace.nav.search')"
      role="combobox"
      aria-controls="nav-rows"
      :aria-expanded="true"
      autocomplete="off"
      spellcheck="false"
      data-nav-search
    />
    <ul id="nav-rows" ref="list" class="ccm-scroll min-h-0 flex-1 overflow-y-auto py-1" role="listbox" :aria-label="t(`workspace.nav.tab.${tab}`)">
      <li
        v-for="(r, i) in rows"
        :key="r.key"
        role="option"
        :aria-selected="i === active"
        class="group mx-1 flex min-h-7 cursor-pointer items-center gap-2 rounded-inner px-2 py-0.5 text-xs"
        :class="i === active ? 'bg-accent-soft text-accent-ink' : 'text-ink hover:bg-fill'"
        :data-nav-row="r.key"
        @mousedown.prevent
        @click="pick(r)"
        @mousemove="active = i"
      >
        <span class="flex min-w-0 flex-1 flex-col">
          <span class="flex min-w-0 items-baseline gap-2">
            <span class="shrink-0 font-medium"><template v-for="(run, k) in highlightRuns(r.name, r.positions)" :key="k"><mark v-if="run.hit" class="bg-transparent font-semibold text-accent-ink">{{ run.text }}</mark><template v-else>{{ run.text }}</template></template><template v-if="r.line">:{{ r.line }}</template></span>
            <span class="min-w-0 flex-1 truncate text-2xs" :class="i === active ? 'text-accent-ink' : 'text-ink-faint'" dir="rtl" :title="r.path"><bdi>{{ r.dir }}</bdi></span>
          </span>
          <span v-if="r.text" class="truncate font-mono text-2xs" :class="i === active ? 'text-accent-ink' : 'text-ink-muted'">{{ r.text }}</span>
        </span>
        <button
          v-if="r.spot && tab === 'bookmarks'"
          type="button"
          class="ccm-btn-plain size-6 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          :title="t('workspace.nav.remove')"
          :aria-label="t('workspace.nav.remove')"
          tabindex="-1"
          @click.stop="nav.removeBookmark(r.spot)"
        >
          <X :size="12" aria-hidden="true" />
        </button>
      </li>
      <li v-if="!rows.length" class="px-3 py-2 text-xs text-ink-faint">{{ source.length ? t('workspace.nav.noMatch') : t(`workspace.nav.empty.${tab}`) }}</li>
    </ul>
    <p class="shrink-0 border-t border-line px-3 py-1 text-2xs text-ink-faint">{{ t('workspace.nav.hint') }}</p>
  </div>
</template>
