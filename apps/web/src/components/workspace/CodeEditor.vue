<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { lintGutter, lintKeymap, setDiagnostics, type Diagnostic } from '@codemirror/lint'
import { unifiedMergeView } from '@codemirror/merge'
import { highlightSelectionMatches, openSearchPanel, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorSelection, EditorState, Text, type Extension } from '@codemirror/state'
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'
import type { BuildError } from '@ccm/shared'
import { editorHighlight, editorTheme } from '../../lib/editor/cmTheme'
import { languageFor } from '../../lib/editor/cmLanguage'
import { isMac } from '../../lib/platform'
import { useSettingsStore } from '../../stores/settings'

const props = withDefaults(
  defineProps<{ doc: string; base?: string | null; grammar: string | null; wrap?: boolean; compare?: string | null; line?: number | null; problems?: readonly BuildError[] | null }>(),
  {
  problems: null,
  base: null,
  wrap: false,
  compare: null,
  line: null,
  },
)
const emit = defineEmits<{
  dirty: [dirty: boolean]
  change: []
  save: []
  cursorLine: [line: number]
}>()

const { t } = useI18n()
const settings = useSettingsStore()
const host = ref<HTMLElement | null>(null)
let view: EditorView | null = null
let baseline: Text | null = null
let dirty = false

const language = new Compartment()
const wrapping = new Compartment()
const merge = new Compartment()
const phrases = new Compartment()

const PHRASES = [
  'Find', 'Replace', 'next', 'previous', 'all', 'match case', 'by word', 'regexp', 'replace', 'replace all', 'close',
  'current match', 'on line', 'replaced $ matches', 'replaced match on line $', 'Go to line', 'go', 'Accept', 'Reject',
] as const

function phraseMap(): Record<string, string> {
  return Object.fromEntries(PHRASES.map((p, i) => [p, t(`editor.cm.p${i}`)]))
}

/** Replace field focused (Ctrl+H / ⌥⌘F); the search panel holds both fields. */
function openReplace(target: EditorView): boolean {
  openSearchPanel(target)
  requestAnimationFrame(() => target.dom.querySelector<HTMLInputElement>('.cm-search input[name=replace]')?.select())
  return true
}

function setDirty(next: boolean): void {
  if (next === dirty) return
  dirty = next
  emit('dirty', next)
}

const mergeExt = (original: string | null): Extension => (original === null ? [] : unifiedMergeView({ original, gutter: true, mergeControls: true }))

function extensions(): Extension[] {
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    lintGutter(),
    search({ top: true }),
    keymap.of([
      { key: 'Mod-s', preventDefault: true, run: () => (emit('save'), true) },
      { key: isMac ? 'Mod-Alt-f' : 'Ctrl-h', preventDefault: true, run: openReplace },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...lintKeymap,
      ...historyKeymap,
      indentWithTab,
    ]),
    editorTheme,
    editorHighlight,
    language.of([]),
    wrapping.of(props.wrap ? EditorView.lineWrapping : []),
    merge.of(mergeExt(props.compare)),
    phrases.of(EditorState.phrases.of(phraseMap())),
    EditorView.contentAttributes.of({ 'aria-label': t('editor.label'), spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) {
        setDirty(!!baseline && !u.state.doc.eq(baseline))
        emit('change')
      }
      if (u.selectionSet || u.docChanged) emit('cursorLine', u.state.doc.lineAt(u.state.selection.main.head).number)
    }),
  ]
}

async function applyLanguage(grammar: string | null): Promise<void> {
  const ext = await languageFor(grammar).catch(() => null)
  if (view && grammar === props.grammar) view.dispatch({ effects: language.reconfigure(ext ?? []) })
}

function diagnostics(state: EditorState, list: readonly BuildError[] | null): Diagnostic[] {
  const doc = state.doc
  const out: Diagnostic[] = []
  for (const e of list ?? []) {
    if (e.line < 1 || e.line > doc.lines) continue
    const l = doc.line(e.line)
    const from = Math.min(l.from + Math.max(0, e.col - 1), l.to)
    const word = /^[\w$.]+/.exec(doc.sliceString(from, l.to))?.[0].length ?? 0
    out.push({ from, to: word ? from + word : l.to, severity: e.severity, message: e.message })
  }
  return out
}

function applyProblems(): void {
  if (view) view.dispatch(setDiagnostics(view.state, diagnostics(view.state, props.problems)))
}

function revealLine(line: number, select = false): void {
  if (!view) return
  const doc = view.state.doc
  const l = doc.line(Math.min(Math.max(1, line), doc.lines))
  view.dispatch({
    selection: select ? EditorSelection.range(l.from, l.to) : EditorSelection.cursor(l.from),
    effects: EditorView.scrollIntoView(l.from, { y: 'center' }),
  })
}

/** Disk text replaces the buffer (reload); scroll and cursor stay where they were as far as the new text allows. */
function setText(text: string): void {
  if (!view) return
  const top = view.scrollDOM.scrollTop
  const head = view.state.selection.main.head
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text }, selection: EditorSelection.cursor(Math.min(head, text.length)) })
  baseline = view.state.doc
  setDirty(false)
  requestAnimationFrame(() => view && (view.scrollDOM.scrollTop = top))
}

