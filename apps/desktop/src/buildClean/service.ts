import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  isBuildRel,
  type BuildCleanItem,
  type BuildCleanRequest,
  type BuildCleanResult,
  type BuildDaemon,
  type BuildDir,
  type BuildProgress,
  type BuildProject,
} from '@ccm/shared'
import { Cancelled, isInsideOrSame, removeTree, treeSize } from '../agentData/fsTree'
import { fmtBytes, type ConfirmSpec } from '../agentData/service'
import { findBuildDirs, gitIgnoredOnly, isGitWorkTree, refusedRoot, reinstallOf, type GitRun } from './scan'

export interface BuildCleanTexts {
  cancel: string
  title: (dirs: number, size: string) => string
  detail: (lines: string[], more: number, reinstall: boolean, trash: boolean) => string
  confirm: string
  confirmTrash: string
}

export interface BuildCleanDeps {
  git: GitRun
  confirm: (spec: ConfirmSpec) => Promise<number>
  emit: (p: BuildProgress) => void
  /** What runs inside `root` as the desktop sees it: servers / daemons with that cwd, Run pane sessions. */
  running: (root: string) => string[]
  /** Gradle / Kotlin daemons alive now. */
  daemons: () => BuildDaemon[]
  trash: (p: string) => Promise<void>
  texts: () => BuildCleanTexts
  home?: string
  platform?: NodeJS.Platform
}

const LINES_MAX = 12

export class BuildCleanService {
  private busy = false
  private abort: AbortController | null = null
  private lastEmit = 0
  private readonly scanned = new Map<string, BuildProject>()

  constructor(private readonly deps: BuildCleanDeps) {}

  private key(root: string): string {
    const r = path.resolve(root)
    return (this.deps.platform ?? process.platform) === 'win32' ? r.toLowerCase() : r
  }

  cancel(): boolean {
    if (!this.abort) return false
    this.abort.abort()
    return true
  }

  private progress(p: BuildProgress, force = false): void {
    const now = Date.now()
    if (!force && now - this.lastEmit < 200) return
    this.lastEmit = now
    this.deps.emit(p)
  }

  private async run<T>(fn: (signal: AbortSignal) => Promise<T>, busyValue: T): Promise<T> {
    if (this.busy) return busyValue
    this.busy = true
    this.abort = new AbortController()
    try {
      return await fn(this.abort.signal)
    } finally {
      this.busy = false
      this.abort = null
    }
  }

  scan(roots: readonly string[]): Promise<BuildProject[] | null> {
    return this.run(
      (signal) =>
        this.scanAll(roots, signal).catch((err) => {
          if (err instanceof Cancelled) return null
          throw err
        }),
      null,
    )
  }

  private async scanAll(roots: readonly string[], signal: AbortSignal): Promise<BuildProject[]> {
    const out: BuildProject[] = []
    let dirs = 0
    let bytes = 0
    for (const raw of roots) {
      const root = path.resolve(raw)
      const project: BuildProject = { root, git: false, dirs: [], bytes: 0 }
      out.push(project)
      const st = path.isAbsolute(raw) ? await fs.stat(root).catch(() => null) : null
      if (!st?.isDirectory()) {
        project.error = 'missing'
        continue
      }
      if (refusedRoot(root, this.deps.home, this.deps.platform)) {
        project.error = 'refused'
        continue
      }
      project.git = await isGitWorkTree(root, this.deps.git)
      let cands = await findBuildDirs(root, project.git, signal)
      if (project.git && cands.length) cands = await gitIgnoredOnly(root, cands, this.deps.git)
      for (const c of cands) {
        const size = await treeSize(path.join(root, c.rel), signal, (n) => {
          bytes += n
          this.progress({ op: 'scan', root, dirs, bytes })
        })
        dirs++
        project.dirs.push({ rel: c.rel, name: c.name, kind: c.kind, bytes: size.bytes, files: size.files, newestMs: size.newestMs, reinstall: reinstallOf(c) })
      }
      project.dirs.sort((a, b) => b.bytes - a.bytes)
      project.bytes = project.dirs.reduce((n, d) => n + d.bytes, 0)
      this.scanned.set(this.key(root), project)
    }
    this.progress({ op: 'scan', dirs, bytes }, true)
    return out
  }

