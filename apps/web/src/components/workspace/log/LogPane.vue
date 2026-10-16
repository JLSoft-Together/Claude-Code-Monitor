<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, X } from 'lucide-vue-next'
import type { BranchOpResult, CommitFile } from '@ccm/shared'
import { absoluteIn, fileStepKey, scrollSideways } from '../../../lib/changesView'
import { grammarFor } from '../../../lib/codeView'
import { parseUnifiedDiff, type DiffFile } from '../../../lib/diff'
import { viewBlocks } from '../../../lib/diffBlocks'
import { hideImportChanges } from '../../../lib/diffImports'
import { readDiffOpts } from '../../../lib/diffOpts'
import { expandableIds, type RefRow } from '../../../lib/gitRefs'
import { hasFilters } from '../../../lib/logQuery'
import { gitBranchCreate, gitBranchDelete, gitBranchUpdate, gitFetch, hasBranchOps, logDiff } from '../../../lib/preview'
import { readFavorites, readRefsView, writeFavorites, writeRefsView } from '../../../lib/refPrefs'
import { useGitLog } from '../../../composables/useGitLog'
import DiffView from '../DiffView.vue'
import LogCommitDetails from './LogCommitDetails.vue'
import LogCommitFiles from './LogCommitFiles.vue'
import LogFilterBar from './LogFilterBar.vue'
import LogRefsToolbar from './LogRefsToolbar.vue'
import LogRefsTree from './LogRefsTree.vue'
import LogTable from './LogTable.vue'
import NewBranchDialog from './NewBranchDialog.vue'
import AccessPrompt from '../AccessPrompt.vue'

const props = withDefaults(defineProps<{ cwd: string; active?: boolean; select?: string }>(), { active: true })
const emit = defineEmits<{ root: [root: string]; selected: []; open: [path: string, line?: number] }>()
const { t } = useI18n()
const log = useGitLog(
  () => props.cwd,
  () => props.active,
)

const COLS_KEY = 'ccm.workspace.logCols'
const readCols = (): { refs: number; side: number; split: number; refsOpen: boolean } => {
  try {
    const v = JSON.parse(localStorage.getItem(COLS_KEY) ?? 'null') as Record<string, unknown> | null
    const n = (x: unknown, lo: number, hi: number, d: number): number => (typeof x === 'number' && x >= lo && x <= hi ? x : d)
    return { refs: n(v?.refs, 140, 480, 220), side: n(v?.side, 200, 720, 340), split: n(v?.split, 0.2, 0.8, 0.55), refsOpen: v?.refsOpen !== false }
  } catch {
    return { refs: 220, side: 340, split: 0.55, refsOpen: true }
  }
}
const cols = ref(readCols())
watch(cols, (v) => {
  try {
    localStorage.setItem(COLS_KEY, JSON.stringify(v))
  } catch {
    // session only
  }
}, { deep: true })

const rootEl = ref<HTMLElement | null>(null)
const sideEl = ref<HTMLElement | null>(null)
const table = ref<InstanceType<typeof LogTable> | null>(null)
const selectedPath = ref<string | null>(null)

let stopDrag: (() => void) | null = null
function drag(e: PointerEvent, kind: 'refs' | 'side' | 'split'): void {
  const startX = e.clientX
  const startY = e.clientY
  const start = { ...cols.value }
  const rect = sideEl.value?.getBoundingClientRect()
  const onMove = (m: PointerEvent): void => {
    if (kind === 'refs') cols.value.refs = Math.min(480, Math.max(140, start.refs + m.clientX - startX))
    else if (kind === 'side') cols.value.side = Math.min(720, Math.max(200, start.side - (m.clientX - startX)))
    else if (rect) cols.value.split = Math.min(0.8, Math.max(0.2, start.split + (m.clientY - startY) / rect.height))
  }
  stopDrag?.()
  const onUp = (): void => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
    stopDrag = null
  }
  stopDrag = onUp
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

