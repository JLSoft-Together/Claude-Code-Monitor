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
      const items: { favorite: Favorite; order: number | null }[] = []
      for (const item of parsed) {
        if (typeof item !== 'object' || item === null) continue
        const { dir, label, addedAt, order } = item as Record<string, unknown>
        if (typeof dir !== 'string' || !path.isAbsolute(dir)) continue
        items.push({
          favorite: {
            dir: path.resolve(dir),
            label: sanitizeAlias(label) ?? path.basename(dir),
            addedAt: typeof addedAt === 'string' ? addedAt : new Date(0).toISOString(),
          },
          order: typeof order === 'number' && Number.isFinite(order) ? order : null,
        })
      }
      items.sort((a, b) =>
        a.order !== null && b.order !== null
          ? a.order - b.order
          : a.order !== null
            ? -1
            : b.order !== null
              ? 1
              : a.favorite.label.localeCompare(b.favorite.label),
      )
      for (const { favorite } of items) this.map.set(keyOf(favorite.dir), favorite)
    } catch {
      return
    }
  }

  list(): Favorite[] {
    return [...this.map.values()]
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

  reorder(dirs: string[]): boolean {
    const before = [...this.map.keys()]
    const next = new Map<string, Favorite>()
    for (const dir of dirs) {
      const key = keyOf(dir)
      const favorite = this.map.get(key)
      if (favorite && !next.has(key)) next.set(key, favorite)
    }
    for (const [key, favorite] of this.map) if (!next.has(key)) next.set(key, favorite)
    const after = [...next.keys()]
    if (after.every((key, i) => key === before[i])) return false
    this.map.clear()
    for (const [key, favorite] of next) this.map.set(key, favorite)
    void this.save()
    return true
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
      await writeFile(tmp, JSON.stringify([...this.map.values()].map((f, order) => ({ ...f, order })), null, 2))
      await rename(tmp, this.file)
    } catch (err) {
      console.error('[collector] cannot save favorites:', (err as Error).message)
    }
  }
}
