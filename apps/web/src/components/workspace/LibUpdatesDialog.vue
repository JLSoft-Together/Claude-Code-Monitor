<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowUpCircle, ChevronDown, ChevronRight, CircleAlert, CircleCheck, CircleHelp, ExternalLink, PackageSearch, RefreshCw, Send, ShieldAlert, ShieldCheck, TriangleAlert, X } from 'lucide-vue-next'
import { VULN_RANK, worstSeverity, type LibCheckResult, type LibVuln, type LibVulnResult, type VulnSeverity } from '@ccm/shared'
import { baseName, openExternal, readFile } from '../../lib/preview'
import {
  depFileKind,
  fixedAll,
  hasLibsVulns,
  libKey,
  libPage,
  libRows,
  libsCheck,
  libsVulns,
  osvPage,
  parseDepFile,
  queriesOf,
  rowVulns,
  sortVulns,
  upgradePrompt,
  vulnMap,
  vulnQueriesOf,
  type Dep,
  type LibRow,
} from '../../lib/libVersions'
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
const vulnRes = shallowRef<LibVulnResult | null>(null)
const vulnChecking = ref(false)
const vulnOnly = ref(false)
const opened = ref(new Set<string>())
let gen = 0
let vulnGen = 0

const rel = computed(() => {
  const a = props.path.replace(/\\/g, '/')
  const b = props.root.replace(/\\/g, '/').replace(/\/$/, '')
  return a.toLowerCase().startsWith(`${b.toLowerCase()}/`) ? a.slice(b.length + 1) : baseName(props.path)
})
const rows = computed<LibRow[]>(() => libRows(deps.value ?? [], result.value?.ok ? result.value.results : null))
const vmap = computed(() => vulnMap(vulnRes.value?.ok ? vulnRes.value.results : null))
const vulnsOf = (r: LibRow): LibVuln[] => {
  const l = rowVulns(r, vmap.value)
  return l?.ok ? l.vulns : []
}
const shown = computed(() => rows.value.filter((r) => (!outdatedOnly.value || r.status === 'outdated') && (!vulnOnly.value || vulnsOf(r).length > 0)))
const outdated = computed(() => rows.value.filter((r) => r.status === 'outdated').length)
const vulnerable = computed(() => rows.value.filter((r) => vulnsOf(r).length > 0).length)
const vulnAsked = computed(() => vulnChecking.value || vulnRes.value !== null)
const rowId = (r: LibRow): string => `${libKey(r)}@${r.line}`

async function checkVulns(fresh: boolean): Promise<void> {
  const list = deps.value
  if (!list?.length) return
  const my = ++vulnGen
  vulnChecking.value = true
  const res = await libsVulns(vulnQueriesOf(list), fresh)
  if (my !== vulnGen) return
  vulnRes.value = res
  vulnChecking.value = false
}

function recheck(): void {
  void check(true)
  if (vulnAsked.value) void checkVulns(true)
}

function toggleOpen(r: LibRow): void {
  const next = new Set(opened.value)
  if (!next.delete(rowId(r))) next.add(rowId(r))
  opened.value = next
}

function openAdvisory(id: string): void {
  const url = osvPage(id)
  if (url) void openExternal(url)
}

