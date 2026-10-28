import { baseRev, safeRepoPath } from './changes'
import { execGit } from './gitExec'

export type HeadImage =
  | { ok: true; dataUrl: string; size: number }
  | { ok: false; error: 'denied' | 'unsupported' | 'missing' | 'too-large' | 'failed' }

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
}

export const imageMime = (rel: string): string | null => MIME[/\.([a-z0-9]+)$/i.exec(rel)?.[1]?.toLowerCase() ?? ''] ?? null

/** HEAD's copy of an image in `root` (already a known repo toplevel) as a data URL; `rel` relative to the repo. */
export async function headImage(root: string, relInput: unknown): Promise<HeadImage> {
  const safe = safeRepoPath(root, relInput)
  if (!safe) return { ok: false, error: 'denied' }
  const mime = imageMime(safe.rel)
  if (!mime) return { ok: false, error: 'unsupported' }
  if ((await baseRev(root)) !== 'HEAD') return { ok: false, error: 'missing' }
  const spec = `HEAD:${safe.rel}`
  const kind = await execGit(root, ['cat-file', '-t', spec], { maxBytes: 64, timeoutMs: 10_000 })
  if (kind.code !== 0 || kind.stdout.trim() !== 'blob') return { ok: false, error: 'missing' }
  const size = await execGit(root, ['cat-file', '-s', spec], { maxBytes: 64, timeoutMs: 10_000 })
  const bytes = Number(size.stdout.trim())
  if (size.code !== 0 || !Number.isFinite(bytes)) return { ok: false, error: 'failed' }
  if (bytes > MAX_IMAGE_BYTES) return { ok: false, error: 'too-large' }
  const blob = await execGit(root, ['cat-file', 'blob', spec], { binary: true, maxBytes: MAX_IMAGE_BYTES, timeoutMs: 20_000 })
  if (blob.code !== 0 || blob.truncated || !blob.bytes) return { ok: false, error: 'failed' }
  return { ok: true, dataUrl: `data:${mime};base64,${blob.bytes.toString('base64')}`, size: blob.bytes.length }
}
