<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDownToLine, CircleX, Search, Send, Trash2, TriangleAlert } from 'lucide-vue-next'
import type { BuildError, LogLevel, RunKind, RunLogLine, RunSession, RunStream } from '@ccm/shared'
import { baseName } from '../../lib/preview'
import { inRoot, useRunStore } from '../../stores/run'

const props = defineProps<{ session: RunSession | null; kind: RunKind; root: string }>()
const emit = defineEmits<{ open: [path: string, line: number]; noAgent: [] }>()

const { t } = useI18n()
const run = useRunStore()

/** Rendered rows; older matches stay in the ring and come back through the filter. */
const RENDER_MAX = 1000
const LEVELS: LogLevel[] = ['V', 'D', 'I', 'W', 'E', 'F']
const LEVEL_CLASS: Record<LogLevel, string> = {
  V: 'text-(--ccm-ansi-8)',
  D: 'text-(--ccm-ansi-8)',
  I: 'text-well-ink',
  W: 'text-(--ccm-ansi-11)',
  E: 'text-(--ccm-ansi-9)',
  F: 'text-(--ccm-ansi-9) font-semibold',
}

type Tab = 'build' | 'run'
const tab = ref<Tab>('build')
const query = ref('')
const minLevel = ref<LogLevel>('V')
const follow = ref(true)
const scroller = ref<HTMLElement | null>(null)

const runStreams = computed<RunStream[]>(() => (props.kind === 'android' ? ['logcat', 'app'] : ['app']))
const streams = computed<RunStream[]>(() => (tab.value === 'build' ? ['build'] : runStreams.value))
const runLabel = computed(() => (props.kind === 'android' ? t('run.tab.logcat') : t('run.tab.runLog')))

const all = computed<RunLogLine[]>(() => {
  void run.logVersion
  return props.session ? run.linesFor(props.session.id, streams.value) : []
})

const hasLevels = computed(() => tab.value === 'run' && all.value.some((l) => l.level))

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  const min = LEVELS.indexOf(minLevel.value)
  if (!q && min === 0) return all.value
  return all.value.filter((l) => (!l.level || LEVELS.indexOf(l.level) >= min) && (!q || l.text.toLowerCase().includes(q) || !!l.tag?.toLowerCase().includes(q)))
})

const shown = computed(() => filtered.value.slice(-RENDER_MAX))
const offset = computed(() => filtered.value.length - shown.value.length)

const errors = computed<BuildError[]>(() => {
  void run.logVersion
  return props.session && tab.value === 'build' ? run.errorsFor(props.session.id) : []
})

const errorCount = computed(() => {
  void run.logVersion
  return props.session ? run.errorsFor(props.session.id).length : 0
})

function shortFile(file: string): string {
  if (!inRoot(file, props.root)) return baseName(file)
  return file.slice(props.root.replace(/[\\/]+$/, '').length + 1).replace(/\\/g, '/')
}

// Build output while building, the app's log once it runs: what the user is waiting for.
watch(
  () => props.session && ([props.session.id, props.session.state] as const),
  (now, before) => {
    if (!now) return
    const [id, state] = now
    if (before && before[0] === id && before[1] === state) return
    if (state === 'running') tab.value = 'run'
    else if (state === 'before-launch' || state === 'building' || (state === 'failed' && errorCount.value)) tab.value = 'build'
  },
  { immediate: true },
)

watch([() => shown.value, tab], async () => {
  if (!follow.value) return
  await nextTick()
  const el = scroller.value
  if (el) el.scrollTop = el.scrollHeight
})

function onScroll(): void {
  const el = scroller.value
  if (el) follow.value = el.scrollHeight - el.scrollTop - el.clientHeight < 24
}

function pin(): void {
  follow.value = true
  const el = scroller.value
  if (el) el.scrollTop = el.scrollHeight
}

function clear(): void {
  if (props.session) run.clearLog(props.session.id, streams.value)
}

