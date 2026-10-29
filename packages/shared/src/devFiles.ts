import type { AppDataErrorCode } from './appData'

/** `sdcard`: shared storage + /data/local/tmp as the shell user; `app`: the private folder of a debuggable app over `run-as`. */
export type DevFsScope = { kind: 'sdcard' } | { kind: 'app'; pkg: string }

export type DevFsKind = 'dir' | 'file' | 'link' | 'other'

export interface DevFsEntry {
  name: string
  kind: DevFsKind
  /** Bytes; null for folders on old `ls` and for device nodes. */
  size: number | null
  /** As the device prints it (`2024-01-02 10:11`), local time of the device. */
  modified: string | null
  target?: string
}

export type DevFsErrorCode = AppDataErrorCode | 'not-found' | 'permission' | 'not-dir' | 'exists' | 'outside' | 'failed'

export type DevFsFailure = { ok: false; error: DevFsErrorCode; detail?: string }

export type DevFsList = { ok: true; path: string; entries: DevFsEntry[]; skipped: number } | DevFsFailure
export type DevFsResult = { ok: true } | DevFsFailure

/** Where pulled files go: a folder picked in a native dialog, or a project folder of the Workspace. */
export type DevFsDest = { kind: 'pick' } | { kind: 'dir'; dir: string }
/** What gets pushed: files picked in a native dialog, or absolute paths dropped from Explorer / the OS. */
export type DevFsSource = { kind: 'pick' } | { kind: 'paths'; paths: string[] }

export interface DevFsPullReq {
  transfer: string
  scope: DevFsScope
  path: string
  kind: DevFsKind
  size: number | null
  dest: DevFsDest
}

export interface DevFsPushReq {
  transfer: string
  scope: DevFsScope
  dir: string
  source: DevFsSource
}

export type DevFsPulled = { ok: true; local: string; name: string; inDir: string } | DevFsFailure
export type DevFsPushed = { ok: true; pushed: string[]; skipped: string[] } | DevFsFailure

/** Pushed to the page while a pull / push runs; `total` null = size unknown (folder pull). */
export interface DevFsProgress {
  transfer: string
  name: string
  done: number
  total: number | null
  index: number
  count: number
}
