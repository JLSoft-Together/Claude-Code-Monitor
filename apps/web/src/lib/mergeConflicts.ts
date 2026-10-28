export interface ConflictBlock {
  /** 1-based line of the `<<<<<<<` marker. */
  line: number
  oursLabel: string
  theirsLabel: string
  ours: string[]
  base: string[] | null
  theirs: string[]
}

export type Segment = { kind: 'text'; lines: string[] } | { kind: 'conflict'; block: ConflictBlock }
export type Pick = 'ours' | 'theirs' | 'both'

const OPEN = /^<{7}(?: (.*))?$/
const BASE = /^\|{7}(?: .*)?$/
const MID = /^={7}$/
const CLOSE = /^>{7}(?: (.*))?$/

/** Splits a file with git conflict markers (merge and diff3 styles) into plain runs and conflict blocks. */
export function parseConflicts(text: string): { segments: Segment[]; count: number; eol: string } {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r\n|\n/)
  const segments: Segment[] = []
  let plain: string[] = []
  let count = 0
  for (let i = 0; i < lines.length; i++) {
    const open = OPEN.exec(lines[i]!)
    const end = open ? findBlockEnd(lines, i) : -1
    if (!open || end < 0) {
      plain.push(lines[i]!)
      continue
    }
    if (plain.length) segments.push({ kind: 'text', lines: plain })
    plain = []
    const block: ConflictBlock = { line: i + 1, oursLabel: open[1] ?? '', theirsLabel: '', ours: [], base: null, theirs: [] }
    let part: 'ours' | 'base' | 'theirs' = 'ours'
    for (let j = i + 1; j < end; j++) {
      const l = lines[j]!
      if (part === 'ours' && BASE.test(l)) {
        part = 'base'
        block.base = []
      } else if (part !== 'theirs' && MID.test(l)) part = 'theirs'
      else if (part === 'base') block.base!.push(l)
      else block[part].push(l)
    }
    block.theirsLabel = CLOSE.exec(lines[end]!)?.[1] ?? ''
    segments.push({ kind: 'conflict', block })
    count++
    i = end
  }
  if (plain.length) segments.push({ kind: 'text', lines: plain })
  return { segments, count, eol }
}

function findBlockEnd(lines: readonly string[], start: number): number {
  let mid = false
  for (let j = start + 1; j < lines.length; j++) {
    const l = lines[j]!
    if (OPEN.test(l)) return -1
    if (MID.test(l)) mid = true
    else if (CLOSE.test(l)) return mid ? j : -1
  }
  return -1
}

/** The file text with conflict number `index` (0-based) replaced by the chosen side(s). */
export function resolveConflict(text: string, index: number, pick: Pick): string {
  const { segments, eol } = parseConflicts(text)
  let n = 0
  const out: string[] = []
  for (const s of segments) {
    if (s.kind === 'text') out.push(...s.lines)
    else if (n++ === index) out.push(...(pick === 'ours' ? s.block.ours : pick === 'theirs' ? s.block.theirs : [...s.block.ours, ...s.block.theirs]))
    else out.push(...markerLines(s.block))
  }
  return out.join(eol)
}

function markerLines(b: ConflictBlock): string[] {
  return [
    `<<<<<<<${b.oursLabel ? ` ${b.oursLabel}` : ''}`,
    ...b.ours,
    ...(b.base ? ['|||||||', ...b.base] : []),
    '=======',
    ...b.theirs,
    `>>>>>>>${b.theirsLabel ? ` ${b.theirsLabel}` : ''}`,
  ]
}
