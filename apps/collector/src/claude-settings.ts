import { readFile } from 'node:fs/promises'
import path from 'node:path'

/** Reads only the `model` field of the user's Claude settings (used to infer a 1M context window). */
export async function readSettingsModel(claudeRoot: string): Promise<string | undefined> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path.join(claudeRoot, 'settings.json'), 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const model = (parsed as Record<string, unknown>).model
    return typeof model === 'string' && model.length <= 100 ? model : undefined
  } catch {
    return undefined
  }
}
