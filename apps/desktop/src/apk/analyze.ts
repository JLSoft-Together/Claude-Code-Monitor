import { promises as fs } from 'node:fs'
import path from 'node:path'
import { constants as zlibConstants, inflateRawSync } from 'node:zlib'
import type { ApkDiff, ApkFile, ApkFileDelta, ApkGroup, ApkGroupKind, ApkReport, ApkSide, ApkSizes } from '@ccm/shared'
import { readCentralDirectory, ZipError, type ZipEntry } from '../layout/zip'
import { manifestSummary, parseAxml, parseProtoXml } from './manifest'

export const APK_MAX_ENTRIES = 200_000
export const APK_MAX_CD_BYTES = 64 * 1024 * 1024
export const APK_TOP = 20
export const APK_DIFF_FILES = 100
const MANIFEST_MAX = 8 * 1024 * 1024
const DEX_HEAD_COMPRESSED = 4096
const DEX_METHOD_IDS = 0x58

/** Entry name, compressed size, uncompressed size: what a comparison needs of each file. */
export type SnapshotFile = [string, number, number]

export interface ApkSnapshot {
  report: ApkReport
  analyzedAt: number
  files: SnapshotFile[]
}

export class ApkError extends Error {
  constructor(readonly code: 'not-zip' | 'zip64' | 'too-large' | 'read-failed') {
    super(code)
  }
}

export const isApkName = (p: string): boolean => /\.(apk|aab)$/i.test(p)

export function groupOf(name: string, aab: boolean): { id: string; kind: ApkGroupKind; sub: string | null } {
  const g = (kind: ApkGroupKind, sub: string | null = null) => ({ id: sub ? `${kind}:${sub}` : kind, kind, sub })
  if (name.startsWith('META-INF/') || name.startsWith('BUNDLE-METADATA/')) return g('meta')
  let rest = name
  if (aab) {
    const slash = name.indexOf('/')
    if (slash < 0) return g('other')
    const module = name.slice(0, slash)
    if (module !== 'base') return g('module', module)
    rest = name.slice(slash + 1)
    if (rest.startsWith('dex/')) return g('dex')
    if (rest === 'resources.pb') return g('arsc')
  } else {
    if (/^classes\d*\.dex$/.test(rest)) return g('dex')
    if (rest === 'resources.arsc') return g('arsc')
  }
  if (rest.startsWith('res/')) return g('res')
  if (rest.startsWith('assets/')) return g('assets')
  const lib = /^lib\/([^/]+)\//.exec(rest)
  if (lib) return g('lib', lib[1]!)
  return g('other')
}

const GROUP_ORDER: ApkGroupKind[] = ['dex', 'res', 'arsc', 'assets', 'lib', 'module', 'meta', 'other']

export function groupFiles(files: SnapshotFile[], aab: boolean): ApkGroup[] {
  const groups = new Map<string, ApkGroup>()
  for (const [name, compressed, size] of files) {
    const k = groupOf(name, aab)
    const cur = groups.get(k.id) ?? { ...k, compressed: 0, size: 0, files: 0 }
    cur.compressed += compressed
    cur.size += size
    cur.files++
    groups.set(k.id, cur)
  }
  return [...groups.values()].sort((a, b) => GROUP_ORDER.indexOf(a.kind) - GROUP_ORDER.indexOf(b.kind) || b.compressed - a.compressed)
}

export function topFiles(files: SnapshotFile[], n = APK_TOP): ApkFile[] {
  return [...files]
    .sort((a, b) => b[1] - a[1] || b[2] - a[2])
    .slice(0, n)
    .map(([name, compressed, size]) => ({ name, compressed, size }))
}

