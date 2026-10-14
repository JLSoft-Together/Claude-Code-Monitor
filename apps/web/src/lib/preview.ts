import { desktop } from './desktop'

export type FileViewKind = 'text' | 'image' | 'binary' | 'too-large' | 'missing' | 'denied'

export interface FileView {
  kind: FileViewKind
  path: string
  size: number
  mtimeMs: number
  text?: string
  lang?: string
}

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
  | { ok: true; path: string; text: string; binary: boolean; tooLarge: boolean; untracked: boolean }
  | { ok: false; error: ChangesError }

export type ChangesResult = { ok: true } | { ok: false; error: ChangesError; detail?: string }

export interface FileList {
  root: string
  files: string[]
  truncated: boolean
  source: 'git' | 'walk'
}

/** Preview methods added to `window.ccmDesktop` by the v21 preload (see .planning/PLAN-v21-integration.md). */
interface PreviewBridge {
  previewUrl?: (path: string) => Promise<PreviewTarget | null>
  readFile?: (path: string) => Promise<FileView | null>
  watch?: (root: string) => Promise<boolean>
  unwatch?: (root: string) => Promise<boolean>
  onPreviewChanged?: (handler: (change: PreviewChange) => void) => () => void
  pickFile?: (kind: 'html' | 'any') => Promise<string | null>
  openExternal?: (url: string) => Promise<boolean>
  reveal?: (path: string) => Promise<boolean>
  openPath?: (path: string) => Promise<string>
  requestAccess?: (path: string) => Promise<boolean>
  forgetGrants?: () => Promise<boolean>
  changesStatus?: (dir: string) => Promise<ChangesStatus>
  changesDiff?: (root: string, path: string) => Promise<ChangesDiff>
  changesDiscard?: (root: string, path: string, hunk?: string) => Promise<ChangesResult>
  changesWatch?: (root: string) => Promise<boolean>
  changesUnwatch?: (root: string) => Promise<boolean>
  onChangesUpdated?: (handler: (change: { root: string }) => void) => () => void
  listFiles?: (root: string) => Promise<FileList | null>
  clipboardImage?: (pngDataUrl: string) => Promise<boolean>
  captureGuest?: (webContentsId: number) => Promise<boolean>
}

const bridge = desktop as unknown as PreviewBridge | undefined

export const hasPreview = typeof bridge?.previewUrl === 'function'

export const previewUrl = (path: string): Promise<PreviewTarget | null> => bridge?.previewUrl?.(path) ?? Promise.resolve(null)
export const readFile = (path: string): Promise<FileView | null> => bridge?.readFile?.(path) ?? Promise.resolve(null)
export const watchRoot = (root: string): Promise<boolean> => bridge?.watch?.(root) ?? Promise.resolve(false)
export const unwatchRoot = (root: string): Promise<boolean> => bridge?.unwatch?.(root) ?? Promise.resolve(false)
export const pickFile = (kind: 'html' | 'any'): Promise<string | null> => bridge?.pickFile?.(kind) ?? Promise.resolve(null)
export const openExternal = (url: string): Promise<boolean> => bridge?.openExternal?.(url) ?? Promise.resolve(false)
export const revealPath = (path: string): Promise<boolean> => bridge?.reveal?.(path) ?? Promise.resolve(false)
export const openPath = (path: string): Promise<string> => bridge?.openPath?.(path) ?? Promise.resolve('denied')
/** Native "allow this folder?" prompt; true when the path is (now) readable. */
export const requestAccess = (path: string): Promise<boolean> => bridge?.requestAccess?.(path) ?? Promise.resolve(false)
export const hasGrants = typeof bridge?.forgetGrants === 'function'
export const forgetGrants = (): Promise<boolean> => bridge?.forgetGrants?.() ?? Promise.resolve(false)

const unavailable = { ok: false as const, error: 'unavailable' as const }
export const hasChanges = typeof bridge?.changesStatus === 'function'
export const changesStatus = (dir: string): Promise<ChangesStatus> => bridge?.changesStatus?.(dir) ?? Promise.resolve(unavailable)
export const changesDiff = (root: string, path: string): Promise<ChangesDiff> => bridge?.changesDiff?.(root, path) ?? Promise.resolve(unavailable)
export const changesDiscard = (root: string, path: string, hunk?: string): Promise<ChangesResult> =>
  bridge?.changesDiscard?.(root, path, hunk) ?? Promise.resolve(unavailable)
export const changesWatch = (root: string): Promise<boolean> => bridge?.changesWatch?.(root) ?? Promise.resolve(false)
export const changesUnwatch = (root: string): Promise<boolean> => bridge?.changesUnwatch?.(root) ?? Promise.resolve(false)
export const listFiles = (root: string): Promise<FileList | null> => bridge?.listFiles?.(root) ?? Promise.resolve(null)
export const clipboardImage = (pngDataUrl: string): Promise<boolean> => bridge?.clipboardImage?.(pngDataUrl) ?? Promise.resolve(false)
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
