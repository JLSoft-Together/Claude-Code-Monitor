import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import initSqlJs from 'sql.js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdbCommands, Bytes } from '../src/devices/adb'
import { AppDataInspector, isDataFileName, parseDataList, runAsFailure, toCell } from '../src/devices/appData'
import { registerAppDataIpc } from '../src/devices/appDataIpc'
import { applyPrefEdit, cleanPrefEdit, cleanPrefValue, parsePrefs, prefElement } from '../src/devices/prefs'
import { checkReadOnlySql, quoteIdent } from '../src/devices/sqlGuard'
import { applyWal, isSqlite } from '../src/devices/sqliteWal'

const PREFS = `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>
<map>
    <string name="token">a &amp; b &lt;c&gt;</string>
    <!-- <int name="ghost" value="1" /> -->
    <int name="launches" value="3" />
    <long name="since" value="1730000000000" />
    <float name="ratio" value="1.5" />
    <boolean name="onboarded" value="false" />
    <null name="gone" />
    <set name="tags">
        <string>x</string>
        <string>y</string>
    </set>
</map>
`

describe('shared preferences', () => {
  it('parses every type, skips comments and <null>', () => {
    expect(parsePrefs(PREFS)).toEqual([
      { key: 'token', type: 'string', value: 'a & b <c>' },
      { key: 'launches', type: 'int', value: '3' },
      { key: 'since', type: 'long', value: '1730000000000' },
      { key: 'ratio', type: 'float', value: '1.5' },
      { key: 'onboarded', type: 'boolean', value: 'false' },
      { key: 'tags', type: 'set', value: ['x', 'y'] },
    ])
    expect(parsePrefs('<map />')).toEqual([])
    expect(parsePrefs('nope')).toBeNull()
  })

  it('replaces only the edited element and refuses a stale value', () => {
    const r = applyPrefEdit(PREFS, { key: 'onboarded', type: 'boolean', before: 'false', after: 'true' })
    expect(r.ok && r.xml).toBe(PREFS.replace('<boolean name="onboarded" value="false" />', '<boolean name="onboarded" value="true" />'))
    const s = applyPrefEdit(PREFS, { key: 'token', type: 'string', before: 'a & b <c>', after: '"q" & <z>' })
    expect(s.ok && parsePrefs(s.xml)?.[0]).toEqual({ key: 'token', type: 'string', value: '"q" & <z>' })
    expect(s.ok && s.xml).toContain('<null name="gone" />')
    expect(applyPrefEdit(PREFS, { key: 'launches', type: 'int', before: '4', after: '5' })).toEqual({ ok: false, error: 'changed' })
    expect(applyPrefEdit(PREFS, { key: 'launches', type: 'long', before: '3', after: '5' })).toEqual({ ok: false, error: 'changed' })
    const set = applyPrefEdit(PREFS, { key: 'tags', type: 'set', before: ['x', 'y'], after: ['z'] })
    expect(set.ok && parsePrefs(set.xml)?.at(-1)).toEqual({ key: 'tags', type: 'set', value: ['z'] })
  })

  it('validates values per type', () => {
    expect(cleanPrefValue('int', ' 42 ')).toBe('42')
    expect(cleanPrefValue('int', '2147483648')).toBeNull()
    expect(cleanPrefValue('long', '9223372036854775807')).toBe('9223372036854775807')
    expect(cleanPrefValue('long', '9223372036854775808')).toBeNull()
    expect(cleanPrefValue('float', '1e3')).toBe('1e3')
    expect(cleanPrefValue('float', 'NaN')).toBeNull()
    expect(cleanPrefValue('boolean', 'yes')).toBeNull()
    expect(cleanPrefValue('string', 'a\u0001')).toBeNull()
    expect(cleanPrefEdit({ key: 'k', type: 'int', before: '1', after: 'x' })).toBeNull()
    expect(cleanPrefEdit({ key: 'k', type: 'blob', before: '1', after: '2' })).toBeNull()
    expect(cleanPrefEdit({ key: 'k', type: 'set', before: ['a'], after: ['b'] })).toEqual({ key: 'k', type: 'set', before: ['a'], after: ['b'] })
    expect(prefElement({ key: 'a"b', type: 'int', value: '1' })).toBe('<int name="a&quot;b" value="1" />')
  })
})

