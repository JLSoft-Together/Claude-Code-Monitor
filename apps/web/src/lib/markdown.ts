import { escapeHtml } from './codeView'

/**
 * Small Markdown → HTML for the file viewer. Every input character is escaped before any tag is added,
 * so raw HTML in the file shows as text; links keep only http(s), #anchors and plain relative paths.
 */

const safeHref = (href: string): string | null => {
  if (/^https?:\/\//i.test(href) || href.startsWith('#')) return href
  // relative path: no scheme before the first slash
  return /^[\w.~/-][^:]*$/.test(href) && !href.startsWith('//') ? href : null
}

function inline(src: string): string {
  const codes: string[] = []
  let s = src.replace(/`([^`]+)`/g, (_m, code: string) => `\u0000${codes.push(`<code>${escapeHtml(code)}</code>`) - 1}\u0000`)
  s = escapeHtml(s)
  // Images are not fetched from the page; their alt text stands in.
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_m, alt: string) => `<span class="md-img">${alt || 'image'}</span>`)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_m, text: string, href: string) => {
    const url = safeHref(href.replace(/&amp;/g, '&'))
    return url ? `<a href="${escapeHtml(url)}">${text}</a>` : text
  })
  s = s.replace(/&lt;(https?:\/\/[^\s&]+)&gt;/g, (_m, url: string) => `<a href="${url}">${url}</a>`)
  s = s.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_m, a?: string, b?: string) => `<strong>${a ?? b}</strong>`)
  s = s.replace(/(^|[^\w*])\*([^*\s][^*]*)\*(?!\w)|(^|[^\w])_([^_\s][^_]*)_(?!\w)/g, (_m, p1?: string, a?: string, p2?: string, b?: string) => `${p1 ?? p2 ?? ''}<em>${a ?? b}</em>`)
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codes[Number(i)] ?? '')
}

const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+-]*)/

function cells(row: string): string[] {
  return row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
}

function list(lines: string[], start: number): { html: string; next: number } {
  const first = LIST_RE.exec(lines[start]!)!
  const indent = first[1]!.length
  const ordered = /\d/.test(first[2]!)
  const items: string[] = []
  let i = start
  while (i < lines.length) {
    const m = LIST_RE.exec(lines[i]!)
    if (!m || m[1]!.length !== indent) break
    const body: string[] = [m[3]!]
    i++
    while (i < lines.length && lines[i]!.trim() && (!LIST_RE.exec(lines[i]!) || LIST_RE.exec(lines[i]!)![1]!.length > indent)) {
      body.push(lines[i]!.slice(Math.min(indent + 2, lines[i]!.length - lines[i]!.trimStart().length)))
      i++
    }
    const [head = '', ...rest] = body
    const task = /^\[([ xX])\]\s+(.*)$/.exec(head)
    const label = task ? `<span class="md-task" aria-hidden="true">${task[1] === ' ' ? '☐' : '☑'}</span> ${inline(task[2]!)}` : inline(head)
    items.push(`<li>${label}${rest.length ? blocks(rest) : ''}</li>`)
  }
  const tag = ordered ? 'ol' : 'ul'
  return { html: `<${tag}>${items.join('')}</${tag}>`, next: i }
}

function blocks(lines: string[], sourceLines = false): string {
  let html = ''
  let i = 0
  let mark = 0
  let start = 0
  // Top-level blocks carry their 1-based source line so the split preview can follow the editor.
  const tag = (): void => {
    if (!sourceLines || mark >= html.length) return
    html = html.slice(0, mark) + html.slice(mark).replace(/^<(\w+)/, `<$1 data-src-line="${start + 1}"`)
  }
  while (i < lines.length) {
    tag()
    mark = html.length
    start = i
    const line = lines[i]!
    if (!line.trim()) {
      i++
      continue
    }
    const fence = FENCE_RE.exec(line)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trimStart().startsWith(fence[1]!)) body.push(lines[i++]!)
      i++
      html += `<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`
      continue
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (heading) {
      const level = heading[1]!.length
      html += `<h${level}>${inline(heading[2]!)}</h${level}>`
      i++
      continue
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      html += '<hr>'
      i++
      continue
    }
    if (/^\s{0,3}>/.test(line)) {
      const body: string[] = []
      while (i < lines.length && /^\s{0,3}>/.test(lines[i]!)) body.push(lines[i++]!.replace(/^\s{0,3}>\s?/, ''))
      html += `<blockquote>${blocks(body)}</blockquote>`
      continue
    }
    if (LIST_RE.test(line)) {
      const res = list(lines, i)
      html += res.html
      i = res.next
      continue
    }
    if (line.includes('|') && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1] ?? '')) {
      const head = cells(line)
      const align = cells(lines[i + 1]!).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : ''))
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim()) rows.push(cells(lines[i++]!))
      const cell = (tag: string, text: string, col: number): string =>
        `<${tag}${align[col] ? ` style="text-align:${align[col]}"` : ''}>${inline(text)}</${tag}>`
      html += `<table><thead><tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr></thead><tbody>${rows
        .map((r) => `<tr>${head.map((_c, k) => cell('td', r[k] ?? '', k)).join('')}</tr>`)
        .join('')}</tbody></table>`
      continue
    }
    const para: string[] = []
    while (i < lines.length && lines[i]!.trim() && !FENCE_RE.test(lines[i]!) && !/^\s{0,3}(#{1,6}\s|>)/.test(lines[i]!) && !(para.length && LIST_RE.test(lines[i]!))) {
      para.push(lines[i++]!.trim())
    }
    html += `<p>${inline(para.join(' '))}</p>`
  }
  tag()
  return html
}

export function renderMarkdown(text: string, opts: { sourceLines?: boolean } = {}): string {
  return blocks(text.replace(/\r\n?/g, '\n').split('\n'), opts.sourceLines)
}
