<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert, Gauge, LoaderCircle, Minus, Play, RotateCcw, Sparkles, Timer, Trash2, TrendingDown, TrendingUp, X } from 'lucide-vue-next'
import type { PerfErrorCode, PerfSample } from '@ccm/shared'
import { comparable, compareSamples, defaultBase, fmtDelta, fmtValue, PERF_METRICS, perfClear, perfCold, perfHistory, perfMeasure, perfPrompt, perfReset, type PerfTrend } from '../../lib/devPerf'
import { isPackageName } from '../../lib/deviceUiTest'
import { relativeTime } from '../../lib/format'
import { retireOverlay } from '../../lib/motion'
import { useDeviceHandoff } from '../../composables/useDeviceHandoff'

const props = defineProps<{ open: boolean; deviceId: string | null; deviceName: string }>()
const emit = defineEmits<{ close: [] }>()

const { t, te, locale } = useI18n()
const handoff = useDeviceHandoff(() => null)
// Shared with the app data dialog: the same app is usually inspected in both.
const PKG_KEY = 'ccm.devices.appDataPkg'

const dialog = ref<HTMLElement | null>(null)
const pkg = ref('')
const loadedPkg = ref<string | null>(null)
const samples = ref<PerfSample[]>([])
const currentId = ref<string | null>(null)
const baseId = ref<string | null>(null)
const resetAt = ref<number | null>(null)
const busy = ref<string | null>(null)
const error = ref<{ code: PerfErrorCode; detail?: string } | null>(null)
const note = ref<string | null>(null)
let gen = 0
let restoreFocus: HTMLElement | null = null

const pkgOk = computed(() => isPackageName(pkg.value.trim()))
const current = computed(() => samples.value.find((s) => s.id === currentId.value) ?? samples.value[0] ?? null)
const choices = computed(() => (current.value ? comparable(samples.value, current.value) : []))
const base = computed(() => choices.value.find((s) => s.id === baseId.value) ?? (current.value ? defaultBase(samples.value, current.value) : null))
const deltas = computed(() => new Map(current.value && base.value ? compareSamples(current.value, base.value).map((r) => [r.key, r]) : []))
const groups = computed(() => {
  const s = current.value
  if (!s) return []
  return (['frames', 'memory', 'cold'] as const)
    .map((g) => ({ g, rows: PERF_METRICS.filter((m) => m.group === g && m.get(s) !== null).map((m) => ({ ...m, value: m.get(s)! })) }))
    .filter((x) => x.rows.length)
})

const TREND = { better: { icon: TrendingDown, cls: 'text-success' }, worse: { icon: TrendingUp, cls: 'text-warning' }, same: { icon: Minus, cls: 'text-ink-muted' } } satisfies Record<PerfTrend, unknown>

const errorText = computed(() => {
  const code = error.value?.code
  if (!code) return ''
  if (te(`devPerf.error.${code}`)) return t(`devPerf.error.${code}`)
  return t(te(`devices.error.${code}`) ? `devices.error.${code}` : 'devices.error.denied')
})

const when = (at: number): string => relativeTime(at, locale.value, Date.now()) ?? new Date(at).toLocaleString(locale.value)
const stamp = (at: number): string => new Date(at).toLocaleString(locale.value, { dateStyle: 'short', timeStyle: 'short' })

async function step<T>(key: string, fn: () => Promise<T>): Promise<T | null> {
  if (busy.value) return null
  busy.value = key
  error.value = null
  note.value = null
  try {
    return await fn()
  } finally {
    busy.value = null
    keepFocus()
  }
}

// A focused button that turns disabled while busy drops focus to <body>, and Esc / Tab would then miss the dialog.
function keepFocus(): void {
  void nextTick(() => {
    if (dialog.value && !dialog.value.contains(document.activeElement)) dialog.value.focus()
  })
}

function fail(r: { error: PerfErrorCode; detail?: string }): void {
  error.value = { code: r.error, detail: r.detail }
}