describe('read-only SQL guard', () => {
  it('allows reads', () => {
    for (const q of ['SELECT * FROM t', 'with x as (select 1) select * from x', "PRAGMA table_info('t')", 'explain query plan select 1;', "select replace(name, 'a', 'b') from t", "select 'drop table x; --' as s"]) {
      expect(checkReadOnlySql(q)).toMatchObject({ ok: true })
    }
  })

  it('refuses writes, several statements and bad input', () => {
    expect(checkReadOnlySql('DELETE FROM t')).toEqual({ ok: false, reason: 'not-read' })
    expect(checkReadOnlySql('WITH x AS (SELECT 1) DELETE FROM t')).toEqual({ ok: false, reason: 'not-read' })
    expect(checkReadOnlySql('select 1; drop table t')).toEqual({ ok: false, reason: 'multiple' })
    expect(checkReadOnlySql('PRAGMA user_version = 3')).toEqual({ ok: false, reason: 'not-read' })
    expect(checkReadOnlySql("ATTACH 'x' AS y")).toEqual({ ok: false, reason: 'not-read' })
    expect(checkReadOnlySql("select 'open")).toEqual({ ok: false, reason: 'syntax' })
    expect(checkReadOnlySql('  ')).toEqual({ ok: false, reason: 'empty' })
    expect(checkReadOnlySql(5)).toEqual({ ok: false, reason: 'empty' })
    expect(quoteIdent('a"b')).toBe('"a""b"')
  })
})

/** WAL writer for tests: native (little-endian) checksums as SQLite writes them on Android. */
function makeWal(pageSize: number, frames: { pgno: number; commit: number; page: Buffer }[], corruptAt = -1): Buffer {
  const sum = (buf: Buffer, s: [number, number]): [number, number] => {
    let [a, b] = s
    for (let i = 0; i < buf.length; i += 8) {
      a = (a + buf.readUInt32LE(i) + b) >>> 0
      b = (b + buf.readUInt32LE(i + 4) + a) >>> 0
    }
    return [a, b]
  }
  const head = Buffer.alloc(32)
  head.writeUInt32BE(0x377f0682, 0)
  head.writeUInt32BE(3007000, 4)
  head.writeUInt32BE(pageSize, 8)
  head.writeUInt32BE(11, 16)
  head.writeUInt32BE(22, 20)
  let s = sum(head.subarray(0, 24), [0, 0])
  head.writeUInt32BE(s[0], 24)
  head.writeUInt32BE(s[1], 28)
  const parts = [head]
  frames.forEach((f, i) => {
    const fh = Buffer.alloc(24)
    fh.writeUInt32BE(f.pgno, 0)
    fh.writeUInt32BE(f.commit, 4)
    fh.writeUInt32BE(11, 8)
    fh.writeUInt32BE(22, 12)
    s = sum(Buffer.concat([fh.subarray(0, 8), f.page]), s)
    fh.writeUInt32BE(i === corruptAt ? s[0] ^ 1 : s[0], 16)
    fh.writeUInt32BE(s[1], 20)
    parts.push(fh, f.page)
  })
  return Buffer.concat(parts)
}

