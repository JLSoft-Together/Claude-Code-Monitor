<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ChevronRight,
  ChevronsDownUp,
  ClipboardCopy,
  Eye,
  File,
  FileCode,
  FileImage,
  FileJson,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GitCompare,
  Languages,
  Link2,
  Package,
  PackageSearch,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  RotateCw,
  SquareSplitHorizontal,
  SquareTerminal,
  Trash2,
} from 'lucide-vue-next'
import ContextMenu from '../ui/ContextMenu.vue'
import { isShowDiffKey, KIND_CLASS, KIND_LETTER, pathKey, samePath, type GitMarks } from '../../lib/changesView'
import { hasRun } from '../../lib/desktop'
import { hasApkSize } from '../../lib/apkSize'
import { hasI18nScan, hasPreview } from '../../lib/preview'
import { hasLibsCheck } from '../../lib/libVersions'
import { warmOnIntent } from '../../lib/layoutPreview'
import { explorerKey, explorerMenu, type ExplorerAction } from '../../lib/explorer/contextMenu'
import { setDragPath } from '../../lib/explorer/dragPath'
import { findAction, isSeparator, type MenuEntry } from '../../lib/menu'
import { isMac } from '../../lib/platform'
import { nextRevealStep } from '../../lib/explorer/reveal'
import { fileGlyph, parentDirectory, resolveFocusIndex, type FileGlyph, type TreeRow } from '../../lib/explorer/tree'
import { fileIcon, folderIcon, openDirectories, type AtomIcon } from '../../lib/explorer/fileIcons'
import { modeOf } from '../../lib/themes'
import { useChecksStore } from '../../stores/checks'
import { useExplorerStore } from '../../stores/explorer'
import { useSettingsStore } from '../../stores/settings'
import { useWorkspaceStore } from '../../stores/workspace'
import { useRunMarks } from '../../composables/useRunMarks'
import { dirKey } from '../../stores/favorites'
import RunProjectMark from './RunProjectMark.vue'

const props = defineProps<{
  /** File shown by the focused viewer: marked, and revealed when it is inside the root. */
  activePath: string | null
  /** Git status of the project: names coloured by kind, folders above changes marked. */
  git?: GitMarks | null
  /** The project is a git repo: the row menu shows Git ▸ Show Diff. */
  repo?: boolean
  /** File picked with "Select for Compare". */
  compareSel?: { path: string; name: string } | null
}>()
const emit = defineEmits<{
  open: [path: string, keep: boolean]
  /** Ctrl+D (⌥⌘D) on a changed file. */
  openDiff: [path: string]
  create: [kind: 'file' | 'directory']
  /** Row context menu / shortcut. */
  action: [id: ExplorerAction, row: TreeRow]
}>()

const { t } = useI18n()
const explorer = useExplorerStore()
const runMarks = useRunMarks(() => explorer.root)
const checks = useChecksStore()
const problemOf = (row: TreeRow) => (row.directory || !checks.marked.size ? undefined : checks.marked.get(pathKey(row.path)))
const PROBLEM_CLASS = { error: 'underline decoration-wavy decoration-st-error underline-offset-3', warning: 'underline decoration-wavy decoration-warning underline-offset-3' } as const
const runMark = (row: TreeRow) => (row.directory && !row.outOfRoot ? runMarks.value.get(dirKey(row.depth === 0 ? (explorer.root ?? row.path) : row.path)) : undefined)

/** Fixed row height and overscan: the window is index arithmetic over `explorer.rows`. */
const ROW = 22
const OVERSCAN = 8
const INDENT = 14

const GLYPH: Record<FileGlyph, typeof File> = { code: FileCode, json: FileJson, image: FileImage, text: FileText, file: File }

const settings = useSettingsStore()
const workspace = useWorkspaceStore()
const atom = computed(() => settings.fileIcons === 'atom')
const dark = computed(() => modeOf(settings.theme) === 'dark')
// Folders holding a file open in a viewer get the open icon, as the plugin's hollow folders do; expanding does not.
const openDirs = computed(() =>
  atom.value ? openDirectories(workspace.panes.flatMap((p) => (p.kind === 'file' && p.path ? [p.path] : [])), pathKey) : new Set<string>(),
)
const atomIcon = (row: TreeRow): AtomIcon => (row.directory ? folderIcon(row.name, openDirs.value.has(pathKey(row.path))) : fileIcon(row.name, row.path, dark.value))
const maskStyle = (src: string) => ({ maskImage: `url(${src})`, maskSize: 'contain', maskRepeat: 'no-repeat', maskPosition: 'center' })

