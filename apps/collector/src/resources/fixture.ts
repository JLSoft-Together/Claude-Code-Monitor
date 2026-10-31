import { readFile } from 'node:fs/promises'
import type { ResPort } from '@ccm/shared'
import type { PortTable } from './ports'
import type { ProcReader, ProcRow } from './procs'

/**
 * E2E / demo process + port table from `CCM_RES_FIXTURE` (a JSON file, re-read every pass so a test can change it):
 * `{ "procs": [{ "pid", "ppid", "name", "start", "ram", "cpuMs", "cmd" }], "ports": { "<pid>": [{ "port", "address", "established" }] } }`.
 * The desktop app refuses to kill anything while this is set.
 */
interface Fixture {
  procs: ProcRow[]
  ports: Map<number, ResPort[]>
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)

export function parseFixture(text: string): Fixture {
  const raw = JSON.parse(text) as { procs?: unknown; ports?: unknown }
  const procs: ProcRow[] = []
  for (const p of Array.isArray(raw.procs) ? raw.procs : []) {
    if (typeof p !== 'object' || p === null) continue
    const r = p as Record<string, unknown>
    const pid = num(r.pid)
    const ppid = num(r.ppid)
    if (pid === null || ppid === null) continue
    const start = typeof r.start === 'string' ? r.start : null
    procs.push({
      pid,
      ppid,
      name: typeof r.name === 'string' ? r.name : '',
      start,
      startMs: start && /^\d+$/.test(start) ? Number(start) : null,
      ramBytes: num(r.ram),
      cpuMs: num(r.cpuMs),
      cmd: typeof r.cmd === 'string' ? r.cmd : null,
    })
  }
  const ports = new Map<number, ResPort[]>()
  if (typeof raw.ports === 'object' && raw.ports !== null) {
    for (const [pid, list] of Object.entries(raw.ports)) {
      if (!/^\d+$/.test(pid) || !Array.isArray(list)) continue
      const items = list.filter(
        (x): x is ResPort => typeof x === 'object' && x !== null && Number.isInteger(x.port) && typeof x.address === 'string' && Number.isInteger(x.established),
      )
      ports.set(Number(pid), items)
    }
  }
  return { procs, ports }
}

async function load(file: string): Promise<Fixture | null> {
  try {
    return parseFixture(await readFile(file, 'utf8'))
  } catch {
    return null
  }
}

export function fixtureProcReader(file: string): ProcReader {
  return {
    read: async () => (await load(file))?.procs.map((r) => ({ ...r })) ?? null,
    enrich: () => undefined,
  }
}

export function fixturePortTable(file: string): PortTable {
  return async () => (await load(file))?.ports ?? null
}