function lineClass(l: RunLogLine): string {
  return l.level ? LEVEL_CLASS[l.level] : 'text-well-ink'
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex h-9 min-w-0 shrink-0 items-center gap-1 border-b border-line px-2">
      <div class="flex shrink-0 rounded-inner bg-fill p-0.5" role="tablist" :aria-label="t('run.tab.label')">
        <button
          v-for="v in ['build', 'run'] as const"
          :key="v"
          type="button"
          role="tab"
          :aria-selected="tab === v"
          class="h-6 cursor-pointer rounded-[5px] px-2 text-2xs font-medium transition-colors duration-(--ccm-dur-fast)"
          :class="tab === v ? 'bg-control text-ink shadow-control' : 'text-ink-muted hover:text-ink'"
          :data-run-tab="v"
          @click="tab = v"
        >
          {{ v === 'build' ? t('run.tab.build') : runLabel }}
          <span v-if="v === 'build' && errorCount" class="ml-0.5 tabular text-st-error">{{ errorCount }}</span>
        </button>
      </div>
      <select v-if="hasLevels" v-model="minLevel" class="ccm-field h-7 shrink-0 cursor-pointer pr-1 text-2xs" :aria-label="t('run.log.level')" :title="t('run.log.level')">
        <option v-for="l in LEVELS" :key="l" :value="l">{{ l }} · {{ t(`run.log.levels.${l}`) }}</option>
      </select>
      <label class="ccm-field ml-auto flex h-7 min-w-0 max-w-56 flex-1 items-center gap-1.5">
        <Search :size="12" class="shrink-0 text-ink-faint" aria-hidden="true" />
        <input v-model="query" type="search" class="min-w-0 flex-1 bg-transparent text-2xs outline-none" :placeholder="t('run.log.search')" :aria-label="t('run.log.search')" spellcheck="false" />
      </label>
      <button type="button" class="ccm-btn-plain shrink-0" :aria-pressed="follow" :title="t('run.log.follow')" :aria-label="t('run.log.follow')" @click="pin">
        <ArrowDownToLine :size="14" aria-hidden="true" />
      </button>
      <button type="button" class="ccm-btn-plain shrink-0" :disabled="!all.length" :title="t('run.log.clear')" :aria-label="t('run.log.clear')" @click="clear">
        <Trash2 :size="14" aria-hidden="true" />
      </button>
    </div>

    <ul v-if="errors.length" class="max-h-40 shrink-0 overflow-y-auto border-b border-line py-1" :aria-label="t('run.errors.title')" data-run-errors>
      <li v-for="(e, i) in errors" :key="i" class="group flex min-w-0 items-start gap-2 px-3 py-1 text-xs hover:bg-fill">
        <CircleX v-if="e.severity === 'error'" :size="13" class="mt-0.5 shrink-0 text-st-error" :aria-label="t('run.errors.error')" />
        <TriangleAlert v-else :size="13" class="mt-0.5 shrink-0 text-warning" :aria-label="t('run.errors.warning')" />
        <button
          type="button"
          class="shrink-0 cursor-pointer font-mono text-2xs text-link hover:underline"
          :title="t('run.errors.open', { file: e.file, line: e.line })"
          @click="emit('open', e.file, e.line)"
        >
          {{ shortFile(e.file) }}:{{ e.line }}:{{ e.col }}
        </button>
        <span class="min-w-0 flex-1 break-words text-ink">{{ e.message }}</span>
        <button type="button" class="ccm-btn-plain -my-1 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100" :title="t('run.errors.send')" :aria-label="t('run.errors.send')" @click="run.sendErrorToAgent(e, root) || emit('noAgent')">
          <Send :size="13" aria-hidden="true" />
        </button>
      </li>
    </ul>

    <div ref="scroller" class="min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-well px-3 py-2 font-mono text-2xs leading-relaxed" role="log" :aria-label="streams[0] === 'build' ? t('run.tab.build') : runLabel" @scroll.passive="onScroll">
      <p v-if="session && run.isRestored(session.id)" class="pb-1 text-(--ccm-ansi-8)" data-run-restored>{{ t('run.log.restored') }}</p>
      <p v-if="offset > 0" class="pb-1 text-(--ccm-ansi-8)">{{ t('run.log.capped', { n: shown.length, total: filtered.length }) }}</p>
      <div v-for="(l, i) in shown" :key="offset + i" class="break-all whitespace-pre-wrap" :class="lineClass(l)">
        <span v-if="l.tag" class="text-(--ccm-ansi-8)">{{ l.level }}/{{ l.tag }}: </span>{{ l.text }}
      </div>
      <p v-if="!shown.length" class="text-(--ccm-ansi-8)">{{ all.length ? t('run.log.emptyFiltered') : t('run.log.empty') }}</p>
    </div>
  </div>
</template>
