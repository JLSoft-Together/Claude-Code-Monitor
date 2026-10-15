import type { BranchOpResult, CommitDetail, ContainsResult, EntryNameProblem, LogPageResult, LogQuery, RefsResult } from '@ccm/shared'
import { desktop } from './desktop'
import type { DirEntry } from './explorer/tree'

export type FileViewKind = 'text' | 'image' | 'binary' | 'too-large' | 'missing' | 'denied'

export interface FileView {
  kind: FileViewKind
  path: string
  size: number
  mtimeMs: number
  text?: string
  lang?: string
  /** v42: UTF-8 BOM on disk (kept on save). */
  bom?: boolean
  /** v42: line breaks on disk; saves write the same style back. */
  eol?: 'lf' | 'crlf' | 'cr'
  /** v42: not valid UTF-8 (lossy text); the editor stays view only. */
  invalidUtf8?: boolean
}

export type FileWriteError = 'denied' | 'missing' | 'conflict' | 'too-large' | 'encoding' | 'busy' | 'failed' | 'unavailable'
export type FileWriteResult = { ok: true; path: string; mtimeMs: number; size: number } | { ok: false; error: FileWriteError }

export interface PreviewTarget {
  url: string
  root: string
  token: string
  origin: string
}

export interface PreviewChange {
  root: string
  tokens: string[]
  paths: string[]
}

export type ChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflict'

/** Mirrors `apps/desktop/src/preview/changes.ts`. */
export interface ChangeEntry {
  path: string
  origPath?: string
  x: string
  y: string
  kind: ChangeKind
  staged: boolean
  added?: number
  removed?: number
  binary?: boolean
}

export type ChangesError = 'denied' | 'no-git' | 'not-repo' | 'failed' | 'conflict' | 'stale' | 'missing' | 'unavailable'

export type ChangesStatus =
  | { ok: true; root: string; branch: string | null; entries: ChangeEntry[]; truncated: boolean }
  | { ok: false; error: ChangesError }

export type ChangesDiff =
  /** `partial`: the full-context diff was too big, `text` is the 3-line-context one. */
  | { ok: true; path: string; text: string; binary: boolean; tooLarge: boolean; untracked: boolean; partial?: boolean }
  | { ok: false; error: ChangesError }

/** `imports` = `all-blank` in git; the viewer then hides import-only changes itself (`lib/diffImports.ts`). */
export type DiffWhitespace = 'none' | 'eol' | 'all' | 'all-blank' | 'imports'

export interface ChangesDiffOpts {
  context?: 3 | 'full'
  whitespace?: DiffWhitespace
}

/** One viewed file's diff vs HEAD (gutter markers); `kind` null = clean, ignored or not in the index. */
export type ChangesFile =
  | { ok: true; root: string; rel: string; kind: ChangeKind | null; staged: boolean; text: string; binary: boolean; tooLarge: boolean; untracked: boolean }
  | { ok: false; error: ChangesError }

export type ChangesResult = { ok: true } | { ok: false; error: ChangesError; detail?: string }

export interface FileList {
  root: string
  files: string[]
  truncated: boolean
  source: 'git' | 'walk'
}

export type CreateEntryResult =
  | { ok: true; path: string }
  | { ok: false; error: 'invalid'; reason: EntryNameProblem }
  | { ok: false; error: 'exists' | 'denied' | 'failed' | 'unavailable' }

export type RenameEntryResult =
  | { ok: true; path: string }
  | { ok: false; error: 'invalid'; reason: EntryNameProblem }
  | { ok: false; error: 'exists' | 'denied' | 'missing' | 'busy' | 'failed' | 'unavailable' }
export type TrashEntryResult = { ok: true } | { ok: false; error: 'denied' | 'missing' | 'busy' | 'failed' | 'unavailable' }