describe('WAL apply', () => {
  const page = (n: number, fill: number) => {
    const b = Buffer.alloc(512, fill)
    if (n === 1) {
      b.write('SQLite format 3\0', 0, 'latin1')
      b[18] = 2
      b[19] = 2
    }
    return b
  }

  it('copies committed frames, drops an open transaction, switches off WAL mode', () => {
    const db = Buffer.concat([page(1, 0), page(2, 1)])
    const wal = makeWal(512, [
      { pgno: 2, commit: 0, page: page(2, 7) },
      { pgno: 3, commit: 3, page: page(3, 8) },
      { pgno: 2, commit: 0, page: page(2, 9) },
    ])
    const r = applyWal(db, wal)
    expect(r.frames).toBe(2)
    expect(r.partial).toBe(false)
    expect(r.db.length).toBe(1536)
    expect(r.db[600]).toBe(7)
    expect(r.db[1100]).toBe(8)
    expect([r.db[18], r.db[19]]).toEqual([1, 1])
    expect(isSqlite(r.db)).toBe(true)
  })

  it('stops at a bad checksum and reports it', () => {
    const db = Buffer.concat([page(1, 0), page(2, 1)])
    const wal = makeWal(512, [
      { pgno: 2, commit: 2, page: page(2, 7) },
      { pgno: 2, commit: 2, page: page(2, 9) },
    ], 1)
    const r = applyWal(db, wal)
    expect(r).toMatchObject({ frames: 1, partial: true })
    expect(r.db[600]).toBe(7)
    expect(applyWal(db, Buffer.from('junk')).frames).toBe(0)
  })
})

describe('app data list + run-as', () => {
  it('parses sizes, groups side files, refuses odd names', () => {
    const out = ' 4096 databases/app.db\n 512 databases/app.db-wal\n32768 databases/app.db-shm\n 120 shared_prefs/settings.xml\n9 shared_prefs/notes.txt\n7 databases/bad name;rm\n'
    expect(parseDataList(out)).toEqual({
      databases: [{ name: 'app.db', size: 4096, wal: true }],
      prefs: [{ name: 'settings.xml', size: 120 }],
      skipped: 1,
    })
    expect(isDataFileName('-rf')).toBe(false)
    expect(isDataFileName('..')).toBe(false)
    expect(isDataFileName("a'b")).toBe(false)
    expect(isDataFileName('room_db')).toBe(true)
  })

  it('maps run-as refusals', () => {
    expect(runAsFailure('run-as: package not debuggable: com.x')).toMatchObject({ error: 'not-debuggable' })
    expect(runAsFailure("run-as: Package 'com.x' is not debuggable")).toMatchObject({ error: 'not-debuggable' })
    expect(runAsFailure('run-as: unknown package: com.x')).toMatchObject({ error: 'unknown-package' })
    expect(runAsFailure('')).toBeNull()
    expect(toCell(new Uint8Array(3))).toEqual({ blob: 3 })
  })
})

interface FakeDevice {
  files: Map<string, Buffer>
  debuggable: boolean
  shells: string[][]
  stops: number
}

/** adb as the inspector uses it: `run-as`, `cat`, the list script and the prefs write over stdin. */
function fakeCommands(dev: FakeDevice): AdbCommands {
  const bytes = (out: Buffer | string, code = 0): Bytes => ({ code, out: typeof out === 'string' ? Buffer.from(out) : out, err: '' })
  const unq = (s: string) => s.replace(/^'|'$/g, '')
  return {
    shell: vi.fn(async (_id: string, args: string[]) => {
      dev.shells.push(args)
      if (args[0] === 'am') {
        dev.stops++
        return { code: 0, out: '' }
      }
      if (!dev.debuggable) return { code: 1, out: 'run-as: package not debuggable: com.app' }
      if (args[2] === 'true') return { code: 0, out: '' }
      const lines = [...dev.files].map(([p, b]) => `${b.length} ${p}`)
      return { code: 0, out: lines.join('\n') }
    }),
    execOut: vi.fn(async (_id: string, args: string[], _ms: number, max: number) => {
      if (!dev.debuggable) return bytes('run-as: package not debuggable: com.app', 1)
      const f = dev.files.get(unq(args[3]!))
      if (!f) return bytes(`cat: ${unq(args[3]!)}: No such file or directory`, 1)
      return f.length > max ? { ...bytes(f.subarray(0, max)), code: null, overflow: true } : bytes(f)
    }),
    shellInput: vi.fn(async (_id: string, args: string[], input: Buffer) => {
      const m = /mv \S+ (shared_prefs\/\S+)'$/.exec(args.join(' '))
      if (m) dev.files.set(m[1]!, Buffer.from(input))
      return bytes('')
    }),
  } as unknown as AdbCommands
}

