import type { FeedAsset } from './pick'
import { cleanVersion } from './semver'

export const DEFAULT_FEED = 'https://api.github.com/repos/JLSoft-Together/Claude-Code-Monitor/releases/latest'
export const RELEASES_PAGE = 'https://github.com/JLSoft-Together/Claude-Code-Monitor/releases/latest'
const NOTES_MAX = 40_000

export interface FeedRelease {
  version: string
  name: string
  date: string | null
  notes: string
  url: string
  assets: FeedAsset[]
}

export function parseDigest(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const m = /^sha256:([0-9a-f]{64})$/i.exec(raw.trim())
  return m ? m[1]!.toLowerCase() : null
}

const isLocal = (u: URL): boolean => u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')

function parseUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string') return null
  try {
    return new URL(raw)
  } catch {
    return null
  }
}

/** Feed: api.github.com only; a loopback http feed only while CCM_UPDATE_FEED (E2E) is set. */
export function isAllowedFeed(raw: string, allowLocal: boolean): boolean {
  const u = parseUrl(raw)
  if (!u) return false
  return (u.protocol === 'https:' && u.hostname === 'api.github.com') || (allowLocal && isLocal(u))
}

/** Downloads: github.com and the *.githubusercontent.com hosts its release links redirect to. */
export function isAllowedDownload(raw: string, allowLocal: boolean): boolean {
  const u = parseUrl(raw)
  if (!u) return false
  if (allowLocal && isLocal(u)) return true
  if (u.protocol !== 'https:' || u.username || u.password) return false
  return u.hostname === 'github.com' || u.hostname.endsWith('.githubusercontent.com')
}

export function isAllowedPage(raw: string, allowLocal: boolean): boolean {
  const u = parseUrl(raw)
  if (!u) return false
  return (u.protocol === 'https:' && u.hostname === 'github.com') || (allowLocal && isLocal(u))
}

/** GitHub `releases/latest` JSON → release; drafts, prereleases and malformed entries are dropped. */
export function parseRelease(json: unknown, allowLocal = false): FeedRelease | null {
  if (!json || typeof json !== 'object') return null
  const r = json as Record<string, unknown>
  if (r.draft === true || r.prerelease === true || typeof r.tag_name !== 'string') return null
  const version = cleanVersion(r.tag_name)
  if (!version) return null
  const url = typeof r.html_url === 'string' && isAllowedPage(r.html_url, allowLocal) ? r.html_url : RELEASES_PAGE
  const assets: FeedAsset[] = []
  for (const raw of Array.isArray(r.assets) ? r.assets : []) {
    if (!raw || typeof raw !== 'object') continue
    const a = raw as Record<string, unknown>
    if (typeof a.name !== 'string' || typeof a.browser_download_url !== 'string' || typeof a.size !== 'number' || !(a.size > 0)) continue
    if (!isAllowedDownload(a.browser_download_url, allowLocal)) continue
    assets.push({ name: a.name, size: a.size, url: a.browser_download_url, sha256: parseDigest(a.digest) })
  }
  const date = typeof r.published_at === 'string' && !Number.isNaN(Date.parse(r.published_at)) ? r.published_at : null
  const notes = typeof r.body === 'string' ? r.body.slice(0, NOTES_MAX) : ''
  const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 200) : version
  return { version, name, date, notes, url, assets }
}

export type FeedResult = { ok: true; release: FeedRelease | null } | { ok: false; error: 'offline' | 'feed' }

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export async function fetchLatest(feed: string, fetch: FetchFn, allowLocal: boolean, timeoutMs = 15_000): Promise<FeedResult> {
  if (!isAllowedFeed(feed, allowLocal)) return { ok: false, error: 'feed' }
  let res: Response
  try {
    res = await fetch(feed, {
      headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28' },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    return { ok: false, error: 'offline' }
  }
  // No published release yet.
  if (res.status === 404) return { ok: true, release: null }
  if (!res.ok) return { ok: false, error: 'feed' }
  try {
    return { ok: true, release: parseRelease(await res.json(), allowLocal) }
  } catch {
    return { ok: false, error: 'feed' }
  }
}
