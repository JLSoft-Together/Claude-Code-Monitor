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
const FILE = /(?:^|\s)@("[^"\n]+"|[^\s"@]+)(\S*)/g
/** `@file:line:col` points at a place in a file (Run pane "Send to agent", lib/runUi.ts errorPrompt), not an attachment. */
const LINE_COL = /:\d+(?::\d+)?$/
const placeMention = (m: RegExpMatchArray): boolean => (m[1]!.startsWith('"') ? /^:\d+(?::\d+)?$/.test(m[2]!) : LINE_COL.test(m[1]!))
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

export interface Cell {
  x: number
  y: number
}

/**
 * Where the agent's input caret is. Claude Code 2.1.294 parks the terminal cursor on it, but an Ink app may instead
 * hide the cursor and draw its caret as one inverse cell, leaving the cursor where its last frame ended. So: the one inverse cell inside
 * the box when there is exactly one (and the cursor, if also inside, agrees), else the cursor when it is inside the
 * box and no inverse cell is, else null (unsure: nothing gets typed).
 */
export function promptCaret(rows: string[], cursor: Cell, inverse: Cell[] = []): Cell | null {
  const range = findPromptRange(rows)
  if (!range) return null
  const inBox = (c: Cell): boolean => c.y >= range[0] && c.y < range[1]
  const marks = inverse.filter(inBox)
  if (marks.length > 1) return null
  const cursorIn = inBox(cursor)
  if (marks.length === 1) return !cursorIn || (cursor.x === marks[0]!.x && cursor.y === marks[0]!.y) ? marks[0]! : null
  return cursorIn ? cursor : null
}

export function findPromptRows(rows: string[]): string[] | null {
  const range = findPromptRange(rows)
  return range ? rows.slice(range[0], range[1]) : null
}

/**
 * Characters known to take one cell and one UTF-16 unit, so a cursor cell equals a string index (xterm draws ambiguous
 * widths narrow). Anything else (wide CJK / emoji, zero-width, combining marks) makes the row before the cursor unsafe:
 * ASCII, Latin incl. precomposed Vietnamese, Greek, Cyrillic, punctuation, arrows, box drawing and the `❯` prompt.
 */
const NARROW = /^[\x20-\x7e -¬®-˿Ͱ-҂Ҋ-ԯḀ-῿‐-‧‰-⁞₠-₿←-⇿─-╿❯]*$/

export interface EraseKeys {
  /** ← presses from the cursor to just after the token (and the space typed after it). */
  left: number
  /** Backspaces: one per character of a mention, one for a whole `[Image #N]`, plus that space. */
  back: number
  /** → presses back to where the cursor was. */
  right: number
}

// translateToString(true) trims trailing spaces; the cursor cell says how many were typed.
const cursorHead = (rows: string[], cursor: { x: number; y: number }): string => (rows[cursor.y] ?? '').padEnd(cursor.x).slice(0, cursor.x)

/**
 * Keys that erase `token` when it sits before the cursor on the cursor's row of the prompt. Claude Code drops a
 * whole `[Image #N]` on one Backspace (§11p). null = not safe: another row (soft wrap and typed newline look the
 * same on screen), after the cursor, only a partial match (also one running on past the cursor), or characters of uncertain width before the cursor.
 */
export function eraseKeys(rows: string[], cursor: { x: number; y: number }, token: string): EraseKeys | null {
  const range = findPromptRange(rows)
  if (!range || cursor.y < range[0] || cursor.y >= range[1]) return null
  const head = cursorHead(rows, cursor)
  if (!NARROW.test(head)) return null
  // `after` reads the full row: a match ending at the cursor may be the front half of a longer mention (`@foo|bar`).
  const row = rows[cursor.y] ?? ''
  const image = token.startsWith('[Image #')
  let at = head.lastIndexOf(token)
  while (at >= 0) {
    const before = head[at - 1]
    const after = at + token.length < head.length ? head[at + token.length] : row[at + token.length]
    // An image placeholder may touch text (the agent types it without a space); a mention starts a word.
    if ((image || at === 0 || /\s/.test(before!)) && (after === undefined || /\s/.test(after))) break
    at = at > 0 ? head.lastIndexOf(token, at - 1) : -1
  }
  if (at < 0) return null
  const end = at + token.length + (head[at + token.length] === ' ' ? 1 : 0)
  const left = cursor.x - end
  return { left, back: end - at - token.length + (image ? 1 : token.length), right: left }
}

/** The `@mention` ending exactly at the cursor (still being typed, or being erased), else null. */
export function cursorToken(rows: string[], cursor: { x: number; y: number }): string | null {
  return /(?:^|\s)(@(?:"[^"\n]+"|[^\s"@]+))$/.exec(cursorHead(rows, cursor))?.[1] ?? null
}

/** The cell left of the cursor holds text (e.g. `[Image #1]` the agent typed without a space): a mention needs one first. */
export function needsLeadSpace(rows: string[], cursor: { x: number; y: number }): boolean {
  const ch = cursor.x > 0 ? rows[cursor.y]?.[cursor.x - 1] : undefined
  return !!ch && !/\s/.test(ch)
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
  const files = [...new Set([...text.matchAll(FILE)].filter((m) => !placeMention(m)).map((m) => `@${m[1]}`))]
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

