import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { BackupApplyResult, BackupPreview, BackupSectionId } from '@ccm/shared'
import { BACKUP_FILES, buildBackup, MAX_BACKUP_BYTES, NOTE_FILE, parseBackup, pickSections, pruneList, sectionsOf, type BackupFile, type BackupGitHub } from './format'

export const BACKUPS_DIR = 'backups'
const PENDING_FILE = 'pending-import.json'
const KEEP_AUTO = 3
const PREVIEW_TTL_MS = 10 * 60_000

export interface BackupServiceDeps {
  dataDir: string
  app: string
  platform: string
  github: () => BackupGitHub[]
  now?: () => Date
  exists?: (p: string) => boolean
}

function writeAtomic(file: string, text: string): void {
  mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, text)
  renameSync(tmp, file)
}

export class BackupService {
  private staged: { token: string; backup: BackupFile; until: number } | null = null
  private readonly dir: string

  constructor(private readonly deps: BackupServiceDeps) {
    this.dir = path.join(deps.dataDir, BACKUPS_DIR)
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  readFiles(): Record<string, string> {
    const out: Record<string, string> = {}
    const read = (rel: string): void => {
      try {
        const file = path.join(this.deps.dataDir, rel)
        if (statSync(file).size <= 4 * 1024 * 1024) out[rel] = readFileSync(file, 'utf8')
      } catch {
        // missing
      }
    }
    for (const rel of BACKUP_FILES) read(rel)
    let notes: string[] = []
    try {
      notes = readdirSync(path.join(this.deps.dataDir, 'notes'))
    } catch {
      // no notes yet
    }
    for (const n of notes) if (NOTE_FILE.test(`notes/${n}`)) read(`notes/${n}`)
    return out
  }

  snapshot(local: unknown): BackupFile {
    return buildBackup({ app: this.deps.app, platform: this.deps.platform, now: this.now(), local, files: this.readFiles(), github: this.deps.github() })
  }

  /** `<dataDir>/backups/<kind>-<tag>.json`, keeping the newest 3 of that kind; null when it could not be written. */
  writeAuto(kind: 'pre-update' | 'pre-import', tag: string, local: unknown): string | null {
    const safeTag = tag.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60)
    const file = path.join(this.dir, `${kind}-${safeTag}.json`)
    try {
      writeAtomic(file, JSON.stringify(this.snapshot(local), null, 1))
      const entries = readdirSync(this.dir).map((name) => ({ name, mtime: statSync(path.join(this.dir, name)).mtimeMs }))
      for (const name of pruneList(entries, `${kind}-`, KEEP_AUTO)) rmSync(path.join(this.dir, name), { force: true })
      return file
    } catch {
      return null
    }
  }

  preview(text: string, fileName: string): BackupPreview {
    if (text.length > MAX_BACKUP_BYTES) return { ok: false, error: 'too-large' }
    const backup = parseBackup(text)
    if (!backup) return { ok: false, error: 'invalid' }
    const token = randomUUID()
    this.staged = { token, backup, until: Date.now() + PREVIEW_TTL_MS }
    const exists = this.deps.exists ?? existsSync
    return {
      ok: true,
      token,
      file: path.basename(fileName),
      app: backup.app,
      platform: backup.platform,
      createdAt: backup.createdAt,
      sections: sectionsOf(backup, exists),
      github: backup.github.map((g) => g.login),
    }
  }

  stagedSections(token: string): BackupFile | null {
    const s = this.staged
    return s && s.token === token && s.until > Date.now() ? s.backup : null
  }

  /** Data files wait in `pending-import.json` until the next start, before the collector and the stores read them. */
  stage(token: string, ids: ReadonlySet<BackupSectionId>, currentLocal: unknown): BackupApplyResult {
    const backup = this.stagedSections(token)
    if (!backup) return { ok: false, error: 'expired' }
    const picked = pickSections(backup, ids)
    if (!this.writeAuto('pre-import', this.now().toISOString().replace(/[:.]/g, '-'), currentLocal)) return { ok: false, error: 'write' }
    try {
      if (Object.keys(picked.files).length) writeAtomic(path.join(this.dir, PENDING_FILE), JSON.stringify({ files: picked.files }))
    } catch {
      return { ok: false, error: 'write' }
    }
    this.staged = null
    return { ok: true, local: picked.local, github: picked.github }
  }

  /** Returns how many files were written. */
  applyPending(): number {
    const pending = path.join(this.dir, PENDING_FILE)
    let files: Record<string, string>
    try {
      const raw = JSON.parse(readFileSync(pending, 'utf8')) as { files?: unknown }
      files = parseBackup(JSON.stringify({ format: 'orrery-backup', version: 1, files: raw.files }))?.files ?? {}
    } catch {
      return 0
    }
    let n = 0
    for (const [rel, text] of Object.entries(files)) {
      try {
        writeAtomic(path.join(this.deps.dataDir, ...rel.split('/')), text)
        n++
      } catch {
        // one unwritable file must not block the others
      }
    }
    rmSync(pending, { force: true })
    return n
  }
}
