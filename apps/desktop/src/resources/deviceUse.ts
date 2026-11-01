import path from 'node:path'
import type { DeviceUsedMessage } from '@ccm/shared'
import type { Spawner, SpawnSpec } from '../run/proc'

const SERIAL_RE = /^[A-Za-z0-9._:-]{1,64}$/
const EMULATOR_RE = /^emulator-\d{1,5}$/
const THROTTLE_MS = 15_000
export const RUN_USE_THROTTLE_MS = 30_000
// An emulator port can host another AVD after a restart, so the name is asked again after a while.
const AVD_TTL_MS = 10 * 60_000

/** Tells the collector Orrery just used a device (emulator idle rule): at most one note per serial per 15 s (Run pane adb calls: 30 s). */
export class DeviceUseReporter {
  private readonly last = new Map<string, number>()
  private readonly avds = new Map<string, { name: Promise<string | null>; at: number }>()

  constructor(
    private readonly post: (msg: DeviceUsedMessage) => void,
    private readonly avdName: (serial: string) => Promise<string | null>,
    private readonly now: () => number = Date.now,
  ) {}

  used(serial: string, minGapMs = THROTTLE_MS): void {
    if (!SERIAL_RE.test(serial)) return
    const at = this.now()
    if (at - (this.last.get(serial) ?? -Infinity) < minGapMs) return
    this.last.set(serial, at)
    if (!EMULATOR_RE.test(serial)) return this.post({ type: 'device.used', serial, at })
    let cached = this.avds.get(serial)
    if (!cached || at - cached.at > AVD_TTL_MS) {
      cached = { name: this.avdName(serial).catch(() => null), at }
      this.avds.set(serial, cached)
    }
    void cached.name.then((name) => this.post({ type: 'device.used', serial, at, ...(name ? { avd: name } : {}) }))
  }
}

/** Serial of an `adb -s <serial> …` spawn, else null. */
export function adbSerialOf(spec: Pick<SpawnSpec, 'file' | 'args'>): string | null {
  if (!/^adb(\.exe)?$/i.test(path.basename(spec.file.replace(/\\/g, '/')))) return null
  return spec.args[0] === '-s' && spec.args[1] && SERIAL_RE.test(spec.args[1]) ? spec.args[1] : null
}

/** Spawner that reports every adb call made against a device before running it. */
export function withAdbUse(spawn: Spawner, onUse: (serial: string) => void): Spawner {
  return (spec) => {
    const serial = adbSerialOf(spec)
    if (serial) onUse(serial)
    return spawn(spec)
  }
}
