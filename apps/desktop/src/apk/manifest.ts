import type { ApkManifest } from '@ccm/shared'

export interface XmlNode {
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
}

const MAX_NODES = 20_000
const MAX_DEPTH = 64
const MAX_PERMISSIONS = 300

// R.attr ids for attributes whose name string is stripped by shrinkers (the resource map still has the id).
const ATTR_IDS: Record<number, string> = {
  0x01010003: 'name',
  0x0101000f: 'debuggable',
  0x0101020c: 'minSdkVersion',
  0x01010270: 'targetSdkVersion',
  0x0101021b: 'versionCode',
  0x0101021c: 'versionName',
  0x01010572: 'compileSdkVersion',
}

const RES_XML = 0x0003
const RES_STRING_POOL = 0x0001
const RES_XML_RESOURCE_MAP = 0x0180
const RES_XML_START_ELEMENT = 0x0102
const RES_XML_END_ELEMENT = 0x0103
const NO_INDEX = 0xffffffff

function readPool(buf: Buffer, at: number): string[] {
  const headerSize = buf.readUInt16LE(at + 2)
  const count = buf.readUInt32LE(at + 8)
  const utf8 = (buf.readUInt32LE(at + 16) & 0x100) !== 0
  const stringsStart = at + buf.readUInt32LE(at + 20)
  if (count > 500_000) throw new Error('pool')
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    let p = stringsStart + buf.readUInt32LE(at + headerSize + i * 4)
    if (utf8) {
      p += buf[p]! & 0x80 ? 2 : 1
      let len = buf[p]!
      if (len & 0x80) {
        len = ((len & 0x7f) << 8) | buf[p + 1]!
        p += 2
      } else p += 1
      out.push(buf.toString('utf8', p, p + len))
    } else {
      let len = buf.readUInt16LE(p)
      p += 2
      if (len & 0x8000) {
        len = ((len & 0x7fff) << 16) | buf.readUInt16LE(p)
        p += 2
      }
      out.push(buf.toString('utf16le', p, p + len * 2))
    }
  }
  return out
}

function typedValue(type: number, data: number, strings: string[]): string {
  switch (type) {
    case 0x03:
      return strings[data] ?? ''
    case 0x10:
      return String(data | 0)
    case 0x11:
      return `0x${data.toString(16)}`
    case 0x12:
      return data !== 0 ? 'true' : 'false'
    case 0x01:
      return `@0x${data.toString(16).padStart(8, '0')}`
    default:
      return String(data)
  }
}

/** Android binary XML (AXML, as in an APK's AndroidManifest.xml) → element tree; null when it is not AXML or is malformed. */
export function parseAxml(buf: Buffer): XmlNode | null {
  try {
    if (buf.length < 8 || buf.readUInt16LE(0) !== RES_XML) return null
    let strings: string[] = []
    let resIds: number[] = []
    const root: XmlNode = { name: '#document', attrs: {}, children: [] }
    const stack: XmlNode[] = [root]
    let nodes = 0
    let at = buf.readUInt16LE(2)
    const end = Math.min(buf.length, buf.readUInt32LE(4))
    while (at + 8 <= end) {
      const type = buf.readUInt16LE(at)
      const size = buf.readUInt32LE(at + 4)
      if (size < 8 || at + size > end) return null
      if (type === RES_STRING_POOL) strings = readPool(buf, at)
      else if (type === RES_XML_RESOURCE_MAP) {
        const hs = buf.readUInt16LE(at + 2)
        resIds = []
        for (let p = at + hs; p + 4 <= at + size; p += 4) resIds.push(buf.readUInt32LE(p))
      } else if (type === RES_XML_START_ELEMENT) {
        if (++nodes > MAX_NODES || stack.length > MAX_DEPTH) return null
        const ext = at + buf.readUInt16LE(at + 2)
        const name = strings[buf.readUInt32LE(ext + 4)] ?? ''
        const attrStart = buf.readUInt16LE(ext + 8)
        const attrSize = buf.readUInt16LE(ext + 10)
        const attrCount = buf.readUInt16LE(ext + 12)
        const attrs: Record<string, string> = {}
        for (let i = 0; i < attrCount; i++) {
          const a = ext + attrStart + i * attrSize
          const nameIdx = buf.readUInt32LE(a + 4)
          let attrName = strings[nameIdx] ?? ''
          if (!attrName || /^\d/.test(attrName)) attrName = ATTR_IDS[resIds[nameIdx] ?? -1] ?? attrName
          const raw = buf.readUInt32LE(a + 8)
          attrs[attrName] = raw !== NO_INDEX ? (strings[raw] ?? '') : typedValue(buf[a + 15]!, buf.readUInt32LE(a + 16), strings)
        }
        const node: XmlNode = { name, attrs, children: [] }
        stack.at(-1)!.children.push(node)
        stack.push(node)
      } else if (type === RES_XML_END_ELEMENT) {
        if (stack.length > 1) stack.pop()
      }
      at += size
    }
    return root.children[0] ?? null
  } catch {
    return null
  }
}

