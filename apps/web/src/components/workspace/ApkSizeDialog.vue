<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CircleAlert, FileSearch, GitCompare, LoaderCircle, Package, X } from 'lucide-vue-next'
import type { ApkDiff, ApkErrorCode, ApkGroupDelta, ApkReport, ApkSide, ApkSizes } from '@ccm/shared'
import { apkAnalyze, apkCompare, apkPick, barSegments, deltaClass, deltaOf, fmtDelta, fmtSize, groupColor } from '../../lib/apkSize'
import { relativeTime } from '../../lib/format'
import { retireOverlay } from '../../lib/motion'
import SegmentedControl from '../ui/SegmentedControl.vue'

const props = defineProps<{ path: string | null; root: string | null }>()
const emit = defineEmits<{ close: [] }>()

const { t, locale } = useI18n()

const dialog = ref<HTMLElement | null>(null)
const file = ref<string | null>(null)
const report = ref<ApkReport | null>(null)
const previous = ref<ApkSide | null>(null)
const prevDiff = ref<ApkDiff | null>(null)
const fileDiff = ref<ApkDiff | null>(null)
const mode = ref<'previous' | 'file'>('previous')
const loading = ref(false)
const comparing = ref(false)
const error = ref<ApkErrorCode | null>(null)
const by = ref<keyof ApkSizes>('compressed')
let gen = 0
let restoreFocus: HTMLElement | null = null

const size = (n: number) => fmtSize(n, locale.value)
const delta = (n: number) => fmtDelta(n, locale.value)
const byOptions = computed(() => [
  { value: 'compressed' as const, label: t('apkSize.compressed'), title: t('apkSize.compressedHint') },
  { value: 'size' as const, label: t('apkSize.uncompressed'), title: t('apkSize.uncompressedHint') },
])
const total = computed(() => (report.value ? report.value[by.value] : 0))
const segments = computed(() => (report.value ? barSegments(report.value.groups, by.value) : []))
const groupName = (g: { kind: string; sub: string | null }) => t(`apkSize.group.${g.kind}`, { sub: g.sub ?? '' })
const pct = (n: number) => (total.value ? `${((n / total.value) * 100).toLocaleString(locale.value, { maximumFractionDigits: 1 })}%` : '')
const diff = computed(() => (mode.value === 'file' ? fileDiff.value : prevDiff.value))
const diffGroups = computed(() => diff.value?.groups.filter((g) => deltaOf(g, by.value) !== 0 || g.before === null || g.after === null) ?? [])
const totalDelta = computed(() => (diff.value ? diff.value.after[by.value] - diff.value.before[by.value] : 0))
const versionText = computed(() => {
  const m = report.value?.manifest
  if (!m?.versionName && !m?.versionCode) return null
  return m.versionCode ? `${m.versionName ?? '?'} (${m.versionCode})` : m.versionName
})
const previousWhen = computed(() => (previous.value ? (relativeTime(previous.value.analyzedAt, locale.value, Date.now()) ?? '') : ''))
const fileLists = computed(() => {
  const d = diff.value
  if (!d) return []
  return [
    { key: 'added', label: t('apkSize.compare.added', { n: d.addedCount }), rows: d.added, more: d.addedCount - d.added.length },
    { key: 'removed', label: t('apkSize.compare.removed', { n: d.removedCount }), rows: d.removed, more: d.removedCount - d.removed.length },
    { key: 'changed', label: t('apkSize.compare.changed', { n: d.changedCount }), rows: d.changed, more: d.changedCount - d.changed.length },
  ].filter((l) => l.rows.length)
})
const groupDelta = (g: ApkGroupDelta) => deltaOf(g, by.value)

async function analyze(path: string): Promise<void> {
  const my = ++gen
  file.value = path
  loading.value = true
  error.value = null
  report.value = null
  previous.value = null
  prevDiff.value = null
  fileDiff.value = null
  mode.value = 'previous'
  try {
    const r = await apkAnalyze(path, props.root)
    if (my !== gen) return
    if (!r.ok) error.value = r.error
    else {
      report.value = r.report
      previous.value = r.previous
      prevDiff.value = r.diff
    }
  } finally {
    if (my === gen) loading.value = false
  }
}

async function pick(): Promise<void> {
  const p = await apkPick(props.root)
  if (p) await analyze(p)
}

async function compareWithFile(): Promise<void> {
  const cur = file.value
  if (!cur || comparing.value) return
  const other = await apkPick(props.root)
  if (!other) return
  const my = gen
  comparing.value = true
  error.value = null
  try {
    const r = await apkCompare(cur, other)
    if (my !== gen) return
    if (r.ok) {
      fileDiff.value = r.diff
      mode.value = 'file'
    } else error.value = r.error
  } finally {
    comparing.value = false
  }
}