const scroller = ref<HTMLElement | null>(null)
const scrollTop = ref(0)
const viewport = ref(0)
let lastIndex = 0

const rows = computed(() => explorer.rows)
const focusIndex = computed(() => resolveFocusIndex(rows.value, explorer.state.focused, lastIndex))
watch(focusIndex, (i) => (lastIndex = i))

const windowed = computed(() => {
  const first = Math.max(0, Math.floor(scrollTop.value / ROW) - OVERSCAN)
  const last = Math.min(rows.value.length, Math.ceil((scrollTop.value + viewport.value) / ROW) + OVERSCAN)
  return rows.value.slice(first, last).map((row, i) => ({ row, index: first + i, icon: atom.value && row.depth > 0 && !row.outOfRoot ? atomIcon(row) : null }))
})

const rootListed = computed(() => !!explorer.root && explorer.state.listings.has(explorer.root))
const failed = computed(() => explorer.openDirs.some((d) => explorer.state.errors.has(d)))
const loading = computed(() => explorer.state.rootExpanded && !rootListed.value && !failed.value)
const empty = computed(() => explorer.state.rootExpanded && rootListed.value && rows.value.length === 1)

const gitKind = (row: TreeRow) => (props.git && row.depth > 0 && !row.directory ? props.git.files.get(pathKey(row.path)) : undefined)
const gitDir = (row: TreeRow): boolean => !!props.git && row.depth > 0 && row.directory && props.git.dirs.has(pathKey(row.path))

const isActive = (row: TreeRow): boolean => !!props.activePath && !row.directory && samePath(row.path, props.activePath)

let resize: ResizeObserver | null = null
onMounted(() => {
  resize = new ResizeObserver(([e]) => (viewport.value = e?.contentRect.height ?? 0))
  if (scroller.value) resize.observe(scroller.value)
})
onBeforeUnmount(() => resize?.disconnect())

function onScroll(): void {
  scrollTop.value = scroller.value?.scrollTop ?? 0
}

