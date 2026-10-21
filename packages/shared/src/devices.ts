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
