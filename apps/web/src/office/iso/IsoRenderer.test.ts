// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWorld } from '@ccm/habblaud/client/src/world'
import { isoProjection } from './projection'
import { layoutCafe, layoutLounge, layoutReception, layoutRestroom } from '@ccm/habblaud/client/src/world/layout/core'
import { toWallVis } from '@ccm/habblaud/client/src/world/render/scene'
import { tr } from '@ccm/habblaud/shared/i18n'
import { CHAR_STAND_VIEW, charViewScale, seasonalCover, SEASONAL_COVER_MAX, coreSignOf, CORE_SIGNS, createIsoRenderer, drawClockHands, furnitureDrawRect, IsoRenderer, isoMaxZoom, MAX_CHAR_VIEW_FRAC, MIN_MAX_ZOOM, rugSlices, signClears, wallLocalScale } from './IsoRenderer'
import { WALL_H } from './projection'
import { loadIsoArt, type IsoImage } from './isoArt'
import { makeIsoView } from './projection'
import { fitSign } from './sign'
import { IsoLight } from './light'
import { IsoReveal, revealOrder } from './reveal'
import * as artModule from '@ccm/habblaud/client/src/art'
import { Camera } from '@ccm/habblaud/client/src/world/camera'
import { BUILDING_H, COL_W } from '@ccm/habblaud/client/src/world/constants'
import { DEFAULT_WORLD_OPTIONS } from '@ccm/habblaud/client/src/world/api'

const realSchedule = IsoReveal.prototype.schedule

class FakeImageData {
  data: Uint8ClampedArray
  width: number
  height: number
  constructor(a: Uint8ClampedArray | number, b: number, c?: number) {
    if (typeof a === 'number') {
      this.width = a
      this.height = b
      this.data = new Uint8ClampedArray(Math.max(0, a * b * 4))
    } else {
      this.data = a
      this.width = b
      this.height = c ?? Math.floor(a.length / 4 / Math.max(1, b))
    }
  }
}

type Counter = { ops: number; drawn?: Set<unknown>; texts?: string[] }

function makeCtx(canvas: unknown, counter: Counter): CanvasRenderingContext2D {
  const state: Record<string, unknown> = { globalAlpha: 1, lineWidth: 1 }
  const special: Record<string, (...a: never[]) => unknown> = {
    getImageData: (_x: number, _y: number, w: number, h: number) => new FakeImageData(Math.max(1, w), Math.max(1, h)),
    createImageData: (w: number, h: number) => new FakeImageData(w, h),
    measureText: (t: string) => ({ width: String(t).length * 6 }),
    createPattern: () => ({ setTransform: () => {} }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
  }
  return new Proxy({} as CanvasRenderingContext2D, {
    get(_t, p: string) {
      if (p === 'canvas') return canvas
      if (p in special) return special[p]
      if (p in state) return state[p]
      if (p === 'fillText')
        return (t: string) => {
          counter.ops++
          counter.texts?.push(t)
        }
      if (p === 'drawImage')
        return (src: unknown) => {
          counter.ops++
          counter.drawn?.add(src)
        }
      return () => {
        counter.ops++
      }
    },
    set(_t, p: string, v) {
      state[p] = v
      return true
    },
  })
}

function makeCanvas(counter: Counter, extra: Record<string, unknown> = {}): HTMLCanvasElement {
  let ctx: CanvasRenderingContext2D | null = null
  const c = Object.assign(new EventTarget(), {
    width: 300,
    height: 150,
    style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }),
    getContext: () => (ctx ??= makeCtx(c, counter)),
    ...extra,
  })
  return c as unknown as HTMLCanvasElement
}

function setup(): { frames: ((ts: number) => void)[]; main: { ops: number; drawn: Set<unknown>; texts: string[] } } {
  const frames: ((ts: number) => void)[] = []
  const off = { ops: 0 }
  const main = { ops: 0, drawn: new Set<unknown>(), texts: [] as string[] }
  vi.stubGlobal(
    'document',
    Object.assign(new EventTarget(), { hidden: false, fonts: new EventTarget(), createElement: () => makeCanvas(off), querySelector: () => null }),
  )
  vi.stubGlobal('window', Object.assign(new EventTarget(), { devicePixelRatio: 1, innerWidth: 1280, innerHeight: 800 }))
  vi.stubGlobal('ImageData', FakeImageData)
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((cb: (ts: number) => void) => {
      frames.push(cb)
      return frames.length
    }),
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
  return { frames, main }
}

const T0 = Date.UTC(2026, 9, 22, 9, 0, 0)