async function load(): Promise<void> {
  const p = pkg.value.trim()
  if (!isPackageName(p)) return
  const my = gen
  const r = await step('load', () => perfHistory(p))
  if (!r || my !== gen) return
  if (!r.ok) return fail(r)
  if (loadedPkg.value !== p) resetAt.value = null
  loadedPkg.value = p
  samples.value = r.samples
  currentId.value = r.samples[0]?.id ?? null
  baseId.value = null
  try {
    localStorage.setItem(PKG_KEY, p)
  } catch {
    // remembered package is a convenience only
  }
}

async function ensureLoaded(): Promise<string | null> {
  if (loadedPkg.value !== pkg.value.trim()) await load()
  return loadedPkg.value === pkg.value.trim() ? loadedPkg.value : null
}

async function reset(): Promise<void> {
  const id = props.deviceId
  const p = await ensureLoaded()
  if (!id || !p) return
  const r = await step('reset', () => perfReset(id, p))
  if (!r) return
  if (!r.ok) return fail(r)
  resetAt.value = r.at
  note.value = t('devPerf.resetDone')
}

async function run(kind: 'measure' | 'cold'): Promise<void> {
  const id = props.deviceId
  const p = await ensureLoaded()
  if (!id || !p) return
  const my = gen
  const r = await step(kind, () => (kind === 'cold' ? perfCold(id, p, props.deviceName) : perfMeasure(id, p, props.deviceName)))
  if (!r || my !== gen) return
  if (!r.ok) return fail(r)
  samples.value = r.samples
  currentId.value = r.sample.id
  baseId.value = null
  if (kind === 'cold') resetAt.value = null
}

async function clearHistory(): Promise<void> {
  const p = loadedPkg.value
  if (!p) return
  const r = await step('clear', () => perfClear(p))
  if (!r) return
  if (!r.ok) return fail(r)
  samples.value = []
  currentId.value = null
}

function fill(): void {
  const s = current.value
  if (!s) return
  const res = handoff.fillText(perfPrompt(s, base.value))
  error.value = null
  note.value = t(res === 'ok' ? 'devPerf.filled' : 'devPerf.noAgent')
}

function trap(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
    return
  }
  if (e.key !== 'Tab' || !dialog.value) return
  const focusables = [...dialog.value.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])')]
  const first = focusables[0]
  const last = focusables.at(-1)
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault()
    last?.focus()
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault()
    first?.focus()
  }
}

watch(
  () => props.open,
  async (open) => {
    gen++
    if (!open) {
      if (restoreFocus?.isConnected) restoreFocus.focus()
      restoreFocus = null
      return
    }
    restoreFocus = document.activeElement as HTMLElement | null
    samples.value = []
    loadedPkg.value = null
    currentId.value = null
    baseId.value = null
    resetAt.value = null
    error.value = null
    note.value = null
    try {
      pkg.value = localStorage.getItem(PKG_KEY) ?? ''
    } catch {
      pkg.value = ''
    }
    if (pkgOk.value) void load()
    await nextTick()
    dialog.value?.querySelector<HTMLElement>('[data-perf-pkg]')?.focus()
  },
  { immediate: true },
)
</script>

