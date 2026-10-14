<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FileText, Search } from 'lucide-vue-next'
import { fuzzyFilter, highlightRuns, parseQuickOpen, type FuzzyHit } from '../../lib/fuzzy'
import { retireOverlay } from '../../lib/motion'
import { isMac } from '../../lib/platform'
import { listFiles, type FileList } from '../../lib/preview'

const props = defineProps<{ open: boolean; root: string | null }>()
const emit = defineEmits<{ close: []; open: [target: { path: string; line?: number; split: boolean }] }>()

const { t } = useI18n()
const RECENT_KEY = 'ccm.workspace.quickOpenRecent'
const RECENT_MAX = 20
const LIMIT = 200

const query = ref('')
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)
const listEl = ref<HTMLElement | null>(null)
const files = shallowRef<FileList | null>(null)
const state = ref<'idle' | 'loading' | 'failed'>('idle')
let restoreFocus: HTMLElement | null = null
let seq = 0

const keyOf = (root: string): string => (isMac || /^[A-Za-z]:/.test(root) ? root.toLowerCase() : root).replace(/[\\/]+$/, '')

function readRecent(): Record<string, string[]> {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '{}') as unknown
    return v && typeof v === 'object' ? (v as Record<string, string[]>) : {}
  } catch {
    return {}
  }
}

const recent = ref<string[]>([])

function remember(root: string, rel: string): void {
  const all = readRecent()
  const key = keyOf(root)
  const list = [rel, ...(Array.isArray(all[key]) ? all[key]! : []).filter((r) => r !== rel)].slice(0, RECENT_MAX)
  delete all[key]
  const next = { [key]: list, ...all }
  for (const k of Object.keys(next).slice(RECENT_MAX)) delete next[k]
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // storage unavailable
  }
}

const parsed = computed(() => parseQuickOpen(query.value))
const hits = computed<FuzzyHit[]>(() => (files.value ? fuzzyFilter(files.value.files, parsed.value.query, { limit: LIMIT, recent: recent.value }) : []))
const recentCount = computed(() => {
  if (parsed.value.query || !files.value) return 0
  const known = new Set(files.value.files)
  return recent.value.filter((r) => known.has(r)).length
})

async function load(): Promise<void> {
  const run = ++seq
  const root = props.root
  files.value = null
  if (!root) return
  state.value = 'loading'
  recent.value = readRecent()[keyOf(root)] ?? []
  const res = await listFiles(root)
  if (run !== seq) return
  files.value = res
  state.value = res ? 'idle' : 'failed'
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      restoreFocus = document.activeElement as HTMLElement | null
      query.value = ''
      active.value = 0
      void load()
      await nextTick()
      input.value?.focus()
    } else {
      seq++
      if (restoreFocus?.isConnected) restoreFocus.focus()
      restoreFocus = null
    }
  },
  { immediate: true },
)

watch(query, () => (active.value = 0))

