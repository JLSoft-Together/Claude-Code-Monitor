<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDownToLine, ArrowUpToLine, FileWarning, LoaderCircle, RefreshCw, Search } from 'lucide-vue-next'
import { appendChunk, emptyBuffer, filterLines, fromTail, levelCounts, LOG_LEVELS, MAX_LOADED_BYTES, prependChunk, type LevelIndex, type LogBuffer } from '../../lib/logView'
import { sameRange, uniformRange, type RowRange } from '../../lib/rowWindow'
import { dirOf, logRead, onPreviewChanged, unwatchRoot, watchRoot, type LogChunk } from '../../lib/preview'
import { isMac } from '../../lib/platform'
import AccessPrompt from './AccessPrompt.vue'

const props = defineProps<{ path: string; active: boolean }>()
const { t, locale } = useI18n()

const FILTER_DEBOUNCE_MS = 150
/** Appends per change event; a burst bigger than this waits for the next event (or Reload). */
const FOLLOW_CHUNKS = 8
const LEVEL_CLASS: readonly string[] = ['lv-v', 'lv-d', 'lv-i', 'lv-w', 'lv-e', 'lv-f']

const buf = shallowRef<LogBuffer>(emptyBuffer())
const size = ref(0)
const loading = ref(true)
const busy = ref(false)
const error = ref<Exclude<LogChunk, { ok: true }>['error'] | null>(null)
const realPath = ref<string | null>(null)
const follow = ref(true)
const pendingBytes = ref(0)
const minLevel = ref<LevelIndex>(-1)
const queryInput = ref('')
const query = ref('')
const scroller = ref<HTMLElement | null>(null)
const filterEl = ref<HTMLInputElement | null>(null)
const rowH = ref(19.5)
const range = shallowRef<RowRange>({ start: 0, end: 0 })
let queryTimer: ReturnType<typeof setTimeout> | undefined
let frame = 0
let seq = 0
let watched: string | null = null

watch(queryInput, (q) => {
  clearTimeout(queryTimer)
  queryTimer = setTimeout(() => (query.value = q), FILTER_DEBOUNCE_MS)
})

const visible = computed(() => filterLines(buf.value, minLevel.value, query.value))
const rowCount = computed(() => visible.value?.length ?? buf.value.lines.length)
const counts = computed(() => levelCounts(buf.value.levels))
const canEarlier = computed(() => buf.value.start > 0 && buf.value.end - buf.value.start < MAX_LOADED_BYTES)
const rows = computed(() => {
  const out: Array<{ i: number; text: string; level: LevelIndex }> = []
  const { start, end } = range.value
  const idx = visible.value
  for (let r = start; r < Math.min(end, rowCount.value); r++) {
    const i = idx ? idx[r]! : r
    out.push({ i, text: buf.value.lines[i]!, level: buf.value.levels[i]! })
  }
  return out
})

const fmtBytes = (n: number): string => {
  const nf = (v: number, d: number) => v.toLocaleString(locale.value, { maximumFractionDigits: d })
  if (n < 1024) return `${nf(n, 0)} B`
  if (n < 1024 * 1024) return `${nf(n / 1024, 1)} KB`
  return `${nf(n / 1024 / 1024, 1)} MB`
}
const loadedText = computed(() =>
  buf.value.start > 0 ? t('workspace.logView.partial', { loaded: fmtBytes(buf.value.end - buf.value.start), size: fmtBytes(size.value) }) : t('workspace.logView.whole', { size: fmtBytes(size.value) }),
)

function updateRange(): void {
  frame = 0
  const sc = scroller.value
  const row = sc?.querySelector<HTMLElement>('.lr')
  const h = row?.getBoundingClientRect().height
  if (h && Math.abs(h - rowH.value) > 0.01) rowH.value = h
  const next = uniformRange(rowCount.value, rowH.value, sc?.scrollTop ?? 0, sc?.clientHeight || 1000)
  if (!sameRange(next, range.value)) range.value = next
}

const atBottom = (): boolean => {
  const sc = scroller.value
  return !sc || sc.scrollHeight - sc.scrollTop - sc.clientHeight < rowH.value * 1.5
}

function onScroll(): void {
  if (!frame) frame = requestAnimationFrame(updateRange)
  // Scrolling up leaves follow mode, like `less +F`; new lines then only show a count.
  if (follow.value && !atBottom()) follow.value = false
}

async function toBottom(): Promise<void> {
  updateRange()
  await nextTick()
  const sc = scroller.value
  if (sc) sc.scrollTop = sc.scrollHeight
  updateRange()
}

watch([rowCount, rowH], () => updateRange())
watch([minLevel, query], () => {
  if (follow.value) void toBottom()
  else updateRange()
})

