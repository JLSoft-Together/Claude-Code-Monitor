import type { ApkCompareResult, ApkGroup, ApkGroupDelta, ApkGroupKind, ApkResult, ApkSizes } from '@ccm/shared'
import { desktop } from './desktop'

interface ApkBridge {
  apkPick?: (near: string | null) => Promise<string | null>
  apkAnalyze?: (req: { path: string; root: string | null }) => Promise<ApkResult>
  apkCompare?: (req: { path: string; other: string }) => Promise<ApkCompareResult>
}

const bridge = desktop as unknown as ApkBridge | undefined
const unavailable = { ok: false, error: 'denied' } as const

export const hasApkSize = typeof bridge?.apkAnalyze === 'function'
/** Native picker; the chosen file becomes readable for this run. */
export const apkPick = (near: string | null): Promise<string | null> => bridge?.apkPick?.(near) ?? Promise.resolve(null)
export const apkAnalyze = (path: string, root: string | null): Promise<ApkResult> => bridge?.apkAnalyze?.({ path, root }) ?? Promise.resolve(unavailable)
export const apkCompare = (path: string, other: string): Promise<ApkCompareResult> => bridge?.apkCompare?.({ path, other }) ?? Promise.resolve(unavailable)

export const isApkPath = (p: string): boolean => /\.(apk|aab)$/i.test(p)

const KIND_COLOR: Record<ApkGroupKind, string> = {
  dex: 'bg-model-1',
  res: 'bg-model-2',
  arsc: 'bg-model-3',
  assets: 'bg-model-4',
  lib: 'bg-model-5',
  module: 'bg-model-6',
  meta: 'bg-model-7',
  other: 'bg-model-8',
}
export const groupColor = (kind: ApkGroupKind): string => KIND_COLOR[kind]

export interface BarSegment {
  id: string
  kind: ApkGroupKind
  sub: string | null
  value: number
  /** Share of the total in percent, 0–100. */
  pct: number
}

/** Stacked-bar segments by compressed (`compressed`) or installed (`size`) bytes; empty groups dropped. */
export function barSegments(groups: ApkGroup[], by: keyof ApkSizes): BarSegment[] {
  const total = groups.reduce((n, g) => n + g[by], 0)
  if (!total) return []
  return groups.filter((g) => g[by] > 0).map((g) => ({ id: g.id, kind: g.kind, sub: g.sub, value: g[by], pct: (g[by] / total) * 100 }))
}

export function fmtSize(n: number, locale: string): string {
  const abs = Math.abs(n)
  const nf = (v: number, d: number) => v.toLocaleString(locale, { maximumFractionDigits: d })
  if (abs < 1024) return `${nf(n, 0)} B`
  if (abs < 1024 * 1024) return `${nf(n / 1024, 1)} KB`
  if (abs < 1024 * 1024 * 1024) return `${nf(n / 1024 / 1024, 2)} MB`
  return `${nf(n / 1024 / 1024 / 1024, 2)} GB`
}

/** `+1.2 MB` / `−340 B` / `0 B`, with a real minus sign. */
export function fmtDelta(n: number, locale: string): string {
  if (!n) return fmtSize(0, locale)
  return `${n > 0 ? '+' : '−'}${fmtSize(Math.abs(n), locale)}`
}

export const deltaOf = (d: { before: ApkSizes | null; after: ApkSizes | null }, by: keyof ApkSizes): number => (d.after?.[by] ?? 0) - (d.before?.[by] ?? 0)

/** Text tone of a size change: growth is the thing to notice. */
export const deltaClass = (n: number): string => (n > 0 ? 'text-diff-del' : n < 0 ? 'text-diff-add' : 'text-ink-faint')

export const groupSort = (a: ApkGroupDelta, b: ApkGroupDelta, by: keyof ApkSizes): number => Math.abs(deltaOf(b, by)) - Math.abs(deltaOf(a, by))