describe('app data inspector', () => {
  let dir: string
  let dev: FakeDevice
  let inspector: AppDataInspector
  const confirmWrite = vi.fn(async () => true)
  const confirmRestore = vi.fn(async () => true)

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ccm-appdata-'))
    const SQL = await initSqlJs()
    const db = new SQL.Database()
    db.exec("CREATE TABLE user (id INTEGER PRIMARY KEY, name TEXT, avatar BLOB); INSERT INTO user (name, avatar) VALUES ('ann', x'0102'), ('bob', NULL); CREATE VIEW names AS SELECT name FROM user;")
    const data = Buffer.from((db as unknown as { export(): Uint8Array }).export())
    db.close()
    dev = { files: new Map([['databases/app.db', data], ['shared_prefs/settings.xml', Buffer.from(PREFS)]]), debuggable: true, shells: [], stops: 0 }
    const cmds = fakeCommands(dev)
    inspector = new AppDataInspector({ withDevice: async (_id, fn) => fn(cmds), sql: () => initSqlJs(), dataDir: dir, confirmWrite, confirmRestore })
    confirmWrite.mockClear()
    confirmRestore.mockClear()
  })
  afterEach(async () => {
    inspector.closeAll()
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('says debug builds only', async () => {
    dev.debuggable = false
    expect(await inspector.list('S1', 'com.app')).toMatchObject({ ok: false, error: 'not-debuggable' })
  })

  it('lists, opens a database read-only, pages rows and runs a SELECT', async () => {
    const list = await inspector.list('S1', 'com.app')
    expect(list).toMatchObject({ ok: true, databases: [{ name: 'app.db' }], prefs: [{ name: 'settings.xml' }] })
    const open = await inspector.openDb('S1', 'com.app', 'app.db')
    if (!open.ok) throw new Error(open.error)
    expect(open.wal).toBe('none')
    expect(open.tables.map((t) => [t.name, t.type, t.rows])).toEqual([['user', 'table', 2], ['names', 'view', null]])
    const rows = inspector.rows(open.handle, 'user', 0)
    expect(rows).toMatchObject({ ok: true, columns: ['id', 'name', 'avatar'], rows: [[1, 'ann', { blob: 2 }], [2, 'bob', null]], total: 2 })
    expect(inspector.rows(open.handle, 'missing', 0)).toMatchObject({ ok: false, error: 'invalid' })
    expect(inspector.query(open.handle, 'SELECT count(*) AS n FROM names')).toMatchObject({ ok: true, columns: ['n'], rows: [[2]] })
    expect(inspector.query(open.handle, 'DELETE FROM user')).toMatchObject({ ok: false, error: 'sql-rejected' })
    expect(inspector.query(open.handle, 'SELECT nope FROM user')).toMatchObject({ ok: false, error: 'sql-error' })
    inspector.close(open.handle)
    expect(inspector.rows(open.handle, 'user', 0)).toMatchObject({ ok: false, error: 'gone' })
  })

  it('refuses a file that is not SQLite', async () => {
    dev.files.set('databases/blob.db', Buffer.alloc(200, 1))
    expect(await inspector.openDb('S1', 'com.app', 'blob.db')).toMatchObject({ ok: false, error: 'not-sqlite' })
    expect(await inspector.openDb('S1', 'com.app', 'none.db')).toMatchObject({ ok: false, error: 'gone' })
  })

  it('edits a pref after the confirm, keeps the original, restores it', async () => {
    const edit = { key: 'launches', type: 'int' as const, before: '3', after: '9' }
    const r = await inspector.writePref('S1', 'com.app', 'settings.xml', edit)
    expect(confirmWrite).toHaveBeenCalledWith({ pkg: 'com.app', file: 'settings.xml', key: 'launches', before: '3', after: '9' })
    expect(r).toMatchObject({ ok: true, hasOriginal: true })
    expect(dev.stops).toBe(1)
    expect(parsePrefs(dev.files.get('shared_prefs/settings.xml')!.toString())?.[1]?.value).toBe('9')
    const again = await inspector.writePref('S1', 'com.app', 'settings.xml', { ...edit, before: '9', after: '10' })
    expect(again).toMatchObject({ ok: true })
    const restored = await inspector.restorePrefs('S1', 'com.app', 'settings.xml')
    expect(restored).toMatchObject({ ok: true, hasOriginal: false })
    expect(dev.files.get('shared_prefs/settings.xml')!.toString()).toBe(PREFS)
    expect(await inspector.restorePrefs('S1', 'com.app', 'settings.xml')).toMatchObject({ ok: false, error: 'no-original' })
  })

  it('does nothing when the confirm is declined or the value moved', async () => {
    confirmWrite.mockResolvedValueOnce(false)
    expect(await inspector.writePref('S1', 'com.app', 'settings.xml', { key: 'launches', type: 'int', before: '3', after: '4' })).toMatchObject({ error: 'cancelled' })
    expect(await inspector.writePref('S1', 'com.app', 'settings.xml', { key: 'launches', type: 'int', before: '8', after: '4' })).toMatchObject({ error: 'changed' })
    expect(dev.stops).toBe(0)
    expect(dev.files.get('shared_prefs/settings.xml')!.toString()).toBe(PREFS)
  })
})

