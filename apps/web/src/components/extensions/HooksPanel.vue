<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert, CircleCheck, CircleOff, Clock, Lock, LoaderCircle, Play, RefreshCw, Search, ShieldCheck, TriangleAlert, X } from 'lucide-vue-next'
import type { HookRow, HooksListResult, HookTestResult } from '@ccm/shared'
import { filterRows, groupByEvent, hooksList, hooksTest, hooksToggle, isActive } from '../../lib/claudeHooks'

const props = defineProps<{ dir: string | null }>()
const { t } = useI18n()

const list = shallowRef<HooksListResult | null>(null)
const loading = ref(false)
const query = ref('')
const busyId = ref<string | null>(null)
const testingId = ref<string | null>(null)
const errors = ref<Record<string, string>>({})
const tests = ref<Record<string, HookTestResult>>({})
let gen = 0

async function load(): Promise<void> {
  const my = ++gen
  loading.value = true
  try {
    const res = await hooksList(props.dir)
    if (my === gen) list.value = res
  } catch {
    if (my === gen) list.value = { ok: false, error: 'unavailable' }
  } finally {
    if (my === gen) loading.value = false
  }
}

const rows = computed<HookRow[]>(() => (list.value?.ok ? list.value.rows : []))
const groups = computed(() => groupByEvent(filterRows(rows.value, query.value)))
const unreadable = computed(() => (list.value?.ok ? list.value.files.filter((f) => f.state === 'unreadable') : []))

const sourceLabel = (r: HookRow): string => (r.source === 'plugin' ? t('hooksMgr.source.plugin', { name: r.plugin ?? '' }) : t(`hooksMgr.source.${r.source}`))
const typeLabel = (r: HookRow): string | null => (r.type === 'command' ? null : ['http', 'prompt', 'agent', 'mcp_tool'].includes(r.type) ? t(`hooksMgr.type.${r.type}`) : r.type)

function setError(id: string, code: string | null): void {
  const next = { ...errors.value }
  const text = code ? t(`hooksMgr.error.${code}`) : ''
  if (text) next[id] = text
  else delete next[id]
  errors.value = next
}

async function toggle(r: HookRow): Promise<void> {
  if (busyId.value || !r.toggleable) return
  busyId.value = r.id
  setError(r.id, null)
  try {
    const res = await hooksToggle(r.id, props.dir, !r.enabled)
    if (!res.ok) setError(r.id, res.error)
    else {
      const { [r.id]: _, ...rest } = tests.value
      tests.value = rest
    }
  } finally {
    busyId.value = null
    await load()
  }
}

async function runTest(r: HookRow): Promise<void> {
  if (testingId.value) return
  testingId.value = r.id
  setError(r.id, null)
  try {
    const res = await hooksTest(r.id, props.dir)
    if (res.ok) tests.value = { ...tests.value, [r.id]: res }
    else setError(r.id, res.error)
  } finally {
    testingId.value = null
  }
}

function closeTest(id: string): void {
  const { [id]: _, ...rest } = tests.value
  tests.value = rest
}

const OUTPUTS = ['stdout', 'stderr'] as const
type TestOk = Extract<HookTestResult, { ok: true }>
const passed = (res: TestOk): boolean => !res.timedOut && res.code === 0
/** Zero or one finished test of a row, as a list so the template can name it. */
function okTest(id: string): TestOk[] {
  const res = tests.value[id]
  return res?.ok ? [res] : []
}

onMounted(load)
watch(
  () => props.dir,
  () => {
    tests.value = {}
    errors.value = {}
    void load()
  },
)
</script>

