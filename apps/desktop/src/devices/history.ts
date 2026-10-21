import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { isWifiId, type AdbDeviceRow } from './parse'

export const DEVICES_FILE = 'adb-devices.json'
const MAX_ENTRIES = 200
const MAX_ALIAS = 64

export interface HistoryEntry {
  alias: string | null
  model: string | null
  wifi: boolean
  lastSeen: number
}

function cleanEntry(v: unknown): HistoryEntry | null {
  if (!v || typeof v !== 'object') return null
  const e = v as Record<string, unknown>
  if (typeof e.lastSeen !== 'number' || !Number.isFinite(e.lastSeen)) return null
  return {
    alias: typeof e.alias === 'string' && e.alias ? e.alias.slice(0, MAX_ALIAS) : null,
    model: typeof e.model === 'string' && e.model ? e.model : null,
    wifi: e.wifi === true,
    lastSeen: e.lastSeen,
  }
}

export class DeviceHistory {
  private devices: Record<string, HistoryEntry> = Object.create(null) as Record<string, HistoryEntry>
  private auto = true

  constructor(private readonly file: string) {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as { autoConnect?: unknown; devices?: unknown }
      if (typeof raw.autoConnect === 'boolean') this.auto = raw.autoConnect
      if (raw.devices && typeof raw.devices === 'object') {
        for (const [id, v] of Object.entries(raw.devices)) {
          if (id === '__proto__') continue
          const e = cleanEntry(v)
          if (e) this.devices[id] = e
        }
      }
    } catch {
      // missing or unreadable file: start empty
    }
  }

  all(): Record<string, HistoryEntry> {
    return this.devices
  }

  get(id: string): HistoryEntry | null {
    return Object.hasOwn(this.devices, id) ? this.devices[id]! : null
  }

  get autoConnect(): boolean {
    return this.auto
  }

  setAutoConnect(on: boolean): void {
    if (this.auto === on) return
    this.auto = on
    this.write()
  }

  wifiIds(): string[] {
    return Object.keys(this.devices).filter((id) => this.devices[id]!.wifi)
  }

  seen(rows: AdbDeviceRow[], now: number): void {
    let dirty = false
    for (const r of rows) {
      // Emulator serials are per launch and never come back over Wi-Fi.
      if (r.state !== 'ready' || r.id.startsWith('emulator-')) continue
      const cur = this.get(r.id)
      if (!cur) {
        this.devices[r.id] = { alias: null, model: r.model, wifi: isWifiId(r.id), lastSeen: now }
        dirty = true
        continue
      }
      cur.lastSeen = now
      if (r.model && r.model !== cur.model) {
        cur.model = r.model
        dirty = true
      }
    }
    if (dirty) this.write()
  }

  setAlias(id: string, alias: string | null): void {
    const cur = this.get(id)
    if (!cur) return
    const next = alias?.trim().slice(0, MAX_ALIAS) || null
    if (cur.alias === next) return
    cur.alias = next
    this.write()
  }

  remove(ids: string[]): void {
    for (const id of ids) if (Object.hasOwn(this.devices, id)) delete this.devices[id]
    this.write()
  }

  private write(): void {
    const ids = Object.keys(this.devices)
    if (ids.length > MAX_ENTRIES) {
      ids.sort((a, b) => this.devices[a]!.lastSeen - this.devices[b]!.lastSeen)
      for (const id of ids.slice(0, ids.length - MAX_ENTRIES)) delete this.devices[id]
    }
    try {
      mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify({ version: 1, autoConnect: this.auto, devices: this.devices }, null, 2))
      renameSync(tmp, this.file)
    } catch {
      // read-only data dir: history lasts until quit
    }
  }
}