async function loadTail(): Promise<void> {
  const my = ++seq
  busy.value = true
  const res = await logRead(props.path)
  if (my !== seq) return
  busy.value = false
  loading.value = false
  if (!res.ok) {
    error.value = res.error
    buf.value = emptyBuffer()
    return
  }
  error.value = null
  realPath.value = res.path
  size.value = res.size
  pendingBytes.value = 0
  buf.value = fromTail(res.text, res.start, res.end)
  void setWatch(dirOf(res.path))
  await toBottom()
}

async function loadEarlier(): Promise<void> {
  if (!canEarlier.value || busy.value) return
  const my = ++seq
  busy.value = true
  const before = rowCount.value
  const res = await logRead(props.path, { end: buf.value.start })
  busy.value = false
  if (my !== seq || !res.ok) return
  size.value = res.size
  buf.value = prependChunk(buf.value, res.text, res.start)
  await nextTick()
  if (scroller.value) scroller.value.scrollTop += (rowCount.value - before) * rowH.value
  updateRange()
}

async function pullNew(): Promise<void> {
  if (busy.value) return
  const my = ++seq
  busy.value = true
  try {
    for (let n = 0; n < FOLLOW_CHUNKS; n++) {
      const res = await logRead(props.path, { from: buf.value.end })
      if (my !== seq) return
      if (!res.ok) {
        error.value = res.error
        return
      }
      size.value = res.size
      if (res.reset) buf.value = fromTail(res.text, res.start, res.end)
      else buf.value = appendChunk(buf.value, res.text, res.end)
      if (res.end >= res.size || res.end === res.start) break
    }
    pendingBytes.value = 0
  } finally {
    if (my === seq) busy.value = false
  }
  if (follow.value) await toBottom()
}

function setFollow(on: boolean): void {
  follow.value = on
  if (!on) return
  if (pendingBytes.value) void pullNew()
  else void toBottom()
}

async function setWatch(dir: string | null): Promise<void> {
  if (watched === dir) return
  if (watched) void unwatchRoot(watched)
  watched = dir
  if (dir && !(await watchRoot(dir)) && watched === dir) watched = null
}

const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
const samePath = (a: string, b: string): boolean => (isMac || /^[A-Za-z]:/.test(a) ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b))

const offChange = onPreviewChanged((change) => {
  if (!change.paths.some((p) => samePath(p, props.path) || (!!realPath.value && samePath(p, realPath.value)))) return
  if (error.value) return void loadTail()
  if (follow.value) void pullNew()
  else void logRead(props.path, { from: buf.value.end, bytes: 1 }).then((res) => {
    if (res.ok) pendingBytes.value = res.reset ? res.size : Math.max(0, res.size - buf.value.end)
  })
})

