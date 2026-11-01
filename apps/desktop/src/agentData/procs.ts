import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { AgentProc, DataAgent } from '@ccm/shared'
import { nativeProcessTable } from '../../../collector/src/win-procs'

/** Process names that hold an agent's folder: the CLI and the desktop apps of the same vendor (Claude.exe uses ~/.claude too). */
export function procAgent(name: string): DataAgent | null {
  const base = path.basename(name.replace(/\\/g, '/')).toLowerCase().replace(/\.exe$/, '')
  if (base === 'claude') return 'claude'
  if (base === 'codex') return 'codex'
  return null
}

function run(file: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => execFile(file, args, { timeout: 15_000, windowsHide: true, maxBuffer: 16_000_000 }, (err, out) => resolve(err ? null : String(out))))
}

/** `tasklist /FO CSV /NH` → rows. */
export function parseTasklist(text: string): AgentProc[] {
  const out: AgentProc[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^"([^"]+)","(\d+)"/.exec(line.trim())
    if (m) out.push({ name: m[1]!, pid: Number(m[2]) })
  }
  return out
}

/** Every running process of `agent`. `CCM_E2E_AGENT_PROCS` (E2E) = JSON file with `[{pid, name}]` instead of the live table. */
export async function agentProcs(agent: DataAgent, platform: NodeJS.Platform = process.platform): Promise<AgentProc[]> {
  let rows: AgentProc[] | null = null
  const fixture = process.env.CCM_E2E_AGENT_PROCS
  if (fixture) rows = JSON.parse(await readFile(fixture, 'utf8').catch(() => '[]')) as AgentProc[]
  else if (platform === 'win32') {
    rows = nativeProcessTable()?.map((p) => ({ pid: p.pid, name: p.name })) ?? null
    if (!rows) {
      const text = await run(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tasklist.exe'), ['/FO', 'CSV', '/NH'])
      rows = text ? parseTasklist(text) : []
    }
  } else {
    const text = await run('ps', ['-A', '-o', 'pid=,comm='])
    rows = []
    for (const line of text?.split(/\r?\n/) ?? []) {
      const m = /^\s*(\d+)\s+(.+)$/.exec(line)
      if (m) rows.push({ pid: Number(m[1]), name: path.basename(m[2]!.trim()) })
    }
  }
  return rows.filter((p) => p.pid !== process.pid && procAgent(p.name) === agent)
}
