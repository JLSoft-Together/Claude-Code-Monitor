<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronRight, FileWarning, Folder, GitBranch, GitCompare, GitGraph, ListTree, RotateCw, SlidersHorizontal, SquareArrowOutUpRight, Undo2 } from 'lucide-vue-next'
import { absoluteIn, dirOfRel, fileStepKey, groupChanges, KIND_CLASS, KIND_LETTER, samePath, scrollSideways } from '../../lib/changesView'
import { changesTree, type ChangesTreeRow } from '../../lib/changesTree'
import { grammarFor } from '../../lib/codeView'
import { parseUnifiedDiff, type DiffFile } from '../../lib/diff'
import { blockPatch, viewBlocks } from '../../lib/diffBlocks'
import { hideImportChanges } from '../../lib/diffImports'
import { CONTEXTS, HIGHLIGHTS, readDiffOpts, WHITESPACE, writeDiffOpts, type DiffOpts } from '../../lib/diffOpts'
import { isMac } from '../../lib/platform'
import { keyCombo } from '../../lib/shortcuts'
import {
  baseName,
  changesDiff,
  changesDiscard,
  changesStatus,
  changesUnwatch,
  changesWatch,
  hasChanges,
  hasLog,
  onChangesUpdated,
  type ChangeEntry,
  type ChangesError,
} from '../../lib/preview'
import DiffView from './DiffView.vue'
import DiscardConfirm from './DiscardConfirm.vue'

const props = withDefaults(defineProps<{ cwd: string; active?: boolean; select?: string }>(), { active: true })
const emit = defineEmits<{
  /** Absolute path + line (new side). */
  open: [path: string, line?: number]
  /** Number of changed files, for the tab label "Changes (N)". */
  count: [n: number]
  /** Repo toplevel once known (the tab is keyed per worktree root). */
  root: [root: string]
  /** `select` was applied (or cannot be): the owner clears it. */
  selected: []
  /** Open the Log pane for this repo. */
  log: [root: string]
}>()

const { t } = useI18n()

const TREE_KEY = 'ccm.workspace.changesTree'
/** Past this many rows the viewer always folds unchanged runs. */
const FORCE_COLLAPSE_LINES = 20_000

const repoRoot = ref<string | null>(null)
const branch = ref<string | null>(null)
const entries = shallowRef<ChangeEntry[]>([])
const truncated = ref(false)
const statusError = ref<ChangesError | null>(null)
const loading = ref(true)
const selected = ref<string | null>(null)
const diffFile = shallowRef<DiffFile | null>(null)
const partial = ref(false)
/** Import-only changes dropped by Whitespace "Ignore imports". */
const hiddenImports = ref(0)
const diffState = ref<'idle' | 'loading' | 'binary' | 'too-large' | 'empty' | 'error'>('idle')
const diffError = ref<ChangesError | null>(null)
const notice = ref<string | null>(null)
const currentBlock = ref(0)
const opts = ref<DiffOpts>(readDiffOpts())
const treeMode = ref(readLocal(TREE_KEY) === '1')
const collapsedDirs = ref<Set<string>>(new Set())
/** Tree cursor: `d:<group>:<path>` or `f:<path>`. */
const cursor = ref<string | null>(null)
const optionsOpen = ref(false)
const pending = ref<{ entry: ChangeEntry; block?: number } | null>(null)
const rootEl = ref<HTMLElement | null>(null)
const listEl = ref<HTMLElement | null>(null)
const optionsEl = ref<HTMLElement | null>(null)
const optionsButton = ref<HTMLButtonElement | null>(null)
const diffView = ref<InstanceType<typeof DiffView> | null>(null)
/** F7 at the last change arms a move to the next file (IntelliJ); any other step disarms it. */
let armed: 1 | -1 | 0 = 0
/** Where to land once the next file's diff is in: first or last change. */
let landAt: 'first' | 'last' = 'first'
let statusSeq = 0
let diffSeq = 0
let watched: string | null = null
let refreshTimer: ReturnType<typeof setTimeout> | null = null
let stale = false

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // storage unavailable
  }
}

watch(opts, writeDiffOpts, { deep: true })
watch(treeMode, (v) => writeLocal(TREE_KEY, v ? '1' : '0'))
watch(
  () => opts.value.whitespace,
  () => void loadDiff(true),
)

const groups = computed(() => groupChanges(entries.value))
/** Files in display order (tree order when grouped by folder, folded folders included): F7 / [ ] walk this. */
const ordered = computed(() =>
  groups.value.flatMap((g) =>
    treeMode.value ? changesTree(g.items).flatMap((r) => (r.kind === 'file' ? [r.entry] : [])) : g.items,
  ),
)
const treeGroups = computed(() =>
  groups.value.map((g) => ({ ...g, rows: changesTree(g.items, new Set([...collapsedDirs.value].filter((k) => k.startsWith(`${g.key}:`)).map((k) => k.slice(g.key.length + 1)))) })),
)
const rowKey = (g: string, r: ChangesTreeRow): string => (r.kind === 'dir' ? `d:${g}:${r.path}` : `f:${r.entry.path}`)
const visibleKeys = computed(() => treeGroups.value.flatMap((g) => g.rows.map((r) => rowKey(g.key, r))))

