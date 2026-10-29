export type ApkGroupKind = 'dex' | 'res' | 'assets' | 'lib' | 'arsc' | 'meta' | 'module' | 'other'

/** Sizes are bytes; `compressed` = stored in the zip (≈ download), `size` = uncompressed. */
export interface ApkSizes {
  compressed: number
  size: number
}

export interface ApkGroup extends ApkSizes {
  id: string
  kind: ApkGroupKind
  /** ABI for `lib`, module name for `module` (AAB feature modules). */
  sub: string | null
  files: number
}

export interface ApkFile extends ApkSizes {
  name: string
}

export interface ApkManifest {
  pkg: string | null
  versionCode: string | null
  versionName: string | null
  minSdk: string | null
  targetSdk: string | null
  compileSdk: string | null
  debuggable: boolean
  permissions: string[]
}

export interface ApkReport extends ApkSizes {
  path: string
  name: string
  kind: 'apk' | 'aab'
  fileSize: number
  mtime: number
  entries: number
  groups: ApkGroup[]
  /** 20 largest files by compressed size. */
  top: ApkFile[]
  manifest: ApkManifest | null
  /** Sum of `method_ids_size` over the dex headers (method references), null when no header could be read. */
  dexMethods: number | null
  dexFiles: number
}

export interface ApkSide extends ApkSizes {
  name: string
  fileSize: number
  versionName: string | null
  versionCode: string | null
  analyzedAt: number
}

export interface ApkGroupDelta {
  id: string
  kind: ApkGroupKind
  sub: string | null
  before: ApkSizes | null
  after: ApkSizes | null
}

export interface ApkFileDelta {
  name: string
  before: ApkSizes | null
  after: ApkSizes | null
}

export interface ApkDiff {
  before: ApkSide
  after: ApkSide
  groups: ApkGroupDelta[]
  /** Largest changes first, each list capped (`*Count` = full count). */
  added: ApkFileDelta[]
  removed: ApkFileDelta[]
  changed: ApkFileDelta[]
  addedCount: number
  removedCount: number
  changedCount: number
}

export type ApkErrorCode = 'denied' | 'invalid' | 'missing' | 'not-zip' | 'zip64' | 'too-large' | 'read-failed'
export type ApkFailure = { ok: false; error: ApkErrorCode }

/** `previous` / `diff`: the build analyzed before this one in the same project (kept in the data dir). */
export type ApkResult = { ok: true; report: ApkReport; previous: ApkSide | null; diff: ApkDiff | null } | ApkFailure
export type ApkCompareResult = { ok: true; other: ApkReport; diff: ApkDiff } | ApkFailure
