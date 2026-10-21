import { randomBytes, randomInt } from 'node:crypto'
import type { DevResult, QrStatus } from '@ccm/shared'
import type { AdbCommands } from './adb'
import { addressKey } from './parse'

const WIFI_PORT = 5555
const CANCELLED: DevResult = { ok: false, error: 'cancelled' }

export const qrPayload = (name: string, password: string): string => `WIFI:T:ADB;S:${name};P:${password};;`

export function newQrSecret(): { name: string; password: string } {
  return { name: `orrery-${randomBytes(4).toString('hex')}`, password: String(randomInt(0, 1e6)).padStart(6, '0') }
}

export interface QrPairingOptions {
  cmds: AdbCommands
  name: string
  password: string
  signal: AbortSignal
  onStatus: (s: QrStatus, detail?: string) => void
  lastPortFor: (host: string) => number | null
  timing: { pairWaitMs: number; connectWaitMs: number; pollMs: number }
}

/** Resolves after `ms`, or as soon as `signal` aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}

export async function runQrPairing(o: QrPairingOptions): Promise<DevResult> {
  const { cmds, signal, timing } = o
  const end = (s: QrStatus, result: DevResult): DevResult => {
    o.onStatus(s, result.ok ? undefined : result.detail)
    return result
  }
  const cancelled = (): DevResult => end('cancelled', CANCELLED)

  o.onStatus('waiting')
  const pairDeadline = Date.now() + timing.pairWaitMs
  let host = ''
  let port = 0
  for (;;) {
    if (signal.aborted) return cancelled()
    const svc = (await cmds.mdnsServices()).find((s) => s.kind === 'pairing' && s.name === o.name)
    if (signal.aborted) return cancelled()
    if (svc) {
      host = svc.host
      port = svc.port
      break
    }
    if (Date.now() >= pairDeadline) return end('timeout', { ok: false, error: 'timeout' })
    await sleep(timing.pollMs, signal)
  }

  o.onStatus('pairing')
  const paired = await cmds.pair(`${host}:${port}`, o.password)
  if (signal.aborted) return cancelled()
  if (!paired.ok) return end('failed', paired)

  o.onStatus('connecting')
  const hostKey = addressKey(host, 0)
  const connectDeadline = Date.now() + timing.connectWaitMs
  const targets: string[] = []
  for (;;) {
    if (signal.aborted) return cancelled()
    const svc = (await cmds.mdnsServices()).find((s) => s.kind === 'connect' && addressKey(s.host, 0) === hostKey)
    if (signal.aborted) return cancelled()
    if (svc) {
      targets.push(`${svc.host}:${svc.port}`)
      break
    }
    if (Date.now() >= connectDeadline) break
    await sleep(timing.pollMs, signal)
  }
  if (!targets.length) {
    const remembered = o.lastPortFor(host)
    if (remembered) targets.push(`${host}:${remembered}`)
    targets.push(`${host}:${WIFI_PORT}`)
  }

  let last: DevResult = { ok: false, error: 'connect-failed' }
  for (const target of targets) {
    last = await cmds.connect(target)
    if (signal.aborted) return cancelled()
    if (last.ok) return end('connected', last)
  }
  return end('failed', last)
}
