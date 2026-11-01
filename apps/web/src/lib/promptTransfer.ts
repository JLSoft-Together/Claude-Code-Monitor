import { cleanPrompts, MAX_PROMPTS, type SavedPrompt } from './promptLibrary'

export const PROMPTS_FORMAT = 'orrery-prompts'
export type ClashChoice = 'overwrite' | 'both' | 'skip'

export interface ImportPlan {
  fresh: SavedPrompt[]
  clashes: { incoming: SavedPrompt; existing: SavedPrompt }[]
  /** Same name, scope and text as one already saved, or repeated inside the file. */
  same: number
}

export interface ImportOutcome {
  list: SavedPrompt[]
  added: number
  replaced: number
  skipped: number
  /** Did not fit under MAX_PROMPTS. */
  dropped: number
}

const MAX_NAME = 80
const keyOf = (p: Pick<SavedPrompt, 'name' | 'scope'>): string => `${p.scope}\u0000${p.name.trim().toLowerCase()}`

export function exportText(list: readonly SavedPrompt[], at = new Date()): string {
  return JSON.stringify({ format: PROMPTS_FORMAT, version: 1, exportedAt: at.toISOString(), prompts: list.map(({ name, text, scope }) => ({ name, text, scope })) }, null, 1)
}

/** null when the file is not a prompt list at all; otherwise only the entries `cleanPrompts` accepts. */
export function parseImport(raw: unknown): SavedPrompt[] | null {
  const items = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { prompts?: unknown }).prompts) ? (raw as { prompts: unknown[] }).prompts : null
  if (!items) return null
  // Ids in a file mean nothing here; scope defaults to every project.
  return cleanPrompts(
    items.slice(0, MAX_PROMPTS * 2).map((r, i) => {
      const p = (r && typeof r === 'object' ? r : {}) as Record<string, unknown>
      return { id: `i${i}`, name: p.name, text: p.text, scope: typeof p.scope === 'string' && p.scope ? p.scope : 'global' }
    }),
  )
}

export function planImport(existing: readonly SavedPrompt[], incoming: readonly SavedPrompt[]): ImportPlan {
  const byKey = new Map(existing.map((p) => [keyOf(p), p]))
  const seen = new Set<string>()
  const plan: ImportPlan = { fresh: [], clashes: [], same: 0 }
  for (const p of incoming) {
    const key = keyOf(p)
    const have = byKey.get(key)
    if (seen.has(key) || have?.text === p.text) plan.same++
    else if (have) plan.clashes.push({ incoming: p, existing: have })
    else plan.fresh.push(p)
    seen.add(key)
  }
  return plan
}

function uniqueName(name: string, scope: string, taken: Set<string>): string {
  for (let n = 2; ; n++) {
    const suffix = ` (${n})`
    const candidate = `${name.slice(0, MAX_NAME - suffix.length)}${suffix}`
    if (!taken.has(keyOf({ name: candidate, scope }))) return candidate
  }
}

export function applyImport(existing: readonly SavedPrompt[], plan: ImportPlan, choice: ClashChoice, newId: () => string): ImportOutcome {
  const list = [...existing]
  const out: ImportOutcome = { list, added: 0, replaced: 0, skipped: plan.same, dropped: 0 }
  const taken = new Set(list.map(keyOf))
  const add = (p: SavedPrompt): void => {
    if (list.length >= MAX_PROMPTS) {
      out.dropped++
      return
    }
    list.push({ ...p, id: newId() })
    taken.add(keyOf(p))
    out.added++
  }
  for (const { incoming, existing: have } of plan.clashes) {
    if (choice === 'skip') out.skipped++
    else if (choice === 'overwrite') {
      const at = list.findIndex((p) => p.id === have.id)
      list[at] = { ...have, text: incoming.text }
      out.replaced++
    } else add({ ...incoming, name: uniqueName(incoming.name, incoming.scope, taken) })
  }
  for (const p of plan.fresh) add(p)
  return out
}