<template>
  <Teleport to="body">
    <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div v-if="open" class="fixed inset-0 z-50 flex items-start justify-center ccm-scrim px-4 py-[5vh]" @mousedown.self="emit('close')">
        <div
          ref="dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="device-perf-title"
          tabindex="-1"
          class="flex max-h-[86vh] w-full max-w-[920px] flex-col overflow-hidden ccm-sheet outline-none"
          data-device-perf
          @keydown="trap"
        >
          <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line py-2.5 pr-3 pl-4">
            <Gauge :size="16" class="shrink-0 text-ink-muted" aria-hidden="true" />
            <div class="mr-auto min-w-0">
              <h2 id="device-perf-title" class="truncate text-sm font-semibold">{{ t('devPerf.title', { name: deviceName }) }}</h2>
              <p class="truncate text-2xs text-ink-faint" :title="t('devPerf.hint')">{{ t('devPerf.hint') }}</p>
            </div>
            <form class="flex min-w-0 items-center gap-1.5" @submit.prevent="load">
              <input
                v-model="pkg"
                class="ccm-field w-56 min-w-0 font-mono text-xs"
                spellcheck="false"
                maxlength="255"
                :aria-label="t('devPerf.pkg')"
                :placeholder="t('devPerf.pkgPlaceholder')"
                data-perf-pkg
              />
              <button type="submit" class="ccm-btn" :disabled="!pkgOk || !!busy" data-perf-load>{{ t('devPerf.load') }}</button>
            </form>
            <button type="button" class="ccm-btn-plain" :title="t('devPerf.close')" :aria-label="t('devPerf.close')" data-perf-close @click="emit('close')">
              <X :size="14" aria-hidden="true" />
            </button>
          </div>

          <div class="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-4 py-2">
            <button type="button" class="ccm-btn" :disabled="!pkgOk || !!busy" :title="t('devPerf.resetHint')" data-perf-reset @click="reset">
              <LoaderCircle v-if="busy === 'reset'" :size="13" class="ccm-spin" aria-hidden="true" />
              <RotateCcw v-else :size="13" aria-hidden="true" />{{ t('devPerf.reset') }}
            </button>
            <button type="button" class="ccm-btn ccm-btn-primary" :disabled="!pkgOk || !!busy" :title="t('devPerf.measureHint')" data-perf-measure @click="run('measure')">
              <LoaderCircle v-if="busy === 'measure'" :size="13" class="ccm-spin" aria-hidden="true" />
              <Play v-else :size="13" aria-hidden="true" />{{ t('devPerf.measure') }}
            </button>
            <button type="button" class="ccm-btn" :disabled="!pkgOk || !!busy" :title="t('devPerf.coldHint')" data-perf-cold @click="run('cold')">
              <LoaderCircle v-if="busy === 'cold'" :size="13" class="ccm-spin" aria-hidden="true" />
              <Timer v-else :size="13" aria-hidden="true" />{{ t('devPerf.cold') }}
            </button>
            <button type="button" class="ccm-btn-plain ml-auto text-xs" :disabled="!current" :title="t('devPerf.fillHint')" data-perf-fill @click="fill">
              <Sparkles :size="13" aria-hidden="true" />{{ t('devPerf.fill') }}
            </button>
            <p class="w-full text-2xs text-ink-faint">{{ t('devPerf.flow') }}</p>
          </div>

          <div v-if="error || note" class="flex shrink-0 items-start gap-1.5 border-b border-line px-4 py-2 text-xs" :class="error ? 'bg-warning-soft' : 'bg-fill'" role="status" data-perf-message>
            <CircleAlert v-if="error" :size="14" class="mt-px shrink-0 text-warning" aria-hidden="true" />
            <p class="min-w-0 flex-1">
              {{ error ? errorText : note }}
              <span v-if="error?.detail" class="ml-1 line-clamp-2 font-mono text-2xs break-all text-ink-muted" :title="error.detail">{{ error.detail }}</span>
            </p>
          </div>

          <div class="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row">
            <section class="min-w-0 flex-1 px-4 py-3" data-perf-current>
              <p v-if="busy === 'load'" class="flex items-center gap-2 text-xs text-ink-muted"><LoaderCircle :size="13" class="ccm-spin" aria-hidden="true" />{{ t('devPerf.measuring') }}</p>
              <p v-else-if="!current" class="text-xs text-ink-faint" data-perf-empty>{{ loadedPkg ? t('devPerf.empty') : '' }}</p>
              <template v-else>
                <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                  <span class="font-medium">{{ t(`devPerf.kind.${current.kind}`) }}</span>
                  <span class="text-ink-muted tabular-nums">{{ stamp(current.at) }}</span>
                  <span v-if="current.sinceResetMs !== undefined" class="text-ink-muted" data-perf-since="reset">{{ t('devPerf.sinceReset', { s: Math.round(current.sinceResetMs / 1000) }) }}</span>
                  <span v-else-if="current.frames" class="text-ink-faint" data-perf-since="start">{{ t('devPerf.sinceStart') }}</span>
                </div>
                <label v-if="choices.length" class="mt-2 flex min-w-0 items-center gap-1.5 text-2xs text-ink-muted">
                  {{ t('devPerf.compareWith') }}
                  <select class="ccm-field max-w-72 min-w-0 text-xs" :value="base?.id ?? ''" data-perf-base @change="baseId = ($event.target as HTMLSelectElement).value">
                    <option v-for="s in choices" :key="s.id" :value="s.id">{{ stamp(s.at) }} · {{ t(`devPerf.kind.${s.kind}`) }}</option>
                  </select>
                </label>
                <p v-else class="mt-2 text-2xs text-ink-faint" data-perf-nocompare>{{ t('devPerf.noCompare') }}</p>

                <div v-for="grp in groups" :key="grp.g" class="mt-3" :data-perf-group="grp.g">
                  <h3 class="text-2xs font-semibold text-ink-faint">{{ t(`devPerf.group.${grp.g}`) }}</h3>
                  <p v-if="grp.g === 'frames' && current.frames" class="text-2xs text-ink-muted">{{ t('devPerf.frames', { total: current.frames.total, janky: current.frames.janky }) }}</p>
                  <p v-if="grp.g === 'cold' && current.coldStart?.launchState" class="text-2xs text-ink-muted">{{ t('devPerf.launchState', { state: current.coldStart.launchState }) }}</p>
                  <table class="mt-1 w-full table-fixed text-xs">
                    <tbody class="divide-y divide-line">
                      <tr v-for="m in grp.rows" :key="m.key" :data-perf-metric="m.key">
                        <td class="w-[38%] py-1 text-ink-muted">{{ t(`devPerf.metric.${m.key}`) }}</td>
                        <td class="w-[22%] py-1 text-right font-medium tabular-nums">{{ fmtValue(m.value, m.unit) }}</td>
                        <td class="py-1 pl-3">
                          <span v-if="deltas.get(m.key)" class="inline-flex items-center gap-1 text-2xs tabular-nums" :class="TREND[deltas.get(m.key)!.trend].cls" :data-perf-trend="deltas.get(m.key)!.trend">
                            <component :is="TREND[deltas.get(m.key)!.trend].icon" :size="12" aria-hidden="true" />
                            <template v-if="deltas.get(m.key)!.trend !== 'same'">{{ fmtDelta(deltas.get(m.key)!.delta, m.unit) }} · </template>{{ t(`devPerf.trend.${deltas.get(m.key)!.trend}`) }}
                          </span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </template>
            </section>

            <aside v-if="samples.length" class="w-full shrink-0 border-t border-line py-2 md:w-64 md:border-t-0 md:border-l" data-perf-history>
              <div class="flex items-center gap-2 px-3 pb-1">
                <h3 class="mr-auto text-2xs font-semibold text-ink-faint">{{ t('devPerf.history') }}</h3>
                <button type="button" class="ccm-btn-plain text-2xs" :disabled="!!busy" :title="t('devPerf.clear')" :aria-label="t('devPerf.clear')" data-perf-clear @click="clearHistory">
                  <Trash2 :size="12" aria-hidden="true" />
                </button>
              </div>
              <button
                v-for="s in samples"
                :key="s.id"
                type="button"
                class="flex min-h-8 w-full min-w-0 flex-col px-3 py-1 text-left text-xs"
                :class="s.id === current?.id ? 'bg-accent-soft text-accent-ink' : 'text-ink hover:bg-fill'"
                :aria-pressed="s.id === current?.id"
                :data-perf-sample="s.id"
                @click="currentId = s.id; baseId = null"
              >
                <span class="flex w-full items-center gap-1.5">
                  <component :is="s.kind === 'cold' ? Timer : Gauge" :size="12" class="shrink-0" aria-hidden="true" />
                  <span class="truncate">{{ t(`devPerf.kind.${s.kind}`) }}</span>
                  <span class="ml-auto shrink-0 text-2xs text-ink-faint tabular-nums" :title="stamp(s.at)">{{ when(s.at) }}</span>
                </span>
                <span class="truncate pl-4.5 text-2xs text-ink-muted tabular-nums">
                  <template v-if="s.frames">{{ fmtValue(s.frames.jankyPct, 'pct') }}</template>
                  <template v-if="s.memory"> · {{ fmtValue(s.memory.totalPss, 'kb') }}</template>
                  <template v-if="s.coldStart?.totalMs != null">{{ fmtValue(s.coldStart.totalMs, 'ms') }}</template>
                </span>
              </button>
            </aside>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