const store = () =>
  ({
    snapshot: { rev: 1, serverTime: T0, rooms: [], agents: [], accounts: [], meta: { demo: false, sources: [], startedAt: T0, version: 'iso' } },
    on: () => () => {},
  }) as unknown as Parameters<typeof createWorld>[1]

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('IsoRenderer through createWorld', () => {
  it('renders ~40 agents without frame errors, heads in view space, picking and room selection work', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    const env = setup()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const canvas = makeCanvas(env.main, { clientWidth: 1280, clientHeight: 800 })
    const factory = vi.fn(createIsoRenderer)
    const world = createWorld(canvas, store(), { projection: isoProjection, renderer: factory })
    await Promise.resolve()
    const ids: string[] = []
    for (let i = 0; i < 8; i++) ids.push(world.debug.spawnSession({ project: `p${i}`, subs: 4 }))
    let ts = 1000
    const step = (n: number) => {
      const t0 = performance.now()
      for (let i = 0; i < n; i++) {
        ts += 1000 / 60
        vi.setSystemTime(T0 + ts)
        env.frames.shift()?.(ts)
      }
      return (performance.now() - t0) / n
    }
    step(240)
    world.overview()
    step(30)
    const perFrame = step(120)
    expect(errors).not.toHaveBeenCalled()
    const sim = world.debug.sim
    expect(sim.chars.size).toBeGreaterThanOrEqual(35)
    const r = factory.mock.results[0]!.value as unknown as IsoRenderer
    expect(r).toBeInstanceOf(IsoRenderer)
    expect(r.staticCount).toBeGreaterThan(100)
    const kinds = new Set((r as unknown as { statics: { kind: string }[] }).statics.map((s) => s.kind))
    expect([...kinds].sort()).toEqual(['furn', 'wall'])
    expect('exterior' in r).toBe(false)
    const visible = [...r.heads.entries()].filter(([, h]) => h.visible)
    expect(visible.length).toBeGreaterThan(20)
    for (const [id, h] of visible) {
      const ch = sim.chars.get(id)
      if (!ch || ch.seated) continue
      const v = isoProjection.toView(ch.x + ch.offX, ch.y + ch.offY + 8 - 11)
      expect(Math.abs(h.x - v.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(h.feetY - v.y)).toBeLessThanOrEqual(1)
    }
    const onScreen = ids.map((id) => world.screenPositionOf(id)).filter(Boolean)
    expect(onScreen.length).toBeGreaterThan(0)
    const roomId = [...sim.rooms.keys()][0]!
    world.select({ type: 'room', id: roomId }, { focus: true })
    step(40)
    expect(errors).not.toHaveBeenCalled()
    world.setPlayback!({ clock: () => T0, scale: () => 1 } as never)
    step(5)
    expect(factory).toHaveBeenCalledTimes(2)
    expect(errors).not.toHaveBeenCalled()
    console.info(`[iso bench] ${sim.chars.size} agents, ${r.staticCount} statics, ${perFrame.toFixed(2)} ms/frame JS (recording ctx, no raster)`)
    world.destroy()
  }, 60_000)
})

const ANIMS = [
  ['stand_down', 1, 0, 'feet'],
  ['stand_up', 1, 0, 'feet'],
  ['stand_right', 1, 0, 'feet'],
  ['walk_down', 4, 160, 'feet'],
  ['walk_up', 4, 160, 'feet'],
  ['walk_right', 8, 80, 'feet'],
  ['sit_type_up', 1, 0, 'seat'],
  ['sit_down', 1, 0, 'seat'],
  ['raise_hand_seated_down', 2, 320, 'seat'],
  ['sleep_down', 2, 1400, 'seat'],
  ['raise_hand_down', 2, 320, 'feet'],
  ['talk_down', 2, 380, 'feet'],
  ['cheer_down', 2, 340, 'feet'],
] as const

function fakeArt(extra: Record<string, unknown> = {}) {
  const anims = Object.fromEntries(ANIMS.map(([n, frames, ms, anchor], row) => [n, { row, frames, ms, anchor }]))
  const ids = ['jin', 'theo', 'kofi', 'mai', 'rosa', 'ava']
  const files: Record<string, unknown> = {
    '/assets/iso3d/manifest.json': { version: 1, scale: 2, chars: 'chars/manifest.json', furniture: 'furniture/manifest.json', surfaces: 'surfaces/manifest.json', wallArt: 'wallart/manifest.json' },
    '/assets/iso3d/chars/manifest.json': {
      version: 1,
      scale: 2,
      frame: { w: 192, h: 352 },
      figure: { standH: 280 },
      cols: 8,
      anchors: { feet: [96, 344], head: [96, 95], chest: [96, 165], hand: [137, 215], seat: [96, 272] },
      archetypes: ids.map((id, i) => ({ id, look: i < 3 ? 'm' : 'f', sheet: `${id}.webp`, anims })),
    },
    '/assets/iso3d/furniture/manifest.json': {
      version: 1,
      scale: 2,
      items: {
        desk: { file: 'desk.webp', footprint: [2, 1], anchor: [8, 100], rects: { screen: [40, 10, 40, 24] } },
        desk_back: { file: 'desk_back.webp', footprint: [2, 1], anchor: [8, 100], front: 'desk_back.front.webp' },
        office_chair: { file: 'chair.webp', footprint: [1, 1], anchor: [8, 80], front: 'chair.front.webp' },
        'wall:clock': { file: 'clock.webp', anchor: [32, 80], rects: { face: [8, 8, 48, 48] } },
        'wall:sign': { file: 'sign.webp', anchor: [50, 90], rects: { sign: [8, 7, 81, 17] } },
        'wall:window': { file: 'window.webp', anchor: [64, 90], rects: { glass: [6, 6, 116, 60] } },
      },
    },
    '/assets/iso3d/surfaces/manifest.json': {
      version: 1,
      scale: 2,
      floors: { carpet: { file: 'carpet.webp', tile: [64, 64], tint: true }, concrete: { file: 'concrete.webp', tile: [64, 64] } },
      walls: { plain: { file: 'wall.webp', tile: [64, 96], tint: true, cap: '#e9e2d6' } },
      rugs: { a: { file: 'rug.webp', tint: true } },
    },
    '/assets/iso3d/wallart/manifest.json': { wallArt: [{ id: 'p', kind: 'painting', file: 'p.webp', tiles: 2 }] },
    ...extra,
  }
  const images = new Map<string, IsoImage>()
  const image = async (url: string): Promise<IsoImage | null> => {
    if (url.includes('/missing-')) return null
    const big = url.includes('/chars/')
    const img = { src: { url } as unknown as CanvasImageSource, w: big ? 192 * 8 : 128, h: big ? 352 * ANIMS.length : 128 }
    images.set(url, img)
    return img
  }
  return { load: () => loadIsoArt({ json: async (u) => files[u] ?? null, image }), images }
}

