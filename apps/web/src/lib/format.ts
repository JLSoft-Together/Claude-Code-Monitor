import { ref } from 'vue'

export const now = ref(Date.now())
let ticking = false

export function startClock(): void {
  if (ticking) return
  ticking = true
  setInterval(() => {
    now.value = Date.now()
  }, 1_000)
}

const ts = (iso: string | undefined): number | null => {
  if (!iso) return null
  const n = Date.parse(iso)
  return Number.isFinite(n) ? n : null
}

export function relativeTime(iso: string | number | undefined | null, locale: string, nowMs: number): string | null {
  const t = typeof iso === 'number' ? iso : ts(iso ?? undefined)
  if (t === null) return null
  const sec = Math.round((t - nowMs) / 1000)
  const abs = Math.abs(sec)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' })
  if (abs < 60) return rtf.format(sec, 'second')
  if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), 'hour')
  return rtf.format(Math.round(sec / 86400), 'day')
}

export function duration(fromIso: string | undefined, toMs: number): string | null {
  const from = ts(fromIso)
  if (from === null) return null
  let s = Math.max(0, Math.floor((toMs - from) / 1000))
  const h = Math.floor(s / 3600)
  s -= h * 3600
  const m = Math.floor(s / 60)
  s -= m * 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

export function clockTime(iso: string, locale: string): string {
  const t = ts(iso)
  if (t === null) return ''
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(t)
}

export function compactNumber(n: number | undefined, _locale?: string): string {
  if (n === undefined) return ''
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

export function fullNumber(n: number | undefined, locale: string): string {
  if (n === undefined) return '0'
  return new Intl.NumberFormat(locale).format(n)
}

export function shortPath(path: string | undefined): string {
  if (!path) return ''
  const parts = path.split(/[\\/]+/).filter(Boolean)
  if (parts.length <= 2) return path
  return `…/${parts.slice(-2).join('/')}`
}
