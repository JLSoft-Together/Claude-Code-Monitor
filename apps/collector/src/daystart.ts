import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

export function localDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** When the collector was first started today (local time); a restart later in the day keeps the morning time. */
export async function firstStartToday(file: string, nowMs = Date.now()): Promise<string> {
  const today = localDate(nowMs)
  try {
    const raw = JSON.parse(await readFile(file, 'utf8')) as { date?: unknown; at?: unknown }
    if (raw.date === today && typeof raw.at === 'string' && Number.isFinite(Date.parse(raw.at))) return raw.at
  } catch {
    // Missing or unreadable: today starts now.
  }
  const at = new Date(nowMs).toISOString()
  try {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify({ date: today, at }))
  } catch {
    return at
  }
  return at
}
