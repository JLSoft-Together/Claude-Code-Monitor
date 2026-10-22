import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  furnitureArt,
  iconArt,
  isoArt,
  loadIsoArt,
  parseCharManifest,
  parseFurnitureManifest,
  parseIconManifest,
  parseSeasonalManifest,
  parseRoot,
  parseSurfacesManifest,
  parseWallArtManifest,
  pickIsoWallArt,
  resetIsoArt,
  seasonalArt,
  validFile,
  wallItemArt,
  type IsoImage,
} from './isoArt'
import { archetypesOf, DEFAULT_ARCHETYPES } from './archetypes'

const CHARS = {
  version: 1,
  scale: 2,
  frame: { w: 192, h: 320 },
  cols: 8,
  anchors: { feet: [96, 312], head: [96, 63], chest: [96, 133], hand: [131, 183], seat: [96, 240] },
  archetypes: [
    { id: 'jin', look: 'm', name: 'Jin', sheet: 'jin.webp', anims: { stand_down: { row: 0, frames: 1, ms: 0, anchor: 'feet' }, walk_right: { row: 1, frames: 4, ms: 160, anchor: 'feet' } } },
    { id: 'mai', look: 'f', name: 'Mai', sheet: 'mai.webp', anims: { stand_down: { row: 0, frames: 1, ms: 0 }, sit_down: { row: 1, frames: 1, ms: 0, anchor: 'seat' } } },
  ],
}

const FURN = {
  version: 1,
  scale: 2,
  items: {
    desk: { file: 'desk.webp', footprint: [2, 1], anchor: [10, 90], height: 1.1, front: 'desk.front.webp', rects: { screen: [40, 10, 30, 20] } },
    'desk:white': { file: 'desk-white.webp', footprint: [2, 1], anchor: [10, 90] },
    'plant_tall:palm': { file: 'palm.webp', anchor: [8, 120], height: 2 },
    'wall:clock': { file: 'clock.webp', anchor: [32, 80], rects: { face: [8, 8, 48, 48] } },
    'wall:window': { file: 'window.webp', anchor: [64, 90], rects: { glass: [6, 6, 116, 60] } },
    'BAD KEY': { file: 'x.webp', anchor: [0, 0] },
    lamp: { file: '../escape.webp', anchor: [0, 0] },
    stool: { file: 'stool.webp' },
  },
}

const SURF = {
  version: 1,
  scale: 2,
  floors: { wood: { file: 'floor-wood.webp', tile: [64, 64] }, carpet: { file: 'floor-carpet.webp', tile: [64, 64], tint: true, tiles: 2 }, lava: { file: 'lava.webp' } },
  walls: { plain: { file: 'wall-plain.webp', tile: [64, 96], tint: true, cap: '#e9e2d6' }, brick: { file: 'wall-brick.webp', cap: 'red' } },
  rugs: { a: { file: 'rug-a.webp', tint: true }, b: { file: 'rug-b.webp' } },
}

const WALLART = {
  wallArt: [
    { id: 'p1', kind: 'painting', file: 'p1.webp', tiles: 2 },
    { id: 'w1', kind: 'painting', file: 'w1.webp', tiles: 4, framed: { file: 'w1-framed.webp' } },
    { id: 'c1', kind: 'poster', file: 'c1.webp', variant: 'coffee' },
    { id: 'c2', kind: 'poster', file: 'c2.webp', variant: 'cat' },
    { id: 'x', kind: 'mural', file: 'x.webp' },
  ],
}

const ROOT = { version: 1, scale: 2, chars: 'chars/manifest.json', furniture: 'furniture/manifest.json', surfaces: 'surfaces/manifest.json', wallArt: 'wallart/manifest.json' }

function loaders(files: Record<string, unknown>, broken: ReadonlySet<string> = new Set()) {
  const json = vi.fn(async (url: string) => files[url] ?? null)
  const image = vi.fn(async (url: string): Promise<IsoImage | null> => (broken.has(url) ? null : { src: { url } as unknown as CanvasImageSource, w: 128, h: 128 }))
  return { json, image }
}

