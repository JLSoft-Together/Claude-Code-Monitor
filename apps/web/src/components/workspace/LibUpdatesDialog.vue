<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowUpCircle, CircleAlert, CircleCheck, CircleHelp, ExternalLink, PackageSearch, RefreshCw, Send, TriangleAlert, X } from 'lucide-vue-next'
import type { LibCheckResult } from '@ccm/shared'
import { baseName, openExternal, readFile } from '../../lib/preview'
import { depFileKind, libKey, libPage, libRows, libsCheck, parseDepFile, queriesOf, upgradePrompt, type Dep, type LibRow } from '../../lib/libVersions'
import { handoffPaneFor } from '../../lib/runUi'
import { useUiStore } from '../../stores/ui'
import { useWorkspaceStore } from '../../stores/workspace'

const props = defineProps<{ path: string; root: string }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const workspace = useWorkspaceStore()
const ui = useUiStore()

const deps = shallowRef<Dep[] | null>(null)
const readFailed = ref(false)
const result = shallowRef<LibCheckResult | null>(null)
const checking = ref(false)
const outdatedOnly = ref(false)
const picked = ref(new Set<string>())
const notice = ref<{ text: string; warn: boolean } | null>(null)
const card = ref<HTMLElement | null>(null)
let gen = 0

const rel = computed(() => {
  const a = props.path.replace(/\\/g, '/')
  const b = props.root.replace(/\\/g, '/').replace(/\/$/, '')
  return a.toLowerCase().startsWith(`${b.toLowerCase()}/`) ? a.slice(b.length + 1) : baseName(props.path)
})
const rows = computed<LibRow[]>(() => libRows(deps.value ?? [], result.value?.ok ? result.value.results : null))
const shown = computed(() => (outdatedOnly.value ? rows.value.filter((r) => r.status === 'outdated') : rows.value))
const outdated = computed(() => rows.value.filter((r) => r.status === 'outdated').length)
const rowId = (r: LibRow): string => `${libKey(r)}@${r.line}`

async function check(fresh: boolean): Promise<void> {
  const list = deps.value
  if (!list?.length) return
  const my = ++gen
  checking.value = true
  const res = await libsCheck(queriesOf(list), fresh)
  if (my !== gen) return
  result.value = res
  checking.value = false
  if (res.ok) picked.value = new Set(libRows(list, res.results).filter((r) => r.status === 'outdated').map(rowId))
}

onMounted(async () => {
  const kind = depFileKind(baseName(props.path))
  const view = await readFile(props.path)
  if (!kind || !view || view.kind !== 'text' || view.text === undefined) {
    readFailed.value = true
    deps.value = []
  } else deps.value = parseDepFile(kind, view.text)
  await nextTick()
  card.value?.focus()
  await check(false)
})

function togglePick(r: LibRow): void {
  const next = new Set(picked.value)
  if (!next.delete(rowId(r))) next.add(rowId(r))
  picked.value = next
}

function openPage(r: LibRow): void {
  const url = libPage(r.eco, r.name, r.lookup?.ok ? r.lookup.registry : null)
  if (url) void openExternal(url)
}

function openLine(r: LibRow): void {
  emit('close')
  workspace.openFile(props.path, r.line, { cwd: props.root })
}

function fill(): void {
  const text = upgradePrompt(rel.value, rows.value.filter((r) => picked.value.has(rowId(r))))
  if (!text) {
    notice.value = { text: t('libUpdates.nothingPicked'), warn: true }
    return
  }
  const pane = handoffPaneFor(workspace.panes, props.root)
  if (!pane) {
    notice.value = { text: t('libUpdates.noAgent'), warn: true }
    return
  }
  workspace.insertInto(pane.key, text)
  if (ui.view !== 'workspace') ui.setView('workspace')
  notice.value = { text: t('libUpdates.filled', { name: pane.title ?? baseName(pane.cwd ?? '') }), warn: false }
}