  clean(req: BuildCleanRequest): Promise<BuildCleanResult> {
    return this.run(
      (signal) =>
        this.doClean(req, signal).catch((err) => {
          if (err instanceof Cancelled) return { ok: false, error: 'cancelled' } as BuildCleanResult
          throw err
        }),
      { ok: false, error: 'busy' },
    )
  }

  private async doClean(req: BuildCleanRequest, signal: AbortSignal): Promise<BuildCleanResult> {
    const platform = this.deps.platform
    const picked: Array<{ project: BuildProject; dir: BuildDir; abs: string }> = []
    for (const item of req.items) {
      const project = this.scanned.get(this.key(item.root))
      const dir = project?.dirs.find((d) => d.rel === item.rel)
      // Only folders the last scan offered; the page cannot name any other path.
      if (!project || !dir || !isBuildRel(item.rel)) return { ok: false, error: 'invalid' }
      const abs = path.join(project.root, ...item.rel.split('/'))
      if (!isInsideOrSame(project.root, abs, platform) || abs === project.root) return { ok: false, error: 'invalid' }
      if (!picked.some((p) => p.abs === abs)) picked.push({ project, dir, abs })
    }
    const live: Array<{ project: BuildProject; dir: BuildDir; abs: string }> = []
    for (const p of picked) {
      const st = await fs.lstat(p.abs).catch(() => null)
      if (st?.isDirectory() && !st.isSymbolicLink()) live.push(p)
    }
    if (!live.length) return { ok: false, error: 'nothing' }
    const holders = new Set<string>()
    for (const project of new Set(live.map((p) => p.project))) {
      for (const h of this.deps.running(project.root)) holders.add(h)
      for (const b of req.busy) if (isInsideOrSame(project.root, b.cwd, platform)) holders.add(b.name)
    }
    if (holders.size) return { ok: false, error: 'running', holders: [...holders].slice(0, 20) }
    if (!req.ignoreDaemons && live.some((p) => p.dir.kind === 'gradle')) {
      const daemons = this.deps.daemons()
      if (daemons.length) return { ok: false, error: 'daemons', daemons }
    }
    const total = live.reduce((n, p) => n + p.dir.bytes, 0)
    const several = new Set(live.map((p) => p.project)).size > 1
    const lines = live.slice(0, LINES_MAX).map((p) => `• ${several ? `${path.basename(p.project.root)}/` : ''}${p.dir.rel} — ${fmtBytes(p.dir.bytes)}`)
    const t = this.deps.texts()
    const answer = await this.deps.confirm({
      message: t.title(live.length, fmtBytes(total)),
      detail: t.detail(lines, live.length - lines.length, live.some((p) => p.dir.reinstall), req.trash),
      buttons: [req.trash ? t.confirmTrash : t.confirm, t.cancel],
    })
    if (answer !== 0) return { ok: false, error: 'cancelled' }
    let dirs = 0
    let bytes = 0
    let failed = 0
    let done = 0
    const removed: BuildCleanItem[] = []
    for (const p of live) {
      if (signal.aborted) break
      if (req.trash) {
        try {
          await this.deps.trash(p.abs)
          bytes += p.dir.bytes
          done += p.dir.bytes
        } catch {
          failed++
        }
      } else {
        const r = await removeTree(p.abs, { signal, onFile: (n) => this.progress({ op: 'clean', root: p.project.root, dirs, bytes: (done += n), totalBytes: total }) })
        bytes += r.bytes
        failed += r.failed
      }
      if (!existsSync(p.abs)) {
        dirs++
        removed.push({ root: p.project.root, rel: p.dir.rel })
        p.project.dirs = p.project.dirs.filter((d) => d !== p.dir)
        p.project.bytes = p.project.dirs.reduce((n, d) => n + d.bytes, 0)
      }
      this.progress({ op: 'clean', root: p.project.root, dirs, bytes: done, totalBytes: total }, true)
    }
    return { ok: dirs > 0 || failed === 0, ...(dirs === 0 && failed ? { error: 'failed' as const } : {}), dirs, bytes, failed, removed }
  }
}
