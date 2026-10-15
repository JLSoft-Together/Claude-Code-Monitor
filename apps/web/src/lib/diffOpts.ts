import type { DiffWhitespace } from './preview'

/**
 * IntelliJ "Highlight": changed lines only, the changed words / characters inside Modified blocks, `split` = words with
 * every Modified block shown as a Deleted + an Inserted change, `none` = no change tint (gutter / connector marks only).
 */
export type DiffHighlight = 'lines' | 'words' | 'split' | 'chars' | 'none'

export interface DiffOpts {
  layout: 'inline' | 'split'
  collapse: boolean
  context: number
  whitespace: DiffWhitespace
  highlight: DiffHighlight
  /** Split view: pad the shorter side of each change so both sides line up. */
  align: boolean
  /** Split view: scrolling one side scrolls the other. */
  sync: boolean
}

export const DIFF_OPTS_KEY = 'ccm.workspace.diffOpts'
const OLD_LAYOUT_KEY = 'ccm.workspace.diffLayout'
export const CONTEXTS = [3, 5, 10]
export const WHITESPACE: DiffWhitespace[] = ['none', 'eol', 'all', 'all-blank', 'imports']
export const HIGHLIGHTS: DiffHighlight[] = ['lines', 'words', 'split', 'chars', 'none']

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Shared by the Changes and Log diff viewers. */
export function readDiffOpts(): DiffOpts {
  const base: DiffOpts = { layout: read(OLD_LAYOUT_KEY) === 'split' ? 'split' : 'inline', collapse: true, context: 3, whitespace: 'none', highlight: 'words', align: false, sync: true }
  try {
    const raw = JSON.parse(read(DIFF_OPTS_KEY) ?? 'null') as (Partial<DiffOpts> & { words?: unknown }) | null
    if (!raw || typeof raw !== 'object') return base
    return {
      layout: raw.layout === 'split' ? 'split' : raw.layout === 'inline' ? 'inline' : base.layout,
      collapse: typeof raw.collapse === 'boolean' ? raw.collapse : base.collapse,
      context: CONTEXTS.includes(raw.context as number) ? (raw.context as number) : base.context,
      whitespace: WHITESPACE.includes(raw.whitespace as DiffWhitespace) ? (raw.whitespace as DiffWhitespace) : base.whitespace,
      // Before v33 this was `words: boolean`.
      highlight: HIGHLIGHTS.includes(raw.highlight as DiffHighlight) ? (raw.highlight as DiffHighlight) : raw.words === false ? 'lines' : base.highlight,
      align: typeof raw.align === 'boolean' ? raw.align : base.align,
      sync: typeof raw.sync === 'boolean' ? raw.sync : base.sync,
    }
  } catch {
    return base
  }
}

export function writeDiffOpts(o: DiffOpts): void {
  try {
    localStorage.setItem(DIFF_OPTS_KEY, JSON.stringify(o))
  } catch {
    // private mode / quota: options last for this session only
  }
}