const joinRoot = (root: string, rel: string): string => {
  const sep = root.includes('\\') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${sep}${rel.split('/').join(sep)}`
}

function choose(hit: FuzzyHit | undefined, split: boolean): void {
  const list = files.value
  if (!hit || !list) return
  remember(list.root, hit.item)
  emit('open', { path: joinRoot(list.root, hit.item), line: parsed.value.line, split })
  emit('close')
}

function move(delta: number): void {
  const n = hits.value.length
  if (!n) return
  active.value = (active.value + delta + n) % n
  void nextTick(() => listEl.value?.querySelector(`[data-index="${active.value}"]`)?.scrollIntoView({ block: 'nearest' }))
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    move(e.key === 'ArrowDown' ? 1 : -1)
  } else if (e.key === 'PageDown' || e.key === 'PageUp') {
    e.preventDefault()
    move(e.key === 'PageDown' ? 8 : -8)
  } else if (e.key === 'Enter') {
    e.preventDefault()
    choose(hits.value[active.value], isMac ? e.metaKey : e.ctrlKey)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    if (query.value) query.value = ''
    else emit('close')
  }
}

interface Row {
  hit: FuzzyHit
  index: number
  name: { text: string; hit: boolean }[]
  dir: { text: string; hit: boolean }[]
}

const rows = computed<Row[]>(() =>
  hits.value.map((hit, index) => {
    const cut = hit.item.lastIndexOf('/') + 1
    const name = hit.item.slice(cut)
    const dir = cut ? hit.item.slice(0, cut - 1) : ''
    return {
      hit,
      index,
      name: highlightRuns(name, hit.positions.filter((p) => p >= cut).map((p) => p - cut)),
      dir: highlightRuns(dir, hit.positions.filter((p) => p < cut - 1)),
    }
  }),
)

const activeId = computed(() => (hits.value[active.value] ? `qo-opt-${active.value}` : undefined))
const HINTS = computed(() => [
  { key: 'move', keys: '↑ ↓' },
  { key: 'open', keys: 'Enter' },
  { key: 'split', keys: isMac ? '⌘ Enter' : 'Ctrl+Enter' },
  { key: 'close', keys: 'Esc' },
])
</script>

<template>
  <Teleport to="body">
    <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div v-if="open" class="ccm-scrim fixed inset-0 z-50 flex items-start justify-center px-3 pt-[8vh] sm:px-4 sm:pt-[12vh]" @mousedown.self="emit('close')">
        <div role="dialog" aria-modal="true" :aria-label="t('workspace.quickOpen.title')" class="ccm-sheet flex max-h-[min(72vh,560px)] w-full max-w-[600px] flex-col overflow-hidden">
          <div class="flex items-center gap-3 border-b border-line px-4">
            <Search :size="17" class="shrink-0 text-ink-muted" aria-hidden="true" />
            <input
              ref="input"
              v-model="query"
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls="qo-list"
              aria-autocomplete="list"
              :aria-activedescendant="activeId"
              :aria-label="t('workspace.quickOpen.title')"
              :placeholder="t('workspace.quickOpen.placeholder')"
              class="ccm-bare-input h-12 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
              autocomplete="off"
              spellcheck="false"
              @keydown="onKey"
            />
            <span v-if="parsed.line" class="shrink-0 rounded-inner bg-fill px-1.5 py-0.5 text-2xs tabular text-ink-muted">{{ t('workspace.quickOpen.line', { n: parsed.line }) }}</span>
          </div>

          <div id="qo-list" ref="listEl" role="listbox" :aria-label="t('workspace.quickOpen.results')" class="ccm-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
            <p v-if="!root" class="px-3 py-8 text-center text-sm text-ink-muted">{{ t('workspace.quickOpen.noRoot') }}</p>
            <p v-else-if="state === 'loading'" class="px-3 py-8 text-center text-sm text-ink-muted" role="status">{{ t('workspace.quickOpen.loading') }}</p>
            <p v-else-if="state === 'failed'" class="px-3 py-8 text-center text-sm text-ink-muted">{{ t('workspace.quickOpen.failed') }}</p>
            <p v-else-if="!rows.length" class="px-3 py-8 text-center text-sm text-ink-muted">{{ t('workspace.quickOpen.empty') }}</p>
            <template v-else>
              <template v-for="row in rows" :key="row.hit.item">
                <p v-if="recentCount && row.index === 0" class="px-2.5 pb-1 pt-1.5 text-2xs font-medium text-ink-faint" aria-hidden="true">{{ t('workspace.quickOpen.recent') }}</p>
                <p v-else-if="recentCount && row.index === recentCount" class="px-2.5 pb-1 pt-2.5 text-2xs font-medium text-ink-faint" aria-hidden="true">
                  {{ t('workspace.quickOpen.results') }}
                </p>
                <div
                  :id="`qo-opt-${row.index}`"
                  role="option"
                  :data-index="row.index"
                  :aria-selected="row.index === active"
                  class="flex h-8 cursor-pointer items-center gap-2 rounded-inner px-2.5 text-sm"
                  :class="row.index === active ? 'bg-accent text-on-accent' : 'text-ink'"
                  @mousemove="active = row.index"
                  @click="choose(row.hit, isMac ? $event.metaKey : $event.ctrlKey)"
                >
                  <FileText :size="14" class="shrink-0" :class="row.index === active ? 'text-on-accent' : 'text-agent-file'" aria-hidden="true" />
                  <span class="shrink-0 truncate"
                    ><template v-for="(p, i) in row.name" :key="i"
                      ><mark v-if="p.hit" class="bg-transparent font-semibold" :class="row.index === active ? 'text-on-accent' : 'text-accent-ink'">{{ p.text }}</mark
                      ><template v-else>{{ p.text }}</template></template
                    ></span
                  >
                  <span class="min-w-0 flex-1 truncate text-xs" :class="row.index === active ? 'text-on-accent' : 'text-ink-faint'" dir="rtl"
                    ><bdi
                      ><template v-for="(p, i) in row.dir" :key="i"
                        ><mark v-if="p.hit" class="bg-transparent font-semibold" :class="row.index === active ? 'text-on-accent' : 'text-ink-muted'">{{ p.text }}</mark
                        ><template v-else>{{ p.text }}</template></template
                      ></bdi
                    ></span
                  >
                </div>
              </template>
            </template>
          </div>

          <div class="hidden items-center gap-x-4 border-t border-line px-4 py-2.5 text-2xs text-ink-faint sm:flex">
            <span v-for="h in HINTS" :key="h.key" class="inline-flex items-center gap-1.5">
              <kbd class="rounded-inner bg-fill px-1.5 py-px font-sans text-ink-muted">{{ h.keys }}</kbd>{{ t(`workspace.quickOpen.hints.${h.key}`) }}
            </span>
            <span v-if="files?.truncated" class="ml-auto">{{ t('workspace.quickOpen.truncated', { n: files.files.length }) }}</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
