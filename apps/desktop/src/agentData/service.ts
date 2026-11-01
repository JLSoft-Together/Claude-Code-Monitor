import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  CLEAN_MIN_AGE_MS,
  DATA_AGENTS,
  STRIP_AGE_DAYS,
  classifyEntry,
  groupRule,
  movedName,
  type AgentDataError,
  type AgentDataOp,
  type AgentDataPlace,
  type AgentDataProgress,
  type AgentDataResult,
  type AgentDataSize,
  type AgentDataState,
  type AgentProc,
  type CleanRequest,
  type DataAgent,
  type DataEntrySize,
  type DataGroupSize,
  type MoveRecord,
} from '@ccm/shared'
import { Cancelled, copyTree, isInsideOrSame, linkTarget, makeDirLink, removeLink, removeTree, treeSize, verifyCopy, walkTree } from './fsTree'
import { recoverMoves, type MoveStore } from './move'
import { countFile, runningSessions, stripCandidates, stripFile, type StripCandidate } from './strip'

const DAY = 24 * 60 * 60 * 1000

export interface ConfirmSpec {
  message: string
  detail: string
  /** First = the action; last = cancel. */
  buttons: string[]
}

export interface AgentDataTexts {
  cancel: string
  group: (id: string) => string
  cleanTitle: (files: number, size: string) => string
  cleanDetail: (lines: string[], days: number) => string
  cleanConfirm: string
  stripTitle: (files: number, images: number) => string
  stripDetail: (size: string, backup: string) => string
  stripConfirm: string
  moveTitle: (from: string, to: string) => string
  moveDetail: (size: string, original: string) => string
  moveConfirm: string
  undoTitle: (folder: string) => string
  undoDetail: (target: string, newFiles: number, originalDeleted: boolean) => string
  undoCopyBack: (n: number) => string
  undoOnly: string
  deleteTitle: (folder: string) => string
  deleteDetail: (size: string) => string
  deleteConfirm: string
  discardTitle: (folder: string) => string
  discardDetail: string
  discardConfirm: string
}

export interface AgentDataDeps {
  roots: () => Record<DataAgent, string> & { claudeApp: string | null }
  store: MoveStore
  procs: (agent: DataAgent) => Promise<AgentProc[]>
  confirm: (spec: ConfirmSpec) => Promise<number>
  pickFolder: (purpose: 'target' | 'backup') => Promise<string | null>
  /** Collector watchers hold directory handles on Windows: stopped around the rename, started again after. */
  stopCollector: () => Promise<void>
  startCollector: () => Promise<void>
  emit: (p: AgentDataProgress) => void
  isLocal: (dir: string) => Promise<boolean>
  freeBytes: (dir: string) => Promise<number | null>
  texts: () => AgentDataTexts
  alive?: (pid: number) => boolean
  now?: () => number
  platform?: NodeJS.Platform
}

export function fmtBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

const fail = (error: AgentDataError, extra: Partial<AgentDataResult> = {}): AgentDataResult => ({ ok: false, error, ...extra })

const defaultAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Files of the clean groups older than the cutoff; files written in the last 24 h are never included. */
export async function cleanPlan(root: string, req: CleanRequest, now: number, signal?: AbortSignal, caseInsensitive = false): Promise<{ files: { path: string; size: number }[]; bytes: number }> {
  const cutoff = now - Math.max(req.olderDays * DAY, CLEAN_MIN_AGE_MS)
  const files: { path: string; size: number }[] = []
  let bytes = 0
  const names = await fs.readdir(root).catch(() => [] as string[])
  for (const name of names) {
    const rule = classifyEntry(req.agent, name, caseInsensitive)
    if (!rule.cleanable || !req.groups.includes(rule.id)) continue
    const p = path.join(root, name)
    const st = await fs.lstat(p).catch(() => null)
    if (!st || st.isSymbolicLink()) continue
    if (st.isFile()) {
      if (st.mtimeMs < cutoff) {
        files.push({ path: p, size: st.size })
        bytes += st.size
      }
      continue
    }
    if (!st.isDirectory()) continue
    await walkTree(
      p,
      (e) => {
        if (e.type === 'file' && e.mtimeMs < cutoff) {
          files.push({ path: path.join(p, e.rel), size: e.size })
          bytes += e.size
        }
      },
      signal,
    )
  }
  return { files, bytes }
}

