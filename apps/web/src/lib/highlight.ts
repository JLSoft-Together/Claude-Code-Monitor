import type { CodeToken } from './codeView'
import type { WordMark } from './diffBlocks'
import type { PackedTokens } from './highlightCore'

type WordDiffResult = { old: WordMark[][]; new: WordMark[][] } | null
export interface WordDiffPair {
  old: string[]
  new: string[]
  mode: 'words' | 'chars'
}

export type WorkerRequest =
  | { op: 'tokenize'; id: number; code: string; lang: string | null }
  | { op: 'wordDiff'; id: number; pairs: WordDiffPair[] }
  | { op: 'cancel'; id: number }
export type WorkerReply = { id: number; result: PackedTokens | WordDiffResult[] | null }

let worker: Worker | null | undefined
let nextId = 0
const pending = new Map<number, (result: WorkerReply['result']) => void>()
/** Latest request per caller key: a newer one cancels the older. */
const latest = new Map<string, number>()

function getWorker(): Worker | null {
  if (worker !== undefined) return worker
  try {
    worker = typeof Worker === 'undefined' ? null : new Worker(new URL('./highlight.worker.ts', import.meta.url), { type: 'module' })
  } catch {
    worker = null
  }
  if (worker) {
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const done = pending.get(e.data.id)
      pending.delete(e.data.id)
      done?.(e.data.result)
    }
    // A dead worker answers nothing: settle everything as plain and run later requests on this thread.
    worker.onerror = () => {
      for (const done of pending.values()) done(null)
      pending.clear()
      worker?.terminate()
      worker = null
    }
  }
  return worker
}

function request(key: string | undefined, msg: { op: 'tokenize'; code: string; lang: string | null } | { op: 'wordDiff'; pairs: WordDiffPair[] }, w: Worker): Promise<WorkerReply['result']> {
  const id = ++nextId
  if (key) {
    const prev = latest.get(key)
    if (prev !== undefined && pending.has(prev)) {
      w.postMessage({ op: 'cancel', id: prev } satisfies WorkerRequest)
      pending.get(prev)!(null)
      pending.delete(prev)
    }
    latest.set(key, id)
  }
  return new Promise((resolve) => {
    pending.set(id, resolve)
    w.postMessage({ ...msg, id } as WorkerRequest)
  })
}

/** Rebuilds token lines; contents are slices of `code` split the way shiki splits it. */
export function unpackTokens(code: string, packed: PackedTokens): CodeToken[][] | null {
  const lines = code.split(/\r?\n/)
  if (lines.length !== packed.counts.length) return null
  const out: CodeToken[][] = new Array(lines.length)
  let k = 0
  for (let li = 0; li < lines.length; li++) {
    const text = lines[li]!
    const n = packed.counts[li]!
    const row: CodeToken[] = new Array(n)
    let col = 0
    for (let j = 0; j < n; j++, k += 3) {
      const len = packed.toks[k]!
      const c = packed.toks[k + 1]!
      const fs = packed.toks[k + 2]!
      const token: CodeToken = { content: text.slice(col, col + len) }
      if (c) token.color = packed.palette[c - 1]
      if (fs) token.fontStyle = fs
      row[j] = token
      col += len
    }
    out[li] = row
  }
  return out
}

/**
 * Token lines for `code` off the main thread (shiki JS regex engine in a module worker: CSP allows `worker-src 'self'`,
 * no WASM). null = render plain. `key` names the caller: its previous unanswered request is cancelled and resolves null.
 */
export async function tokenize(code: string, lang: string | null, key?: string): Promise<CodeToken[][] | null> {
  if (!lang) return null
  const w = getWorker()
  const packed = w ? ((await request(key, { op: 'tokenize', code, lang }, w)) as PackedTokens | null) : await (await import('./highlightCore')).tokenizePacked(code, lang)
  return packed ? unpackTokens(code, packed) : null
}

/** `wordDiff` for many blocks in the worker (main thread when there is none). */
export async function wordDiffs(pairs: WordDiffPair[], key?: string): Promise<WordDiffResult[] | null> {
  if (!pairs.length) return []
  const w = getWorker()
  if (w) return (await request(key, { op: 'wordDiff', pairs }, w)) as WordDiffResult[] | null
  const { wordDiff } = await import('./diffBlocks')
  return pairs.map((p) => wordDiff(p.old, p.new, p.mode))
}
