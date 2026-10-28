<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BranchOpResult } from '@ccm/shared'
import { X } from 'lucide-vue-next'
import { riskHintKey, type ExplorerAction } from '../../lib/explorer/contextMenu'
import { createTargetDirectory, parentDirectory, relativeTo, rootName, type TreeRow } from '../../lib/explorer/tree'
import { isMac } from '../../lib/platform'
import { hasChecks, hasExplorer, hasSearch, revealPath } from '../../lib/preview'
import { useExplorerChanges } from '../../composables/useExplorerChanges'
import { useExplorerStore, type ExplorerView } from '../../stores/explorer'
import CreateEntryDialog from './CreateEntryDialog.vue'
import DiscardConfirm from './DiscardConfirm.vue'
import ExplorerChanges from './ExplorerChanges.vue'
import ExplorerSearch from './ExplorerSearch.vue'
import ExplorerChecks from './ExplorerChecks.vue'
import ExplorerTree from './ExplorerTree.vue'
import PushDialog from './log/PushDialog.vue'

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
const needsRepo = (v: ExplorerView): boolean => v === 'changes' || v === 'search'
watch(changes.isRepo, (repo) => {
  if (!repo && needsRepo(explorer.view)) explorer.setView('files')
})

const VIEWS: ExplorerView[] = ['files', 'changes', ...(hasSearch ? (['search'] as const) : []), ...(hasChecks ? (['checks'] as const) : [])]
const tabs = ref<HTMLElement | null>(null)
const searchView = ref<{ focus: () => void } | null>(null)
const flutterRoot = computed(() => !!explorer.root && !!explorer.state.listings.get(explorer.root)?.some((e) => e.name === 'pubspec.yaml'))

/** Ctrl/⌘+Shift+F (Alt+Shift+F on Windows): Search view, input focused. */
async function showSearch(): Promise<void> {
  if (!hasSearch || !changes.isRepo.value) return
  explorer.setView('search')
  await nextTick()
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
  <section class="flex min-h-0 flex-1 flex-col gap-1" :aria-label="t('workspace.explorer.title')" data-explorer>
    <p v-if="!hasExplorer" class="px-2 py-3 text-xs text-ink-muted">{{ t('workspace.explorer.unavailable') }}</p>
    <p v-else-if="!explorer.root" class="px-2 py-3 text-xs text-ink-muted">{{ t('workspace.explorer.noRoot') }}</p>
    <template v-else>
      <div ref="tabs" class="flex shrink-0 rounded-inner bg-fill p-0.5" role="tablist" :aria-label="t('workspace.explorer.views')" @keydown="onTabKey">
        <button
          v-for="v in VIEWS"
          :key="v"
          type="button"
          role="tab"
          :data-view="v"
          :aria-selected="explorer.view === v"
          :tabindex="explorer.view === v ? 0 : -1"
          :disabled="needsRepo(v) && !changes.isRepo.value"
          :title="needsRepo(v) && !changes.isRepo.value ? t('workspace.explorer.notRepo') : undefined"
          class="flex h-6 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1 rounded-[5px] px-2 text-2xs font-medium transition-colors duration-(--ccm-dur-fast) disabled:cursor-default disabled:opacity-50"
          :class="explorer.view === v ? 'bg-control text-ink shadow-control' : 'text-ink-muted hover:text-ink'"
          @click="explorer.setView(v)"
        >
          {{ t(`workspace.explorer.${v}`) }}
          <span
            v-if="v === 'changes' && changes.totals.value && (changes.totals.value.added || changes.totals.value.removed)"
            class="tabular"
            :aria-label="t('workspace.explorer.changesView.totals', changes.totals.value)"
          >
            <span v-if="changes.totals.value.added" class="text-diff-add">+{{ changes.totals.value.added }}</span>
            <span v-if="changes.totals.value.removed" class="ml-0.5 text-diff-del">−{{ changes.totals.value.removed }}</span>
          </span>
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
