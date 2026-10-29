import type { ChildProcess } from 'node:child_process'
import { createReadStream, createWriteStream, existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import type { DevFailure, DevFsFailure, DevFsKind, DevFsList, DevFsProgress, DevFsPulled, DevFsPushed, DevFsResult, DevFsScope } from '@ccm/shared'
import type { AdbCommands } from './adb'
import { runAsFailure } from './appData'
import {
  baseName, catArgs, deletable, existsArgs, isEntryName, joinPath, localSafeName, lsArgs, mkdirArgs, parseLsLa, partRmArgs, rmArgs, statArgs, uniqueName, writeArgs,
} from './devFiles'
import { shQuote } from './uiToggles'

const CMD_MS = 20_000
const RM_MS = 120_000
const PROGRESS_MS = 120
export const PUSH_MAX = 20

export interface DeviceFilesDeps {
  withDevice: <T>(id: string, fn: (cmds: AdbCommands) => Promise<T>) => Promise<T | DevFailure>
  confirmDelete: (req: { name: string; where: string; dir: boolean }) => Promise<boolean>
  confirmReplace: (req: { name: string; where: string }) => Promise<boolean>
  kill: (child: ChildProcess) => void
}

interface Active {
  transfer: string
  child: ChildProcess | null
  cancelled: boolean
}

type Progress = (p: DevFsProgress) => void

const fail = (error: DevFsFailure['error'], detail?: string): DevFsFailure => {
  const d = detail?.replace(/\s+/g, ' ').trim().slice(0, 300)
  return d ? { ok: false, error, detail: d } : { ok: false, error }
}

function errorOf(text: string): DevFsFailure {
  const refused = runAsFailure(text)
  if (refused) return refused
  if (/Permission denied/i.test(text)) return fail('permission')
  if (/No such file/i.test(text)) return fail('not-found')
  if (/Not a directory/i.test(text)) return fail('not-dir')
  if (/File exists/i.test(text)) return fail('exists')
  if (/Read-only file system/i.test(text)) return fail('permission', text)
  return fail('failed', text)
}

const where = (scope: DevFsScope, p: string): string => (scope.kind === 'app' ? `${scope.pkg}:${p}` : p)

/** Waits for a child; resolves with its exit code (null = killed / failed to start) and the stderr tail. */
function exited(child: ChildProcess): Promise<{ code: number | null; err: string }> {
  return new Promise((resolve) => {
    let err = ''
    child.stderr?.on('data', (d: Buffer | string) => (err = (err + d.toString()).slice(-2048)))
    child.once('error', () => resolve({ code: null, err }))
    child.once('close', (code: number | null) => resolve({ code, err }))
  })
}

/** Device file browser: lazy `ls -la` per folder, streamed pull / push with byte progress, delete and mkdir. */
export class DeviceFiles {
  private active: Active | null = null
  private readonly pulled = new Set<string>()

  constructor(private readonly deps: DeviceFilesDeps) {}

  wasPulled(local: string): boolean {
    return this.pulled.has(path.resolve(local))
  }

  private async scopeCheck(cmds: AdbCommands, id: string, scope: DevFsScope): Promise<DevFsFailure | null> {
    if (scope.kind === 'sdcard') return null
    const r = await cmds.shell(id, ['run-as', shQuote(scope.pkg), 'true'], CMD_MS)
    if (!r) return fail('adb-missing')
    if (r.timedOut) return fail('timeout')
    return runAsFailure(r.out) ?? (r.code === 0 ? null : fail('denied', r.out))
  }

  private run<T extends { ok: boolean }>(id: string, scope: DevFsScope, fn: (cmds: AdbCommands) => Promise<T | DevFsFailure>): Promise<T | DevFsFailure> {
    return this.deps.withDevice(id, async (cmds) => (await this.scopeCheck(cmds, id, scope)) ?? fn(cmds))
  }

  list(id: string, scope: DevFsScope, dir: string): Promise<DevFsList> {
    return this.run(id, scope, async (cmds): Promise<DevFsList> => {
      const r = await cmds.shell(id, lsArgs(scope, dir), CMD_MS)
      if (!r) return fail('adb-missing')
      if (r.timedOut) return fail('timeout')
      const parsed = parseLsLa(r.out)
      if (parsed.error) return fail(parsed.error)
      if (!parsed.entries.length && r.code !== 0) return errorOf(r.out)
      return { ok: true, path: dir, entries: parsed.entries, skipped: parsed.skipped }
    })
  }

  mkdir(id: string, scope: DevFsScope, dir: string, name: string): Promise<DevFsResult> {
    if (!isEntryName(name)) return Promise.resolve(fail('invalid'))
    return this.run(id, scope, async (cmds): Promise<DevFsResult> => {
      const r = await cmds.shell(id, mkdirArgs(scope, joinPath(dir, name)), CMD_MS)
      if (!r) return fail('adb-missing')
      if (r.timedOut) return fail('timeout')
      return r.code === 0 && !r.out.trim() ? { ok: true } : errorOf(r.out)
    })
  }

  remove(id: string, scope: DevFsScope, p: string, dir: boolean): Promise<DevFsResult> {
    if (!deletable(scope, p)) return Promise.resolve(fail('outside'))
    return this.run(id, scope, async (cmds): Promise<DevFsResult> => {
      if (!(await this.deps.confirmDelete({ name: baseName(p), where: where(scope, p), dir }))) return fail('cancelled')
      const r = await cmds.shell(id, rmArgs(scope, p, dir), RM_MS)
      if (!r) return fail('adb-missing')
      if (r.timedOut) return fail('timeout')
      return r.code === 0 && !r.out.trim() ? { ok: true } : errorOf(r.out)
    })
  }

  private begin(transfer: string): Active | null {
    if (this.active) return null
    this.active = { transfer, child: null, cancelled: false }
    return this.active
  }

  cancel(transfer: string): boolean {
    const a = this.active
    if (!a || a.transfer !== transfer) return false
    a.cancelled = true
    if (a.child) this.deps.kill(a.child)
    return true
  }

  dispose(): void {
    if (this.active?.child) this.deps.kill(this.active.child)
    if (this.active) this.active.cancelled = true
  }

  private ticker(onProgress: Progress, base: Omit<DevFsProgress, 'done'>): (done: number, force?: boolean) => void {
    let last = 0
    return (done, force = false) => {
      const now = Date.now()
      if (!force && now - last < PROGRESS_MS) return
      last = now
      onProgress({ ...base, done })
    }
  }

  async pull(id: string, scope: DevFsScope, p: string, kind: DevFsKind, size: number | null, destDir: string, transfer: string, onProgress: Progress): Promise<DevFsPulled> {
    const a = this.begin(transfer)
    if (!a) return fail('busy')
    try {
      return await this.run(id, scope, async (cmds): Promise<DevFsPulled> => {
        const name = uniqueName(localSafeName(baseName(p)), (n) => existsSync(path.join(destDir, n)) || existsSync(path.join(destDir, n + '.orrery-part')))
        if (!name) return fail('exists')
        const final = path.join(destDir, name)
        const tick = this.ticker(onProgress, { transfer, name: baseName(p), total: kind === 'dir' ? null : size, index: 0, count: 1 })
        if (kind === 'dir') {
          if (scope.kind === 'app') return fail('unsupported')
          return this.pullDir(cmds, id, p, final, name, destDir, a, tick)
        }
        const part = `${final}.orrery-part`
        const child = await cmds.spawnAdb(id, ['exec-out', ...catArgs(scope, p)], false)
        if (!child?.stdout) return fail('adb-missing')
        a.child = child
        tick(0, true)
        let done = 0
        let head = Buffer.alloc(0)
        const out = createWriteStream(part)
        const written = new Promise<boolean>((resolve) => {
          out.once('finish', () => resolve(true))
          out.once('error', () => resolve(false))
        })
        child.stdout.on('data', (b: Buffer) => {
          if (head.length < 512) head = Buffer.concat([head, b]).subarray(0, 512)
          done += b.length
          tick(done)
        })
        child.stdout.pipe(out)
        const { code, err } = await exited(child)
        if (a.cancelled && !out.closed) {
          await new Promise<void>((resolve) => {
            out.once('close', () => resolve())
            out.destroy()
          })
        }
        const ok = a.cancelled ? false : await written
        tick(done, true)
        const drop = () => fs.rm(part, { force: true }).catch(() => undefined)
        if (a.cancelled || !ok) {
          await drop()
          return a.cancelled ? fail('cancelled') : fail('failed', 'write')
        }
        const text = `${head.toString('utf8')} ${err}`
        if (code !== 0 || (size !== null && kind === 'file' && done !== size)) {
          await drop()
          const e = done < 512 || code !== 0 ? errorOf(text) : fail('failed')
          return e.error === 'failed' && size !== null ? fail('failed', `${done} / ${size} B`) : e
        }
        // `cat` of a refused path still exits 0 on some devices and only prints the refusal.
        if (size === null && done < 512 && (runAsFailure(text) || /^cat: .*(denied|No such file)/m.test(text))) {
          await drop()
          return errorOf(text)
        }
        await fs.rename(part, final)
        this.pulled.add(path.resolve(final))
        return { ok: true, local: final, name, inDir: destDir }
      })
    } finally {
      this.active = null
    }
  }

  private async pullDir(cmds: AdbCommands, id: string, p: string, final: string, name: string, destDir: string, a: Active, tick: (done: number, force?: boolean) => void): Promise<DevFsPulled> {
    const child = await cmds.spawnAdb(id, ['pull', p, final], false)
    if (!child) return fail('adb-missing')
    a.child = child
    tick(0, true)
    let out = ''
    child.stdout?.on('data', (d: Buffer | string) => (out = (out + d.toString()).slice(-2048)))
    const { code, err } = await exited(child)
    if (a.cancelled || code !== 0) {
      await fs.rm(final, { recursive: true, force: true }).catch(() => undefined)
      return a.cancelled ? fail('cancelled') : errorOf(`${out} ${err}`)
    }
    this.pulled.add(path.resolve(final))
    return { ok: true, local: final, name, inDir: destDir }
  }

  async push(id: string, scope: DevFsScope, dir: string, locals: string[], transfer: string, onProgress: Progress): Promise<DevFsPushed> {
    const a = this.begin(transfer)
    if (!a) return fail('busy')
    try {
      return await this.run(id, scope, async (cmds): Promise<DevFsPushed> => {
        const pushed: string[] = []
        const skipped: string[] = []
        const files: { local: string; name: string; size: number }[] = []
        for (const local of locals.slice(0, PUSH_MAX)) {
          const st = await fs.stat(local).catch(() => null)
          const name = path.basename(local)
          if (!st?.isFile() || !isEntryName(name)) skipped.push(name)
          else files.push({ local, name, size: st.size })
        }
        for (const [index, f] of files.entries()) {
          if (a.cancelled) return fail('cancelled')
          const remote = joinPath(dir, f.name)
          const exists = await cmds.shell(id, existsArgs(scope, remote), CMD_MS)
          if (!exists) return fail('adb-missing')
          if (exists.code === 0 && !(await this.deps.confirmReplace({ name: f.name, where: where(scope, remote) }))) {
            skipped.push(f.name)
            continue
          }
          const r = await this.pushOne(cmds, id, scope, remote, f, a, this.ticker(onProgress, { transfer, name: f.name, total: f.size, index, count: files.length }))
          if (r) return r
          pushed.push(f.name)
        }
        return { ok: true, pushed, skipped }
      })
    } finally {
      this.active = null
    }
  }

  private async pushOne(cmds: AdbCommands, id: string, scope: DevFsScope, remote: string, f: { local: string; size: number }, a: Active, tick: (done: number, force?: boolean) => void): Promise<DevFsFailure | null> {
    const child = await cmds.spawnAdb(id, ['shell', ...writeArgs(scope, remote)], true)
    if (!child?.stdin) return fail('adb-missing')
    a.child = child
    let out = ''
    child.stdout?.on('data', (d: Buffer | string) => (out = (out + d.toString()).slice(-2048)))
    child.stdin.on('error', () => undefined)
    const src = createReadStream(f.local)
    let done = 0
    tick(0, true)
    src.on('data', (b) => {
      done += b.length
      tick(done)
    })
    src.on('error', () => this.deps.kill(child))
    src.pipe(child.stdin)
    const { code, err } = await exited(child)
    tick(done, true)
    const cleanup = () => cmds.shell(id, partRmArgs(scope, remote), CMD_MS).catch(() => null)
    if (a.cancelled) {
      await cleanup()
      return fail('cancelled')
    }
    if (code !== 0 || done !== f.size) {
      await cleanup()
      return errorOf(`${out} ${err}`)
    }
    const st = await cmds.shell(id, statArgs(scope, remote), CMD_MS)
    const got = st ? parseLsLa(st.out).entries[0]?.size : undefined
    return got === f.size ? null : fail('failed', `${got ?? '?'} / ${f.size} B`)
  }
}
