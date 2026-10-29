import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { analyzeApk, compareSnapshots, groupFiles, groupOf, topFiles, type ApkSnapshot, type SnapshotFile } from '../src/apk/analyze'
import { ApkHistory } from '../src/apk/history'
import { registerApkIpc } from '../src/apk/ipc'
import { manifestSummary, parseAxml, parseProtoXml } from '../src/apk/manifest'
import { makeZip } from './make-zip'

/** Tiny AXML writer: UTF-16 pool, resource map for the first `ids.length` strings, nested elements. */
type El = { name: string; attrs: [string, { str: string } | { int: number } | { bool: boolean }][]; children?: El[] }
function axml(root: El, ids: number[], strings: string[]): Buffer {
  const idx = (s: string): number => {
    let i = strings.indexOf(s)
    if (i < 0) i = strings.push(s) - 1
    return i
  }
  const body: Buffer[] = []
  const walk = (el: El): void => {
    const attrs = el.attrs.map(([name, v]) => {
      const a = Buffer.alloc(20)
      a.writeUInt32LE(0xffffffff, 0)
      a.writeUInt32LE(idx(name), 4)
      a.writeUInt16LE(8, 12)
      if ('str' in v) {
        a.writeUInt32LE(idx(v.str), 8)
        a[15] = 0x03
        a.writeUInt32LE(idx(v.str), 16)
      } else {
        a.writeUInt32LE(0xffffffff, 8)
        a[15] = 'int' in v ? 0x10 : 0x12
        a.writeUInt32LE('int' in v ? v.int : v.bool ? 0xffffffff : 0, 16)
      }
      return a
    })
    const start = Buffer.alloc(36)
    start.writeUInt16LE(0x0102, 0)
    start.writeUInt16LE(16, 2)
    start.writeUInt32LE(36 + 20 * attrs.length, 4)
    start.writeUInt32LE(0xffffffff, 12)
    start.writeUInt32LE(0xffffffff, 16)
    start.writeUInt32LE(idx(el.name), 20)
    start.writeUInt16LE(20, 24)
    start.writeUInt16LE(20, 26)
    start.writeUInt16LE(attrs.length, 28)
    body.push(start, ...attrs)
    for (const c of el.children ?? []) walk(c)
    const end = Buffer.alloc(24)
    end.writeUInt16LE(0x0103, 0)
    end.writeUInt16LE(16, 2)
    end.writeUInt32LE(24, 4)
    end.writeUInt32LE(0xffffffff, 16)
    end.writeUInt32LE(idx(el.name), 20)
    body.push(end)
  }
  walk(root)
  const strData = Buffer.concat(strings.map((s) => {
    const b = Buffer.alloc(2 + s.length * 2 + 2)
    b.writeUInt16LE(s.length, 0)
    b.write(s, 2, 'utf16le')
    return b
  }))
  const padded = Buffer.concat([strData, Buffer.alloc((4 - (strData.length % 4)) % 4)])
  const offsets = Buffer.alloc(strings.length * 4)
  let off = 0
  strings.forEach((s, i) => {
    offsets.writeUInt32LE(off, i * 4)
    off += 4 + s.length * 2
  })
  const poolHead = Buffer.alloc(28)
  poolHead.writeUInt16LE(0x0001, 0)
  poolHead.writeUInt16LE(28, 2)
  poolHead.writeUInt32LE(28 + offsets.length + padded.length, 4)
  poolHead.writeUInt32LE(strings.length, 8)
  poolHead.writeUInt32LE(28 + offsets.length, 20)
  const map = Buffer.alloc(8 + ids.length * 4)
  map.writeUInt16LE(0x0180, 0)
  map.writeUInt16LE(8, 2)
  map.writeUInt32LE(map.length, 4)
  ids.forEach((id, i) => map.writeUInt32LE(id, 8 + i * 4))
  const rest = Buffer.concat([poolHead, offsets, padded, map, ...body])
  const head = Buffer.alloc(8)
  head.writeUInt16LE(0x0003, 0)
  head.writeUInt16LE(8, 2)
  head.writeUInt32LE(8 + rest.length, 4)
  return Buffer.concat([head, rest])
}