/** EOCD → central directory bytes, read alone so a 2 GB bundle never lands in memory. */
async function readEntries(fh: fs.FileHandle, fileSize: number): Promise<ZipEntry[]> {
  const tailLen = Math.min(fileSize, 22 + 65535)
  if (tailLen < 22) throw new ApkError('not-zip')
  const tail = Buffer.alloc(tailLen)
  await fh.read(tail, 0, tailLen, fileSize - tailLen)
  let eocd = -1
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new ApkError('not-zip')
  const count = tail.readUInt16LE(eocd + 10)
  const cdSize = tail.readUInt32LE(eocd + 12)
  const cdOffset = tail.readUInt32LE(eocd + 16)
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) throw new ApkError('zip64')
  if (cdSize > APK_MAX_CD_BYTES) throw new ApkError('too-large')
  if (cdOffset + cdSize > fileSize) throw new ApkError('not-zip')
  const cd = Buffer.alloc(fileSize - cdOffset)
  if (cd.length > APK_MAX_CD_BYTES + 22 + 65535) throw new ApkError('too-large')
  await fh.read(cd, 0, cd.length, cdOffset)
  try {
    const { entries } = readCentralDirectory(cd, fileSize)
    if (entries.length > APK_MAX_ENTRIES) throw new ApkError('too-large')
    return entries
  } catch (err) {
    if (err instanceof ZipError) throw new ApkError(err.code === 'zip64' ? 'zip64' : 'not-zip')
    throw err
  }
}

/** Raw (still compressed) bytes of one entry, at most `max` of them. */
async function rawData(fh: fs.FileHandle, e: ZipEntry, fileSize: number, max: number): Promise<Buffer | null> {
  const head = Buffer.alloc(30)
  await fh.read(head, 0, 30, e.localOffset)
  if (head.readUInt32LE(0) !== 0x04034b50) return null
  const at = e.localOffset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28)
  const len = Math.min(e.compressedSize, max)
  if (at + len > fileSize) return null
  const buf = Buffer.alloc(len)
  if (len) await fh.read(buf, 0, len, at)
  return buf
}

async function entryData(fh: fs.FileHandle, e: ZipEntry, fileSize: number): Promise<Buffer | null> {
  if (e.size > MANIFEST_MAX || e.compressedSize > MANIFEST_MAX || (e.method !== 0 && e.method !== 8)) return null
  const raw = await rawData(fh, e, fileSize, e.compressedSize)
  if (!raw) return null
  try {
    return e.method === 8 ? inflateRawSync(raw, { maxOutputLength: Math.max(1, e.size) }) : raw
  } catch {
    return null
  }
}

/** `method_ids_size` from a dex header; only the first compressed KBs are inflated. */
async function dexMethods(fh: fs.FileHandle, e: ZipEntry, fileSize: number): Promise<number | null> {
  if (e.method !== 0 && e.method !== 8) return null
  const raw = await rawData(fh, e, fileSize, e.method === 8 ? DEX_HEAD_COMPRESSED : 0x70)
  if (!raw) return null
  let head: Buffer
  try {
    head = e.method === 8 ? inflateRawSync(raw, { finishFlush: zlibConstants.Z_SYNC_FLUSH }) : raw
  } catch {
    return null
  }
  if (head.length < 0x70 || head.toString('latin1', 0, 4) !== 'dex\n') return null
  return head.readUInt32LE(DEX_METHOD_IDS)
}

