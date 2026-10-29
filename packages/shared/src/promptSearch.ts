/** Search past Claude Code sessions by what the owner typed (v75, docs §11af). Scanned on request only, never indexed. */
export const PROMPT_SEARCH_DAYS = [7, 30, 90, 0] as const
/** 0 = all time. */
export type PromptSearchDays = (typeof PROMPT_SEARCH_DAYS)[number]
export const PROMPT_SEARCH_MAX_SESSIONS = 200
export const PROMPT_SEARCH_SNIPPETS = 3
export const PROMPT_SEARCH_SNIPPET_MAX = 200
export const PROMPT_SEARCH_QUERY_MAX = 200
export const PROMPT_SEARCH_TERMS_MAX = 8

export interface PromptSearchHit {
  sessionId: string
  cwd: string
  /** False when the project folder is gone: Resume and Open folder are then off. */
  cwdExists: boolean
  startedAt?: string
  /** Transcript file mtime: last activity. */
  lastAt: string
  gitBranch?: string
  /** `/rename` title, else Claude Code's own session title. */
  title?: string
  matches: number
  /** Masked, ≤ PROMPT_SEARCH_SNIPPET_MAX chars each. */
  snippets: string[]
}

export type PromptSearchState = 'done' | 'capped' | 'cancelled' | 'failed'

export interface PromptSearchProgress {
  searchId: string
  filesDone: number
  filesTotal: number
  /** Sessions found since the previous progress event. */
  hits: PromptSearchHit[]
}

export interface PromptSearchDone {
  searchId: string
  state: PromptSearchState
  filesDone: number
  filesTotal: number
  sessions: number
}

const fold = (s: string): string => s.normalize('NFC').toLowerCase()

/** Lower-cased terms; every one must appear in a prompt. */
export function promptSearchTerms(query: string): string[] {
  const seen = new Set<string>()
  for (const raw of fold(query.slice(0, PROMPT_SEARCH_QUERY_MAX)).split(/\s+/)) if (raw) seen.add(raw)
  return [...seen].slice(0, PROMPT_SEARCH_TERMS_MAX)
}

export interface TextSegment {
  text: string
  hit: boolean
}

/** Splits text into plain / matched runs for highlighting without v-html. */
export function highlightSegments(text: string, terms: readonly string[]): TextSegment[] {
  const lower = fold(text)
  if (!terms.length || lower.length !== text.length) return [{ text, hit: false }]
  const marks = new Array<boolean>(text.length).fill(false)
  for (const term of terms) {
    for (let at = lower.indexOf(term); at !== -1; at = lower.indexOf(term, at + term.length)) marks.fill(true, at, at + term.length)
  }
  const out: TextSegment[] = []
  for (let i = 0; i < text.length; ) {
    let j = i
    while (j < text.length && marks[j] === marks[i]) j++
    out.push({ text: text.slice(i, j), hit: marks[i]! })
    i = j
  }
  return out.length ? out : [{ text, hit: false }]
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const KNOWN_TOKENS = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[bp]-[A-Za-z0-9-]{8,}/g,
]

/** Same rules as desktop `log-mask.ts` `maskLog`: known tokens, long opaque runs, home folder → ~. */
export function maskSecrets(text: string, home: string, platform: string): string {
  let out = text
  if (home && home.length > 1) {
    const forms = platform === 'win32' ? [home.replace(/\\/g, '\\\\'), home, home.replace(/\\/g, '/')] : [home]
    for (const form of forms) out = out.replace(new RegExp(escapeRe(form), platform === 'win32' ? 'gi' : 'g'), '~')
  }
  for (const re of KNOWN_TOKENS) out = out.replace(re, '[masked]')
  out = out.replace(/[A-Za-z0-9+_=]{32,}/g, '[masked]')
  out = out.replace(/(password|passwd|secret|token|api[_-]?key)(\s*[:=]\s*)(\S{4,})/gi, '$1$2[masked]')
  return out.replace(/[A-Za-z0-9+/=_.-]{32,}/g, (run) =>
    !run.startsWith('/') && /\d/.test(run) && /[a-z]/.test(run) && /[A-Z]/.test(run) ? '[masked]' : run,
  )
}
