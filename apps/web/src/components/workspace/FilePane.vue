<script lang="ts">
let filePanes = 0
</script>

<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronDown, ChevronUp, CircleAlert, Code, Columns2, Copy, Eye, FileText, FileWarning, FolderOpen, GitCommitHorizontal, GitCompare, Info, LayoutTemplate, LoaderCircle, Pencil, Save, Search, Smartphone, SquarePen, TextWrap, X, ListTree, Network } from 'lucide-vue-next'
import { diskChangeAction, editBlock, inEditor, isEditKey, isSaveKey, isSelectAllKey, type EditBlock } from '../../lib/fileEditor'
import { isTyping } from '../../lib/shortcuts'
import { firesOn, type AutoSaveTrigger } from '../../lib/autoSave'
import { useWorkspaceStore, type SaveOutcome } from '../../stores/workspace'
import { changedLines, escapeHtml, findMatches, grammarFor, isHtml, isMarkdown, renderLine, splitLines, type CodeToken, type Match } from '../../lib/codeView'
import { blockPatch } from '../../lib/diffBlocks'
import { joinPath } from '../../lib/fileLinks'
import { tokenize } from '../../lib/highlight'
import { maxColumns, sameRange, spacer, uniformRange, WINDOW_MIN_ROWS, type RowRange } from '../../lib/rowWindow'
import { renderMarkdown } from '../../lib/markdown'
import { isMac } from '../../lib/platform'
import { useFileChanges } from '../../composables/useFileChanges'
import { useWindowCopy } from '../../composables/useWindowCopy'
import { useSettingsStore } from '../../stores/settings'
import { useChecksStore } from '../../stores/checks'
import { useNavigationStore } from '../../stores/navigation'
import { problemsFor, stepProblem } from '../../lib/problems'
import AccessPrompt from './AccessPrompt.vue'
import ChangeRuler from './ChangeRuler.vue'
import CodeMinimap from './CodeMinimap.vue'
import DiscardConfirm from './DiscardConfirm.vue'
import HunkPopup from './HunkPopup.vue'
import LayoutPreview from './LayoutPreview.vue'
import DrawablePreview from './DrawablePreview.vue'
import FlutterPreviewPanel from './FlutterPreviewPanel.vue'
import { hasFlutterPreview, inFlutterProject, isDartFile } from '../../lib/flutterPreview'
import { nextStacked } from '../../lib/sideWidth'
import { desktop } from '../../lib/desktop'
import type { MenuEntry } from '../../lib/menu'
import PaneMore from './PaneMore.vue'
import ProblemBar from './ProblemBar.vue'
import { declarationQuery, outline, type OutlineItem } from '../../lib/editor/outline'
import type { SearchQuery } from '../../lib/preview'
import SegmentedControl, { type Segment } from '../ui/SegmentedControl.vue'
import { treeFormat } from '../../lib/jsonTree'
import { hasLayoutPreview, isLayoutXml, layoutWarmup, type LayoutMode } from '../../lib/layoutPreview'
import { hasDrawablePreview, isDrawableXml } from '../../lib/drawablePreview'
import { blameRows, type BlameRow } from '../../lib/blame'
import { baseName, changesDiscard, gitBlame, hasBlame, type BlameResult, dirOf, fileWrite, hasFileWrite, hasPreview, onPreviewChanged, openExternal, openPath, previewUrl, readFile, revealPath, unwatchRoot, watchRoot, type FileView } from '../../lib/preview'

// CodeMirror stays out of the main chunk until a file is edited.
const CodeEditor = defineAsyncComponent(() => import('./CodeEditor.vue'))
const OutlinePicker = defineAsyncComponent(() => import('./OutlinePicker.vue'))
const JsonTree = defineAsyncComponent(() => import('./JsonTree.vue'))
interface EditorApi {
  text: () => string
  markSaved: (saved?: string) => void
  setText: (text: string) => void
  revealLine: (line: number, select?: boolean) => void
  focus: () => void
  openFind: () => void
  word: () => string
  lineText: (line: number) => string
}

const props = withDefaults(defineProps<{ path: string; line?: number; active?: boolean; paneKey?: string }>(), { active: true, paneKey: undefined })
const emit = defineEmits<{
  open: [path: string]
  /** Repo root + absolute file path: open the Changes pane on this file. */
  showDiff: [root: string, path: string]
  /** Blame annotation clicked: open the Git Log on that commit. */
  showCommit: [root: string, hash: string]
  /** Find usages / declaration: Find in Files with this query. */
  search: [query: SearchQuery]
}>()

const { t, locale } = useI18n()
const settings = useSettingsStore()
const FLASH_MS = 1200
// Only debounce between a keystroke and a live XML render (the preview renders at once on a new revision).
const LIVE_PREVIEW_MS = 120
const tokenKey = `file${++filePanes}`
const MINIMAP_MIN_WIDTH = 420

const view = shallowRef<FileView | null>(null)
const loading = ref(true)
const lines = shallowRef<string[]>([])
const tokens = shallowRef<CodeToken[][] | null>(null)
const plainBecauseLarge = ref(false)
const imageUrl = ref<string | null>(null)
// undefined while the preview URL is resolving; null when the path can't be served (source view then).
const htmlUrl = ref<string | null | undefined>(undefined)
const htmlRev = ref(0)
const wrap = ref(false)
const mdPreview = ref(true)
const targetLine = ref<number | null>(null)
const flash = shallowRef<Set<number>>(new Set())
const copied = ref(false)
const notice = ref<string | null>(null)

const findOpen = ref(false)
const query = ref('')
const matchIndex = ref(0)
const findInput = ref<HTMLInputElement | null>(null)
const scroller = ref<HTMLElement | null>(null)
const root = ref<HTMLElement | null>(null)
const codeEl = ref<HTMLElement | null>(null)
const mdEl = ref<HTMLElement | null>(null)
const paneWidth = ref(0)

// v42 editor. `pending` = unsaved text kept after Done (the view shows it, ● stays); `baseText` = disk text it started from.
const workspace = useWorkspaceStore()
const editing = ref(false)
const editor = ref<EditorApi | null>(null)
const dirty = ref(false)
const pending = shallowRef<string | null>(null)
const baseText = shallowRef('')
const editorDoc = shallowRef('')
let knownMtime: number | null = null
let focusEditor = false
const saving = ref(false)
/** v62: auto saves skip the Saving… / Saved flashes; the ● going away says it. */
const quietSave = ref(false)
const savedFlash = ref(false)
const editNotice = ref<{ kind: 'error' | 'info'; text: string } | null>(null)
const conflict = shallowRef<{ text: string | null; mtimeMs: number } | null>(null)
const compareText = shallowRef<string | null>(null)
/** Unsaved text the layout / drawable preview renders instead of the file (null = the file). */
const liveText = shallowRef<string | null>(null)
let liveTimer: ReturnType<typeof setTimeout> | null = null
let savedTimer: ReturnType<typeof setTimeout> | null = null
let autoSaveTimer: ReturnType<typeof setTimeout> | null = null
let autoSaveAgain = false
const saveKey = isMac ? '⌘S' : 'Ctrl+S'
const saveTitle = computed(() => {
  const hint = t('editor.saveHint', { key: saveKey })
  const mode = settings.autoSave
  if (mode === 'off') return hint
  return `${hint} · ${t(`editor.autoSave.${mode}`, { s: settings.autoSaveDelay / 1000 })}`
})

// Change markers vs HEAD (IntelliJ gutter): bars beside the line numbers, popup with the old text.
const changes = useFileChanges(
  () => props.path,
  () => props.active,
)
const popupIndex = ref<number | null>(null)
const popupRows = shallowRef<{ top: HTMLElement | null; bottom: HTMLElement } | null>(null)
const pendingRollback = ref<number | null>(null)
const changeTotals = computed(() => changes.blocks.value.reduce((a, b) => ({ added: a.added + b.adds.length, removed: a.removed + b.dels.length }), { added: 0, removed: 0 }))
const rollbackBlocked = computed(() => (changes.ok.value?.kind === 'modified' ? null : t('workspace.gutter.rollbackOnly')))
type GutterKind = 'add' | 'mod' | 'del' | 'del-end'
const GUTTER_OF = { added: 'add', modified: 'mod', deleted: 'del' } as const
/** 0-based line → marker; a deletion marks the line now below it (or the last line at the end of the file). */
const gutter = computed(() => {
  const map = new Map<number, { kind: GutterKind; block: number }>()
  // Markers compare the disk text with HEAD; on unsaved text they would point at the wrong lines.
  if (pending.value !== null) return map
  const n = lines.value.length
  changes.blocks.value.forEach((b, i) => {
    if (b.type === 'deleted') {
      const end = b.line1 >= n
      const at = end ? n - 1 : b.line1
      if (at >= 0 && !map.has(at)) map.set(at, { kind: end ? 'del-end' : 'del', block: i })
      return
    }
    for (let l = b.line1; l < Math.min(b.line2, n); l++) map.set(l, { kind: GUTTER_OF[b.type], block: i })
  })
  return map
})

