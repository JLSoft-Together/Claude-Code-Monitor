import { describe, expect, it } from 'vitest'
import type { Dir, HeldItem, Pose } from '@ccm/habblaud/client/src/art/api'
import type { CharAnim } from './isoArt'
import { animCandidates, animFits, bobOffset, frameIndex, pickAnim } from './poses'

const POSES: Pose[] = ['stand', 'walk', 'run', 'sit', 'type', 'sleep', 'drink', 'use', 'raise_hand', 'talk', 'stretch', 'read', 'play', 'wait', 'cheer', 'laugh', 'game', 'rps', 'groom', 'sulk']
const DIRS: Dir[] = ['down', 'up', 'left', 'right']

const a = (frames = 1, ms = 0, anchor: 'feet' | 'seat' = 'feet'): CharAnim => ({ row: 0, frames, ms, anchor })

const FULL: Record<string, CharAnim> = {
  stand_down: a(),
  stand_up: a(),
  stand_right: a(),
  walk_down: a(4, 160),
  walk_up: a(4, 160),
  walk_right: a(8, 80),
  sit_type_up: a(1, 0, 'seat'),
  sit_down: a(1, 0, 'seat'),
  raise_hand_seated_down: a(2, 320, 'seat'),
  sleep_down: a(2, 1400, 'seat'),
  raise_hand_down: a(2, 320),
  talk_down: a(2, 380),
  cheer_down: a(2, 340),
}

const JIN: Record<string, CharAnim> = { ...FULL, stand_coffee_down: a(), drink_down: a(2, 700), walk_coffee_down: a(4, 160), walk_coffee_right: a(4, 160) }

const SEATED = new Set(['sit_type_up', 'sit_down', 'raise_hand_seated_down', 'sleep_down'])

