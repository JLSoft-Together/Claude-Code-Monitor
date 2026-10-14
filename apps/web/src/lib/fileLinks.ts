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
    String.raw`(https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:[/?#][^\s"'<>\`]*)?)`,
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
  let first = row
  while (first > 0 && buf.getLine(first)?.isWrapped) first--
  let last = row
  while (buf.getLine(last + 1)?.isWrapped) last++
  let text = ''
  const cells: LogicalLine['cells'] = []
  let cell: IBufferCell | undefined
  for (let y = first; y <= last; y++) {
    const line = buf.getLine(y)
    if (!line) break
    for (let x = 0; x < line.length; x++) {
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
