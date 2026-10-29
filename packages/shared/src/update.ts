/** In-app updater (v74): GitHub Releases feed, checked and downloaded by the desktop main process. */

export type UpdateInstallKind = 'nsis' | 'portable' | 'mac' | 'dev' | 'unsupported'

export type UpdatePhase = 'idle' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'installing' | 'error'

export type UpdateError =
  | 'offline'
  | 'feed'
  | 'no-asset'
  | 'no-digest'
  | 'digest'
  | 'download'
  | 'disk'
  | 'install'
  | 'mac-readonly'
  | 'incomplete'
  | 'denied'

export interface UpdateRelease {
  version: string
  name: string
  /** ISO date of publication, null when the feed has none. */
  date: string | null
  /** Markdown body as published; the page renders it through the escaping Markdown renderer. */
  notes: string
  /** Release page on github.com. */
  url: string
  asset: { name: string; size: number } | null
}

export interface UpdateProgress {
  received: number
  total: number
  /** Bytes per second over the last few seconds. */
  bps: number
}

export interface UpdateState {
  current: string
  kind: UpdateInstallKind
  /** False for a dev build without a test feed: check + open the release page only. */
  canDownload: boolean
  phase: UpdatePhase
  release: UpdateRelease | null
  checkedAt: number | null
  progress: UpdateProgress | null
  error: UpdateError | null
  autoCheck: boolean
  skipped: string | null
}
