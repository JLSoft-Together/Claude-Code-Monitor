import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

export interface RegistryRecord {
  pid: number
  sessionId?: string
  cwd?: string
  startedAt?: number
  procStart?: string
  version?: string
  kind?: string
  entrypoint?: string
  name?: string
  nameSource?: string
  status?: string
  waitingFor?: string
  updatedAt?: number
  statusUpdatedAt?: number
}

export type RegistryEntry = RegistryRecord | 'unreadable'

const MAX_RECORD_BYTES = 262_144
const TORN_RETRY_MS = 60

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

export function pidFromFileName(fileName: string): number | null {
  if (!fileName.endsWith('.json')) return null
  const base = fileName.slice(0, -5)
  const pid = Number.parseInt(base, 10)
  if (!Number.isFinite(pid) || String(pid) !== base || pid <= 0) return null
  return pid
}

export function parseRegistryRecord(pid: number, text: string): RegistryRecord | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>
  return {
    pid,
    sessionId: str(o.sessionId),
    cwd: str(o.cwd),
    startedAt: num(o.startedAt),
    procStart: str(o.procStartFt) ?? str(o.procStart),
    version: str(o.version),
    kind: str(o.kind),
    entrypoint: str(o.entrypoint),
    name: str(o.name),
    nameSource: str(o.nameSource),
    status: str(o.status),
    waitingFor: str(o.waitingFor),
    updatedAt: num(o.updatedAt),
    statusUpdatedAt: num(o.statusUpdatedAt),
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function readRecord(file: string, pid: number): Promise<RegistryEntry | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const buf = await readFile(file)
      if (buf.byteLength > MAX_RECORD_BYTES) return 'unreadable'
      const rec = parseRegistryRecord(pid, buf.toString('utf8'))
      if (rec) return rec
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    }
    if (attempt === 0) await sleep(TORN_RETRY_MS)
  }
  return 'unreadable'
}

export async function readRegistry(sessionsDir: string): Promise<Map<number, RegistryEntry>> {
  const result = new Map<number, RegistryEntry>()
  let names: string[]
  try {
    names = await readdir(sessionsDir)
  } catch {
    return result
  }
  await Promise.all(
    names.map(async (name) => {
      const pid = pidFromFileName(name)
      if (pid === null) return
      const entry = await readRecord(path.join(sessionsDir, name), pid)
      if (entry !== null) result.set(pid, entry)
    }),
  )
  return result
}