const MANIFEST: El = {
  name: 'manifest',
  attrs: [
    ['', { int: 42 }],
    ['versionName', { str: '1.2.3' }],
    ['package', { str: 'com.example.app' }],
  ],
  children: [
    { name: 'uses-sdk', attrs: [['minSdkVersion', { int: 24 }], ['targetSdkVersion', { int: 35 }]] },
    { name: 'uses-permission', attrs: [['name', { str: 'android.permission.INTERNET' }]] },
    { name: 'uses-permission', attrs: [['name', { str: 'android.permission.CAMERA' }]] },
    { name: 'application', attrs: [['debuggable', { bool: true }]] },
  ],
}
// String 0 is the stripped name of versionCode: only the resource map tells what it is.
const apkManifest = () => axml(MANIFEST, [0x0101021b], [''])

function pb(no: number, payload: Buffer | string): Buffer {
  const data = typeof payload === 'string' ? Buffer.from(payload) : payload
  const varint = (n: number): Buffer => {
    const out: number[] = []
    while (n > 0x7f) {
      out.push((n & 0x7f) | 0x80)
      n >>>= 7
    }
    out.push(n)
    return Buffer.from(out)
  }
  return Buffer.concat([varint((no << 3) | 2), varint(data.length), data])
}
const pbAttr = (name: string, value: string) => pb(4, Buffer.concat([pb(2, name), pb(3, value)]))
const pbElement = (name: string, attrs: Buffer[], children: Buffer[] = []) => Buffer.concat([pb(3, name), ...attrs, ...children.map((c) => pb(5, pb(1, c)))])
const aabManifest = () =>
  pb(1, pbElement('manifest', [pbAttr('versionCode', '7'), pbAttr('versionName', '2.0'), pbAttr('package', 'com.x')], [pbElement('uses-sdk', [pbAttr('minSdkVersion', '26'), pbAttr('targetSdkVersion', '35')])]))

function dex(methods: number): Buffer {
  const b = Buffer.alloc(0x200)
  b.write('dex\n035\0', 0, 'latin1')
  b.writeUInt32LE(methods, 0x58)
  return b
}

describe('apk manifest', () => {
  it('parses binary XML with a stripped attribute name', () => {
    const m = manifestSummary(parseAxml(apkManifest()))
    expect(m).toEqual({
      pkg: 'com.example.app',
      versionCode: '42',
      versionName: '1.2.3',
      minSdk: '24',
      targetSdk: '35',
      compileSdk: null,
      debuggable: true,
      permissions: ['android.permission.CAMERA', 'android.permission.INTERNET'],
    })
  })

  it('parses the proto manifest of a bundle', () => {
    expect(manifestSummary(parseProtoXml(aabManifest()))).toMatchObject({ pkg: 'com.x', versionCode: '7', versionName: '2.0', minSdk: '26', targetSdk: '35', permissions: [] })
  })

  it('rejects junk', () => {
    expect(parseAxml(Buffer.from('<manifest/>'))).toBeNull()
    expect(parseAxml(Buffer.alloc(3))).toBeNull()
    expect(parseProtoXml(Buffer.from([0x0a, 0xff]))).toBeNull()
    expect(manifestSummary(null)).toBeNull()
  })
})

describe('apk groups', () => {
  it('groups APK and AAB layouts', () => {
    expect(groupOf('classes2.dex', false).kind).toBe('dex')
    expect(groupOf('lib/arm64-v8a/libx.so', false)).toEqual({ id: 'lib:arm64-v8a', kind: 'lib', sub: 'arm64-v8a' })
    expect(groupOf('resources.arsc', false).kind).toBe('arsc')
    expect(groupOf('META-INF/CERT.RSA', false).kind).toBe('meta')
    expect(groupOf('kotlin/x.kotlin_builtins', false).kind).toBe('other')
    expect(groupOf('base/dex/classes.dex', true).kind).toBe('dex')
    expect(groupOf('base/resources.pb', true).kind).toBe('arsc')
    expect(groupOf('base/lib/x86_64/a.so', true).id).toBe('lib:x86_64')
    expect(groupOf('camera/dex/classes.dex', true)).toEqual({ id: 'module:camera', kind: 'module', sub: 'camera' })
    expect(groupOf('BundleConfig.pb', true).kind).toBe('other')
    expect(groupOf('BUNDLE-METADATA/x', true).kind).toBe('meta')
  })

  it('sums groups and picks the largest files', () => {
    const files: SnapshotFile[] = [['classes.dex', 10, 30], ['classes2.dex', 5, 9], ['res/a.png', 7, 7], ['assets/b', 1, 1]]
    const g = groupFiles(files, false)
    expect(g.map((x) => [x.id, x.compressed, x.size, x.files])).toEqual([['dex', 15, 39, 2], ['res', 7, 7, 1], ['assets', 1, 1, 1]])
    expect(topFiles(files, 2).map((f) => f.name)).toEqual(['classes.dex', 'res/a.png'])
  })
})

