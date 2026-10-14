// CSI, OSC (BEL or ST terminated), and single-char escapes.
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g

export const stripAnsi = (s: string): string => s.replace(ANSI, '')

const URL_RE = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):\d{2,5}(?:\/[^\s'"<>)\]}]*)?/gi
const MARKER = /(?:\b(?:local|ready|listening|server running|running (?:at|on)|started|serving|available (?:at|on)|dev server|preview|on your network)\b|➜)/i
// A URL may sit on the line after its marker ("Server running" / blank / "  http://…").
const MARKER_REACH = 2
const MAX_PARTIAL = 4096

/** Canonical form shown in the chip: 0.0.0.0 / [::] → localhost, trailing punctuation dropped. */
export function normalizeDevUrl(raw: string): string | null {
  const text = raw.replace(/[.,;:!?]+$/, '')
  try {
    const u = new URL(text)
    const port = Number(u.port)
    if (!port || port > 65535) return null
    if (u.hostname === '0.0.0.0' || u.hostname === '[::]' || u.hostname === '[::1]' || u.hostname === '[::0]') u.hostname = 'localhost'
    return u.href
  } catch {
    return null
  }
}

/** Loopback URLs on one already ANSI-stripped line. */
export const urlsIn = (line: string): string[] => [...line.matchAll(URL_RE)].map((m) => normalizeDevUrl(m[0])).filter((u): u is string => !!u)

export const devUrlLabel = (url: string): string => {
  try {
    const u = new URL(url)
    return `${u.hostname}:${u.port}`
  } catch {
    return url
  }
}

/**
 * Line-buffered scanner for one pane's PTY output: returns dev-server URLs the first time each
 * origin (host:port) appears near a "Local: / ready / listening…" marker.
 */
export class DevServerDetector {
  private partial = ''
  private sinceMarker = Infinity
  private seen = new Set<string>()
  readonly urls: string[] = []

  feed(chunk: string): string[] {
    const found: string[] = []
    const text = this.partial + chunk
    const lines = text.split(/\r\n|\n|\r/)
    this.partial = (lines.pop() ?? '').slice(-MAX_PARTIAL)
    for (const raw of lines) {
      const line = stripAnsi(raw)
      if (MARKER.test(line)) this.sinceMarker = 0
      else if (line.trim()) this.sinceMarker++
      if (this.sinceMarker > MARKER_REACH) continue
      for (const url of urlsIn(line)) {
        const origin = new URL(url).host
        if (this.seen.has(origin)) continue
        this.seen.add(origin)
        this.urls.push(url)
        found.push(url)
      }
    }
    return found
  }

  /** Forget a URL (server stopped / user dismissed), so the next start shows it again. */
  forget(url: string): void {
    try {
      this.seen.delete(new URL(url).host)
    } catch {
      return
    }
    const i = this.urls.indexOf(url)
    if (i >= 0) this.urls.splice(i, 1)
  }

  reset(): void {
    this.partial = ''
    this.sinceMarker = Infinity
    this.seen.clear()
    this.urls.length = 0
  }
}

const DEV_URL_KEY = 'ccm.workspace.devUrl'

/** Last dev URL per project folder (localStorage), offered in `+` → Browser. */
export function rememberDevUrl(project: string, url: string): void {
  try {
    const map = JSON.parse(localStorage.getItem(DEV_URL_KEY) ?? '{}') as Record<string, string>
    map[project] = url
    const keys = Object.keys(map)
    for (const k of keys.slice(0, Math.max(0, keys.length - 50))) delete map[k]
    localStorage.setItem(DEV_URL_KEY, JSON.stringify(map))
  } catch {
    // storage unavailable
  }
}

export function lastDevUrl(project: string): string | null {
  try {
    const url = (JSON.parse(localStorage.getItem(DEV_URL_KEY) ?? '{}') as Record<string, unknown>)[project]
    return typeof url === 'string' && normalizeDevUrl(url) ? url : null
  } catch {
    return null
  }
}
