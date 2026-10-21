import type { AdbMdnsService, DevErrorCode, DevResult } from '@ccm/shared'
import { collect, type Collected } from '../run/collect'
import { killAdbClient, type Spawner } from '../run/proc'
import { parseAdbDeviceRows, parseConnect, parseDisconnect, parseMdnsServices, parsePair, parseWlanIp, type AdbDeviceRow } from './parse'

export interface AdbCommandsOpts {
  spawn: Spawner
  cwd: string
  adb: () => Promise<string | null>
  timing?: Partial<{ connectMs: number; pairMs: number; cmdMs: number }>
}

export interface AdbCommands {
  connect(target: string): Promise<DevResult>
  pair(hostPort: string, code: string): Promise<DevResult>
  disconnect(id: string): Promise<DevResult>
  tcpip(id: string, port: number): Promise<DevResult>
  wlanIp(id: string): Promise<string | null>
  mdnsCheck(): Promise<boolean>
  mdnsServices(): Promise<AdbMdnsService[]>
  /** One-shot `adb devices -l`; null when adb is missing, timed out or failed. */
  list(): Promise<AdbDeviceRow[] | null>
}

const TIMING = { connectMs: 15_000, pairMs: 20_000, cmdMs: 10_000 }

export function createAdbCommands(opts: AdbCommandsOpts): AdbCommands {
  const t = { ...TIMING, ...opts.timing }

  const run = async (args: string[], timeoutMs: number): Promise<Collected | null> => {
    const adb = await opts.adb()
    return adb ? collect(opts.spawn, adb, args, opts.cwd, { timeoutMs, kill: killAdbClient }) : null
  }

  const result = async (args: string[], timeoutMs: number, spawnFailed: DevErrorCode, parse: (r: Collected) => DevResult): Promise<DevResult> => {
    const r = await run(args, timeoutMs)
    if (!r) return { ok: false, error: 'adb-missing' }
    if (r.timedOut) return { ok: false, error: 'timeout' }
    if (r.code === null) return { ok: false, error: spawnFailed }
    return parse(r)
  }

  return {
    connect: (target) => result(['connect', target], t.connectMs, 'connect-failed', (r) => parseConnect(r.out)),
    pair: (hostPort, code) => result(['pair', hostPort, code], t.pairMs, 'pair-failed', (r) => parsePair(r.out)),
    disconnect: (id) => result(['disconnect', id], t.cmdMs, 'not-connected', (r) => parseDisconnect(r.out)),
    tcpip: (id, port) =>
      result(['-s', id, 'tcpip', String(port)], t.cmdMs, 'tcpip-failed', (r) => {
        if (r.code === 0 && !/error/i.test(r.out)) return { ok: true }
        const detail = r.out.trim()
        return detail ? { ok: false, error: 'tcpip-failed', detail } : { ok: false, error: 'tcpip-failed' }
      }),
    async wlanIp(id) {
      const r = await run(['-s', id, 'shell', 'ip', '-f', 'inet', 'addr', 'show', 'wlan0'], t.cmdMs)
      return r && r.code === 0 ? parseWlanIp(r.out) : null
    },
    async mdnsCheck() {
      const r = await run(['mdns', 'check'], t.cmdMs)
      return !!r && r.code === 0 && !/unavailable/i.test(r.out)
    },
    async mdnsServices() {
      const r = await run(['mdns', 'services'], t.cmdMs)
      return r && r.code === 0 ? parseMdnsServices(r.out) : []
    },
    async list() {
      const r = await run(['devices', '-l'], t.cmdMs)
      return r && !r.timedOut && r.code === 0 ? parseAdbDeviceRows(r.out) : null
    },
  }
}