describe('IsoRenderer with 3D sprites', () => {
  it('draws character sheets, furniture, fronts, floors and wall items from the art; heads stay at the feet', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    const env = setup()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { load, images } = fakeArt()
    const pixel = vi.spyOn(IsoRenderer.prototype as unknown as { charSprite: () => unknown }, 'charSprite')
    const art = await load()
    expect(art.missing).toBe(false)
    const canvas = makeCanvas(env.main, { clientWidth: 1280, clientHeight: 800 })
    let made: IsoRenderer | null = null
    const world = createWorld(canvas, store(), {
      projection: isoProjection,
      renderer: (c, a, s, cam) => (made = new IsoRenderer(c, a, s, cam, isoProjection, art)),
    })
    await Promise.resolve()
    for (let i = 0; i < 4; i++) world.debug.spawnSession({ project: `p${i}`, subs: 3 })
    let ts = 1000
    const step = (n: number) => {
      for (let i = 0; i < n; i++) {
        ts += 1000 / 60
        vi.setSystemTime(T0 + ts)
        env.frames.shift()?.(ts)
      }
    }
    step(400)
    world.overview()
    step(30)
    expect(errors).not.toHaveBeenCalled()
    const ren = made as unknown as IsoRenderer
    expect(ren.isoArtLoaded).toBe(true)
    const drawn = env.main.drawn
    const src = (u: string) => images.get(`/assets/iso3d/${u}`)!.src
    const sheets = ['jin', 'theo', 'kofi', 'mai', 'rosa', 'ava'].filter((id) => drawn.has(src(`chars/${id}.webp`)))
    expect(sheets.length).toBeGreaterThan(0)
    expect(drawn.has(src('furniture/desk.webp')) || drawn.has(src('furniture/desk_back.webp'))).toBe(true)
    expect(drawn.has(src('furniture/chair.webp'))).toBe(true)
    expect(drawn.has(src('furniture/chair.front.webp'))).toBe(true)
    const statics = (ren as unknown as { statics: { kind: string; sprite?: unknown }[] }).statics
    expect(statics.filter((s) => s.kind === 'furn' && s.sprite).length).toBeGreaterThan(5)
    expect(statics.filter((s) => s.kind === 'furn' && !s.sprite).length).toBeGreaterThan(0)
    const sim = world.debug.sim
    const visible = [...ren.heads.entries()].filter(([, h]) => h.visible)
    expect(visible.length).toBeGreaterThan(5)
    for (const [id, h] of visible) {
      const ch = sim.chars.get(id)
      expect(h.y).toBeLessThan(h.feetY - 20)
      if (!ch || ch.seated) continue
      const v = isoProjection.toView(ch.x + ch.offX, ch.y + ch.offY + 8 - 11)
      expect(Math.abs(h.x - v.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(h.feetY - v.y)).toBeLessThanOrEqual(1)
    }
    const rooms = [...sim.rooms.values()].filter((r) => r.present)
    expect(rooms.length).toBeGreaterThan(0)
    for (const room of rooms) {
      const vis = ren.areas.get(room.id)!
      const rect = ren.signRect(vis)
      expect(rect, room.id).not.toBeNull()
      expect(rect!.w).toBeGreaterThan(rect!.h)
      expect(env.main.texts.some((t) => t === room.info.name || (t.endsWith('…') && room.info.name.startsWith(t.slice(0, -1).trimEnd())))).toBe(true)
    }
    for (const id of ['core:copa', 'core:lounge', 'core:banheiros', 'core:recepcao']) {
      const vis = ren.areas.get(id)!
      const rect = ren.signRect(vis)
      expect(rect, id).not.toBeNull()
      expect(rect!.w).toBeGreaterThan(rect!.h)
      const name = ren.signName(vis)!
      expect(name).toBe(id === 'core:recepcao' ? 'Orrery' : tr(CORE_SIGNS[id]!.name))
      expect(env.main.texts.some((t) => t === name || (t.endsWith('…') && name.startsWith(t.slice(0, -1).trimEnd()))), id).toBe(true)
    }
    for (let i = 0; i < 60 && ![...sim.chars.values()].some((c) => c.seated && !c.inside && c.alpha > 0.5); i++) step(30)
    step(2)
    expect([...sim.chars.values()].some((c) => c.seated && !c.inside)).toBe(true)
    expect(pixel).not.toHaveBeenCalled()
    world.destroy()
  }, 60_000)

  it('night light map, glows, shell waits, ping-pong and GitHub effects all run in 3D', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    const env = setup()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { load } = fakeArt()
    const art = await load()
    const proto = IsoRenderer.prototype as unknown as Record<string, () => unknown>
    const paint = vi.spyOn(IsoLight.prototype as unknown as Record<string, () => unknown>, 'paint')
    const webs = vi.spyOn(proto, 'drawWeb')
    const beacons = vi.spyOn(proto, 'drawBeacons')
    const glows = vi.spyOn(proto, 'drawGlows')
    const icons = vi.spyOn(proto, 'pushIcon')
    const canvas = makeCanvas(env.main, { clientWidth: 1280, clientHeight: 800 })
    let made: IsoRenderer | null = null
    const world = createWorld(canvas, store(), {
      projection: isoProjection,
      renderer: (c, a, s, cam) => (made = new IsoRenderer(c, a, s, cam, isoProjection, art)),
    })
    await Promise.resolve()
    const shelled = world.debug.spawnSession({ project: 'shells', subs: 0, shell: { label: 'npm test', ageMinutes: 25, count: 2 } })
    const ids = [shelled]
    for (let i = 0; i < 3; i++) ids.push(world.debug.spawnSession({ project: `fx${i}`, subs: 2 }))
    let ts = 1000
    let maxParticles = 0
    const step = (n: number) => {
      for (let i = 0; i < n; i++) {
        ts += 1000 / 60
        vi.setSystemTime(T0 + ts)
        env.frames.shift()?.(ts)
        maxParticles = Math.max(maxParticles, (made as unknown as IsoRenderer).particles.count)
      }
    }
    step(400)
    world.overview()
    world.debug.setHour(23)
    const sim = world.debug.sim
    const rooms = [...sim.rooms.values()].filter((r) => r.present)
    world.debug.roomEffect(rooms[1]!.id, 'party')
    world.debug.roomEffect(rooms[2]!.id, 'alarm', { agentId: ids[2] })
    world.debug.socialize('pingpong')
    step(240)
    expect(errors).not.toHaveBeenCalled()
    const ren = made as unknown as IsoRenderer
    expect(ren.night).toBeGreaterThan(0.9)
    expect(paint).toHaveBeenCalled()
    expect(glows).toHaveBeenCalled()
    expect(beacons).toHaveBeenCalled()
    expect(maxParticles).toBeGreaterThan(0)
    expect(icons.mock.calls.some((c) => String((c as unknown[])[2]).startsWith('hourglass'))).toBe(true)
    expect(webs).toHaveBeenCalled()
    world.destroy()
  }, 60_000)

  it('places sprites by their anchors and scales wall items into the wall plane', () => {
    const view = makeIsoView({ yaw: 0, k: 0.7 })
    const r = furnitureDrawRect(view, { anchor: [8, 100], scale: 2, img: { src: null as unknown as CanvasImageSource, w: 140, h: 120 } }, { tx: 3, ty: 4, dx: 8 }, 1)
    const corner = view.toView(3 * 16 + 8, 5 * 16)
    expect(r.ax).toBeCloseTo(corner.x)
    expect(r.ay).toBeCloseTo(corner.y)
    expect(r.x).toBeCloseTo(corner.x - 4)
    expect(r.y).toBeCloseTo(corner.y - 50)
    expect(r.w).toBe(70)
    expect(r.h).toBe(60)
    const w = wallLocalScale(view, 2)
    expect(w.sx).toBeCloseTo(0.25)
    expect(w.sy).toBeCloseTo(1 / 3)
    const anchors = { feet: [96, 344], head: [96, 95], chest: [0, 0], hand: [0, 0], seat: [0, 0] } as const
    expect(charViewScale({ viewScale: null, standH: 280, anchors })).toBeCloseTo(CHAR_STAND_VIEW / 280)
    expect(280 * charViewScale({ viewScale: null, standH: 280, anchors })).toBeCloseTo(58)
    expect(280 * charViewScale({ viewScale: null, standH: 280, anchors })).toBeGreaterThan(WALL_H)
    expect(280 * charViewScale({ viewScale: null, standH: 280, anchors })).toBeLessThan(WALL_H * 1.25)
    expect(charViewScale({ viewScale: null, standH: null, anchors })).toBeCloseTo(CHAR_STAND_VIEW / 249)
    expect(charViewScale({ viewScale: 0.2, standH: 280, anchors })).toBe(0.2)
  })

  it('rugs keep their border at native thickness however long the run', () => {
    const img = { w: 384, h: 221 }
    const parts = rugSlices(img, { x: 10, y: 20, w: 160, h: 17.6 })
    expect(parts).toHaveLength(9)
    const border = Math.round(221 * 0.11)
    const corner = parts[0]!
    expect(corner).toMatchObject({ sx: 0, sy: 0, sw: border, sh: border, dx: 10, dy: 20 })
    expect(corner.dw).toBeCloseTo(corner.dh)
    expect(corner.dw).toBeLessThanOrEqual(17.6 / 3 + 1e-9)
    const right = parts[2]!
    expect(right.dx + right.dw).toBeCloseTo(170)
    const bottom = parts[8]!
    expect(bottom.dy + bottom.dh).toBeCloseTo(37.6)
    const room = rugSlices(img, { x: 0, y: 0, w: 112, h: 88 })
    expect(room[0]!.dw).toBeCloseTo(border * 0.25)
  })

  it('sign names that do not fit shrink to a readable floor, then truncate with an ellipsis', () => {
    const measure = (font: string, t: string) => Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]) * 0.6 * t.length
    const short = fitSign(measure, 'api', { w: 106, h: 10 }, 0, 0)
    expect(short.lines).toEqual(['api'])
    expect(short.size).toBeCloseTo(6)
    expect(short.font).toContain('Be Vietnam Pro')
    expect(short.font).toContain('system-ui')
    const long = fitSign(measure, 'averyveryverylongprojectnamethatcannotfitatall', { w: 66, h: 10 }, 0, 0)
    expect(long.lines).toHaveLength(1)
    expect(long.lines[0]!.endsWith('…')).toBe(true)
    expect(measure(long.font, long.lines[0]!)).toBeLessThanOrEqual(60)
    expect(long.size).toBeCloseTo(5)
  })

  it('clock hands are smooth round-capped lines scaled to the face', () => {
    const calls: { op: string; args: number[]; lineCap?: string; lineWidth?: number; strokeStyle?: string }[] = []
    const state: Record<string, unknown> = {}
    const ctx = new Proxy({} as CanvasRenderingContext2D, {
      get: (_t, p: string) => (p in state ? state[p] : (...args: number[]) => calls.push({ op: p, args, lineCap: state.lineCap as string, lineWidth: state.lineWidth as number, strokeStyle: state.strokeStyle as string })),
      set: (_t, p: string, v) => ((state[p] = v), true),
    })
    drawClockHands(ctx, { x: 10, y: 20, w: 8, h: 8 }, new Date(2026, 9, 22, 3, 0, 0), { x: 2, y: 1.5 })
    expect(calls.filter((c) => c.op === 'fillRect')).toHaveLength(0)
    const strokes = calls.filter((c) => c.op === 'stroke')
    expect(strokes).toHaveLength(3)
    expect(strokes.every((c) => c.lineCap === 'round')).toBe(true)
    expect(strokes[0]!.strokeStyle).toBe(strokes[1]!.strokeStyle)
    expect(calls.find((c) => c.op === 'translate')!.args).toEqual([14, 24])
    expect(calls.find((c) => c.op === 'scale')!.args).toEqual([0.5, 1 / 1.5])
    const lines = calls.filter((c) => c.op === 'lineTo')
    const r = Math.min(8 * 2, 8 * 1.5) / 2
    expect(lines[0]!.args[0]).toBeCloseTo(r * 0.5)
    expect(lines[0]!.args[1]).toBeCloseTo(0)
    expect(lines[1]!.args[0]).toBeCloseTo(0)
    expect(lines[1]!.args[1]).toBeCloseTo(-r * 0.76)
  })
})

