import type { BuildError } from './run'

/** Flutter Widget Preview (v40): `@Preview` functions shown on a mobile device by a generated host app. */
export type FwpSkipReason = 'private' | 'params' | 'unknown' | 'type' | 'part'

export interface FwpEntry {
  /** `<file>#<symbol>` */
  id: string
  /** Project-relative, `/` separators (`lib/…`). */
  file: string
  line: number
  symbol: string
  label: string
  /** Dart call without the import alias: `fn()`, `X.fn()`, `X()`, `X.named()`. */
  call: string
  skipped?: FwpSkipReason
}

export interface FwpScanResult {
  flutter: boolean
  /** Folder holding `pubspec.yaml`; null when none was found. */
  root: string | null
  entries: FwpEntry[]
}

/** `syncing`: `pubspec.yaml` changed while running → `flutter pub get`, then the session restarts. */
export type FwpState = 'idle' | 'starting' | 'running' | 'reloading' | 'syncing' | 'failed' | 'stopped'

export interface FwpError {
  code: string
  detail?: string
  build?: BuildError
  /** Entry a runtime widget error (`code: 'widget'`) came from. */
  entry?: string
}

export interface FwpSnapshot {
  state: FwpState
  root: string | null
  deviceId: string | null
  appId: string | null
  current: string | null
  progress: string | null
  error: FwpError | null
  entries: FwpEntry[]
  log: string[]
}

export type FwpResult = { ok: true } | { ok: false; error: FwpError }
