import { createHash, randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { AppDataFailure, AppDataFile, AppDataList, AppDbCell, AppDbOpen, AppDbRows, AppDbTable, AppPrefs, DevFailure, PrefEdit } from '@ccm/shared'
import type { Database, SqlJsStatic, SqlValue } from 'sql.js'
import type { AdbCommands } from './adb'
import { applyPrefEdit, parsePrefs, prefShown } from './prefs'
import { checkReadOnlySql, quoteIdent } from './sqlGuard'
import { applyWal, isSqlite } from './sqliteWal'
import { shQuote } from './uiToggles'

export const APPDATA_ORIGINALS_DIR = 'appdata-originals'
export const DB_MAX = 128 * 1024 * 1024
export const WAL_MAX = 64 * 1024 * 1024
export const PREFS_MAX = 2 * 1024 * 1024
export const ROWS_PAGE = 200
export const QUERY_ROWS_MAX = 1000
const CELL_MAX = 4000
const OPEN_MAX = 3
const TABLES_MAX = 300
const PULL_MS = 60_000
const CMD_MS = 15_000

const NAME = /^(?![.-])[A-Za-z0-9._+-]{1,128}$/
/** File names under databases/ and shared_prefs/ end up in a device shell line: a whitelist, never quoting alone. */
export const isDataFileName = (v: unknown): v is string => typeof v === 'string' && NAME.test(v)
const SIDE_FILE = /-(wal|shm|journal)$/

// Inner sh runs as the app (run-as), so the glob sees the app's private files.
const LIST_SCRIPT = 'for f in databases/* shared_prefs/*; do [ -f "$f" ] && echo "$(wc -c < "$f") $f"; done; true'

export function parseDataList(out: string): { databases: AppDataFile[]; prefs: AppDataFile[]; skipped: number } {
  const dbNames = new Map<string, number>()
  const prefs: AppDataFile[] = []
  let skipped = 0
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(databases|shared_prefs)\/(.+?)\s*$/.exec(line)
    if (!m) continue
    const [, size, dir, name] = m as unknown as [string, string, string, string]
    if (!isDataFileName(name)) {
      skipped++
      continue
    }
    if (dir === 'databases') dbNames.set(name, Number(size))
    else if (name.endsWith('.xml')) prefs.push({ name, size: Number(size) })
  }
  const databases: AppDataFile[] = []
  for (const [name, size] of dbNames) {
    if (SIDE_FILE.test(name)) continue
    databases.push(dbNames.has(`${name}-wal`) ? { name, size, wal: true } : { name, size })
  }
  const byName = (a: AppDataFile, b: AppDataFile) => a.name.localeCompare(b.name)
  return { databases: databases.sort(byName), prefs: prefs.sort(byName), skipped }
}

/** `run-as` refusals as the device words them (old and new Android). */
export function runAsFailure(out: string): AppDataFailure | null {
  if (/not debuggable/i.test(out)) return { ok: false, error: 'not-debuggable' }
  if (/unknown package|is unknown|not an application|package .* not found/i.test(out)) return { ok: false, error: 'unknown-package' }
  if (/run-as:/i.test(out)) return { ok: false, error: 'denied', detail: out.replace(/\s+/g, ' ').trim().slice(0, 200) }
  return null
}

export function toCell(v: SqlValue): AppDbCell {
  if (v instanceof Uint8Array) return { blob: v.length }
  if (typeof v === 'string' && v.length > CELL_MAX) return `${v.slice(0, CELL_MAX)}…`
  return v
}

export interface ConfirmPrefWrite {
  pkg: string
  file: string
  key: string
  before: string
  after: string
}

export interface AppDataDeps {
  /** Runs `fn` with the adb commands once `id` is a ready device (`DeviceManager.withReady`). */
  withDevice: <T>(id: string, fn: (cmds: AdbCommands) => Promise<T>) => Promise<T | DevFailure>
  sql: () => Promise<SqlJsStatic>
  dataDir: string
  confirmWrite: (req: ConfirmPrefWrite) => Promise<boolean>
  confirmRestore: (req: { pkg: string; file: string }) => Promise<boolean>
}

