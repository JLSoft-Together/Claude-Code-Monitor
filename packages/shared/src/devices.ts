export type AdbState = 'ready' | 'unauthorized' | 'offline' | 'authorizing' | 'recovery' | 'sideload' | 'bootloader' | 'no-permissions' | 'unknown'
export type AdbTransport = 'usb' | 'wifi' | 'emulator'

export interface AdbDevice {
  id: string
  state: AdbState
  transport: AdbTransport
  model: string | null
  product: string | null
  device: string | null
  transportId: string | null
  alias: string | null
  /** alias ?? model ?? id */
  name: string
  /** false = remembered, not currently listed. */
  online: boolean
  lastSeen: number | null
}

export interface AdbMdnsService {
  name: string
  kind: 'pairing' | 'connect' | 'legacy'
  host: string
  port: number
}

export type DevErrorCode =
  | 'denied'
  | 'invalid'
  | 'adb-missing'
  | 'connect-failed'
  | 'pair-failed'
  | 'not-connected'
  | 'no-ip'
  | 'tcpip-failed'
  | 'timeout'
  | 'mdns-unavailable'
  | 'no-devices'
  | 'cancelled'
  | 'capture-failed'
  | 'secure'
  | 'dump-failed'
  | 'launch-failed'
  | 'no-manifest'
  | 'unsupported'

export type DevResult = { ok: true; detail?: string } | { ok: false; error: DevErrorCode; detail?: string }

export interface DevBatchResult {
  id: string
  result: DevResult
}

export interface DevSnapshot {
  adb: string | null
  devices: AdbDevice[]
  autoConnect: boolean
}

export type QrStatus = 'waiting' | 'pairing' | 'connecting' | 'connected' | 'failed' | 'timeout' | 'cancelled'

export type DevEvent = { type: 'devices'; devices: AdbDevice[] } | { type: 'qr'; id: string; status: QrStatus; detail?: string }

/** One `uiautomator dump` node; `bounds` = [left, top, right, bottom] in screen pixels. */
export interface DevUiNode {
  parent: number
  depth: number
  cls: string
  resId: string
  text: string
  desc: string
  pkg: string
  bounds: [number, number, number, number]
  clickable: boolean
}

export type DevFailure = { ok: false; error: DevErrorCode; detail?: string }
/** `png` is a base64 data URL. */
export type DevCapture = { ok: true; png: string; width: number; height: number } | DevFailure
export type DevUiDump = { ok: true; nodes: DevUiNode[]; rotation: number } | DevFailure

export type DevNight = 'yes' | 'no' | 'auto' | 'custom'
export type DevUiKey = 'night' | 'fontScale' | 'density' | 'animations' | 'locale'

/** Current display settings of one device, read when the panel opens or after a change. */
export interface DevUiState {
  sdk: number | null
  night: DevNight | null
  fontScale: number
  density: { physical: number | null; override: number | null }
  /** All three animation scales are 0. */
  animationsOff: boolean
  /** Per-app locales (Android 13+); `current` = the app's list, '' = follows the system. */
  locale: { supported: boolean; pkg: string | null; current: string | null }
  /** Settings changed from here whose original value is kept for Restore all. */
  changed: DevUiKey[]
}

export type DevUiChange =
  | { key: 'night'; value: 'yes' | 'no' }
  | { key: 'fontScale'; value: number }
  | { key: 'density'; value: number | null }
  | { key: 'animations'; off: boolean }
  | { key: 'locale'; pkg: string; value: string }

export type DevUiResult = { ok: true; state: DevUiState } | DevFailure

export interface DevDeepLink {
  /** Fully qualified activity class. */
  activity: string
  exported: boolean
  launcher: boolean
  /** Sample URIs built from each VIEW intent-filter's data (scheme × host × path). */
  links: string[]
}

export type DevManifest =
  | { ok: true; manifest: string; pkg: string | null; activities: DevDeepLink[]; locales: string[] }
  | DevFailure

export type DevLaunch = { kind: 'uri'; uri: string; pkg: string | null } | { kind: 'activity'; pkg: string; activity: string }