describe('iso camera, signs and text', () => {
  it('caps the zoom so a character stays within a quarter of the view height', () => {
    const z = isoMaxZoom({ w: 1280, h: 800 })
    expect(CHAR_STAND_VIEW * z).toBeCloseTo(800 * MAX_CHAR_VIEW_FRAC)
    expect(isoMaxZoom({ w: 1920, h: 1200 })).toBeGreaterThan(z)
    expect(isoMaxZoom({ w: 400, h: 200 })).toBe(MIN_MAX_ZOOM)
  })

  it('common areas get a north wall sign on a clear stretch of their face wall', () => {
    for (const layout of [layoutCafe(), layoutLounge(), layoutRestroom()]) {
      const sign = coreSignOf({ id: layout.id, layout })!
      expect(sign, layout.id).not.toBeNull()
      expect(sign.kind).toBe('sign')
      expect(sign.on).toBe('face')
      expect(sign.baseY).toBe((layout.rect.y + 2) * 16)
      const face = layout.walls.filter((w) => w.kind === 'face')
      expect(face.some((w) => sign.cx - 13 >= w.x && sign.cx + 13 <= w.x + w.w), layout.id).toBe(true)
      const items = layout.wallItems.map((it) => toWallVis(it, layout.id))
      const cleared = items.filter((it) => signClears(sign, it))
      expect(cleared.length, layout.id).toBeLessThanOrEqual(1)
      expect(cleared.every((it) => it.kind === 'clock' || it.kind === 'painting'), layout.id).toBe(true)
      expect(items.filter((it) => it.kind === 'mirror' || it.kind === 'window' || it.kind === 'tv').some((it) => signClears(sign, it))).toBe(false)
    }
    const rec = layoutReception()
    expect(coreSignOf({ id: rec.id, layout: rec })).toBeNull()
  })

  it('sign text leaves room for diacritics', () => {
    const measure = (font: string, t: string) => Number(/(\d+(?:\.\d+)?)px/.exec(font)![1]) * 0.6 * t.length
    const fit = fitSign(measure, 'Nhà vệ sinh', { w: 206, h: 10 }, 0, 0)
    expect(fit.lines).toEqual(['Nhà vệ sinh'])
    expect(fit.size * 1.25).toBeLessThanOrEqual(10)
  })
})

