<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, ChevronLeft, ChevronRight, PanelLeft } from 'lucide-vue-next'
import type { CommitFile } from '@ccm/shared'
import { absoluteIn } from '../../../lib/changesView'
import { grammarFor } from '../../../lib/codeView'
import { parseUnifiedDiff, type DiffFile } from '../../../lib/diff'
import { changeBlocks } from '../../../lib/diffBlocks'
import { readDiffOpts } from '../../../lib/diffOpts'
import { hasFilters } from '../../../lib/logQuery'
import { logDiff } from '../../../lib/preview'
import { useGitLog } from '../../../composables/useGitLog'
import DiffView from '../DiffView.vue'
import LogCommitDetails from './LogCommitDetails.vue'
import LogCommitFiles from './LogCommitFiles.vue'
import LogFilterBar from './LogFilterBar.vue'
import LogRefsTree from './LogRefsTree.vue'
import LogTable from './LogTable.vue'

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
  const onUp = (): void => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

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
  return hasFilters(log.filters.value) ? 'filtered' : log.refs.value?.head.hash ? 'filtered' : 'repo'
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
const blocks = computed(() => (diffFile.value ? changeBlocks(diffFile.value) : []))
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
  diffFile.value = parseUnifiedDiff(res.text)[0] ?? null
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

function onKey(e: KeyboardEvent): void {
  if (!props.active) return
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
  else return
  e.preventDefault()
}

function openCommit(hash: string): void {
  log.select(hash)
  const first = commitFiles.value[0]
  if (first && log.detail.value?.ok && log.detail.value.hash === hash) void openDiff(first)
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
  window.removeEventListener('keydown', onKey)
  window.removeEventListener('pointerdown', closeMenu)
})
const lang = computed(() => (diffFileRef.value ? grammarFor(undefined, diffFileRef.value.path) : null))
const shortHash = computed(() => log.selected.value?.slice(0, 8) ?? '')
</script>

<template>
  <section ref="rootEl" class="flex min-h-0 min-w-0 flex-col bg-surface" :aria-label="t('workspace.log.title')" data-log-pane>
    <div class="flex h-9 shrink-0 items-center gap-1 border-b border-line px-2">
      <button type="button" class="ccm-btn-plain size-6 p-0" :aria-pressed="cols.refsOpen" :title="t(cols.refsOpen ? 'workspace.log.refs.hide' : 'workspace.log.refs.show')" :aria-label="t(cols.refsOpen ? 'workspace.log.refs.hide' : 'workspace.log.refs.show')" @click="cols.refsOpen = !cols.refsOpen">
        <PanelLeft :size="14" aria-hidden="true" />
      </button>
      <span class="min-w-0 truncate text-xs font-semibold text-ink" :title="log.root.value ?? cwd">{{ t('workspace.log.title') }}</span>
      <span class="flex-1" />
      <slot name="end" />
    </div>

    <p v-if="log.error.value && !log.commits.value.length" class="grid flex-1 place-items-center p-6 text-sm text-ink-muted">{{ t(`workspace.log.error.${log.error.value}`) }}</p>

    <div v-else class="flex min-h-0 min-w-0 flex-1">
      <template v-if="cols.refsOpen">
        <LogRefsTree class="shrink-0" :style="{ width: `${cols.refs}px` }" :refs="log.refs.value" :branch="log.filters.value.branch" @pick="(name) => log.setFilters({ branch: name })" />
        <div class="w-1 shrink-0 cursor-col-resize border-l border-line hover:bg-fill" role="separator" aria-orientation="vertical" @pointerdown.prevent="drag($event, 'refs')" />
      </template>

      <div v-if="diffFileRef" class="flex min-h-0 min-w-0 flex-1 flex-col" data-log-diff>
        <div class="flex h-8 shrink-0 items-center gap-1 border-b border-line px-2 text-xs">
          <button type="button" class="ccm-btn-plain h-6 gap-1 px-1.5" :title="`${t('workspace.log.diff.back')} (Esc)`" data-log-diff-back @click="closeDiff">
            <ArrowLeft :size="13" aria-hidden="true" />{{ t('workspace.log.diff.back') }}
          </button>
          <span class="min-w-0 flex-1 truncate font-mono text-ink" :title="diffFileRef.path">{{ t('workspace.log.diff.title', { path: diffFileRef.path, hash: shortHash }) }}</span>
          <button type="button" class="ccm-btn-plain size-6 p-0" :title="`${t('workspace.log.diff.prevFile')} ([)`" :aria-label="t('workspace.log.diff.prevFile')" @click="stepFile(-1)"><ChevronLeft :size="14" aria-hidden="true" /></button>
          <button type="button" class="ccm-btn-plain size-6 p-0" :title="`${t('workspace.log.diff.nextFile')} (])`" :aria-label="t('workspace.log.diff.nextFile')" @click="stepFile(1)"><ChevronRight :size="14" aria-hidden="true" /></button>
          <span class="hidden truncate text-2xs text-ink-faint md:inline">{{ t('workspace.log.diff.keys') }}</span>
        </div>
        <div class="ccm-scroll min-h-0 flex-1 overflow-auto bg-well">
          <p v-if="diffState === 'loading'" class="p-4 text-xs text-well-ink">…</p>
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
            :words="opts.words"
            :can-revert="false"
            :current="currentBlock"
            @focus-block="(i) => (currentBlock = i)"
          />
        </div>
      </div>

      <template v-else>
        <div class="flex min-h-0 min-w-0 flex-1 flex-col">
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
            @select="log.select"
            @open="openCommit"
            @load-more="log.loadMore()"
            @menu="commitMenu"
            @clear="log.setFilters({ text: '', branch: null, author: null, date: 'any', from: '', to: '', paths: [] })"
          />
        </div>
        <div class="w-1 shrink-0 cursor-col-resize border-l border-line hover:bg-fill" role="separator" aria-orientation="vertical" @pointerdown.prevent="drag($event, 'side')" />
        <div ref="sideEl" class="flex min-h-0 shrink-0 flex-col" :style="{ width: `${cols.side}px` }">
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
  </section>
</template>