interface OpenDb {
  db: Database
  counts: Map<string, number | null>
  used: number
}

const fail = (error: AppDataFailure['error'], detail?: string): AppDataFailure => (detail ? { ok: false, error, detail } : { ok: false, error })

/** Debug-app data over `run-as`: list, pull SQLite / SharedPreferences, edit a pref with an original kept for restore. */
export class AppDataInspector {
  private readonly open = new Map<string, OpenDb>()
  private writing = false

  constructor(private readonly deps: AppDataDeps) {}

  private originalOf(serial: string, pkg: string, name: string): string {
    return path.join(this.deps.dataDir, APPDATA_ORIGINALS_DIR, createHash('sha1').update(serial).digest('hex'), pkg, name)
  }

  private async runAs(cmds: AdbCommands, id: string, pkg: string): Promise<AppDataFailure | null> {
    const r = await cmds.shell(id, ['run-as', shQuote(pkg), 'true'], CMD_MS)
    if (!r) return fail('adb-missing')
    if (r.timedOut) return fail('timeout')
    return runAsFailure(r.out) ?? (r.code === 0 ? null : fail('denied', r.out.trim().slice(0, 200) || undefined))
  }

  private async pull(cmds: AdbCommands, id: string, pkg: string, rel: string, max: number): Promise<Buffer | AppDataFailure> {
    const r = await cmds.execOut(id, ['run-as', shQuote(pkg), 'cat', shQuote(rel)], PULL_MS, max)
    if (!r) return fail('adb-missing')
    if (r.timedOut) return fail('timeout')
    if (r.overflow) return fail('too-large')
    const head = r.out.subarray(0, 300).toString('utf8')
    if (r.out.length < 300 && /No such file/i.test(head + r.err)) return fail('gone')
    const refused = r.out.length < 300 ? runAsFailure(head + r.err) : null
    if (refused) return refused
    return r.code === null ? fail('pull-failed') : r.out
  }

  async list(id: string, pkg: string): Promise<AppDataList> {
    return this.deps.withDevice(id, async (cmds): Promise<AppDataList> => {
      const refused = await this.runAs(cmds, id, pkg)
      if (refused) return refused
      const r = await cmds.shell(id, ['run-as', shQuote(pkg), 'sh', '-c', shQuote(LIST_SCRIPT)], CMD_MS)
      if (!r) return fail('adb-missing')
      if (r.timedOut) return fail('timeout')
      return { ok: true, pkg, ...parseDataList(r.out) }
    })
  }

  private closeOldest(): void {
    while (this.open.size >= OPEN_MAX) {
      const [handle] = [...this.open.entries()].sort((a, b) => a[1].used - b[1].used)[0]!
      this.close(handle)
    }
  }

