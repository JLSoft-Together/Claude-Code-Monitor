/** `codewhale 0.10.2 (ff466b2ed0bf)` → `0.10.2`. */
export function parseVersion(out: string): string | null {
  return /\bcodewhale\s+v?(\d+\.\d+\.\d+[\w.-]*)/i.exec(out)?.[1] ?? null
}

/**
 * `codewhale auth status` table (`provider config keyring env status`): the `deepseek` row's status column.
 * `unset` / `missing` = no key; anything else is a usable route. null when the row is absent (unknown format).
 */
export function parseAuthStatus(out: string, provider = 'deepseek'): boolean | null {
  for (const line of out.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/)
    if (cols[0] !== provider || cols.length < 5) continue
    const status = cols[4]!.toLowerCase()
    return !(status.startsWith('unset') || status.startsWith('missing'))
  }
  return null
}

/** `codewhale config get telemetry` → `Usage reporting: On (default)`. */
export function parseTelemetry(out: string): boolean | null {
  const m = /usage reporting:\s*(on|off)\b/i.exec(out)
  return m ? m[1]!.toLowerCase() === 'on' : null
}

export interface DownloadProgress {
  mb: number
  totalMb: number | null
  pct: number | null
}

/** npm wrapper's first run: `codewhale: downloading <asset>: 12 / 128 MB (9%)` or `…: 12 MB downloaded`. */
export function parseDownloadProgress(line: string): DownloadProgress | null {
  const full = /downloading\s+\S+:\s*(\d+)\s*\/\s*(\d+)\s*MB\s*\((\d+)%\)/i.exec(line)
  if (full) return { mb: Number(full[1]), totalMb: Number(full[2]), pct: Math.min(100, Number(full[3])) }
  const open = /downloading\s+\S+:\s*(\d+)\s*MB downloaded/i.exec(line)
  return open ? { mb: Number(open[1]), totalMb: null, pct: null } : null
}

/** `codewhale doctor --check-updates` section `Updates:` → `· current: v0.10.2` / `· latest: v0.10.2`. */
export function parseDoctorUpdates(out: string): { current: string; latest: string } | null {
  const section = out.split(/\r?\n(?=\S)/).find((s) => /^Updates:/i.test(s))
  if (!section) return null
  const field = (name: string): string | null => new RegExp(`^\\s*\\S?\\s*${name}:\\s*v?(\\d+\\.\\d+\\.\\d+[\\w.-]*)`, 'im').exec(section)?.[1] ?? null
  const current = field('current')
  const latest = field('latest')
  return current && latest ? { current, latest } : null
}

/** Numeric dotted compare of `x.y.z[-pre]`; a pre-release sorts before its release. */
export function compareVersions(a: string, b: string): number {
  const split = (v: string): [number[], string] => {
    const [core = '', pre = ''] = v.split('-', 2)
    return [core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre]
  }
  const [ca, pa] = split(a)
  const [cb, pb] = split(b)
  for (let i = 0; i < Math.max(ca.length, cb.length); i++) {
    const d = (ca[i] ?? 0) - (cb[i] ?? 0)
    if (d) return Math.sign(d)
  }
  if (pa === pb) return 0
  if (!pa) return 1
  if (!pb) return -1
  return pa < pb ? -1 : 1
}

/** API key as pasted: trimmed, printable ASCII without spaces, sane length; null = reject. */
export function cleanApiKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const key = raw.trim()
  if (key.length < 8 || key.length > 512) return null
  return /^[\x21-\x7e]+$/.test(key) ? key : null
}