const name = computed(() => baseName(props.path))
const markdown = computed(() => view.value?.kind === 'text' && isMarkdown(props.path))
const htmlPage = computed(() => view.value?.kind === 'text' && isHtml(props.path))
const rendered = computed(() => markdown.value || htmlPage.value)
const treeFmt = computed(() => (view.value?.kind === 'text' ? treeFormat(props.path) : null))
const treeOn = ref(false)
const treeShown = computed(() => treeOn.value && !!treeFmt.value && !editing.value)
const treeText = computed(() => pending.value ?? (view.value?.kind === 'text' ? (view.value.text ?? '') : ''))
function onTreeFailed(message: string): void {
  treeOn.value = false
  editNotice.value = { kind: 'error', text: t('workspace.tree.failed', { detail: message }) }
}
const showSource = computed(() => view.value?.kind === 'text' && !treeShown.value && !(mdPreview.value && (markdown.value || (htmlPage.value && htmlUrl.value !== null))))
const matches = computed<Match[]>(() => (findOpen.value && showSource.value ? findMatches(lines.value, query.value) : []))
// XML layout preview (v32): Code | Split | Design for res/layout*/ files, per-user mode.
const LAYOUT_MODE_KEY = 'ccm.layout.mode'
const STACK_SETTLE_MS = 180
function readLayoutMode(): LayoutMode {
  try {
    const v = localStorage.getItem(LAYOUT_MODE_KEY)
    return v === 'code' || v === 'design' || v === 'split' ? v : 'split'
  } catch {
    return 'split'
  }
}
const layoutMode = ref<LayoutMode>(readLayoutMode())
watch(layoutMode, (m) => {
  try {
    localStorage.setItem(LAYOUT_MODE_KEY, m)
  } catch {
    // storage off
  }
})
// v42: a loose layout XML anywhere (root element sniffed) previews too.
const isLayout = computed(() => hasLayoutPreview && view.value?.kind === 'text' && isLayoutXml(view.value.path || props.path, view.value.text ?? null))
// v41: res/drawable* / mipmap* / color*, or a loose XML whose root element is a drawable.
const isDrawable = computed(() => hasDrawablePreview && view.value?.kind === 'text' && !isLayout.value && !!isDrawableXml(view.value.path || props.path, view.value.text ?? null))
const isXmlPreview = computed(() => isLayout.value || isDrawable.value)
const showDesign = computed(() => isXmlPreview.value && layoutMode.value !== 'code')
// Code mode too: start the render daemon so switching to Design is fast (no Gradle).
watch(isXmlPreview, (on) => on && void layoutWarmup(view.value?.path || props.path), { immediate: true })
const showCode = computed(() => !isXmlPreview.value || layoutMode.value !== 'design')
// Hysteresis + settle delay: dragging the sidebar across one threshold flipped the split every frame.
const layoutStacked = ref(false)
let stackTimer: ReturnType<typeof setTimeout> | null = null
watch(paneWidth, (width, old) => {
  if (stackTimer) clearTimeout(stackTimer)
  stackTimer = null
  const next = nextStacked(layoutStacked.value, width)
  if (next === layoutStacked.value) return
  if (!old) layoutStacked.value = next
  else stackTimer = setTimeout(() => (layoutStacked.value = nextStacked(layoutStacked.value, paneWidth.value)), STACK_SETTLE_MS)
})
const layoutRevision = ref(0)
const layoutLine = ref<number | null>(null)
const layoutModes = computed<Segment<LayoutMode>[]>(() => [
  { value: 'code', label: t('layout.mode.code'), icon: Code },
  { value: 'split', label: t('layout.mode.split'), icon: Columns2 },
  { value: 'design', label: t('layout.mode.design'), icon: LayoutTemplate },
])

// Flutter widget preview (v40): list + controls beside a .dart file of a pubspec project; open state per user.
const FWP_OPEN_KEY = 'ccm.fwp.open'
function readFwpOpen(): boolean {
  try {
    return localStorage.getItem(FWP_OPEN_KEY) === '1'
  } catch {
    return false
  }
}
const fwpOpen = ref(readFwpOpen())
watch(fwpOpen, (on) => {
  try {
    localStorage.setItem(FWP_OPEN_KEY, on ? '1' : '0')
  } catch {
    // storage off
  }
})
const fwpProject = ref(false)
const isDart = computed(() => hasFlutterPreview && view.value?.kind === 'text' && isDartFile(view.value.path || props.path))
const showFwp = computed(() => isDart.value && fwpProject.value && fwpOpen.value)
watch(
  () => (isDart.value ? (view.value?.path ?? props.path) : null),
  async (file) => {
    fwpProject.value = false
    if (!file) return
    const flutter = await inFlutterProject(file, async (f) => desktop?.fwpScan?.(f, false))
    fwpProject.value = flutter && (view.value?.path ?? props.path) === file
  },
  { immediate: true },
)
const sidePanel = computed(() => showDesign.value || showFwp.value)

const codeWidth = computed(() => (sidePanel.value && !layoutStacked.value ? paneWidth.value / 2 : paneWidth.value))
const minimap = computed(() => settings.minimap && !editing.value && showSource.value && showCode.value && !loading.value && codeWidth.value >= MINIMAP_MIN_WIDTH)

// v45: above WINDOW_MIN_ROWS (no wrap) only rows around the viewport are in the DOM; rows are one measured height.
const windowed = computed(() => !wrap.value && !editing.value && showSource.value && lines.value.length > WINDOW_MIN_ROWS)
const rowH = ref(19.5)
const range = shallowRef<RowRange>({ start: 0, end: 0 })
const codeMinWidth = computed(() => (windowed.value ? `calc(${maxColumns(lines.value)}ch + 6em)` : undefined))
let rangeFrame = 0

/** Scroller offset of row 0 (the top spacer). */
const rowOrigin = (): number => (codeEl.value?.firstElementChild as HTMLElement | null)?.offsetTop ?? 8

function updateRange(): void {
  if (rangeFrame) cancelAnimationFrame(rangeFrame)
  rangeFrame = 0
  if (!windowed.value) return
  const sc = scroller.value
  const row = codeEl.value?.querySelector<HTMLElement>('.r')
  const h = row?.getBoundingClientRect().height
  if (h && Math.abs(h - rowH.value) > 0.01) rowH.value = h
  const top = sc ? sc.scrollTop - rowOrigin() : 0
  const next = uniformRange(lines.value.length, rowH.value, top, sc?.clientHeight || 1000)
  if (!sameRange(next, range.value)) range.value = next
}

function onCodeScroll(): void {
  if (windowed.value && !rangeFrame) rangeFrame = requestAnimationFrame(updateRange)
}

watch([windowed, lines, rowH], () => updateRange())

/** Puts row `i` (0-based) in the middle of the view and renders it. */
async function revealRow(i: number): Promise<void> {
  const sc = scroller.value
  if (!windowed.value || !sc) return
  sc.scrollTop = rowOrigin() + i * rowH.value - sc.clientHeight / 2 + rowH.value / 2
  updateRange()
  await nextTick()
}

const html = computed(() => {
  if (!showSource.value || editing.value) return ''
  const byLine = new Map<number, Array<{ start: number; end: number; current?: boolean }>>()
  matches.value.forEach((m, i) => {
    const list = byLine.get(m.line) ?? []
    list.push({ start: m.start, end: m.end, current: i === matchIndex.value })
    byLine.set(m.line, list)
  })
  const tok = tokens.value
  const marks = gutter.value
  const n = lines.value.length
  const { start, end } = windowed.value ? range.value : { start: 0, end: n }
  let out = windowed.value ? spacer(start * rowH.value) : ''
  for (let i = start; i < end; i++) {
    const lineTokens = tok?.[i] ?? [{ content: lines.value[i]! }]
    const g = marks.get(i)
    const pk = problemLines.value.get(i + 1)
    const bl = blameLabels.value[i]
    const bAttr = bl ? `<span class="b${bl.text ? '' : ' is-cont'}" aria-hidden="true"${bl.hash ? ` data-blame="${bl.hash}" title="${escapeHtml(bl.title)}"` : ''}>${escapeHtml(bl.text)}</span>` : ''
    const cls = `r${i + 1 === targetLine.value ? ' is-target' : ''}${pk ? ` p-${pk}` : ''}${flash.value.has(i) ? ' is-flash' : ''}${bookmarkSet.value.has(i + 1) ? ' bm' : ''}${g ? ` g-${g.kind}` : ''}`
    const gAttr = g ? ` data-block="${g.block}"` : ''
    const nAttr = g ? ` data-gutter title="${gutterTitle(g.block)}"` : ''
    out += `<div class="${cls}" data-line="${i + 1}" data-i="${i}"${gAttr}>${bAttr}<span class="n" aria-hidden="true"${nAttr}>${i + 1}</span><span class="c">${renderLine(lineTokens, byLine.get(i))}\n</span></div>`
  }
  if (windowed.value) out += spacer((n - end) * rowH.value)
  return out
})

let paintedText = ''
const windowCopy = useWindowCopy({
  container: () => codeEl.value,
  scope: () => root.value,
  enabled: () => windowed.value && props.active,
  rowText: (i) => lines.value[i] ?? null,
  allText: () => paintedText,
})
const allSelected = windowCopy.allSelected
// Saved or changed on disk: remount the rendered page (the preview server sends no-store).
watch(() => (htmlPage.value ? view.value?.kind === 'text' && view.value.text : null), () => htmlRev.value++)
watch(html, () => windowCopy.capture(), { flush: 'pre' })
watch(html, () => windowCopy.restore(), { flush: 'post' })

/** Minimap row geometry while windowed (its own lookup walks the rendered rows). */
const minimapGeometry = computed(() => {
  if (!windowed.value) return null
  const h = rowH.value
  const n = lines.value.length
  return { top: (line: number) => rowOrigin() + line * h, at: (y: number) => Math.min(n, Math.max(0, (y - rowOrigin()) / h)) }
})

function gutterTitle(i: number): string {
  const b = changes.blocks.value[i]
  return b ? escapeHtml(t('workspace.gutter.marker', { kind: t(`workspace.gutter.kind.${b.type}`), n: i + 1, total: changes.blocks.value.length })) : ''
}

const markdownHtml = computed(() => (markdown.value && mdPreview.value ? renderMarkdown(view.value?.text ?? '') : ''))