  async openDb(id: string, pkg: string, name: string): Promise<AppDbOpen> {
    return this.deps.withDevice(id, async (cmds): Promise<AppDbOpen> => {
      const refused = await this.runAs(cmds, id, pkg)
      if (refused) return refused
      const main = await this.pull(cmds, id, pkg, `databases/${name}`, DB_MAX)
      if (!Buffer.isBuffer(main)) return main
      const walBytes = await this.pull(cmds, id, pkg, `databases/${name}-wal`, WAL_MAX)
      const wal = Buffer.isBuffer(walBytes) && walBytes.length ? walBytes : null
      const walMissing = !Buffer.isBuffer(walBytes) && walBytes.error !== 'gone'
      const applied = applyWal(main, wal)
      if (!isSqlite(applied.db)) return fail('not-sqlite')
      const SQL = await this.deps.sql().catch(() => null)
      if (!SQL) return fail('unsupported', 'sql.js')
      let db: Database
      let tables: AppDbTable[]
      const counts = new Map<string, number | null>()
      try {
        db = new SQL.Database(applied.db)
        db.exec('PRAGMA query_only = ON')
        const res = db.exec("SELECT name, type, sql FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name")
        const rows = (res[0]?.values ?? []).slice(0, TABLES_MAX)
        tables = rows.map(([n, type, sql]) => {
          const tname = String(n)
          let count: number | null = null
          if (type === 'table') {
            try {
              count = Number(db.exec(`SELECT count(*) FROM ${quoteIdent(tname)}`)[0]?.values[0]?.[0] ?? 0)
            } catch {
              count = null
            }
          }
          counts.set(tname, count)
          return { name: tname, type: type === 'view' ? 'view' : 'table', sql: typeof sql === 'string' ? sql : '', rows: count }
        })
      } catch (err) {
        return fail('not-sqlite', err instanceof Error ? err.message.slice(0, 200) : undefined)
      }
      this.closeOldest()
      const handle = randomBytes(8).toString('hex')
      this.open.set(handle, { db, counts, used: Date.now() })
      const walState = applied.partial || walMissing ? 'partial' : applied.frames ? 'applied' : 'none'
      return { ok: true, handle, name, size: main.length, tables, wal: walState, walFrames: applied.frames }
    })
  }

  private run(o: OpenDb, sql: string, max: number): AppDbRows {
    o.used = Date.now()
    let stmt: ReturnType<Database['prepare']> | null = null
    try {
      stmt = o.db.prepare(sql)
      const rows: AppDbCell[][] = []
      let truncated = false
      while (stmt.step()) {
        if (rows.length >= max) {
          truncated = true
          break
        }
        rows.push(stmt.get().map(toCell))
      }
      return { ok: true, columns: stmt.getColumnNames(), rows, total: null, truncated }
    } catch (err) {
      return fail('sql-error', err instanceof Error ? err.message.slice(0, 300) : undefined)
    } finally {
      stmt?.free()
    }
  }

  rows(handle: string, table: string, page: number): AppDbRows {
    const o = this.open.get(handle)
    if (!o) return fail('gone')
    if (!o.counts.has(table)) return fail('invalid')
    const r = this.run(o, `SELECT * FROM ${quoteIdent(table)} LIMIT ${ROWS_PAGE} OFFSET ${page * ROWS_PAGE}`, ROWS_PAGE)
    return r.ok ? { ...r, total: o.counts.get(table) ?? null, truncated: false } : r
  }

  query(handle: string, sql: unknown): AppDbRows {
    const o = this.open.get(handle)
    if (!o) return fail('gone')
    const g = checkReadOnlySql(sql)
    if (!g.ok) return fail('sql-rejected', g.reason)
    return this.run(o, g.sql, QUERY_ROWS_MAX)
  }

  close(handle: string): void {
    const o = this.open.get(handle)
    if (!o) return
    this.open.delete(handle)
    try {
      o.db.close()
    } catch {
      // already closed
    }
  }

  closeAll(): void {
    for (const h of [...this.open.keys()]) this.close(h)
  }

  private async prefsOf(cmds: AdbCommands, id: string, pkg: string, name: string): Promise<{ bytes: Buffer; text: string } | AppDataFailure> {
    const bytes = await this.pull(cmds, id, pkg, `shared_prefs/${name}`, PREFS_MAX)
    if (!Buffer.isBuffer(bytes)) return bytes
    return { bytes, text: bytes.toString('utf8') }
  }

  private async hasOriginal(id: string, pkg: string, name: string): Promise<boolean> {
    return fs
      .stat(this.originalOf(id, pkg, name))
      .then((s) => s.isFile())
      .catch(() => false)
  }

