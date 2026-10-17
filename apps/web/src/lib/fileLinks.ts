import type { IBufferCell, IBufferRange, ILink, ILinkProvider, Terminal } from '@xterm/xterm'

export type LinkTarget = { kind: 'url'; url: string } | { kind: 'file'; path: string; line?: number; col?: number }

export interface FoundLink {
  start: number
  end: number
  text: string
  /** File paths keep their written form here; `resolveLink` makes them absolute. */
  target: LinkTarget
}

// Bare names (no folder) only count with an extension from this list, so "example.com" or "e.g." stay text.
const KNOWN_EXT = new Set(
  'html htm css scss sass less js mjs cjs jsx ts mts cts tsx vue svelte astro json jsonc json5 yaml yml toml ini env xml svg md mdx txt log csv sql sh bash zsh ps1 bat cmd py rb go rs java kt kts swift c h cc cpp hpp cs php lua dart gradle properties lock dockerfile makefile png jpg jpeg gif webp ico pdf'.split(' '),
)

const PATH_CHARS = String.raw`[^\s"'<>|*?:;,()\[\]{}\`]+`
const LINK_RE = new RegExp(
  [
    String.raw`(https?:\/\/[^\s"'<>\`\u2500-\u257f]+)`,
    String.raw`(file:\/\/[^\s"'<>\`]+)`,
    String.raw`((?:(?<!\w)[A-Za-z]:[\\/]|(?<![\w.~/\\:-])\/|(?<![\w/\\:.@-]))${PATH_CHARS})(?::(\d+)(?::(\d+))?|\((\d+)(?:,\s?(\d+))?\))?`,
  ].join('|'),
  'g',
)

const isAbsolute = (p: string): boolean => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/')

function fileTarget(raw: string, line?: string, col?: string): { path: string; line?: number; col?: number } | null {
  const path = raw.replace(/\.+$/, '')
  if (!path || /^\.+$/.test(path) || path.includes('//')) return null
  const base = path.split(/[\\/]/).pop() ?? ''
  const ext = /\.([A-Za-z][A-Za-z0-9]{0,9})$/.exec(base)?.[1]?.toLowerCase()
  const lineNo = line ? Number(line) : undefined
  if (isAbsolute(path)) {
    if (!ext && lineNo === undefined) return null
    if (path.length < 3) return null
  } else {
    if (!ext) return null
    const hasDir = /[\\/]/.test(path)
    if (!hasDir && !KNOWN_EXT.has(ext)) return null
  }
  return { path, line: lineNo || undefined, col: col ? Number(col) || undefined : undefined }
}

const trimUrl = (url: string): string => {
  let out = url.replace(/[.,;:!?'"]+$/, '')
  if (out.endsWith(')') && !out.includes('(')) out = out.slice(0, -1)
  return out
}

/** Paths and local URLs in one line of terminal text, left to right, non-overlapping. */
export function findLinks(text: string): FoundLink[] {
  const out: FoundLink[] = []
  for (const m of text.matchAll(LINK_RE)) {
    const start = m.index ?? 0
    if (m[1]) {
      const url = trimUrl(m[1])
      out.push({ start, end: start + url.length, text: url, target: { kind: 'url', url } })
    } else if (m[2]) {
      const raw = trimUrl(m[2])
      const path = fileUrlToPath(raw)
      if (path) out.push({ start, end: start + raw.length, text: raw, target: { kind: 'file', path } })
    } else if (m[3]) {
      const line = m[4] ?? m[6]
      const col = m[5] ?? m[7]
      const target = fileTarget(m[3], line, col)
      if (!target) continue
      // Underline the suffix too only when it was parsed as a line number.
      const length = target.line !== undefined ? m[0].length : target.path.length
      out.push({ start, end: start + length, text: text.slice(start, start + length), target: { kind: 'file', ...target } })
    }
  }
  return out
}

export function fileUrlToPath(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'file:') return null
    const path = decodeURIComponent(parsed.pathname)
    if (parsed.host) return `//${parsed.host}${path}`
    return /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path
  } catch {
    return null
  }
}

/** Joins `rel` onto `cwd` with the cwd's separator, folding "." and "..". */
export function joinPath(cwd: string, rel: string): string {
  const sep = cwd.includes('\\') || /^[A-Za-z]:/.test(cwd) ? '\\' : '/'
  const drive = /^[A-Za-z]:/.exec(cwd)?.[0] ?? ''
  const parts = [...cwd.slice(drive.length).split(/[\\/]/), ...rel.split(/[\\/]/)]
  const stack: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return `${drive}${sep}${stack.join(sep)}`
}