export class AgentDataService {
  private busy: AgentDataOp | null = null
  private abort: AbortController | null = null
  private recovered: DataAgent[] = []
  private lastEmit = 0

  constructor(private readonly deps: AgentDataDeps) {}

  private get now(): number {
    return (this.deps.now ?? Date.now)()
  }

  private get win(): boolean {
    return (this.deps.platform ?? process.platform) === 'win32'
  }

  /** Before the collector starts: puts back an original left renamed by a crash mid-move. */
  async recover(): Promise<void> {
    await this.deps.store.load()
    this.recovered = await recoverMoves(this.deps.store)
  }

  async state(): Promise<AgentDataState> {
    const roots = this.deps.roots()
    const places: AgentDataPlace[] = []
    for (const agent of DATA_AGENTS) {
      const root = roots[agent]
      const target = await linkTarget(root)
      places.push({ agent, root, exists: existsSync(root), linkTarget: target, move: this.deps.store.get(agent) })
    }
    return { places, claudeApp: roots.claudeApp, busy: this.busy, recovered: this.recovered }
  }

  cancel(): boolean {
    if (!this.abort) return false
    this.abort.abort()
    return true
  }

  private progress(p: AgentDataProgress, force = false): void {
    const now = Date.now()
    if (!force && now - this.lastEmit < 200) return
    this.lastEmit = now
    this.deps.emit(p)
  }

  private async run<T extends AgentDataResult | AgentDataSize[] | null>(op: AgentDataOp, fn: (signal: AbortSignal) => Promise<T>, busyValue: T): Promise<T> {
    if (this.busy) return busyValue
    this.busy = op
    this.abort = new AbortController()
    try {
      return await fn(this.abort.signal)
    } finally {
      this.busy = null
      this.abort = null
    }
  }

  scan(): Promise<AgentDataSize[] | null> {
    return this.run('scan', (signal) => this.scanAll(signal).catch((err) => (err instanceof Cancelled ? null : Promise.reject(err))), null)
  }

  private async scanAll(signal: AbortSignal): Promise<AgentDataSize[]> {
    const roots = this.deps.roots()
    const out: AgentDataSize[] = []
    let files = 0
    let bytes = 0
    const tick = (n: number): void => {
      files++
      bytes += n
      this.progress({ op: 'scan', files, bytes })
    }
    const places: [AgentDataSize['agent'], string | null][] = [['claude', roots.claude], ['codex', roots.codex], ['claudeApp', roots.claudeApp]]
    for (const [agent, root] of places) {
      if (!root) continue
      const size: AgentDataSize = { agent, root, exists: existsSync(root), files: 0, bytes: 0, groups: [] }
      out.push(size)
      if (!size.exists) continue
      // A moved folder is walked through its junction; the junction itself is the root here, not a nested link.
      const base = (await linkTarget(root)) ?? root
      const names = await fs.readdir(base).catch(() => [] as string[])
      const groups = new Map<string, DataGroupSize>()
      for (const name of names) {
        const rule = agent === 'claudeApp' ? { id: 'desktopApp', kind: 'unknown' as const } : classifyEntry(agent, name, this.win)
        const p = path.join(base, name)
        const st = await fs.lstat(p).catch(() => null)
        if (!st) continue
        const entry: DataEntrySize = { name, dir: st.isDirectory(), link: null, files: 0, bytes: 0, newestMs: null }
        if (st.isSymbolicLink()) entry.link = await linkTarget(p)
        else if (st.isDirectory()) Object.assign(entry, await treeSize(p, signal, tick))
        else if (st.isFile()) {
          Object.assign(entry, { files: 1, bytes: st.size, newestMs: st.mtimeMs })
          tick(st.size)
        }
        const full = agent === 'claudeApp' ? null : groupRule(agent, rule.id)
        let g = groups.get(rule.id)
        if (!g) {
          g = { id: rule.id, kind: rule.kind, cleanable: full?.cleanable === true, idleOnly: full?.idleOnly === true, files: 0, bytes: 0, entries: [] }
          groups.set(rule.id, g)
        }
        g.entries.push(entry)
        g.files += entry.files
        g.bytes += entry.bytes
      }
      size.groups = [...groups.values()].sort((a, b) => b.bytes - a.bytes)
      for (const g of size.groups) g.entries.sort((a, b) => b.bytes - a.bytes)
      size.files = size.groups.reduce((n, g) => n + g.files, 0)
      size.bytes = size.groups.reduce((n, g) => n + g.bytes, 0)
    }
    this.progress({ op: 'scan', files, bytes }, true)
    return out
  }