describe('iso pose mapping', () => {
  it.each(POSES)('every dir and seat state of %s picks an anim that exists, seated ones from the seated set', (pose) => {
    for (const dir of DIRS) {
      for (const seated of [false, true]) {
        for (const held of ['none', 'coffee'] as HeldItem[]) {
          const p = pickAnim(FULL, pose, dir, seated, held)!
          expect(FULL[p.name], `${pose} ${dir} ${seated}`).toBeDefined()
          expect(SEATED.has(p.name)).toBe(seated)
          expect(p.flip).toBe(dir === 'left' && p.name.endsWith('_right'))
          if (dir === 'right') expect(p.flip).toBe(false)
        }
      }
    }
  })

  it('walks in the three drawn directions and mirrors right for left', () => {
    expect(pickAnim(FULL, 'walk', 'down', false)).toMatchObject({ name: 'walk_down', flip: false })
    expect(pickAnim(FULL, 'walk', 'up', false)).toMatchObject({ name: 'walk_up', flip: false })
    expect(pickAnim(FULL, 'walk', 'right', false)).toMatchObject({ name: 'walk_right', flip: false })
    expect(pickAnim(FULL, 'walk', 'left', false)).toMatchObject({ name: 'walk_right', flip: true })
    expect(pickAnim(FULL, 'run', 'left', false)).toMatchObject({ name: 'walk_right', flip: true })
    expect(pickAnim(FULL, 'stand', 'left', false)).toMatchObject({ name: 'stand_right', flip: true })
  })

  it('seated at a desk facing up types from behind; facing the camera sits', () => {
    expect(pickAnim(FULL, 'type', 'up', true)).toMatchObject({ name: 'sit_type_up', bob: 'type' })
    expect(pickAnim(FULL, 'sit', 'up', true)).toMatchObject({ name: 'sit_type_up', bob: 'none' })
    expect(pickAnim(FULL, 'sit', 'down', true)!.name).toBe('sit_down')
    expect(pickAnim(FULL, 'wait', 'left', true)).toMatchObject({ name: 'sit_down', flip: false })
    expect(pickAnim(FULL, 'raise_hand', 'up', true)!.name).toBe('raise_hand_seated_down')
    expect(pickAnim(FULL, 'raise_hand', 'up', false)!.name).toBe('raise_hand_down')
    expect(pickAnim(FULL, 'sleep', 'down', true)!.name).toBe('sleep_down')
    expect(pickAnim(FULL, 'sleep', 'up', true)!.name).toBe('sit_type_up')
  })

  it('plan fallbacks: talk-likes, stand-likes, cheer', () => {
    for (const p of ['laugh', 'rps', 'talk'] as Pose[]) expect(pickAnim(FULL, p, 'down', false)!.name).toBe('talk_down')
    expect(pickAnim(FULL, 'talk', 'up', false)!.name).toBe('stand_up')
    for (const p of ['drink', 'use', 'groom', 'play', 'stretch', 'sulk', 'read', 'game'] as Pose[]) expect(pickAnim(FULL, p, 'right', false)!.name).toBe('stand_right')
    expect(pickAnim(FULL, 'cheer', 'up', false)!.name).toBe('cheer_down')
    expect(pickAnim({ stand_down: a(), talk_down: a(2, 300) }, 'cheer', 'down', false)!.name).toBe('talk_down')
  })

  it('Jin coffee anims when holding coffee, plain ones otherwise', () => {
    expect(pickAnim(JIN, 'stand', 'down', false, 'coffee')!.name).toBe('stand_coffee_down')
    expect(pickAnim(JIN, 'stand', 'up', false, 'coffee')!.name).toBe('stand_up')
    expect(pickAnim(JIN, 'walk', 'left', false, 'coffee')).toMatchObject({ name: 'walk_coffee_right', flip: true })
    expect(pickAnim(JIN, 'walk', 'up', false, 'coffee')!.name).toBe('walk_up')
    expect(pickAnim(JIN, 'drink', 'down', false, 'coffee')!.name).toBe('drink_down')
    expect(pickAnim(JIN, 'drink', 'down', false, 'none')!.name).toBe('stand_down')
    expect(pickAnim(FULL, 'drink', 'down', false, 'coffee')!.name).toBe('stand_down')
    expect(pickAnim(JIN, 'walk', 'down', false, 'none')!.name).toBe('walk_down')
  })

  it('a sparse sheet falls back to stand, then to any anim; empty gives null', () => {
    const sparse = { stand_down: a() }
    for (const pose of POSES) for (const dir of DIRS) expect(pickAnim(sparse, pose, dir, false)).toMatchObject({ name: 'stand_down', flip: false })
    expect(pickAnim(sparse, 'walk', 'left', false)!.bob).toBe('step')
    expect(pickAnim({ wave: a() }, 'type', 'up', true)!.name).toBe('wave')
    expect(pickAnim({}, 'stand', 'down', false)).toBeNull()
    expect(animCandidates('walk', 'left', false, 'coffee')).toEqual(['walk_coffee_right', 'walk_right', 'stand_coffee_right', 'stand_right', 'stand_down'])
  })

  it('anims whose rows fall outside the sheet are skipped for the next seated candidate, never a standing one', () => {
    const sheet = { w: 192 * 8, h: 352 * 7 }
    const frame = { w: 192, h: 352 }
    const rows: Record<string, CharAnim> = { stand_down: a(), sit_down: { row: 9, frames: 1, ms: 0, anchor: 'seat' }, sit_type_up: { row: 6, frames: 1, ms: 0, anchor: 'seat' } }
    const fits = (x: CharAnim) => animFits(x, frame, sheet)
    expect(animFits(rows.sit_type_up!, frame, sheet)).toBe(true)
    expect(animFits(rows.sit_down!, frame, sheet)).toBe(false)
    expect(animFits({ row: 0, frames: 9, ms: 80, anchor: 'feet' }, frame, sheet)).toBe(false)
    expect(pickAnim(rows, 'sit', 'down', true, 'none', fits)!.name).toBe('sit_type_up')
    expect(pickAnim({ stand_down: a(), sleep_down: { row: 20, frames: 2, ms: 1400, anchor: 'seat' }, raise_hand_seated_down: { row: 3, frames: 1, ms: 0, anchor: 'seat' } }, 'sleep', 'down', true, 'none', fits)!.name).toBe('raise_hand_seated_down')
    expect(pickAnim({ stand_down: { row: 30, frames: 1, ms: 0, anchor: 'feet' } }, 'stand', 'down', false, 'none', fits)).toBeNull()
  })

  it('frame timing comes from the manifest ms; single frames bob in code', () => {
    expect(frameIndex(FULL.walk_right!, 0)).toBe(0)
    expect(frameIndex(FULL.walk_right!, 79)).toBe(0)
    expect(frameIndex(FULL.walk_right!, 80)).toBe(1)
    expect(frameIndex(FULL.walk_right!, 80 * 9)).toBe(1)
    expect(frameIndex(FULL.stand_down!, 5000)).toBe(0)
    expect(frameIndex(a(3, 0), 5000)).toBe(0)
    expect(pickAnim(FULL, 'stand', 'down', false)!.bob).toBe('breathe')
    expect(pickAnim(FULL, 'walk', 'down', false)!.bob).toBe('none')
    expect([bobOffset('type', 0), bobOffset('type', 150)]).toEqual([0, 1])
    for (let t = 0; t < 3000; t += 37) {
      expect(Math.abs(bobOffset('breathe', t))).toBeLessThanOrEqual(0.5)
      expect(bobOffset('step', t)).toBeLessThanOrEqual(0)
      expect(bobOffset('step', t)).toBeGreaterThanOrEqual(-1.5)
    }
    expect(bobOffset('none', 1234)).toBe(0)
  })
})
