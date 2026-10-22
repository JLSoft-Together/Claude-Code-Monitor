import { describe, expect, it } from 'vitest'
import { seasonalElevatorProp, seasonalFurnitureProp, seasonalWallBat } from '@ccm/habblaud/client/src/world/render/seasonal'
import { layoutCafe, layoutRestroom } from '@ccm/habblaud/client/src/world/layout/core'
import { hash32 } from '@ccm/habblaud/shared/hash'
import { bulbSpots, BULB_STEP, garlandSag, garlandSpan, GARLAND_SAG } from './seasonal'
import { seasonalCover, seasonalPlacement, SEASONAL_COVER_MAX } from './IsoRenderer'

describe('seasonal decor placement (shared with the pixel office)', () => {
  it('first tall plant becomes the tree / ghost / pumpkin, small plants gifts / pumpkins, never in restrooms', () => {
    const cafe = layoutCafe()
    const tall = cafe.furniture.filter((f) => f.kind === 'plant_tall')
    const small = cafe.furniture.find((f) => f.kind === 'plant_small')
    if (tall.length) {
      expect(seasonalFurnitureProp('christmas', 'plant_tall', cafe, hash32(tall[0]!.id))).toBe('tree')
      expect(['ghost', 'pumpkin']).toContain(seasonalFurnitureProp('halloween', 'plant_tall', cafe, hash32(tall[0]!.id)))
      if (tall[1]) expect(seasonalFurnitureProp('christmas', 'plant_tall', cafe, hash32(tall[1].id))).toBeNull()
    }
    if (small) expect(seasonalFurnitureProp('christmas', 'plant_small', cafe, 1)).toBe('gift')
    expect(seasonalFurnitureProp('halloween', 'plant_small', cafe, 1)).toBe('pumpkin')
    expect(seasonalFurnitureProp('none', 'plant_small', cafe, 1)).toBeNull()
    expect(seasonalFurnitureProp('christmas', 'desk', cafe, 1)).toBeNull()
    expect(seasonalFurnitureProp('christmas', 'plant_small', layoutRestroom(), 1)).toBeNull()
    expect(seasonalElevatorProp('christmas')).toBe('wreath')
    expect(seasonalElevatorProp('halloween')).toBe('bat')
    expect(seasonalElevatorProp('none')).toBeNull()
  })

  it('the wall bat sits mid-wall on long face walls in Halloween only', () => {
    const face = { kind: 'face' as const, x: 10, y: 0, w: 120, h: 32, style: {} as never }
    expect(seasonalWallBat('halloween', face)).toEqual({ cx: 70, y: 23 })
    expect(seasonalWallBat('halloween', { ...face, w: 80 })).toBeNull()
    expect(seasonalWallBat('christmas', face)).toBeNull()
  })

  it('a seasonal floor item is centred on the plant footprint, south edge kept', () => {
    expect(seasonalPlacement({ tx: 4, ty: 2, dx: 3 }, { w: 1, h: 1 }, [1, 1])).toEqual({ tx: 4, ty: 2, dx: 3, dy: undefined })
    expect(seasonalPlacement({ tx: 4, ty: 2 }, { w: 2, h: 1 }, [1, 1]).tx).toBe(4.5)
    expect(seasonalPlacement({ tx: 4, ty: 2 }, { w: 1, h: 1 }, null).tx).toBe(4)
  })

  it('garland scallops match the pixel office, skip doorway edges, bulbs skip doorways', () => {
    expect(garlandSag(13, 13)).toBeCloseTo(0)
    expect(garlandSag(13 + 24, 13)).toBeCloseTo(GARLAND_SAG)
    expect(garlandSpan({ x: 0, w: 200 }, { x0: 0, x1: 80 })).toEqual([3, 79])
    expect(garlandSpan({ x: 0, w: 200 }, { x0: 120, x1: 200 })).toEqual([121, 197])
    expect(garlandSpan({ x: 0, w: 200 }, { x0: 198, x1: 200 })).toBeNull()
    const spots = bulbSpots({ kind: 'face', x: 0, y: 0, w: 200, doorways: [{ x: 60, w: 32 }] })
    expect(spots.length).toBeGreaterThan(2)
    expect(spots.every((s) => s.x < 50 || s.x > 102)).toBe(true)
    expect(spots[1]!.x - spots[0]!.x).toBe(BULB_STEP)
    expect(bulbSpots({ kind: 'south', x: 0, y: 0, w: 200 })).toEqual([])
  })
  it('a prop that a taller item in front would cover is skipped (the plant stays), side neighbours do not count', () => {
    const tile = (tx: number, ty: number) => ({ minX: tx * 16 + 1, minY: ty * 16 + 1, maxX: tx * 16 + 15, maxY: ty * 16 + 15 })
    const prop = { box: tile(14, 2), draw: { x: 448, y: 30, w: 34, h: 40 } }
    const lamp = { box: tile(14, 4), screen: { x0: 452, y0: 20, x1: 478, y1: 115 } }
    const side = { box: tile(15, 2), screen: { x0: 440, y0: 0, x1: 500, y1: 90 } }
    const low = { box: tile(14, 3), screen: { x0: 448, y0: 64, x1: 482, y1: 92 } }
    expect(seasonalCover(prop, [lamp])).toBeGreaterThan(SEASONAL_COVER_MAX)
    expect(seasonalCover(prop, [side])).toBe(0)
    expect(seasonalCover(prop, [low])).toBeLessThanOrEqual(SEASONAL_COVER_MAX)
    expect(seasonalCover({ ...prop, draw: null }, [lamp])).toBe(0)
  })
})