const ROOT_EXTRAS = { version: 1, scale: 2, chars: 'chars/manifest.json', furniture: 'furniture/manifest.json', surfaces: 'surfaces/manifest.json', wallArt: 'wallart/manifest.json', seasonal: 'seasonal/manifest.json', icons: 'icons/manifest.json' }

function seasonalFiles(items: Record<string, unknown>, icons: Record<string, unknown>): Record<string, unknown> {
  return {
    '/assets/iso3d/manifest.json': ROOT_EXTRAS,
    '/assets/iso3d/seasonal/manifest.json': { version: 1, scale: 2, items },
    '/assets/iso3d/icons/manifest.json': { version: 1, scale: 2, items: icons },
  }
}

const SEASONAL_ITEMS = {
  tree: { file: 'tree.webp', anchor: [2, 109], footprint: [1, 1], wall: false },
  gift: { file: 'gift.webp', anchor: [2, 50], footprint: [1, 1], wall: false },
  pumpkin: { file: 'pumpkin.webp', anchor: [2, 56], footprint: [1, 1], wall: false },
  ghost: { file: 'ghost.webp', anchor: [2, 78], footprint: [1, 1], wall: false },
  wreath: { file: 'wreath.webp', anchor: [25, 90], footprint: [1, 0], wall: true },
  bat: { file: 'bat.webp', anchor: [35, 81], footprint: [1, 0], wall: true },
}

