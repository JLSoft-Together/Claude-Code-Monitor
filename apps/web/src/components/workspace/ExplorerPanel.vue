<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BranchOpResult } from '@ccm/shared'
import { FolderTree, GitCompare, ListChecks, ListTodo, Search, X, type LucideIcon } from 'lucide-vue-next'
import { riskHintKey, type ExplorerAction } from '../../lib/explorer/contextMenu'
import { createTargetDirectory, parentDirectory, relativeTo, rootName, type TreeRow } from '../../lib/explorer/tree'
import { isMac } from '../../lib/platform'
import { baseName, hasChecks, hasExplorer, hasSearch, readFile, revealPath, type SearchQuery } from '../../lib/preview'
import { grammarFor } from '../../lib/codeView'
import { useExplorerChanges } from '../../composables/useExplorerChanges'
import { useExplorerStore, type ExplorerView } from '../../stores/explorer'
import { useUiStore } from '../../stores/ui'
import CreateEntryDialog from './CreateEntryDialog.vue'
import DiscardConfirm from './DiscardConfirm.vue'
import ExplorerChanges from './ExplorerChanges.vue'
import ExplorerSearch from './ExplorerSearch.vue'
import ExplorerChecks from './ExplorerChecks.vue'
import ExplorerTodo from './ExplorerTodo.vue'
import ExplorerTree from './ExplorerTree.vue'
import PushDialog from './log/PushDialog.vue'

const TextCompareDialog = defineAsyncComponent(() => import('./TextCompareDialog.vue'))

const props = defineProps<{
  /** Project root of the focused pane; null keeps the last one. */
  root: string | null
  /** Path of the focused file viewer, if any. */
  activePath: string | null
  /** Workspace on screen: the Changes view watches git only then. */
  visible: boolean
}>()
const emit = defineEmits<{
  open: [path: string, keep: boolean, line?: number]
  openDiff: [root: string, path?: string]
  openLog: [root: string]
  openSplit: [path: string]
  terminal: [dir: string]
  run: [dir: string]
  renamed: [from: string, to: string]
  trashed: [path: string]
}>()

const { t } = useI18n()
const explorer = useExplorerStore()
const ui = useUiStore()

watch(
  () => props.root,
  (r) => explorer.setRoot(r),
  { immediate: true },
)
onMounted(() => explorer.attach())
onBeforeUnmount(() => explorer.detach())

// Files view colours names by git status too, so status is kept fresh whenever the Explorer is on screen.
const changesActive = computed(() => props.visible)
const changes = useExplorerChanges(toRef(explorer, 'root'), changesActive)

// A root refused before its pane's PTY ran lists once retried; its git status was refused the same way.
watch(
  () => !!explorer.root && explorer.state.listings.has(explorer.root),
  (listed) => {
    const s = changes.status.value
    if (listed && s && !s.ok && s.error === 'denied') changes.refresh()
  },
)

// A plain folder has no Changes view.
const needsRepo = (v: ExplorerView): boolean => v === 'changes' || v === 'search' || v === 'todo'
watch(changes.isRepo, (repo) => {
  if (!repo && needsRepo(explorer.view)) explorer.setView('files')
})

const VIEWS: ExplorerView[] = ['files', 'changes', ...(hasSearch ? (['search', 'todo'] as const) : []), ...(hasChecks ? (['checks'] as const) : [])]
const tabs = ref<HTMLElement | null>(null)
const VIEW_ICONS: Record<ExplorerView, LucideIcon> = { files: FolderTree, changes: GitCompare, search: Search, todo: ListTodo, checks: ListChecks }
const changeTotals = computed(() => {
  const n = changes.totals.value
  return n && (n.added || n.removed) ? n : null
})
function tabName(v: ExplorerView): string {
  if (needsRepo(v) && !changes.isRepo.value) return `${t(`workspace.explorer.${v}`)} (${t('workspace.explorer.notRepo')})`
  const name = t(`workspace.explorer.${v}`)
  return v === 'changes' && changeTotals.value ? `${name}, ${t('workspace.explorer.changesView.totals', changeTotals.value)}` : name
}
const searchView = ref<{ focus: () => void; seed: (q: SearchQuery) => void } | null>(null)
const flutterRoot = computed(() => !!explorer.root && !!explorer.state.listings.get(explorer.root)?.some((e) => e.name === 'pubspec.yaml'))

