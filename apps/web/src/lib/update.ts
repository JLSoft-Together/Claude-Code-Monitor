import type { UpdateState } from '@ccm/shared'
import { desktop } from './desktop'

/** v74 updater bridge (`ccmDesktop.update`); every call answers with the main process' state. */
interface UpdateBridge {
  state: () => Promise<UpdateState | null>
  check: () => Promise<UpdateState | null>
  download: () => Promise<UpdateState | null>
  cancel: () => Promise<UpdateState | null>
  install: () => Promise<UpdateState | null>
  skip: (version: string) => Promise<UpdateState | null>
  setAutoCheck: (on: boolean) => Promise<UpdateState | null>
  openPage: () => Promise<unknown>
  reveal: () => Promise<unknown>
  onState: (handler: (state: UpdateState) => void) => () => void
}

export const updateBridge: UpdateBridge | undefined = (desktop as unknown as { update?: UpdateBridge } | undefined)?.update
export const hasUpdater = typeof updateBridge?.state === 'function'

/** Header pill / settings dot: a release the owner has not skipped, or one already downloading / downloaded. */
export function updateAvailable(s: UpdateState | null): boolean {
  if (!s?.release) return false
  if (s.phase === 'downloading' || s.phase === 'ready' || s.phase === 'installing') return true
  return (s.phase === 'available' || (s.phase === 'error' && s.error !== 'offline' && s.error !== 'feed')) && s.release.version !== s.skipped
}

export function progressPercent(s: UpdateState | null): number {
  const p = s?.progress
  if (!p || p.total <= 0) return 0
  return Math.min(100, Math.floor((p.received / p.total) * 100))
}

const MB = 1024 * 1024

export const megabytes = (bytes: number): string => (bytes / MB).toFixed(bytes >= 100 * MB ? 0 : 1)