// The stored widths are a preference; a narrow split caps what is drawn so the table keeps room.
const MIN_MIDDLE = 240
const paneW = ref(0)
let sizeObserver: ResizeObserver | null = null
onMounted(() => {
  if (!rootEl.value || typeof ResizeObserver === 'undefined') return
  sizeObserver = new ResizeObserver((entries) => void (paneW.value = entries[0]?.contentRect.width ?? 0))
  sizeObserver.observe(rootEl.value)
})
const sideW = computed(() => (paneW.value ? Math.min(cols.value.side, Math.max(120, (paneW.value - MIN_MIDDLE - 8) * 0.55)) : cols.value.side))
const refsW = computed(() => (paneW.value ? Math.min(cols.value.refs, Math.max(100, paneW.value - MIN_MIDDLE - 8 - sideW.value)) : cols.value.refs))

watch(log.root, (r) => r && emit('root', r))
watch(
  () => [props.select, log.commits.value.length] as const,
  ([want]) => {
    if (want && log.commits.value.some((c) => c.hash === want)) {
      log.select(want)
      emit('selected')
    }
  },
)
watch(log.selected, (hash) => {
  selectedPath.value = null
  if (diffFileRef.value && hash !== diffHash) {
    diffSeq++
    diffFileRef.value = null
    diffFile.value = null
  }
})

const empty = computed<'none' | 'filtered' | 'repo'>(() => {
  if (log.loading.value || log.commits.value.length) return 'none'
  return hasFilters(log.filters.value) ? 'filtered' : 'repo'
})
const remotes = computed(() => log.refs.value?.remotes.map((g) => g.name) ?? [])

// Diff mode: the middle + right area shows one file of the selected commit.
const diffFileRef = ref<CommitFile | null>(null)
let diffHash: string | null = null
const diffFile = shallowRef<DiffFile | null>(null)
const diffState = ref<'idle' | 'loading' | 'binary' | 'too-large' | 'empty' | 'error'>('idle')
const opts = ref(readDiffOpts())
const currentBlock = ref(0)
const diffView = ref<InstanceType<typeof DiffView> | null>(null)
const blocks = computed(() => (diffFile.value ? viewBlocks(diffFile.value, opts.value.highlight) : []))
const commitFiles = computed(() => (log.detail.value?.ok ? log.detail.value.files : []))
let diffSeq = 0

async function openDiff(file: CommitFile): Promise<void> {
  const root = log.root.value
  const hash = log.selected.value
  if (!root || !hash) return
  opts.value = readDiffOpts()
  diffFileRef.value = file
  diffHash = hash
  selectedPath.value = file.path
  diffState.value = 'loading'
  currentBlock.value = 0
  const run = ++diffSeq
  const res = await logDiff(root, hash, file.path, { context: 'full', whitespace: opts.value.whitespace }, file.origPath)
  if (run !== diffSeq) return
  if (!res.ok) {
    diffState.value = 'error'
    diffFile.value = null
    return
  }
  if (res.binary || res.tooLarge) {
    diffState.value = res.binary ? 'binary' : 'too-large'
    diffFile.value = null
    return
  }
  const parsed = parseUnifiedDiff(res.text)[0] ?? null
  diffFile.value = parsed && opts.value.whitespace === 'imports' ? hideImportChanges(parsed).file : parsed
  diffState.value = diffFile.value?.hunks.length ? 'idle' : 'empty'
  await nextTick()
  if (run === diffSeq && blocks.value.length) void diffView.value?.scrollToBlock(0)
}

function closeDiff(): void {
  diffSeq++
  diffFileRef.value = null
  diffFile.value = null
  void nextTick(() => table.value?.focus())
}

function stepFile(dir: 1 | -1): void {
  const list = commitFiles.value
  const at = list.findIndex((f) => f.path === diffFileRef.value?.path)
  const next = list[at + dir]
  if (next) void openDiff(next)
}

