import { createReadStream, createWriteStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { extractSignals } from '../../../collector/src/transcript'
import { Cancelled, walkTree } from './fsTree'

export interface StripCount {
  images: number
  /** Base64 characters removed (≈ bytes on disk). */
  bytes: number
}

const sizeText = (chars: number): string => {
  const bytes = Math.round((chars * 3) / 4)
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export const stripPlaceholder = (media: string, chars: number): string =>
  `[Image removed by Orrery to save disk space (${media}, ${sizeText(chars)}). The original transcript is in the backup folder chosen in Orrery.]`

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

/**
 * Replaces every `{type: 'image', source: {type: 'base64', data}}` block (pasted images, Read tool results, queued
 * prompts; docs §11ai) with a text block, and empties `toolUseResult.file.base64`, Claude Code's own copy of a Read
 * image. Mutates `rec`.
 */
export function stripRecord(rec: unknown): StripCount {
  const out: StripCount = { images: 0, bytes: 0 }
  const visit = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) v[i] = visit(v[i])
      return v
    }
    if (!isObj(v)) return v
    const src = v.source
    if (v.type === 'image' && isObj(src) && src.type === 'base64' && typeof src.data === 'string') {
      out.images++
      out.bytes += src.data.length
      return { type: 'text', text: stripPlaceholder(typeof src.media_type === 'string' ? src.media_type : 'image', src.data.length) }
    }
    for (const k of Object.keys(v)) v[k] = visit(v[k])
    return v
  }
  visit(rec)
  if (isObj(rec) && isObj(rec.toolUseResult) && isObj(rec.toolUseResult.file) && typeof rec.toolUseResult.file.base64 === 'string') {
    const file = rec.toolUseResult.file as Record<string, unknown>
    const data = file.base64 as string
    if (data.length) {
      out.bytes += data.length
      file.base64 = ''
    }
  }
  return out
}

export interface StrippedLine extends StripCount {
  line: string
}

/** One JSONL line; lines without an image (or not JSON) come back as they were. */
export function stripLine(line: string): StrippedLine {
  if (!line.includes('"base64"')) return { line, images: 0, bytes: 0 }
  let rec: unknown
  try {
    rec = JSON.parse(line)
  } catch {
    return { line, images: 0, bytes: 0 }
  }
  const before = extractSignals(rec).length
  const n = stripRecord(rec)
  if (!n.bytes) return { line, images: 0, bytes: 0 }
  const next = JSON.stringify(rec)
  if (extractSignals(JSON.parse(next)).length !== before) throw new Error('signals changed')
  return { line: next, ...n }
}

async function eachLine(file: string, fn: (line: string) => void | Promise<void>, signal?: AbortSignal): Promise<void> {
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity })
  try {
    for await (const line of rl) {
      if (signal?.aborted) throw new Cancelled()
      await fn(line)
    }
  } finally {
    rl.close()
  }
}

/** Images a file would lose, without writing anything. */
export async function countFile(file: string, signal?: AbortSignal): Promise<StripCount> {
  const out: StripCount = { images: 0, bytes: 0 }
  await eachLine(
    file,
    (line) => {
      const r = stripLine(line)
      out.images += r.images
      out.bytes += r.bytes
    },
    signal,
  )
  return out
}

export interface StripFileResult extends StripCount {
  ok: boolean
  error?: 'changed' | 'invalid'
}

/**
 * Rewrites `file` without images: temp file first, original copied to `backupFile`, then rename; the modified time
 * stays the original's so Claude Code's retention and Orrery's ages see the same session. Every rewritten line is
 * re-parsed and must yield the same transcript signals Orrery reads.
 */