const ICON_ITEMS = {
  hourglass: { file: 'hourglass.webp', size: [32, 36], anchor: [16, 36] },
  hourglass_flip: { file: 'hourglass_flip.webp', size: [36, 32], anchor: [18, 32] },
  alert: { file: 'alert.webp', size: [36, 34], anchor: [18, 34] },
}

describe('IsoRenderer seasonal decor and 3D head icons', () => {
  async function run(extra: Record<string, unknown>, theme: 'christmas' | 'halloween', shell = false) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    const env = setup()
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { load, images } = fakeArt(extra)
    const art = await load()
    const canvas = makeCanvas(env.main, { clientWidth: 1280, clientHeight: 800 })
    let made: IsoRenderer | null = null
    const world = createWorld(canvas, store(), { projection: isoProjection, renderer: (c, a, s, cam) => (made = new IsoRenderer(c, a, s, cam, isoProjection, art)) })
    await Promise.resolve()
    world.setOptions({ theme })
    if (shell) world.debug.spawnSession({ project: 'shells', subs: 0, shell: { label: 'npm test', ageMinutes: 25, count: 2 } })
    for (let i = 0; i < 3; i++) world.debug.spawnSession({ project: `s${i}`, subs: 2 })
    let ts = 1000
    for (let i = 0; i < 300; i++) {
      ts += 1000 / 60
      vi.setSystemTime(T0 + ts)
      env.frames.shift()?.(ts)
      if (i === 200) world.overview()
    }
    expect(errors).not.toHaveBeenCalled()
    const src = (u: string) => images.get(`/assets/iso3d/${u}`)?.src
    return { world, ren: made as unknown as IsoRenderer, drawn: env.main.drawn, src }
  }

  it('Christmas: plants become the tree and gifts, the elevator gets a wreath, depth-sorted like furniture', async () => {
    const { world, ren, drawn, src } = await run(seasonalFiles(SEASONAL_ITEMS, ICON_ITEMS), 'christmas')
    expect(drawn.has(src('seasonal/tree.webp')) || drawn.has(src('seasonal/gift.webp'))).toBe(true)
    expect(drawn.has(src('seasonal/wreath.webp'))).toBe(true)
    expect(drawn.has(src('seasonal/pumpkin.webp'))).toBe(false)
    const statics = (ren as unknown as { statics: { kind: string; furn?: { kind: string }; sprite?: { key: string } | null }[] }).statics
    const decor = statics.filter((e) => e.kind === 'furn' && (e.sprite?.key === 'tree' || e.sprite?.key === 'gift'))
    expect(decor.length).toBeGreaterThan(0)
    expect(decor.every((e) => e.furn!.kind === 'plant_tall' || e.furn!.kind === 'plant_small')).toBe(true)
    world.destroy()
  }, 60_000)

  it('Halloween: pumpkins / ghosts and bats on the wall and the elevator', async () => {
    const { world, ren, drawn, src } = await run(seasonalFiles(SEASONAL_ITEMS, ICON_ITEMS), 'halloween')
    expect(drawn.has(src('seasonal/pumpkin.webp')) || drawn.has(src('seasonal/ghost.webp'))).toBe(true)
    expect(drawn.has(src('seasonal/bat.webp'))).toBe(true)
    expect(drawn.has(src('seasonal/tree.webp'))).toBe(false)
    const ents = (ren as unknown as { statics: { kind: string; area?: unknown; box: never; screen: never; draw: never; sprite?: { key: string } | null }[] }).statics.filter((e) => e.kind === 'furn')
    const props = ents.filter((e) => e.sprite?.key === 'ghost' || e.sprite?.key === 'pumpkin')
    expect(props.length).toBeGreaterThan(0)
    for (const e of props) expect(seasonalCover(e, ents.filter((o) => o.area === e.area))).toBeLessThanOrEqual(SEASONAL_COVER_MAX)
    world.destroy()
  }, 60_000)

  it('a missing seasonal item or image draws nothing for it and keeps the plant; nothing crashes', async () => {
    const items = { tree: SEASONAL_ITEMS.tree, gift: { ...SEASONAL_ITEMS.gift, file: 'missing-gift.webp' } }
    const { world, ren, drawn, src } = await run(seasonalFiles(items, {}), 'christmas')
    expect(drawn.has(src('seasonal/wreath.webp'))).toBe(false)
    const statics = (ren as unknown as { statics: { kind: string; furn?: { kind: string }; sprite?: { key: string } | null }[] }).statics
    const small = statics.filter((e) => e.kind === 'furn' && e.furn!.kind === 'plant_small')
    expect(small.every((e) => e.sprite?.key !== 'gift')).toBe(true)
    world.destroy()
  }, 60_000)

  it('head icons come from the 3D icon art, with a vector fallback for simple icons and no seasonal art at all', async () => {
    const withArt = await run(seasonalFiles({}, ICON_ITEMS), 'christmas', true)
    expect(withArt.drawn.has(withArt.src('icons/hourglass.webp')) || withArt.drawn.has(withArt.src('icons/hourglass_flip.webp'))).toBe(true)
    withArt.world.destroy()
    vi.unstubAllGlobals()
    const proto = IsoRenderer.prototype as unknown as Record<string, () => unknown>
    const pixel = vi.spyOn(proto, 'icon')
    const pushed = vi.spyOn(proto, 'pushIcon')
    const heads = vi.spyOn(proto, 'drawHeadIcon')
    const vector = await run({}, 'christmas', true)
    expect(pushed.mock.calls.some((c) => String((c as unknown[])[2]).startsWith('hourglass'))).toBe(true)
    expect(heads).toHaveBeenCalled()
    expect(vector.drawn.has(vector.src('icons/hourglass.webp'))).toBe(false)
    expect(pixel.mock.calls.some((c) => String((c as unknown[])[0]).startsWith('hourglass'))).toBe(false)
    vector.world.destroy()
  }, 60_000)
})

