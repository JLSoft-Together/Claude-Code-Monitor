import { deflateRawSync } from 'node:zlib'

/** In-memory zip (stored / deflate entries, no zip64) for extractor tests. */
export function makeZip(files: { name: string; data: Buffer; store?: boolean }[]): Buffer {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const name = Buffer.from(f.name)
    const comp = f.store ? f.data : deflateRawSync(f.data)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(f.store ? 0 : 8, 8)
    lh.writeUInt32LE(comp.length, 18)
    lh.writeUInt32LE(f.data.length, 22)
    lh.writeUInt16LE(name.length, 26)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(f.store ? 0 : 8, 10)
    ch.writeUInt32LE(comp.length, 20)
    ch.writeUInt32LE(f.data.length, 24)
    ch.writeUInt16LE(name.length, 28)
    ch.writeUInt32LE(offset, 42)
    locals.push(lh, name, comp)
    central.push(ch, name)
    offset += 30 + name.length + comp.length
  }
  const cd = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}
