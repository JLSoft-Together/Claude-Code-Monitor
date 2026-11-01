import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { isDataAgent, type DataAgent, type MoveRecord } from '@ccm/shared'
import { linkTarget } from './fsTree'

const PHASES: readonly MoveRecord['phase'][] = ['copying', 'copied', 'switching', 'linked', 'undoing', 'interrupted']

function parseRecord(raw: unknown): MoveRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!isDataAgent(r.agent) || typeof r.source !== 'string' || typeof r.target !== 'string' || typeof r.backup !== 'string') return null
  if (typeof r.at !== 'number' || !PHASES.includes(r.phase as MoveRecord['phase'])) return null
  return { agent: r.agent, source: r.source, target: r.target, backup: r.backup, at: r.at, phase: r.phase as MoveRecord['phase'], originalDeleted: r.originalDeleted === true }
}

/** `<DATA_DIR>/agent-data-move.json`: one record per agent, written before every step so a crash can be undone. */
export class MoveStore {
  private moves: Partial<Record<DataAgent, MoveRecord>> = {}

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    try {
      const data = JSON.parse(await fs.readFile(this.file, 'utf8')) as { moves?: unknown }
      const list = Array.isArray(data.moves) ? data.moves : []
      this.moves = {}
      for (const raw of list) {
        const rec = parseRecord(raw)
        if (rec) this.moves[rec.agent] = rec
      }
    } catch {
      this.moves = {}
    }
  }

  get(agent: DataAgent): MoveRecord | null {
    return this.moves[agent] ?? null
  }

  all(): MoveRecord[] {
    return Object.values(this.moves)
  }

  async set(rec: MoveRecord): Promise<void> {
    this.moves[rec.agent] = { ...rec }
    await this.save()
  }

  async drop(agent: DataAgent): Promise<void> {
    delete this.moves[agent]
    await this.save()
  }

  private async save(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    await fs.writeFile(tmp, JSON.stringify({ version: 1, moves: this.all() }, null, 2), 'utf8')
    await fs.rename(tmp, this.file)
  }
}

export type SourceKind = 'dir' | 'link' | 'missing'

export interface RecoveryFacts {
  source: SourceKind
  backupExists: boolean
}

export type RecoveryAction = 'keep' | 'rollback' | 'linked' | 'interrupted' | 'drop'

/**
 * What to do with a record found at start. The original is renamed only in `switching` / `undoing`; a missing source
 * with the original still beside it is always put back, so Claude Code / Codex never start on an empty folder.
 */
export function decideRecovery(rec: MoveRecord, f: RecoveryFacts): RecoveryAction {
  switch (rec.phase) {
    case 'linked':
      return f.source === 'link' ? 'keep' : f.source === 'missing' && f.backupExists ? 'rollback' : 'drop'
    case 'interrupted':
      return 'keep'
    case 'copying':
    case 'copied':
      return f.source === 'missing' && f.backupExists ? 'rollback' : 'interrupted'
    case 'switching':
      if (f.source === 'link') return 'linked'
      if (f.source === 'missing' && f.backupExists) return 'rollback'
      return 'interrupted'
    case 'undoing':
      if (f.source === 'link') return 'linked'
      if (f.source === 'missing' && f.backupExists) return 'rollback'
      return f.source === 'dir' ? 'drop' : 'interrupted'
  }
}

export async function sourceKind(p: string): Promise<SourceKind> {
  if (await linkTarget(p)) return 'link'
  const st = await fs.lstat(p).catch(() => null)
  return st ? 'dir' : 'missing'
}

/** Runs before the collector starts. Returns the agents whose original was put back. */
export async function recoverMoves(store: MoveStore): Promise<DataAgent[]> {
  const rolledBack: DataAgent[] = []
  for (const rec of store.all()) {
    const facts: RecoveryFacts = { source: await sourceKind(rec.source), backupExists: existsSync(rec.backup) }
    const action = decideRecovery(rec, facts)
    if (action === 'keep') continue
    if (action === 'rollback') {
      try {
        await fs.rename(rec.backup, rec.source)
        rolledBack.push(rec.agent)
        await store.set({ ...rec, phase: 'interrupted' })
      } catch {
        // Left as is; the page shows the record and the paths.
      }
    } else if (action === 'linked') await store.set({ ...rec, phase: 'linked' })
    else if (action === 'interrupted') await store.set({ ...rec, phase: 'interrupted' })
    else await store.drop(rec.agent)
  }
  return rolledBack
}

const NETWORK_FS = /^(smbfs|nfs|nfs4|afpfs|webdav|cifs|fuse\.sshfs|9p|ftp)$/i

/** Mount table line (`/dev/x on /Volumes/Y (smbfs, …)` macOS, `x on /y type cifs (…)` Linux) → [mount point, fs type]. */
export function parseMountLine(line: string): [string, string] | null {
  const mac = /^.+? on (.+) \(([^,)]+)/.exec(line)
  const linux = /^.+? on (.+) type (\S+)/.exec(line)
  const m = linux ?? mac
  return m ? [m[1]!, m[2]!] : null
}

function run(file: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => execFile(file, args, { timeout: 15_000, windowsHide: true }, (err, out) => resolve(err ? null : String(out))))
}

/** Local fixed / removable drive only: no UNC path, no mapped network drive (Windows DriveType 4), no network mount. */
export async function isLocalDir(dir: string, platform: NodeJS.Platform = process.platform): Promise<boolean> {
  if (platform === 'win32') {
    if (dir.startsWith('\\\\')) return false
    const drive = /^([A-Za-z]):/.exec(dir)?.[1]?.toUpperCase()
    if (!drive) return false
    const ps = `${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
    const out = await run(ps, ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='${drive}:'").DriveType`])
    const type = Number(out?.trim())
    return type === 2 || type === 3
  }
  const mounts = await run('mount', [])
  if (mounts === null) return true
  const real = await fs.realpath(dir).catch(() => dir)
  let best: [string, string] | null = null
  for (const line of mounts.split(/\r?\n/)) {
    const m = parseMountLine(line)
    if (m && (real === m[0] || real.startsWith(m[0].endsWith('/') ? m[0] : `${m[0]}/`)) && (!best || m[0].length > best[0].length)) best = m
  }
  return !best || !NETWORK_FS.test(best[1])
}

export async function freeBytes(dir: string): Promise<number | null> {
  try {
    const s = await fs.statfs(dir)
    return Number(s.bavail) * Number(s.bsize)
  } catch {
    return null
  }
}