/** Preview methods added to `window.ccmDesktop` by the v21 preload (see .planning/PLAN-v21-integration.md). */
interface PreviewBridge {
  previewUrl?: (path: string) => Promise<PreviewTarget | null>
  readFile?: (path: string) => Promise<FileView | null>
  fileWrite?: (req: { path: string; text: string; expectedMtime?: number }) => Promise<FileWriteResult>
  watch?: (root: string) => Promise<boolean>
  unwatch?: (root: string) => Promise<boolean>
  onPreviewChanged?: (handler: (change: PreviewChange) => void) => () => void
  pickFile?: (kind: 'html' | 'any', near?: string) => Promise<string | null>
  openExternal?: (url: string) => Promise<boolean>
  reveal?: (path: string) => Promise<boolean>
  openPath?: (path: string) => Promise<string>
  requestAccess?: (path: string) => Promise<boolean>
  forgetGrants?: () => Promise<boolean>
  fullAccess?: (on?: boolean | 'first') => Promise<boolean | null>
  changesStatus?: (dir: string) => Promise<ChangesStatus>
  changesDiff?: (root: string, path: string, opts?: ChangesDiffOpts) => Promise<ChangesDiff>
  changesFile?: (path: string) => Promise<ChangesFile>
  logRefs?: (dir: string) => Promise<RefsResult>
  logPage?: (root: string, query: LogQuery) => Promise<LogPageResult>
  logCommit?: (root: string, hash: string) => Promise<CommitDetail>
  logContains?: (root: string, hash: string) => Promise<ContainsResult>
  logDiff?: (root: string, hash: string, path: string, opts?: ChangesDiffOpts, origPath?: string) => Promise<ChangesDiff>
  gitBranchCreate?: (root: string, name: string, base: string, checkout: boolean) => Promise<BranchOpResult>
  gitBranchDelete?: (root: string, ref: string) => Promise<BranchOpResult>
  gitFetch?: (root: string) => Promise<BranchOpResult>
  gitBranchUpdate?: (root: string, ref: string) => Promise<BranchOpResult>
  changesDiscard?: (root: string, path: string, hunk?: string) => Promise<ChangesResult>
  changesWatch?: (root: string) => Promise<boolean>
  changesUnwatch?: (root: string) => Promise<boolean>
  onChangesUpdated?: (handler: (change: { root: string }) => void) => () => void
  listFiles?: (root: string) => Promise<FileList | null>
  listDir?: (root: string, dir: string) => Promise<DirEntry[] | null>
  createEntry?: (root: string, parent: string, name: string, kind: 'file' | 'directory') => Promise<CreateEntryResult>
  renameEntry?: (root: string, path: string, name: string) => Promise<RenameEntryResult>
  trashEntry?: (root: string, path: string) => Promise<TrashEntryResult>
  clipboardImage?: (pngDataUrl: string) => Promise<boolean>
  clipboardImageFile?: (file: string) => Promise<boolean>
  pickFiles?: () => Promise<string[]>
  pathForFile?: (file: File) => string
  captureGuest?: (webContentsId: number) => Promise<boolean>
}

const bridge = desktop as unknown as PreviewBridge | undefined

export const hasPreview = typeof bridge?.previewUrl === 'function'

export const previewUrl = (path: string): Promise<PreviewTarget | null> => bridge?.previewUrl?.(path) ?? Promise.resolve(null)
export const readFile = (path: string): Promise<FileView | null> => bridge?.readFile?.(path) ?? Promise.resolve(null)
export const hasFileWrite = typeof bridge?.fileWrite === 'function'
/** Saves an edited text file; expectedMtime = mtime when it was read (else conflict). */
export const fileWrite = (path: string, text: string, expectedMtime?: number): Promise<FileWriteResult> =>
  bridge?.fileWrite?.({ path, text, expectedMtime }) ?? Promise.resolve({ ok: false, error: 'unavailable' })
export const watchRoot = (root: string): Promise<boolean> => bridge?.watch?.(root) ?? Promise.resolve(false)
export const unwatchRoot = (root: string): Promise<boolean> => bridge?.unwatch?.(root) ?? Promise.resolve(false)
/** `near`: folder the dialog opens in (the focused terminal's). */
export const pickFile = (kind: 'html' | 'any', near?: string): Promise<string | null> => bridge?.pickFile?.(kind, near) ?? Promise.resolve(null)
export const openExternal = (url: string): Promise<boolean> => bridge?.openExternal?.(url) ?? Promise.resolve(false)
export const hasReveal = typeof bridge?.reveal === 'function'
export const revealPath = (path: string): Promise<boolean> => bridge?.reveal?.(path) ?? Promise.resolve(false)
export const openPath = (path: string): Promise<string> => bridge?.openPath?.(path) ?? Promise.resolve('denied')
/** Native "allow this folder?" prompt; true when the path is (now) readable. */
export const requestAccess = (path: string): Promise<boolean> => bridge?.requestAccess?.(path) ?? Promise.resolve(false)
export const hasGrants = typeof bridge?.forgetGrants === 'function'
export const forgetGrants = (): Promise<boolean> => bridge?.forgetGrants?.() ?? Promise.resolve(false)
/** Every folder readable: no argument reads, true asks natively first, 'first' asks only if never decided. Null outside the app. */
export const fullAccess = (on?: boolean | 'first'): Promise<boolean | null> => bridge?.fullAccess?.(on) ?? Promise.resolve(null)
export const hasFullAccess = typeof bridge?.fullAccess === 'function'