const selectedEntry = computed(() => entries.value.find((e) => e.path === selected.value) ?? null)
const blocks = computed(() => (diffFile.value ? viewBlocks(diffFile.value, opts.value.highlight) : []))
const lineCount = computed(() => diffFile.value?.hunks.reduce((n, h) => n + h.lines.length, 0) ?? 0)
const collapse = computed(() => opts.value.collapse || lineCount.value > FORCE_COLLAPSE_LINES)
const canRevert = computed(() => selectedEntry.value?.kind === 'modified' && blocks.value.length > 0)
const revertBlocked = computed(() => (opts.value.whitespace !== 'none' ? t('workspace.diff.revertBlocked') : null))

const absolute = (rel: string): string => absoluteIn(repoRoot.value ?? props.cwd, rel)

async function loadStatus(): Promise<void> {
  const run = ++statusSeq
  const res = await changesStatus(repoRoot.value ?? props.cwd)
  if (run !== statusSeq) return
  loading.value = false
  if (!res.ok) {
    statusError.value = res.error
    entries.value = []
    emit('count', 0)
    return
  }
  statusError.value = null
  if (repoRoot.value !== res.root) {
    repoRoot.value = res.root
    emit('root', res.root)
    void setWatch(res.root)
  }
  branch.value = res.branch
  entries.value = res.entries
  truncated.value = res.truncated
  emit('count', res.entries.length)
  if (applySelect()) return
  if (!selected.value || !res.entries.some((e) => e.path === selected.value)) selected.value = ordered.value[0]?.path ?? null
  else void loadDiff(true)
}

/** `select` prop (Show diff / Ctrl+D elsewhere) → that file, once the list is in. */
function applySelect(): boolean {
  const want = props.select
  if (!want || !repoRoot.value) return false
  const hit = entries.value.find((e) => samePath(absolute(e.path), want))
  emit('selected')
  if (!hit) return false
  revealInTree(hit.path)
  if (hit.path === selected.value) void loadDiff(true)
  select(hit.path, true)
  return true
}

watch(
  () => props.select,
  (want) => {
    if (want && !loading.value) applySelect()
  },
)

async function loadDiff(keepPosition = false): Promise<void> {
  const run = ++diffSeq
  const entry = selectedEntry.value
  if (!entry || !repoRoot.value) {
    diffFile.value = null
    diffState.value = 'idle'
    return
  }
  if (!keepPosition) {
    diffState.value = 'loading'
    currentBlock.value = 0
  }
  const res = await changesDiff(repoRoot.value, entry.path, { context: 'full', whitespace: opts.value.whitespace })
  if (run !== diffSeq) return
  if (!res.ok) {
    diffError.value = res.error
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
  const shown = parsed && opts.value.whitespace === 'imports' ? hideImportChanges(parsed) : { file: parsed, hidden: 0 }
  const file = shown.file
  hiddenImports.value = shown.hidden
  diffFile.value = file
  partial.value = !!res.partial
  diffState.value = file?.hunks.length ? 'idle' : 'empty'
  const total = blocks.value.length
  if (!keepPosition && landAt === 'last') currentBlock.value = Math.max(0, total - 1)
  landAt = 'first'
  if (currentBlock.value >= total) currentBlock.value = Math.max(0, total - 1)
  if (total && !keepPosition) void diffView.value?.scrollToBlock(currentBlock.value)
}

watch(selected, () => void loadDiff())
// Highlight "Split changes" turns one Modified block into two: keep the position in range.
watch(
  () => blocks.value.length,
  (n) => {
    if (currentBlock.value >= n) currentBlock.value = Math.max(0, n - 1)
  },
)

async function setWatch(root: string | null): Promise<void> {
  if (watched === root) return
  if (watched) void changesUnwatch(watched)
  watched = root
  if (root && !(await changesWatch(root)) && watched === root) watched = null
}

function scheduleRefresh(): void {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void loadStatus()
  }, 250)
}

// Hidden panes skip git spawns (build output keeps writing); one refresh when shown again.
const offUpdated = onChangesUpdated((c) => {
  if (!repoRoot.value || !samePath(c.root, repoRoot.value)) return
  if (props.active) scheduleRefresh()
  else stale = true
})

function onWindowFocus(): void {
  if (props.active) scheduleRefresh()
}

function select(path: string, focus = false): void {
  selected.value = path
  cursor.value = `f:${path}`
  armed = 0
  if (focus) void nextTick(() => listEl.value?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus())
}

/** Opens the folders above `rel` in the tree so its row exists. */
function revealInTree(rel: string): void {
  if (!treeMode.value || !collapsedDirs.value.size) return
  const next = new Set([...collapsedDirs.value].filter((k) => !rel.startsWith(`${k.slice(k.indexOf(':') + 1)}/`)))
  if (next.size !== collapsedDirs.value.size) collapsedDirs.value = next
}

function stepFile(dir: 1 | -1, land: 'first' | 'last' = 'first', focus = true): boolean {
  const list = ordered.value
  if (!list.length) return false
  const at = list.findIndex((e) => e.path === selected.value)
  const next = list[at + dir]
  if (!next) return false
  landAt = land
  revealInTree(next.path)
  select(next.path, focus)
  return true
}

function focusBlock(i: number): void {
  currentBlock.value = i
  armed = 0
}

