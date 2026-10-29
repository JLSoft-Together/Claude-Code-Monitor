import type { DevFsEntry, DevFsFailure, DevFsList, DevFsProgress, DevFsPulled, DevFsPullReq, DevFsPushed, DevFsPushReq, DevFsResult, DevFsScope } from '@ccm/shared'
import { desktop } from './desktop'

interface FilesBridge {
  devFsList?: (id: string, scope: DevFsScope, dir: string) => Promise<DevFsList>
  devFsMkdir?: (id: string, scope: DevFsScope, dir: string, name: string) => Promise<DevFsResult>
  devFsDelete?: (id: string, scope: DevFsScope, path: string, dir: boolean) => Promise<DevFsResult>
  devFsPull?: (id: string, req: DevFsPullReq) => Promise<DevFsPulled>
  devFsPush?: (id: string, req: DevFsPushReq) => Promise<DevFsPushed>
  devFsCancel?: (transfer: string) => Promise<boolean>
  devFsOpen?: (local: string, mode: 'open' | 'reveal') => Promise<boolean>
  onDevFsProgress?: (handler: (p: DevFsProgress) => void) => () => void
}

const bridge = desktop as unknown as FilesBridge | undefined
const unavailable: DevFsFailure = { ok: false, error: 'denied' }
// IPC structured clone refuses Vue proxies: plain copies only.
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export const hasDevFiles = typeof bridge?.devFsList === 'function'
export const devFsList = (id: string, scope: DevFsScope, dir: string): Promise<DevFsList> => bridge?.devFsList?.(id, plain(scope), dir) ?? Promise.resolve(unavailable)
export const devFsMkdir = (id: string, scope: DevFsScope, dir: string, name: string): Promise<DevFsResult> => bridge?.devFsMkdir?.(id, plain(scope), dir, name) ?? Promise.resolve(unavailable)
/** Desktop asks a native confirm first. */
export const devFsDelete = (id: string, scope: DevFsScope, path: string, dir: boolean): Promise<DevFsResult> => bridge?.devFsDelete?.(id, plain(scope), path, dir) ?? Promise.resolve(unavailable)
export const devFsPull = (id: string, req: DevFsPullReq): Promise<DevFsPulled> => bridge?.devFsPull?.(id, plain(req)) ?? Promise.resolve(unavailable)
export const devFsPush = (id: string, req: DevFsPushReq): Promise<DevFsPushed> => bridge?.devFsPush?.(id, plain(req)) ?? Promise.resolve(unavailable)
export const devFsCancel = (transfer: string): Promise<boolean> => bridge?.devFsCancel?.(transfer) ?? Promise.resolve(false)
export const devFsOpen = (local: string, mode: 'open' | 'reveal'): Promise<boolean> => bridge?.devFsOpen?.(local, mode) ?? Promise.resolve(false)
export const onDevFsProgress = (handler: (p: DevFsProgress) => void): (() => void) => bridge?.onDevFsProgress?.(handler) ?? (() => {})

export const SDCARD_ROOTS = ['/sdcard', '/data/local/tmp'] as const

export function transferId(): string {
  const b = new Uint8Array(8)
  crypto.getRandomValues(b)
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

export const joinPath = (dir: string, name: string): string => (dir === '/' ? `/${name}` : `${dir}/${name}`)

/** Breadcrumbs from the scope root down to `dir`; the root crumb carries its full path. */
export function crumbs(root: string, dir: string): { label: string; path: string }[] {
  const list = [{ label: root === '/' ? '/' : root, path: root }]
  if (dir === root || !dir.startsWith(root === '/' ? '/' : `${root}/`)) return list
  let at = root
  for (const seg of dir.slice(root === '/' ? 1 : root.length + 1).split('/')) {
    at = joinPath(at, seg)
    list.push({ label: seg, path: at })
  }
  return list
}

export const parentOf = (root: string, dir: string): string | null => (dir === root ? null : dir.slice(0, dir.lastIndexOf('/')) || '/')

export const validName = (n: string): boolean => n.length >= 1 && n.length <= 255 && n !== '.' && n !== '..' && !/[/\u0000\n\r]/.test(n)

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

export const progressPct = (p: Pick<DevFsProgress, 'done' | 'total'>): number | null => (p.total ? Math.min(100, Math.round((p.done / p.total) * 100)) : null)

/** Folders and links navigate; links that turn out to be files fail with not-dir and are pulled instead. */
export const opensAsDir = (e: DevFsEntry): boolean => e.kind === 'dir' || e.kind === 'link'
