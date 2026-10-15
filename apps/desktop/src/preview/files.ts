import { promises as fs } from 'node:fs'
import path from 'node:path'
import { realOrNull, realRoots, rootOf } from './paths'

export type FileViewKind = 'text' | 'image' | 'binary' | 'too-large' | 'missing' | 'denied'

export interface FileView {
  kind: FileViewKind
  /** Real path that was read (symlinks resolved). */
  path: string
  size: number
  mtimeMs: number
  text?: string
  /** Lowercase extension (or file name for Dockerfile / Makefile); the renderer maps it to a grammar. */
  lang?: string
  /** Text only: the file starts with a UTF-8 BOM (stripped from `text`, kept on save). */
  bom?: boolean
  /** Text only: line break style on disk (dominant one when mixed); saves write it back. */
  eol?: Eol
  /** Text only: not valid UTF-8, `text` is a lossy decode; the editor refuses it. */
  invalidUtf8?: boolean
}

export type Eol = 'lf' | 'crlf' | 'cr'

/** Dominant line break of a text; LF when it has none. */
export function eolOf(text: string): Eol {
  let crlf = 0
  let lf = 0
  let cr = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        crlf++
        i++
      } else cr++
    } else if (c === 10) lf++
  }
  if (crlf > 0 && crlf >= lf && crlf >= cr) return 'crlf'
  return cr > lf ? 'cr' : 'lf'
}

export const hasUtf8Bom = (buf: Uint8Array): boolean => buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf

/** Strict UTF-8 decode (BOM removed); null when the bytes are not valid UTF-8. */
export function decodeUtf8(buf: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(hasUtf8Bom(buf) ? buf.subarray(3) : buf)
  } catch {
    return null
  }
}

export const MAX_VIEW_BYTES = 2 * 1024 * 1024
const SNIFF_BYTES = 8 * 1024
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp', 'avif'])
const NAMED = new Set(['dockerfile', 'makefile'])

export function langOf(file: string): string | undefined {
  const base = path.basename(file).toLowerCase()
  if (NAMED.has(base)) return base
  const ext = path.extname(base).slice(1)
  return ext || undefined
}

const empty = (kind: FileViewKind, file: string): FileView => ({ kind, path: file, size: 0, mtimeMs: 0 })

/** Read-only view of a file the page asked for; it must resolve (realpath) inside one of `allowedRoots`. */
export async function readFileForView(file: string, allowedRoots: readonly string[], maxBytes = MAX_VIEW_BYTES): Promise<FileView> {
  if (typeof file !== 'string' || !path.isAbsolute(file)) return empty('denied', String(file))
  const roots = await realRoots(allowedRoots)
  const real = await realOrNull(file)
  if (!real) return empty(rootOf(path.resolve(file), roots) ? 'missing' : 'denied', file)
  if (!rootOf(real, roots)) return empty('denied', file)
  const stat = await fs.stat(real).catch(() => null)
  if (!stat?.isFile()) return empty('missing', real)
  const base = { path: real, size: stat.size, mtimeMs: stat.mtimeMs, lang: langOf(real) }
  if (IMAGE_EXT.has(path.extname(real).slice(1).toLowerCase())) return { kind: 'image', ...base }
  if (stat.size > maxBytes) return { kind: 'too-large', ...base }
  const buf = await fs.readFile(real).catch(() => null)
  if (!buf) return empty('missing', real)
  if (buf.subarray(0, SNIFF_BYTES).includes(0)) return { kind: 'binary', ...base }
  const strict = decodeUtf8(buf)
  const text = strict ?? buf.toString('utf8').replace(/^﻿/, '')
  return { kind: 'text', ...base, size: buf.length, text, bom: hasUtf8Bom(buf), eol: eolOf(text), ...(strict === null ? { invalidUtf8: true } : {}) }
}