describe('apk analyze + compare', () => {
  let dir: string
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccm-apk-'))
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  const apk = async (name: string, files: { name: string; data: Buffer; store?: boolean }[]) => {
    const p = path.join(dir, name)
    await fs.writeFile(p, makeZip(files))
    return p
  }

  it('reads sizes, manifest and dex method count of an APK', async () => {
    const p = await apk('app.apk', [
      { name: 'AndroidManifest.xml', data: apkManifest() },
      { name: 'classes.dex', data: dex(1000) },
      { name: 'classes2.dex', data: dex(234), store: true },
      { name: 'res/', data: Buffer.alloc(0), store: true },
      { name: 'res/drawable/a.png', data: Buffer.alloc(5000, 1), store: true },
      { name: 'lib/arm64-v8a/libz.so', data: Buffer.alloc(800, 7) },
    ])
    const { report, files } = await analyzeApk(p, 5)
    expect(report).toMatchObject({ kind: 'apk', entries: 5, dexMethods: 1234, dexFiles: 2 })
    expect(report.manifest?.versionCode).toBe('42')
    expect(report.top[0]!.name).toBe('res/drawable/a.png')
    expect(report.groups.find((g) => g.id === 'lib:arm64-v8a')?.size).toBe(800)
    expect(files).toHaveLength(5)
  })

  it('reads an AAB with a feature module', async () => {
    const p = await apk('app.aab', [
      { name: 'BundleConfig.pb', data: Buffer.from('x') },
      { name: 'base/manifest/AndroidManifest.xml', data: aabManifest() },
      { name: 'base/dex/classes.dex', data: dex(50) },
      { name: 'camera/dex/classes.dex', data: dex(9) },
    ])
    const { report } = await analyzeApk(p)
    expect(report.kind).toBe('aab')
    expect(report.manifest?.versionName).toBe('2.0')
    expect(report.dexMethods).toBe(50)
    expect(report.groups.map((g) => g.id)).toEqual(['dex', 'module:camera', 'other'])
  })

  it('refuses a file that is not a zip', async () => {
    const p = path.join(dir, 'bad.apk')
    await fs.writeFile(p, 'not a zip at all, just text that is long enough')
    await expect(analyzeApk(p)).rejects.toMatchObject({ code: 'not-zip' })
  })

  it('compares two builds per group and file', async () => {
    const snap = (files: SnapshotFile[], name: string): ApkSnapshot => ({
      analyzedAt: 1,
      files,
      report: { path: `/x/${name}`, name, kind: 'apk', fileSize: 1, mtime: 1, entries: files.length, compressed: 0, size: 0, groups: groupFiles(files, false), top: [], manifest: null, dexMethods: null, dexFiles: 0 },
    })
    const a = snap([['classes.dex', 10, 20], ['res/a.png', 5, 5], ['res/old.png', 3, 3]], 'a.apk')
    const b = snap([['classes.dex', 14, 28], ['res/a.png', 5, 5], ['lib/x86/l.so', 9, 9]], 'b.apk')
    const d = compareSnapshots(a, b)
    expect(d.added.map((f) => f.name)).toEqual(['lib/x86/l.so'])
    expect(d.removed.map((f) => f.name)).toEqual(['res/old.png'])
    expect(d.changed).toEqual([{ name: 'classes.dex', before: { compressed: 10, size: 20 }, after: { compressed: 14, size: 28 } }])
    expect(d.groups.find((g) => g.id === 'lib:x86')).toMatchObject({ before: null, after: { compressed: 9 } })
    expect(d.groups.find((g) => g.id === 'res')).toMatchObject({ before: { compressed: 8 }, after: { compressed: 5 } })
  })

  it('keeps the previous build per project even when the same path is rebuilt', async () => {
    const h = new ApkHistory(dir)
    const p = await apk('app-release.apk', [{ name: 'classes.dex', data: dex(1) }])
    const first = await analyzeApk(p, 1)
    expect(await h.record('/proj', first)).toBeNull()
    expect(await h.record('/proj', first)).toBeNull()
    await fs.writeFile(p, makeZip([{ name: 'classes.dex', data: dex(2) }, { name: 'res/n.xml', data: Buffer.from('n') }]))
    await fs.utimes(p, new Date(), new Date(Date.now() + 5000))
    const second = await analyzeApk(p, 2)
    const prev = await h.record('/proj', second)
    expect(prev?.analyzedAt).toBe(1)
    expect(compareSnapshots(prev!, second).addedCount).toBe(1)
    expect(await h.record('/other', second)).toBeNull()
  })
})