export function resolveLink(link: FoundLink, cwd: string | undefined): LinkTarget | null {
  const t = link.target
  if (t.kind === 'url') return t
  if (isAbsolute(t.path) || t.path.startsWith('//')) return t
  if (!cwd) return null
  return { ...t, path: joinPath(cwd, t.path) }
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

export function isLoopbackUrl(url: string): boolean {
  try {
    return LOOPBACK.has(new URL(url).hostname)
  } catch {
    return false
  }
}

/** OSC 8 payload is `params;uri`; an empty uri closes the link. */
export function oscLinkUri(data: string): string | null {
  const i = data.indexOf(';')
  return i < 0 ? null : data.slice(i + 1) || null
}

// Spaces and box-drawing borders (│ ╭ ─) a CLI draws around wrapped text; never part of a link.
const DECOR_END = /[\s\u2500-\u257f]+$/
const DECOR_START = /^[\s\u2500-\u257f]+/
const URL_CHARS = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/
const URL_START = /https?:\/\//i

/** Breaks a link may sit across: (text before, text after, break index) → join? */
export type JoinTest = (before: string, after: string, index: number) => boolean

/** Join where both sides belong to one of `uris` (the OSC 8 links the program printed). */
export const inLinks =
  (uris: Iterable<string>): JoinTest =>
  (before, after) => {
    for (const u of uris) if (u.includes(before + after)) return true
    return false
  }

/** Drops the line breaks (and indent / borders) a CLI put inside a link when it wrapped it to its own width. */
export function joinWrappedLinks(selection: string, join: JoinTest): string {
  const parts = selection.split(/(\r?\n)/)
  let out = ''
  let line = parts[0] ?? ''
  for (let i = 1; i < parts.length; i += 2) {
    const head = line.replace(DECOR_END, '')
    const rest = parts[i + 1]!.replace(DECOR_START, '')
    const before = /\S*$/.exec(head)![0]
    const after = /^\S*/.exec(rest)![0]
    if (before && after && join(before, after, (i - 1) / 2)) line = head + rest
    else {
      out += line + parts[i]
      line = parts[i + 1]!
    }
  }
  return out + line
}

export interface RowInfo {
  text: string
  /** Column just after the last cell that is not a space or a border. */
  end: number
  /** xterm soft-wrapped this row onto the one above. */
  wrapped: boolean
}

export type Rows = (y: number) => RowInfo | undefined

// CLIs wrap a little short of the edge (right padding, a box border).
const WRAP_SLACK = 8
const MAX_URL_ROWS = 64

const trailingRun = (row: RowInfo): string => /\S*$/.exec(row.text.replace(DECOR_END, ''))![0]
const leadingRun = (row: RowInfo): string => /^\S*/.exec(row.text.replace(DECOR_START, ''))![0]

/** Row `y` is filled to the edge with URL characters and row `y + 1` carries on with more of them. */
function cutAtEdge(rows: Rows, y: number, cols: number): boolean {
  const a = rows(y)
  const b = rows(y + 1)
  if (!a || !b || b.wrapped || a.end < cols - WRAP_SLACK) return false
  const run = trailingRun(a)
  const next = leadingRun(b)
  return !!run && !!next && URL_CHARS.test(run) && URL_CHARS.test(next) && !URL_START.test(next.slice(0, 8))
}

/** The URL characters ending row `y` belong to a URL whose `http(s)://` is on this row or the rows above. */
function urlStartsAbove(rows: Rows, y: number, cols: number, depth = 0): boolean {
  const row = rows(y)
  if (!row || depth > MAX_URL_ROWS) return false
  const run = trailingRun(row)
  if (!run || !URL_CHARS.test(run)) return false
  if (URL_START.test(run)) return true
  // Only a row that is all URL can continue one from above.
  if (run !== row.text.replace(DECOR_START, '').replace(DECOR_END, '')) return false
  if (row.wrapped) return urlStartsAbove(rows, y - 1, cols, depth + 1)
  return cutAtEdge(rows, y - 1, cols) && urlStartsAbove(rows, y - 1, cols, depth + 1)
}

/** A plain-text URL runs on past the hard line break after row `y` (the CLI wrapped it itself, no OSC 8). */
export function breaksInsideUrl(rows: Rows, y: number, cols: number): boolean {
  return cutAtEdge(rows, y, cols) && urlStartsAbove(rows, y, cols)
}

const isDecor = (chars: string): boolean => !chars || /^[\s\u2500-\u257f]+$/.test(chars)

/** Buffer rows of `term` for `breaksInsideUrl`, read once each. */
export function bufferRows(term: Terminal): Rows {
  const buf = term.buffer.active
  const seen = new Map<number, RowInfo | undefined>()
  let cell: IBufferCell | undefined
  return (y) => {
    if (seen.has(y)) return seen.get(y)
    const line = y >= 0 ? buf.getLine(y) : undefined
    let info: RowInfo | undefined
    if (line) {
      let end = 0
      for (let x = line.length - 1; x >= 0; x--) {
        cell = line.getCell(x, cell)
        if (cell && !isDecor(cell.getChars())) {
          end = x + cell.getWidth()
          break
        }
      }
      info = { text: line.translateToString(true), end, wrapped: line.isWrapped }
    }
    seen.set(y, info)
    return info
  }
}

/** The selection with links put back together, whether printed as OSC 8 (`oscUris`) or as plain text. */
export function selectionText(term: Terminal, oscUris: Iterable<string>): string {
  const text = term.getSelection()
  const pos = term.getSelectionPosition()
  if (!pos) return text
  // Last buffer row of each selected line (xterm joins soft-wrapped rows itself; 0-based rows).
  const buf = term.buffer.active
  const lineEnds: number[] = []
  for (let y = pos.start.y + 1; y <= pos.end.y; y++) if (!buf.getLine(y)?.isWrapped) lineEnds.push(y - 1)
  const rows = bufferRows(term)
  const osc = inLinks(oscUris)
  return joinWrappedLinks(text, (before, after, i) => osc(before, after, i) || (lineEnds[i] !== undefined && breaksInsideUrl(rows, lineEnds[i]!, term.cols)))
}

export interface LinkOpenOptions {
  line?: number
  col?: number
  /** Shift held: open an .html path as source instead of in the browser. */
  shift: boolean
}

export interface FileLinkProviderOptions {
  cwd: () => string | undefined
  isMac: boolean
  onOpen: (target: LinkTarget, opts: LinkOpenOptions) => void
  onHover?: (target: LinkTarget, event: MouseEvent) => void
  onLeave?: () => void
}

interface LogicalLine {
  text: string
  /** Buffer cell (0-based x, y) of each UTF-16 unit in `text`. */
  cells: Array<{ x: number; y: number }>
}

function logicalLine(term: Terminal, row: number): LogicalLine {
  const buf = term.buffer.active
  const rows = bufferRows(term)
  // Soft wraps (xterm) and hard breaks a CLI put inside a URL (`breaksInsideUrl`) both continue the line.
  const joinsAbove = (y: number): boolean => !!buf.getLine(y)?.isWrapped || breaksInsideUrl(rows, y - 1, term.cols)
  let first = row
  while (first > 0 && row - first < MAX_URL_ROWS && joinsAbove(first)) first--
  let last = row
  while (last - row < MAX_URL_ROWS && buf.getLine(last + 1) && joinsAbove(last + 1)) last++
  let text = ''
  const cells: LogicalLine['cells'] = []
  let cell: IBufferCell | undefined
  for (let y = first; y <= last; y++) {
    const line = buf.getLine(y)
    if (!line) break
    // Across a hard break, the indent / border cells on either side are not part of the text.
    const hardAbove = y > first && !line.isWrapped
    const hardBelow = y < last && !buf.getLine(y + 1)?.isWrapped
    let from = 0
    let to = line.length
    if (hardAbove) while (from < to && isDecor((cell = line.getCell(from, cell))?.getChars() ?? '')) from++
    if (hardBelow) while (to > from && isDecor((cell = line.getCell(to - 1, cell))?.getChars() ?? '')) to--
    for (let x = from; x < to; x++) {
      cell = line.getCell(x, cell)
      if (!cell || cell.getWidth() === 0) continue
      const chars = cell.getChars() || ' '
      for (let k = 0; k < chars.length; k++) cells.push({ x, y })
      text += chars
    }
  }
  return { text, cells }
}

/** xterm link provider: Ctrl+click (⌘ on macOS) opens paths / local URLs printed in the terminal. */
export function createFileLinkProvider(term: Terminal, opts: FileLinkProviderOptions): ILinkProvider {
  return {
    provideLinks(lineNumber, callback) {
      const row = lineNumber - 1
      const { text, cells } = logicalLine(term, row)
      const links: ILink[] = []
      for (const found of findLinks(text)) {
        const a = cells[found.start]
        const b = cells[found.end - 1]
        if (!a || !b || a.y > row || b.y < row) continue
        const range: IBufferRange = { start: { x: a.x + 1, y: a.y + 1 }, end: { x: b.x + 1, y: b.y + 1 } }
        links.push({
          range,
          text: found.text,
          decorations: { pointerCursor: true, underline: true },
          activate: (event) => {
            if (!(opts.isMac ? event.metaKey : event.ctrlKey)) return
            const target = resolveLink(found, opts.cwd())
            if (!target) return
            const line = target.kind === 'file' ? target.line : undefined
            const col = target.kind === 'file' ? target.col : undefined
            opts.onOpen(target, { line, col, shift: event.shiftKey })
          },
          hover: (event) => {
            const target = resolveLink(found, opts.cwd())
            if (target) opts.onHover?.(target, event)
          },
          leave: () => opts.onLeave?.(),
        })
      }
      callback(links.length ? links : undefined)
    },
  }
}
