import { joinPath } from './fileLinks'

export interface NoteToken {
  start: number
  end: number
  path: string
  line?: number
}

// `@` not after a word char (so mail addresses stay text); the path needs a `.` or a `/` to count.
const TOKEN = /(?<![\w@])@((?:[A-Za-z]:)?[\w.~\-/\\]+)(?::(\d{1,7}))?(?::\d{1,5})?/g

export function noteTokens(text: string): NoteToken[] {
  const out: NoteToken[] = []
  for (const m of text.matchAll(TOKEN)) {
    let path = m[1]!
    let end = (m.index ?? 0) + m[0].length
    if (!m[2]) {
      const trimmed = path.replace(/[.\-~]+$/, '')
      end -= path.length - trimmed.length
      path = trimmed
    }
    if (!path || !/[./\\]/.test(path) || /^[./\\]+$/.test(path)) continue
    out.push({ start: m.index ?? 0, end, path, line: m[2] ? Number(m[2]) : undefined })
  }
  return out
}

export const isAbsolutePath = (p: string): boolean => /^(?:[A-Za-z]:[\\/]|[\\/])/.test(p)

export const notePathIn = (root: string, path: string): string => (isAbsolutePath(path) ? path : joinPath(root, path))

const SKIP = new Set(['A', 'CODE', 'PRE'])

/** Wraps `@path:line` tokens of the rendered note in links; text inside links and code stays as is. */
export function linkNoteTokens(el: HTMLElement): void {
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    let p = n.parentElement
    let skip = false
    while (p && p !== el) {
      if (SKIP.has(p.tagName)) skip = true
      p = p.parentElement
    }
    if (!skip && n.nodeValue?.includes('@')) nodes.push(n as Text)
  }
  for (const node of nodes) {
    const text = node.nodeValue ?? ''
    const tokens = noteTokens(text)
    if (!tokens.length) continue
    const frag = el.ownerDocument.createDocumentFragment()
    let at = 0
    for (const tok of tokens) {
      if (tok.start > at) frag.append(text.slice(at, tok.start))
      const a = el.ownerDocument.createElement('a')
      a.href = '#'
      a.dataset.notePath = tok.path
      if (tok.line) a.dataset.noteLine = String(tok.line)
      a.textContent = text.slice(tok.start, tok.end)
      frag.append(a)
      at = tok.end
    }
    if (at < text.length) frag.append(text.slice(at))
    node.replaceWith(frag)
  }
}