export async function stripFile(file: string, backupFile: string, signal?: AbortSignal): Promise<StripFileResult> {
  const before = await fs.stat(file)
  const tmp = `${file}.orrery-strip-tmp`
  const out = createWriteStream(tmp, { flags: 'w' })
  const total: StripCount = { images: 0, bytes: 0 }
  let lines = 0
  try {
    await eachLine(
      file,
      async (line) => {
        const r = stripLine(line)
        total.images += r.images
        total.bytes += r.bytes
        lines++
        if (!out.write(`${r.line}\n`)) await new Promise<void>((resolve) => out.once('drain', () => resolve()))
      },
      signal,
    )
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
  } catch (err) {
    out.destroy()
    await fs.rm(tmp, { force: true })
    if (err instanceof Cancelled) throw err
    return { ok: false, error: 'invalid', images: 0, bytes: 0 }
  }
  if (!total.bytes) {
    await fs.rm(tmp, { force: true })
    return { ok: true, images: 0, bytes: 0 }
  }
  let check = 0
  let bad = false
  await eachLine(tmp, (line) => {
    check++
    if (!line) return
    try {
      JSON.parse(line)
    } catch {
      bad = true
    }
  })
  const now = await fs.stat(file)
  if (bad || check !== lines) {
    await fs.rm(tmp, { force: true })
    return { ok: false, error: 'invalid', images: 0, bytes: 0 }
  }
  if (now.size !== before.size || now.mtimeMs !== before.mtimeMs) {
    await fs.rm(tmp, { force: true })
    return { ok: false, error: 'changed', images: 0, bytes: 0 }
  }
  await fs.mkdir(path.dirname(backupFile), { recursive: true })
  await fs.copyFile(file, backupFile, fs.constants.COPYFILE_EXCL)
  if ((await fs.stat(backupFile)).size !== before.size) {
    await fs.rm(tmp, { force: true })
    return { ok: false, error: 'invalid', images: 0, bytes: 0 }
  }
  await fs.rename(tmp, file)
  await fs.utimes(file, before.atime, before.mtime).catch(() => undefined)
  return { ok: true, ...total }
}

export interface StripCandidate {
  file: string
  /** Relative to `<config>/projects`. */
  rel: string
  sessionId: string
  size: number
  mtimeMs: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `<slug>/<id>.jsonl` or `<slug>/<id>/subagents/….jsonl` → session id. */
export function sessionOfRel(rel: string): string | null {
  const parts = rel.split(/[\\/]/)
  if (parts.length < 2) return null
  const id = parts.length === 2 ? parts[1]!.replace(/\.jsonl$/, '') : parts[1]!
  return UUID.test(id) ? id : null
}

/** Old transcripts (last write before `cutoffMs`) of sessions not in `running`. */
export async function stripCandidates(projects: string, cutoffMs: number, running: ReadonlySet<string>, signal?: AbortSignal): Promise<StripCandidate[]> {
  const out: StripCandidate[] = []
  await walkTree(
    projects,
    (e) => {
      if (e.type !== 'file' || !e.rel.endsWith('.jsonl') || e.mtimeMs >= cutoffMs) return
      const sessionId = sessionOfRel(e.rel)
      if (!sessionId || running.has(sessionId)) return
      out.push({ file: path.join(projects, e.rel), rel: e.rel, sessionId, size: e.size, mtimeMs: e.mtimeMs })
    },
    signal,
  )
  return out
}

/** Session ids whose `sessions/<pid>.json` names a live pid. */
export async function runningSessions(configDir: string, alive: (pid: number) => boolean): Promise<Set<string>> {
  const out = new Set<string>()
  const dir = path.join(configDir, 'sessions')
  const names = await fs.readdir(dir).catch(() => [] as string[])
  for (const n of names) {
    if (!n.endsWith('.json')) continue
    try {
      const rec = JSON.parse(await fs.readFile(path.join(dir, n), 'utf8')) as { pid?: unknown; sessionId?: unknown }
      if (typeof rec.pid === 'number' && typeof rec.sessionId === 'string' && alive(rec.pid)) out.add(rec.sessionId)
    } catch {
      // half-written by Claude Code
    }
  }
  return out
}
