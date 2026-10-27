import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CLASSIC_PACK, OFFICE_PACK_KEY, PACK_INDEX_URL, fetchPackIndex, loadOfficePack, parsePackIndex, readOfficePack, resolvePack } from './packs'
import index from '../../public/assets/themes/index.json'

const ROOM = { carpet: '#c9d1dc', carpet2: '#bdc6d3', wall: { base: '#eef1f4', trim: '#9fb0c4', pattern: 'plain' }, accent: '#3f7fd8', deskVariant: 'white', chairVariant: 'blue' }

function serve(routes: Record<string, unknown>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      url in routes
        ? new Response(JSON.stringify(routes[url]), { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    ),
  )
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('office theme packs', () => {
  it('reads the saved pack id, classic when missing or malformed', () => {
    expect(readOfficePack()).toBe(CLASSIC_PACK)
    localStorage.setItem(OFFICE_PACK_KEY, 'night-shift')
    expect(readOfficePack()).toBe('night-shift')
    for (const bad of ['../x', 'Night', 'ab', 'x'.repeat(25), '']) {
      localStorage.setItem(OFFICE_PACK_KEY, bad)
      expect(readOfficePack()).toBe(CLASSIC_PACK)
    }
  })

  it('keeps only well-formed index entries', () => {
    const list = parsePackIndex([
      { id: 'japandi', name: { en: 'Japandi', vi: 'Japandi' }, preview: 'themes/japandi/preview.png' },
      { id: 'japandi', name: { en: 'Twice', vi: 'Twice' }, preview: null },
      { id: 'classic', name: { en: 'Classic', vi: 'Cổ điển' } },
      { id: 'Bad Id', name: { en: 'x', vi: 'x' } },
      { id: 'no-vi', name: { en: 'Only English' } },
      { id: 'odd-preview', name: { en: 'Odd', vi: 'Lạ' }, preview: '../../secret.png' },
      null,
    ])
    expect(list).toEqual([
      { id: 'japandi', name: { en: 'Japandi', vi: 'Japandi' }, preview: '/assets/themes/japandi/preview.png' },
      { id: 'odd-preview', name: { en: 'Odd', vi: 'Lạ' }, preview: null },
    ])
    expect(parsePackIndex({ packs: [] })).toEqual([])
  })

  it('ships an index listing the four v62 packs', () => {
    const list = parsePackIndex(index)
    expect(list.map((p) => p.id)).toEqual(['japandi', 'night-shift', 'forest-cabin', 'retro-80s'])
    expect(list.every((p) => p.preview === `/assets/themes/${p.id}/preview.png`)).toBe(true)
  })

  it('resolves an unknown pack to classic', () => {
    const list = parsePackIndex([{ id: 'japandi', name: { en: 'Japandi', vi: 'Japandi' } }])
    expect(resolvePack('japandi', list)).toBe('japandi')
    expect(resolvePack('seaside', list)).toBe(CLASSIC_PACK)
    expect(resolvePack(CLASSIC_PACK, list)).toBe(CLASSIC_PACK)
  })

  it('fetches the index, empty when it is missing', async () => {
    serve({ [PACK_INDEX_URL]: index })
    expect((await fetchPackIndex()).length).toBe(4)
    serve({})
    expect(await fetchPackIndex()).toEqual([])
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))))
    expect(await fetchPackIndex()).toEqual([])
  })

  it('loads a pack theme, classic rooms when theme.json is missing or invalid', async () => {
    serve({ '/assets/themes/japandi/theme.json': { id: 'japandi', rooms: [ROOM] }, '/assets/themes/broken/theme.json': { rooms: [{ ...ROOM, accent: 'blue' }] } })
    expect(await loadOfficePack('japandi')).toEqual({ id: 'japandi', assetPack: 'themes/japandi', rooms: [ROOM] })
    expect((await loadOfficePack('broken')).rooms).toBeNull()
    expect((await loadOfficePack('gone')).rooms).toBeNull()
    expect(await loadOfficePack(CLASSIC_PACK)).toEqual({ id: CLASSIC_PACK, assetPack: undefined, rooms: null })
    expect(await loadOfficePack('../x')).toEqual({ id: CLASSIC_PACK, assetPack: undefined, rooms: null })
  })
})