interface PbField {
  no: number
  wire: number
  value: number | Buffer
}

function* pbFields(buf: Buffer): Generator<PbField> {
  let at = 0
  const varint = (): number => {
    let v = 0
    let mul = 1
    for (let i = 0; i < 10; i++) {
      if (at >= buf.length) throw new Error('pb')
      const b = buf[at++]!
      v += (b & 0x7f) * mul
      if (!(b & 0x80)) return v
      mul *= 128
    }
    throw new Error('pb')
  }
  while (at < buf.length) {
    const key = varint()
    const no = Math.floor(key / 8)
    const wire = key & 7
    if (wire === 0) yield { no, wire, value: varint() }
    else if (wire === 2) {
      const len = varint()
      if (at + len > buf.length) throw new Error('pb')
      yield { no, wire, value: buf.subarray(at, at + len) }
      at += len
    } else if (wire === 1) at += 8
    else if (wire === 5) at += 4
    else throw new Error('pb')
  }
}

// aapt2 Resources.proto: XmlNode{element=1}, XmlElement{name=3, attribute=4, child=5}, XmlAttribute{name=2, value=3, resource_id=5}.
function pbElement(buf: Buffer, depth: number, count: { n: number }): XmlNode | null {
  if (depth > MAX_DEPTH || ++count.n > MAX_NODES) throw new Error('pb')
  const node: XmlNode = { name: '', attrs: {}, children: [] }
  for (const f of pbFields(buf)) {
    if (!(f.value instanceof Buffer)) continue
    if (f.no === 3) node.name = f.value.toString('utf8')
    else if (f.no === 4) {
      let name = ''
      let value = ''
      let resId = 0
      for (const a of pbFields(f.value)) {
        if (a.no === 2 && a.value instanceof Buffer) name = a.value.toString('utf8')
        else if (a.no === 3 && a.value instanceof Buffer) value = a.value.toString('utf8')
        else if (a.no === 5 && typeof a.value === 'number') resId = a.value
      }
      node.attrs[name || ATTR_IDS[resId] || ''] = value
    } else if (f.no === 5) {
      for (const c of pbFields(f.value)) {
        if (c.no !== 1 || !(c.value instanceof Buffer)) continue
        const child = pbElement(c.value, depth + 1, count)
        if (child) node.children.push(child)
      }
    }
  }
  return node
}

/** aapt2 proto XML (an AAB's `base/manifest/AndroidManifest.xml`) → element tree; null when malformed. */
export function parseProtoXml(buf: Buffer): XmlNode | null {
  try {
    for (const f of pbFields(buf)) if (f.no === 1 && f.value instanceof Buffer) return pbElement(f.value, 0, { n: 0 })
    return null
  } catch {
    return null
  }
}

const attr = (n: XmlNode, name: string): string | null => n.attrs[`android:${name}`] ?? n.attrs[name] ?? null

export function manifestSummary(root: XmlNode | null): ApkManifest | null {
  if (!root || root.name !== 'manifest') return null
  const sdk = root.children.find((c) => c.name === 'uses-sdk')
  const app = root.children.find((c) => c.name === 'application')
  const permissions = [
    ...new Set(
      root.children
        .filter((c) => c.name === 'uses-permission' || c.name === 'uses-permission-sdk-23' || c.name === 'uses-permission-sdk-m')
        .map((c) => attr(c, 'name'))
        .filter((n): n is string => !!n),
    ),
  ]
    .sort()
    .slice(0, MAX_PERMISSIONS)
  return {
    pkg: root.attrs.package ?? null,
    versionCode: attr(root, 'versionCode'),
    versionName: attr(root, 'versionName'),
    minSdk: sdk ? attr(sdk, 'minSdkVersion') : null,
    targetSdk: sdk ? attr(sdk, 'targetSdkVersion') : null,
    compileSdk: attr(root, 'compileSdkVersion'),
    debuggable: !!app && attr(app, 'debuggable') === 'true',
    permissions,
  }
}