/** Ctrl/⌘+Shift+F (Alt+Shift+F on Windows): Search view, input focused. */
async function showSearch(query?: SearchQuery): Promise<void> {
  if (!hasSearch || !changes.isRepo.value) return
  explorer.setView('search')
  await nextTick()
  if (query) searchView.value?.seed(query)
  searchView.value?.focus()
}
defineExpose({ showSearch })

function onTabKey(e: KeyboardEvent): void {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
  e.preventDefault()
  const usable = VIEWS.filter((v) => !needsRepo(v) || changes.isRepo.value)
  const at = Math.max(0, usable.indexOf(explorer.view))
  const next = usable[(at + (e.key === 'ArrowRight' ? 1 : usable.length - 1)) % usable.length]!
  explorer.setView(next)
  tabs.value?.querySelector<HTMLElement>(`[data-view="${next}"]`)?.focus()
}

const entryRequest = ref<{ mode: 'create' | 'rename'; kind: 'file' | 'directory'; parent: string; target?: string; initial?: string } | null>(null)
const configHint = (p: string | undefined): string | undefined => {
  const key = p ? riskHintKey(p) : null
  return key ? t(key) : undefined
}
const dialog = computed(() => {
  const r = entryRequest.value
  return r && explorer.root
    ? { kind: r.kind, where: relativeTo(explorer.root, r.parent), rootName: rootName(explorer.root), mode: r.mode, initial: r.initial, hint: configHint(r.target) }
    : null
})

function askCreate(kind: 'file' | 'directory'): void {
  if (!explorer.root) return
  entryRequest.value = { mode: 'create', kind, parent: createTargetDirectory(explorer.rows, explorer.state.focused, explorer.root) }
}

async function submitEntry(name: string): Promise<void> {
  const req = entryRequest.value
  entryRequest.value = null
  if (!req) return
  if (req.mode === 'rename' && req.target) {
    const to = await explorer.rename(req.target, name)
    if (to) emit('renamed', req.target, to)
    return
  }
  const path = await explorer.create(req.parent, name, req.kind)
  if (path && req.kind === 'file') emit('open', path, false)
}

const pendingTrash = ref<TreeRow | null>(null)
const trashName = computed(() => t(`workspace.changes.trash.${isMac ? 'mac' : 'win'}`))
const trashLines = computed(() => {
  const row = pendingTrash.value
  if (!row) return []
  const lines = [
    t(row.directory ? 'workspace.explorer.trash.folder' : 'workspace.explorer.trash.file', { trash: trashName.value }),
    t('workspace.explorer.trash.restore', { trash: trashName.value }),
  ]
  const hint = configHint(row.path)
  return hint ? [...lines, hint] : lines
})

async function copy(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text)
    explorer.status = { key: 'copied', name: text, failed: false }
  } catch {
    // clipboard refused (window not focused): no feedback to give
  }
}

// Compare any two files (v70): in-memory pick, cleared after the compare or on Esc.
interface CompareSide {
  label: string
  name: string
  text: string | null
}
const compareSel = ref<{ path: string; name: string } | null>(null)
const compare = ref<{ a: CompareSide; b: CompareSide; grammar: string | null; loading: boolean; message: string | null } | null>(null)
const compareTitle = computed(() => (compare.value ? t('workspace.explorer.compare.title', { a: compare.value.a.name, b: compare.value.b.name }) : ''))

function relLabel(path: string): string {
  return (explorer.root && relativeTo(explorer.root, path)) || path
}

async function readSide(path: string): Promise<{ text: string } | { error: string }> {
  const v = await readFile(path)
  if (v?.kind === 'text') return { text: v.text ?? '' }
  const why = v?.kind === 'too-large' ? 'tooLarge' : v?.kind === 'binary' || v?.kind === 'image' ? 'binary' : 'unreadable'
  return { error: t(`workspace.explorer.compare.${why}`, { name: baseName(path) }) }
}

async function openCompare(left: string, right: { path: string } | { clipboard: string }): Promise<void> {
  const rightName = 'path' in right ? baseName(right.path) : t('workspace.explorer.compare.clipboard')
  compare.value = {
    a: { label: relLabel(left), name: baseName(left), text: null },
    b: { label: 'path' in right ? relLabel(right.path) : rightName, name: rightName, text: null },
    grammar: grammarFor(undefined, left),
    loading: true,
    message: null,
  }
  const current = compare.value
  const [a, b] = await Promise.all([readSide(left), 'path' in right ? readSide(right.path) : Promise.resolve({ text: right.clipboard })])
  if (compare.value !== current) return
  const error = 'error' in a ? a.error : 'error' in b ? b.error : null
  compare.value = { ...current, loading: false, message: error, a: { ...current.a, text: error || !('text' in a) ? null : a.text }, b: { ...current.b, text: error || !('text' in b) ? null : b.text } }
}

