import type { DeviceUsedMessage } from '@ccm/shared'

const SERIAL_RE = /^[A-Za-z0-9._:-]{1,64}$/
const EMULATOR_RE = /^emulator-\d{1,5}$/
const THROTTLE_MS = 15_000
// An emulator port can host another AVD after a restart, so the name is asked again after a while.
const AVD_TTL_MS = 10 * 60_000

/** Tells the collector Orrery just used a device (emulator idle rule): at most one note per serial per 15 s. */
export class DeviceUseReporter {
  private readonly last = new Map<string, number>()
  private readonly avds = new Map<string, { name: Promise<string | null>; at: number }>()

  constructor(
    private readonly post: (msg: DeviceUsedMessage) => void,
    private readonly avdName: (serial: string) => Promise<string | null>,
    private readonly now: () => number = Date.now,
  ) {}

  used(serial: string): void {
    if (!SERIAL_RE.test(serial)) return
    const at = this.now()
    if (at - (this.last.get(serial) ?? -Infinity) < THROTTLE_MS) return
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