const FULL = {
  '/assets/iso3d/manifest.json': ROOT,
  '/assets/iso3d/chars/manifest.json': CHARS,
  '/assets/iso3d/furniture/manifest.json': FURN,
  '/assets/iso3d/surfaces/manifest.json': SURF,
  '/assets/iso3d/wallart/manifest.json': WALLART,
}

afterEach(() => {
  resetIsoArt()
  vi.unstubAllGlobals()
})

describe('iso3d manifest validation', () => {
  it('accepts safe relative files only', () => {
    expect(validFile('chars/jin.webp')).toBe(true)
    expect(validFile('jin@1x.webp')).toBe(true)
    for (const bad of ['', '../x.webp', 'a/../b.webp', '/abs.webp', 'http://x/y.webp', 'a\\b.webp', './a.webp', 3]) expect(validFile(bad)).toBe(false)
  })

  it('root keeps valid sub-manifest paths and defaults the scale', () => {
    expect(parseRoot(ROOT)).toEqual({ scale: 2, chars: 'chars/manifest.json', furniture: 'furniture/manifest.json', surfaces: 'surfaces/manifest.json', wallArt: 'wallart/manifest.json', seasonal: null, icons: null })
    expect(parseRoot({ ...ROOT, seasonal: 'seasonal/manifest.json', icons: 'icons/manifest.json' })).toMatchObject({ seasonal: 'seasonal/manifest.json', icons: 'icons/manifest.json' })
    expect(parseRoot({ chars: '../x', scale: 99 })).toEqual({ scale: 2, chars: null, furniture: null, surfaces: null, wallArt: null, seasonal: null, icons: null })
    expect(parseRoot('nope')).toBeNull()
  })

  it('characters: anims validated per item, bad archetypes skipped, anchors defaulted', () => {
    const m = parseCharManifest(CHARS)!
    expect(m.archetypes.map((a) => a.id)).toEqual(['jin', 'mai'])
    expect(m.archetypes[1]!.anims.stand_down).toEqual({ row: 0, frames: 1, ms: 0, anchor: 'feet' })
    expect(m.archetypes[1]!.anims.sit_down!.anchor).toBe('seat')
    expect(m.anchors.seat).toEqual([96, 240])
    const loose = parseCharManifest({
      frame: { w: 100, h: 200 },
      anchors: { feet: [50, 190] },
      archetypes: [
        { id: 'ok', look: 'm', sheet: 'ok.webp', anims: { stand_down: { row: 0, frames: 1 }, 'Bad Name': { row: 0, frames: 1 }, walk_up: { row: -1, frames: 2 } } },
        { id: 'ok', look: 'f', sheet: 'dup.webp', anims: { stand_down: { row: 0, frames: 1 } } },
        { id: 'x', look: 'q', sheet: 'x.webp', anims: { stand_down: { row: 0, frames: 1 } } },
        { id: 'y', look: 'f', sheet: '../y.webp', anims: { stand_down: { row: 0, frames: 1 } } },
        { id: 'z', look: 'f', sheet: 'z.webp', anims: {} },
      ],
    })!
    expect(loose.archetypes.map((a) => a.id)).toEqual(['ok'])
    expect(Object.keys(loose.archetypes[0]!.anims)).toEqual(['stand_down'])
    expect(loose.anchors.head[1]).toBeLessThan(190)
    expect(m.standH).toBeNull()
    expect(parseCharManifest({ ...CHARS, frame: { w: 192, h: 352 }, figure: { standH: 280 } })!.standH).toBe(280)
    expect(parseCharManifest({ ...CHARS, frame: { w: 192, h: 352 }, figure: { standH: 900 } })!.standH).toBeNull()
    expect(parseCharManifest({ ...CHARS, frame: { w: 0, h: 10 } })).toBeNull()
    expect(parseCharManifest({ ...CHARS, anchors: {} })).toBeNull()
    expect(parseCharManifest({ ...CHARS, archetypes: [] })).toBeNull()
  })

  it('furniture: valid keys, files and anchors only; rects kept', () => {
    const m = parseFurnitureManifest(FURN)!
    expect(Object.keys(m.items).sort()).toEqual(['desk', 'desk:white', 'plant_tall:palm', 'wall:clock', 'wall:window'])
    expect(m.items.desk!.rects.screen).toEqual([40, 10, 30, 20])
    expect(m.items.desk!.front).toBe('desk.front.webp')
    expect(m.items['desk:white']!.front).toBeNull()
    expect(parseFurnitureManifest({ items: { desk: { file: 'd.webp', anchor: [0, 0], rects: { screen: [0, 0, -1, 4] } } } })!.items.desk!.rects).toEqual({})
    expect(parseFurnitureManifest({})).toBeNull()
  })

  it('surfaces: known floor and wall kinds, cap colour validated', () => {
    const m = parseSurfacesManifest(SURF)!
    expect(Object.keys(m.floors).sort()).toEqual(['carpet', 'wood'])
    expect(m.floors.carpet).toMatchObject({ tint: true, tiles: 2 })
    expect(m.walls.plain!.cap).toBe('#e9e2d6')
    expect(m.walls.brick!.cap).toBeNull()
    expect(m.walls.brick!.tile).toEqual([64, 64])
    expect(Object.keys(m.rugs)).toEqual(['a', 'b'])
  })

  it('wall art: painting / poster only, tiles defaulted, framed read from object or string', () => {
    const l = parseWallArtManifest(WALLART)
    expect(l.map((a) => a.id)).toEqual(['p1', 'w1', 'c1', 'c2'])
    expect(l[1]!.framed).toBe('w1-framed.webp')
    expect(l[2]!.tiles).toBe(1)
    expect(parseWallArtManifest([{ kind: 'poster', file: 'a.webp', framed: 'b.webp' }])[0]!.framed).toBe('b.webp')
    expect(parseWallArtManifest(null)).toEqual([])
  })
})

