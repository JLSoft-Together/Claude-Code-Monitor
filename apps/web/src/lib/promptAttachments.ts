/**
 * Reads what an agent's input box currently carries from the terminal screen (docs/claude-code-integration.md §11p).
 * Claude Code draws the prompt between two horizontal rules (or inside a rounded box) at the bottom of the screen;
 * pasted images show as `[Image #N]`, file mentions as `@path` / `@"path with spaces"`. Screen text only: nothing
 * here is sent anywhere, and output above the box (earlier messages echoing the same tokens) is ignored.
 */

export interface PromptScan {
  /** The box was found; when false nothing below is meaningful (other screen, full-screen app, shell). */
  found: boolean
  images: number[]
  files: string[]
  /** Prompt text with box glyphs and the leading `>` stripped, rows joined by "\n". */
  text: string
}

const RULE = /^[\s╭╰├│]*[─━]{8,}[\s╮╯┤│]*$/
const EDGE = /^\s*│ ?|\s*│\s*$/g
const IMAGE = /\[Image #(\d+)\]/g
const FILE = /(?:^|\s)@("[^"\n]+"|[^\s"@]+)/g
/** Rows scanned from the bottom; the box plus the status lines under it fit easily. */
export const SCAN_ROWS = 40

/** Row range [start, end) between the two lowest horizontal rules, or null when there is no input box. */
export function findPromptRange(rows: string[]): [number, number] | null {
  const start = Math.max(0, rows.length - SCAN_ROWS)
  let bottom = -1
  for (let i = rows.length - 1; i >= start; i--) {
    if (!RULE.test(rows[i]!)) continue
    if (bottom < 0) bottom = i
    else return i + 1 < bottom ? [i + 1, bottom] : null
  }
  return null
}

export function findPromptRows(rows: string[]): string[] | null {
  const range = findPromptRange(rows)
  return range ? rows.slice(range[0], range[1]) : null
}

/**
 * Backspaces that erase `token` when it is the last thing in the prompt and the cursor sits right after it
 * (plus the space we typed after it). Claude Code drops a whole `[Image #N]` on one backspace. null = not safe.
 */
export function eraseCount(rows: string[], cursor: { x: number; y: number }, token: string): number | null {
  const range = findPromptRange(rows)
  if (!range) return null
  let last = range[1] - 1
  while (last >= range[0] && !rows[last]!.replace(EDGE, '').trim()) last--
  if (last < range[0] || cursor.y !== last) return null
  const row = rows[last]!.replace(/\s+$/, '')
  if (cursor.x < row.length || !row.endsWith(token)) return null
  return cursor.x - row.length + (token.startsWith('[Image #') ? 1 : token.length)
}

export function scanPrompt(rows: string[]): PromptScan {
  const box = findPromptRows(rows)
  if (!box) return { found: false, images: [], files: [], text: '' }
  const text = box
    .map((r) => r.replace(EDGE, '').replace(/\s+$/, ''))
    .map((r, i) => (i === 0 ? r.replace(/^\s*[>❯]\s?/, '') : r.replace(/^\s{0,2}/, '')))
    .join('\n')
    .replace(/\s+$/, '')
  const images = [...new Set([...text.matchAll(IMAGE)].map((m) => Number(m[1])))]
  const files = [...new Set([...text.matchAll(FILE)].map((m) => `@${m[1]}`))]
  return { found: true, images, files, text }
}

export const imageToken = (n: number): string => `[Image #${n}]`

/** `@path` as typed into the prompt: relative to the pane folder when inside it, quoted when it has spaces. */
export function fileMention(path: string, cwd: string | undefined, win: boolean): string {
  const norm = (p: string) => (win ? p.replace(/\\/g, '/') : p)
  let p = norm(path)
  const base = cwd ? norm(cwd).replace(/\/+$/, '') : ''
  const same = (a: string, b: string) => (win ? a.toLowerCase() === b.toLowerCase() : a === b)
  if (base && p.length > base.length + 1 && same(p.slice(0, base.length), base) && p[base.length] === '/') p = p.slice(base.length + 1)
  return /\s/.test(p) ? `@"${p}"` : `@${p}`
}

/** Shell panes get a plain path: quoted for PowerShell / POSIX shells when needed. */
export function shellPath(path: string, win: boolean): string {
  if (!/[\s'"$`&()|;<>]/.test(path)) return path
  return win ? `'${path.replace(/'/g, "''")}'` : `'${path.replace(/'/g, `'\\''`)}'`
}

const IMAGE_EXT = /\.(png|jpe?g|gif|webp)$/i
export const isImagePath = (path: string): boolean => IMAGE_EXT.test(path)

export function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

