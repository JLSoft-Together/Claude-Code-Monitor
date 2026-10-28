import { RangeSetBuilder, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { cssColor, findColors, fromInputHex, replaceRgb, toInputHex, type ColorMatch } from './colors'

// Minified one-liners would cost a regex pass per frame for no useful swatch.
const MAX_LINE = 2000

let picker: HTMLInputElement | null = null

function closePicker(): void {
  picker?.remove()
  picker = null
}

/** A native colour input under the swatch; each pick rewrites the literal in place (format and alpha kept). */
function openPicker(view: EditorView, match: ColorMatch, anchor: HTMLElement, grammar: string | null): void {
  closePicker()
  const r = anchor.getBoundingClientRect()
  const input = document.createElement('input')
  input.type = 'color'
  input.value = toInputHex(match.color)
  input.tabIndex = -1
  input.setAttribute('aria-hidden', 'true')
  Object.assign(input.style, { position: 'fixed', left: `${r.left}px`, top: `${r.bottom}px`, width: '1px', height: '1px', opacity: '0', border: '0', padding: '0', pointerEvents: 'none' })
  document.body.append(input)
  picker = input
  const from = match.from
  let text = match.text
  input.addEventListener('input', () => {
    const rgb = fromInputHex(input.value)
    if (!rgb || view.state.readOnly || view.state.sliceDoc(from, from + text.length) !== text) return
    const next = replaceRgb(text, rgb, grammar)
    if (next === text) return
    view.dispatch({ changes: { from, to: from + text.length, insert: next }, userEvent: 'input.color' })
    text = next
  })
  input.addEventListener('change', () => picker === input && closePicker())
  try {
    input.showPicker()
  } catch {
    input.click()
  }
}

class SwatchWidget extends WidgetType {
  constructor(
    readonly css: string,
    readonly label: string,
    readonly grammar: string | null,
  ) {
    super()
  }

  override eq(other: SwatchWidget): boolean {
    return other.css === this.css && other.label === this.label
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'cm-color-swatch'
    wrap.title = this.label
    wrap.setAttribute('aria-hidden', 'true')
    const fill = document.createElement('span')
    fill.style.background = this.css
    wrap.append(fill)
    wrap.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const pos = view.posAtDOM(wrap)
      const line = view.state.doc.lineAt(pos)
      const hit = findColors(line.text, this.grammar).find((m) => line.from + m.from === pos)
      if (hit) openPicker(view, { ...hit, from: pos, to: line.from + hit.to }, wrap, this.grammar)
    })
    return wrap
  }

  override ignoreEvent(): boolean {
    return true
  }
}

function build(view: EditorView, grammar: string | null, label: string): DecorationSet {
  const b = new RangeSetBuilder<Decoration>()
  const doc = view.state.doc
  let done = -1
  for (const { from, to } of view.visibleRanges) {
    for (let n = doc.lineAt(from).number; n <= doc.lines; n++) {
      const line = doc.line(n)
      if (line.from > to) break
      if (line.from <= done || line.length > MAX_LINE) continue
      done = line.from
      for (const m of findColors(line.text, grammar)) {
        b.add(line.from + m.from, line.from + m.from, Decoration.widget({ widget: new SwatchWidget(cssColor(m.color), label, grammar), side: -1 }))
      }
    }
  }
  return b.finish()
}

/** Inline swatches before colour literals in the visible lines; click opens the colour picker. */
export function colorSwatches(grammar: string | null, label: string): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = build(view, grammar, label)
      }
      update(u: ViewUpdate): void {
        if (u.docChanged || u.viewportChanged) this.decorations = build(u.view, grammar, label)
      }
      destroy(): void {
        closePicker()
      }
    },
    { decorations: (p) => p.decorations },
  )
}
