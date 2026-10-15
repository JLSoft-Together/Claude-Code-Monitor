import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

// Only CSS variables: every app theme (style.css / themes.css) restyles the editor without rebuilding it.
const v = (name: string): string => `var(--ccm-${name})`
const faintInk = 'color-mix(in srgb, var(--ccm-well-ink) 50%, var(--ccm-well))'

export const editorTheme: Extension = EditorView.theme({
  '&': { height: '100%', color: v('syn-var'), backgroundColor: v('well'), fontSize: 'var(--ccm-code-size, 13px)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.5', fontVariantLigatures: 'none' },
  '.cm-content': { caretColor: v('accent'), padding: '8px 0' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: v('accent'), borderLeftWidth: '2px' },
  '.cm-selectionBackground, &.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: v('well-selection') },
  '.cm-content ::selection': { backgroundColor: v('well-selection') },
  '.cm-gutters': { backgroundColor: v('well'), color: faintInk, border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { minWidth: '3.5em', padding: '0 1em 0 0', fontVariantNumeric: 'tabular-nums' },
  '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--ccm-well-ink) 6%, transparent)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: v('well-ink') },
  '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': { backgroundColor: 'transparent', outline: '1px solid color-mix(in srgb, var(--ccm-well-ink) 45%, transparent)' },
  '.cm-nonmatchingBracket, &.cm-focused .cm-nonmatchingBracket': { backgroundColor: 'transparent', outline: `1px solid ${v('error')}` },
  '.cm-selectionMatch': { backgroundColor: 'color-mix(in srgb, var(--ccm-well-selection) 55%, transparent)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--ccm-well-selection) 70%, transparent)', borderRadius: '2px' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: v('waiting-soft'), outline: `1px solid ${v('waiting')}` },
  '.cm-specialChar': { color: v('error') },
  '.cm-tooltip': { backgroundColor: v('material-pop'), color: v('ink'), border: `1px solid ${v('line')}` },
  '.cm-changedLine': { backgroundColor: v('diff-add-soft') },
  '.cm-changedText': { backgroundColor: v('diff-add-soft') },
  '.cm-deletedChunk': { backgroundColor: v('diff-del-soft') },
  '.cm-deletedChunk .cm-deletedText': { backgroundColor: v('diff-del-soft') },
  '.cm-insertedLine': { backgroundColor: v('diff-add-soft') },
})

const style = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.self], color: v('syn-keyword') },
  { tag: [t.string, t.special(t.string), t.regexp, t.attributeValue, t.character, t.inserted], color: v('syn-string') },
  { tag: [t.number, t.bool, t.null, t.atom, t.unit, t.constant(t.variableName), t.escape], color: v('syn-number') },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment, t.meta, t.processingInstruction, t.documentMeta], color: v('syn-comment') },
  { tag: [t.typeName, t.className, t.namespace, t.tagName, t.standard(t.tagName), t.annotation, t.labelName], color: v('syn-type') },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName, t.attributeName], color: v('syn-func') },
  { tag: [t.variableName, t.propertyName, t.definition(t.variableName), t.name], color: v('syn-var') },
  { tag: [t.punctuation, t.operator, t.bracket, t.angleBracket, t.separator], color: v('well-ink') },
  { tag: t.heading, color: v('syn-keyword'), fontWeight: '600' },
  { tag: [t.link, t.url], color: v('syn-type'), textDecoration: 'underline' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.deleted, color: v('error') },
  { tag: t.invalid, color: v('error') },
])

export const editorHighlight: Extension = syntaxHighlighting(style)