function swapCompare(): void {
  const c = compare.value
  if (c) compare.value = { ...c, a: c.b, b: c.a }
}

async function compareClipboard(path: string): Promise<void> {
  let text: string
  try {
    text = await navigator.clipboard.readText()
  } catch {
    explorer.status = { key: 'clipboardDenied', name: baseName(path), failed: true }
    return
  }
  await openCompare(path, { clipboard: text })
}

function onPanelKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape' || !compareSel.value || compare.value) return
  e.preventDefault()
  compareSel.value = null
  if (explorer.status?.key === 'compareSelected') explorer.clearStatus()
}

async function onAction(id: ExplorerAction, row: TreeRow): Promise<void> {
  const root = explorer.root
  if (!root) return
  const dir = row.depth === 0 ? root : row.directory ? row.path : parentDirectory(row.path)
  switch (id) {
    case 'new-file':
    case 'new-folder':
      entryRequest.value = { mode: 'create', kind: id === 'new-file' ? 'file' : 'directory', parent: dir }
      break
    case 'copy-abs':
      return copy(row.path)
    case 'copy-rel':
      return copy(relativeTo(root, row.path) || '.')
    case 'copy-name':
      return copy(row.name)
    case 'rename':
      entryRequest.value = { mode: 'rename', kind: row.directory ? 'directory' : 'file', parent: parentDirectory(row.path), target: row.path, initial: row.name }
      break
    case 'trash':
      pendingTrash.value = row
      break
    case 'reload':
      void changes.refresh()
      await explorer.loadListing(dir)
      break
    case 'reveal':
      void revealPath(row.path)
      break
    case 'open-split':
      emit('openSplit', row.path)
      break
    case 'terminal':
      emit('terminal', dir)
      break
    case 'run':
      emit('run', dir)
      break
    case 'show-diff':
      if (changes.status.value?.ok) emit('openDiff', changes.status.value.root, row.path)
      break
    case 'compare-select':
      compareSel.value = { path: row.path, name: row.name }
      explorer.status = { key: 'compareSelected', name: row.name, failed: false }
      break
    case 'compare-clear':
      compareSel.value = null
      if (explorer.status?.key === 'compareSelected') explorer.clearStatus()
      break
    case 'compare-with': {
      const first = compareSel.value
      if (!first) break
      compareSel.value = null
      if (explorer.status?.key === 'compareSelected') explorer.clearStatus()
      await openCompare(first.path, { path: row.path })
      break
    }
    case 'compare-clipboard':
      await compareClipboard(row.path)
      break
    case 'apk-size':
      ui.apkSize = { path: row.path, root }
      break
    case 'strings':
      ui.stringsTable = { dir: root, focus: row.path }
      break
  }
}

async function confirmTrash(): Promise<void> {
  const row = pendingTrash.value
  pendingTrash.value = null
  if (row && (await explorer.trash(row.path))) emit('trashed', row.path)
}

const push = ref<{ root: string; ref: string } | null>(null)
function pushed(res: BranchOpResult, name: string): void {
  push.value = null
  if (res.ok) explorer.status = { key: 'pushed', name, failed: false }
  void changes.refresh()
}

