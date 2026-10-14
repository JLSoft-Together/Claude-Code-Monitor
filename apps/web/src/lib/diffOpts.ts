import type { DiffWhitespace } from './preview'

export interface DiffOpts {
  layout: 'inline' | 'split'
  collapse: boolean
  context: number
  whitespace: DiffWhitespace
  words: boolean
}

export const DIFF_OPTS_KEY = 'ccm.workspace.diffOpts'
const OLD_LAYOUT_KEY = 'ccm.workspace.diffLayout'
export const CONTEXTS = [3, 5, 10]
export const WHITESPACE: DiffWhitespace[] = ['none', 'eol', 'all', 'all-blank']

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Shared by the Changes and Log diff viewers. */
export function readDiffOpts(): DiffOpts {
  const base: DiffOpts = { layout: read(OLD_LAYOUT_KEY) === 'split' ? 'split' : 'inline', collapse: true, context: 3, whitespace: 'none', words: true }
  try {
    const raw = JSON.parse(read(DIFF_OPTS_KEY) ?? 'null') as Partial<DiffOpts> | null
    if (!raw || typeof raw !== 'object') return base
    return {
      layout: raw.layout === 'split' ? 'split' : raw.layout === 'inline' ? 'inline' : base.layout,
      collapse: typeof raw.collapse === 'boolean' ? raw.collapse : base.collapse,
      context: CONTEXTS.includes(raw.context as number) ? (raw.context as number) : base.context,
      whitespace: WHITESPACE.includes(raw.whitespace as DiffWhitespace) ? (raw.whitespace as DiffWhitespace) : base.whitespace,
      words: typeof raw.words === 'boolean' ? raw.words : base.words,
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