  private async prefsResult(cmds: AdbCommands, id: string, pkg: string, name: string): Promise<AppPrefs> {
    const read = await this.prefsOf(cmds, id, pkg, name)
    if ('ok' in read) return read
    const entries = parsePrefs(read.text)
    if (!entries) return fail('pull-failed')
    return { ok: true, name, entries, hasOriginal: await this.hasOriginal(id, pkg, name) }
  }

  async readPrefs(id: string, pkg: string, name: string): Promise<AppPrefs> {
    return this.deps.withDevice(id, async (cmds): Promise<AppPrefs> => {
      const refused = await this.runAs(cmds, id, pkg)
      return refused ?? this.prefsResult(cmds, id, pkg, name)
    })
  }

  /** Force-stop first: a running app would write its in-memory prefs back over the file. Then temp file + mv, then read back. */
  private async push(cmds: AdbCommands, id: string, pkg: string, name: string, bytes: Buffer): Promise<AppDataFailure | null> {
    const stop = await cmds.shell(id, ['am', 'force-stop', shQuote(pkg)], CMD_MS)
    if (!stop) return fail('adb-missing')
    const tmp = `shared_prefs/${name}.orrery-tmp`
    const w = await cmds.shellInput(id, ['run-as', shQuote(pkg), 'sh', '-c', shQuote(`cat > ${tmp} && mv ${tmp} shared_prefs/${name}`)], bytes, CMD_MS)
    if (!w) return fail('adb-missing')
    if (w.timedOut) return fail('timeout')
    const back = await this.pull(cmds, id, pkg, `shared_prefs/${name}`, PREFS_MAX)
    return Buffer.isBuffer(back) && back.equals(bytes) ? null : fail('write-failed', `${w.out.toString('utf8')} ${w.err}`.trim().slice(0, 200) || undefined)
  }

  private async exclusive<T>(fn: () => Promise<T>): Promise<T | AppDataFailure> {
    if (this.writing) return fail('cancelled', 'busy')
    this.writing = true
    try {
      return await fn()
    } finally {
      this.writing = false
    }
  }

  async writePref(id: string, pkg: string, name: string, edit: PrefEdit): Promise<AppPrefs> {
    return this.exclusive(() =>
      this.deps.withDevice(id, async (cmds): Promise<AppPrefs> => {
        const refused = await this.runAs(cmds, id, pkg)
        if (refused) return refused
        const cur = await this.prefsOf(cmds, id, pkg, name)
        if ('ok' in cur) return cur
        const next = applyPrefEdit(cur.text, edit)
        if (!next.ok) return fail(next.error)
        if (!(await this.deps.confirmWrite({ pkg, file: name, key: edit.key, before: prefShown(edit.before), after: prefShown(edit.after) }))) return fail('cancelled')
        const original = this.originalOf(id, pkg, name)
        if (!(await this.hasOriginal(id, pkg, name))) {
          try {
            await fs.mkdir(path.dirname(original), { recursive: true })
            await fs.writeFile(original, cur.bytes, { flag: 'wx' })
          } catch {
            return fail('write-failed', 'original')
          }
        }
        const pushed = await this.push(cmds, id, pkg, name, Buffer.from(next.xml, 'utf8'))
        return pushed ?? this.prefsResult(cmds, id, pkg, name)
      }),
    )
  }

  async restorePrefs(id: string, pkg: string, name: string): Promise<AppPrefs> {
    return this.exclusive(() =>
      this.deps.withDevice(id, async (cmds): Promise<AppPrefs> => {
        const original = this.originalOf(id, pkg, name)
        const bytes = await fs.readFile(original).catch(() => null)
        if (!bytes) return fail('no-original')
        const refused = await this.runAs(cmds, id, pkg)
        if (refused) return refused
        if (!(await this.deps.confirmRestore({ pkg, file: name }))) return fail('cancelled')
        const pushed = await this.push(cmds, id, pkg, name, bytes)
        if (pushed) return pushed
        await fs.rm(original, { force: true })
        return this.prefsResult(cmds, id, pkg, name)
      }),
    )
  }
}
