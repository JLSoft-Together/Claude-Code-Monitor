/** `v2.10.0-beta.1+abc` → [2, 10, 0]; prerelease / build suffixes are ignored, null when not x.y[.z]. */
export function parseVersion(raw: string): number[] | null {
  const m = /^v?(\d{1,6})\.(\d{1,6})(?:\.(\d{1,6}))?(?:[-+].*)?$/.exec(raw.trim())
  if (!m) return null
  return [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)]
}

/** Clean x.y.z string of a tag (`v2.5.0` → `2.5.0`), null when unparsable. */
export function cleanVersion(raw: string): string | null {
  const v = parseVersion(raw)
  return v ? v.join('.') : null
}

export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) return 0
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1
  return 0
}

export const isNewer = (latest: string, current: string): boolean =>
  parseVersion(latest) !== null && parseVersion(current) !== null && compareVersions(latest, current) > 0
