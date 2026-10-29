import { RELEASE_SECTIONS, type ReleaseApp, type ReleaseCheckResult, type ReleaseFinding, type ReleaseSection, type ReleaseStatus, type ReleaseVerifyResult } from '@ccm/shared'
import { desktop } from './desktop'

interface ReleaseBridge {
  releaseCheck?: (root: string) => Promise<ReleaseCheckResult>
  releaseMark?: (req: { root: string; app: string }) => Promise<ReleaseCheckResult>
  releaseVerify?: (req: { root: string; app: string; pick: boolean }) => Promise<ReleaseVerifyResult>
  releaseRemember?: (req: { root: string; app: string }) => Promise<ReleaseCheckResult>
}

const bridge = desktop as unknown as ReleaseBridge | undefined
const unavailable = { ok: false, error: 'denied' } as const

export const hasReleaseCheck = typeof bridge?.releaseCheck === 'function'
export const releaseCheck = (root: string): Promise<ReleaseCheckResult> => bridge?.releaseCheck?.(root) ?? Promise.resolve(unavailable)
export const releaseMark = (root: string, app: string): Promise<ReleaseCheckResult> => bridge?.releaseMark?.({ root, app }) ?? Promise.resolve(unavailable)
export const releaseVerify = (root: string, app: string, pick: boolean): Promise<ReleaseVerifyResult> => bridge?.releaseVerify?.({ root, app, pick }) ?? Promise.resolve(unavailable)
export const releaseRemember = (root: string, app: string): Promise<ReleaseCheckResult> => bridge?.releaseRemember?.({ root, app }) ?? Promise.resolve(unavailable)

export const STATUS_RANK: Record<ReleaseStatus, number> = { fail: 0, warn: 1, unknown: 2, ok: 3 }

export interface ReleaseGroup {
  section: ReleaseSection
  findings: ReleaseFinding[]
  worst: ReleaseStatus
}

/** Sections in a fixed order, findings worst first (stable within a status). */
export function groupFindings(findings: readonly ReleaseFinding[]): ReleaseGroup[] {
  return RELEASE_SECTIONS.map((section) => {
    const list = findings
      .map((f, i) => ({ f, i }))
      .filter((x) => x.f.section === section)
      .sort((a, b) => STATUS_RANK[a.f.status] - STATUS_RANK[b.f.status] || a.i - b.i)
      .map((x) => x.f)
    const worst = list.reduce<ReleaseStatus>((w, f) => (STATUS_RANK[f.status] < STATUS_RANK[w] ? f.status : w), 'ok')
    return { section, findings: list, worst }
  }).filter((g) => g.findings.length)
}

export function countStatus(findings: readonly ReleaseFinding[]): Record<ReleaseStatus, number> {
  const out: Record<ReleaseStatus, number> = { fail: 0, warn: 0, unknown: 0, ok: 0 }
  for (const f of findings) out[f.status]++
  return out
}

/** Replaces the app's certificate row with a fresh verify result. */
export const withCert = (app: ReleaseApp, cert: ReleaseFinding | null): ReleaseFinding[] => (cert ? app.findings.map((f) => (f.rule === 'cert' ? cert : f)) : app.findings)

const relPath = (file: string, root: string): string => {
  const a = file.replace(/\\/g, '/')
  const b = root.replace(/\\/g, '/').replace(/\/$/, '')
  return a.toLowerCase().startsWith(`${b.toLowerCase()}/`) ? a.slice(b.length + 1) : a
}

export const findingKey = (f: ReleaseFinding): string => `${f.rule}:${f.detail}:${f.file ?? ''}:${f.line ?? 0}:${f.params ? JSON.stringify(f.params) : ''}`

/** Prefill (never submitted) listing fail / warn items with file:line; null when there is nothing to fix. */
export function fixPrompt(app: ReleaseApp, findings: readonly ReleaseFinding[], root: string, describe: (f: ReleaseFinding) => string): string | null {
  const bad = findings.filter((f) => f.status === 'fail' || f.status === 'warn').sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status])
  if (!bad.length) return null
  const lines = bad.map((f) => {
    const where = f.file ? ` (${relPath(f.file, root)}${f.line ? `:${f.line}` : ''})` : ''
    return `- [${f.status === 'fail' ? 'FAIL' : 'WARN'}] ${describe(f)}${where}`
  })
  return `Pre-release check of ${app.name} (${app.kind === 'flutter' ? 'Flutter' : 'Android'}) found these problems. Fix the FAIL items before publishing to Google Play; for WARN items fix them or tell me why they are fine. Keep debug-only code debug-only, do not touch signing keys or keystore passwords, and do not build a release:\n${lines.join('\n')}`
}