let watchedRoot: string | null = null
let flashTimer: ReturnType<typeof setTimeout> | null = null
let loadSeq = 0

async function load(opts: { keepScroll?: boolean } = {}): Promise<void> {
  const seq = ++loadSeq
  const prevView = view.value
  if (!opts.keepScroll) loading.value = true
  const next = hasPreview ? await readFile(props.path) : null
  if (seq !== loadSeq) return
  loading.value = false
  view.value = next
  if (next?.kind === 'image') imageUrl.value = (await previewUrl(next.path))?.url ?? null
  if (next?.kind === 'text' && isHtml(next.path)) {
    void previewUrl(next.path).then((res) => {
      if (seq === loadSeq) htmlUrl.value = res?.url ?? null
    })
  }
  if (next?.kind !== 'text') {
    lines.value = []
    tokens.value = null
    return
  }
  // Unsaved edits keep the mtime they were based on, so a later save still detects the newer disk file.
  if (!dirty.value) {
    knownMtime = next.mtimeMs
    baseText.value = next.text ?? ''
  }
  if (opts.keepScroll) {
    changes.reload()
    layoutRevision.value++
  }
  await paintText(pending.value ?? next.text ?? '', seq, !!opts.keepScroll && prevView?.kind === 'text')
}

/** Lines + shiki tokens of the view mode; `keepScroll` flashes changed lines and keeps the scroll position. */
async function paintText(text: string, seq: number, keepScroll: boolean): Promise<void> {
  const prevLines = lines.value
  const scrollTop = scroller.value?.scrollTop ?? 0
  const nextLines = splitLines(text)
  paintedText = text
  lines.value = nextLines
  if (keepScroll) {
    flashLines(changedLines(prevLines, nextLines))
    await nextTick()
    if (scroller.value) scroller.value.scrollTop = scrollTop
  }
  const lang = grammarFor(view.value?.lang, view.value?.path ?? props.path)
  if (!keepScroll) tokens.value = null
  const tok = await tokenize(text, lang, tokenKey)
  if (seq !== loadSeq) return
  tokens.value = tok
  plainBecauseLarge.value = !!lang && !tok && text.length > 400_000
  if (keepScroll) {
    await nextTick()
    if (scroller.value) scroller.value.scrollTop = scrollTop
  }
}

const grammar = computed(() => grammarFor(view.value?.lang, view.value?.path ?? props.path))
const block = computed<EditBlock | null>(() => editBlock(view.value, lines.value.length, hasFileWrite))
const canEdit = computed(() => hasFileWrite && view.value?.kind === 'text')

async function startEdit(): Promise<void> {
  if (editing.value) return editor.value?.focus()
  if (block.value) {
    editNotice.value = { kind: 'info', text: t(`editor.readOnly.${block.value}`) }
    return
  }
  findOpen.value = false
  closePopup()
  if (rendered.value) mdPreview.value = false
  editorDoc.value = pending.value ?? baseText.value
  focusEditor = true
  editing.value = true
}

/** Done: back to the view; unsaved text stays as `pending` (shown in the view, ● kept). */
function finishEdit(): void {
  const text = editor.value?.text() ?? pending.value
  pending.value = dirty.value ? (text ?? null) : null
  editing.value = false
  compareText.value = null
  void paintText(pending.value ?? baseText.value, loadSeq, true).then(() => jumpTo(editorLine ?? undefined))
  void nextTick(() => root.value?.focus({ preventScroll: true }))
  autoSaveOn('focusOut')
}

let editorLine: number | null = null
const blameOn = ref(false)
const blame = shallowRef<BlameResult | null>(null)
let blameTicket = 0
const blameShown = computed(() => blameOn.value && !editing.value && showSource.value && !!blame.value?.ok)
const blameLabels = computed<BlameRow[]>(() => (blameShown.value && blame.value?.ok ? blameRows(blame.value, locale.value, t('workspace.blame.uncommitted')) : []))

async function loadBlame(): Promise<void> {
  const file = view.value?.path ?? props.path
  const ticket = ++blameTicket
  const res = await gitBlame(file)
  if (ticket === blameTicket && blameOn.value) blame.value = res
}
function toggleBlame(): void {
  blameOn.value = !blameOn.value
  if (blameOn.value) void loadBlame()
  else {
    blameTicket++
    blame.value = null
  }
}
watch(
  () => [view.value?.path, view.value?.mtimeMs],
  () => blameOn.value && !editing.value && void loadBlame(),
)

const checks = useChecksStore()
const problems = computed(() => (view.value?.kind === 'text' ? problemsFor(checks.problemRuns, view.value.path ?? props.path) : null))
const problemLines = computed(() => {
  const m = new Map<number, 'error' | 'warning'>()
  for (const e of problems.value?.items ?? []) if (m.get(e.line) !== 'error') m.set(e.line, e.severity)
  return m
})
/** Edited or saved after the check started: line numbers may have moved. */
const problemsStale = computed(() => !!problems.value && (dirty.value || (view.value?.mtimeMs ?? 0) > problems.value.at))
const problemIndex = ref(-1)
watch(problems, () => (problemIndex.value = -1))

const outlineItems = shallowRef<OutlineItem[] | null>(null)
const outlineOpen = ref(false)
function openOutline(): void {
  const text = editing.value ? (editor.value?.text() ?? '') : (pending.value ?? view.value?.text ?? '')
  outlineItems.value = outline(text, grammar.value)
  outlineOpen.value = true
}
function pickOutline(line: number): void {
  outlineOpen.value = false
  if (editing.value) {
    editor.value?.revealLine(line, true)
    editor.value?.focus()
  } else void jumpTo(line)
}
function closeOutline(): void {
  outlineOpen.value = false
  if (editing.value) editor.value?.focus()
}

/** Word at the editor cursor, else the selected text in the viewer (one line). */
function currentWord(): string {
  const raw = editing.value ? (editor.value?.word() ?? '') : (window.getSelection()?.toString() ?? '')
  const w = raw.trim()
  return w.includes('\n') || w.length > 200 ? '' : w
}
function findUsages(word = currentWord()): void {
  if (word) emit('search', { q: word, regex: false, caseSensitive: true, word: /^\w+$/.test(word) })
}
function findDeclaration(word = currentWord()): void {
  if (word) emit('search', { q: declarationQuery(word), regex: true, caseSensitive: true, word: false })
}

function stepProblems(dir: 1 | -1): void {
  const p = problems.value
  if (!p) return
  const from = problemIndex.value >= 0 ? (p.items[problemIndex.value]?.line ?? 0) : editing.value ? (editorLine ?? 0) : (targetLine.value ?? 0)
  const i = stepProblem(p.items, from, dir)
  if (i < 0) return
  problemIndex.value = i
  void jumpTo(p.items[i]!.line)
}

function onCursorLine(line: number): void {
  editorLine = line
  if (showDesign.value) layoutLine.value = line
}

const nav = useNavigationStore()
const paneCwd = computed(() => workspace.panes.find((p) => p.key === props.paneKey)?.cwd)
const filePath = (): string => view.value?.path ?? props.path
const bookmarkLines = computed(() => (view.value?.kind === 'text' ? nav.linesOf(filePath()) : []))
const bookmarkSet = computed(() => new Set(bookmarkLines.value))
let editSpotTimer: ReturnType<typeof setTimeout> | null = null
const spotAt = (line: number) => ({ path: filePath(), line, ...(paneCwd.value ? { cwd: paneCwd.value } : {}) })

/** Editor cursor; in the viewer the selected row, else the jump target, else the top visible row. */
function currentLine(): number {
  if (editing.value) return editorLine ?? 1
  const node = window.getSelection()?.anchorNode
  const el = node && codeEl.value?.contains(node) ? (node instanceof Element ? node : node.parentElement) : null
  const row = el?.closest<HTMLElement>('[data-line]')
  if (row) return Number(row.dataset.line)
  if (targetLine.value) return targetLine.value
  const sc = scroller.value
  if (!sc) return 1
  return Math.max(1, Math.min(lines.value.length, Math.floor((sc.scrollTop - rowOrigin()) / rowH.value) + 1))
}

const lineAt = (line: number): string => (editing.value ? (editor.value?.lineText(line) ?? '') : (lines.value[line - 1] ?? ''))

function toggleBookmark(): void {
  const line = currentLine()
  nav.toggleBookmark(spotAt(line), lineAt(line))
}

function noteEdit(): void {
  if (editSpotTimer) clearTimeout(editSpotTimer)
  editSpotTimer = setTimeout(() => {
    editSpotTimer = null
    const line = editorLine ?? 1
    nav.edited(spotAt(line), lineAt(line))
  }, 800)
}

watch(
  () => props.active,
  (active) => {
    if (view.value?.kind !== 'text') return
    if (active) nav.visit(spotAt(currentLine()))
    else nav.leave(spotAt(currentLine()))
  },
)
watch(
  () => view.value?.kind,
  (kind) => {
    if (kind === 'text' || kind === 'image') nav.opened(filePath(), paneCwd.value)
    if (kind === 'text' && props.active && !props.line) nav.visit(spotAt(1))
  },
)

watch(editor, (api) => {
  if (api && focusEditor) {
    focusEditor = false
    api.focus()
  }
})

function onEditorChange(): void {
  noteEdit()
  if (firesOn(settings.autoSave, 'edit')) {
    cancelAutoSave()
    autoSaveTimer = setTimeout(() => {
      autoSaveTimer = null
      void autoSave()
    }, settings.autoSaveDelay)
  }
  if (!isXmlPreview.value) return
  if (liveTimer) clearTimeout(liveTimer)
  liveTimer = setTimeout(() => {
    liveTimer = null
    liveText.value = dirty.value ? (editor.value?.text() ?? null) : null
    layoutRevision.value++
  }, LIVE_PREVIEW_MS)
}