<template>
  <section class="mt-6" aria-labelledby="ext-hooks" data-ext-hooks>
    <div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div class="min-w-0">
        <h3 id="ext-hooks" class="text-base font-semibold">{{ t('hooksMgr.title') }}</h3>
        <p class="mt-0.5 max-w-[80ch] text-xs text-ink-muted">{{ t('hooksMgr.subtitle') }}</p>
      </div>
      <div class="flex min-w-0 items-center gap-2">
        <label class="relative min-w-0">
          <span class="sr-only">{{ t('hooksMgr.filter') }}</span>
          <Search :size="13" class="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
          <input v-model="query" type="search" class="ccm-field w-44 max-w-full pl-7 sm:w-56" :placeholder="t('hooksMgr.filter')" data-hooks-filter />
        </label>
        <button type="button" class="ccm-btn shrink-0" :disabled="loading" data-hooks-refresh @click="load">
          <LoaderCircle v-if="loading" :size="14" class="animate-spin" aria-hidden="true" />
          <RefreshCw v-else :size="14" aria-hidden="true" />{{ t('hooksMgr.refresh') }}
        </button>
      </div>
    </div>

    <div v-if="list?.ok && list.disableAll" class="mt-3 flex items-start gap-2 rounded-card bg-warning-soft px-4 py-2.5 text-sm" role="alert" data-hooks-disable-all>
      <TriangleAlert :size="15" class="mt-0.5 shrink-0 text-warning" aria-hidden="true" />{{ t('hooksMgr.disableAll') }}
    </div>
    <p v-for="f in unreadable" :key="f.source" class="mt-3 flex items-center gap-1.5 text-xs text-warning" role="alert">
      <CircleAlert :size="13" class="shrink-0" aria-hidden="true" />{{ t('hooksMgr.unreadable', { file: t(`hooksMgr.file.${f.source}`) }) }}
    </p>

    <p v-if="!list && loading" class="mt-4 text-sm text-ink-muted" role="status">{{ t('hooksMgr.loading') }}</p>
    <p v-else-if="list && !list.ok" class="mt-4 flex items-center gap-1.5 text-sm text-warning" role="alert">
      <CircleAlert :size="14" aria-hidden="true" />{{ list.error === 'unavailable' ? t('hooksMgr.error.unavailable') : t('hooksMgr.loadFailed') }}
    </p>
    <p v-else-if="list && !rows.length" class="mt-4 rounded-card bg-surface px-4 py-6 text-center text-sm text-ink-muted shadow-card" data-hooks-empty>{{ t('hooksMgr.empty') }}</p>
    <p v-else-if="list && !groups.length" class="mt-4 text-sm text-ink-muted">{{ t('hooksMgr.noMatch') }}</p>

    <div v-for="g in groups" :key="g.event" class="mt-4" :data-hooks-event="g.event">
      <h4 class="flex items-baseline gap-2 px-1">
        <span class="font-mono text-xs font-semibold">{{ g.event }}</span>
        <span class="text-2xs text-ink-faint">{{ t('hooksMgr.count', { active: g.active, n: g.rows.length }) }}</span>
      </h4>
      <ul class="ccm-group mt-1" role="list">
        <li v-for="r in g.rows" :key="r.id" class="min-w-0 px-3 py-1.5" :data-hook-row="r.id" :data-hook-source="r.source" :data-hook-enabled="isActive(r) ? 'true' : 'false'">
          <div class="flex min-h-8 min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <span class="flex w-16 shrink-0 items-center">
              <span v-if="r.orrery" class="inline-flex items-center gap-1 rounded-full bg-accent-soft px-1.5 py-0.5 text-2xs font-medium text-accent-ink" :title="t('hooksMgr.orreryHint')" data-hook-orrery>
                <ShieldCheck :size="11" aria-hidden="true" />{{ t('hooksMgr.orrery') }}
              </span>
              <span v-else-if="r.source === 'plugin'" class="inline-flex items-center text-ink-faint" :title="t('hooksMgr.pluginHint')">
                <Lock :size="13" aria-hidden="true" /><span class="sr-only">{{ t('hooksMgr.pluginHint') }}</span>
              </span>
              <label v-else class="inline-flex cursor-pointer items-center gap-1.5" :title="r.enabled ? t('hooksMgr.toggleOff', { event: r.event, command: '' }) : t('hooksMgr.toggleOn', { event: r.event, command: '' })">
                <input
                  type="checkbox"
                  class="size-4 cursor-pointer accent-accent"
                  :checked="r.enabled"
                  :disabled="!!busyId"
                  :aria-label="r.enabled ? t('hooksMgr.toggleOff', { event: r.event, command: r.text }) : t('hooksMgr.toggleOn', { event: r.event, command: r.text })"
                  data-hook-toggle
                  @change="toggle(r)"
                />
                <LoaderCircle v-if="busyId === r.id" :size="12" class="animate-spin text-ink-muted" aria-hidden="true" />
              </label>
            </span>
            <span class="w-28 shrink-0 truncate font-mono text-2xs" :class="r.matcher ? 'text-ink' : 'text-ink-faint'" :title="r.matcher ?? t('hooksMgr.anyMatcher')">
              {{ r.matcher ?? t('hooksMgr.anyMatcher') }}
            </span>
            <span class="flex min-w-0 flex-[1_1_16rem] items-center gap-1.5">
              <span v-if="typeLabel(r)" class="shrink-0 rounded bg-fill px-1 text-2xs text-ink-muted">{{ typeLabel(r) }}</span>
              <span class="min-w-0 truncate font-mono text-xs" :class="isActive(r) ? 'text-ink' : 'text-ink-faint line-through'" :title="r.text" data-hook-command>{{ r.text }}</span>
              <span v-if="r.async" class="shrink-0 text-2xs text-ink-faint">{{ t('hooksMgr.async') }}</span>
              <span v-if="r.timeout !== null" class="shrink-0 text-2xs text-ink-faint tabular-nums">{{ t('hooksMgr.timeout', { s: r.timeout }) }}</span>
            </span>
            <span class="flex shrink-0 items-center gap-1.5 text-2xs text-ink-muted">
              <span v-if="!r.enabled" class="inline-flex items-center gap-1 text-ink-faint"><CircleOff :size="11" aria-hidden="true" />{{ t('hooksMgr.off') }}</span>
              <span v-else-if="r.pluginEnabled === false" class="inline-flex items-center gap-1 text-ink-faint"><CircleOff :size="11" aria-hidden="true" />{{ t('hooksMgr.pluginOff') }}</span>
              <span class="max-w-48 truncate" :title="sourceLabel(r)">{{ sourceLabel(r) }}</span>
            </span>
            <button
              v-if="r.testable"
              type="button"
              class="ccm-btn-plain ml-auto shrink-0"
              :disabled="!!testingId"
              :title="t('hooksMgr.testHint')"
              :aria-label="`${t('hooksMgr.test')}: ${r.event} ${r.text}`"
              data-hook-test
              @click="runTest(r)"
            >
              <LoaderCircle v-if="testingId === r.id" :size="13" class="animate-spin" aria-hidden="true" />
              <Play v-else :size="13" aria-hidden="true" />
              <span class="hidden text-xs md:inline">{{ testingId === r.id ? t('hooksMgr.testRunning') : t('hooksMgr.test') }}</span>
            </button>
          </div>
          <p v-if="errors[r.id]" class="mt-1 flex items-center gap-1.5 text-2xs text-warning" role="alert" data-hook-error>
            <CircleAlert :size="12" class="shrink-0" aria-hidden="true" />{{ errors[r.id] }}
          </p>
          <div v-for="res in okTest(r.id)" :key="`t:${r.id}`" class="mt-1.5 rounded-lg bg-well p-2 text-well-ink" data-hook-result>
            <template v-if="res">
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs">
                <span class="inline-flex items-center gap-1 font-medium" :class="passed(res) ? 'text-success' : 'text-warning'" data-hook-exit>
                  <Clock v-if="res.timedOut" :size="12" aria-hidden="true" />
                  <CircleCheck v-else-if="passed(res)" :size="12" aria-hidden="true" />
                  <CircleAlert v-else :size="12" aria-hidden="true" />
                  {{ res.timedOut ? t('hooksMgr.timedOut') : res.code === null ? t('hooksMgr.exitNone') : t('hooksMgr.exit', { code: res.code }) }}
                </span>
                <span class="tabular-nums text-ink-faint">{{ t('hooksMgr.took', { ms: res.ms }) }}</span>
                <span v-if="res.truncated" class="text-ink-faint">{{ t('hooksMgr.truncated') }}</span>
                <button type="button" class="ccm-btn-plain ml-auto" :aria-label="t('hooksMgr.testClose')" :title="t('hooksMgr.testClose')" @click="closeTest(r.id)">
                  <X :size="12" aria-hidden="true" />
                </button>
              </div>
              <p v-if="!res.stdout && !res.stderr" class="mt-1 text-2xs text-ink-faint">{{ t('hooksMgr.noOutput') }}</p>
              <template v-for="part in OUTPUTS" :key="part">
                <div v-if="res[part]" class="mt-1.5 min-w-0">
                  <p class="text-2xs text-ink-faint">{{ t(`hooksMgr.${part}`) }}</p>
                  <pre class="max-h-48 overflow-auto font-mono text-2xs break-all whitespace-pre-wrap" :data-hook-out="part">{{ res[part] }}</pre>
                </div>
              </template>
            </template>
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>
