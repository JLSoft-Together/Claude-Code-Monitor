<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDownToLine, Bug, CircleX, LoaderCircle, Search, Send, Trash2, TriangleAlert, X } from 'lucide-vue-next'
import type { BuildError, LogLevel, RunKind, RunLogLine, RunSession, RunStream } from '@ccm/shared'
import { baseName, listFiles } from '../../lib/preview'
import { fileMention } from '../../lib/promptAttachments'
import { crashBlocks, crashClock, crashPrompt, fileIndex, frameFile, groupCrashes, type CrashFrame, type CrashGroup, type FileIndex, type OwnFrame } from '../../lib/runCrash'
import { isErrorLine } from '../../lib/runUi'
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

// Parsed from the whole run buffer (not the filtered view): a crash stays visible while searching for something else.
const crashes = computed<CrashGroup[]>(() => {
  void run.logVersion
  return props.session ? groupCrashes(crashBlocks(run.linesFor(props.session.id, runStreams.value))) : []
})
const crashTotal = computed(() => crashes.value.reduce((n, g) => n + g.count, 0))
const crashOpen = ref(false)
const crashPick = ref<string | null>(null)
const crashSel = computed(() => crashes.value.find((g) => g.key === crashPick.value) ?? crashes.value[0] ?? null)
const FRAMES_SHOWN = 40

watch(
  () => props.session?.id,
  () => {
    crashOpen.value = false
    crashPick.value = null
  },
)

const index = shallowRef<FileIndex | null>(null)
let indexRoot: string | null = null
watch(
  () => [crashOpen.value, props.root] as const,
  async ([open, root]) => {
    if (!open || indexRoot === root) return
    indexRoot = root
    index.value = null
    const list = await listFiles(root).catch(() => null)
    if (indexRoot === root) index.value = fileIndex(list?.files ?? [])
  },
)

function absPath(rel: string): string {
  const sep = props.root.includes('\\') ? '\\' : '/'
  return `${props.root.replace(/[\\/]+$/, '')}${sep}${sep === '/' ? rel : rel.replace(/\//g, sep)}`
}

function ownPath(f: CrashFrame): string | null {
  const rel = index.value ? frameFile(f, index.value, props.root) : null
  return rel ? absPath(rel) : null
}

function ownFrames(g: CrashGroup): OwnFrame[] {
  return g.block.frames.flatMap((frame) => {
    const path = ownPath(frame)
    return path ? [{ frame, path }] : []
  })
}

function fillCrash(g: CrashGroup): void {
  const own = ownFrames(g)
  if (!run.fillAgent(props.root, (cwd, win) => crashPrompt(g, own, (p) => fileMention(p, cwd, win)))) emit('noAgent')
}

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

const errorLine = (l: RunLogLine): boolean => l.stream === 'build' && (l.level === 'E' || (!l.level && isErrorLine(l.text)))