watch(dirty, (d) => {
  if (props.paneKey) workspace.setDirty(props.paneKey, d)
  if (!d && liveText.value !== null) {
    liveText.value = null
    layoutRevision.value++
  }
})

function cancelAutoSave(): void {
  if (autoSaveTimer) clearTimeout(autoSaveTimer)
  autoSaveTimer = null
}

/** v62 auto save: never over a conflict (the bar waits for Reload / Keep mine), retried once a running save ends. */
async function autoSave(): Promise<void> {
  if (!dirty.value || conflict.value || block.value) return
  if (saving.value) {
    autoSaveAgain = true
    return
  }
  await save({ quiet: true })
}

function autoSaveOn(trigger: AutoSaveTrigger): void {
  if (!firesOn(settings.autoSave, trigger)) return
  cancelAutoSave()
  void autoSave()
}

function onFocusOut(e: FocusEvent): void {
  const next = e.relatedTarget as Node | null
  if (next && root.value?.contains(next)) return
  // Focus leaving the whole window is a window change, handled by onWindowBlur.
  if (next || document.hasFocus()) autoSaveOn('focusOut')
}

function onWindowBlur(): void {
  autoSaveOn('windowBlur')
}

function onVisibility(): void {
  if (document.visibilityState === 'hidden') autoSaveOn('windowBlur')
}

watch(
  () => props.active,
  (active) => {
    if (!active) autoSaveOn('focusOut')
  },
)

async function save(opts: { quiet?: boolean } = {}): Promise<SaveOutcome> {
  const text = editing.value && editor.value ? editor.value.text() : pending.value
  if (text === null || !dirty.value) return { ok: true }
  if (saving.value) return { ok: false, error: t('editor.saving') }
  if (!opts.quiet) cancelAutoSave()
  saving.value = true
  quietSave.value = !!opts.quiet
  const res = await fileWrite(view.value?.path ?? props.path, text, knownMtime ?? undefined)
  saving.value = false
  quietSave.value = false
  if (autoSaveAgain) {
    autoSaveAgain = false
    if (res.ok) void nextTick(() => autoSave())
  }
  if (!res.ok) {
    const message = t(`editor.error.${res.error}`)
    editNotice.value = { kind: 'error', text: message }
    if (res.error === 'conflict' && !conflict.value) void checkDisk()
    return { ok: false, error: message }
  }
  knownMtime = res.mtimeMs
  baseText.value = text
  if (view.value?.kind === 'text') view.value = { ...view.value, text, mtimeMs: res.mtimeMs, size: res.size }
  if (editing.value) editor.value?.markSaved(text)
  else {
    pending.value = null
    dirty.value = false
  }
  conflict.value = null
  compareText.value = null
  editNotice.value = null
  if (!opts.quiet) {
    savedFlash.value = true
    if (savedTimer) clearTimeout(savedTimer)
    savedTimer = setTimeout(() => (savedFlash.value = false), 1500)
  }
  changes.reload()
  return { ok: true }
}

/** Watcher event for this file: follow the disk when clean, else raise the conflict bar (never overwrite edits). */
async function checkDisk(): Promise<void> {
  if (!editing.value && !dirty.value) return load({ keepScroll: true })
  const next = await readFile(view.value?.path ?? props.path)
  const action = diskChangeAction(next, knownMtime, dirty.value)
  if (action === 'ignore') return
  if (action === 'conflict') {
    cancelAutoSave()
    conflict.value = { text: next?.kind === 'text' ? (next.text ?? '') : null, mtimeMs: next?.mtimeMs ?? 0 }
    return
  }
  if (next?.kind !== 'text') {
    editing.value = false
    return load()
  }
  knownMtime = next.mtimeMs
  baseText.value = next.text ?? ''
  view.value = next
  editor.value?.setText(next.text ?? '')
  changes.reload()
  layoutRevision.value++
}

function reloadFromDisk(): void {
  cancelAutoSave()
  const c = conflict.value
  conflict.value = null
  compareText.value = null
  pending.value = null
  if (editing.value && c?.text != null) {
    knownMtime = c.mtimeMs
    baseText.value = c.text
    editor.value?.setText(c.text)
    if (view.value?.kind === 'text') view.value = { ...view.value, text: c.text, mtimeMs: c.mtimeMs }
    changes.reload()
    layoutRevision.value++
    return
  }
  if (editing.value) editing.value = false
  dirty.value = false
  void load({ keepScroll: true })
}

/** Overwriting the newer disk file becomes the user's call: the next save goes through. */
function keepMine(): void {
  if (conflict.value) knownMtime = conflict.value.mtimeMs
  conflict.value = null
  compareText.value = null
}

async function compareWithDisk(): Promise<void> {
  const text = conflict.value?.text
  if (text == null) return
  if (!editing.value) await startEdit()
  compareText.value = text
}

function flashLines(changed: number[]): void {
  if (!changed.length || changed.length > 400) return
  flash.value = new Set(changed)
  if (flashTimer) clearTimeout(flashTimer)
  flashTimer = setTimeout(() => (flash.value = new Set()), FLASH_MS)
}

async function jumpTo(line: number | undefined): Promise<void> {
  if (line && props.active && view.value?.kind === 'text') nav.visit(spotAt(line))
  if (line && editing.value) return editor.value?.revealLine(line)
  if (!line || !showSource.value) return
  targetLine.value = line
  if (windowed.value) return revealRow(line - 1)
  await nextTick()
  scroller.value?.querySelector<HTMLElement>(`[data-line="${line}"]`)?.scrollIntoView({ block: 'center' })
}

/** A view (or a diagnostic) picked in the design half: scroll the code to its start tag, optionally selecting the line. */
async function revealLayoutLine(line: number, select: boolean): Promise<void> {
  layoutLine.value = line
  if (editing.value) return editor.value?.revealLine(line, select)
  await jumpTo(line)
  if (!select || !showCode.value) return
  const cell = scroller.value?.querySelector<HTMLElement>(`[data-line="${line}"] .c`)
  const sel = window.getSelection()
  if (!cell || !sel) return
  const range = document.createRange()
  range.selectNodeContents(cell)
  sel.removeAllRanges()
  sel.addRange(range)
}

async function setWatch(dir: string | null): Promise<void> {
  if (watchedRoot === dir) return
  if (watchedRoot) void unwatchRoot(watchedRoot)
  watchedRoot = dir
  if (dir && !(await watchRoot(dir)) && watchedRoot === dir) watchedRoot = null
}

const samePath = (a: string, b: string): boolean => {
  const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  return isMac || /^[A-Za-z]:/.test(a) ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b)
}

const offChange = onPreviewChanged((change) => {
  const file = view.value?.path ?? props.path
  if (change.paths.some((p) => samePath(p, file) || samePath(p, props.path))) void checkDisk()
})

async function openFind(): Promise<void> {
  findOpen.value = true
  if (rendered.value) mdPreview.value = false
  await nextTick()
  findInput.value?.select()
  findInput.value?.focus()
}

function closeFind(): void {
  findOpen.value = false
  query.value = ''
  root.value?.focus()
}

async function stepMatch(dir: 1 | -1): Promise<void> {
  const total = matches.value.length
  if (!total) return
  matchIndex.value = (matchIndex.value + dir + total) % total
  await revealMatch()
}

async function revealMatch(): Promise<void> {
  const m = matches.value[matchIndex.value]
  if (m && windowed.value) await revealRow(m.line)
  else await nextTick()
  scroller.value?.querySelector('mark.ccm-find-current')?.scrollIntoView({ block: windowed.value ? 'nearest' : 'center', inline: 'nearest' })
}

watch(query, async () => {
  matchIndex.value = 0
  await revealMatch()
})

function onFindKey(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    e.preventDefault()
    void stepMatch(e.shiftKey ? -1 : 1)
  } else if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    closeFind()
  }
}