function stepBlock(dir: 1 | -1): void {
  const n = blocks.value.length
  if (!n) return stepFile(dir)
  const next = currentBlock.value + dir
  if (next < 0 || next >= n) return stepFile(dir)
  currentBlock.value = next
  void diffView.value?.scrollToBlock(next)
}

function typing(e: KeyboardEvent): boolean {
  const el = e.target instanceof HTMLElement ? e.target : null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

function inPane(): boolean {
  const a = document.activeElement
  return a === document.body || (!!a && !!rootEl.value?.contains(a))
}

function onKey(e: KeyboardEvent): void {
  if (!props.active || !inPane()) return
  if (menu.value) {
    if (e.key === 'Escape') {
      closeMenu()
      e.preventDefault()
    }
    return
  }
  if (!diffFileRef.value || typing(e)) return
  if (e.key === 'Escape') closeDiff()
  else if (e.key === 'F7') stepBlock(e.shiftKey ? -1 : 1)
  else if (e.key === ']' && !e.ctrlKey && !e.metaKey) stepFile(1)
  else if (e.key === '[' && !e.ctrlKey && !e.metaKey) stepFile(-1)
  else if (scrollSideways(e)) return e.preventDefault()
  else if (fileStepKey(e) && !(e.target as HTMLElement | null)?.closest('[role=tree],[role=toolbar],[role=menu],[role=dialog]')) stepFile(fileStepKey(e) as 1 | -1)
  else return
  e.preventDefault()
}

/** Commit whose first file opens as soon as its details land (select clears the detail first). */
let pendingOpen: string | null = null

function openCommit(hash: string): void {
  pendingOpen = hash
  log.select(hash)
  tryPendingOpen()
}

function tryPendingOpen(): void {
  const d = log.detail.value
  if (!pendingOpen || !d?.ok || d.hash !== pendingOpen) return
  pendingOpen = null
  if (d.files[0]) void openDiff(d.files[0])
}
watch(log.detail, tryPendingOpen)
watch(log.selected, (h) => {
  if (h !== pendingOpen) pendingOpen = null
})

// Branches toolbar: the focused refs-tree row is its target; clicking a ref still filters the log.
const refsTree = ref<InstanceType<typeof LogRefsTree> | null>(null)
const selectedRef = ref<RefRow | null>(null)
// An unmounted tree cannot emit `select` any more, so the toolbar would keep targeting its last row.
watch([() => cols.value.refsOpen, log.root], () => (selectedRef.value = null))
const refsCollapsed = ref<Set<string>>(new Set())
const refsView = ref(readRefsView())
watch(refsView, writeRefsView, { deep: true })
const favorites = ref<Set<string>>(new Set())
watch(
  log.refs,
  (r) => {
    if (r && log.root.value) favorites.value = readFavorites(log.root.value, r)
  },
  { immediate: true },
)
const branchBusy = ref<'fetch' | 'update' | 'delete' | null>(null)
const branchNotice = ref<{ text: string; failed: boolean } | null>(null)
const newBranch = ref<{ base: string; baseLabel: string } | null>(null)
const shortRef = (ref: string): string => ref.replace(/^refs\/(heads|remotes|tags)\//, '')

function report(res: BranchOpResult, okKey: string, name = ''): void {
  if (res.ok) branchNotice.value = { text: t(`workspace.log.branches.done.${okKey}`, { name }), failed: false }
  else if (res.error !== 'cancelled') branchNotice.value = { text: [t(`workspace.log.branches.error.${res.error}`, { name }), res.detail].filter(Boolean).join(' — '), failed: true }
  void log.reload()
}

function selRef(): Extract<RefRow, { kind: 'ref' }> | null {
  return selectedRef.value?.kind === 'ref' ? selectedRef.value : null
}

function askNewBranch(): void {
  const r = selRef()
  const commit = log.selected.value
  newBranch.value = r ? { base: r.ref, baseLabel: r.name } : commit ? { base: commit, baseLabel: commit.slice(0, 8) } : { base: 'HEAD', baseLabel: 'HEAD' }
}
async function createBranch(name: string, checkout: boolean): Promise<void> {
  const req = newBranch.value
  newBranch.value = null
  if (req && log.root.value) report(await gitBranchCreate(log.root.value, name, req.base, checkout), checkout ? 'createdSwitched' : 'created', name)
}
async function updateSelected(): Promise<void> {
  const r = selRef()
  if (!r || !log.root.value || branchBusy.value) return
  branchBusy.value = 'update'
  try {
    report(await gitBranchUpdate(log.root.value, r.ref), 'updated', r.name)
  } finally {
    branchBusy.value = null
  }
}
async function deleteSelected(): Promise<void> {
  const r = selRef()
  if (!r || !log.root.value || branchBusy.value) return
  branchBusy.value = 'delete'
  try {
    report(await gitBranchDelete(log.root.value, r.ref), 'deleted', r.name)
  } finally {
    branchBusy.value = null
  }
}
async function fetchRemotes(): Promise<void> {
  if (!log.root.value || branchBusy.value) return
  branchBusy.value = 'fetch'
  try {
    report(await gitFetch(log.root.value), 'fetched')
  } finally {
    branchBusy.value = null
  }
}
/** Branch filter before Compare set its own; Clear goes back to it so the log is not left on the compared branch. */
let branchBeforeCompare: string | null = null
function clearCompare(): void {
  log.setFilters({ branch: branchBeforeCompare, notRef: null })
  branchBeforeCompare = null
}
function compareSelected(): void {
  const r = selRef()
  if (!r) return
  if (!log.filters.value.notRef) branchBeforeCompare = log.filters.value.branch
  // The named current branch, not `HEAD`: after Swap the filter bar then shows a branch it lists.
  const head = log.refs.value?.head.branch
  log.setFilters({ branch: r.ref, notRef: head ? `refs/heads/${head}` : 'HEAD' })
}
function toggleFavorite(): void {
  const r = selRef()
  if (!r || !log.root.value) return
  const next = new Set(favorites.value)
  if (next.has(r.ref)) next.delete(r.ref)
  else next.add(r.ref)
  favorites.value = next
  writeFavorites(log.root.value, next)
}
async function navigateTo(): Promise<void> {
  const r = selRef()
  const refs = log.refs.value
  if (!r || !refs) return
  const hash = [...refs.local, ...refs.remotes.flatMap((g) => g.refs), ...refs.tags].find((x) => x.ref === r.ref)?.hash
  if (hash && (await log.reveal(hash))) {
    await nextTick()
    if (table.value?.scrollToHash(hash)) return
  }
  branchNotice.value = { text: t('workspace.log.branches.notLoaded', { name: r.name }), failed: true }
}
function collapseAllRefs(): void {
  const refs = log.refs.value
  if (refs) refsCollapsed.value = new Set(expandableIds(refs, { favorites: favorites.value, ...refsView.value }))
}

// Context menus (read-only copy / open actions).
const MENU_W = 208
const menu = ref<{ x: number; y: number; items: { id: string; label: string; run: () => void }[] } | null>(null)
const menuEl = ref<HTMLElement | null>(null)

function openMenu(x: number, y: number, items: { id: string; label: string; run: () => void }[]): void {
  const h = items.length * 28 + 8
  menu.value = { x: Math.max(0, Math.min(x, window.innerWidth - MENU_W)), y: Math.max(0, Math.min(y, window.innerHeight - h)), items }
  void nextTick(() => menuEl.value?.querySelector<HTMLElement>('button')?.focus())
}

function menuKey(e: KeyboardEvent): void {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  const items = [...(menuEl.value?.querySelectorAll<HTMLElement>('button') ?? [])]
  if (!items.length) return
  const at = items.indexOf(document.activeElement as HTMLElement)
  items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]!.focus()
  e.preventDefault()
}
const copy = (s: string): void => void navigator.clipboard.writeText(s).catch(() => undefined)

function commitMenu(hash: string, x: number, y: number): void {
  const c = log.commits.value.find((k) => k.hash === hash)
  openMenu(x, y, [
    { id: 'hash', label: t('workspace.log.menu.copyHash'), run: () => copy(hash) },
    { id: 'msg', label: t('workspace.log.menu.copyMessage'), run: () => copy(log.detail.value?.ok && log.detail.value.hash === hash ? log.detail.value.message : (c?.subject ?? '')) },
    { id: 'diff', label: t('workspace.log.menu.showDiff'), run: () => openCommit(hash) },
  ])
}

function fileMenu(file: CommitFile, x: number, y: number): void {
  const root = log.root.value
  openMenu(x, y, [
    { id: 'diff', label: t('workspace.log.menu.showDiff'), run: () => void openDiff(file) },
    ...(root && file.kind !== 'deleted' ? [{ id: 'open', label: t('workspace.log.menu.openCurrent'), run: () => emit('open', absoluteIn(root, file.path)) }] : []),
    { id: 'path', label: t('workspace.log.menu.copyPath'), run: () => copy(file.path) },
  ])
}

const closeMenu = (): void => void (menu.value = null)
window.addEventListener('keydown', onKey)
window.addEventListener('pointerdown', closeMenu)
onBeforeUnmount(() => {
  stopDrag?.()
  sizeObserver?.disconnect()
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('pointerdown', closeMenu)
})
const lang = computed(() => (diffFileRef.value ? grammarFor(undefined, diffFileRef.value.path) : null))
const shortHash = computed(() => log.selected.value?.slice(0, 8) ?? '')
</script>

<template>
  <section ref="rootEl" class="flex min-h-0 min-w-0 flex-col bg-surface" :aria-label="t('workspace.log.title')" data-log-pane>
    <div class="@container flex h-9 min-w-0 shrink-0 items-center gap-1 border-b border-line px-2 select-none" data-pane-head>
      <span class="min-w-0 truncate text-xs font-semibold text-ink" :title="log.root.value ?? cwd">{{ t('workspace.log.title') }}</span>
      <span class="flex-1" />
      <slot name="end" />
    </div>

    <div v-if="log.error.value && !log.commits.value.length" class="grid flex-1 place-items-center p-6 text-center" data-log-fatal>
      <AccessPrompt v-if="log.error.value === 'denied'" :path="log.root.value ?? cwd" @granted="log.reload()" />
      <div v-else class="flex flex-col items-center gap-2">
        <p class="text-sm text-ink-muted">{{ t(`workspace.log.error.${log.error.value}`) }}</p>
        <button type="button" class="ccm-btn" @click="log.reload()">{{ t('workspace.log.table.retry') }}</button>
      </div>
    </div>

    <div v-else class="flex min-h-0 min-w-0 flex-1">
      <LogRefsToolbar
        :open="cols.refsOpen"
        :selected="selectedRef"
        :busy="branchBusy"
        :view="refsView"
        :can-write="hasBranchOps && !!log.root.value"
        @toggle="cols.refsOpen = !cols.refsOpen"
        @new-branch="askNewBranch"
        @update="updateSelected"
        @remove="deleteSelected"
        @compare="compareSelected"
        @search="refsTree?.focusSearch()"
        @fetch="fetchRemotes"
        @favorite="toggleFavorite"
        @navigate="navigateTo"
        @view="(v) => (refsView = v)"
        @expand-all="refsCollapsed = new Set()"
        @collapse-all="collapseAllRefs"
      />
      <template v-if="cols.refsOpen">
        <LogRefsTree
          :key="log.root.value ?? ''"
          ref="refsTree"
          v-model:collapsed="refsCollapsed"
          class="shrink-0"
          :style="{ width: `${refsW}px` }"
          :refs="log.refs.value"
          :branch="log.filters.value.branch"
          :favorites="favorites"
          :view="refsView"
          @pick="(name) => log.setFilters({ branch: name, notRef: null })"
          @select="(row) => (selectedRef = row)"
        />
        <div class="w-1 shrink-0 cursor-col-resize border-l border-line hover:bg-fill" role="separator" aria-orientation="vertical" @pointerdown.prevent="drag($event, 'refs')" />
      </template>

      <div v-if="diffFileRef" class="flex min-h-0 min-w-0 flex-1 flex-col" data-log-diff>
        <div class="flex h-8 shrink-0 items-center gap-1 border-b border-line px-2 text-xs">
          <button type="button" class="ccm-btn-plain h-6 gap-1 px-1.5" :title="`${t('workspace.log.diff.back')} (Esc)`" data-log-diff-back @click="closeDiff">
            <ArrowLeft :size="13" aria-hidden="true" />{{ t('workspace.log.diff.back') }}
          </button>
          <span class="min-w-0 flex-1 truncate font-mono text-ink" :title="diffFileRef.path">{{ t('workspace.log.diff.title', { path: diffFileRef.path, hash: shortHash }) }}</span>
          <button type="button" class="ccm-btn-plain size-6 p-0" :title="`${t('workspace.log.diff.prevFile')} (←)`" :aria-label="t('workspace.log.diff.prevFile')" @click="stepFile(-1)"><ChevronLeft :size="14" aria-hidden="true" /></button>
          <button type="button" class="ccm-btn-plain size-6 p-0" :title="`${t('workspace.log.diff.nextFile')} (→)`" :aria-label="t('workspace.log.diff.nextFile')" @click="stepFile(1)"><ChevronRight :size="14" aria-hidden="true" /></button>
          <span class="hidden truncate text-2xs text-ink-faint md:inline">{{ t('workspace.log.diff.keys') }}</span>
        </div>
        <div class="ccm-scroll min-h-0 flex-1 bg-well" :class="opts.layout === 'split' && diffFile && diffState === 'idle' ? 'overflow-hidden' : 'overflow-auto'">
          <p v-if="diffState === 'loading'" class="p-4 text-xs text-well-ink" role="status">{{ t('workspace.log.diff.loading') }}</p>
          <p v-else-if="diffState === 'binary' || diffState === 'too-large' || diffState === 'empty' || diffState === 'error'" class="p-4 text-xs text-well-ink">
            {{ t(diffState === 'binary' ? 'workspace.log.diff.binary' : diffState === 'too-large' ? 'workspace.log.diff.tooLarge' : diffState === 'empty' ? 'workspace.log.diff.empty' : 'workspace.log.error.failed') }}
          </p>
          <DiffView
            v-else-if="diffFile"
            ref="diffView"
            :file="diffFile"
            :blocks="blocks"
            :layout="opts.layout"
            :lang="lang"
            :collapse="opts.collapse"
            :context="opts.context"
            :highlight="opts.highlight"
            :sides="{ left: log.detail.value?.ok && !log.detail.value.parents.length ? t('workspace.diff.side.none') : `${shortHash}^`, right: shortHash }"
            :align="opts.align"
            :sync="opts.sync"
            :can-revert="false"
            :current="currentBlock"
            @focus-block="(i) => (currentBlock = i)"
          />
        </div>
      </div>

      <template v-else>
        <div class="flex min-h-0 min-w-0 flex-1 flex-col">
          <p v-if="log.filters.value.notRef && log.filters.value.branch" class="flex shrink-0 items-center gap-2 border-b border-line bg-accent-soft px-3 py-1 text-xs text-ink" role="status" data-log-compare>
            <span class="min-w-0 flex-1 truncate">{{ t('workspace.log.branches.comparing', { a: shortRef(log.filters.value.branch), b: shortRef(log.filters.value.notRef) }) }}</span>
            <button type="button" class="ccm-btn-plain h-6 shrink-0 px-2 text-xs" data-log-compare-swap @click="log.setFilters({ branch: log.filters.value.notRef, notRef: log.filters.value.branch })">{{ t('workspace.log.branches.swap') }}</button>
            <button type="button" class="ccm-btn-plain h-6 shrink-0 px-2 text-xs" data-log-compare-clear @click="clearCompare">{{ t('workspace.log.branches.clear') }}</button>
          </p>
          <p v-if="branchNotice" class="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1 text-xs text-ink" :class="branchNotice.failed ? 'bg-st-error-soft' : 'bg-fill'" role="status" data-log-branch-notice>
            <component :is="branchNotice.failed ? CircleAlert : CircleCheck" :size="13" class="shrink-0" :class="branchNotice.failed ? 'text-st-error' : 'text-success'" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate" :title="branchNotice.text">{{ branchNotice.text }}</span>
            <button type="button" class="shrink-0 cursor-pointer rounded-inner text-ink-faint hover:text-ink" :title="t('workspace.log.branches.dismiss')" :aria-label="t('workspace.log.branches.dismiss')" @click="branchNotice = null"><X :size="12" aria-hidden="true" /></button>
          </p>
          <LogFilterBar :filters="log.filters.value" :refs="log.refs.value" :authors="log.authors.value" :root="log.root.value ?? cwd" :flat="log.mode.value === 'flat'" @change="log.setFilters" @refresh="log.reload()" />
          <LogTable
            ref="table"
            :commits="log.commits.value"
            :rows="log.rows.value"
            :selected="log.selected.value"
            :head-hash="log.refs.value?.head.hash ?? null"
            :remotes="remotes"
            :loading="log.loading.value"
            :loading-more="log.loadingMore.value"
            :more="log.more.value"
            :empty="empty"
            :error="log.pageError.value"
            :filtered="hasFilters(log.filters.value)"
            @select="log.select"
            @open="openCommit"
            @load-more="log.loadMore()"
            @menu="commitMenu"
            @clear="log.setFilters({ text: '', branch: null, notRef: null, author: null, date: 'any', from: '', to: '', paths: [] })"
            @retry="log.reload()"
          />
        </div>
        <div class="w-1 shrink-0 cursor-col-resize border-l border-line hover:bg-fill" role="separator" aria-orientation="vertical" @pointerdown.prevent="drag($event, 'side')" />
        <div ref="sideEl" class="flex min-h-0 shrink-0 flex-col" :style="{ width: `${sideW}px` }">
          <LogCommitFiles class="min-h-0" :style="{ flex: `${cols.split} 1 0` }" :detail="log.detail.value" :loading="log.detailLoading.value" :selected-path="selectedPath" @select="(p) => (selectedPath = p)" @open="openDiff" @menu="fileMenu" />
          <div class="h-1 shrink-0 cursor-row-resize border-t border-line hover:bg-fill" role="separator" aria-orientation="horizontal" @pointerdown.prevent="drag($event, 'split')" />
          <LogCommitDetails class="min-h-0" :style="{ flex: `${1 - cols.split} 1 0` }" :detail="log.detail.value" :loading="log.detailLoading.value" :contains="log.contains" />
        </div>
      </template>
    </div>

    <div v-if="menu" ref="menuEl" class="ccm-menu fixed z-50 flex w-52 flex-col p-1" :style="{ left: `${menu.x}px`, top: `${menu.y}px` }" role="menu" @pointerdown.stop @keydown="menuKey">
      <button v-for="m in menu.items" :key="m.id" type="button" role="menuitem" class="flex h-7 w-full items-center rounded-inner px-2 text-left text-xs text-ink hover:bg-fill focus-visible:bg-accent focus-visible:text-on-accent" @click="closeMenu(); m.run()">
        {{ m.label }}
      </button>
    </div>
    <NewBranchDialog :request="newBranch" @create="createBranch" @close="newBranch = null" />
  </section>
</template>
