import { createHash } from 'node:crypto'
import { createWriteStream, mkdirSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'
import type { UpdateError, UpdateProgress } from '@ccm/shared'
import { isAllowedDownload, type FetchFn } from './github'
import type { FeedAsset } from './pick'

export interface DownloadOptions {
  asset: FeedAsset
  dir: string
  fetch: FetchFn
  allowLocal: boolean
  signal: AbortSignal
  onProgress: (p: UpdateProgress) => void
  now?: () => number
}

export type DownloadResult = { ok: true; file: string } | { ok: false; error: UpdateError | 'cancelled' }

const PROGRESS_MS = 250
const SPEED_WINDOW_MS = 3_000

/** Safe file name inside `dir`: the asset name without folders or odd characters. */
export function localName(name: string): string | null {
  const base = path.basename(name)
  return /^[\w.-]{1,120}$/.test(base) && !base.startsWith('.') ? base : null
}

/** Streams to `<dir>/<name>.part`, hashing as it goes; renamed only when size and SHA-256 match the feed. */
export async function downloadAsset(opts: DownloadOptions): Promise<DownloadResult> {
  const { asset, dir, signal } = opts
  const now = opts.now ?? Date.now
  const name = localName(asset.name)
  if (!name) return { ok: false, error: 'no-asset' }
  if (!asset.sha256) return { ok: false, error: 'no-digest' }
  if (!isAllowedDownload(asset.url, opts.allowLocal)) return { ok: false, error: 'download' }
  const final = path.join(dir, name)
  const part = `${final}.part`
  try {
    mkdirSync(dir, { recursive: true })
    rmSync(part, { force: true })
  } catch {
    return { ok: false, error: 'disk' }
  }
  let res: Response
  try {
    res = await opts.fetch(asset.url, { signal })
  } catch {
    return { ok: false, error: signal.aborted ? 'cancelled' : 'offline' }
  }
  // Redirects are followed by fetch; the host that finally served the bytes must still be GitHub's.
  if (!res.ok || !res.body || (res.url && !isAllowedDownload(res.url, opts.allowLocal))) return { ok: false, error: 'download' }
  const total = asset.size
  const hash = createHash('sha256')
  const out = createWriteStream(part)
  let failed = false
  out.on('error', () => (failed = true))
  const samples: [number, number][] = [[now(), 0]]
  let received = 0
  let lastEmit = 0
  const reader = res.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (failed) throw new Error('disk')
      received += value.byteLength
      if (received > total) throw new Error('size')
      hash.update(value)
      if (!out.write(value)) await new Promise<void>((resolve) => out.once('drain', resolve))
      const t = now()
      if (t - lastEmit >= PROGRESS_MS) {
        lastEmit = t
        samples.push([t, received])
        while (samples.length > 2 && t - samples[0]![0] > SPEED_WINDOW_MS) samples.shift()
        const [t0, r0] = samples[0]!
        opts.onProgress({ received, total, bps: t > t0 ? Math.round(((received - r0) * 1000) / (t - t0)) : 0 })
      }
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
  } catch (err) {
    out.destroy()
    void reader.cancel().catch(() => undefined)
    rmSync(part, { force: true })
    if (signal.aborted) return { ok: false, error: 'cancelled' }
    return { ok: false, error: failed || (err as Error).message === 'disk' ? 'disk' : 'download' }
  }
  opts.onProgress({ received, total, bps: 0 })
  if (failed || received !== total || hash.digest('hex') !== asset.sha256) {
    rmSync(part, { force: true })
    return { ok: false, error: failed ? 'disk' : received !== total ? 'download' : 'digest' }
  }
  try {
    rmSync(final, { force: true })
    renameSync(part, final)
  } catch {
    rmSync(part, { force: true })
    return { ok: false, error: 'disk' }
  }
  return { ok: true, file: final }
}
