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
  const text = buf.toString('utf8').replace(/^﻿/, '')
  return { kind: 'text', ...base, size: buf.length, text }
}