const sevClass = (s: VulnSeverity | null): string => (s && VULN_RANK[s] >= VULN_RANK.high ? 'text-warning' : 'text-ink-muted')

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
  const text = upgradePrompt(
    rel.value,
    rows.value.filter((r) => picked.value.has(rowId(r))),
    vmap.value,
  )
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
          <span v-if="vulnRes?.ok" class="tabular inline-flex shrink-0 items-center gap-1 text-2xs" :class="vulnerable ? 'text-warning' : 'text-success'" data-libs-vulns-summary>
            <ShieldAlert v-if="vulnerable" :size="12" aria-hidden="true" /><ShieldCheck v-else :size="12" aria-hidden="true" />{{ t('libVulns.summary', { n: vulnerable }, vulnerable) }}
          </span>
          <span class="flex-1" />
          <label v-if="rows.length" class="flex shrink-0 cursor-pointer items-center gap-1.5 text-2xs text-ink-muted">
            <input v-model="outdatedOnly" type="checkbox" class="accent-(--ccm-accent)" data-libs-outdated-only />
            {{ t('libUpdates.outdatedOnly') }}
          </label>
          <label v-if="vulnRes?.ok" class="flex shrink-0 cursor-pointer items-center gap-1.5 text-2xs text-ink-muted">
            <input v-model="vulnOnly" type="checkbox" class="accent-(--ccm-accent)" data-libs-vulnerable-only />
            {{ t('libVulns.vulnerableOnly') }}
          </label>
          <button
            v-if="hasLibsVulns && rows.length"
            type="button"
            class="ccm-btn shrink-0"
            :title="vulnAsked ? t('libVulns.recheck') : t('libVulns.checkHint')"
            :disabled="vulnChecking"
            data-libs-vulns
            @click="checkVulns(vulnAsked)"
          >
            <ShieldAlert :size="13" aria-hidden="true" />{{ t('libVulns.check') }}
          </button>
          <button v-if="rows.length" type="button" class="ccm-btn shrink-0" :title="t('libUpdates.fillHint')" :disabled="!picked.size" data-libs-fill @click="fill">
            <Send :size="13" aria-hidden="true" />{{ t('libUpdates.fill') }}
          </button>
          <button type="button" class="ccm-btn-plain shrink-0" :title="t('libUpdates.recheck')" :aria-label="t('libUpdates.recheck')" :disabled="checking || !rows.length" data-libs-recheck @click="recheck">
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
        <p v-if="vulnRes && !vulnRes.ok" class="flex shrink-0 items-center gap-1.5 border-b border-line bg-warning-soft px-3 py-1.5 text-2xs text-warning" role="status" data-libs-vulns-error>
          <CircleAlert :size="12" class="shrink-0" aria-hidden="true" />{{ t(`libVulns.error.${vulnRes.error}`) }}
        </p>
        <div v-if="deps?.length && !readFailed && !(result && !result.ok)" class="ccm-scroll min-h-0 flex-1 overflow-auto overscroll-contain">
          <table class="w-full border-separate border-spacing-0 text-xs">
            <thead class="sticky top-0 z-10 bg-surface text-left text-2xs text-ink-muted">
              <tr>
                <th class="w-8 border-b border-line py-1.5 pl-3" />
                <th class="border-b border-line px-2 py-1.5 font-medium">{{ t('libUpdates.lib') }}</th>
                <th class="border-b border-line px-2 py-1.5 font-medium">{{ t('libUpdates.current') }}</th>
                <th class="border-b border-line px-2 py-1.5 font-medium">{{ t('libUpdates.latest') }}</th>
                <th class="border-b border-line px-2 py-1.5 font-medium">{{ t('libUpdates.bump') }}</th>
                <th v-if="vulnAsked" class="border-b border-line px-2 py-1.5 font-medium">{{ t('libVulns.column') }}</th>
                <th class="w-9 border-b border-line" />
              </tr>
            </thead>
            <tbody>
              <template v-for="r in shown" :key="rowId(r)">
              <tr class="hover:bg-fill" :data-lib-row="r.name" :data-lib-status="r.status" :data-lib-bump="r.bump">
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
                <td v-if="vulnAsked" class="border-b border-line px-2 py-1 whitespace-nowrap" :data-lib-vulns="vulnsOf(r).length">
                  <button
                    v-if="vulnsOf(r).length"
                    type="button"
                    class="inline-flex cursor-pointer items-center gap-1 text-left"
                    :class="sevClass(worstSeverity(vulnsOf(r)))"
                    :aria-expanded="opened.has(rowId(r))"
                    :title="t('libVulns.show', { name: label(r) })"
                    data-lib-vulns-toggle
                    @click="toggleOpen(r)"
                  >
                    <component :is="opened.has(rowId(r)) ? ChevronDown : ChevronRight" :size="12" aria-hidden="true" />
                    <ShieldAlert :size="12" aria-hidden="true" />
                    <span class="tabular">{{ t('libVulns.count', { n: vulnsOf(r).length }, vulnsOf(r).length) }}</span>
                    <span>· {{ t(`libVulns.severity.${worstSeverity(vulnsOf(r)) ?? 'unknown'}`) }}</span>
                  </button>
                  <div v-if="vulnsOf(r).length" class="pl-4 font-mono text-2xs text-ink-faint" data-lib-vulns-fixed>
                    {{ fixedAll(vulnsOf(r)) ? t('libVulns.fixedIn', { v: fixedAll(vulnsOf(r)) }) : t('libVulns.noFix') }}
                  </div>
                  <span v-else-if="rowVulns(r, vmap)?.ok" class="inline-flex items-center gap-1 text-success"><ShieldCheck :size="12" aria-hidden="true" />{{ t('libVulns.clean') }}</span>
                  <span v-else-if="vulnChecking" class="text-ink-faint">…</span>
                  <span v-else class="text-ink-faint">—</span>
                </td>
                <td class="border-b border-line pr-2 text-right">
                  <button type="button" class="ccm-btn-plain" :title="t('libUpdates.open', { name: label(r) })" :aria-label="t('libUpdates.open', { name: label(r) })" data-lib-open @click="openPage(r)">
                    <ExternalLink :size="13" aria-hidden="true" />
                  </button>
                </td>
              </tr>
              <tr v-if="vulnAsked && opened.has(rowId(r)) && vulnsOf(r).length" :data-lib-advisories="r.name">
                <td class="border-b border-line" />
                <td :colspan="6" class="border-b border-line bg-raised px-2 py-1.5">
                  <ul class="flex flex-col gap-1">
                    <li v-for="v in sortVulns(vulnsOf(r))" :key="v.id" class="flex min-w-0 items-baseline gap-2" :data-lib-advisory="v.id">
                      <span class="w-24 shrink-0 text-2xs" :class="sevClass(v.severity)">{{ t(`libVulns.severity.${v.severity}`) }}</span>
                      <button type="button" class="shrink-0 cursor-pointer font-mono text-link hover:underline" :title="t('libVulns.openAdvisory', { id: v.id })" @click="openAdvisory(v.id)">{{ v.id }}</button>
                      <span class="min-w-0 flex-1 truncate" :class="v.summary ? 'text-ink' : 'text-ink-faint'" :title="[v.summary, ...v.aliases].filter(Boolean).join(' · ')">{{ v.summary || t('libVulns.noSummary') }}</span>
                      <span class="shrink-0 font-mono text-2xs text-ink-faint">{{ v.fixed ? t('libVulns.fixedIn', { v: v.fixed }) : t('libVulns.noFix') }}</span>
                    </li>
                  </ul>
                </td>
              </tr>
              </template>
            </tbody>
          </table>
        </div>

        <footer class="flex h-9 shrink-0 items-center gap-2 border-t border-line px-3 text-2xs">
          <span v-if="checking" class="min-w-0 flex-1 truncate text-ink-muted" role="status">{{ t('libUpdates.loading') }}</span>
          <span v-else-if="vulnChecking" class="min-w-0 flex-1 truncate text-ink-muted" role="status">{{ t('libVulns.loading') }}</span>
          <span v-else-if="notice" class="min-w-0 flex-1 truncate" :class="notice.warn ? 'text-warning' : 'text-ink-muted'" role="status" data-libs-notice>{{ notice.text }}</span>
          <span v-else class="min-w-0 flex-1 truncate text-ink-faint" :title="`${t('libUpdates.note')} ${t('libVulns.note')}`">{{ t('libUpdates.note') }}</span>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
