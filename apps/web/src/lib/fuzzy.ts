export interface FuzzyHit {
  item: string
  score: number
  /** Matched character indexes in `item` (for highlighting). */
  positions: number[]
}

const SEP = new Set(['/', '\\', '_', '-', '.', ' '])
const isUpper = (c: string): boolean => c >= 'A' && c <= 'Z'
const isLower = (c: string): boolean => c >= 'a' && c <= 'z'

function boundaryBonus(target: string, j: number): number {
  if (j === 0) return 8
  const prev = target[j - 1]!
  if (prev === '/' || prev === '\\') return 9
  if (SEP.has(prev)) return 6
  if (isUpper(target[j]!) && isLower(prev)) return 5
  return 0
}

const CONSECUTIVE = 6
const GAP = 1

/**
 * Subsequence match with boundary and run bonuses (VS Code / fzf flavour), case-insensitive.
 * O(query × target) dynamic programme; null when `query` is not a subsequence.
 */
export function fuzzyScore(query: string, target: string): { score: number; positions: number[] } | null {
  const q = query.toLowerCase().replace(/\\/g, '/')
  const t = target.toLowerCase().replace(/\\/g, '/')
  const m = q.length
  const n = t.length
  if (!m) return { score: 0, positions: [] }
  if (m > n) return null
  // cheap subsequence pre-check before the DP
  for (let i = 0, j = 0; i < m; j++) {
    if (j >= n) return null
    if (q[i] === t[j]) i++
  }
  const NEG = -Infinity
  const score: Float64Array[] = []
  const from: Int32Array[] = []
  for (let i = 0; i < m; i++) {
    const row = new Float64Array(n).fill(NEG)
    const back = new Int32Array(n).fill(-1)
    let best = NEG
    let bestAt = -1
    for (let j = 0; j < n; j++) {
      if (i > 0 && j > 0) {
        const prev = score[i - 1]![j - 1]!
        // best predecessor at least two columns back (a gap)
        if (j >= 2 && score[i - 1]![j - 2]! > best) {
          best = score[i - 1]![j - 2]!
          bestAt = j - 2
        }
        if (q[i] !== t[j]) continue
        const run = prev === NEG ? NEG : prev + CONSECUTIVE
        const jump = best === NEG ? NEG : best - GAP
        if (run === NEG && jump === NEG) continue
        const bonus = 1 + boundaryBonus(target, j)
        if (run >= jump) {
          row[j] = run + bonus
          back[j] = j - 1
        } else {
          row[j] = jump + bonus
          back[j] = bestAt
        }
      } else if (i === 0 && q[0] === t[j]) {
        row[j] = 1 + boundaryBonus(target, j) - Math.min(j, 20) * 0.05
      }
    }
    score.push(row)
    from.push(back)
  }
  let end = -1
  let top = NEG
  const last = score[m - 1]!
  for (let j = 0; j < n; j++) if (last[j]! > top) ((top = last[j]!), (end = j))
  if (end < 0) return null
  const positions = new Array<number>(m)
  for (let i = m - 1, j = end; i >= 0; i--) {
    positions[i] = j
    j = from[i]![j]!
  }
  const base = Math.max(t.lastIndexOf('/') + 1, 0)
  // Matches inside the file name count more than matches in the folders above it.
  const inName = positions.filter((p) => p >= base).length
  let total = top + inName * 2 - n * 0.02
  if (t.slice(base).startsWith(q)) total += 10
  return { score: total, positions }
}

/** Ranked matches; empty query → `recent` first (in order), then the rest as given. */
export function fuzzyFilter(items: readonly string[], query: string, opts: { limit?: number; recent?: readonly string[] } = {}): FuzzyHit[] {
  const limit = opts.limit ?? 200
  const recent = opts.recent ?? []
  const q = query.trim()
  if (!q) {
    const known = new Set(items)
    const seen = new Set<string>()
    const out: FuzzyHit[] = []
    for (const item of [...recent.filter((r) => known.has(r)), ...items]) {
      if (out.length >= limit) break
      if (seen.has(item)) continue
      seen.add(item)
      out.push({ item, score: 0, positions: [] })
    }
    return out
  }
  const rank = new Map(recent.map((r, i) => [r, i]))
  const hits: FuzzyHit[] = []
  for (const item of items) {
    const res = fuzzyScore(q, item)
    if (!res) continue
    const r = rank.get(item)
    hits.push({ item, score: res.score + (r === undefined ? 0 : 6 - Math.min(r, 5)), positions: res.positions })
  }
  hits.sort((a, b) => b.score - a.score || a.item.length - b.item.length || a.item.localeCompare(b.item))
  return hits.slice(0, limit)
}

/** "src/app.ts:42" or "app.ts:42:7" → query + line. */
export function parseQuickOpen(input: string): { query: string; line?: number } {
  const m = /^(.*?):(\d+)(?::\d+)?\s*$/.exec(input.trim())
  if (m && m[1]) return { query: m[1], line: Math.max(1, Number(m[2])) }
  return { query: input.trim() }
}

/** Splits `text` into runs for highlighting matched characters. */
export function highlightRuns(text: string, positions: readonly number[]): { text: string; hit: boolean }[] {
  const marks = new Set(positions)
  const out: { text: string; hit: boolean }[] = []
  for (let i = 0; i < text.length; i++) {
    const hit = marks.has(i)
    const last = out[out.length - 1]
    if (last && last.hit === hit) last.text += text[i]
    else out.push({ text: text[i]!, hit })
  }
  return out
}