function onKey(e: KeyboardEvent): void {
  if ((isMac ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey && e.code === 'KeyF') {
    e.preventDefault()
    e.stopPropagation()
    filterEl.value?.focus()
    filterEl.value?.select()
  } else if (e.key === 'Escape' && e.target === filterEl.value && queryInput.value) {
    e.preventDefault()
    e.stopPropagation()
    queryInput.value = ''
  }
}

watch(
  () => props.path,
  () => {
    buf.value = emptyBuffer()
    loading.value = true
    follow.value = true
    void loadTail()
  },
)

const resize = new ResizeObserver(() => updateRange())
onMounted(() => {
  if (scroller.value) resize.observe(scroller.value)
  void loadTail()
})
onBeforeUnmount(() => {
  seq++
  offChange()
  resize.disconnect()
  clearTimeout(queryTimer)
  if (frame) cancelAnimationFrame(frame)
  void setWatch(null)
})

const levelLabel = (lv: number): string => t(`workspace.logView.level.${LOG_LEVELS[lv]}`)
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col" data-log-view @keydown="onKey">
    <div class="ccm-material @container flex h-9 min-w-0 shrink-0 items-center gap-1 border-b border-line px-2" role="toolbar" :aria-label="t('workspace.logView.toolbar')">
      <select v-model.number="minLevel" class="ccm-field h-7 shrink-0 cursor-pointer pr-1 text-2xs" :aria-label="t('workspace.logView.minLevel')" :title="t('workspace.logView.minLevel')" data-log-level>
        <option :value="-1">{{ t('workspace.logView.allLevels') }}</option>
        <option v-for="(l, i) in LOG_LEVELS" :key="l" :value="i">{{ l }} · {{ levelLabel(i) }}{{ counts[i] ? ` (${counts[i]})` : '' }}</option>
      </select>
      <label class="ccm-field flex h-7 min-w-0 max-w-72 flex-1 items-center gap-1.5">
        <Search :size="12" class="shrink-0 text-ink-faint" aria-hidden="true" />
        <input
          ref="filterEl"
          v-model="queryInput"
          type="search"
          class="min-w-0 flex-1 bg-transparent text-2xs outline-none"
          :placeholder="t('workspace.logView.filter')"
          :aria-label="t('workspace.logView.filter')"
          spellcheck="false"
          data-log-filter
        />
      </label>
      <span class="hidden min-w-0 truncate px-1 text-2xs tabular text-ink-faint @lg:inline" :title="loadedText">
        {{ visible ? t('workspace.logView.matches', { n: rowCount.toLocaleString(locale), total: buf.lines.length.toLocaleString(locale) }) : t('workspace.logView.lines', { n: buf.lines.length.toLocaleString(locale) }) }}
      </span>
      <span class="ml-auto" />
      <LoaderCircle v-if="busy" :size="13" class="shrink-0 animate-spin text-ink-muted" :aria-label="t('workspace.viewer.loading')" />
      <button
        type="button"
        class="ccm-btn-plain shrink-0 gap-1 text-2xs"
        :disabled="!canEarlier || busy"
        :title="canEarlier ? loadedText : buf.start > 0 ? t('workspace.logView.capped') : loadedText"
        data-log-earlier
        @click="loadEarlier"
      >
        <ArrowUpToLine :size="14" aria-hidden="true" /><span class="@max-[420px]:sr-only">{{ t('workspace.logView.earlier') }}</span>
      </button>
      <button
        v-if="!follow && pendingBytes"
        type="button"
        class="ccm-btn-plain shrink-0 gap-1 text-2xs text-accent-ink"
        :title="t('workspace.logView.newHint')"
        data-log-new
        @click="setFollow(true)"
      >
        <RefreshCw :size="13" aria-hidden="true" />{{ t('workspace.logView.newBytes', { size: fmtBytes(pendingBytes) }) }}
      </button>
      <button
        type="button"
        class="ccm-btn-plain shrink-0 gap-1 text-2xs"
        :class="follow ? 'text-accent-ink' : ''"
        :aria-pressed="follow"
        :title="t('workspace.logView.followHint')"
        data-log-follow
        @click="setFollow(!follow)"
      >
        <ArrowDownToLine :size="14" aria-hidden="true" /><span class="@max-[420px]:sr-only">{{ t('workspace.logView.follow') }}</span>
      </button>
    </div>
    <div ref="scroller" class="ccm-scroll relative min-h-0 min-w-0 flex-1 overflow-auto" @scroll.passive="onScroll">
      <div v-if="loading" class="grid size-full place-items-center text-xs text-well-ink">{{ t('workspace.viewer.loading') }}</div>
      <div v-else-if="error" class="grid size-full place-items-center p-6">
        <div class="flex max-w-sm flex-col items-center gap-2 text-center">
          <FileWarning :size="26" class="text-well-ink" aria-hidden="true" />
          <p class="text-sm text-well-ink" role="alert">{{ t(`workspace.logView.error.${error}`) }}</p>
          <AccessPrompt v-if="error === 'denied'" :path="path" well @granted="loadTail()" />
        </div>
      </div>
      <p v-else-if="!rowCount" class="px-3 py-2 text-xs text-well-ink">{{ buf.lines.length ? t('workspace.logView.noMatch') : t('workspace.logView.empty') }}</p>
      <div v-else class="log-body w-max min-w-full py-1 font-mono" role="log" :aria-label="t('workspace.logView.label')" data-code-zoom>
        <div :style="{ height: `${range.start * rowH}px` }" aria-hidden="true" />
        <div v-for="r in rows" :key="r.i" class="lr flex whitespace-pre pr-3" :class="r.level >= 0 ? LEVEL_CLASS[r.level] : 'lv-none'" :data-log-line="r.i">
          <span class="lb w-6 shrink-0 text-center" :title="r.level >= 0 ? levelLabel(r.level) : undefined">{{ r.level >= 0 ? LOG_LEVELS[r.level] : '' }}</span>
          <span>{{ r.text }}&#8203;</span>
        </div>
        <div :style="{ height: `${Math.max(0, rowCount - range.end) * rowH}px` }" aria-hidden="true" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.log-body { font-size: var(--ccm-code-size, 13px); line-height: 1.5; color: var(--ccm-well-ink); }
.lb { color: var(--ccm-ansi-8); font-weight: 600; }
.lv-v, .lv-d { color: var(--ccm-ansi-8); }
.lv-w, .lv-w .lb { color: var(--ccm-ansi-11); }
.lv-e, .lv-e .lb { color: var(--ccm-ansi-9); }
.lv-f, .lv-f .lb { color: var(--ccm-ansi-9); font-weight: 600; }
.lv-f { background: var(--ccm-error-soft); }
.lv-i .lb { color: var(--ccm-ansi-12); }
</style>
