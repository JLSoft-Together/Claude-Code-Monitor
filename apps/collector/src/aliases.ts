import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const MAX_ALIAS_LENGTH = 80

export function sanitizeAlias(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  return clean ? clean.slice(0, MAX_ALIAS_LENGTH) : null
}

/** Dashboard-side names keyed by terminal id; persisted so a collector restart keeps them. */
export class AliasStore {
  private readonly map = new Map<string, string>()
  private saving: Promise<void> = Promise.resolve()

  constructor(private readonly file: string | null = null) {}

  async load(): Promise<void> {
    if (!this.file) return
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      if (typeof parsed !== 'object' || parsed === null) return
      for (const [id, value] of Object.entries(parsed)) {
        const alias = sanitizeAlias(value)
        if (alias) this.map.set(id, alias)
      }
    } catch {
      return
    }
  }

  get(terminalId: string): string | undefined {
    return this.map.get(terminalId)
  }

  set(terminalId: string, alias: string | null): boolean {
    const prev = this.map.get(terminalId)
    if (alias) this.map.set(terminalId, alias)
    else this.map.delete(terminalId)
    if (prev === (alias ?? undefined)) return false
    void this.save()
    return true
  }

  delete(terminalId: string): void {
    if (this.map.delete(terminalId)) void this.save()
  }

  private save(): Promise<void> {
    this.saving = this.saving.then(() => this.write())
    return this.saving
  }

  private async write(): Promise<void> {
    if (!this.file) return
    const tmp = `${this.file}.tmp`
    try {
      await mkdir(path.dirname(this.file), { recursive: true })
      await writeFile(tmp, JSON.stringify(Object.fromEntries(this.map), null, 2))
      await rename(tmp, this.file)
    } catch (err) {
      console.error('[collector] cannot save aliases:', (err as Error).message)
    }
  }
}