export async function analyzeApk(file: string, now = Date.now()): Promise<ApkSnapshot> {
  let fh: fs.FileHandle
  try {
    fh = await fs.open(file, 'r')
  } catch {
    throw new ApkError('read-failed')
  }
  try {
    const st = await fh.stat()
    if (!st.isFile()) throw new ApkError('read-failed')
    const entries = (await readEntries(fh, st.size)).filter((e) => !e.name.endsWith('/'))
    const aab = /\.aab$/i.test(file) || entries.some((e) => e.name === 'BundleConfig.pb')
    const files: SnapshotFile[] = entries.map((e) => [e.name, e.compressedSize, e.size])
    const manifestEntry = entries.find((e) => e.name === (aab ? 'base/manifest/AndroidManifest.xml' : 'AndroidManifest.xml'))
    const manifestBytes = manifestEntry ? await entryData(fh, manifestEntry, st.size) : null
    const manifest = manifestBytes ? manifestSummary(aab ? parseProtoXml(manifestBytes) : parseAxml(manifestBytes)) : null
    const dexEntries = entries.filter((e) => groupOf(e.name, aab).kind === 'dex' && e.name.endsWith('.dex'))
    let methods: number | null = null
    for (const e of dexEntries) {
      const n = await dexMethods(fh, e, st.size)
      if (n !== null) methods = (methods ?? 0) + n
    }
    const report: ApkReport = {
      path: file,
      name: path.basename(file),
      kind: aab ? 'aab' : 'apk',
      fileSize: st.size,
      mtime: st.mtimeMs,
      entries: files.length,
      compressed: files.reduce((n, f) => n + f[1], 0),
      size: files.reduce((n, f) => n + f[2], 0),
      groups: groupFiles(files, aab),
      top: topFiles(files),
      manifest,
      dexMethods: methods,
      dexFiles: dexEntries.length,
    }
    return { report, analyzedAt: now, files }
  } catch (err) {
    if (err instanceof ApkError) throw err
    throw new ApkError('read-failed')
  } finally {
    await fh.close()
  }
}

export function sideOf(s: ApkSnapshot): ApkSide {
  const r = s.report
  return {
    name: r.name,
    fileSize: r.fileSize,
    compressed: r.compressed,
    size: r.size,
    versionName: r.manifest?.versionName ?? null,
    versionCode: r.manifest?.versionCode ?? null,
    analyzedAt: s.analyzedAt,
  }
}

const sizes = (f: SnapshotFile | undefined): ApkSizes | null => (f ? { compressed: f[1], size: f[2] } : null)
const delta = (d: ApkFileDelta): number => Math.abs((d.after?.compressed ?? 0) - (d.before?.compressed ?? 0)) || Math.abs((d.after?.size ?? 0) - (d.before?.size ?? 0))

/** `before` → `after`: per group and per file; file lists keep the `limit` largest changes. */
export function compareSnapshots(before: ApkSnapshot, after: ApkSnapshot, limit = APK_DIFF_FILES): ApkDiff {
  const old = new Map(before.files.map((f) => [f[0], f]))
  const cur = new Map(after.files.map((f) => [f[0], f]))
  const added: ApkFileDelta[] = []
  const removed: ApkFileDelta[] = []
  const changed: ApkFileDelta[] = []
  for (const [name, f] of cur) {
    const o = old.get(name)
    if (!o) added.push({ name, before: null, after: sizes(f) })
    else if (o[1] !== f[1] || o[2] !== f[2]) changed.push({ name, before: sizes(o), after: sizes(f) })
  }
  for (const [name, f] of old) if (!cur.has(name)) removed.push({ name, before: sizes(f), after: null })
  const byDelta = (a: ApkFileDelta, b: ApkFileDelta) => delta(b) - delta(a) || a.name.localeCompare(b.name)
  const groupsBefore = new Map(before.report.groups.map((g) => [g.id, g]))
  const groupsAfter = new Map(after.report.groups.map((g) => [g.id, g]))
  const ids = [...new Set([...groupsAfter.keys(), ...groupsBefore.keys()])]
  const groups = ids.map((id) => {
    const b = groupsBefore.get(id)
    const a = groupsAfter.get(id)
    const g = (a ?? b)!
    return { id, kind: g.kind, sub: g.sub, before: b ? { compressed: b.compressed, size: b.size } : null, after: a ? { compressed: a.compressed, size: a.size } : null }
  })
  groups.sort((x, y) => GROUP_ORDER.indexOf(x.kind) - GROUP_ORDER.indexOf(y.kind) || (y.after?.compressed ?? 0) - (x.after?.compressed ?? 0))
  return {
    before: sideOf(before),
    after: sideOf(after),
    groups,
    added: added.sort(byDelta).slice(0, limit),
    removed: removed.sort(byDelta).slice(0, limit),
    changed: changed.sort(byDelta).slice(0, limit),
    addedCount: added.length,
    removedCount: removed.length,
    changedCount: changed.length,
  }
}
