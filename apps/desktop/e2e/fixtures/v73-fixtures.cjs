// Builders for e2e/v73.cjs: a tiny APK (zip + binary manifest + dex header), a SQLite file made with sql.js, prefs XML.
const { deflateRawSync } = require('node:zlib')
const path = require('node:path')

function makeZip(files) {
  const locals = []
  const central = []
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

/** Same AXML layout as test/apk.test.ts: UTF-16 pool, resource map for the first `ids.length` strings. */
function axml(root, ids, strings) {
  const idx = (s) => {
    let i = strings.indexOf(s)
    if (i < 0) i = strings.push(s) - 1
    return i
  }
  const body = []
  const walk = (el) => {
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

const manifest = (versionCode, versionName) =>
  axml(
    {
      name: 'manifest',
      attrs: [['', { int: versionCode }], ['versionName', { str: versionName }], ['package', { str: 'com.example.app' }]],
      children: [
        { name: 'uses-sdk', attrs: [['minSdkVersion', { int: 24 }], ['targetSdkVersion', { int: 35 }]] },
        { name: 'uses-permission', attrs: [['name', { str: 'android.permission.INTERNET' }]] },
        { name: 'uses-permission', attrs: [['name', { str: 'android.permission.CAMERA' }]] },
        { name: 'application', attrs: [['debuggable', { bool: true }]] },
      ],
    },
    [0x0101021b],
    [''],
  )

function dex(methods, size = 0x200) {
  const b = Buffer.alloc(size)
  b.write('dex\n035\0', 0, 'latin1')
  b.writeUInt32LE(methods, 0x58)
  return b
}

/** Pseudo-random bytes so deflate cannot shrink a "native library" to nothing. */
function noise(n, seed) {
  const b = Buffer.alloc(n)
  let x = seed
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) & 0x7fffffff
    b[i] = x >> 16
  }
  return b
}

/** v1 and v2 of a debug APK: v2 grows the arm64 lib, adds an x86_64 lib and drops the asset. */
function apk(version) {
  const v2 = version === 2
  const files = [
    { name: 'AndroidManifest.xml', data: manifest(v2 ? 43 : 42, v2 ? '1.2.4' : '1.2.3') },
    { name: 'classes.dex', data: dex(1200, 4096) },
    { name: 'classes2.dex', data: dex(300, 2048) },
    { name: 'resources.arsc', data: noise(3000, 7), store: true },
    { name: 'res/layout/main.xml', data: Buffer.from('<LinearLayout/>'.repeat(40)) },
    { name: 'res/drawable/logo.png', data: noise(5000, 3), store: true },
    { name: 'lib/arm64-v8a/libx.so', data: noise(v2 ? 24000 : 12000, 11) },
    { name: 'META-INF/CERT.RSA', data: noise(800, 5) },
  ]
  if (v2) files.push({ name: 'lib/x86_64/liby.so', data: noise(9000, 13) })
  else files.push({ name: 'assets/data.bin', data: noise(2000, 17) })
  return makeZip(files)
}

/** `items` has 450 rows (3 pages of 200), `notes` 2 rows, `cheap` is a view. */
async function appDb(repo) {
  const initSqlJs = require(path.join(repo, 'node_modules', 'sql.js'))
  const SQL = await initSqlJs()
  const db = new SQL.Database()
  db.run('CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL, price REAL)')
  db.run('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)')
  db.run('CREATE VIEW cheap AS SELECT * FROM items WHERE price < 5')
  db.run('BEGIN')
  const st = db.prepare('INSERT INTO items (name, price) VALUES (?, ?)')
  for (let i = 1; i <= 450; i++) st.run([`item-${i}`, i / 10])
  st.free()
  db.run("INSERT INTO notes (body) VALUES ('first note'), ('second note')")
  db.run('COMMIT')
  const bytes = Buffer.from(db.export())
  db.close()
  return bytes
}

const PREFS = `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <string name="user_name">Ann</string>
    <boolean name="onboarded" value="true" />
    <int name="launch_count" value="7" />
</map>
`

module.exports = { apk, appDb, PREFS }