function lineClass(l: RunLogLine): string {
  if (errorLine(l)) return 'text-(--ccm-ansi-9) font-semibold bg-st-error-soft -mx-3 px-3'
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
      <button
        v-if="crashes.length"
        type="button"
        class="flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-full bg-st-error-soft px-2 text-2xs font-medium text-st-error"
        :aria-expanded="crashOpen"
        :aria-label="t('runCrash.chipLabel', { n: crashTotal })"
        :title="t('runCrash.chipLabel', { n: crashTotal })"
        data-run-crash
        @click="crashOpen = !crashOpen"
      >
        <Bug :size="12" aria-hidden="true" />
        {{ t('runCrash.chip', { time: crashClock(crashes[0]!.block.at) }) }}
        <span v-if="crashTotal > 1" class="tabular">{{ t('runCrash.times', { n: crashTotal }) }}</span>
      </button>
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

    <section v-if="crashOpen && crashSel" class="flex max-h-80 shrink-0 flex-col border-b border-line" :aria-label="t('runCrash.title')" data-run-crash-panel>
      <div class="flex min-w-0 shrink-0 items-center gap-1 overflow-x-auto px-2 py-1">
        <button
          v-for="g in crashes"
          :key="g.key"
          type="button"
          class="flex h-6 max-w-64 min-w-0 shrink-0 cursor-pointer items-center gap-1 rounded-inner px-2 text-2xs"
          :class="g.key === crashSel.key ? 'bg-st-error-soft text-ink' : 'text-ink-muted hover:bg-fill hover:text-ink'"
          :aria-pressed="g.key === crashSel.key"
          :title="g.block.exception"
          data-run-crash-group
          @click="crashPick = g.key"
        >
          <CircleX :size="12" class="shrink-0 text-st-error" aria-hidden="true" />
          <span class="shrink-0 tabular">{{ crashClock(g.block.at) }}</span>
          <span class="min-w-0 truncate">{{ g.block.exception }}</span>
          <span v-if="g.count > 1" class="shrink-0 tabular text-st-error">{{ t('runCrash.times', { n: g.count }) }}</span>
        </button>
        <span class="min-w-0 flex-1" />
        <button type="button" class="ccm-btn shrink-0" :title="t('runCrash.fillHint')" data-run-crash-fill @click="fillCrash(crashSel)">
          <Send :size="13" aria-hidden="true" />{{ t('runCrash.fill') }}
        </button>
        <button type="button" class="ccm-btn-plain shrink-0" :title="t('runCrash.close')" :aria-label="t('runCrash.close')" @click="crashOpen = false">
          <X :size="13" aria-hidden="true" />
        </button>
      </div>
      <div class="min-h-0 overflow-y-auto px-3 pb-2 text-xs" data-run-crash-detail>
        <p class="text-2xs font-semibold text-st-error">{{ t(`runCrash.kind.${crashSel.block.kind}`) }}</p>
        <p class="break-words font-mono text-2xs font-semibold text-ink">{{ crashSel.block.exception }}<template v-if="crashSel.block.message">: {{ crashSel.block.message }}</template></p>
        <p v-for="(c, i) in crashSel.block.causes" :key="i" class="break-words font-mono text-2xs text-ink">
          <span class="text-ink-muted">{{ t('runCrash.causedBy') }}:</span> {{ c.exception }}<template v-if="c.message">: {{ c.message }}</template>
        </p>
        <p v-if="!crashSel.block.frames.length" class="mt-1 text-2xs text-ink-faint">{{ t('runCrash.noFrames') }}</p>
        <template v-else>
          <p class="mt-1.5 flex items-center gap-1 text-2xs text-ink-faint">
            <LoaderCircle v-if="!index" :size="11" class="ccm-spin" aria-hidden="true" />{{ index ? t('runCrash.ownHint') : t('runCrash.resolving') }}
          </p>
          <ol class="mt-0.5 font-mono text-2xs leading-relaxed" :aria-label="t('runCrash.frames')">
            <li v-for="(f, i) in crashSel.block.frames.slice(0, FRAMES_SHOWN)" :key="i" class="min-w-0 break-all">
              <button
                v-if="ownPath(f)"
                type="button"
                class="cursor-pointer text-left font-semibold text-link hover:underline"
                :title="t('runCrash.open', { file: ownPath(f)!, line: f.line })"
                data-run-crash-frame
                @click="emit('open', ownPath(f)!, Math.max(1, f.line))"
              >
                {{ f.raw }}
              </button>
              <span v-else class="text-ink-faint">{{ f.raw }}</span>
            </li>
          </ol>
          <p v-if="crashSel.block.frames.length > FRAMES_SHOWN" class="text-2xs text-ink-faint">{{ t('runCrash.more', { n: crashSel.block.frames.length - FRAMES_SHOWN }) }}</p>
        </template>
      </div>
    </section>

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
      <div v-for="(l, i) in shown" :key="offset + i" class="break-all whitespace-pre-wrap" :class="lineClass(l)" :data-run-error-line="errorLine(l) ? '' : undefined">
        <span v-if="errorLine(l)" class="sr-only">{{ t('run.log.errorLine') }} </span><span v-if="l.tag" class="text-(--ccm-ansi-8)">{{ l.level }}/{{ l.tag }}: </span>{{ l.text }}
      </div>
      <p v-if="!shown.length" class="text-(--ccm-ansi-8)">{{ all.length ? t('run.log.emptyFiltered') : t('run.log.empty') }}</p>
    </div>
  </div>
</template>
