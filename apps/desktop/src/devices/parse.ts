import type { AdbMdnsService, AdbState, AdbTransport, DevResult } from '@ccm/shared'

export interface AdbDeviceRow {
  id: string
  state: AdbState
  model: string | null
  product: string | null
  device: string | null
  transportId: string | null
  usb: string | null
}

const STATE: Record<string, AdbState> = {
  device: 'ready',
  unauthorized: 'unauthorized',
  offline: 'offline',
  authorizing: 'authorizing',
  recovery: 'recovery',
  sideload: 'sideload',
  bootloader: 'bootloader',
  'no permissions': 'no-permissions',
}

/** `adb devices -l` body, or one `track-devices` frame (same line format). */
export function parseAdbDeviceRows(out: string): AdbDeviceRow[] {
  const rows: AdbDeviceRow[] = []
  for (const raw of out.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('List of devices') || line.startsWith('*')) continue
    const m = /^(\S+)\s+(no permissions|\S+)(.*)$/.exec(line)
    if (!m || m[1]!.endsWith(':')) continue
    const fields: Record<string, string> = {}
    for (const f of (m[3] ?? '').matchAll(/\b(usb|product|model|device|transport_id):(\S+)/g)) fields[f[1]!] = f[2]!
    rows.push({
      id: m[1]!,
      state: STATE[m[2]!] ?? 'unknown',
      model: fields.model?.replace(/_/g, ' ') ?? null,
      product: fields.product ?? null,
      device: fields.device ?? null,
      transportId: fields.transport_id ?? null,
      usb: fields.usb ?? null,
    })
  }
  return rows
}

export const isWifiId = (id: string): boolean => id.includes(':') || id.includes('._adb-tls-connect._tcp')

export function transportOf(row: AdbDeviceRow): AdbTransport {
  if (row.id.startsWith('emulator-')) return 'emulator'
  return isWifiId(row.id) ? 'wifi' : 'usb'
}

const MDNS_KIND: Record<string, AdbMdnsService['kind']> = {
  '_adb-tls-pairing._tcp': 'pairing',
  '_adb-tls-connect._tcp': 'connect',
  '_adb._tcp': 'legacy',
}

/** `adb mdns services`: name, service type, host:port per line. */
export function parseMdnsServices(out: string): AdbMdnsService[] {
  const services: AdbMdnsService[] = []
  for (const line of out.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 3) continue
    const kind = MDNS_KIND[parts[1]!.replace(/\.$/, '')]
    const addr = /^(.+):(\d{1,5})$/.exec(parts[2]!)
    if (!kind || !addr) continue
    const port = Number(addr[2])
    if (port < 1 || port > 65535) continue
    services.push({ name: parts[0]!, kind, host: addr[1]!, port })
  }
  return services
}

const failure = (error: 'connect-failed' | 'pair-failed' | 'not-connected', out: string): DevResult => {
  const detail = out.trim()
  return detail ? { ok: false, error, detail } : { ok: false, error }
}

export function parseConnect(out: string): DevResult {
  return /^(already )?connected to /m.test(out) ? { ok: true } : failure('connect-failed', out)
}

export function parsePair(out: string): DevResult {
  return /^Successfully paired/m.test(out) ? { ok: true } : failure('pair-failed', out)
}

export function parseDisconnect(out: string): DevResult {
  if (/^disconnected\b/m.test(out)) return { ok: true }
  return failure('not-connected', out)
}

/** `ip -f inet addr show wlan0` → the IPv4 address. */
export function parseWlanIp(out: string): string | null {
  return /\binet (\d{1,3}(?:\.\d{1,3}){3})\//.exec(out)?.[1] ?? null
}

const DEFAULT_PORT = 5555
const MDNS_CONNECT_ID = /^adb-[A-Za-z0-9_-]+\._adb-tls-connect\._tcp$/
const HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/

/** Page-supplied connect target → `adb connect` argument; null when it is not a plain host[:port] or mDNS id. */
export function parseAddress(input: string): { target: string; host: string | null; port: number | null } | null {
  const s = input.trim()
  if (!s) return null
  if (MDNS_CONNECT_ID.test(s)) return { target: s, host: null, port: null }
  let host: string
  let portText: string | undefined
  const v6 = /^\[([0-9A-Fa-f:.]+)\](?::(\d+))?$/.exec(s)
  if (v6) {
    host = `[${v6[1]}]`
    portText = v6[2]
  } else {
    const m = /^([^:]+)(?::(\d+))?$/.exec(s)
    if (!m || !HOST.test(m[1]!)) return null
    host = m[1]!
    portText = m[2]
  }
  const port = portText === undefined ? DEFAULT_PORT : Number(portText)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  return { target: `${host}:${port}`, host, port }
}

export const addressKey = (host: string, port: number): string => `${host.replace(/^\[|\]$/g, '').toLowerCase()}:${port}`
