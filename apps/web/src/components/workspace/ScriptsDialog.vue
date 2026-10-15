<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Play } from 'lucide-vue-next'
import { fuzzyScore, highlightRuns } from '../../lib/fuzzy'
import { retireOverlay } from '../../lib/motion'
import { isMac } from '../../lib/platform'
import { folderName } from '../../lib/sidebarRows'
import { recentScripts, scriptsIn, type ScriptGroup, type ScriptItem } from '../../lib/projects'
import { dirKey } from '../../stores/favorites'

/** `dirs`: pane's current folder first, then its project root; each is read once per opening. */
/** `returnTo`: where focus goes back when the opener (Quick open) is gone by then. */
const props = defineProps<{ open: boolean; dirs: string[]; query?: string; returnTo?: HTMLElement | null }>()
const emit = defineEmits<{ close: []; run: [target: { dir: string; run: string; split: boolean }]; focusLost: [] }>()

const { t } = useI18n()

interface Entry {
  id: string
  dir: string
  group: ScriptGroup
  item: ScriptItem
}

const query = ref('')
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLElement | null>(null)
const entries = ref<Entry[]>([])
const state = ref<'idle' | 'loading'>('idle')
const recent = ref<string[]>([])
let restoreFocus: HTMLElement | null = null
let seq = 0

const uniqueDirs = computed(() => {
  const seen = new Set<string>()
  return props.dirs.filter((d) => {
    const k = dirKey(d)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
})

async function load(): Promise<void> {
  const run = ++seq
  entries.value = []
  if (!uniqueDirs.value.length) return
  state.value = 'loading'
  const results = await Promise.all(uniqueDirs.value.map((d) => scriptsIn(d)))
  if (run !== seq) return
  const seen = new Set<string>()
  const list: Entry[] = []
  for (const res of results) {
    if (!res || seen.has(dirKey(res.dir))) continue
    seen.add(dirKey(res.dir))
    for (const group of res.groups) for (const item of group.items) list.push({ id: `${res.dir}|${group.source}|${item.name}`, dir: res.dir, group, item })
  }
  recent.value = [...new Set(list.map((e) => e.dir))].flatMap((d) => recentScripts(d).map((r) => `${dirKey(d)}|${r}`))
  entries.value = list
  state.value = 'idle'
}

const recentRank = computed(() => new Map(recent.value.map((r, i) => [r, i])))
const rankOf = (e: Entry): number | undefined => recentRank.value.get(`${dirKey(e.dir)}|${e.item.run}`)

interface Row {
  entry: Entry
  index: number
  name: { text: string; hit: boolean }[]
  recent: boolean
}

const rows = computed<Row[]>(() => {
  const q = query.value.trim()
  const scored = entries.value
    .map((entry) => {
      const r = rankOf(entry)
      if (!q) return { entry, score: r === undefined ? -1 : 100 - r, positions: [] as number[] }
      const res = fuzzyScore(q, entry.item.name)
      return res ? { entry, score: res.score + (r === undefined ? 0 : 6 - Math.min(r, 5)), positions: res.positions } : null
    })
    .filter((x): x is { entry: Entry; score: number; positions: number[] } => !!x)
  // Stable sort keeps file order (package.json, Makefile, …) among equal scores.
  if (q || recent.value.length) scored.sort((a, b) => b.score - a.score)
  return scored.map((s, index) => ({ entry: s.entry, index, name: highlightRuns(s.entry.item.name, s.positions), recent: !q && rankOf(s.entry) !== undefined }))
})

/** Group header shown above the first row of each source while the list keeps file order. */
function heading(row: Row): string | null {
  if (query.value.trim()) return null
  const prev = rows.value[row.index - 1]
  if (row.recent) return row.index === 0 ? t('workspace.scripts.recent') : null
  if (prev && !prev.recent && prev.entry.group === row.entry.group) return null
  return groupLabel(row.entry)
}

function groupLabel(e: Entry): string {
  const runner = e.group.source === e.group.file.replace(/\..*$/, '').toLowerCase() ? '' : ` · ${e.group.source}`
  const where = uniqueDirs.value.length > 1 ? ` · ${t('workspace.scripts.inDir', { dir: folderName(e.dir) })}` : ''
  return `${e.group.file}${runner}${where}`
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      restoreFocus = props.returnTo ?? (document.activeElement as HTMLElement | null)
      query.value = props.query ?? ''
      active.value = 0
      void load()
      await nextTick()
      input.value?.focus()
    } else {
      seq++
      if (restoreFocus?.isConnected && restoreFocus.getClientRects().length) restoreFocus.focus()
      else emit('focusLost')
      restoreFocus = null
    }
  },
  { immediate: true },
)

watch(query, () => (active.value = 0))
// The project root arrives a moment after the pane folder.
watch(
  () => uniqueDirs.value.map(dirKey).join('|'),
  (now, before) => {
    if (props.open && before !== undefined && now !== before) void load()
  },
)