function onWindowKey(e: KeyboardEvent): void {
  if (!props.active || view.value?.kind !== 'text') return
  const focused = document.activeElement
  const inPane = !!focused && focused !== document.body && !!root.value?.contains(focused)
  if (inPane && isSaveKey(e, isMac)) {
    e.preventDefault()
    e.stopPropagation()
    void save()
    return
  }
  if (inPane && e.key === 'F12' && !e.altKey && (isMac ? e.metaKey : e.ctrlKey) && !e.shiftKey) {
    e.preventDefault()
    openOutline()
    return
  }
  if (inPane && e.key === 'F12' && !e.altKey && !e.ctrlKey && !e.metaKey) {
    e.preventDefault()
    if (e.shiftKey) findUsages()
    else findDeclaration()
    return
  }
  if (inPane && e.key === 'F11' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault()
    toggleBookmark()
    return
  }
  if (inPane && !isMac && e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyE') {
    e.preventDefault()
    e.stopPropagation()
    nav.picker = 'recent'
    return
  }
  if (inPane && e.key === 'F8' && !e.ctrlKey && !e.metaKey && !e.altKey && problems.value && !inEditor(e.target)) {
    e.preventDefault()
    stepProblems(e.shiftKey ? -1 : 1)
    return
  }
  if (editing.value) {
    // Find / replace / F7 inside the editor belong to CodeMirror.
    if (inEditor(e.target)) return
    if (inPane && (isMac ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      editor.value?.openFind()
    }
    return
  }
  // Windowed rows: useWindowCopy paints "all". Otherwise select only the code / rendered markdown, not the whole window.
  if (inPane && isSelectAllKey(e, isMac) && !windowed.value && !isTyping(e.target)) {
    const el = showSource.value ? codeEl.value : mdEl.value
    if (el) {
      e.preventDefault()
      window.getSelection()?.selectAllChildren(el)
    }
    return
  }
  if (inPane && canEdit.value && isEditKey(e) && !isTyping(e.target)) {
    e.preventDefault()
    void startEdit()
    return
  }
  if (e.key === 'F7' && !e.ctrlKey && !e.metaKey && !e.altKey && showSource.value && changes.blocks.value.length) {
    const focus = document.activeElement
    if (focus && focus !== document.body && !root.value?.contains(focus)) return
    e.preventDefault()
    stepChange(e.shiftKey ? -1 : 1)
    return
  }
  const mod = isMac ? e.metaKey : e.ctrlKey
  if (!mod || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'f') return
  // Only when this pane holds focus, or nothing in particular does (another pane's terminal keeps its own keys).
  const focus = document.activeElement
  if (focus && focus !== document.body && !root.value?.contains(focus)) return
  e.preventDefault()
  void openFind()
}

/** Rows of block `i` in the rendered code (first, last). */
function rowsOf(i: number): { top: HTMLElement | null; bottom: HTMLElement } | null {
  const rows = codeEl.value?.querySelectorAll<HTMLElement>(`[data-block="${i}"]`)
  if (!rows?.length) return null
  return { top: rows[0]!, bottom: rows[rows.length - 1]! }
}

async function openChange(i: number, scroll = false): Promise<void> {
  const total = changes.blocks.value.length
  if (!total) return
  const at = ((i % total) + total) % total
  if (scroll && windowed.value) await revealRow(Math.min(changes.blocks.value[at]!.line1, lines.value.length - 1))
  else if (scroll) {
    await nextTick()
    rowsOf(at)?.top?.scrollIntoView({ block: 'center' })
  }
  const rows = rowsOf(at)
  if (!rows) return
  popupRows.value = rows
  popupIndex.value = at
}

/** F7 / Shift+F7: from the open popup, else from the top of the view. */
function stepChange(dir: 1 | -1): void {
  const blocks = changes.blocks.value
  if (popupIndex.value !== null) {
    void openChange(popupIndex.value + dir, true)
    return
  }
  const top = scroller.value?.scrollTop ?? 0
  const offsets = windowed.value ? blocks.map((b) => rowOrigin() + Math.min(b.line1, lines.value.length - 1) * rowH.value) : blocks.map((_, i) => rowsOf(i)?.top?.offsetTop ?? 0)
  const before = offsets.filter((y) => y < top - 1).length
  const next = dir === 1 ? offsets.findIndex((y) => y > top + 1) : before - 1
  void openChange(next >= 0 ? next : dir === 1 ? 0 : blocks.length - 1, true)
}

function closePopup(refocus = false): void {
  popupIndex.value = null
  popupRows.value = null
  if (refocus) root.value?.focus({ preventScroll: true })
}

function onCodeClick(e: MouseEvent): void {
  const blamed = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-blame]')
  if (blamed?.dataset.blame && blame.value?.ok) {
    emit('showCommit', blame.value.root, blamed.dataset.blame)
    return
  }
  const marker = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-gutter]')
  const row = marker?.closest<HTMLElement>('[data-block]')
  if (!row) {
    // Click on an XML line (not a drag selection) highlights the matching view in the design half.
    const lineRow = showDesign.value ? (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-line]') : null
    if (lineRow && (window.getSelection()?.isCollapsed ?? true)) layoutLine.value = Number(lineRow.dataset.line)
    return
  }
  const i = Number(row.dataset.block)
  if (popupIndex.value === i) closePopup()
  else void openChange(i)
}

function showDiff(): void {
  const ok = changes.ok.value
  if (ok) emit('showDiff', ok.root, view.value?.path ?? props.path)
  closePopup()
}

const rollbackText = computed(() => {
  const i = pendingRollback.value
  const b = i === null ? undefined : changes.blocks.value[i]
  if (!b) return null
  return {
    title: t('workspace.diff.confirmTitle', { name: name.value }),
    lines: [t('workspace.changes.confirm.lines', { added: b.adds.length, removed: b.dels.length }), t('workspace.changes.confirm.noUndo')],
    preview: [...b.dels.map((l) => `− ${l.text}`), ...b.adds.map((l) => `+ ${l.text}`)].slice(0, 12),
  }
})

async function confirmRollback(): Promise<void> {
  const i = pendingRollback.value
  pendingRollback.value = null
  const ok = changes.ok.value
  const file = changes.file.value
  const block = i === null ? undefined : changes.blocks.value[i]
  if (!ok || !file || !block) return
  closePopup(true)
  const res = await changesDiscard(ok.root, ok.rel, blockPatch(file, block))
  if (res.ok) notice.value = null
  else if (res.error === 'failed') notice.value = t('workspace.changes.discardFailed', { detail: res.detail ?? '' })
  else notice.value = t(`workspace.changes.error.${res.error}`)
  changes.reload(0)
}

// Markers moved (file edited, rollback, commit): keep the popup on a change that still exists.
watch(
  () => changes.blocks.value,
  async (blocks) => {
    if (popupIndex.value === null) return
    if (!blocks.length) return closePopup()
    await nextTick()
    void openChange(Math.min(popupIndex.value, blocks.length - 1))
  },
)
watch(showSource, (src) => {
  if (!src) closePopup()
})
// v-html replaced the rows (window moved, flash, find): measure the row height again, re-anchor an open popup.
watch(
  html,
  () => {
    if (windowed.value) {
      const h = codeEl.value?.querySelector<HTMLElement>('.r')?.getBoundingClientRect().height
      if (h && Math.abs(h - rowH.value) > 0.01) rowH.value = h
    }
    if (popupIndex.value === null) return
    const rows = rowsOf(popupIndex.value)
    if (rows) popupRows.value = rows
    else closePopup()
  },
  { flush: 'post' },
)

async function copyPath(): Promise<void> {
  try {
    await navigator.clipboard.writeText(view.value?.path ?? props.path)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    // clipboard denied
  }
}

async function openInApp(): Promise<void> {
  const res = await openPath(view.value?.path ?? props.path)
  notice.value = res === 'ok' ? null : res === 'denied' ? t('workspace.viewer.openDenied') : res
}

