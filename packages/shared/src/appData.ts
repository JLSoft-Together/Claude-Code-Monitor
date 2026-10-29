import type { DevErrorCode } from './devices'

export type AppDataErrorCode =
  | DevErrorCode
  | 'not-debuggable'
  | 'unknown-package'
  | 'too-large'
  | 'not-sqlite'
  | 'pull-failed'
  | 'sql-rejected'
  | 'sql-error'
  | 'gone'
  | 'changed'
  | 'write-failed'
  | 'no-original'

export type AppDataFailure = { ok: false; error: AppDataErrorCode; detail?: string }

export interface AppDataFile {
  name: string
  size: number | null
  /** A `-wal` file sits next to this database. */
  wal?: boolean
}

export type AppDataList = { ok: true; pkg: string; databases: AppDataFile[]; prefs: AppDataFile[]; skipped: number } | AppDataFailure

export interface AppDbTable {
  name: string
  type: 'table' | 'view'
  sql: string
  rows: number | null
}

/** `wal`: 'applied' = committed WAL frames copied in, 'partial' = some frames failed their checksum and were left out. */
export type AppDbOpen =
  | { ok: true; handle: string; name: string; size: number; tables: AppDbTable[]; wal: 'none' | 'applied' | 'partial'; walFrames: number }
  | AppDataFailure

export type AppDbCell = string | number | null | { blob: number }

export type AppDbRows = { ok: true; columns: string[]; rows: AppDbCell[][]; total: number | null; truncated: boolean } | AppDataFailure

export type PrefType = 'string' | 'int' | 'long' | 'float' | 'boolean' | 'set'

export interface PrefEntry {
  key: string
  type: PrefType
  value: string | string[]
}

export type AppPrefs = { ok: true; name: string; entries: PrefEntry[]; hasOriginal: boolean } | AppDataFailure

/** One value change; `before` must still be on the device or the write is refused (`changed`). */
export interface PrefEdit {
  key: string
  type: PrefType
  before: string | string[]
  after: string | string[]
}
