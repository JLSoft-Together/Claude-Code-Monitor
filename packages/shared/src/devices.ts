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