function onMarkdownClick(e: MouseEvent): void {
  const a = (e.target as HTMLElement | null)?.closest('a')
  if (!a) return
  e.preventDefault()
  const href = a.getAttribute('href') ?? ''
  if (/^https?:\/\//i.test(href)) void openExternal(href)
  else if (href.startsWith('#')) return
  else if (href) emit('open', joinPath(dirOf(view.value?.path ?? props.path), href.split('#')[0]!))
}

watch(
  () => props.path,
  async () => {
    // Only a rename moves a pane to another path: keep the dirty buffer, follow the new path.
    if (dirty.value) {
      const next = await readFile(props.path)
      if (next?.kind === 'text') view.value = { ...next, text: view.value?.text ?? next.text }
      void setWatch(next && next.kind !== 'denied' ? dirOf(next.path) : null)
      return
    }
    editing.value = false
    pending.value = null
    conflict.value = null
    compareText.value = null
    editNotice.value = null
    findOpen.value = false
    targetLine.value = null
    layoutLine.value = null
    closePopup()
    await load()
    void setWatch(view.value && view.value.kind !== 'denied' ? dirOf(view.value.path) : null)
    await jumpTo(props.line)
  },
)
watch(
  () => props.line,
  (line) => void jumpTo(line),
)
watch(showSource, (src) => {
  if (src && targetLine.value) void jumpTo(targetLine.value)
})

const resize = new ResizeObserver(([entry]) => {
  paneWidth.value = entry?.contentRect.width ?? 0
  onCodeScroll()
})

onMounted(async () => {
  if (props.paneKey) workspace.registerSaver(props.paneKey, save)
  window.addEventListener('keydown', onWindowKey, true)
  window.addEventListener('blur', onWindowBlur)
  document.addEventListener('visibilitychange', onVisibility)
  if (root.value) resize.observe(root.value)
  await load()
  if (props.line && rendered.value) mdPreview.value = false
  void setWatch(view.value && view.value.kind !== 'denied' ? dirOf(view.value.path) : null)
  await jumpTo(props.line)
})

onBeforeUnmount(() => {
  if (props.paneKey) {
    workspace.registerSaver(props.paneKey, null)
    workspace.setDirty(props.paneKey, false)
  }
  if (liveTimer) clearTimeout(liveTimer)
  if (savedTimer) clearTimeout(savedTimer)
  cancelAutoSave()
  window.removeEventListener('keydown', onWindowKey, true)
  window.removeEventListener('blur', onWindowBlur)
  document.removeEventListener('visibilitychange', onVisibility)
  resize.disconnect()
  if (stackTimer) clearTimeout(stackTimer)
  offChange()
  if (flashTimer) clearTimeout(flashTimer)
  if (editSpotTimer) clearTimeout(editSpotTimer)
  if (rangeFrame) cancelAnimationFrame(rangeFrame)
  void setWatch(null)
})

const lineCount = computed(() => lines.value.length)

const headMore = computed<MenuEntry[]>(() => {
  const out: MenuEntry[] = []
  const text = view.value?.kind === 'text'
  if (changes.blocks.value.length && changes.ok.value) out.push({ id: 'diff', label: t('workspace.gutter.showDiff'), hint: t('workspace.gutter.summary', changeTotals.value), icon: GitCompare })
  if (isXmlPreview.value) for (const m of layoutModes.value) out.push({ id: `layout:${m.value}`, label: m.label, icon: layoutMode.value === m.value ? Check : m.icon })
  if (isDart.value && fwpProject.value) out.push({ id: 'fwp', label: t('fwp.toggle'), icon: fwpOpen.value ? Check : Smartphone })
  if (rendered.value) out.push({ id: 'md', label: mdPreview.value ? t('workspace.viewer.source') : t('workspace.viewer.preview'), icon: mdPreview.value ? Code : Eye, disabled: editing.value })
  if (treeFmt.value) out.push({ id: 'tree', label: treeOn.value ? t('workspace.tree.code') : t('workspace.tree.toggle'), icon: treeOn.value ? Code : Network, disabled: editing.value })
  if (text) {
    out.push({ id: 'wrap', label: t('workspace.viewer.wrap'), icon: wrap.value ? Check : TextWrap, disabled: !showSource.value })
    out.push({ id: 'find', label: t('workspace.viewer.find'), icon: Search, shortcut: isMac ? '⌘F' : 'Ctrl+F' })
    out.push({ id: 'outline', label: t('workspace.outline.open'), icon: ListTree, shortcut: isMac ? '⌘F12' : 'Ctrl+F12', disabled: !showSource.value && !editing.value })
    out.push({ id: 'usages', label: t('workspace.outline.usages'), icon: Search, shortcut: '⇧F12' })
    out.push({ id: 'declaration', label: t('workspace.outline.declaration'), icon: Search, shortcut: 'F12' })
    if (hasBlame) out.push({ id: 'blame', label: t('workspace.blame.toggle'), icon: blameOn.value ? Check : GitCommitHorizontal, disabled: editing.value || !showSource.value })
  }
  if (canEdit.value) {
    out.push({ separator: true })
    if (dirty.value || editing.value) out.push({ id: 'save', label: t('editor.save'), icon: Save, shortcut: saveKey, disabled: !dirty.value || saving.value })
    if (editing.value) out.push({ id: 'edit', label: t('editor.done'), hint: t('editor.doneHint'), icon: Check })
    else out.push({ id: 'edit', label: t('editor.edit'), hint: block.value ? t(`editor.readOnly.${block.value}`) : undefined, icon: Pencil })
  }
  out.push({ separator: true })
  out.push({ id: 'copy', label: t('workspace.viewer.copyPath'), icon: Copy })
  out.push({ id: 'reveal', label: isMac ? t('workspace.viewer.revealMac') : t('workspace.viewer.reveal'), icon: FolderOpen })
  out.push({ id: 'openEditor', label: t('workspace.viewer.openEditor'), icon: SquarePen })
  return out
})

function pickHead(id: string): void {
  if (id === 'diff') showDiff()
  else if (id.startsWith('layout:')) layoutMode.value = id.slice('layout:'.length) as LayoutMode
  else if (id === 'fwp') fwpOpen.value = !fwpOpen.value
  else if (id === 'md') mdPreview.value = !mdPreview.value
  else if (id === 'tree') treeOn.value = !treeOn.value
  else if (id === 'wrap') wrap.value = !wrap.value
  else if (id === 'blame') toggleBlame()
  else if (id === 'outline') openOutline()
  else if (id === 'usages') findUsages()
  else if (id === 'declaration') findDeclaration()
  else if (id === 'find') {
    if (editing.value) editor.value?.openFind()
    else if (findOpen.value) closeFind()
    else void openFind()
  } else if (id === 'save') void save()
  else if (id === 'edit') {
    if (editing.value) finishEdit()
    else void startEdit()
  } else if (id === 'copy') void copyPath()
  else if (id === 'reveal') revealPath(view.value?.path ?? props.path)
  else if (id === 'openEditor') void openInApp()
}
</script>

<template>
  <section ref="root" tabindex="-1" class="relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-card bg-well shadow-card outline-none" :aria-label="t('workspace.viewer.title')" @focusout="onFocusOut">
    <div class="ccm-material @container flex h-9 min-w-0 shrink-0 items-center gap-0.5 border-b border-line px-2 select-none" role="toolbar" :aria-label="t('workspace.viewer.toolbar')" data-pane-head>
      <FileText :size="15" class="mr-1 shrink-0 text-agent-file @max-[300px]:mr-0" aria-hidden="true" />
      <span class="min-w-0 truncate text-xs font-semibold text-ink" :title="view?.path ?? path">{{ name }}</span>
      <span v-if="dirty" class="ml-1 shrink-0 text-xs leading-none text-warning" :title="t('editor.unsaved')" data-file-dirty>
        <span aria-hidden="true">●</span><span class="sr-only">{{ t('editor.unsaved') }}</span>
      </span>
      <span class="ml-1.5 min-w-0 flex-1 truncate text-2xs text-ink-faint @max-[420px]:invisible" dir="rtl" :title="view?.path ?? path">
        <bdi>{{ dirOf(view?.path ?? path) }}</bdi>
      </span>
      <span v-if="view?.kind === 'text' && !markdown" class="hidden shrink-0 px-1.5 text-2xs tabular text-ink-faint @2xl:inline">{{ t('workspace.viewer.lines', lineCount) }}</span>

      <button
        v-if="changes.blocks.value.length && changes.ok.value"
        type="button"
        class="ccm-btn-plain shrink-0 gap-1 text-2xs tabular @max-[480px]:hidden"
        :title="`${t('workspace.gutter.showDiff')} — ${t('workspace.gutter.summary', changeTotals)}`"
        :aria-label="`${t('workspace.gutter.showDiff')}, ${t('workspace.gutter.summary', changeTotals)}`"
        data-file-show-diff
        data-more="diff"
        @click="showDiff"
      >
        <GitCompare :size="14" class="text-diff-mod" aria-hidden="true" />
        <span v-if="changeTotals.added" class="text-diff-add">+{{ changeTotals.added }}</span>
        <span v-if="changeTotals.removed" class="text-diff-del">−{{ changeTotals.removed }}</span>
      </button>
      <SegmentedControl
        v-if="isXmlPreview"
        v-model="layoutMode"
        class="mx-1 shrink-0 @max-[480px]:hidden"
        :options="layoutModes"
        :label="t('layout.mode.label')"
        icon-only
        data-layout-mode
        data-more="layout"
      />
      <button
        v-if="isDart && fwpProject"
        type="button"
        class="ccm-btn-plain shrink-0 @max-[480px]:hidden"
        :aria-pressed="fwpOpen"
        :title="t('fwp.toggle')"
        :aria-label="t('fwp.toggle')"
        data-fwp-toggle
        data-more="fwp"
        @click="fwpOpen = !fwpOpen"
      >
        <Smartphone :size="14" aria-hidden="true" />
      </button>
      <template v-if="rendered">
        <button
          type="button"
          class="ccm-btn-plain shrink-0 @max-[480px]:hidden"
          :aria-pressed="mdPreview"
          :disabled="editing"
          :title="mdPreview ? t('workspace.viewer.source') : t('workspace.viewer.preview')"
          :aria-label="t('workspace.viewer.mdMode')"
          data-more="md"
          @click="mdPreview = !mdPreview"
        >
          <Eye v-if="mdPreview" :size="14" aria-hidden="true" />
          <Code v-else :size="14" aria-hidden="true" />
        </button>
      </template>
      <button
        v-if="treeFmt"
        type="button"
        class="ccm-btn-plain shrink-0 @max-[480px]:hidden"
        :aria-pressed="treeOn"
        :disabled="editing"
        :title="treeOn ? t('workspace.tree.code') : t('workspace.tree.toggle')"
        :aria-label="t('workspace.tree.toggle')"
        data-file-tree-toggle
        data-more="tree"
        @click="treeOn = !treeOn"
      >
        <Network :size="14" aria-hidden="true" />
      </button>
      <button
        v-if="view?.kind === 'text'"
        type="button"
        class="ccm-btn-plain shrink-0 @max-[480px]:hidden"
        :aria-pressed="wrap"
        :disabled="!showSource"
        :title="t('workspace.viewer.wrap')"
        :aria-label="t('workspace.viewer.wrap')"
        data-more="wrap"
        @click="wrap = !wrap"
      >
        <TextWrap :size="14" aria-hidden="true" />
      </button>
      <button
        v-if="view?.kind === 'text'"
        type="button"
        class="ccm-btn-plain shrink-0 @max-[480px]:hidden"
        :aria-pressed="findOpen"
        :title="`${t('workspace.viewer.find')} (${isMac ? '⌘F' : 'Ctrl+F'})`"
        :aria-label="t('workspace.viewer.find')"
        data-more="find"
        @click="editing ? editor?.openFind() : findOpen ? closeFind() : openFind()"
      >
        <Search :size="14" aria-hidden="true" />
      </button>
      <template v-if="canEdit">
        <span class="mx-1 h-4 w-px shrink-0 bg-line @max-[360px]:hidden" aria-hidden="true" />
        <span v-if="saving && !quietSave" class="flex shrink-0 items-center gap-1 px-1 text-2xs text-ink-muted" role="status">
          <LoaderCircle :size="13" class="animate-spin" aria-hidden="true" /><span class="@max-[480px]:sr-only">{{ t('editor.saving') }}</span>
        </span>
        <span v-else-if="savedFlash" class="flex shrink-0 items-center gap-1 px-1 text-2xs text-success" role="status" data-file-saved>
          <Check :size="13" aria-hidden="true" /><span class="@max-[480px]:sr-only">{{ t('editor.saved') }}</span>
        </span>
        <button
          v-if="dirty || editing"
          type="button"
          class="ccm-btn-plain shrink-0 @max-[360px]:hidden"
          :disabled="!dirty || saving"
          :title="saveTitle"
          :aria-label="t('editor.save')"
          data-file-save
          data-more="save"
          @click="save()"
        >
          <Save :size="14" aria-hidden="true" />
        </button>
        <button
          v-if="editing"
          type="button"
          class="ccm-btn-plain shrink-0 gap-1 text-2xs @max-[360px]:hidden"
          :title="t('editor.doneHint')"
          data-file-done
          data-more="edit"
          @click="finishEdit"
        >
          <Check :size="14" aria-hidden="true" /><span class="@max-[480px]:sr-only">{{ t('editor.done') }}</span>
        </button>
        <button
          v-else
          type="button"
          class="ccm-btn-plain shrink-0 gap-1 text-2xs @max-[360px]:hidden"
          :aria-disabled="!!block"
          :title="block ? t(`editor.readOnly.${block}`) : t('editor.editHint')"
          data-file-edit
          data-more="edit"
          @click="startEdit"
        >
          <Pencil :size="14" aria-hidden="true" /><span class="@max-[480px]:sr-only">{{ t('editor.edit') }}</span>
        </button>
      </template>
      <span class="mx-1 h-4 w-px shrink-0 bg-line @max-[600px]:hidden" aria-hidden="true" />
      <button
        type="button"
        class="ccm-btn-plain shrink-0 @max-[600px]:hidden"
        :title="copied ? t('workspace.viewer.copied') : t('workspace.viewer.copyPath')"
        :aria-label="t('workspace.viewer.copyPath')"
        data-more="copy"
        @click="copyPath"
      >
        <Check v-if="copied" :size="14" class="text-success" aria-hidden="true" />
        <Copy v-else :size="14" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="ccm-btn-plain shrink-0 @max-[600px]:hidden"
        :title="isMac ? t('workspace.viewer.revealMac') : t('workspace.viewer.reveal')"
        :aria-label="isMac ? t('workspace.viewer.revealMac') : t('workspace.viewer.reveal')"
        data-more="reveal"
        @click="revealPath(view?.path ?? path)"
      >
        <FolderOpen :size="14" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="ccm-btn-plain shrink-0 @max-[600px]:hidden"
        :title="t('workspace.viewer.openEditor')"
        :aria-label="t('workspace.viewer.openEditor')"
        data-more="openEditor"
        @click="openInApp"
      >
        <SquarePen :size="14" aria-hidden="true" />
      </button>
      <PaneMore class="hidden @max-[600px]:inline-flex @max-[300px]:min-w-6 @max-[300px]:px-1" :entries="headMore" :label="t('workspace.paneHead.more')" @pick="pickHead" />
      <slot name="end" />
    </div>

    <Transition name="ccm-fade">
      <div v-if="findOpen && showSource" class="ccm-material flex h-9 shrink-0 items-center gap-1 border-b border-line px-2" role="search">
        <input
          ref="findInput"
          v-model="query"
          type="search"
          class="ccm-field h-6 min-w-0 flex-1"
          :placeholder="t('workspace.viewer.findPlaceholder')"
          :aria-label="t('workspace.viewer.findPlaceholder')"
          @keydown="onFindKey"
        />
        <span class="w-20 shrink-0 text-center text-2xs tabular text-ink-muted" aria-live="polite">
          {{ query ? (matches.length ? t('workspace.viewer.findCount', { current: matchIndex + 1, total: matches.length }) : t('workspace.viewer.findNone')) : '' }}
        </span>
        <button type="button" class="ccm-btn-plain shrink-0" :disabled="!matches.length" :title="t('workspace.viewer.findPrev')" :aria-label="t('workspace.viewer.findPrev')" @click="stepMatch(-1)">
          <ChevronUp :size="14" aria-hidden="true" />
        </button>
        <button type="button" class="ccm-btn-plain shrink-0" :disabled="!matches.length" :title="t('workspace.viewer.findNext')" :aria-label="t('workspace.viewer.findNext')" @click="stepMatch(1)">
          <ChevronDown :size="14" aria-hidden="true" />
        </button>
        <button type="button" class="ccm-btn-plain shrink-0" :title="t('workspace.viewer.findClose')" :aria-label="t('workspace.viewer.findClose')" @click="closeFind">
          <X :size="14" aria-hidden="true" />
        </button>
      </div>
    </Transition>

    <p v-if="notice" class="shrink-0 border-b border-line bg-st-waiting-soft px-3 py-1.5 text-xs text-ink" role="status">{{ notice }}</p>
    <p v-if="plainBecauseLarge && !editing" class="shrink-0 border-b border-well-line px-3 py-1 text-2xs text-well-ink">{{ t('workspace.viewer.plain') }}</p>
    <div
      v-if="editNotice"
      class="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1.5 text-xs text-ink"
      :class="editNotice.kind === 'error' ? 'bg-st-error-soft' : 'bg-fill'"
      :role="editNotice.kind === 'error' ? 'alert' : 'status'"
      data-file-edit-notice
    >
      <CircleAlert v-if="editNotice.kind === 'error'" :size="14" class="shrink-0 text-st-error" aria-hidden="true" />
      <Info v-else :size="14" class="shrink-0 text-ink-muted" aria-hidden="true" />
      <span class="min-w-0 flex-1">{{ editNotice.text }}</span>
      <button type="button" class="ccm-btn-plain shrink-0" :aria-label="t('workspace.viewer.findClose')" @click="editNotice = null"><X :size="13" aria-hidden="true" /></button>
    </div>
    <div v-if="conflict" class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-warning-soft px-3 py-1.5 text-xs text-ink" role="alert" data-file-conflict>
      <CircleAlert :size="14" class="shrink-0 text-warning" aria-hidden="true" />
      <span class="min-w-0 flex-1">{{ conflict.text === null ? t('editor.disk.deleted') : t('editor.disk.changed') }}</span>
      <button type="button" class="ccm-btn shrink-0" :title="t('editor.disk.reloadHint')" data-conflict-reload @click="reloadFromDisk">{{ t('editor.disk.reload') }}</button>
      <button type="button" class="ccm-btn shrink-0" :title="t('editor.disk.keepHint')" data-conflict-keep @click="keepMine">{{ t('editor.disk.keep') }}</button>
      <button v-if="conflict.text !== null" type="button" class="ccm-btn shrink-0" :aria-pressed="compareText !== null" :title="t('editor.disk.compareHint')" data-conflict-compare @click="compareWithDisk">
        {{ t('editor.disk.compare') }}
      </button>
    </div>
    <div v-if="compareText !== null && editing" class="flex shrink-0 items-center gap-2 border-b border-line bg-fill px-3 py-1 text-2xs text-ink-muted" role="status" data-file-compare>
      <GitCompare :size="13" class="shrink-0 text-diff-mod" aria-hidden="true" />
      <span class="min-w-0 flex-1">{{ t('editor.disk.comparing') }}</span>
      <button type="button" class="ccm-btn-plain shrink-0 text-2xs" @click="compareText = null">{{ t('editor.disk.closeCompare') }}</button>
    </div>
    <OutlinePicker v-if="outlineOpen" :items="outlineItems" @pick="pickOutline" @close="closeOutline" />
    <ProblemBar v-if="problems && showSource" :problems="problems" :index="problemIndex" :stale="problemsStale" @step="stepProblems" />
    <p v-if="liveText !== null && showDesign" class="flex shrink-0 items-center gap-1.5 border-b border-line px-3 py-1 text-2xs text-ink-muted" data-file-live>
      <Eye :size="12" aria-hidden="true" />{{ t('editor.live') }}
    </p>

    <div class="flex min-h-0 flex-1" :class="sidePanel && layoutStacked ? 'flex-col' : ''">
      <div v-show="showCode" class="flex min-h-0 min-w-0 flex-1">
      <CodeEditor
        v-if="editing"
        ref="editor"
        :doc="editorDoc"
        :base="baseText"
        :grammar="grammar"
        :wrap="wrap"
        :compare="compareText"
        :line="targetLine ?? line ?? null"
        :problems="problems?.items ?? null"
        :bookmarks="bookmarkLines"
        @dirty="(d: boolean) => (dirty = d)"
        @change="onEditorChange"
        @save="save()"
        @cursor-line="onCursorLine"
      />
      <div v-else ref="scroller" class="ccm-scroll relative min-h-0 min-w-0 flex-1 overflow-auto" @scroll.passive="onCodeScroll">
        <div v-if="loading" class="grid size-full place-items-center text-xs text-well-ink">{{ t('workspace.viewer.loading') }}</div>
        <div v-else-if="!hasPreview || !view || (view.kind !== 'text' && view.kind !== 'image')" class="grid size-full place-items-center p-6">
          <div class="flex max-w-sm flex-col items-center gap-2 text-center">
            <FileWarning :size="26" class="text-well-ink" aria-hidden="true" />
            <p class="text-sm text-well-ink">{{ t(`workspace.viewer.kind.${!hasPreview || !view ? 'unavailable' : view.kind}`) }}</p>
            <AccessPrompt v-if="view?.kind === 'denied'" :path="path" well @granted="load()" />
            <button v-if="view && (view.kind === 'binary' || view.kind === 'too-large')" type="button" class="ccm-btn mt-1" @click="openInApp">
              {{ t('workspace.viewer.openEditor') }}
            </button>
          </div>
        </div>
        <div v-else-if="view.kind === 'image'" class="grid min-h-full place-items-center p-6">
          <img v-if="imageUrl" :src="imageUrl" :alt="t('workspace.viewer.image')" class="max-h-full max-w-full object-contain" />
        </div>
        <JsonTree v-else-if="treeShown && treeFmt" :text="treeText" :format="treeFmt" :name="name" @failed="onTreeFailed" />
        <webview v-else-if="htmlPage && !showSource && htmlUrl" :key="htmlRev" :src="htmlUrl" partition="persist:ccm-preview" class="size-full bg-page" />
        <div v-else-if="htmlPage && !showSource" class="size-full" />
        <article v-else-if="!showSource" ref="mdEl" class="md mx-auto max-w-3xl px-6 py-5" data-code-zoom v-html="markdownHtml" @click="onMarkdownClick" />
        <div
          v-else
          ref="codeEl"
          class="code ccm-code min-w-full py-2"
          :class="[wrap ? 'is-wrap' : 'w-max', { 'is-all': allSelected, 'is-blame': blameShown }]"
          :style="codeMinWidth ? { minWidth: codeMinWidth } : undefined"
          role="document"
          :data-windowed="windowed ? '' : undefined"
          data-code-zoom
          @click="onCodeClick"
          v-html="html"
        />
      </div>
      <CodeMinimap
        v-if="minimap"
        :lines="lines"
        :tokens="tokens"
        :scroller="scroller"
        :content="codeEl"
        :matches="matches"
        :current="matchIndex"
        :target-line="targetLine"
        :changes="changes.blocks.value"
        :geometry="minimapGeometry"
      />
      <ChangeRuler v-else-if="!editing && pending === null && showSource && !loading && changes.blocks.value.length":blocks="changes.blocks.value" :line-count="lineCount" @jump="(i) => openChange(i, true)" />
      </div>
      <DrawablePreview
        v-if="showDesign && isDrawable"
        :class="showCode ? (layoutStacked ? 'border-t border-line' : 'border-l border-line') : ''"
        :path="view?.path ?? path"
        :revision="layoutRevision"
        :text="liveText"
      />
      <LayoutPreview
        v-else-if="showDesign"
        :class="showCode ? (layoutStacked ? 'border-t border-line' : 'border-l border-line') : ''"
        :path="view?.path ?? path"
        :revision="layoutRevision"
        :text="liveText"
        :line="layoutLine"
        :active="active"
        @reveal="revealLayoutLine"
      />
      <FlutterPreviewPanel
        v-if="showFwp"
        :class="layoutStacked ? 'border-t border-line' : 'border-l border-line'"
        :path="view?.path ?? path"
        :revision="layoutRevision"
        :active="active"
      />
    </div>

    <HunkPopup
      v-if="popupIndex !== null && popupRows && changes.blocks.value[popupIndex]"
      :block="changes.blocks.value[popupIndex]!"
      :index="popupIndex"
      :total="changes.blocks.value.length"
      :anchor="popupRows.bottom"
      :anchor-top="popupRows.top"
      :rollback-blocked="rollbackBlocked"
      @close="closePopup(true)"
      @step="(dir) => openChange(popupIndex! + dir, true)"
      @rollback="pendingRollback = popupIndex"
      @show-diff="showDiff"
    />
    <DiscardConfirm v-if="rollbackText" :title="rollbackText.title" :lines="rollbackText.lines" :preview="rollbackText.preview" @confirm="confirmRollback" @cancel="pendingRollback = null" />

  </section>
</template>

<style scoped>
/* shiki colours: .ccm-code (style.css). */
.code {
  color: var(--shiki-foreground);
  font-family: var(--font-mono);
  font-size: var(--ccm-code-size, 13px);
  font-variant-ligatures: none;
  line-height: 1.5;
  tab-size: 4;
}
.code :deep(.r) {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  transition: background-color var(--ccm-dur-slow, 300ms) var(--ease-out-quint, ease-out);
}
.code.is-blame :deep(.r) {
  grid-template-columns: 15em max-content minmax(0, 1fr);
}
.code :deep(.b) {
  position: sticky;
  left: 0;
  z-index: 1;
  overflow: hidden;
  padding-inline: 0.75em 0.5em;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: color-mix(in srgb, var(--ccm-well-ink) 70%, var(--ccm-well));
  background: var(--ccm-well);
  box-shadow: inset -1px 0 0 var(--ccm-line);
  font-family: var(--font-sans);
  font-size: 0.85em;
  user-select: none;
}
.code :deep(.b[data-blame]) {
  cursor: pointer;
}
.code :deep(.b[data-blame]:hover) {
  color: var(--ccm-well-ink);
  text-decoration: underline;
}
.code.is-blame :deep(.n) {
  left: 15em;
}
.code :deep(.n) {
  position: sticky;
  left: 0;
  min-width: 3.5em;
  padding-inline: 0 1em;
  text-align: right;
  color: color-mix(in srgb, var(--ccm-well-ink) 50%, var(--ccm-well));
  background: var(--ccm-well);
  user-select: none;
  font-variant-numeric: tabular-nums;
}
.code :deep(.c) {
  padding-right: 1.5em;
  white-space: pre;
}
.code.is-wrap :deep(.c) {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
/* Change markers: a bar on the number column's code edge (triangle for a deletion), IntelliJ style. */
.code :deep(.r[data-block] .n) {
  cursor: pointer;
}
.code :deep(.r.bm .n::before) {
  content: '';
  position: absolute;
  left: 3px;
  top: 50%;
  width: 6px;
  height: 9px;
  translate: 0 -50%;
  background: var(--ccm-favorite);
  clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 70%, 0 100%);
}
.code :deep(.r[data-block] .n:hover) {
  color: var(--ccm-well-ink);
}
.code :deep(.r.g-add .n) {
  box-shadow: inset -3px 0 0 var(--ccm-diff-add-well);
}
.code :deep(.r.g-mod .n) {
  box-shadow: inset -3px 0 0 var(--ccm-diff-mod-well);
}
.code :deep(.r.g-del .n::after),
.code :deep(.r.g-del-end .n::after) {
  content: '';
  position: absolute;
  right: 0;
  top: -4px;
  border-block: 4px solid transparent;
  border-right: 6px solid var(--ccm-diff-del-well);
}
.code :deep(.r.g-del-end .n::after) {
  top: auto;
  bottom: -4px;
}
.code :deep(.r.p-error .c) {
  text-decoration: underline wavy var(--ccm-error);
  text-decoration-skip-ink: none;
  text-underline-offset: 3px;
}
.code :deep(.r.p-warning .c) {
  text-decoration: underline wavy var(--ccm-warning);
  text-decoration-skip-ink: none;
  text-underline-offset: 3px;
}
.code :deep(.r.is-target) {
  background: color-mix(in srgb, var(--ccm-selection, #3f638b) 45%, transparent);
}
.code :deep(.r.is-target .n) {
  color: var(--ccm-well-ink);
}
.code :deep(.r.is-flash) {
  animation: file-flash 1.2s var(--ease-out-quint, ease-out);
}
.code :deep(mark.ccm-find) {
  border-radius: 2px;
  color: inherit;
  background: color-mix(in srgb, var(--ccm-selection, #3f638b) 70%, transparent);
}
.code :deep(mark.ccm-find-current) {
  background: var(--ccm-waiting-soft);
  box-shadow: 0 0 0 1px var(--ccm-waiting);
}
.code ::selection,
.code :deep(*)::selection {
  background: var(--ccm-selection, #3f638b);
}
/* Windowed Ctrl/⌘+A: rows outside the DOM cannot hold a real selection, so "all" is painted. */
.code.is-all :deep(.c) {
  background: var(--ccm-selection, #3f638b);
}
@keyframes file-flash {
  from {
    background: var(--ccm-diff-add-soft, rgb(48 209 88 / 0.18));
  }
}
@media (prefers-reduced-motion: reduce) {
  .code :deep(.r.is-flash) {
    animation-duration: 0.01ms;
    background: var(--ccm-diff-add-soft, rgb(48 209 88 / 0.18));
  }
}

/* Rendered Markdown reads as a document on the dark well, same ink as the code view. */
.md {
  color: var(--ccm-well-ink);
  font-size: calc(var(--ccm-code-size, 13px) + 1px);
  line-height: 1.6;
}
.md :deep(h1),
.md :deep(h2),
.md :deep(h3),
.md :deep(h4) {
  margin: 1.2em 0 0.5em;
  font-weight: 650;
  line-height: 1.25;
}
.md :deep(h1) {
  font-size: 1.6em;
}
.md :deep(h2) {
  font-size: 1.3em;
  padding-bottom: 0.25em;
  border-bottom: 1px solid var(--ccm-well-line);
}
.md :deep(h3) {
  font-size: 1.1em;
}
.md :deep(p),
.md :deep(ul),
.md :deep(ol),
.md :deep(pre),
.md :deep(blockquote),
.md :deep(table) {
  margin: 0 0 0.9em;
}
.md :deep(ul) {
  list-style: disc;
  padding-left: 1.4em;
}
.md :deep(ol) {
  list-style: decimal;
  padding-left: 1.6em;
}
.md :deep(a) {
  color: var(--ccm-syn-type, #6bdfff);
  text-decoration: underline;
  text-underline-offset: 2px;
}
.md :deep(code) {
  font-family: var(--font-mono);
  font-size: 0.9em;
  padding: 0.1em 0.35em;
  border-radius: 4px;
  background: var(--ccm-well-line);
}
.md :deep(pre) {
  padding: 0.75em 1em;
  overflow-x: auto;
  border-radius: var(--radius-inner);
  background: var(--ccm-well-line);
}
.md :deep(pre code) {
  padding: 0;
  background: none;
}
.md :deep(blockquote) {
  padding-left: 1em;
  border-left: 3px solid var(--ccm-well-line);
  color: var(--ccm-syn-comment, #7f8c98);
}
.md :deep(hr) {
  margin: 1.5em 0;
  border: 0;
  border-top: 1px solid var(--ccm-well-line);
}
.md :deep(table) {
  border-collapse: collapse;
  display: block;
  overflow-x: auto;
}
.md :deep(th),
.md :deep(td) {
  padding: 0.35em 0.75em;
  border: 1px solid var(--ccm-well-line);
}
.md :deep(.md-img) {
  font-style: italic;
  color: var(--ccm-syn-comment, #7f8c98);
}
.md :deep(::selection) {
  background: var(--ccm-selection, #3f638b);
}
</style>