function stepBlock(dir: 1 | -1): void {
  const total = blocks.value.length
  const next = currentBlock.value + dir
  if (total && next >= 0 && next < total) {
    armed = 0
    notice.value = null
    currentBlock.value = next
    void diffView.value?.scrollToBlock(next)
    return
  }
  // Past the first / last change: the first press warns, the second moves to the neighbouring file.
  if (armed === dir) {
    armed = 0
    notice.value = null
    stepFile(dir, dir === 1 ? 'first' : 'last')
    return
  }
  const list = ordered.value
  const at = list.findIndex((e) => e.path === selected.value)
  if (!list[at + dir]) return
  armed = dir
  notice.value = t(dir === 1 ? 'workspace.diff.nextFile' : 'workspace.diff.prevFile', { key: keyCombo(['Shift', 'F7'], isMac) })
}

function moveCursor(dir: 1 | -1 | 'home' | 'end'): void {
  const keys = visibleKeys.value
  if (!keys.length) return
  const at = cursor.value ? keys.indexOf(cursor.value) : -1
  const i = dir === 'home' ? 0 : dir === 'end' ? keys.length - 1 : Math.max(0, Math.min(keys.length - 1, (at < 0 ? 0 : at) + dir))
  focusRow(keys[i]!)
}

function focusRow(key: string): void {
  cursor.value = key
  if (key.startsWith('f:')) select(key.slice(2), true)
  else void nextTick(() => listEl.value?.querySelector<HTMLElement>(`[data-row="${CSS.escape(key)}"]`)?.focus())
}

function toggleDir(group: string, path: string, open?: boolean): void {
  const key = `${group}:${path}`
  const next = new Set(collapsedDirs.value)
  const isOpen = !next.has(key)
  if (open === isOpen) return
  if (isOpen) next.add(key)
  else next.delete(key)
  collapsedDirs.value = next
}

function onTreeKey(e: KeyboardEvent): boolean {
  const key = cursor.value
  if (!key) return false
  const row = treeGroups.value.flatMap((g) => g.rows.map((r) => ({ g: g.key, r }))).find((x) => rowKey(x.g, x.r) === key)
  if (!row) return false
  if (e.key === 'ArrowRight' && row.r.kind === 'dir') {
    if (!row.r.expanded) toggleDir(row.g, row.r.path, true)
    else moveCursor(1)
    return true
  }
  if (e.key === 'ArrowLeft') {
    if (row.r.kind === 'dir' && row.r.expanded) {
      toggleDir(row.g, row.r.path, false)
      return true
    }
    const keys = visibleKeys.value
    const rows = treeGroups.value.find((g) => g.key === row.g)!.rows
    const at = rows.findIndex((r) => rowKey(row.g, r) === key)
    for (let i = at - 1; i >= 0; i--) {
      const r = rows[i]!
      if (r.kind === 'dir' && r.depth < row.r.depth) {
        focusRow(rowKey(row.g, r))
        return true
      }
    }
    return keys.length > 0
  }
  if ((e.key === 'Enter' || e.key === ' ') && row.r.kind === 'dir') {
    toggleDir(row.g, row.r.path)
    return true
  }
  return false
}