function choose(row: Row | undefined, split: boolean): void {
  if (!row) return
  emit('run', { dir: row.entry.dir, run: row.entry.item.run, split })
  emit('close')
}

function move(delta: number): void {
  const n = rows.value.length
  if (!n) return
  active.value = (active.value + delta + n) % n
  void nextTick(() => listEl.value?.querySelector(`[data-index="${active.value}"]`)?.scrollIntoView({ block: 'nearest' }))
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    move(e.key === 'ArrowDown' ? 1 : -1)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    choose(rows.value[active.value], isMac ? e.metaKey : e.ctrlKey)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    if (query.value) query.value = ''
    else emit('close')
  }
}

const activeId = computed(() => (rows.value[active.value] ? `sc-opt-${active.value}` : undefined))
const HINTS = computed(() => [
  { key: 'move', keys: '↑ ↓' },
  { key: 'run', keys: 'Enter' },
  { key: 'split', keys: isMac ? '⌘↩' : 'Ctrl+Enter' },
  { key: 'close', keys: 'Esc' },
])
</script>

<template>
  <Teleport to="body">
    <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div v-if="open" class="ccm-scrim fixed inset-0 z-50 flex items-start justify-center px-3 pt-[8vh] sm:px-4 sm:pt-[12vh]" @mousedown.self="emit('close')">
        <div role="dialog" aria-modal="true" :aria-label="t('workspace.scripts.title')" class="ccm-sheet flex max-h-[min(72vh,560px)] w-full max-w-[560px] flex-col overflow-hidden" data-scripts-dialog>
          <div class="flex items-center gap-3 border-b border-line px-4">
            <Play :size="16" class="shrink-0 text-ink-muted" aria-hidden="true" />
            <input
              ref="input"
              v-model="query"
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls="sc-list"
              aria-autocomplete="list"
              :aria-activedescendant="activeId"
              :aria-label="t('workspace.scripts.title')"
              :placeholder="t('workspace.scripts.placeholder')"
              class="ccm-bare-input h-12 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
              autocomplete="off"
              spellcheck="false"
              @keydown="onKey"
            />
          </div>

          <div id="sc-list" ref="listEl" role="listbox" :aria-label="t('workspace.scripts.title')" class="ccm-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
            <p v-if="!uniqueDirs.length" class="px-3 py-8 text-center text-sm text-ink-muted">{{ t('workspace.scripts.noDir') }}</p>
            <p v-else-if="state === 'loading'" class="px-3 py-8 text-center text-sm text-ink-muted" role="status">{{ t('workspace.scripts.loading') }}</p>
            <p v-else-if="!entries.length" class="px-3 py-8 text-center text-sm text-ink-muted">{{ t('workspace.scripts.none') }}</p>
            <p v-else-if="!rows.length" class="px-3 py-8 text-center text-sm text-ink-muted">{{ t('workspace.scripts.empty') }}</p>
            <template v-else>
              <template v-for="row in rows" :key="row.entry.id">
                <p v-if="heading(row)" class="truncate px-2.5 pt-2 pb-1 text-2xs font-medium text-ink-faint first:pt-1" aria-hidden="true">{{ heading(row) }}</p>
                <div
                  :id="`sc-opt-${row.index}`"
                  role="option"
                  :data-index="row.index"
                  :data-script="row.entry.item.name"
                  :aria-selected="row.index === active"
                  class="flex h-9 cursor-pointer items-center gap-3 rounded-inner px-2.5 text-sm"
                  :class="row.index === active ? 'bg-accent text-on-accent' : 'text-ink'"
                  :title="row.entry.item.detail ? `${row.entry.item.run}\n${row.entry.item.detail}` : row.entry.item.run"
                  @mousemove="active = row.index"
                  @click="choose(row, isMac ? $event.metaKey : $event.ctrlKey)"
                >
                  <span class="shrink-0 truncate font-medium"
                    ><template v-for="(p, i) in row.name" :key="i"
                      ><mark v-if="p.hit" class="bg-transparent font-semibold" :class="row.index === active ? 'text-on-accent' : 'text-accent-ink'">{{ p.text }}</mark
                      ><template v-else>{{ p.text }}</template></template
                    ></span
                  >
                  <span class="min-w-0 flex-1 truncate font-mono text-xs" :class="row.index === active ? 'text-on-accent' : 'text-ink-faint'">{{ row.entry.item.detail ?? row.entry.item.run }}</span>
                </div>
              </template>
            </template>
          </div>

          <div class="hidden items-center gap-x-4 border-t border-line px-4 py-2.5 text-2xs text-ink-faint sm:flex">
            <span v-for="h in HINTS" :key="h.key" class="inline-flex items-center gap-1.5">
              <kbd class="rounded-inner bg-fill px-1.5 py-px font-sans text-ink-muted">{{ h.keys }}</kbd>{{ t(`workspace.scripts.hints.${h.key}`) }}
            </span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