describe('app data ipc', () => {
  type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  function setup(app = true) {
    const handlers = new Map<string, Handler>()
    const ipcMain = { handle: (ch: string, fn: Handler) => void handlers.set(ch, fn), removeHandler: (ch: string) => void handlers.delete(ch) } as unknown as IpcMain
    const ok = { ok: true }
    const inspector = {
      list: vi.fn(async () => ok),
      openDb: vi.fn(async () => ok),
      rows: vi.fn(() => ok),
      query: vi.fn(() => ok),
      close: vi.fn(),
      readPrefs: vi.fn(async () => ok),
      writePref: vi.fn(async () => ok),
      restorePrefs: vi.fn(async () => ok),
    }
    const dispose = registerAppDataIpc({ ipcMain, isAppFrame: () => app, inspector })
    const call = (ch: string, ...args: unknown[]) => handlers.get(ch)!({} as IpcMainInvokeEvent, ...args)
    return { call, inspector, handlers, dispose }
  }

  it('validates serial, package, file names, handles and edits', async () => {
    const { call, inspector } = setup()
    expect(await call('ccm:appdata-list', 'S1', 'com.app')).toEqual({ ok: true })
    expect(await call('ccm:appdata-list', '-S1', 'com.app')).toMatchObject({ error: 'invalid' })
    expect(await call('ccm:appdata-list', 'S1', "com.app'; rm")).toMatchObject({ error: 'invalid' })
    expect(await call('ccm:appdata-db-open', 'S1', 'com.app', '../x')).toMatchObject({ error: 'invalid' })
    expect(await call('ccm:appdata-prefs-read', 'S1', 'com.app', 'settings.txt')).toMatchObject({ error: 'invalid' })
    expect(await call('ccm:appdata-db-rows', 'zz', 'user', 0)).toMatchObject({ error: 'invalid' })
    expect(await call('ccm:appdata-db-rows', '0123456789abcdef', 'user', -1)).toMatchObject({ error: 'invalid' })
    expect(await call('ccm:appdata-prefs-write', 'S1', 'com.app', 'a.xml', { key: 'k', type: 'int', before: '1', after: 'x' })).toMatchObject({ error: 'invalid' })
    expect(await call('ccm:appdata-prefs-write', 'S1', 'com.app', 'a.xml', { key: 'k', type: 'int', before: '1', after: '2' })).toEqual({ ok: true })
    expect(inspector.writePref).toHaveBeenCalledWith('S1', 'com.app', 'a.xml', { key: 'k', type: 'int', before: '1', after: '2' })
    expect(inspector.openDb).not.toHaveBeenCalled()
  })

  it('denies non-app frames and removes its handlers', async () => {
    const { call, handlers, dispose } = setup(false)
    expect(await call('ccm:appdata-list', 'S1', 'com.app')).toMatchObject({ error: 'denied' })
    expect(await call('ccm:appdata-db-query', '0123456789abcdef', 'select 1')).toMatchObject({ error: 'denied' })
    dispose()
    expect(handlers.size).toBe(0)
  })
})