function onKey(e: KeyboardEvent): void {
  if (pending.value) return
  const target = e.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"], [data-diff-options]')) return
  const key = e.key
  // IntelliJ's diff popup; ⌘⇧D on macOS is the v18 split, so it is ⌃⇧D there too.
  if (e.code === 'KeyD' && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) {
    e.preventDefault()
    optionsOpen.value = true
    return
  }
  if (key === 'F7' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault()
    stepBlock(e.shiftKey ? -1 : 1)
    return
  }
  if (key === 'F4' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    e.preventDefault()
    openSelected()
    return
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return
  const inList = !!listEl.value?.contains(target)
  if (!inList && scrollSideways(e)) {
    e.preventDefault()
    return
  }
  if (treeMode.value && inList && onTreeKey(e)) {
    e.preventDefault()
    return
  }
  const step = fileStepKey(e)
  if (step) {
    // Tree rows keep ← / → for folders; toolbar / radiogroup keep them for their own focus.
    if ((treeMode.value && inList) || target?.closest('[role=toolbar],[role=radiogroup]')) return
    e.preventDefault()
    armed = 0
    notice.value = null
    stepFile(step, 'first', inList)
    // The diff unmounts while the next file loads: keep focus in this pane so the next arrow still lands here.
    if (!inList) rootEl.value?.focus()
    return
  }
  if (key === 'ArrowDown' || key === 'ArrowUp') {
    // Arrows keep scrolling the diff when focus is there.
    if (!inList && target !== rootEl.value) return
    e.preventDefault()
    if (treeMode.value) moveCursor(key === 'ArrowDown' ? 1 : -1)
    else stepFile(key === 'ArrowDown' ? 1 : -1)
  } else if (key === 'j' || key === 'J' || key === 'k' || key === 'K') {
    e.preventDefault()
    stepBlock(key.toLowerCase() === 'j' ? 1 : -1)
  } else if (key === '[' || key === ']') {
    e.preventDefault()
    notice.value = null
    stepFile(key === ']' ? 1 : -1)
  } else if (key === 'Home' || key === 'End') {
    if (!inList) return
    e.preventDefault()
    if (treeMode.value) moveCursor(key === 'Home' ? 'home' : 'end')
    else {
      const list = ordered.value
      const pick = key === 'Home' ? list[0] : list[list.length - 1]
      if (pick) select(pick.path, true)
    }
  }
}

function openSelected(line?: number): void {
  const entry = selectedEntry.value
  if (!entry || entry.kind === 'deleted') return
  emit('open', absolute(entry.path), line ?? diffView.value?.sourceLine() ?? diffView.value?.lineOf(currentBlock.value))
}

const trashName = computed(() => t(`workspace.changes.trash.${isMac ? 'mac' : 'win'}`))

const confirmText = computed(() => {
  const p = pending.value
  if (!p) return null
  const name = baseName(p.entry.path)
  const out: string[] = []
  if (p.block !== undefined) {
    const b = blocks.value[p.block]
    out.push(t('workspace.changes.confirm.lines', { added: b?.adds.length ?? 0, removed: b?.dels.length ?? 0 }))
    const preview = [...(b?.dels ?? []).map((l) => `− ${l.text}`), ...(b?.adds ?? []).map((l) => `+ ${l.text}`)].slice(0, 12)
    out.push(t('workspace.changes.confirm.noUndo'))
    return { title: t('workspace.diff.confirmTitle', { name }), lines: out, preview }
  }
  const e = p.entry
  if (e.kind === 'untracked') out.push(t('workspace.changes.confirm.untracked', { trash: trashName.value }))
  else if (e.kind === 'added') out.push(t('workspace.changes.confirm.added', { trash: trashName.value }))
  else if (e.kind === 'renamed') out.push(t('workspace.changes.confirm.renamed', { name, orig: baseName(e.origPath ?? ''), trash: trashName.value }))
  else if (e.kind === 'deleted') out.push(t('workspace.changes.confirm.deleted'))
  if (e.kind === 'modified' || e.kind === 'renamed' || e.kind === 'added' || e.kind === 'untracked') {
    if (e.added !== undefined || e.removed !== undefined) out.push(t('workspace.changes.confirm.lines', { added: e.added ?? 0, removed: e.removed ?? 0 }))
  }
  if (e.staged) out.push(t('workspace.changes.confirm.staged'))
  if (e.kind === 'modified') out.push(t('workspace.changes.confirm.noUndo'))
  return { title: t('workspace.changes.confirm.titleFile', { name }), lines: out, preview: [] as string[] }
})

function askDiscard(block?: number): void {
  const entry = selectedEntry.value
  if (!entry || entry.kind === 'conflict') return
  if (block !== undefined && (revertBlocked.value || !canRevert.value)) return
  pending.value = { entry, block }
}

async function confirmDiscard(): Promise<void> {
  const p = pending.value
  const root = repoRoot.value
  pending.value = null
  if (!p || !root) return
  const file = diffFile.value
  const block = p.block !== undefined ? blocks.value[p.block] : undefined
  const res = await changesDiscard(root, p.entry.path, block && file ? blockPatch(file, block) : undefined)
  if (res.ok) notice.value = null
  else if (res.error === 'failed') notice.value = t('workspace.changes.discardFailed', { detail: res.detail ?? '' })
  else notice.value = t(`workspace.changes.error.${res.error}`)
  await loadStatus()
}

function setOpt<K extends keyof DiffOpts>(key: K, value: DiffOpts[K]): void {
  opts.value = { ...opts.value, [key]: value }
}

type DiffCommand = 'prevChange' | 'nextChange' | 'prevFile' | 'nextFile' | 'source' | 'side'
const COMMANDS: { id: DiffCommand; keys: string }[] = [
  { id: 'prevChange', keys: 'Shift+F7' },
  { id: 'nextChange', keys: 'F7' },
  { id: 'prevFile', keys: '←' },
  { id: 'nextFile', keys: '→' },
  { id: 'source', keys: 'F4' },
  { id: 'side', keys: isMac ? '⌃⇧Tab' : '' },
]
const optionsKeys = isMac ? '⌃⇧D' : 'Ctrl+Shift+D'

function runCommand(id: DiffCommand): void {
  optionsOpen.value = false
  if (id === 'side') {
    diffView.value?.switchSide()
    return
  }
  rootEl.value?.focus()
  notice.value = null
  if (id === 'prevChange' || id === 'nextChange') stepBlock(id === 'nextChange' ? 1 : -1)
  else if (id === 'prevFile' || id === 'nextFile') stepFile(id === 'nextFile' ? 1 : -1, 'first', false)
  else openSelected()
}

function onOptionsKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    optionsOpen.value = false
    optionsButton.value?.focus()
    return
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  e.preventDefault()
  const items = [...(optionsEl.value?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])]
  const at = items.indexOf(document.activeElement as HTMLElement)
  items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
}

function onPointerDown(e: PointerEvent): void {
  if (!optionsOpen.value) return
  const target = e.target as Node
  if (optionsEl.value?.contains(target) || optionsButton.value?.contains(target)) return
  optionsOpen.value = false
}

watch(optionsOpen, (open) => {
  if (open) void nextTick(() => optionsEl.value?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus())
})

watch(
  () => props.active,
  (active) => {
    if (!active || !stale) return
    stale = false
    scheduleRefresh()
  },
)

watch(
  () => props.cwd,
  () => {
    repoRoot.value = null
    selected.value = null
    loading.value = true
    void loadStatus()
  },
)

watch(treeMode, () => {
  cursor.value = selected.value ? `f:${selected.value}` : null
})

onMounted(() => {
  window.addEventListener('focus', onWindowFocus)
  window.addEventListener('pointerdown', onPointerDown, true)
  if (hasChanges) void loadStatus()
  else loading.value = false
})

