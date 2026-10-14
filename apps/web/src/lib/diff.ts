export type DiffLineType = 'ctx' | 'add' | 'del' | 'note'

export interface DiffLine {
  type: DiffLineType
  /** Content without the +/-/space prefix and without a trailing CR. */
  text: string
  /** Exact patch line (prefix and CR kept) — what a reverse patch is rebuilt from. */
  raw: string
  old?: number
  new?: number
}

export interface DiffHunk {
  header: string
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  /** Function / section name git prints after the second @@. */
  section: string
  lines: DiffLine[]
}

export interface DiffFile {
  oldPath: string | null
  newPath: string | null
  /** newPath, or oldPath for a deletion. */
  path: string
  binary: boolean
  isNew: boolean
  isDeleted: boolean
  isRename: boolean
  hunks: DiffHunk[]
  added: number
  removed: number
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/

function stripPrefix(p: string): string | null {
  const s = p.replace(/\t.*$/, '').replace(/\r$/, '')
  if (s === '/dev/null') return null
  return s.replace(/^"(.*)"$/, '$1').replace(/^[ab]\//, '')
}

function emptyFile(): DiffFile {
  return { oldPath: null, newPath: null, path: '', binary: false, isNew: false, isDeleted: false, isRename: false, hunks: [], added: 0, removed: 0 }
}

/** git unified diff → files / hunks / lines with old and new line numbers. */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = []
  let file: DiffFile | null = null
  let hunk: DiffHunk | null = null
  let oldNo = 0
  let newNo = 0
  let oldLeft = 0
  let newLeft = 0
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()

  const finish = (): void => {
    if (!file) return
    file.path = file.newPath ?? file.oldPath ?? ''
    files.push(file)
  }

  for (const raw of lines) {
    const inHunk = hunk && (oldLeft > 0 || newLeft > 0)
    if (inHunk && (raw[0] === ' ' || raw[0] === '+' || raw[0] === '-' || raw === '' || raw === '\r')) {
      const c = raw[0] ?? ' '
      const text = raw.slice(1).replace(/\r$/, '')
      if (c === '+') {
        hunk!.lines.push({ type: 'add', text, raw, new: newNo++ })
        newLeft--
        file!.added++
      } else if (c === '-') {
        hunk!.lines.push({ type: 'del', text, raw, old: oldNo++ })
        oldLeft--
        file!.removed++
      } else {
        // An empty line inside a hunk is a context line whose leading space was stripped by an editor/transport.
        hunk!.lines.push({ type: 'ctx', text, raw: raw[0] === ' ' ? raw : ` ${raw}`, old: oldNo++, new: newNo++ })
        oldLeft--
        newLeft--
      }
      continue
    }
    if (raw.startsWith('\\')) {
      hunk?.lines.push({ type: 'note', text: raw.slice(2).replace(/\r$/, ''), raw })
      continue
    }
    if (raw.startsWith('diff --git ')) {
      finish()
      file = emptyFile()
      hunk = null
      const m = /^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)\r?$/.exec(raw)
      if (m) {
        file.oldPath = m[1]!
        file.newPath = m[2]!
      }
      continue
    }
    if (!file) {
      if (!raw.startsWith('--- ')) continue
      file = emptyFile()
    }
    const h = HUNK.exec(raw.replace(/\r$/, ''))
    if (h) {
      hunk = {
        header: raw.replace(/\r$/, ''),
        oldStart: Number(h[1]),
        oldCount: h[2] === undefined ? 1 : Number(h[2]),
        newStart: Number(h[3]),
        newCount: h[4] === undefined ? 1 : Number(h[4]),
        section: h[5] ?? '',
        lines: [],
      }
      file.hunks.push(hunk)
      oldNo = hunk.oldStart
      newNo = hunk.newStart
      oldLeft = hunk.oldCount
      newLeft = hunk.newCount
      continue
    }
    if (raw.startsWith('--- ')) {
      file.oldPath = stripPrefix(raw.slice(4))
      if (file.oldPath === null) file.isNew = true
    } else if (raw.startsWith('+++ ')) {
      file.newPath = stripPrefix(raw.slice(4))
      if (file.newPath === null) file.isDeleted = true
    } else if (raw.startsWith('new file mode')) file.isNew = true
    else if (raw.startsWith('deleted file mode')) file.isDeleted = true
    else if (raw.startsWith('rename from ')) {
      file.isRename = true
      file.oldPath = raw.slice(12).replace(/\r$/, '')
    } else if (raw.startsWith('rename to ')) {
      file.isRename = true
      file.newPath = raw.slice(10).replace(/\r$/, '')
    } else if (raw.startsWith('Binary files ') || raw.startsWith('GIT binary patch')) file.binary = true
  }
  finish()
  for (const f of files) {
    if (f.isNew) f.oldPath = null
    if (f.isDeleted) f.newPath = null
    f.path = f.newPath ?? f.oldPath ?? ''
  }
  return files
}

/** Stand-alone patch holding only `hunk`, for `git apply -R` (the desktop re-heads it to the real path anyway). */
export function hunkPatch(file: DiffFile, hunk: DiffHunk): string {
  const a = file.oldPath ?? file.path
  const b = file.newPath ?? file.path
  return [`diff --git a/${a} b/${b}`, `--- a/${a}`, `+++ b/${b}`, hunk.header, ...hunk.lines.map((l) => l.raw), ''].join('\n')
}

/** New-side line to open the file at: first added line, else the first hunk start. */
export function firstChangedLine(file: DiffFile): number | undefined {
  for (const h of file.hunks) {
    const add = h.lines.find((l) => l.type === 'add')
    if (add?.new) return add.new
  }
  const h = file.hunks[0]
  return h ? Math.max(1, h.newStart) : undefined
}

export interface SideRow {
  left?: DiffLine
  right?: DiffLine
}

/** Pairs each run of deletions with the additions that follow it (GitHub-style split view). */
export function sideBySide(hunk: DiffHunk): SideRow[] {
  const rows: SideRow[] = []
  let dels: DiffLine[] = []
  let adds: DiffLine[] = []
  const flush = (): void => {
    const n = Math.max(dels.length, adds.length)
    for (let i = 0; i < n; i++) rows.push({ left: dels[i], right: adds[i] })
    dels = []
    adds = []
  }
  for (const line of hunk.lines) {
    if (line.type === 'del') {
      if (adds.length) flush()
      dels.push(line)
    } else if (line.type === 'add') adds.push(line)
    else {
      flush()
      if (line.type === 'ctx') rows.push({ left: line, right: line })
    }
  }
  flush()
  return rows
}