const statusText = computed(() => {
  const s = explorer.status
  if (!s) return null
  const reason = s.reason ? t(`workspace.explorer.name.${s.reason}`) : ''
  return t(`workspace.explorer.status.${s.key}`, { name: s.name, reason })
})
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col gap-1" :aria-label="t('workspace.explorer.title')" data-explorer @keydown="onPanelKey">
    <p v-if="!hasExplorer" class="px-2 py-3 text-xs text-ink-muted">{{ t('workspace.explorer.unavailable') }}</p>
    <p v-else-if="!explorer.root" class="px-2 py-3 text-xs text-ink-muted">{{ t('workspace.explorer.noRoot') }}</p>
    <template v-else>
      <div ref="tabs" class="@container flex shrink-0 rounded-inner bg-fill p-0.5" role="tablist" :aria-label="t('workspace.explorer.views')" data-explorer-tabs @keydown="onTabKey">
        <button
          v-for="v in VIEWS"
          :key="v"
          type="button"
          role="tab"
          :data-view="v"
          :aria-selected="explorer.view === v"
          :tabindex="explorer.view === v ? 0 : -1"
          :disabled="needsRepo(v) && !changes.isRepo.value"
          :title="tabName(v)"
          :aria-label="tabName(v)"
          class="relative flex h-6 min-w-0 flex-auto cursor-pointer items-center justify-center gap-1 rounded-[5px] px-2 text-2xs font-medium transition-colors duration-(--ccm-dur-fast) disabled:cursor-default disabled:opacity-50 @max-[360px]:flex-1 @max-[360px]:px-1"
          :class="explorer.view === v ? 'bg-control text-ink shadow-control' : 'text-ink-muted hover:text-ink'"
          @click="explorer.setView(v)"
        >
          <component :is="VIEW_ICONS[v]" :size="12" class="shrink-0" aria-hidden="true" />
          <span class="min-w-0 truncate @max-[360px]:sr-only" data-tab-label>{{ t(`workspace.explorer.${v}`) }}</span>
          <template v-if="v === 'changes' && changeTotals">
            <span class="tabular shrink-0 @max-[440px]:hidden" aria-hidden="true" data-change-totals>
              <span v-if="changeTotals.added" class="text-diff-add">+{{ changeTotals.added }}</span>
              <span v-if="changeTotals.removed" class="ml-0.5 text-diff-del">−{{ changeTotals.removed }}</span>
            </span>
            <span
              class="absolute top-0.5 right-0.5 size-1.5 rounded-full @min-[440px]:hidden"
              :class="changeTotals.added ? 'bg-diff-add' : 'bg-diff-del'"
              aria-hidden="true"
              data-change-dot
            />
          </template>
        </button>
      </div>

      <p
        v-if="statusText"
        class="flex shrink-0 items-start gap-1 rounded-inner px-2 py-1 text-xs"
        :class="explorer.status?.failed ? 'bg-st-error-soft text-ink' : 'bg-fill text-ink-muted'"
        role="status"
      >
        <span class="min-w-0 flex-1">{{ statusText }}</span>
        <button type="button" class="shrink-0 cursor-pointer text-ink-faint hover:text-ink" :title="t('workspace.explorer.status.dismiss')" :aria-label="t('workspace.explorer.status.dismiss')" @click="explorer.clearStatus()">
          <X :size="12" aria-hidden="true" />
        </button>
      </p>

      <ExplorerTree
        v-if="explorer.view === 'files'"
        :active-path="activePath"
        :git="changes.marks.value"
        :repo="changes.isRepo.value"
        :compare-sel="compareSel"
        @open="(p, keep) => emit('open', p, keep)"
        @open-diff="(p) => changes.status.value?.ok && emit('openDiff', changes.status.value.root, p)"
        @create="askCreate"
        @action="onAction"
      />
      <ExplorerChecks
        v-else-if="explorer.view === 'checks'"
        :root="explorer.root"
        :flutter="flutterRoot"
        @open="(p, keep, line) => emit('open', p, keep, line)"
      />
      <ExplorerTodo
        v-else-if="explorer.view === 'todo'"
        :root="explorer.root"
        @open="(p, keep, line) => emit('open', p, keep, line)"
      />
      <ExplorerSearch
        v-else-if="explorer.view === 'search'"
        ref="searchView"
        :root="explorer.root"
        @open="(p, keep, line) => emit('open', p, keep, line)"
      />
      <ExplorerChanges
        v-else
        :status="changes.status.value"
        :reading="changes.reading.value"
        @open="(p, keep) => emit('open', p, keep)"
        @open-diff="(r, p) => emit('openDiff', r, p)"
        @open-log="(r) => emit('openLog', r)"
        @push="(r, b) => (push = { root: r, ref: `refs/heads/${b}` })"
        @refresh="changes.refresh()"
      />
    </template>
    <CreateEntryDialog :request="dialog" @create="submitEntry" @close="entryRequest = null" />
    <PushDialog :request="push" @done="pushed" @close="push = null" />
    <TextCompareDialog
      v-if="compare"
      :title="compareTitle"
      :a="compare.a.text"
      :b="compare.b.text"
      :labels="{ a: compare.a.label, b: compare.b.label }"
      :grammar="compare.grammar"
      :primary="t('workspace.explorer.compare.swap')"
      :loading="compare.loading"
      :message="compare.message"
      :error="!!compare.message"
      @primary="swapCompare"
      @close="compare = null"
    />
    <DiscardConfirm
      v-if="pendingTrash"
      :title="t('workspace.explorer.trash.title', { name: pendingTrash.name, trash: trashName })"
      :lines="trashLines"
      :confirm-label="t('workspace.explorer.trash.action', { trash: trashName })"
      @confirm="confirmTrash"
      @cancel="pendingTrash = null"
    />
  </section>
</template>
