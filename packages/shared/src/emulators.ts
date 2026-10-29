import type { DevErrorCode } from './devices'

/** One Android Virtual Device from `emulator -list-avds` plus its `.ini` / `config.ini`. */
export interface AvdInfo {
  name: string
  /** `avd.ini.displayname`, else the name with `_` as spaces. */
  displayName: string
  api: number | null
  abi: string | null
  /** `hw.device.name` (pixel_7, …). */
  device: string | null
  /** `tag.id` (google_apis_playstore, …). */
  tag: string | null
  /** adb serial (`emulator-5554`) when this AVD is running. */
  serial: string | null
}

export type AvdErrorCode = DevErrorCode | 'emulator-missing' | 'emulator-failed' | 'avd-running' | 'avd-not-running'
export type AvdFailure = { ok: false; error: AvdErrorCode; detail?: string }
export type AvdResult = { ok: true } | AvdFailure
export type AvdList = { ok: true; avds: AvdInfo[] } | AvdFailure
export type AvdStartMode = 'normal' | 'cold' | 'wipe'
