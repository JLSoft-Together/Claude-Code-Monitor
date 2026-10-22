import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FURNITURE, type Dir, type FurnitureKind, type Pose } from '@ccm/habblaud/client/src/art/api'
import { ICON_NAMES } from '@ccm/habblaud/client/src/art/icons'
import { furnitureArt, loadIsoArt, parseCharManifest, parseIconManifest, parseSeasonalManifest, parseFurnitureManifest, parseSurfacesManifest, parseWallArtManifest, wallItemArt } from './isoArt'
import { animFits, pickAnim } from './poses'
import { CHAR_STAND_VIEW, charViewScale } from './IsoRenderer'
import { WALL_H } from './projection'

const ROOT = join(__dirname, '../../../public/assets/iso3d')
const has = existsSync(join(ROOT, 'manifest.json'))
const read = (rel: string): unknown => (existsSync(join(ROOT, rel)) ? JSON.parse(readFileSync(join(ROOT, rel), 'utf8')) : null)

function webpSize(b: Buffer): { w: number; h: number } | null {
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WEBP') return null
  const t = b.toString('ascii', 12, 16)
  if (t === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) }
  if (t === 'VP8L') {
    const v = b.readUInt32LE(21)
    return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }
  }
  if (t === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff }
  return null
}

describe.skipIf(!has)('shipped iso3d art matches the renderer contract', () => {
  it('every listed file exists and every manifest item survives validation', async () => {
    const missing: string[] = []
    const art = await loadIsoArt({
      json: async (url) => read(url.replace('/assets/iso3d/', '')),
      image: async (url) => {
        const ok = existsSync(join(ROOT, url.replace('/assets/iso3d/', '')))
        if (!ok) missing.push(url)
        return ok ? { src: { url } as unknown as CanvasImageSource, w: 4096, h: 8192 } : null
      },
    })
    expect(missing).toEqual([])
    expect(art.missing).toBe(false)
    const furn = read('furniture/manifest.json') as { items?: Record<string, unknown> } | null
    if (furn?.items) expect(Object.keys(parseFurnitureManifest(furn)!.items).sort()).toEqual(Object.keys(furn.items).sort())
    const surf = read('surfaces/manifest.json') as Record<string, Record<string, unknown>> | null
    if (surf) {
      const m = parseSurfacesManifest(surf)!
      for (const g of ['floors', 'walls', 'rugs'] as const) expect(Object.keys(m[g]).sort()).toEqual(Object.keys(surf[g] ?? {}).sort())
    }
    const wall = read('wallart/manifest.json') as { wallArt?: unknown[] } | null
    if (wall?.wallArt) expect(parseWallArtManifest(wall)).toHaveLength(wall.wallArt.length)
  })

  it('furniture keys name real kinds and variants, every floor kind resolves', async () => {
    const furn = read('furniture/manifest.json') as { items?: Record<string, unknown> } | null
    for (const key of Object.keys(furn?.items ?? {})) {
      const [a, b, c] = key.split(':')
      const kind = (a === 'wall' ? b : a) as FurnitureKind
      expect(FURNITURE[kind], key).toBeDefined()
      const variant = a === 'wall' ? c : b
      if (variant && !/^\d$/.test(variant)) expect([...(FURNITURE[kind].variants ?? []), 'off', 'on'], key).toContain(variant)
    }
    const m = parseFurnitureManifest(furn)
    const art = m ? { furniture: new Map(Object.entries(m.items).map(([k, d]) => [k, { key: k, ...d, img: { src: null as unknown as CanvasImageSource, w: 1, h: 1 }, front: null, scale: m.scale }])) } : null
    if (art) {
      const asArt = art as unknown as Parameters<typeof furnitureArt>[0]
      for (const kind of Object.keys(FURNITURE) as FurnitureKind[]) {
        if (FURNITURE[kind].mount !== 'floor') continue
        for (const v of [undefined, ...(FURNITURE[kind].variants ?? [])]) expect(furnitureArt(asArt, kind, v), `${kind}:${v}`).not.toBeNull()
      }
      expect(wallItemArt(asArt, 'elevator', '3')?.key).toBe('wall:elevator:3')
      expect(wallItemArt(asArt, 'light_switch', 'on')?.key).toBe('wall:light_switch')
      expect(wallItemArt(asArt, 'light_switch', 'off')?.key).toBe('wall:light_switch:off')
    }
  })

  it('characters: six archetypes, Jin male, every pose maps to a shipped anim', () => {
    const raw = read('chars/manifest.json')
    if (!raw) return
    const m = parseCharManifest(raw)!
    expect(m.archetypes.length).toBe((raw as { archetypes: unknown[] }).archetypes.length)
    expect(m.archetypes.find((a) => a.id === 'jin')?.look).toBe('m')
    const poses: Pose[] = ['stand', 'walk', 'run', 'sit', 'type', 'sleep', 'drink', 'use', 'raise_hand', 'talk', 'stretch', 'read', 'play', 'wait', 'cheer', 'laugh', 'game', 'rps', 'groom', 'sulk']
    const dirs: Dir[] = ['down', 'up', 'left', 'right']
    for (const a of m.archetypes) {
      for (const pose of poses) for (const dir of dirs) for (const seated of [false, true]) {
        const p = pickAnim(a.anims, pose, dir, seated, 'coffee')!
        expect(p.anim.anchor === 'seat', `${a.id} ${pose} ${dir} ${seated} → ${p.name}`).toBe(seated)
      }
    }
  })

  it('characters: frame, anchors and figure height come from the manifest and every anim fits its sheet', () => {
    const raw = read('chars/manifest.json') as { frame: { w: number; h: number }; figure?: { standH?: number } } | null
    if (!raw) return
    const m = parseCharManifest(raw)!
    expect(m.frame).toEqual(raw.frame)
    expect(m.standH).toBe(raw.figure?.standH ?? null)
    const k = charViewScale(m)
    if (m.standH) expect(m.standH * k).toBeCloseTo(CHAR_STAND_VIEW)
    expect((m.standH ?? m.anchors.feet[1] - m.anchors.head[1]) * k).toBeLessThan(WALL_H * 1.25)
    expect(m.anchors.seat[1]).toBeLessThan(m.anchors.feet[1])
    for (const a of m.archetypes) {
      const file = join(ROOT, 'chars', a.sheet)
      if (!existsSync(file)) continue
      const sheet = webpSize(readFileSync(file))
      expect(sheet, a.sheet).not.toBeNull()
      for (const [name, anim] of Object.entries(a.anims)) expect(animFits(anim, m.frame, sheet!), `${a.id} ${name}`).toBe(true)
      const fits = (x: (typeof a.anims)[string]) => animFits(x, m.frame, sheet!)
      expect(pickAnim(a.anims, 'type', 'up', true, 'none', fits)!.name).toBe('sit_type_up')
      expect(pickAnim(a.anims, 'type', 'down', true, 'none', fits)!.name).toBe('sit_down')
      for (const pose of ['sit', 'type', 'sleep', 'raise_hand', 'talk', 'cheer', 'wait'] as Pose[]) {
        for (const dir of ['down', 'up', 'left', 'right'] as Dir[]) expect(pickAnim(a.anims, pose, dir, true, 'none', fits)!.anim.anchor, `${a.id} ${pose} ${dir}`).toBe('seat')
      }
      if (a.anims.walk_coffee_right) expect(pickAnim(a.anims, 'walk', 'left', false, 'coffee', fits)).toMatchObject({ name: 'walk_coffee_right', flip: true })
      if (a.anims.stand_coffee_down) expect(pickAnim(a.anims, 'stand', 'down', false, 'coffee', fits)!.name).toBe('stand_coffee_down')
    }
  })

  it('seasonal decor and head icons: every item validates, wall flags match where the pixel office hangs them', () => {
    const sea = read('seasonal/manifest.json') as { items?: Record<string, unknown> } | null
    if (sea?.items) {
      const m = parseSeasonalManifest(sea)!
      expect(Object.keys(m.items).sort()).toEqual(Object.keys(sea.items).sort())
      for (const [id, it] of Object.entries(m.items)) expect(it.wall, id).toBe(id === 'wreath' || id === 'bat')
    }
    const icons = read('icons/manifest.json') as { items?: Record<string, unknown> } | null
    if (icons?.items) {
      const m = parseIconManifest(icons)!
      expect(Object.keys(m.items).sort()).toEqual(Object.keys(icons.items).sort())
      for (const id of Object.keys(m.items)) expect(ICON_NAMES, id).toContain(id)
    }
  })
})