describe('loadIsoArt', () => {
  it('loads every group with images', async () => {
    const l = loaders(FULL)
    const art = await loadIsoArt(l)
    expect(art.missing).toBe(false)
    expect([...art.chars!.sheets.keys()].sort()).toEqual(['jin', 'mai'])
    expect(art.furniture.get('desk')!.front).not.toBeNull()
    expect(art.furniture.get('desk')!.scale).toBe(2)
    expect([...art.floors.keys()].sort()).toEqual(['carpet', 'wood'])
    expect([...art.walls.keys()].sort()).toEqual(['brick', 'plain'])
    expect(art.rugs.map((r) => r.key)).toEqual(['a', 'b'])
    expect(art.wallArt.map((a) => a.id)).toEqual(['p1', 'w1', 'c1', 'c2'])
    expect(l.image).toHaveBeenCalledWith('/assets/iso3d/chars/jin.webp')
    expect(l.image).toHaveBeenCalledWith('/assets/iso3d/furniture/desk.front.webp')
  })

  it('drops only the items whose image fails, keeping the rest', async () => {
    const art = await loadIsoArt(loaders(FULL, new Set(['/assets/iso3d/chars/mai.webp', '/assets/iso3d/furniture/desk.webp', '/assets/iso3d/furniture/desk.front.webp', '/assets/iso3d/surfaces/floor-wood.webp'])))
    expect([...art.chars!.sheets.keys()]).toEqual(['jin'])
    expect(art.chars!.archetypes.map((a) => a.id)).toEqual(['jin', 'mai'])
    expect(art.furniture.has('desk')).toBe(false)
    expect(art.furniture.has('desk:white')).toBe(true)
    expect(art.floors.has('wood')).toBe(false)
    expect(art.floors.has('carpet')).toBe(true)
  })

  it('missing root still tries the default sub-manifests; nothing at all = missing', async () => {
    const partial = await loadIsoArt(loaders({ '/assets/iso3d/chars/manifest.json': CHARS }))
    expect(partial.missing).toBe(false)
    expect(partial.chars?.sheets.size).toBe(2)
    expect(partial.furniture.size).toBe(0)
    const none = await loadIsoArt(loaders({}))
    expect(none.missing).toBe(true)
    expect(none.chars).toBeNull()
    expect(archetypesOf(none)).toBe(DEFAULT_ARCHETYPES)
    expect(archetypesOf(partial)).toEqual([
      { id: 'jin', look: 'm' },
      { id: 'mai', look: 'f' },
    ])
  })

  it('survives throwing loaders and caches the shared load', async () => {
    const art = await loadIsoArt({
      json: async () => {
        throw new Error('net')
      },
      image: async () => {
        throw new Error('decode')
      },
    })
    expect(art.missing).toBe(true)
    const fetchMock = vi.fn(async () => new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    const a = isoArt()
    expect(isoArt()).toBe(a)
    expect((await a).missing).toBe(true)
    expect(fetchMock).toHaveBeenCalledWith('/assets/iso3d/manifest.json')
  })
})

describe('art lookup', () => {
  it('furniture: kind:variant, then kind, then nothing (placeholder)', async () => {
    const art = await loadIsoArt(loaders(FULL))
    expect(furnitureArt(art, 'desk', 'white')!.key).toBe('desk:white')
    expect(furnitureArt(art, 'desk', 'dark')!.key).toBe('desk')
    expect(furnitureArt(art, 'desk')!.key).toBe('desk')
    expect(furnitureArt(art, 'plant_tall', 'palm')!.key).toBe('plant_tall:palm')
    expect(furnitureArt(art, 'plant_tall', 'ficus')).toBeNull()
    expect(furnitureArt(art, 'sofa', 'up')).toBeNull()
    expect(furnitureArt(null, 'desk')).toBeNull()
    expect(wallItemArt(art, 'clock')!.key).toBe('wall:clock')
    expect(wallItemArt(art, 'tv')).toBeNull()
  })

  it('wall art picks by kind, size and poster variant, stable per seed', async () => {
    const art = await loadIsoArt(loaders(FULL))
    expect(pickIsoWallArt(art, 'painting', 2, undefined, 7)!.id).toBe('p1')
    expect(pickIsoWallArt(art, 'painting', 4, 'wide', 7)!.id).toBe('w1')
    expect(pickIsoWallArt(art, 'poster', 1, 'cat', 3)!.id).toBe('c2')
    expect(['c1', 'c2']).toContain(pickIsoWallArt(art, 'poster', 1, 'rocket', 3)!.id)
    expect(pickIsoWallArt(art, 'painting', 3, undefined, 1)).toBeNull()
    expect(pickIsoWallArt(null, 'poster', 1, undefined, 1)).toBeNull()
  })
})

const SEASONAL = {
  version: 1,
  scale: 2,
  items: {
    tree: { file: 'tree.webp', anchor: [2, 109], footprint: [1, 1], wall: false },
    'tree:halloween': { file: 'tree-h.webp', anchor: [2, 100] },
    wreath: { file: 'wreath.webp', anchor: [25, 90], footprint: [1, 0], wall: true },
    gift: { file: 'gift.webp', anchor: [2, 50] },
    pumpkin: { file: '../pumpkin.webp', anchor: [2, 56] },
    ghost: { file: 'ghost.webp' },
    'Bad Key': { file: 'bad.webp', anchor: [0, 0] },
  },
}

const ICONS = {
  version: 1,
  scale: 2,
  items: {
    alert: { file: 'alert.webp', size: [36, 34], anchor: [18, 34] },
    zzz: { file: 'zzz.webp' },
    hourglass: { file: 'hourglass.webp', size: [0, 10], anchor: 'x' },
    coffee: { file: 'coffee.webp', size: [30, 30], anchor: [15, 30] },
    '9lives': { file: 'x.webp' },
  },
}

const WITH_EXTRAS = {
  ...FULL,
  '/assets/iso3d/manifest.json': { ...ROOT, seasonal: 'seasonal/manifest.json', icons: 'icons/manifest.json' },
  '/assets/iso3d/seasonal/manifest.json': SEASONAL,
  '/assets/iso3d/icons/manifest.json': ICONS,
}

describe('seasonal decor and head icon manifests', () => {
  it('seasonal: keeps valid items, wall flag, optional footprint; drops bad keys, files and anchors', () => {
    const m = parseSeasonalManifest(SEASONAL)!
    expect(m.scale).toBe(2)
    expect(Object.keys(m.items).sort()).toEqual(['gift', 'tree', 'tree:halloween', 'wreath'])
    expect(m.items.tree).toEqual({ file: 'tree.webp', anchor: [2, 109], footprint: [1, 1], wall: false })
    expect(m.items.wreath!.wall).toBe(true)
    expect(m.items.wreath!.footprint).toBeNull()
    expect(m.items.gift!.footprint).toBeNull()
    expect(parseSeasonalManifest({ version: 1 })).toBeNull()
    expect(parseSeasonalManifest('x')).toBeNull()
  })

  it('icons: size and anchor optional, bad keys dropped', () => {
    const m = parseIconManifest(ICONS)!
    expect(Object.keys(m.items).sort()).toEqual(['alert', 'coffee', 'hourglass', 'zzz'])
    expect(m.items.alert).toEqual({ file: 'alert.webp', size: [36, 34], anchor: [18, 34] })
    expect(m.items.hourglass).toEqual({ file: 'hourglass.webp', size: null, anchor: null })
    expect(parseIconManifest(null)).toBeNull()
  })

  it('loads both sub-manifests; a missing image drops only that item; size and anchor default from the image', async () => {
    const art = await loadIsoArt(loaders(WITH_EXTRAS, new Set(['/assets/iso3d/seasonal/gift.webp', '/assets/iso3d/icons/zzz.webp'])))
    expect([...art.seasonal!.keys()].sort()).toEqual(['tree', 'tree:halloween', 'wreath'])
    expect(art.seasonal!.get('wreath')).toMatchObject({ wall: true, anchor: [25, 90], scale: 2, front: null })
    expect([...art.icons!.keys()].sort()).toEqual(['alert', 'coffee', 'hourglass'])
    expect(art.icons!.get('hourglass')).toMatchObject({ size: [128, 128], anchor: [64, 128] })
    expect(seasonalArt(art, 'tree', 'halloween')!.key).toBe('tree:halloween')
    expect(seasonalArt(art, 'tree', 'christmas')!.key).toBe('tree')
    expect(seasonalArt(art, 'gift', 'christmas')).toBeNull()
    expect(seasonalArt(art, null)).toBeNull()
    expect(seasonalArt(null, 'tree')).toBeNull()
    expect(iconArt(art, 'alert')!.key).toBe('alert')
    expect(iconArt(art, 'zzz')).toBeNull()
    expect(iconArt(null, 'alert')).toBeNull()
  })

  it('missing seasonal / icons manifests leave empty maps and the rest of the art intact', async () => {
    const art = await loadIsoArt(loaders(FULL))
    expect(art.missing).toBe(false)
    expect(art.seasonal!.size).toBe(0)
    expect(art.icons!.size).toBe(0)
    expect(seasonalArt(art, 'tree')).toBeNull()
    expect(iconArt(art, 'alert')).toBeNull()
    expect(seasonalArt({ ...art, seasonal: undefined }, 'tree')).toBeNull()
    expect(iconArt({ ...art, icons: undefined }, 'alert')).toBeNull()
    const broken = await loadIsoArt({
      json: async (u) => (u.includes('seasonal') || u.includes('icons') ? Promise.reject(new Error('x')) : (WITH_EXTRAS as Record<string, unknown>)[u] ?? null),
      image: async (u) => ({ src: { u } as unknown as CanvasImageSource, w: 4, h: 4 }),
    })
    expect(broken.seasonal!.size).toBe(0)
    expect(broken.furniture.size).toBeGreaterThan(0)
  })
})