/** Keeps row `index` inside the scroller (nearest edge). */
function scrollToIndex(index: number): void {
  const el = scroller.value
  if (!el) return
  const top = index * ROW
  if (top < el.scrollTop) el.scrollTop = top
  else if (top + ROW > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW - el.clientHeight
  scrollTop.value = el.scrollTop
}

async function focusRow(index: number): Promise<void> {
  const row = rows.value[index]
  if (!row) return
  explorer.setFocused(index === 0 ? null : row.path)
  scrollToIndex(index)
  await nextTick()
  scroller.value?.querySelector<HTMLElement>(`[data-row-index="${index}"]`)?.focus({ preventScroll: true })
}

function activate(row: TreeRow, index: number, keep = false): void {
  explorer.setFocused(index === 0 ? null : row.path)
  if (row.depth === 0) explorer.toggleRoot()
  else if (row.directory) {
    if (!row.outOfRoot) explorer.toggle(row.path)
  } else emit('open', row.path, keep)
}

const MENU_ICONS: Partial<Record<string, typeof File>> = {
  new: Plus,
  'copy-ref': ClipboardCopy,
  rename: Pencil,
  trash: Trash2,
  'open-split': SquareSplitHorizontal,
  'open-in': FolderOpen,
  terminal: SquareTerminal,
  run: Play,
  git: GitCompare,
  reload: RefreshCw,
  'compare-with': GitCompare,
  'compare-clipboard': ClipboardCopy,
  'apk-size': Package,
  strings: Languages,
  'lib-updates': PackageSearch,
}
const withIcons = (list: MenuEntry[]): MenuEntry[] => list.map((e) => (isSeparator(e) ? e : { ...e, icon: MENU_ICONS[e.id], children: e.children && withIcons(e.children) }))
const compareCtx = (row: TreeRow) => (hasPreview ? { selected: props.compareSel ?? null, self: !!props.compareSel && samePath(props.compareSel.path, row.path) } : undefined)
const menuFor = (row: TreeRow): MenuEntry[] =>
  withIcons(explorerMenu(row, { mac: isMac, repo: !!props.repo, changed: !!gitKind(row), run: hasRun, compare: compareCtx(row), apk: hasApkSize, strings: hasI18nScan, libs: hasLibsCheck }, (k, p) => t(k, p ?? {})))

const menu = ref<{ at: DOMRect; row: TreeRow; trigger: HTMLElement | null } | null>(null)

function openMenu(row: TreeRow, index: number, at: DOMRect, trigger: HTMLElement | null): void {
  explorer.setFocused(index === 0 ? null : row.path)
  menu.value = { at, row, trigger }
}

/** Windows fires a native `contextmenu` after the ContextMenu / Shift+F10 keydown that already opened the menu. */
const KEY_MENU_ECHO_MS = 300
let keyMenuAt = 0

function onContextMenu(e: MouseEvent, row: TreeRow, index: number): void {
  e.preventDefault()
  if (menu.value && performance.now() - keyMenuAt < KEY_MENU_ECHO_MS) return
  openMenu(row, index, new DOMRect(e.clientX, e.clientY, 0, 0), e.currentTarget as HTMLElement)
}

function onPick(id: string): void {
  const row = menu.value?.row
  if (row) emit('action', id as ExplorerAction, row)
}

function onKey(e: KeyboardEvent): void {
  // Keys on a button inside a row (root actions) belong to that button.
  const target = e.target as HTMLElement
  if (target !== scroller.value && target.getAttribute('role') !== 'treeitem') return
  const shortcut = explorerKey(e, isMac)
  if (shortcut) {
    const i = focusIndex.value
    const row = rows.value[i]
    if (!row) return
    e.preventDefault()
    if (shortcut === 'menu') {
      const el = scroller.value?.querySelector<HTMLElement>(`[data-row-index="${i}"]`) ?? null
      const r = el?.getBoundingClientRect()
      keyMenuAt = performance.now()
      openMenu(row, i, r ? new DOMRect(r.left + 24, r.bottom, 0, 0) : new DOMRect(0, 0, 0, 0), el)
    } else if (!findAction(menuFor(row), shortcut)?.disabled) emit('action', shortcut, row)
    return
  }
  if (isShowDiffKey(e)) {
    const row = rows.value[focusIndex.value]
    if (row && gitKind(row)) {
      e.preventDefault()
      emit('openDiff', row.path)
    }
    return
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return
  const i = focusIndex.value
  const row = rows.value[i]
  if (!row) return
  const expandable = row.directory && !row.outOfRoot
  switch (e.key) {
    case 'ArrowDown':
      void focusRow(Math.min(rows.value.length - 1, i + 1))
      break
    case 'ArrowUp':
      void focusRow(Math.max(0, i - 1))
      break
    case 'Home':
      void focusRow(0)
      break
    case 'End':
      void focusRow(rows.value.length - 1)
      break
    case 'ArrowRight':
      if (expandable && !row.expanded) activate(row, i)
      else if (expandable && rows.value[i + 1]?.depth === row.depth + 1) void focusRow(i + 1)
      break
    case 'ArrowLeft':
      if (expandable && row.expanded) activate(row, i)
      else if (row.depth > 0) {
        const parent = parentDirectory(row.path)
        const at = row.depth === 1 ? 0 : rows.value.findIndex((r) => r.path === parent)
        if (at >= 0) void focusRow(at)
      }
      break
    case 'Enter':
    case ' ':
      activate(row, i)
      break
    default:
      return
  }
  e.preventDefault()
}

// A created row: focus it once it renders.
watch(
  () => [explorer.pendingFocus, rows.value] as const,
  ([path]) => {
    if (!path) return
    const at = rows.value.findIndex((r) => r.path === path)
    if (at < 0) return
    explorer.pendingFocus = null
    void focusRow(at)
  },
)

// Reveal the active file: open its ancestors one listing at a time, then scroll it into view without taking focus.
const revealFor = ref<string | null>(null)
watch(
  () => [props.activePath, explorer.root] as const,
  ([path]) => (revealFor.value = path),
  { immediate: true },
)
watch(
  () => explorer.state.showHidden,
  (on) => {
    if (on) revealFor.value = props.activePath
  },
)
watchEffect(() => {
  const target = revealFor.value
  const root = explorer.root
  if (!target || !root) return
  const s = explorer.state
  const step = nextRevealStep({ target, root, listings: s.listings, expanded: s.expanded, rootExpanded: s.rootExpanded, showHidden: s.showHidden, errors: s.errors })
  if (step.kind === 'open-root') explorer.toggleRoot()
  else if (step.kind === 'expand') explorer.expand(step.directory)
  else if (step.kind === 'none') revealFor.value = null
  else if (step.kind === 'done') {
    revealFor.value = null
    const at = rows.value.findIndex((r) => !r.directory && samePath(r.path, target))
    if (at >= 0) void nextTick(() => scrollToIndex(at))
  }
})

const ACTION = 'inline-flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded-[4px] text-ink-faint hover:bg-fill-strong hover:text-ink aria-pressed:text-accent-ink'
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <p v-if="failed" class="mx-1 mb-1 flex items-center gap-1.5 rounded-inner bg-st-waiting-soft px-2 py-1 text-xs text-ink" role="alert">
      <span class="min-w-0 flex-1 truncate">{{ t('workspace.explorer.loadError') }}</span>
      <button type="button" class="shrink-0 cursor-pointer text-xs font-medium text-accent-ink hover:underline" @click="explorer.refresh()">{{ t('workspace.explorer.retry') }}</button>
    </p>
    <div
      ref="scroller"
      class="ccm-scroll relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto outline-none"
      role="tree"
      :aria-label="t('workspace.explorer.tree', { name: rows[0]?.name ?? '' })"
      data-explorer-tree
      @scroll.passive="onScroll"
      @keydown="onKey"
    >
      <div class="relative w-full" :style="{ height: `${rows.length * ROW}px` }">
        <div
          v-for="{ row, index, icon } in windowed"
          :key="row.path"
          role="treeitem"
          :aria-level="row.depth + 1"
          :aria-expanded="row.directory && !row.outOfRoot ? row.expanded : undefined"
          :aria-selected="isActive(row)"
          :tabindex="index === focusIndex ? 0 : -1"
          :data-row-index="index"
          :data-path="row.path"
          class="group/row absolute right-0 left-0 flex cursor-pointer items-center gap-1 rounded-inner pr-1 text-xs outline-none select-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset"
          :class="[
            isActive(row) ? 'bg-accent-soft text-accent-ink' : 'text-ink hover:bg-fill',
            row.depth === 0 ? 'font-semibold' : '',
            row.outOfRoot ? 'text-ink-faint' : '',
          ]"
          :style="{ top: `${index * ROW}px`, height: `${ROW}px`, paddingLeft: `${4 + Math.max(0, row.depth - 1) * INDENT}px` }"
          :title="row.depth === 0 ? (explorer.root ?? undefined) : row.outOfRoot ? t('workspace.explorer.outOfRoot') : row.directory ? row.name : t('workspace.explorer.openHint')"
          :draggable="row.depth > 0"
          @dragstart="setDragPath($event.dataTransfer, row.path)"
          @focus="explorer.setFocused(index === 0 ? null : row.path), warmOnIntent(row.directory ? null : row.path)"
          @pointerenter="warmOnIntent(row.directory ? null : row.path)"
          @pointerleave="warmOnIntent(null)"
          @click="activate(row, index)"
          @dblclick="!row.directory && emit('open', row.path, true)"
          @contextmenu="onContextMenu($event, row, index)"
        >
          <span class="inline-flex w-3.5 shrink-0 justify-center" aria-hidden="true">
            <ChevronRight
              v-if="row.directory && !row.outOfRoot"
              :size="12"
              class="text-ink-faint transition-transform duration-(--ccm-dur-fast)"
              :class="row.expanded ? 'rotate-90' : ''"
            />
          </span>
          <template v-if="row.depth > 0">
            <Link2 v-if="row.outOfRoot" :size="13" class="shrink-0" aria-hidden="true" />
            <template v-else-if="icon">
              <span v-if="icon.themed" class="size-4 shrink-0 bg-current" :style="maskStyle(icon.src)" :data-file-icon="icon.src" aria-hidden="true" />
              <img v-else :src="icon.src" width="16" height="16" class="size-4 shrink-0" alt="" draggable="false" decoding="async" :data-file-icon="icon.src" />
            </template>
            <component :is="row.expanded ? FolderOpen : Folder" v-else-if="row.directory" :size="14" class="shrink-0 text-ink-faint" aria-hidden="true" />
            <component :is="GLYPH[fileGlyph(row.name)]" v-else :size="13" class="shrink-0" :class="isActive(row) ? 'text-accent-ink' : 'text-agent-file'" aria-hidden="true" />
          </template>
          <span
            class="min-w-0 flex-1 truncate"
            :class="[row.depth === 0 ? 'text-2xs tracking-wide uppercase' : '', !isActive(row) && gitKind(row) ? KIND_CLASS[gitKind(row)!] : '', !isActive(row) && gitDir(row) ? 'text-diff-mod' : '', problemOf(row) ? PROBLEM_CLASS[problemOf(row)!] : '']"
            :data-problem="problemOf(row)"
            :data-git="gitKind(row) ?? (gitDir(row) ? 'dir' : undefined)"
            data-row-name
            >{{ row.name }}</span
          >
          <GitCompare v-if="compareSel && samePath(compareSel.path, row.path)" :size="12" class="shrink-0 text-accent-ink" :title="t('workspace.explorer.menu.compareSelected')" aria-hidden="true" data-compare-selected />
          <span v-if="compareSel && samePath(compareSel.path, row.path)" class="sr-only">, {{ t('workspace.explorer.menu.compareSelected') }}</span>
          <RunProjectMark v-if="runMark(row)" :project="runMark(row)!.project" :module="runMark(row)!.module" />
          <span v-if="gitKind(row)" class="w-3 shrink-0 text-center font-mono text-2xs font-semibold" :class="isActive(row) ? 'text-accent-ink' : KIND_CLASS[gitKind(row)!]" aria-hidden="true">{{
            KIND_LETTER[gitKind(row)!]
          }}</span>
          <span v-if="problemOf(row)" class="sr-only">, {{ t(`workspace.problems.has.${problemOf(row)}`) }}</span>
          <span v-if="gitKind(row)" class="sr-only">, {{ t(`workspace.changes.kind.${gitKind(row)}`) }}</span>
          <span v-else-if="gitDir(row)" class="mr-1 size-1.5 shrink-0 rounded-full bg-diff-mod" :title="t('workspace.gitStatus.contains')" aria-hidden="true" />
          <span v-if="gitDir(row)" class="sr-only">, {{ t('workspace.gitStatus.contains') }}</span>
          <span v-if="row.depth === 0" class="flex shrink-0 items-center gap-0.5" data-root-action @click.stop @dblclick.stop>
            <button type="button" :class="ACTION" :title="t('workspace.explorer.newFile')" :aria-label="t('workspace.explorer.newFile')" data-explorer-new-file @click="emit('create', 'file')">
              <FilePlus :size="13" aria-hidden="true" />
            </button>
            <button type="button" :class="ACTION" :title="t('workspace.explorer.newFolder')" :aria-label="t('workspace.explorer.newFolder')" data-explorer-new-folder @click="emit('create', 'directory')">
              <FolderPlus :size="13" aria-hidden="true" />
            </button>
            <button
              type="button"
              :class="ACTION"
              :title="t('workspace.explorer.showHidden')"
              :aria-label="t('workspace.explorer.showHidden')"
              :aria-pressed="explorer.state.showHidden"
              @click="explorer.setShowHidden(!explorer.state.showHidden)"
            >
              <Eye :size="13" aria-hidden="true" />
            </button>
            <button type="button" :class="ACTION" :title="t('workspace.explorer.refresh')" :aria-label="t('workspace.explorer.refresh')" @click="explorer.refresh()">
              <RotateCw :size="12" aria-hidden="true" />
            </button>
            <button type="button" :class="ACTION" :title="t('workspace.explorer.collapseAll')" :aria-label="t('workspace.explorer.collapseAll')" @click="explorer.collapseAll()">
              <ChevronsDownUp :size="13" aria-hidden="true" />
            </button>
          </span>
        </div>
      </div>
      <p v-if="loading" class="px-3 py-2 text-xs text-ink-muted" role="status">{{ t('workspace.explorer.loading') }}</p>
      <p v-else-if="empty" class="px-3 py-2 text-xs text-ink-faint">{{ t('workspace.explorer.empty') }}</p>
    </div>
    <ContextMenu
      v-if="menu"
      :at="menu.at"
      :entries="menuFor(menu.row)"
      :label="t('workspace.explorer.menu.label', { name: menu.row.name })"
      :trigger="menu.trigger"
      @pick="onPick"
      @close="menu = null"
    />
  </div>
</template>