describe('IsoRenderer warm-up and progressive reveal', () => {
  async function populated() {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(T0)
    const env = setup()
    const canvas = makeCanvas(env.main, { clientWidth: 1280, clientHeight: 800, width: 1280, height: 800 })
    const factory = vi.fn(createIsoRenderer)
    const world = createWorld(canvas, store(), { projection: isoProjection, renderer: factory })
    await Promise.resolve()
    for (let i = 0; i < 6; i++) world.debug.spawnSession({ project: `p${i}`, subs: 2 })
    let ts = 1000
    for (let i = 0; i < 240; i++) {
      ts += 1000 / 60
      vi.setSystemTime(T0 + ts)
      env.frames.shift()?.(ts)
    }
    const sim = world.debug.sim
    const total = sim.building.core.length + 1 + [...sim.rooms.values()].filter((r) => r.present).length
    return { env, world, sim, total }
  }

  function fresh(sim: ReturnType<typeof createWorld>['debug']['sim']) {
    const env = { ops: 0 }
    const canvas = makeCanvas(env, { clientWidth: 1280, clientHeight: 800, width: 1280, height: 800 })
    const cam = new Camera()
    cam.setView(1280, 800, 1)
    cam.zoom = 0.3
    const r = new IsoRenderer(canvas, artModule, sim, cam, isoProjection, null)
    const b = r.view.bounds({ x: 0, y: 0, w: sim.building.cols * COL_W * 16, h: BUILDING_H * 16 }, WALL_H)
    const c = cam.centerFor(b.x + b.w / 2, b.y + b.h / 2, cam.zoom)
    cam.x = c.x
    cam.y = c.y
    return r
  }

  const OPTS = { ...DEFAULT_WORLD_OPTIONS }
  const SEL = { agent: null, room: null, hover: null }

  it('builds the corridor first, then the nearest visible rooms, within the budget per frame', async () => {
    const { world, sim, total } = await populated()
    expect(total).toBeGreaterThan(8)
    const r = fresh(sim)
    let t = 0
    vi.spyOn(performance, 'now').mockImplementation(() => (t += 3))
    const order: string[] = []
    const sched = vi.spyOn(IsoReveal.prototype, 'schedule')
    sched.mockImplementation(function (this: IsoReveal, id: string) {
      order.push(id)
      return realSchedule.call(this, id)
    })
    r.warmUp(8, false)
    const built: number[] = []
    const known = () => r.areas.size + (r as unknown as { staged: Map<string, unknown> }).staged.size
    for (let i = 0; i < 60 && r.warming; i++) {
      const before = known()
      r.sync()
      built.push(known() - before)
      r.frame(T0, 1 / 60, OPTS, SEL)
    }
    expect(r.warming).toBe(false)
    expect(known()).toBe(total)
    expect(built[0]).toBe(1)
    expect(order[0]).toBe(sim.building.corridor.id)
    for (const n of built) expect(n).toBeLessThanOrEqual(3)
    for (const n of built.slice(0, -1)) expect(n).toBeGreaterThan(0)
    const cands = order.slice(1).map((id) => {
      const lay = id.startsWith('core:') ? sim.building.core.find((a) => a.id === id)! : sim.rooms.get(id)!.layout
      const rc = lay.rect
      const bx = r.view.bounds({ x: rc.x * 16, y: rc.y * 16, w: rc.w * 16, h: rc.h * 16 }, WALL_H)
      return { id, box: { x0: bx.x, y0: bx.y, x1: bx.x + bx.w, y1: bx.y + bx.h } }
    })
    const view = (r as unknown as { viewBox(): { x0: number; y0: number; x1: number; y1: number } }).viewBox()
    expect(order[1]).toBe(revealOrder(cands, view)[0]!.id)
    world.destroy()
  }, 60_000)

  it('shows the shell first, stages later rooms, fades characters in last, then drops the reveal', async () => {
    const { world, sim, total } = await populated()
    const r = fresh(sim)
    let t = 0
    let auto = 1
    vi.spyOn(performance, 'now').mockImplementation(() => (t += auto))
    r.warmUp(8, false)
    expect(r.settled()).toBe(false)
    r.sync()
    r.frame(T0, 1 / 60, OPTS, SEL)
    expect([...r.areas.keys()]).toEqual([sim.building.corridor.id])
    expect(r.settled()).toBe(false)
    const heads = () => [...r.heads.values()].filter((h) => h.visible).length
    const staged = (r as unknown as { staged: Map<string, unknown> }).staged
    let shellAt = -1
    let sawStaged = false
    for (let i = 0; i < 60 && r.warming; i++) {
      r.sync()
      if (staged.size) {
        sawStaged = true
        for (const id of staged.keys()) {
          expect(r.areas.has(id)).toBe(false)
          expect(r.revealAlpha(id)).toBe(0)
        }
      }
      r.frame(T0, 1 / 60, OPTS, SEL)
      if (shellAt < 0 && r.settled()) shellAt = i
      expect(heads()).toBe(0)
    }
    expect(shellAt).toBeGreaterThanOrEqual(0)
    expect(sawStaged).toBe(true)
    auto = 0
    for (let i = 0; i < 200 && r.revealing; i++) {
      t += 16
      r.sync()
      r.frame(T0, 1 / 60, OPTS, SEL)
    }
    expect(r.revealing).toBe(false)
    expect(r.areas.size).toBe(total)
    expect(staged.size).toBe(0)
    expect(heads()).toBeGreaterThan(0)
    for (const id of r.areas.keys()) expect(r.revealAlpha(id)).toBe(1)
    world.destroy()
  }, 60_000)

  it('reduced motion: no reveal, settled only once everything is built', async () => {
    const { world, sim, total } = await populated()
    const r = fresh(sim)
    let t = 0
    vi.spyOn(performance, 'now').mockImplementation(() => (t += 3))
    r.warmUp(8, true)
    expect(r.revealing).toBe(false)
    let steps = 0
    while (!r.settled() && steps < 60) {
      r.sync()
      r.frame(T0, 1 / 60, OPTS, SEL)
      steps++
      if (!r.settled()) expect(r.areas.size).toBeLessThan(total)
    }
    expect(steps).toBeGreaterThan(1)
    expect(r.areas.size).toBe(total)
    for (const id of r.areas.keys()) expect(r.revealAlpha(id)).toBe(1)
    world.destroy()
  }, 60_000)

  it('without warmUp a fresh renderer builds every area in its first sync', async () => {
    const { world, sim, total } = await populated()
    const r = fresh(sim)
    r.sync()
    expect(r.areas.size).toBe(total)
    expect(r.settled()).toBe(true)
    world.destroy()
  }, 60_000)
})
