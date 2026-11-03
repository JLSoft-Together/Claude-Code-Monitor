import { ref } from 'vue'
import type { ChangeEntry } from './preview'

const KEY = 'ccm.review.seen.v1'
const MAX_PROJECTS = 40
const MAX_FILES = 400

type SeenFiles = Record<string, string>
interface Seen {
  at: number
  files: SeenFiles
}
type Store = Record<string, Seen>

/** Unseen files per repo root, set by whichever Changes pane watches that root (no polling of its own). */
export const unseenCounts = ref<Record<string, number>>({})

const normRoot = (root: string): string => root.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** Git status carries no mtime: a file counts as changed again when its kind, stage letters or line counts move. */
export const changeSignature = (e: ChangeEntry): string => `${e.kind}:${e.x}${e.y}:${e.added ?? ''}:${e.removed ?? ''}`

function read(): Store {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Store) : {}
  } catch {
    return {}
  }
}

function write(store: Store): void {
  const keys = Object.keys(store)
  if (keys.length > MAX_PROJECTS) {
    keys.sort((a, b) => (store[b]?.at ?? 0) - (store[a]?.at ?? 0))
    for (const k of keys.slice(MAX_PROJECTS)) delete store[k]
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    // storage unavailable: review state is per-session then
  }
}

export function readSeen(root: string): SeenFiles {
  const files = read()[normRoot(root)]?.files
  return files && typeof files === 'object' ? files : {}
}

function save(root: string, files: SeenFiles): void {
  const entries = Object.entries(files)
  const kept = entries.length > MAX_FILES ? Object.fromEntries(entries.slice(entries.length - MAX_FILES)) : files
  const store = read()
  store[normRoot(root)] = { at: Date.now(), files: kept }
  write(store)
}

/** Everything listed now counts as seen; files that left the list are forgotten. */
export function markAllSeen(root: string, entries: readonly ChangeEntry[]): SeenFiles {
  const files: SeenFiles = {}
  for (const e of entries) files[e.path] = changeSignature(e)
  save(root, files)
  return files
}

export function markSeen(root: string, entry: ChangeEntry): void {
  save(root, { ...readSeen(root), [entry.path]: changeSignature(entry) })
}

/** Conflicts stay in their own group, so they are never "unseen". */
export function splitUnseen(entries: readonly ChangeEntry[], seen: SeenFiles): { unseen: ChangeEntry[]; rest: ChangeEntry[] } {
  const unseen: ChangeEntry[] = []
  const rest: ChangeEntry[] = []
  for (const e of entries) (e.kind !== 'conflict' && seen[e.path] !== changeSignature(e) ? unseen : rest).push(e)
  return { unseen, rest }
}

export function setUnseenCount(root: string, n: number): void {
  const key = normRoot(root)
  if ((unseenCounts.value[key] ?? 0) === n) return
  unseenCounts.value = { ...unseenCounts.value, [key]: n }
}

export const unseenCountOf = (root: string): number => unseenCounts.value[normRoot(root)] ?? 0
