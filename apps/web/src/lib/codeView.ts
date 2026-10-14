export interface CodeToken {
  content: string
  color?: string
  /** shiki FontStyle bits: 1 italic, 2 bold, 4 underline. */
  fontStyle?: number
}

export interface Match {
  line: number
  start: number
  end: number
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ESCAPES[c]!)

const EXT_LANG: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  vue: 'vue', svelte: 'svelte', astro: 'astro',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
  json: 'json', map: 'json', jsonc: 'jsonc', json5: 'jsonc',
  md: 'markdown', mdx: 'markdown', yml: 'yaml', yaml: 'yaml', toml: 'toml',
  py: 'python', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', kts: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php', rb: 'ruby',
  sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript', ps1: 'powershell', psm1: 'powershell', bat: 'bat', cmd: 'bat',
  sql: 'sql', xml: 'xml', svg: 'xml', plist: 'xml', dockerfile: 'dockerfile', makefile: 'makefile',
  ini: 'ini', env: 'ini', properties: 'ini', lua: 'lua', dart: 'dart', diff: 'diff', patch: 'diff', gradle: 'groovy', groovy: 'groovy',
}

/** shiki grammar id for a file, from the desktop `lang` (extension) or the path. */
export function grammarFor(lang: string | undefined, path = ''): string | null {
  const key = (lang ?? path.split(/[\\/]/).pop()?.toLowerCase().split('.').pop() ?? '').toLowerCase()
  return EXT_LANG[key] ?? null
}

export const isMarkdown = (path: string): boolean => /\.(md|mdx|markdown)$/i.test(path)

export const splitLines = (text: string): string[] => text.split(/\r\n|\r|\n/)

/** Case-insensitive literal search; capped so a one-letter query on a big file stays cheap. */
export function findMatches(lines: readonly string[], query: string, limit = 5000): Match[] {
  if (!query) return []
  const q = query.toLowerCase()
  const out: Match[] = []
  for (let line = 0; line < lines.length && out.length < limit; line++) {
    const hay = lines[line]!.toLowerCase()
    let at = hay.indexOf(q)
    while (at !== -1 && out.length < limit) {
      out.push({ line, start: at, end: at + q.length })
      at = hay.indexOf(q, at + q.length)
    }
  }
  return out
}

function tokenStyle(token: CodeToken): string {
  const parts: string[] = []
  // Only theme variables reach the DOM: the css-variables theme never yields raw colours.
  if (token.color?.startsWith('var(')) parts.push(`color:${token.color}`)
  const fs = token.fontStyle ?? 0
  if (fs & 1) parts.push('font-style:italic')
  if (fs & 2) parts.push('font-weight:600')
  if (fs & 4) parts.push('text-decoration:underline')
  return parts.join(';')
}

/** One line of escaped HTML; `marks` (sorted, non-overlapping, columns in this line) wrap find hits. */
export function renderLine(tokens: readonly CodeToken[], marks: ReadonlyArray<{ start: number; end: number; current?: boolean }> = []): string {
  let html = ''
  let col = 0
  let mi = 0
  let open = false
  for (const token of tokens) {
    const style = tokenStyle(token)
    let rest = token.content
    while (rest) {
      const mark = marks[mi]
      let take = rest.length
      if (mark) {
        if (!open && col < mark.start) take = Math.min(take, mark.start - col)
        else if (!open && col >= mark.start) {
          html += mark.current ? '<mark class="ccm-find ccm-find-current">' : '<mark class="ccm-find">'
          open = true
        }
        if (open) take = Math.min(take, mark.end - col)
      }
      const text = escapeHtml(rest.slice(0, take))
      html += style ? `<span style="${style}">${text}</span>` : text
      rest = rest.slice(take)
      col += take
      if (open && mark && col >= mark.end) {
        html += '</mark>'
        open = false
        mi++
      }
    }
  }
  if (open) html += '</mark>'
  return html
}

/** Lines of `next` that differ from `prev`, by common prefix / suffix only (cheap, good enough to flash edits). */
export function changedLines(prev: readonly string[], next: readonly string[]): number[] {
  let head = 0
  const max = Math.min(prev.length, next.length)
  while (head < max && prev[head] === next[head]) head++
  if (head === prev.length && head === next.length) return []
  let tail = 0
  while (tail < max - head && prev[prev.length - 1 - tail] === next[next.length - 1 - tail]) tail++
  const out: number[] = []
  for (let i = head; i < next.length - tail; i++) out.push(i)
  // Pure deletion: flash the line that now sits where the removed block was.
  if (!out.length && head < next.length) out.push(head)
  return out
}
