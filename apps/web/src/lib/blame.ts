import type { BlameResult } from './preview'

export interface BlameRow {
  /** '' on lines that continue the run above (same commit), so a run shows its label once. */
  text: string
  title: string
  hash: string
}

/** One annotation per line: "author · date" at the start of each run of lines from the same commit. */
export function blameRows(res: Extract<BlameResult, { ok: true }>, locale: string, uncommitted: string): BlameRow[] {
  const date = new Intl.DateTimeFormat(locale, { year: '2-digit', month: '2-digit', day: '2-digit' })
  return res.lines.map((hash, i) => {
    const c = hash ? res.commits[hash] : undefined
    const label = hash && c ? `${c.author} · ${c.time ? date.format(c.time) : ''}` : uncommitted
    const title = hash && c ? `${hash.slice(0, 8)} ${c.summary}\n${c.author}${c.time ? ` · ${new Date(c.time).toLocaleString(locale)}` : ''}` : uncommitted
    return { text: i > 0 && res.lines[i - 1] === hash ? '' : label, title, hash }
  })
}