function trap(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
    return
  }
  if (e.key !== 'Tab' || !dialog.value) return
  const focusables = [...dialog.value.querySelectorAll<HTMLElement>('button:not([disabled]), summary, [role="radio"][tabindex="0"]')]
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
  () => props.path,
  async (p) => {
    restoreFocus ??= document.activeElement as HTMLElement | null
    if (p) void analyze(p)
    await nextTick()
    dialog.value?.querySelector<HTMLElement>('[data-apk-close]')?.focus()
  },
  { immediate: true },
)

function close(): void {
  gen++
  if (restoreFocus?.isConnected) restoreFocus.focus()
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="ccm-dialog" appear @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div class="fixed inset-0 z-50 flex items-start justify-center ccm-scrim px-4 py-[5vh]" @mousedown.self="close">
        <div
          ref="dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="apk-size-title"
          class="flex max-h-[90vh] w-full max-w-[880px] flex-col overflow-hidden ccm-sheet"
          data-apk-size
          @keydown="trap"
        >
          <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line py-2.5 pr-3 pl-4">
            <Package :size="16" class="shrink-0 text-ink-muted" aria-hidden="true" />
            <div class="mr-auto min-w-0">
              <h2 id="apk-size-title" class="truncate text-sm font-semibold" :title="file ?? undefined">
                {{ report ? t('apkSize.title', { name: report.name }) : t('apkSize.titleEmpty') }}
              </h2>
              <p v-if="report" class="truncate text-2xs text-ink-faint">
                {{ report.kind.toUpperCase() }}<template v-if="versionText"> · {{ versionText }}</template> · {{ t('apkSize.fileSize') }} {{ size(report.fileSize) }} ·
                {{ t('apkSize.entries', { n: report.entries.toLocaleString(locale) }) }}
              </p>
            </div>
            <button type="button" class="ccm-btn" data-apk-pick @click="pick">
              <FileSearch :size="13" aria-hidden="true" />{{ t('apkSize.pick') }}
            </button>
            <button type="button" class="ccm-btn-plain" :title="t('apkSize.close')" :aria-label="t('apkSize.close')" data-apk-close @click="close">
              <X :size="14" aria-hidden="true" />
            </button>
          </div>

          <div v-if="error" class="flex shrink-0 items-start gap-1.5 border-b border-line bg-warning-soft px-4 py-2 text-xs" role="alert" data-apk-error>
            <CircleAlert :size="14" class="mt-px shrink-0 text-warning" aria-hidden="true" />
            <p class="min-w-0 flex-1">{{ t(`apkSize.error.${error}`) }}</p>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <p v-if="loading" class="flex items-center gap-2 text-xs text-ink-muted" role="status">
              <LoaderCircle :size="13" class="ccm-spin" aria-hidden="true" />{{ t('apkSize.loading') }}
            </p>
            <div v-else-if="!report && !error" class="flex flex-col items-center gap-3 py-10 text-center" data-apk-empty>
              <Package :size="22" class="text-ink-faint" aria-hidden="true" />
              <p class="max-w-[52ch] text-sm text-ink-muted">{{ t('apkSize.empty') }}</p>
              <button type="button" class="ccm-btn ccm-btn-primary" @click="pick">
                <FileSearch :size="13" aria-hidden="true" />{{ t('apkSize.pick') }}
              </button>
            </div>

            <template v-if="report && !loading">
              <div class="flex flex-wrap items-end gap-x-6 gap-y-2">
                <div class="min-w-0">
                  <p class="text-2xl font-semibold tabular-nums" data-apk-total>{{ size(total) }}</p>
                  <p v-if="report.dexMethods !== null" class="text-2xs text-ink-faint">
                    {{ t('apkSize.dex', { n: report.dexMethods.toLocaleString(locale), files: report.dexFiles }) }}
                  </p>
                </div>
                <div class="ml-auto flex items-center gap-2 text-2xs text-ink-muted">
                  <span>{{ t('apkSize.by') }}</span>
                  <SegmentedControl v-model="by" :options="byOptions" :label="t('apkSize.by')" data-apk-by />
                </div>
              </div>

              <div class="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-fill" role="img" :aria-label="segments.map((s) => `${groupName(s)} ${size(s.value)}`).join(', ')" data-apk-bar>
                <span v-for="s in segments" :key="s.id" class="h-full min-w-px border-r border-surface last:border-r-0" :class="groupColor(s.kind)" :style="{ width: `${s.pct}%` }" :title="`${groupName(s)}: ${size(s.value)} (${s.pct.toFixed(1)}%)`" />
              </div>

              <section class="mt-4" :aria-label="t('apkSize.groups')" data-apk-groups>
                <h3 class="text-2xs font-semibold text-ink-faint">{{ t('apkSize.groups') }}</h3>
                <table class="mt-1 w-full table-fixed text-xs">
                  <thead class="text-2xs text-ink-faint">
                    <tr class="text-left">
                      <th class="py-1 font-medium">{{ t('apkSize.colName') }}</th>
                      <th class="w-16 py-1 text-right font-medium">{{ t('apkSize.colFiles') }}</th>
                      <th class="w-24 py-1 text-right font-medium">{{ by === 'compressed' ? t('apkSize.compressed') : t('apkSize.uncompressed') }}</th>
                      <th class="w-16 py-1 text-right font-medium">{{ t('apkSize.colShare') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-line">
                    <tr v-for="g in report.groups" :key="g.id">
                      <td class="truncate py-1">
                        <span class="mr-1.5 inline-block size-2.5 rounded-sm align-middle" :class="groupColor(g.kind)" aria-hidden="true" />{{ groupName(g) }}
                      </td>
                      <td class="py-1 text-right text-ink-muted tabular-nums">{{ g.files.toLocaleString(locale) }}</td>
                      <td class="py-1 text-right tabular-nums">{{ size(g[by]) }}</td>
                      <td class="py-1 text-right text-ink-muted tabular-nums">{{ pct(g[by]) }}</td>
                    </tr>
                  </tbody>
                </table>
              </section>

              <section class="mt-4" :aria-label="t('apkSize.compare.title')" data-apk-compare>
                <div class="flex flex-wrap items-center gap-2">
                  <h3 class="mr-auto text-2xs font-semibold text-ink-faint">{{ t('apkSize.compare.title') }}</h3>
                  <button v-if="prevDiff" type="button" class="ccm-btn" :aria-pressed="mode === 'previous'" :class="mode === 'previous' ? 'bg-accent-soft! text-accent-ink!' : ''" data-apk-prev @click="mode = 'previous'">
                    <GitCompare :size="13" aria-hidden="true" />{{ t('apkSize.compare.previous') }}
                  </button>
                  <button type="button" class="ccm-btn" :disabled="comparing" data-apk-with @click="compareWithFile">
                    <LoaderCircle v-if="comparing" :size="13" class="ccm-spin" aria-hidden="true" />
                    <FileSearch v-else :size="13" aria-hidden="true" />{{ t('apkSize.compare.withFile') }}
                  </button>
                </div>
                <p v-if="!diff" class="mt-1.5 text-2xs text-ink-faint">{{ t('apkSize.compare.none') }}</p>
                <template v-else>
                  <p class="mt-1.5 text-2xs text-ink-muted">
                    {{ t('apkSize.compare.against', { name: diff.before.name }) }}
                    <template v-if="mode === 'previous' && previous"> · {{ t('apkSize.compare.previousHint', { name: previous.versionName ?? previous.name, when: previousWhen }) }}</template>
                  </p>
                  <table class="mt-1 w-full table-fixed text-xs" data-apk-diff>
                    <thead class="text-2xs text-ink-faint">
                      <tr class="text-left">
                        <th class="py-1 font-medium">{{ t('apkSize.colName') }}</th>
                        <th class="w-24 py-1 text-right font-medium">{{ t('apkSize.compare.before') }}</th>
                        <th class="w-24 py-1 text-right font-medium">{{ t('apkSize.compare.after') }}</th>
                        <th class="w-24 py-1 text-right font-medium">{{ t('apkSize.compare.change') }}</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-line">
                      <tr class="font-medium">
                        <td class="py-1">{{ t('apkSize.compare.total') }}</td>
                        <td class="py-1 text-right tabular-nums">{{ size(diff.before[by]) }}</td>
                        <td class="py-1 text-right tabular-nums">{{ size(diff.after[by]) }}</td>
                        <td class="py-1 text-right tabular-nums" :class="deltaClass(totalDelta)">{{ delta(totalDelta) }}</td>
                      </tr>
                      <tr v-for="g in diffGroups" :key="g.id">
                        <td class="truncate py-1">
                          <span class="mr-1.5 inline-block size-2.5 rounded-sm align-middle" :class="groupColor(g.kind)" aria-hidden="true" />{{ groupName(g) }}
                        </td>
                        <td class="py-1 text-right text-ink-muted tabular-nums">{{ g.before ? size(g.before[by]) : '—' }}</td>
                        <td class="py-1 text-right tabular-nums">{{ g.after ? size(g.after[by]) : '—' }}</td>
                        <td class="py-1 text-right tabular-nums" :class="deltaClass(groupDelta(g))">{{ delta(groupDelta(g)) }}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p v-if="!fileLists.length" class="mt-1.5 text-2xs text-ink-faint">{{ t('apkSize.compare.noFiles') }}</p>
                  <details v-for="l in fileLists" :key="l.key" class="mt-2 rounded-control bg-fill px-2 py-1" :data-apk-files="l.key">
                    <summary class="cursor-pointer text-xs text-ink">{{ l.label }}</summary>
                    <ul class="mt-1 divide-y divide-line">
                      <li v-for="f in l.rows" :key="f.name" class="flex min-w-0 items-center gap-2 py-0.5 text-2xs">
                        <span class="min-w-0 flex-1 truncate font-mono" :title="f.name">{{ f.name }}</span>
                        <span class="shrink-0 tabular-nums" :class="deltaClass(deltaOf(f, by))">{{ delta(deltaOf(f, by)) }}</span>
                      </li>
                    </ul>
                    <p v-if="l.more > 0" class="py-0.5 text-2xs text-ink-faint">{{ t('apkSize.compare.more', { n: l.more }) }}</p>
                  </details>
                </template>
              </section>

              <section class="mt-4" :aria-label="t('apkSize.top')" data-apk-top>
                <h3 class="text-2xs font-semibold text-ink-faint">{{ t('apkSize.top') }}</h3>
                <table class="mt-1 w-full table-fixed text-xs">
                  <thead class="text-2xs text-ink-faint">
                    <tr class="text-left">
                      <th class="py-1 font-medium">{{ t('apkSize.colName') }}</th>
                      <th class="w-24 py-1 text-right font-medium">{{ t('apkSize.compressed') }}</th>
                      <th class="w-24 py-1 text-right font-medium">{{ t('apkSize.uncompressed') }}</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-line">
                    <tr v-for="f in report.top" :key="f.name">
                      <td class="truncate py-1 font-mono text-2xs" :title="f.name">{{ f.name }}</td>
                      <td class="py-1 text-right tabular-nums">{{ size(f.compressed) }}</td>
                      <td class="py-1 text-right text-ink-muted tabular-nums">{{ size(f.size) }}</td>
                    </tr>
                  </tbody>
                </table>
              </section>

              <section class="mt-4" :aria-label="t('apkSize.manifest.title')" data-apk-manifest>
                <h3 class="text-2xs font-semibold text-ink-faint">{{ t('apkSize.manifest.title') }}</h3>
                <p v-if="!report.manifest" class="mt-1 text-2xs text-ink-faint">{{ t('apkSize.manifest.missing') }}</p>
                <dl v-else class="mt-1 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
                  <dt class="text-ink-muted">{{ t('apkSize.manifest.pkg') }}</dt>
                  <dd class="truncate font-mono">{{ report.manifest.pkg ?? '—' }}</dd>
                  <dt class="text-ink-muted">{{ t('apkSize.manifest.version') }}</dt>
                  <dd class="truncate">
                    {{ versionText ?? '—' }}
                    <span v-if="report.manifest.debuggable" class="ml-1.5 rounded-full bg-warning-soft px-1.5 text-2xs text-ink">{{ t('apkSize.manifest.debuggable') }}</span>
                  </dd>
                  <dt class="text-ink-muted">{{ t('apkSize.manifest.sdk') }}</dt>
                  <dd class="truncate">
                    {{ t('apkSize.manifest.sdkValue', { min: report.manifest.minSdk ?? '?', target: report.manifest.targetSdk ?? '?' }) }}
                    <template v-if="report.manifest.compileSdk"> · {{ t('apkSize.manifest.compile', { n: report.manifest.compileSdk }) }}</template>
                  </dd>
                </dl>
                <details v-if="report.manifest" class="mt-2 rounded-control bg-fill px-2 py-1" data-apk-perms>
                  <summary class="cursor-pointer text-xs text-ink">{{ t('apkSize.manifest.permissions', { n: report.manifest.permissions.length }) }}</summary>
                  <p v-if="!report.manifest.permissions.length" class="py-0.5 text-2xs text-ink-faint">{{ t('apkSize.manifest.none') }}</p>
                  <ul v-else class="mt-1 columns-1 text-2xs sm:columns-2">
                    <li v-for="p in report.manifest.permissions" :key="p" class="truncate font-mono" :title="p">{{ p }}</li>
                  </ul>
                </details>
              </section>
            </template>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