const unavailable = { ok: false as const, error: 'unavailable' as const }
export const hasChanges = typeof bridge?.changesStatus === 'function'
export const changesStatus = (dir: string): Promise<ChangesStatus> => bridge?.changesStatus?.(dir) ?? Promise.resolve(unavailable)
export const changesDiff = (root: string, path: string, opts?: ChangesDiffOpts): Promise<ChangesDiff> =>
  bridge?.changesDiff?.(root, path, opts) ?? Promise.resolve(unavailable)
export const hasFileChanges = typeof bridge?.changesFile === 'function'
export const changesFile = (path: string): Promise<ChangesFile> => bridge?.changesFile?.(path) ?? Promise.resolve(unavailable)

type Unavailable = { ok: false; error: 'unavailable' }
export type WebRefs = RefsResult | Unavailable
export type WebLogPage = LogPageResult | Unavailable
export type WebCommitDetail = CommitDetail | Unavailable
export type WebContains = ContainsResult | Unavailable
export const hasLog = typeof bridge?.logPage === 'function'
export const logRefs = (dir: string): Promise<WebRefs> => bridge?.logRefs?.(dir) ?? Promise.resolve(unavailable)
export const logPage = (root: string, query: LogQuery): Promise<WebLogPage> => bridge?.logPage?.(root, query) ?? Promise.resolve(unavailable)
export const logCommit = (root: string, hash: string): Promise<WebCommitDetail> => bridge?.logCommit?.(root, hash) ?? Promise.resolve(unavailable)
export const logContains = (root: string, hash: string): Promise<WebContains> => bridge?.logContains?.(root, hash) ?? Promise.resolve(unavailable)
export const logDiff = (root: string, hash: string, path: string, opts?: ChangesDiffOpts, origPath?: string): Promise<ChangesDiff> =>
  bridge?.logDiff?.(root, hash, path, opts, origPath) ?? Promise.resolve(unavailable)
const noBranchOps: BranchOpResult = { ok: false, error: 'denied' }
export const hasBranchOps = typeof bridge?.gitFetch === 'function'
export const gitBranchCreate = (root: string, name: string, base: string, checkout: boolean): Promise<BranchOpResult> =>
  bridge?.gitBranchCreate?.(root, name, base, checkout) ?? Promise.resolve(noBranchOps)
export const gitBranchDelete = (root: string, ref: string): Promise<BranchOpResult> => bridge?.gitBranchDelete?.(root, ref) ?? Promise.resolve(noBranchOps)
export const gitFetch = (root: string): Promise<BranchOpResult> => bridge?.gitFetch?.(root) ?? Promise.resolve(noBranchOps)
export const gitBranchUpdate = (root: string, ref: string): Promise<BranchOpResult> => bridge?.gitBranchUpdate?.(root, ref) ?? Promise.resolve(noBranchOps)
export const changesDiscard = (root: string, path: string, hunk?: string): Promise<ChangesResult> =>
  bridge?.changesDiscard?.(root, path, hunk) ?? Promise.resolve(unavailable)
export const changesWatch = (root: string): Promise<boolean> => bridge?.changesWatch?.(root) ?? Promise.resolve(false)
export const changesUnwatch = (root: string): Promise<boolean> => bridge?.changesUnwatch?.(root) ?? Promise.resolve(false)
export const listFiles = (root: string): Promise<FileList | null> => bridge?.listFiles?.(root) ?? Promise.resolve(null)
export const hasExplorer = typeof bridge?.listDir === 'function'
/** One folder of the project `root`; null when outside it or unreadable. */
export const listDir = (root: string, dir: string): Promise<DirEntry[] | null> => bridge?.listDir?.(root, dir) ?? Promise.resolve(null)
export const createEntry = (root: string, parent: string, name: string, kind: 'file' | 'directory'): Promise<CreateEntryResult> =>
  bridge?.createEntry?.(root, parent, name, kind) ?? Promise.resolve({ ok: false, error: 'unavailable' })