defineExpose({
  text: (): string => view?.state.doc.toString() ?? props.doc,
  /** Text just written to disk: the buffer is clean until edited again. */
  markSaved: (saved?: string): void => {
    if (!view) return
    if (saved === undefined || saved === view.state.doc.toString()) baseline = view.state.doc
    setDirty(!!baseline && !view.state.doc.eq(baseline))
  },
  setText,
  revealLine,
  focus: (): void => view?.focus(),
  openFind: (): void => void (view && openSearchPanel(view)),
  /** Selected text, else the word at the cursor. */
  word: (): string => {
    if (!view) return ''
    const sel = view.state.selection.main
    const range = sel.empty ? view.state.wordAt(sel.head) : sel
    return range ? view.state.sliceDoc(range.from, range.to) : ''
  },
})

onMounted(() => {
  if (!host.value) return
  view = new EditorView({ parent: host.value, state: EditorState.create({ doc: props.doc, extensions: extensions() }) })
  // Re-entering edit mode with unsaved text: the baseline is the disk text, so the buffer is dirty at once.
  baseline = props.base === null ? view.state.doc : Text.of(props.base.split(/\r\n|\r|\n/))
  setDirty(!view.state.doc.eq(baseline))
  void applyLanguage(props.grammar)
  applyProblems()
  if (props.line) revealLine(props.line)
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})

watch(
  () => props.grammar,
  (g) => void applyLanguage(g),
)
watch(() => props.problems, applyProblems)
watch(
  () => props.wrap,
  (on) => view?.dispatch({ effects: wrapping.reconfigure(on ? EditorView.lineWrapping : []) }),
)
watch(
  () => props.compare,
  (original) => view?.dispatch({ effects: merge.reconfigure(mergeExt(original)) }),
)
watch(
  () => settings.locale,
  () => view?.dispatch({ effects: phrases.reconfigure(EditorState.phrases.of(phraseMap())) }),
)
// Font family / size come from CSS variables; CodeMirror caches glyph metrics, so re-measure after a change.
watch(
  () => [settings.codeFont, settings.codeFontSize],
  () => void document.fonts.ready.then(() => view?.requestMeasure()),
)
</script>

<template>
  <div ref="host" class="ccm-editor ccm-no-liga min-h-0 min-w-0 flex-1 overflow-hidden" data-code-zoom data-file-editor />
</template>

<style>
/* Check problems: theme tokens instead of @codemirror/lint's fixed colours (one extra class to beat its scoped theme). */
.ccm-editor .cm-content .cm-lintRange-error,
.ccm-editor .cm-content .cm-lintRange-warning {
  background-image: none;
  text-decoration: underline wavy var(--ccm-error);
  text-decoration-skip-ink: none;
  text-underline-offset: 3px;
}
.ccm-editor .cm-content .cm-lintRange-warning {
  text-decoration-color: var(--ccm-warning);
}
.ccm-editor .cm-tooltip.cm-tooltip-lint {
  background: var(--ccm-surface);
  color: var(--ccm-ink);
  font-family: var(--font-sans);
  font-size: 12px;
}
.ccm-editor .cm-tooltip .cm-diagnostic-error {
  border-left-color: var(--ccm-error);
}
.ccm-editor .cm-tooltip .cm-diagnostic-warning {
  border-left-color: var(--ccm-warning);
}
.ccm-editor .cm-gutter .cm-lint-marker-error,
.ccm-editor .cm-gutter .cm-lint-marker-warning {
  content: '';
  display: block;
  width: 0.5em;
  height: 0.5em;
  margin: 0.25em;
  border-radius: 50%;
  background: var(--ccm-error);
}
.ccm-editor .cm-gutter .cm-lint-marker-warning {
  background: var(--ccm-warning);
}
/* Search / replace panel = chrome (material), outside the scoped block because CodeMirror builds it. */
.ccm-editor .cm-panels {
  background: var(--ccm-material);
  backdrop-filter: blur(20px);
  color: var(--ccm-ink);
  font-family: var(--font-sans);
  font-size: 12px;
}
.ccm-editor .cm-panels-top {
  border-bottom: 1px solid var(--ccm-line);
}
.ccm-editor .cm-search {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 6px;
  padding: 6px 28px 6px 8px;
}
.ccm-editor .cm-search br {
  flex-basis: 100%;
  content: '';
}
.ccm-editor .cm-search .cm-textfield {
  height: 24px;
  min-width: 0;
  flex: 1 1 140px;
  padding: 0 6px;
  border: 1px solid var(--ccm-line-strong);
  border-radius: 6px;
  background: var(--ccm-surface);
  color: var(--ccm-ink);
  font: inherit;
}
.ccm-editor .cm-search .cm-textfield:focus-visible {
  outline: 2px solid var(--ccm-focus);
  outline-offset: 0;
}
.ccm-editor .cm-search .cm-button {
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--ccm-line);
  border-radius: 6px;
  background: var(--ccm-fill);
  background-image: none;
  color: var(--ccm-ink);
  font: inherit;
}
.ccm-editor .cm-search .cm-button:hover {
  background: var(--ccm-fill-strong);
}
.ccm-editor .cm-search label {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--ccm-ink-muted);
}
.ccm-editor .cm-search button[name='close'] {
  color: var(--ccm-ink-muted);
  font-size: 16px;
}
.ccm-editor .cm-merge-revert button,
.ccm-editor .cm-chunkButtons button {
  border: 1px solid var(--ccm-line);
  border-radius: 4px;
  background: var(--ccm-surface);
  color: var(--ccm-ink);
  font-family: var(--font-sans);
  font-size: 11px;
}
</style>
