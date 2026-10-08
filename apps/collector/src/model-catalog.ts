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

const MIN_WINDOW = 1_000
const MAX_WINDOW = 100_000_000

function windowsOf(models: unknown, out: Record<string, number>): void {
  const list = Array.isArray(models) ? models : typeof models === 'object' && models !== null ? Object.values(models) : []
  for (const m of list) {
    if (typeof m !== 'object' || m === null) continue
    const { id, runtime } = m as { id?: unknown; runtime?: { max_input_tokens?: unknown } }
    const max = runtime?.max_input_tokens
    if (typeof id !== 'string' || !ID_RE.test(id) || out[id] !== undefined) continue
    if (typeof max === 'number' && Number.isFinite(max) && max >= MIN_WINDOW && max <= MAX_WINDOW) out[id] = Math.round(max)
  }
}

export function parseModelWindows(text: string): Record<string, number> {
  const out: Record<string, number> = {}
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return out
  }
  const wrapper = raw as { documentBytes?: unknown; document?: unknown; catalog?: { config?: { models?: unknown } } } | null
  let doc: unknown = wrapper
  if (typeof wrapper?.documentBytes === 'string') {
    try {
      doc = JSON.parse(Buffer.from(wrapper.documentBytes, 'base64').toString('utf8'))
    } catch {
      doc = null
    }
  }
  const surfaces = (doc as { surfaces?: Record<string, { model_selector_config?: unknown }> } | null)?.surfaces
  const configs = surfaces?.cc?.model_selector_config
  if (Array.isArray(configs)) for (const c of configs) windowsOf((c as { models?: unknown } | null)?.models, out)
  windowsOf(wrapper?.catalog?.config?.models, out)
  return out
}

export interface ModelCatalog {
  names: Record<string, string>
  windows: Record<string, number>
}

export async function readModelCatalog(claudeRoot: string): Promise<ModelCatalog> {
  const dir = path.join(claudeRoot, 'cache', 'model-catalog')
  const out: ModelCatalog = { names: {}, windows: {} }
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
      if (text.length > MAX_BYTES) continue
      Object.assign(out.names, parseModelCatalog(text))
      for (const [id, w] of Object.entries(parseModelWindows(text))) out.windows[id] ??= w
    } catch {
      continue
    }
  }
  return out
}