export const renameEntry = (root: string, path: string, name: string): Promise<RenameEntryResult> =>
  bridge?.renameEntry?.(root, path, name) ?? Promise.resolve({ ok: false, error: 'unavailable' })
export const trashEntry = (root: string, path: string): Promise<TrashEntryResult> => bridge?.trashEntry?.(root, path) ?? Promise.resolve({ ok: false, error: 'unavailable' })
export const clipboardImage = (pngDataUrl: string): Promise<boolean> => bridge?.clipboardImage?.(pngDataUrl) ?? Promise.resolve(false)
export const clipboardImageFile = (file: string): Promise<boolean> => bridge?.clipboardImageFile?.(file) ?? Promise.resolve(false)
export const pickFiles = (): Promise<string[]> => bridge?.pickFiles?.() ?? Promise.resolve([])
export const hasAttachments = typeof bridge?.pathForFile === 'function'
/** Absolute path of a dropped file, '' when it has none (dragged out of a web page). */
export const pathForFile = (file: File): string => bridge?.pathForFile?.(file) ?? ''
export const captureGuest = (webContentsId: number): Promise<boolean> => bridge?.captureGuest?.(webContentsId) ?? Promise.resolve(false)
export const hasCaptureGuest = typeof bridge?.captureGuest === 'function'

const changesHandlers = new Set<(change: { root: string }) => void>()
let unsubscribeChanges: (() => void) | null = null

export function onChangesUpdated(handler: (change: { root: string }) => void): () => void {
  changesHandlers.add(handler)
  if (!unsubscribeChanges && bridge?.onChangesUpdated) unsubscribeChanges = bridge.onChangesUpdated((c) => changesHandlers.forEach((h) => h(c)))
  return () => {
    changesHandlers.delete(handler)
    if (changesHandlers.size === 0 && unsubscribeChanges) {
      unsubscribeChanges()
      unsubscribeChanges = null
    }
  }
}

/** One IPC listener for the whole page; panes subscribe here. */
const changeHandlers = new Set<(change: PreviewChange) => void>()
let unsubscribeBridge: (() => void) | null = null

export function onPreviewChanged(handler: (change: PreviewChange) => void): () => void {
  changeHandlers.add(handler)
  if (!unsubscribeBridge && bridge?.onPreviewChanged) unsubscribeBridge = bridge.onPreviewChanged((c) => changeHandlers.forEach((h) => h(c)))
  return () => {
    changeHandlers.delete(handler)
    if (changeHandlers.size === 0 && unsubscribeBridge) {
      unsubscribeBridge()
      unsubscribeBridge = null
    }
  }
}

export const isAbsolutePath = (p: string): boolean => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\')

export const dirOf = (p: string): string => {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  if (i <= 0) return p.slice(0, i + 1) || p
  // keep "C:\" rather than "C:"
  return /^[A-Za-z]:$/.test(p.slice(0, i)) ? p.slice(0, i + 1) : p.slice(0, i)
}

export const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

/** What the address field accepts: full http(s) URL, bare host:port (http assumed), or an absolute path. */
export function parseAddress(input: string): { kind: 'url'; url: string } | { kind: 'path'; path: string } | null {
  const text = input.trim()
  if (!text) return null
  if (/^https?:\/\//i.test(text)) {
    try {
      return { kind: 'url', url: new URL(text).href }
    } catch {
      return null
    }
  }
  if (/^file:\/\//i.test(text)) {
    try {
      const path = decodeURIComponent(new URL(text).pathname)
      return { kind: 'path', path: /^\/[A-Za-z]:\//.test(path) ? path.slice(1) : path }
    } catch {
      return null
    }
  }
  if (isAbsolutePath(text)) return { kind: 'path', path: text }
  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(text) || /^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(text)) {
    const local = /^(localhost|127\.0\.0\.1|\[::1\])/i.test(text)
    try {
      return { kind: 'url', url: new URL(`${local ? 'http' : 'https'}://${text}`).href }
    } catch {
      return null
    }
  }
  return null
}
