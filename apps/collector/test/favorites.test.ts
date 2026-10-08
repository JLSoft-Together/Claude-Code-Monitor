import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { FavoriteStore } from '../src/favorites'

describe('FavoriteStore order', () => {
  it('sorts legacy files by label, then keeps and persists manual order', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ccm-fav-'))
    const file = path.join(root, 'favorites.json')
    const a = path.join(root, 'a')
    const b = path.join(root, 'b')
    const c = path.join(root, 'c')
    await writeFile(
      file,
      JSON.stringify([
        { dir: c, label: 'Charlie', addedAt: '2026-01-01T00:00:00.000Z' },
        { dir: a, label: 'Alpha', addedAt: '2026-01-02T00:00:00.000Z' },
        { dir: b, label: 'Bravo', addedAt: '2026-01-03T00:00:00.000Z' },
      ]),
    )
    const store = new FavoriteStore(file)
    await store.load()
    expect(store.list().map((f) => f.label)).toEqual(['Alpha', 'Bravo', 'Charlie'])

    expect(store.reorder([c.toUpperCase(), a, 'Z:/missing', c])).toBe(true)
    expect(store.list().map((f) => f.label)).toEqual(['Charlie', 'Alpha', 'Bravo'])
    expect(store.reorder([c, a])).toBe(false)
    expect(store.rename(a, 'Zulu')).toBe(true)
    expect(store.list().map((f) => f.label)).toEqual(['Charlie', 'Zulu', 'Bravo'])
    expect(store.add(path.join(root, 'd'), 'Delta')).toBe('ok')
    await store.whenSaved()

    const saved = JSON.parse(await readFile(file, 'utf8')) as { label: string; order: number }[]
    expect(saved.map((f) => [f.label, f.order])).toEqual([['Charlie', 0], ['Zulu', 1], ['Bravo', 2], ['Delta', 3]])

    const again = new FavoriteStore(file)
    await again.load()
    expect(again.list().map((f) => f.label)).toEqual(['Charlie', 'Zulu', 'Bravo', 'Delta'])
  })
})