const label = (r: LibRow): string => r.plugin ?? r.name

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape' && !e.defaultPrevented) {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 grid place-items-center ccm-scrim p-4" data-libs-layer @pointerdown.self="emit('close')" @keydown="onKey">
      <div
        ref="card"
        tabindex="-1"
        class="ccm-sheet flex h-[min(84vh,760px)] w-[min(94vw,960px)] flex-col overflow-hidden outline-none"
        role="dialog"
        aria-modal="true"
        :aria-label="t('libUpdates.title')"
        data-lib-updates
      >
        <header class="flex h-11 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3">
          <PackageSearch :size="14" class="shrink-0 text-ink-muted" aria-hidden="true" />
          <h2 class="min-w-0 shrink truncate text-sm font-semibold text-ink" :title="path">{{ t('libUpdates.titleOf', { name: rel }) }}</h2>
          <span v-if="result?.ok" class="tabular inline-flex shrink-0 items-center gap-1 text-2xs" :class="outdated ? 'text-accent-ink' : 'text-ink-faint'" data-libs-summary>
            <ArrowUpCircle v-if="outdated" :size="12" aria-hidden="true" />{{ t('libUpdates.summary', { n: outdated }, outdated) }}
          </span>
          <span class="flex-1" />
          <label v-if="rows.length" class="flex shrink-0 cursor-pointer items-center gap-1.5 text-2xs text-ink-muted">
            <input v-model="outdatedOnly" type="checkbox" class="accent-(--ccm-accent)" data-libs-outdated-only />
            {{ t('libUpdates.outdatedOnly') }}
          </label>
          <button v-if="rows.length" type="button" class="ccm-btn shrink-0" :title="t('libUpdates.fillHint')" :disabled="!picked.size" data-libs-fill @click="fill">
            <Send :size="13" aria-hidden="true" />{{ t('libUpdates.fill') }}
          </button>
          <button type="button" class="ccm-btn-plain shrink-0" :title="t('libUpdates.recheck')" :aria-label="t('libUpdates.recheck')" :disabled="checking || !rows.length" data-libs-recheck @click="check(true)">
            <RefreshCw :size="14" :class="checking ? 'ccm-spin' : ''" aria-hidden="true" />
          </button>
          <button type="button" class="ccm-btn-plain shrink-0" :title="t('libUpdates.close')" :aria-label="t('libUpdates.close')" @click="emit('close')">
            <X :size="14" aria-hidden="true" />
          </button>
        </header>

        <div v-if="deps === null" class="grid flex-1 place-items-center text-xs text-ink-muted" role="status">{{ t('libUpdates.reading') }}</div>
        <p v-else-if="readFailed" class="p-4 text-xs text-warning" role="status">{{ t('libUpdates.readError') }}</p>
        <p v-else-if="!deps.length" class="p-4 text-xs text-ink-muted" data-libs-empty>{{ t('libUpdates.none') }}</p>
        <p v-else-if="result && !result.ok" class="p-4 text-xs text-warning" role="status" data-libs-error>{{ t(`libUpdates.error.${result.error}`) }}</p>
        <div v-else class="ccm-scroll min-h-0 flex-1 overflow-auto overscroll-contain">
          <table class="w-full border-separate border-spacing-0 text-xs">
            <thead class="sticky top-0 z-10 bg-surface text-left text-2xs text-ink-muted">
              <tr>
                <th class="w-8 border-b border-line py-1.5 pl-3" />
                <th class="border-b border-line px-2 py-1.5 font-medium">{{ t('libUpdates.lib') }}</th>
                <th class="border-b border-line px-2 py-1.5 font-medium">{{ t('libUpdates.current') }}</th>
                <th class="border-b border-line px-2 py-1.5 font-medium">{{ t('libUpdates.latest') }}</th>
                <th class="border-b border-line px-2 py-1.5 font-medium">{{ t('libUpdates.bump') }}</th>
                <th class="w-9 border-b border-line" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in shown" :key="rowId(r)" class="hover:bg-fill" :data-lib-row="r.name" :data-lib-status="r.status" :data-lib-bump="r.bump">
                <td class="border-b border-line py-1 pl-3 align-middle">
                  <input
                    v-if="r.status === 'outdated'"
                    type="checkbox"
                    class="accent-(--ccm-accent)"
                    :checked="picked.has(rowId(r))"
                    :aria-label="t('libUpdates.pick', { name: label(r) })"
                    data-lib-pick
                    @change="togglePick(r)"
                  />
                </td>
                <td class="max-w-0 border-b border-line px-2 py-1">
                  <button type="button" class="block w-full min-w-0 cursor-pointer truncate text-left font-mono text-ink" :title="t('libUpdates.openFile', { line: r.line })" @click="openLine(r)">{{ label(r) }}</button>
                  <div v-if="r.plugin || r.ref" class="truncate text-2xs text-ink-faint">
                    {{ r.plugin ? t('libUpdates.plugin') : '' }}{{ r.plugin && r.ref ? ' · ' : '' }}{{ r.ref ? t('libUpdates.ref', { ref: r.ref }) : '' }}
                  </div>
                </td>
                <td class="border-b border-line px-2 py-1 font-mono whitespace-nowrap text-ink-muted tabular" :title="r.spec">{{ r.spec }}</td>
                <td class="border-b border-line px-2 py-1 font-mono whitespace-nowrap tabular">
                  <span v-if="checking && !r.lookup" class="text-ink-faint">…</span>
                  <template v-else-if="r.latest">
                    <span class="text-ink">{{ r.latest }}</span>
                    <span v-if="r.latestPre" class="ml-1 rounded-full bg-fill px-1.5 font-sans text-2xs text-ink-muted">{{ t('libUpdates.latestPre') }}</span>
                  </template>
                </td>
                <td class="border-b border-line px-2 py-1 whitespace-nowrap">
                  <span v-if="r.status === 'outdated' && r.bump === 'major'" class="inline-flex items-center gap-1 text-warning" :title="t('libUpdates.majorHint')">
                    <TriangleAlert :size="12" aria-hidden="true" />{{ t('libUpdates.kind.major') }}
                  </span>
                  <span v-else-if="r.status === 'outdated'" class="inline-flex items-center gap-1 text-accent-ink"><ArrowUpCircle :size="12" aria-hidden="true" />{{ t(`libUpdates.kind.${r.bump}`) }}</span>
                  <span v-else-if="r.status === 'current'" class="inline-flex items-center gap-1 text-success"><CircleCheck :size="12" aria-hidden="true" />{{ t('libUpdates.kind.none') }}</span>
                  <span v-else-if="r.status === 'error' && r.lookup && !r.lookup.ok" class="inline-flex items-center gap-1 text-ink-muted">
                    <CircleAlert :size="12" aria-hidden="true" />{{ t(`libUpdates.status.error.${r.lookup.error}`) }}
                  </span>
                  <span v-else-if="!checking" class="inline-flex items-center gap-1 text-ink-faint"><CircleHelp :size="12" aria-hidden="true" />{{ t('libUpdates.status.unknown') }}</span>
                </td>
                <td class="border-b border-line pr-2 text-right">
                  <button type="button" class="ccm-btn-plain" :title="t('libUpdates.open', { name: label(r) })" :aria-label="t('libUpdates.open', { name: label(r) })" data-lib-open @click="openPage(r)">
                    <ExternalLink :size="13" aria-hidden="true" />
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <footer class="flex h-9 shrink-0 items-center gap-2 border-t border-line px-3 text-2xs">
          <span v-if="checking" class="min-w-0 flex-1 truncate text-ink-muted" role="status">{{ t('libUpdates.loading') }}</span>
          <span v-else-if="notice" class="min-w-0 flex-1 truncate" :class="notice.warn ? 'text-warning' : 'text-ink-muted'" role="status" data-libs-notice>{{ notice.text }}</span>
          <span v-else class="min-w-0 flex-1 truncate text-ink-faint" :title="t('libUpdates.note')">{{ t('libUpdates.note') }}</span>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
