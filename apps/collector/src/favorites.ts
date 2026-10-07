import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Favorite } from '@ccm/shared'
import { sanitizeAlias } from './aliases'

export const MAX_FAVORITES = 50

const keyOf = (dir: string): string => path.resolve(dir).toLowerCase()

/** Starred working directories; the launcher only opens dirs listed here. */
export class FavoriteStore {
  private readonly map = new Map<string, Favorite>()
  private saving: Promise<void> = Promise.resolve()

  constructor(private readonly file: string | null = null) {}

  async load(): Promise<void> {
    if (!this.file) return
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      if (!Array.isArray(parsed)) return
      for (const item of parsed) {
        if (typeof item !== 'object' || item === null) continue
        const { dir, label, addedAt } = item as Record<string, unknown>
        if (typeof dir !== 'string' || !path.isAbsolute(dir)) continue
        this.map.set(keyOf(dir), {
          dir: path.resolve(dir),
          label: sanitizeAlias(label) ?? path.basename(dir),
          addedAt: typeof addedAt === 'string' ? addedAt : new Date(0).toISOString(),
        })
      }
    } catch {
      return
    }
  }

  list(): Favorite[] {
    return [...this.map.values()].sort((a, b) => a.label.localeCompare(b.label))
  }

  get(dir: string): Favorite | undefined {
    return this.map.get(keyOf(dir))
  }

  toggle(dir: string, label: string): boolean {
    const key = keyOf(dir)
    if (this.map.delete(key)) {
      void this.save()
      return false
    }
    if (this.map.size >= MAX_FAVORITES) return false
    this.map.set(key, { dir: path.resolve(dir), label: sanitizeAlias(label) ?? path.basename(dir), addedAt: new Date().toISOString() })
    void this.save()
    return true
  }

  add(dir: string, label: unknown): 'ok' | 'exists' | 'limit' {
    const key = keyOf(dir)
    if (this.map.has(key)) return 'exists'
    if (this.map.size >= MAX_FAVORITES) return 'limit'
    this.map.set(key, { dir: path.resolve(dir), label: sanitizeAlias(label) ?? path.basename(path.resolve(dir)), addedAt: new Date().toISOString() })
    void this.save()
    return 'ok'
  }

  rename(dir: string, label: unknown): boolean {
    const current = this.map.get(keyOf(dir))
    if (!current) return false
    const next = sanitizeAlias(label) ?? path.basename(current.dir)
    if (next === current.label) return false
    this.map.set(keyOf(dir), { ...current, label: next })
    void this.save()
    return true
  }

  remove(dir: string): boolean {
    const removed = this.map.delete(keyOf(dir))
    if (removed) void this.save()
    return removed
  }

  whenSaved(): Promise<void> {
    return this.saving
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
      await writeFile(tmp, JSON.stringify([...this.map.values()], null, 2))
      await rename(tmp, this.file)
    } catch (err) {
      console.error('[collector] cannot save favorites:', (err as Error).message)
    }
  }
}