describe('apk ipc', () => {
  type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  let dir: string
  beforeEach(async () => {
    dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'ccm-apk-ipc-')))
  })
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  function setup(allowed: string | null, picked: string | null = null) {
    const handlers = new Map<string, Handler>()
    const ipcMain = { handle: (ch: string, fn: Handler) => void handlers.set(ch, fn), removeHandler: (ch: string) => void handlers.delete(ch) } as unknown as IpcMain
    registerApkIpc({
      ipcMain,
      isAppFrame: () => true,
      resolveFile: async (p) => (allowed && typeof p === 'string' && p.startsWith(allowed) ? p : null),
      resolveDir: async (d) => (d === allowed ? allowed : null),
      dialog: { showOpenDialog: async () => ({ canceled: !picked, filePaths: picked ? [picked] : [] }) } as never,
      getWindow: () => null,
      dataDir: path.join(dir, 'data'),
    })
    return (ch: string, ...args: unknown[]) => handlers.get(ch)!({} as IpcMainInvokeEvent, ...args)
  }

  it('refuses paths outside the roots, other extensions and non-objects', async () => {
    const p = path.join(dir, 'a.apk')
    await fs.writeFile(p, makeZip([{ name: 'classes.dex', data: dex(3) }]))
    const call = setup(null)
    expect(await call('ccm:apk-analyze', { path: p })).toEqual({ ok: false, error: 'denied' })
    expect(await call('ccm:apk-analyze', { path: path.join(dir, 'a.txt') })).toEqual({ ok: false, error: 'invalid' })
    expect(await call('ccm:apk-analyze', 'x')).toEqual({ ok: false, error: 'denied' })
    expect(await call('ccm:apk-analyze', { path: path.join(dir, 'gone.apk') })).toEqual({ ok: false, error: 'missing' })
  })

  it('reads a picked file and diffs against the previous analysis', async () => {
    const p = path.join(dir, 'a.apk')
    await fs.writeFile(p, makeZip([{ name: 'classes.dex', data: dex(3) }]))
    const call = setup(null, p)
    expect(await call('ccm:apk-pick', null)).toBe(p)
    const r = (await call('ccm:apk-analyze', { path: p })) as { ok: boolean; previous: unknown; report: { dexMethods: number } }
    expect(r).toMatchObject({ ok: true, previous: null, report: { dexMethods: 3 } })
    const q = path.join(dir, 'b.apk')
    await fs.writeFile(q, makeZip([{ name: 'classes.dex', data: dex(3) }, { name: 'assets/x', data: Buffer.alloc(10) }]))
    const allowed = setup(dir)
    const c = (await allowed('ccm:apk-compare', { path: q, other: p })) as { ok: boolean; diff: { addedCount: number } }
    expect(c).toMatchObject({ ok: true, diff: { addedCount: 1 } })
  })
})