onBeforeUnmount(() => {
  window.removeEventListener('focus', onWindowFocus)
  window.removeEventListener('pointerdown', onPointerDown, true)
  offUpdated()
  if (refreshTimer) clearTimeout(refreshTimer)
  void setWatch(null)
})

const lang = computed(() => (selectedEntry.value ? grammarFor(undefined, selectedEntry.value.path) : null))
const countsLabel = (e: ChangeEntry): string => t('workspace.changes.counts', { added: e.added ?? 0, removed: e.removed ?? 0 })
const rowTabIndex = (key: string): number => (cursor.value ? (cursor.value === key ? 0 : -1) : key === visibleKeys.value[0] ? 0 : -1)
const MENU_ROW = 'flex h-7 w-full cursor-pointer items-center gap-2 rounded-inner px-2 text-left text-xs text-ink outline-none hover:bg-fill focus-visible:bg-accent focus-visible:text-on-accent'
</script>

<template>
  <section
    ref="rootEl"
    tabindex="-1"
    class="@container flex min-h-0 min-w-0 flex-col overflow-hidden rounded-card bg-surface shadow-card outline-none"
    :aria-label="t('workspace.changes.title')"
    @keydown="onKey"
  >
    <div class="ccm-material flex h-9 min-w-0 shrink-0 items-center gap-1 border-b border-line px-2" role="toolbar" :aria-label="t('workspace.changes.toolbar')">
      <GitCompare :size="15" class="mr-0.5 shrink-0 text-ink-muted" aria-hidden="true" />
      <span class="shrink-0 text-xs font-semibold text-ink">{{ t('workspace.changes.title') }}</span>
      <span v-if="entries.length" class="shrink-0 rounded-full bg-fill px-1.5 text-2xs tabular text-ink-muted">{{ entries.length }}</span>
      <span v-if="branch" class="ml-1 hidden min-w-0 items-center gap-1 truncate text-2xs text-ink-faint @md:inline-flex" :title="repoRoot ?? cwd">
        <GitBranch :size="12" class="shrink-0" aria-hidden="true" />
        <span class="truncate">{{ branch }}</span>
      </span>
      <span class="min-w-0 flex-1" />
      <button
        type="button"
        class="ccm-btn-plain shrink-0"
        :aria-pressed="treeMode"
        :title="`${t('workspace.diff.listMode')}: ${treeMode ? t('workspace.diff.tree') : t('workspace.diff.flat')}`"
        :aria-label="t('workspace.diff.tree')"
        data-changes-tree
        @click="treeMode = !treeMode"
      >
        <ListTree :size="14" aria-hidden="true" />
      </button>
      <div class="flex shrink-0 rounded-inner bg-fill p-0.5" role="radiogroup" :aria-label="t('workspace.changes.layout')">
        <button
          v-for="v in ['inline', 'split'] as const"
          :key="v"
          type="button"
          role="radio"
          :aria-checked="opts.layout === v"
          class="h-6 cursor-pointer rounded-[5px] px-2 text-2xs font-medium transition-colors duration-(--ccm-dur-fast)"
          :class="opts.layout === v ? 'bg-control text-ink shadow-control' : 'text-ink-muted hover:text-ink'"
          @click="setOpt('layout', v)"
        >
          {{ t(`workspace.changes.${v}`) }}
        </button>
      </div>
      <div class="relative shrink-0">
        <button
          ref="optionsButton"
          type="button"
          class="ccm-btn-plain"
          aria-haspopup="menu"
          :aria-expanded="optionsOpen"
          :title="`${t('workspace.diff.options')} (${optionsKeys})`"
          :aria-label="t('workspace.diff.options')"
          data-diff-options-button
          @click="optionsOpen = !optionsOpen"
        >
          <SlidersHorizontal :size="14" aria-hidden="true" />
        </button>
        <Transition name="ccm-menu">
          <div
            v-if="optionsOpen"
            ref="optionsEl"
            class="ccm-menu ccm-scroll absolute top-full right-0 z-20 mt-1 flex max-h-[70vh] w-64 flex-col overflow-y-auto p-1"
            style="--ccm-origin: top right"
            role="menu"
            :aria-label="t('workspace.diff.options')"
            data-diff-options
            @keydown="onOptionsKey"
          >
            <p class="px-2 pt-1 pb-0.5 text-2xs font-semibold text-ink-faint" aria-hidden="true">{{ t('workspace.diff.commands') }}</p>
            <div role="group" :aria-label="t('workspace.diff.commands')">
              <template v-for="c in COMMANDS" :key="c.id">
                <button
                  v-if="c.id !== 'side' || opts.layout === 'split'"
                  type="button"
                  role="menuitem"
                  :class="MENU_ROW"
                  :data-diff-cmd="c.id"
                  @click="runCommand(c.id)"
                >
                  <span class="w-[13px] shrink-0" aria-hidden="true" />
                  <span class="min-w-0 flex-1 truncate">{{ t(`workspace.diff.cmd.${c.id}`) }}</span>
                  <span v-if="c.keys" class="shrink-0 text-2xs text-ink-faint">{{ c.keys }}</span>
                </button>
              </template>
            </div>
            <div class="my-1 border-t border-line" aria-hidden="true" />
            <button type="button" role="menuitemcheckbox" :aria-checked="opts.collapse" :class="MENU_ROW" @click="setOpt('collapse', !opts.collapse)">
              <Check :size="13" class="shrink-0" :class="opts.collapse ? '' : 'invisible'" aria-hidden="true" />
              {{ t('workspace.diff.collapse') }}
            </button>
            <p class="px-2 pt-2 pb-0.5 text-2xs font-semibold text-ink-faint" aria-hidden="true">{{ t('workspace.diff.context') }}</p>
            <div role="group" :aria-label="t('workspace.diff.context')">
              <button
                v-for="n in CONTEXTS"
                :key="n"
                type="button"
                role="menuitemradio"
                :aria-checked="opts.context === n"
                :aria-disabled="!opts.collapse"
                :class="[MENU_ROW, opts.collapse ? '' : 'text-ink-faint']"
                @click="opts.collapse && setOpt('context', n)"
              >
                <Check :size="13" class="shrink-0" :class="opts.context === n ? '' : 'invisible'" aria-hidden="true" />
                {{ t('workspace.diff.contextN', { n }) }}
              </button>
            </div>
            <p class="px-2 pt-2 pb-0.5 text-2xs font-semibold text-ink-faint" aria-hidden="true">{{ t('workspace.diff.whitespace') }}</p>
            <div role="group" :aria-label="t('workspace.diff.whitespace')">
              <button
                v-for="w in WHITESPACE"
                :key="w"
                type="button"
                role="menuitemradio"
                :aria-checked="opts.whitespace === w"
                :class="MENU_ROW"
                :data-ws="w"
                @click="setOpt('whitespace', w)"
              >
                <Check :size="13" class="shrink-0" :class="opts.whitespace === w ? '' : 'invisible'" aria-hidden="true" />
                {{ t(`workspace.diff.ws.${w}`) }}
              </button>
            </div>
            <p class="px-2 pt-2 pb-0.5 text-2xs font-semibold text-ink-faint" aria-hidden="true">{{ t('workspace.diff.highlight') }}</p>
            <div role="group" :aria-label="t('workspace.diff.highlight')">
              <button
                v-for="h in HIGHLIGHTS"
                :key="h"
                type="button"
                role="menuitemradio"
                :aria-checked="opts.highlight === h"
                :class="MENU_ROW"
                :data-hl="h"
                @click="setOpt('highlight', h)"
              >
                <Check :size="13" class="shrink-0" :class="opts.highlight === h ? '' : 'invisible'" aria-hidden="true" />
                {{ t(`workspace.diff.hl.${h}`) }}
              </button>
            </div>
            <p class="px-2 pt-2 pb-0.5 text-2xs font-semibold text-ink-faint" aria-hidden="true">{{ t('workspace.diff.splitView') }}</p>
            <div role="group" :aria-label="t('workspace.diff.splitView')">
              <button
                v-for="k in ['align', 'sync'] as const"
                :key="k"
                type="button"
                role="menuitemcheckbox"
                :aria-checked="opts[k]"
                :aria-disabled="opts.layout !== 'split'"
                :title="opts.layout !== 'split' ? t('workspace.diff.splitOnly') : undefined"
                :class="[MENU_ROW, opts.layout === 'split' ? '' : 'text-ink-faint']"
                :data-diff-toggle="k"
                @click="opts.layout === 'split' && setOpt(k, !opts[k])"
              >
                <Check :size="13" class="shrink-0" :class="opts[k] ? '' : 'invisible'" aria-hidden="true" />
                {{ t(`workspace.diff.${k}`) }}
              </button>
            </div>
          </div>
        </Transition>
      </div>
      <button v-if="hasLog && repoRoot" type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.log.open')" :aria-label="t('workspace.log.open')" data-changes-log @click="emit('log', repoRoot)">
        <GitGraph :size="14" aria-hidden="true" />
      </button>
      <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.changes.refresh')" :aria-label="t('workspace.changes.refresh')" @click="loadStatus">
        <RotateCw :size="14" aria-hidden="true" />
      </button>
      <slot name="end" />
    </div>

    <p v-if="notice" class="flex shrink-0 items-center gap-1.5 border-b border-line bg-st-waiting-soft px-3 py-1.5 text-xs text-ink" role="status">
      <FileWarning :size="13" class="shrink-0" aria-hidden="true" />
      <span class="min-w-0 flex-1 truncate" :title="notice">{{ notice }}</span>
    </p>

    <div v-if="!hasChanges || statusError" class="grid min-h-0 flex-1 place-items-center p-6">
      <div class="flex max-w-sm flex-col items-center gap-2 text-center">
        <FileWarning :size="26" class="text-ink-faint" aria-hidden="true" />
        <p class="text-sm text-ink-muted">{{ !hasChanges ? t('workspace.changes.unavailable') : t(`workspace.changes.error.${statusError}`) }}</p>
      </div>
    </div>
    <div v-else-if="loading" class="grid min-h-0 flex-1 place-items-center text-xs text-ink-muted" role="status">{{ t('workspace.changes.loading') }}</div>
    <div v-else-if="!entries.length" class="grid min-h-0 flex-1 place-items-center p-6">
      <div class="flex max-w-sm flex-col items-center gap-1.5 text-center">
        <GitCompare :size="26" class="text-ink-faint" aria-hidden="true" />
        <p class="text-sm font-medium text-ink">{{ t('workspace.changes.empty') }}</p>
        <p class="text-xs text-ink-muted">{{ t('workspace.changes.emptyHint') }}</p>
      </div>
    </div>

    <div v-else class="flex min-h-0 flex-1 flex-col @2xl:flex-row">
      <div
        ref="listEl"
        class="ccm-scroll max-h-[38%] shrink-0 overflow-y-auto border-b border-line py-1 @2xl:max-h-none @2xl:w-64 @2xl:border-r @2xl:border-b-0"
        :role="treeMode ? 'tree' : 'listbox'"
        :aria-label="t('workspace.changes.files')"
      >
        <div v-for="g in treeGroups" :key="g.key" role="group" :aria-labelledby="`chg-${g.key}`">
          <p :id="`chg-${g.key}`" class="flex items-center gap-1.5 px-3 pb-0.5 pt-2 text-2xs font-semibold text-ink-faint">
            {{ t(`workspace.changes.groups.${g.key}`) }}
            <span class="tabular font-normal">{{ g.items.length }}</span>
          </p>
          <template v-if="treeMode">
            <template v-for="r in g.rows" :key="rowKey(g.key, r)">
              <div
                v-if="r.kind === 'dir'"
                role="treeitem"
                :aria-expanded="r.expanded"
                :aria-level="r.depth + 1"
                :aria-label="t('workspace.diff.folder', { name: r.name, n: r.count }, r.count)"
                :tabindex="rowTabIndex(rowKey(g.key, r))"
                :data-row="rowKey(g.key, r)"
                class="mx-1 flex h-7 cursor-pointer items-center gap-1 rounded-inner pr-2 text-xs text-ink-muted outline-none hover:bg-fill focus-visible:ring-2 focus-visible:ring-focus"
                :style="{ paddingLeft: `${4 + r.depth * 12}px` }"
                @click="((cursor = rowKey(g.key, r)), toggleDir(g.key, r.path))"
              >
                <ChevronRight :size="12" class="shrink-0 transition-transform duration-(--ccm-dur-fast)" :class="r.expanded ? 'rotate-90' : ''" aria-hidden="true" />
                <Folder :size="13" class="shrink-0 text-ink-faint" aria-hidden="true" />
                <span class="min-w-0 flex-1 truncate">{{ r.name }}</span>
                <span class="shrink-0 text-2xs tabular text-ink-faint" aria-hidden="true">{{ r.count }}</span>
              </div>
              <div
                v-else
                role="treeitem"
                :aria-level="r.depth + 1"
                :aria-selected="r.entry.path === selected"
                :tabindex="rowTabIndex(rowKey(g.key, r))"
                :data-row="rowKey(g.key, r)"
                class="mx-1 flex h-7 cursor-pointer items-center gap-2 rounded-inner pr-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-focus"
                :class="r.entry.path === selected ? 'bg-accent-soft text-accent-ink' : 'text-ink hover:bg-fill'"
                :style="{ paddingLeft: `${20 + r.depth * 12}px` }"
                :title="r.entry.path"
                @click="select(r.entry.path)"
                @dblclick="openSelected()"
              >
                <span class="w-3 shrink-0 text-center font-mono text-2xs font-semibold" :class="r.entry.path === selected ? 'text-accent-ink' : KIND_CLASS[r.entry.kind]" aria-hidden="true">{{
                  KIND_LETTER[r.entry.kind]
                }}</span>
                <span class="sr-only">{{ t(`workspace.changes.kind.${r.entry.kind}`) }}{{ r.entry.staged ? `, ${t('workspace.changes.staged')}` : '' }}:</span>
                <span class="min-w-0 flex-1 truncate font-medium">{{ baseName(r.entry.path) }}</span>
                <span v-if="!r.entry.binary && (r.entry.added || r.entry.removed)" class="shrink-0 text-2xs tabular" :aria-label="countsLabel(r.entry)">
                  <span v-if="r.entry.added" class="text-diff-add">+{{ r.entry.added }}</span>
                  <span v-if="r.entry.removed" class="ml-1 text-diff-del">−{{ r.entry.removed }}</span>
                </span>
              </div>
            </template>
          </template>
          <template v-else>
            <div
              v-for="e in g.items"
              :key="e.path"
              role="option"
              :aria-selected="e.path === selected"
              :tabindex="e.path === selected ? 0 : -1"
              class="mx-1 flex h-7 cursor-pointer items-center gap-2 rounded-inner px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-focus"
              :class="e.path === selected ? 'bg-accent-soft text-accent-ink' : 'text-ink hover:bg-fill'"
              :title="e.origPath ? `${t('workspace.changes.renamedFrom', { path: e.origPath })}\n${e.path}` : e.path"
              @click="select(e.path)"
              @dblclick="openSelected()"
            >
              <span class="w-3 shrink-0 text-center font-mono text-2xs font-semibold" :class="e.path === selected ? 'text-accent-ink' : KIND_CLASS[e.kind]" aria-hidden="true">{{
                KIND_LETTER[e.kind]
              }}</span>
              <span class="sr-only">{{ t(`workspace.changes.kind.${e.kind}`) }}{{ e.staged ? `, ${t('workspace.changes.staged')}` : '' }}:</span>
              <span class="min-w-0 flex-1 truncate">
                <span class="font-medium">{{ baseName(e.path) }}</span>
                <span v-if="dirOfRel(e.path)" class="ml-1.5" :class="e.path === selected ? 'text-accent-ink' : 'text-ink-faint'" dir="rtl"
                  ><bdi>{{ dirOfRel(e.path) }}</bdi></span
                >
              </span>
              <span v-if="!e.binary && (e.added || e.removed)" class="shrink-0 text-2xs tabular" :aria-label="countsLabel(e)">
                <span v-if="e.added" class="text-diff-add">+{{ e.added }}</span>
                <span v-if="e.removed" class="ml-1 text-diff-del">−{{ e.removed }}</span>
              </span>
            </div>
          </template>
        </div>
        <p v-if="truncated" class="px-3 py-2 text-2xs text-ink-faint">{{ t('workspace.changes.truncated', { n: entries.length }) }}</p>
      </div>

      <div class="flex min-h-0 min-w-0 flex-1 flex-col bg-well">
        <div v-if="selectedEntry" class="flex h-8 min-w-0 shrink-0 items-center gap-1 border-b border-well-line px-2 text-well-ink">
          <span class="min-w-0 flex-1 truncate font-mono text-2xs" :title="absolute(selectedEntry.path)" data-changes-path>
            <template v-if="selectedEntry.origPath">{{ selectedEntry.origPath }} → </template>{{ selectedEntry.path }}
          </span>
          <span v-if="blocks.length" class="shrink-0 text-2xs tabular text-well-ink" aria-live="polite" data-diff-position>{{
            t('workspace.diff.change', { n: currentBlock + 1, total: blocks.length })
          }}</span>
          <span class="hidden shrink-0 text-2xs text-well-ink @3xl:inline">· {{ t('workspace.diff.keysHint') }}</span>
          <button
            v-if="selectedEntry.kind !== 'deleted'"
            type="button"
            class="well-btn ccm-btn-plain shrink-0 gap-1 text-2xs"
            :title="`${t('workspace.changes.openFile')} (F4)`"
            @click="openSelected()"
          >
            <SquareArrowOutUpRight :size="13" aria-hidden="true" />
            <span class="hidden @md:inline">{{ t('workspace.changes.openFile') }}</span>
            <span class="sr-only @md:hidden">{{ t('workspace.changes.openFile') }}</span>
          </button>
          <button
            v-if="selectedEntry.kind !== 'conflict'"
            type="button"
            class="well-btn well-danger ccm-btn-plain shrink-0 gap-1 text-2xs"
            :title="t('workspace.changes.discardFile')"
            @click="askDiscard()"
          >
            <Undo2 :size="13" aria-hidden="true" />
            <span class="hidden @md:inline">{{ t('workspace.changes.discardFile') }}</span>
            <span class="sr-only @md:hidden">{{ t('workspace.changes.discardFile') }}</span>
          </button>
        </div>
        <p v-if="partial && diffState === 'idle'" class="shrink-0 border-b border-well-line px-3 py-1 text-2xs text-well-ink">{{ t('workspace.diff.partial') }}</p>
        <p v-if="hiddenImports && (diffState === 'idle' || diffState === 'empty')" class="shrink-0 border-b border-well-line px-3 py-1 text-2xs text-well-ink" data-diff-imports-hidden>
          {{ t('workspace.diff.importsHidden', { n: hiddenImports }, hiddenImports) }}
        </p>
        <div class="ccm-scroll min-h-0 flex-1" :class="opts.layout === 'split' && diffFile && diffState === 'idle' ? 'overflow-hidden' : 'overflow-auto'">
          <div v-if="!selectedEntry" class="grid size-full place-items-center p-6 text-sm text-well-ink">{{ t('workspace.changes.selectFile') }}</div>
          <div v-else-if="diffState === 'loading'" class="grid size-full place-items-center text-xs text-well-ink" role="status">{{ t('workspace.changes.loading') }}</div>
          <div v-else-if="diffState !== 'idle' || !diffFile" class="grid size-full place-items-center p-6 text-center text-sm text-well-ink">
            {{
              diffState === 'binary'
                ? t('workspace.changes.binary')
                : diffState === 'too-large'
                  ? t('workspace.changes.tooLarge')
                  : diffState === 'error' && diffError
                    ? t(`workspace.changes.error.${diffError}`)
                    : opts.whitespace !== 'none'
                      ? t('workspace.diff.noChanges')
                      : t('workspace.changes.noDiff')
            }}
          </div>
          <DiffView
            v-else
            ref="diffView"
            :file="diffFile"
            :blocks="blocks"
            :layout="opts.layout"
            :lang="lang"
            :collapse="collapse"
            :context="opts.context"
            :highlight="opts.highlight"
            :align="opts.align"
            :sync="opts.sync"
            :can-revert="canRevert"
            :revert-blocked="revertBlocked"
            :current="currentBlock"
            @revert="askDiscard"
            @focus-block="focusBlock"
          />
        </div>
      </div>
    </div>

    <DiscardConfirm
      v-if="pending && confirmText"
      :title="confirmText.title"
      :lines="confirmText.lines"
      :preview="confirmText.preview"
      @confirm="confirmDiscard"
      @cancel="pending = null"
    />
  </section>
</template>

<style scoped>
/* Buttons on the dark well keep well ink; hover tints stay inside the well. */
.well-btn {
  min-height: 24px;
  color: var(--ccm-well-ink);
}
.well-btn:hover:not(:disabled) {
  background: var(--ccm-well-line);
  color: var(--ccm-well-ink);
}
.well-danger:hover:not(:disabled) {
  color: var(--ccm-diff-del-well, #ff6961);
}
</style>
