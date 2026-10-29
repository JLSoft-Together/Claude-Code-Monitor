import type { AdbDevice, AvdInfo } from '@ccm/shared'

/** Key of the online emulator serials; the AVD list re-reads only when it changes (no polling). */
export const emulatorKey = (devices: AdbDevice[]): string =>
  devices
    .filter((d) => d.online && d.transport === 'emulator')
    .map((d) => d.id)
    .sort()
    .join(',')

/** `API 34 · x86_64 · pixel_7`, parts that are known only. */
export function avdDetails(a: AvdInfo, apiLabel: (n: number) => string): string {
  return [a.api !== null ? apiLabel(a.api) : null, a.abi, a.device].filter(Boolean).join(' · ')
}

export type AvdRowState = 'running' | 'starting' | 'stopped'

export const avdState = (a: AvdInfo, starting: ReadonlySet<string>): AvdRowState => (a.serial ? 'running' : starting.has(a.name) ? 'starting' : 'stopped')
