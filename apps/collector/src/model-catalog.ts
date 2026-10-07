import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const ID_RE = /^[a-z0-9][a-z0-9.\-[\]]{2,80}$/i
const MAX_BYTES = 512 * 1024

/** Model id → display name from `<claudeRoot>/cache/model-catalog/*.json` (`catalog.config.models[].{id,name}` only). */
export function parseModelCatalog(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return out
  }
  const models = (raw as { catalog?: { config?: { models?: unknown } } } | null)?.catalog?.config?.models
  const list = Array.isArray(models) ? models : typeof models === 'object' && models !== null ? Object.values(models) : []
  for (const m of list) {
    if (typeof m !== 'object' || m === null) continue
    const { id, name } = m as { id?: unknown; name?: unknown }
    if (typeof id === 'string' && ID_RE.test(id) && typeof name === 'string' && name.length > 0 && name.length <= 40) out[id] = name
  }
  return out
}

export async function readModelNames(claudeRoot: string): Promise<Record<string, string>> {
  const dir = path.join(claudeRoot, 'cache', 'model-catalog')
  const out: Record<string, string> = {}
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return out
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      const text = await readFile(path.join(dir, name), 'utf8')
      if (text.length <= MAX_BYTES) Object.assign(out, parseModelCatalog(text))
    } catch {
      continue
    }
  }
  return out
}
