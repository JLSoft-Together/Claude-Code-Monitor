// Pre-release check of an Android / Flutter app (v75): static reads only, no build.
export type ReleaseStatus = 'ok' | 'warn' | 'fail' | 'unknown'
export type ReleaseSection = 'version' | 'build' | 'ads' | 'manifest' | 'sdk' | 'extras' | 'signing'

export const RELEASE_SECTIONS: readonly ReleaseSection[] = ['version', 'build', 'sdk', 'manifest', 'ads', 'extras', 'signing']

/**
 * Google Play target API level for new apps and app updates (phone / tablet), in force since 2026-08-31.
 * Play's rule is "within one year of the latest major Android release": Android 16 (API 36) shipped June 2025,
 * so API 36 applies from the 2026-08-31 deadline (API 35 was the 2025-08-31 one). Bump each August.
 */
export const PLAY_TARGET_SDK = 36
export const PLAY_TARGET_SDK_SINCE = '2026-08-31'

export const RELEASE_RULES = [
  'version-code',
  'version-name',
  'minify',
  'shrink',
  'debuggable',
  'signing',
  'target-sdk',
  'min-sdk',
  'compile-sdk',
  'cleartext',
  'manifest-debuggable',
  'exported',
  'permission',
  'admob-test',
  'ump',
  'billing-ack',
  'firebase',
  'cert',
] as const
export type ReleaseRule = (typeof RELEASE_RULES)[number]

export interface ReleaseFinding {
  rule: ReleaseRule
  section: ReleaseSection
  status: ReleaseStatus
  /** i18n variant under `releaseCheck.rule.<rule>.<detail>`. */
  detail: string
  /** Values for the message: numbers, versions, names (never file contents). */
  params?: Record<string, string | number>
  /** Absolute file + 1-based line, null when the value is missing everywhere. */
  file: string | null
  line: number | null
}

export interface ReleaseVersion {
  code: number | null
  name: string | null
}

export interface ReleaseMark extends ReleaseVersion {
  at: number
}

export interface ReleaseApp {
  kind: 'android' | 'flutter'
  /** Absolute app dir: the Android application module, or the Flutter folder holding pubspec.yaml. */
  dir: string
  /** Label: module path (`:app`) or the Flutter package name. */
  name: string
  version: ReleaseVersion
  /** Last version marked as released, null when never marked. */
  released: ReleaseMark | null
  /** Remembered release certificate SHA-256 (upper hex, colon separated). */
  cert: { sha256: string; at: number } | null
  findings: ReleaseFinding[]
}

export type ReleaseCheckError = 'denied' | 'invalid' | 'no-app' | 'read-failed'
export type ReleaseCheckResult = { ok: true; root: string; apps: ReleaseApp[]; checkedAt: number } | { ok: false; error: ReleaseCheckError }

export type ReleaseVerifyError = 'denied' | 'invalid' | 'no-artifact' | 'no-jdk' | 'no-apksigner' | 'failed' | 'unsigned' | 'cancelled'
export type ReleaseVerifyResult =
  | {
      ok: true
      file: string
      artifact: 'apk' | 'aab'
      sha256: string
      /** Certificate subject DN (public info), may be null when the tool did not print it. */
      subject: string | null
      debugKey: boolean
      finding: ReleaseFinding
    }
  | { ok: false; error: ReleaseVerifyError }

export const isCertSha256 = (v: unknown): v is string => typeof v === 'string' && /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(v)
