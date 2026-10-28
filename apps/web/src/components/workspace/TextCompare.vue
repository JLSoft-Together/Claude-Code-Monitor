<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { MergeView } from '@codemirror/merge'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { editorHighlight, editorTheme } from '../../lib/editor/cmTheme'
import { languageFor } from '../../lib/editor/cmLanguage'

/** Read-only side-by-side diff of two texts (`a` left / old, `b` right / new). */
const props = defineProps<{ a: string; b: string; grammar: string | null; wrap?: boolean }>()

const host = ref<HTMLElement | null>(null)
let view: MergeView | null = null
let seq = 0

const compareTheme = EditorView.theme({
  '&.cm-merge-a .cm-changedLine, &.cm-merge-a .cm-changedText': { backgroundColor: 'var(--ccm-diff-del-soft)' },
  '&.cm-merge-b .cm-changedLine, &.cm-merge-b .cm-changedText': { backgroundColor: 'var(--ccm-diff-add-soft)' },
  '.cm-collapsedLines': { backgroundColor: 'var(--ccm-fill)', color: 'var(--ccm-ink-muted)', fontFamily: 'var(--font-sans)', fontSize: '11px' },
})

function sideExt(lang: Extension): Extension[] {
  return [lineNumbers(), EditorState.readOnly.of(true), EditorView.editable.of(false), editorTheme, editorHighlight, compareTheme, lang, props.wrap ? EditorView.lineWrapping : []]
}

async function build(): Promise<void> {
  const run = ++seq
  const lang = (await languageFor(props.grammar).catch(() => null)) ?? []
  if (run !== seq || !host.value) return
  view?.destroy()
  view = new MergeView({
    parent: host.value,
    a: { doc: props.a, extensions: sideExt(lang) },
    b: { doc: props.b, extensions: sideExt(lang) },
    gutter: true,
    highlightChanges: true,
    collapseUnchanged: { margin: 3, minSize: 6 },
  })
}

onMounted(() => void build())
watch(() => [props.a, props.b, props.grammar, props.wrap], () => void build())
onBeforeUnmount(() => {
  seq++
  view?.destroy()
  view = null
})
</script>

<template>
  <div ref="host" class="ccm-compare ccm-no-liga ccm-scroll min-h-0 min-w-0 flex-1 overflow-auto bg-well" data-code-zoom data-text-compare />
</template>

<style>
.ccm-compare .cm-mergeView {
  min-height: 100%;
}
.ccm-compare .cm-mergeViewEditors {
  min-height: 100%;
}
.ccm-compare .cm-mergeViewEditor + .cm-mergeViewEditor {
  border-left: 1px solid var(--ccm-well-line);
}
</style>