  clean(req: CleanRequest): Promise<AgentDataResult> {
    return this.run('clean', (signal) => this.doClean(req, signal).catch(onCancel), fail('busy'))
  }

  private async doClean(req: CleanRequest, signal: AbortSignal): Promise<AgentDataResult> {
    const root = this.deps.roots()[req.agent]
    if (req.groups.some((id) => groupRule(req.agent, id)?.idleOnly)) {
      const procs = await this.deps.procs(req.agent)
      if (procs.length) return fail('running', { procs })
    }
    const plan = await cleanPlan(root, req, this.now, signal, this.win)
    if (!plan.files.length) return fail('nothing')
    const t = this.deps.texts()
    const lines = req.groups.map((id) => `• ${t.group(id)} — ${groupRule(req.agent, id)?.names.join(', ') ?? id}`)
    const answer = await this.deps.confirm({ message: t.cleanTitle(plan.files.length, fmtBytes(plan.bytes)), detail: t.cleanDetail(lines, req.olderDays), buttons: [t.cleanConfirm, t.cancel] })
    if (answer !== 0) return fail('cancelled')
    let files = 0
    let bytes = 0
    let skipped = 0
    const dirs = new Set<string>()
    for (const f of plan.files) {
      if (signal.aborted) break
      // Re-checked at delete time: a file touched since the preview is kept.
      const st = await fs.lstat(f.path).catch(() => null)
      if (!st?.isFile() || this.now - st.mtimeMs < Math.max(req.olderDays * DAY, CLEAN_MIN_AGE_MS)) {
        skipped++
        continue
      }
      try {
        await fs.unlink(f.path)
        files++
        bytes += f.size
        dirs.add(path.dirname(f.path))
      } catch {
        skipped++
      }
      this.progress({ op: 'clean', agent: req.agent, files, bytes, totalBytes: plan.bytes, phase: 'delete' })
    }
    const tops = new Set(req.groups.flatMap((id) => groupRule(req.agent, id)?.names ?? []).map((n) => path.join(root, n)))
    for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
      let dir = d
      while (isInsideOrSame(root, dir, this.deps.platform) && dir !== root && !tops.has(dir)) {
        if (!(await fs.rmdir(dir).then(() => true, () => false))) break
        dir = path.dirname(dir)
      }
    }
    return { ok: true, files, bytes, skipped }
  }

  strip(minDays: number): Promise<AgentDataResult> {
    if (!STRIP_AGE_DAYS.includes(minDays as (typeof STRIP_AGE_DAYS)[number])) return Promise.resolve(fail('invalid'))
    return this.run('strip', (signal) => this.doStrip(minDays, signal).catch(onCancel), fail('busy'))
  }

  private async doStrip(minDays: number, signal: AbortSignal): Promise<AgentDataResult> {
    const root = this.deps.roots().claude
    const running = await runningSessions(root, this.deps.alive ?? defaultAlive)
    const projects = path.join(root, 'projects')
    const cands = await stripCandidates(projects, this.now - minDays * DAY, running, signal)
    const withImages: (StripCandidate & { images: number; chars: number })[] = []
    let scanned = 0
    for (const c of cands) {
      const n = await countFile(c.file, signal).catch((err) => (err instanceof Cancelled ? Promise.reject(err) : { images: 0, bytes: 0 }))
      scanned += c.size
      this.progress({ op: 'strip', agent: 'claude', files: withImages.length, bytes: scanned, phase: 'check' })
      if (n.bytes) withImages.push({ ...c, images: n.images, chars: n.bytes })
    }
    if (!withImages.length) return fail('nothing')
    const backupRoot = await this.deps.pickFolder('backup')
    if (!backupRoot) return fail('cancelled')
    if (isInsideOrSame(root, backupRoot, this.deps.platform) || isInsideOrSame(backupRoot, root, this.deps.platform)) return fail('target-inside')
    const need = withImages.reduce((n, c) => n + c.size, 0)
    const free = await this.deps.freeBytes(backupRoot)
    if (free !== null && free < need + 64 * 1024 * 1024) return fail('no-space')
    const images = withImages.reduce((n, c) => n + c.images, 0)
    const chars = withImages.reduce((n, c) => n + c.chars, 0)
    const dest = path.join(backupRoot, `orrery-transcripts-${new Date(this.now).toISOString().slice(0, 10)}-${this.now}`)
    const t = this.deps.texts()
    const answer = await this.deps.confirm({ message: t.stripTitle(withImages.length, images), detail: t.stripDetail(fmtBytes(chars), dest), buttons: [t.stripConfirm, t.cancel] })
    if (answer !== 0) return fail('cancelled')
    const stillRunning = await runningSessions(root, this.deps.alive ?? defaultAlive)
    let files = 0
    let saved = 0
    let skipped = 0
    for (const c of withImages) {
      if (signal.aborted) break
      if (stillRunning.has(c.sessionId)) {
        skipped++
        continue
      }
      const r = await stripFile(c.file, path.join(dest, c.rel), signal).catch((err) => (err instanceof Cancelled ? Promise.reject(err) : { ok: false, images: 0, bytes: 0 }))
      if (r.ok && r.bytes) {
        files++
        saved += r.bytes
      } else if (!r.ok) skipped++
      this.progress({ op: 'strip', agent: 'claude', files, bytes: saved, phase: 'rewrite' })
    }
    return { ok: files > 0, ...(files ? {} : { error: 'failed' as const }), files, bytes: saved, skipped, path: dest }
  }

  move(agent: DataAgent): Promise<AgentDataResult> {
    return this.run('move', (signal) => this.doMove(agent, signal), fail('busy'))
  }

  private async doMove(agent: DataAgent, signal: AbortSignal): Promise<AgentDataResult> {
    const { store } = this.deps
    const source = this.deps.roots()[agent]
    if (!existsSync(source)) return fail('not-found')
    if (await linkTarget(source)) return fail('already-moved')
    if (store.get(agent)) return fail('invalid')
    const procs = await this.deps.procs(agent)
    if (procs.length) return fail('running', { procs })
    const parent = await this.deps.pickFolder('target')
    if (!parent) return fail('cancelled')
    const target = path.join(parent, path.basename(source))
    if (isInsideOrSame(source, parent, this.deps.platform) || isInsideOrSame(parent, source, this.deps.platform)) return fail('target-inside')
    if (existsSync(target)) return fail('target-exists', { path: target })
    if (!(await this.deps.isLocal(parent))) return fail('not-local')
    let size: { files: number; bytes: number }
    try {
      size = await treeSize(source, signal, () => undefined)
    } catch (err) {
      return onCancel(err)
    }
    const free = await this.deps.freeBytes(parent)
    if (free !== null && free < size.bytes * 1.02 + 256 * 1024 * 1024) return fail('no-space', { bytes: size.bytes })
    const at = this.now
    const backup = path.join(path.dirname(source), movedName(path.basename(source), at))
    const t = this.deps.texts()
    const answer = await this.deps.confirm({ message: t.moveTitle(source, target), detail: t.moveDetail(fmtBytes(size.bytes), path.basename(backup)), buttons: [t.moveConfirm, t.cancel] })
    if (answer !== 0) return fail('cancelled')
    const rec: MoveRecord = { agent, source, target, backup, at, phase: 'copying', originalDeleted: false }
    await store.set(rec)
    const discard = async (error: AgentDataError, extra: Partial<AgentDataResult> = {}): Promise<AgentDataResult> => {
      await removeTree(target).catch(() => undefined)
      await store.drop(agent)
      return fail(error, extra)
    }
    let copied = 0
    let copy: Awaited<ReturnType<typeof copyTree>>
    try {
      copy = await copyTree(source, target, {
        signal,
        platform: this.deps.platform,
        onBytes: (n) => {
          copied += n
          this.progress({ op: 'move', agent, files: 0, bytes: copied, totalBytes: size.bytes, phase: 'copy' })
        },
      })
    } catch (err) {
      return discard(err instanceof Cancelled ? 'cancelled' : 'failed')
    }
    await store.set({ ...rec, phase: 'copied' })
    this.progress({ op: 'move', agent, files: copy.files, bytes: copy.bytes, totalBytes: size.bytes, phase: 'verify' }, true)
    let check: Awaited<ReturnType<typeof verifyCopy>>
    try {
      check = await verifyCopy(source, target, { skipped: copy.skipped, signal })
    } catch (err) {
      return discard(err instanceof Cancelled ? 'cancelled' : 'verify-failed')
    }
    if (!check.ok) return discard('verify-failed', { path: check.mismatch })
    const late = await this.deps.procs(agent)
    if (late.length) return discard('running', { procs: late })
    this.progress({ op: 'move', agent, files: copy.files, bytes: copy.bytes, totalBytes: size.bytes, phase: 'switch' }, true)
    await store.set({ ...rec, phase: 'switching' })
    await this.deps.stopCollector()
    try {
      try {
        await fs.rename(source, backup)
      } catch {
        return await discard('locked')
      }
      try {
        await makeDirLink(target, source, this.deps.platform)
      } catch {
        await fs.rename(backup, source).catch(() => undefined)
        return await discard('failed')
      }
      const names = (await fs.readdir(source).catch(() => [] as string[])).sort()
      const orig = (await fs.readdir(backup).catch(() => [] as string[])).sort()
      if (names.join('\n') !== orig.join('\n')) {
        await removeLink(source).catch(() => undefined)
        await fs.rename(backup, source).catch(() => undefined)
        return await discard('verify-failed')
      }
      await store.set({ ...rec, phase: 'linked' })
    } finally {
      await this.deps.startCollector().catch(() => undefined)
    }
    return { ok: true, files: copy.files, bytes: copy.bytes, skipped: copy.skipped.length, path: target }
  }

  undo(agent: DataAgent): Promise<AgentDataResult> {
    return this.run('undo', (signal) => this.doUndo(agent, signal), fail('busy'))
  }

  private async doUndo(agent: DataAgent, signal: AbortSignal): Promise<AgentDataResult> {
    const { store } = this.deps
    const rec = store.get(agent)
    if (!rec || rec.phase !== 'linked') return fail('not-moved')
    if (!(await linkTarget(rec.source))) return fail('not-moved')
    const procs = await this.deps.procs(agent)
    if (procs.length) return fail('running', { procs })
    const hasOriginal = !rec.originalDeleted && existsSync(rec.backup)
    // Files written at the new place after the move (Claude Code / Codex kept working there).
    const newer: { rel: string; size: number }[] = []
    let total = 0
    try {
      await walkTree(
        rec.target,
        async (e) => {
          if (e.type !== 'file') return
          total += e.size
          if (!hasOriginal) return
          if (e.mtimeMs > rec.at) newer.push({ rel: e.rel, size: e.size })
          else if (!existsSync(path.join(rec.backup, e.rel))) newer.push({ rel: e.rel, size: e.size })
        },
        signal,
      )
    } catch (err) {
      return onCancel(err)
    }
    if (!hasOriginal) {
      const free = await this.deps.freeBytes(path.dirname(rec.source))
      if (free !== null && free < total * 1.02 + 256 * 1024 * 1024) return fail('no-space', { bytes: total })
    }
    const t = this.deps.texts()
    const buttons = hasOriginal && newer.length ? [t.undoCopyBack(newer.length), t.undoOnly, t.cancel] : [t.undoOnly, t.cancel]
    const answer = await this.deps.confirm({ message: t.undoTitle(rec.source), detail: t.undoDetail(rec.target, newer.length, !hasOriginal), buttons })
    if (answer === buttons.length - 1) return fail('cancelled')
    const copyBack = hasOriginal && newer.length > 0 && answer === 0
    await store.set({ ...rec, phase: 'undoing' })
    await this.deps.stopCollector()
    let files = 0
    let skipped = 0
    try {
      await removeLink(rec.source)
      if (hasOriginal) {
        await fs.rename(rec.backup, rec.source)
        if (copyBack) {
          for (const f of newer) {
            const from = path.join(rec.target, f.rel)
            const to = path.join(rec.source, f.rel)
            try {
              await fs.mkdir(path.dirname(to), { recursive: true })
              await fs.copyFile(from, to)
              const st = await fs.stat(from)
              await fs.utimes(to, st.atime, st.mtime).catch(() => undefined)
              files++
            } catch {
              skipped++
            }
          }
        }
      } else {
        let copied = 0
        const copy = await copyTree(rec.target, rec.source, {
          signal,
          platform: this.deps.platform,
          onBytes: (n) => {
            copied += n
            this.progress({ op: 'undo', agent, files: 0, bytes: copied, totalBytes: total, phase: 'copy' })
          },
        })
        const check = await verifyCopy(rec.target, rec.source, { skipped: copy.skipped, signal })
        if (!check.ok) throw new Error('verify')
        files = copy.files
        skipped = copy.skipped.length
      }
      await store.drop(agent)
    } catch {
      // Back to the moved state: the link again, the original under its moved name.
      if (!(await linkTarget(rec.source))) {
        if (hasOriginal && existsSync(rec.source)) await fs.rename(rec.source, rec.backup).catch(() => undefined)
        else if (!hasOriginal) await removeTree(rec.source).catch(() => undefined)
        await makeDirLink(rec.target, rec.source, this.deps.platform).catch(() => undefined)
      }
      await store.set({ ...rec, phase: 'linked' })
      return fail(signal.aborted ? 'cancelled' : 'failed')
    } finally {
      await this.deps.startCollector().catch(() => undefined)
    }
    return { ok: true, files, skipped, path: rec.target }
  }

  deleteOriginal(agent: DataAgent): Promise<AgentDataResult> {
    return this.run('delete', (signal) => this.doDelete(agent, signal), fail('busy'))
  }

  private async doDelete(agent: DataAgent, signal: AbortSignal): Promise<AgentDataResult> {
    const { store } = this.deps
    const rec = store.get(agent)
    if (!rec || rec.phase !== 'linked' || rec.originalDeleted || !existsSync(rec.backup)) return fail('not-moved')
    // Never delete the folder the link points at, nor one that is itself the live place.
    if (isInsideOrSame(rec.backup, rec.target, this.deps.platform) || (await linkTarget(rec.backup))) return fail('invalid')
    let size: { files: number; bytes: number }
    try {
      size = await treeSize(rec.backup, signal)
    } catch (err) {
      return onCancel(err)
    }
    const t = this.deps.texts()
    if ((await this.deps.confirm({ message: t.deleteTitle(rec.backup), detail: t.deleteDetail(fmtBytes(size.bytes)), buttons: [t.deleteConfirm, t.cancel] })) !== 0) return fail('cancelled')
    let done = 0
    const r = await removeTree(rec.backup, { signal, onFile: (n) => this.progress({ op: 'delete', agent, files: 0, bytes: (done += n), totalBytes: size.bytes, phase: 'delete' }) }).catch(
      (err) => (err instanceof Cancelled ? null : Promise.reject(err)),
    )
    if (!r) return fail('cancelled')
    if (!existsSync(rec.backup)) await store.set({ ...rec, originalDeleted: true })
    return r.failed ? fail('failed', { files: r.files, bytes: r.bytes, skipped: r.failed }) : { ok: true, files: r.files, bytes: r.bytes }
  }

  /** Removes the copy an interrupted move left at the target and forgets the record. */
  discard(agent: DataAgent): Promise<AgentDataResult> {
    return this.run(
      'delete',
      async (signal) => {
        const rec = this.deps.store.get(agent)
        if (!rec || rec.phase !== 'interrupted') return fail('not-moved')
        const source = await linkTarget(rec.source)
        const live = source !== null || !existsSync(rec.source)
        if (live || isInsideOrSame(rec.target, rec.source, this.deps.platform)) return fail('invalid')
        const t = this.deps.texts()
        if (existsSync(rec.target)) {
          if ((await this.deps.confirm({ message: t.discardTitle(rec.target), detail: t.discardDetail, buttons: [t.discardConfirm, t.cancel] })) !== 0) return fail('cancelled')
          await removeTree(rec.target, { signal })
        }
        await this.deps.store.drop(agent)
        this.recovered = this.recovered.filter((a) => a !== agent)
        return { ok: true }
      },
      fail('busy'),
    )
  }
}

function onCancel(err: unknown): AgentDataResult {
  if (err instanceof Cancelled) return fail('cancelled')
  throw err
}
