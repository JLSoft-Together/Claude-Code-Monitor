import { FURNITURE, TILE, type ArtModule, type CharacterFrameRequest, type FurnitureKind, type IconName, type ScreenMode, type Sprite, type WallStyle } from '@ccm/habblaud/client/src/art/api'
import type { SeasonalTheme, ViewRect, WorldOptions, WorldRenderer } from '@ccm/habblaud/client/src/world'
import type { WorldAssets } from '@ccm/habblaud/client/src/world/assets'
import type { Camera } from '@ccm/habblaud/client/src/world/camera'
import { BUILDING_H, COL_W, CORE_COLS, FOOT_DY } from '@ccm/habblaud/client/src/world/constants'
import { slotShell, type SlotShell } from '@ccm/habblaud/client/src/world/layout/exterior'
import { slotAt } from '@ccm/habblaud/client/src/world/layout/geometry'
import type { FurniturePlacement } from '@ccm/habblaud/client/src/world/layout/types'
import { buildAnim, furnitureScale, NO_ANIM, sweepDelay } from '@ccm/habblaud/client/src/world/render/anim'
import { TEXT_REF, textMetrics } from '@ccm/habblaud/client/src/world/render/overlay'
import { daylightModeOf, mixRgb, parseHourParam, sunbeamAt } from '@ccm/habblaud/client/src/world/render/daylight'
import { fxFade, reducedMotion, RoomFxRenderer } from '@ccm/habblaud/client/src/world/render/github-fx'
import { Lighting } from '@ccm/habblaud/client/src/world/render/lighting'
import { glowSprite, shadowSprite } from '@ccm/habblaud/client/src/world/render/props'
import type { HeadInfo } from '@ccm/habblaud/client/src/world/render/renderer'
import { buildAreaVis, opaqueBounds, pickWallArt, toWallVis, WALL_MARGIN, wallItemOrigin, wallSprites, type AreaVis, type FurnVis, type WallVis } from '@ccm/habblaud/client/src/world/render/scene'
import { drawSeasonalWindow, seasonalElevatorProp, seasonalFurnitureProp, seasonalRugColor, seasonalWallBat, seasonalWallStyle } from '@ccm/habblaud/client/src/world/render/seasonal'
import { countBadge, fallbackIcon } from '@ccm/habblaud/client/src/world/render/shell-sprites'
import { screenModeFor } from '@ccm/habblaud/client/src/world/sim/behavior'
import type { Character } from '@ccm/habblaud/client/src/world/sim/character'
import type { RoomState } from '@ccm/habblaud/client/src/world/sim/room-state'
import { cobwebScale, HOURGLASS_FLIP_MS, hourglassIcon, STORM_LIFT } from '@ccm/habblaud/client/src/world/sim/shell'
import type { Sim } from '@ccm/habblaud/client/src/world/sim/sim'
import { tr } from '@ccm/habblaud/shared/i18n'
import { archetypeFor, archetypesOf, type Archetype } from './archetypes'
import { frozen, snapshot } from './bitmap'
import { CharFrames } from './charFrames'
import { insertRank, topoSort, type DepthBox, type ScreenBox } from './depth'
import { BEACON_INSET, BEACON_SPIN_MS, BALL_R, cobwebSide, drawBang, drawBeacon, drawCobweb, drawPopcornBucket, pingPongBall, PING_TABLE_H, softGlow, WEB_SIZE } from './effects'
import { furnitureArt, iconArt, isoArt, loadedIsoArt, pickIsoWallArt, seasonalArt, wallItemArt, type Box4, type CharArchetypeDef, type CharArt, type FurnArt, type IsoArt, type IsoImage, type Pt, type SeasonalArt, type SurfaceArt } from './isoArt'
import { BULB, BULB_GLOW_RGB, bulbSpots, drawCornerWebs, drawGarland, garlandSpan } from './seasonal'
import { drawVectorIcon, HELD_ICON_VIEW, HEAD_ICON_VIEW, iconViewRect, VECTOR_ICONS } from './icons'
import { loadIsoFonts } from './fonts'
import { beamSprite, floorRect, IsoLight } from './light'
import { frameOps, type DrawOp } from './order'
import { IsoParticles } from './particles'
import { animFits, bobOffset, frameIndex, pickAnim } from './poses'
import { isoProjection, WALL_H, WALL_HK, type IsoView } from './projection'
import { AlphaContext, BuildBudget, CHAR_SHOWN, IsoReveal, revealOrder, type RevealCandidate } from './reveal'
import { LiveScreens, type LivePaint } from './screens'
import { fitSign, nineSlice, SIGN_PAD_X, SIGN_STRETCH_MAX, signLineYs, signSpare, type SignFit, type Span } from './sign'
import { coversPoint, wallPieces, XRAY_ALPHA, type FacePiece, type WallPiece } from './walls'

const HI_SHEET_AT = 1.15

type Sel = { agent: string | null; room: string | null; hover: string | null }

interface StaticBase {
  box: DepthBox
  screen: ScreenBox
  rank: number
  area: AreaVis | null
}

export interface ImgRect {
  x: number
  y: number
  w: number
  h: number
}

interface FurnEnt extends StaticBase {
  kind: 'furn'
  furn: FurnVis
  height: number
  color: string
  sprite: FurnArt | null
  draw: ImgRect | null
  pivot: { x: number; y: number }
  pl: FurniturePlacement
  footH: number
  alt?: FurnLook | null
}

interface FurnLook {
  sprite: FurnArt | null
  draw: ImgRect | null
}

interface WallEnt extends StaticBase {
  kind: 'wall'
  piece: WallPiece
  slot: number | null
  canvas: HTMLCanvasElement | null
  windows: WallVis[]
  style: WallStyle
  items: WallVis[]
}

type StaticEnt = FurnEnt | WallEnt

interface CharEnt {
  ch: Character
  pos: number
  gx: number
  gy: number
  fx: number
  fy: number
}

const FURN_H: Partial<Record<FurnitureKind, number>> = {
  desk: 12,
  desk_back: 12,
  office_chair: 6,
  office_chair_front: 6,
  bookshelf: 30,
  filing_cabinet: 18,
  printer: 12,
  trash_bin: 6,
  plant_small: 10,
  plant_tall: 26,
  glass_partition: 30,
  binder_shelf: 24,
  meeting_table: 12,
  stool: 7,
  floor_lamp: 30,
  water_cooler: 22,
  counter: 14,
  counter_sink: 14,
  coffee_machine: 20,
  microwave: 18,
  fridge: 32,
  vending_machine: 34,
  cafe_table: 11,
  cafe_chair: 7,
  sofa: 10,
  armchair: 10,
  coffee_table: 7,
  pingpong_table: 12,
  beanbag: 7,
  arcade: 30,
  toilet_stall: 34,
  sink: 14,
  reception_desk: 16,
  bench: 7,
}

const FURN_COLOR: Partial<Record<FurnitureKind, string>> = {
  desk: '#c49a6c',
  desk_back: '#c49a6c',
  meeting_table: '#b88a5c',
  reception_desk: '#d8cbb4',
  office_chair: '#4a5568',
  office_chair_front: '#4a5568',
  stool: '#6b7280',
  cafe_chair: '#8b6f4e',
  bookshelf: '#8a5a3c',
  binder_shelf: '#7d6a55',
  filing_cabinet: '#9aa3ad',
  printer: '#d4d8dd',
  trash_bin: '#5f6b75',
  plant_small: '#5aa36a',
  plant_tall: '#3f8a52',
  glass_partition: '#a9d4e6',
  floor_lamp: '#e8d9a8',
  water_cooler: '#9cc8e8',
  counter: '#e2ddd3',
  counter_sink: '#cfd8dc',
  coffee_machine: '#3b3b3b',
  microwave: '#bfc5ca',
  fridge: '#e9edf0',
  vending_machine: '#d25b4f',
  cafe_table: '#a07a52',
  sofa: '#6f8fb3',
  armchair: '#8aa77a',
  coffee_table: '#9b7653',
  pingpong_table: '#2f7a5a',
  beanbag: '#d07a5a',
  arcade: '#5b4b9a',
  toilet_stall: '#c7ccd3',
  sink: '#dfe4e8',
  bench: '#9b7653',
}

const TV_MODES: ScreenMode[] = ['browser', 'idle', 'chat', 'code']
const FACE_SRC_H = 2 * TILE + WALL_MARGIN
export const CHAR_STAND_VIEW = 58
export const MAX_CHAR_VIEW_FRAC = 0.25
export const MIN_MAX_ZOOM = 1.5
export const SEAT_LIFT_MAX = 12
const PLACEHOLDER_STAND = 44
const RING_R = 12
const PLACEHOLDER_RING_R = 9
const COFFEE_ICON_K = 0.78
const WALL_ART_MID = 18
const RUG_BORDER = 0.11
const RUG_WORLD_PER_PX = TILE / 64
const SIGN_INK = '#3a3128'
const SIGN_GROW_H = 0.8
const SIGN_SLIDE = 12
const CLOCK_INK = '#2b2f3b'
export const WALL_RISE = 0.3
const SEL_FILL = 'rgba(127,227,255,0.16)'
const WEB_MAX_OUT = 12
const NEIGHBOR_DX = 2.2 * 2 * TILE
const NEIGHBOR_DY = 14
const POPCORN_K = 0.9
const CONFETTI_RATE = 42
const CONFETTI_DROP = WALL_H * 0.95
const MONITOR_GLOW = 64
const MACHINE_GLOW = 60
const BULB_GLOW = 36
const TV_GLOW = 84
const HUGE_VIEW = { x0: -1e9, y0: -1e9, x1: 1e9, y1: 1e9 }
const COOL: readonly [number, number, number] = [127, 184, 255]
const ALARM_RED: readonly [number, number, number] = [255, 36, 48]
const PLACEHOLDER_CHAR = { hw: 12, top: 34 }
export const RECEPTION_SIGN = 'Orrery'
export const CORE_SIGNS: Readonly<Record<string, { cx: number; name: string }>> = {
  'core:banheiros': { cx: 6.1, name: 'Banheiros' },
  'core:copa': { cx: 8, name: 'Copa' },
  'core:lounge': { cx: 1.9, name: 'Lounge' },
}
const CORE_SIGN_CLEAR = 1.25

export function isoMaxZoom(view: { w: number; h: number }): number {
  return Math.max(MIN_MAX_ZOOM, (view.h * MAX_CHAR_VIEW_FRAC) / CHAR_STAND_VIEW)
}

export function coreSignOf(vis: Pick<AreaVis, 'id' | 'layout'>): WallVis | null {
  const def = CORE_SIGNS[vis.id]
  if (!def) return null
  const r = vis.layout.rect
  return toWallVis({ id: `${vis.id}#iso-sign`, kind: 'sign', cx: Math.round((r.x + def.cx) * TILE), baseY: (r.y + 2) * TILE, on: 'face', order: 0.95 }, vis.id)
}

export function signClears(sign: WallVis, it: WallVis): boolean {
  return it.id !== sign.id && it.kind !== 'door_frame' && it.on === sign.on && it.baseY === sign.baseY && Math.abs(it.cx - sign.cx) < CORE_SIGN_CLEAR * TILE
}

function shade(hex: string, k: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1]!, 16)
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))))
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`
}

const LIGHT_BG = '#ececee'
const DARK_BG = '#1e1e1e'

function screenOf(view: IsoView, box: DepthBox, h: number): ScreenBox {
  const b = view.bounds({ x: box.minX, y: box.minY, w: box.maxX - box.minX, h: box.maxY - box.minY }, h)
  return { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h }
}

function hexOk(c: string | null | undefined): c is string {
  return !!c && /^#[0-9a-f]{6}$/i.test(c)
}

export function charViewScale(chars: Pick<CharArt, 'viewScale' | 'anchors' | 'standH'>): number {
  if (chars.viewScale) return chars.viewScale
  const d = chars.standH ?? chars.anchors.feet[1] - chars.anchors.head[1]
  return d > 0 ? CHAR_STAND_VIEW / d : 0.15
}

export function furnitureDrawRect(view: IsoView, sprite: Pick<FurnArt, 'anchor' | 'scale' | 'img'>, pl: { tx: number; ty: number; dx?: number; dy?: number }, footH: number): ImgRect & { ax: number; ay: number } {
  const a = view.toView(pl.tx * TILE + (pl.dx ?? 0), (pl.ty + footH) * TILE + (pl.dy ?? 0))
  const k = 1 / sprite.scale
  return { x: a.x - sprite.anchor[0] * k, y: a.y - sprite.anchor[1] * k, w: sprite.img.w * k, h: sprite.img.h * k, ax: a.x, ay: a.y }
}

export interface SlicePart {
  sx: number
  sy: number
  sw: number
  sh: number
  dx: number
  dy: number
  dw: number
  dh: number
}

export function seasonalPlacement(pl: { tx: number; ty: number; dx?: number; dy?: number }, fp: { w: number; h: number }, item: Pt | null): { tx: number; ty: number; dx?: number; dy?: number } {
  const w = item ? item[0] : fp.w
  return { tx: pl.tx + (fp.w - w) / 2, ty: pl.ty, dx: pl.dx, dy: pl.dy }
}

export const SEASONAL_COVER_MAX = 0.3

export function seasonalCover(prop: { box: DepthBox; draw: ImgRect | null }, others: readonly { box: DepthBox; screen: ScreenBox }[]): number {
  const d = prop.draw
  if (!d || d.w <= 0 || d.h <= 0) return 0
  let worst = 0
  for (const o of others) {
    if (o.box === prop.box || o.box.minY <= prop.box.maxY) continue
    const w = Math.min(d.x + d.w, o.screen.x1) - Math.max(d.x, o.screen.x0)
    const h = Math.min(d.y + d.h, o.screen.y1) - Math.max(d.y, o.screen.y0)
    if (w > 0 && h > 0) worst = Math.max(worst, (w * h) / (d.w * d.h))
  }
  return worst
}

export function rugSlices(img: { w: number; h: number }, r: ImgRect): SlicePart[] {
  const src = Math.max(1, Math.round(Math.min(img.w, img.h) * RUG_BORDER))
  const dst = Math.min(src * RUG_WORLD_PER_PX, Math.min(r.w, r.h) / 3)
  const sxs = [0, src, img.w - src, img.w]
  const sys = [0, src, img.h - src, img.h]
  const dxs = [r.x, r.x + dst, r.x + r.w - dst, r.x + r.w]
  const dys = [r.y, r.y + dst, r.y + r.h - dst, r.y + r.h]
  const out: SlicePart[] = []
  for (let j = 0; j < 3; j++) {
    for (let i = 0; i < 3; i++) {
      const sw = sxs[i + 1]! - sxs[i]!
      const sh = sys[j + 1]! - sys[j]!
      const dw = dxs[i + 1]! - dxs[i]!
      const dh = dys[j + 1]! - dys[j]!
      if (sw > 0 && sh > 0 && dw > 0 && dh > 0) out.push({ sx: sxs[i]!, sy: sys[j]!, sw, sh, dx: dxs[i]!, dy: dys[j]!, dw, dh })
    }
  }
  return out
}

export function drawClockHands(ctx: CanvasRenderingContext2D, face: ImgRect, date: Date, unit: { x: number; y: number }): void {
  const r = Math.min(face.w * unit.x, face.h * unit.y) / 2
  if (!(r > 0)) return
  const sec = date.getSeconds()
  const min = date.getMinutes() + sec / 60
  const hr = (date.getHours() % 12) + min / 60
  ctx.save()
  ctx.translate(face.x + face.w / 2, face.y + face.h / 2)
  ctx.scale(1 / unit.x, 1 / unit.y)
  ctx.lineCap = 'round'
  const hand = (turn: number, len: number, width: number, color: string) => {
    const a = turn * Math.PI * 2
    const dx = Math.sin(a)
    const dy = -Math.cos(a)
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.beginPath()
    ctx.moveTo(-dx * len * 0.14, -dy * len * 0.14)
    ctx.lineTo(dx * len, dy * len)
    ctx.stroke()
  }
  hand(hr / 12, r * 0.5, Math.max(0.5, r * 0.13), CLOCK_INK)
  hand(min / 60, r * 0.76, Math.max(0.4, r * 0.09), CLOCK_INK)
  hand(sec / 60, r * 0.8, Math.max(0.25, r * 0.04), 'rgba(205,72,64,0.9)')
  ctx.fillStyle = CLOCK_INK
  ctx.beginPath()
  ctx.arc(0, 0, Math.max(0.4, r * 0.08), 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export function wallLocalScale(view: IsoView, scale: number): { sx: number; sy: number } {
  const len = Math.hypot(view.ax.x, view.ax.y) || 1
  return { sx: 1 / (scale * len), sy: 1 / (scale * WALL_HK) }
}

export const WARM_BUDGET_MAX = 12

interface WarmItem {
  id: string
  layout: AreaVis['layout']
  room: RoomState | undefined
}

export class IsoRenderer implements WorldRenderer {
  private readonly realCtx: CanvasRenderingContext2D
  private alphaCtx: AlphaContext | null = null
  private scoped = false
  private layerCtx: CanvasRenderingContext2D | null = null
  private floorLayer: HTMLCanvasElement | null = null
  private floorBitmap: ImageBitmap | null = null
  private floorLayerKey = ''
  private floorCandidate = ''
  private floorVersion = 0
  private iconK = 1
  private reveal: IsoReveal | null = null
  private budget: BuildBudget | null = null
  private staged = new Map<string, AreaVis>()
  private warmSteps = 0
  private warmPending = false
  lastWarmBuilt = 0
  private tintCache = new Map<string, CanvasImageSource>()
  readonly areas = new Map<string, AreaVis>()
  readonly heads = new Map<string, HeadInfo>()
  hourOverride: number | null = parseHourParam(typeof location === 'undefined' ? '' : location.search)
  clock: () => number = () => Date.now()
  readonly lighting: Lighting
  readonly particles = new IsoParticles()
  readonly light: IsoLight
  private readonly live = new LiveScreens()
  private readonly roomFx = new RoomFxRenderer()
  private confettiAcc = new Map<string, number>()
  private signSpareW = new Map<string, number>()
  private areaList: AreaVis[] = []
  assets: WorldAssets | null = null
  night = 0
  private shells: SlotShell[] = []
  private baseCols = -1
  private bg = LIGHT_BG
  private pad = shade(LIGHT_BG, -0.08)
  private halo = shade(LIGHT_BG, -0.04)
  private bgReadAt = -Infinity
  private layoutVersion = -1
  private assetsVersion = 0
  private builtAssetsVersion = 0
  private theme: SeasonalTheme = 'none'
  private occupiedSlots = new Set<number>()
  private statics: StaticEnt[] = []
  private staticsDirty = true
  private furnByArea = new Map<string, Map<string, FurniturePlacement>>()
  private furnEnt = new Map<string, FurnEnt>()
  private chars: CharEnt[] = []
  private charPool: CharEnt[] = []
  private elevatorVis: WallVis[] = []
  private date = new Date()
  private dt = 0
  private devScale = 1
  private readonly frames = new CharFrames()
  private icons: { x: number; y: number; name: IconName; alpha: number; bounce: number; badge: number }[] = []
  private iconCount = 0
  private art3d: IsoArt | null = null
  private artVersion = 0
  private builtArtVersion = 0
  private archList: readonly Archetype[] = archetypesOf(null)
  private archById = new Map<string, CharArchetypeDef>()
  private archOf = new Map<number, string>()
  private patterns = new Map<string, CanvasPattern | null>()
  private charFronts: number[][] = []
  private charPos: number[] = []
  private ops: DrawOp[] = []
  private frontIdx = new Map<FurnEnt, number>()
  private signFits = new Map<string, SignFit>()
  private coreSigns = new Map<string, WallVis>()
  private req: CharacterFrameRequest = {
    appearance: undefined as unknown as CharacterFrameRequest['appearance'],
    dir: 'down',
    pose: 'stand',
    frame: 0,
    held: 'none',
    seated: false,
  }

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly art: ArtModule,
    private readonly sim: Sim,
    private readonly camera: Camera,
    readonly view: IsoView = isoProjection,
    artSource: Promise<IsoArt> | IsoArt | null = null,
  ) {
    this.realCtx = canvas.getContext('2d', { alpha: false })!
    this.lighting = new Lighting(art, sim)
    this.light = new IsoLight(view, sim)
    void loadIsoFonts().then(() => this.signFits.clear())
    if (artSource && 'then' in artSource) void artSource.then((a) => this.setIsoArt(a), () => undefined)
    else if (artSource) this.setIsoArt(artSource)
  }

  get ctx(): CanvasRenderingContext2D {
    return this.layerCtx ?? (this.scoped && this.alphaCtx ? this.alphaCtx.proxy : this.realCtx)
  }

  warmUp(budgetMs: number, reduced: boolean = reducedMotion()): void {
    if (!Number.isFinite(budgetMs) || budgetMs <= 0) return
    this.budget = new BuildBudget(Math.min(budgetMs, WARM_BUDGET_MAX))
    this.reveal = reduced ? null : new IsoReveal(false)
    this.alphaCtx ??= new AlphaContext(this.realCtx)
    this.warmSteps = 0
    this.warmPending = true
  }

  settled(): boolean {
    if (this.reveal) return !this.warmPending || (this.areas.has(this.sim.building.corridor.id) && this.areas.size >= 2)
    return !this.warmPending
  }

  get revealing(): boolean {
    return this.reveal !== null
  }

  get warming(): boolean {
    return this.budget !== null
  }

  revealAlpha(id: string): number {
    const rv = this.reveal
    if (!rv) return 1
    if (this.staged.has(id)) return 0
    return rv.alpha(id)
  }

  setIsoArt(a: IsoArt | null): void {
    this.art3d = a && !a.missing ? a : null
    this.archList = archetypesOf(this.art3d)
    this.archById = new Map((this.art3d?.chars?.archetypes ?? []).map((d) => [d.id, d]))
    this.archOf.clear()
    this.patterns.clear()
    this.tintCache.clear()
    this.frames.clear()
    this.artVersion++
  }

  get isoArtLoaded(): boolean {
    return this.art3d !== null
  }

  setAssets(a: WorldAssets | null): void {
    this.assets = a
    this.assetsVersion++
  }

  sync(theme: SeasonalTheme = 'none'): void {
    const sim = this.sim
    const themeChanged = theme !== this.theme
    this.theme = theme
    const assetsChanged = this.builtAssetsVersion !== this.assetsVersion || themeChanged
    const budget = this.budget
    const missing: WarmItem[] = []
    this.promoteStaged()
    if (this.builtArtVersion !== this.artVersion) {
      this.builtArtVersion = this.artVersion
      this.staticsDirty = true
    }
    if (this.baseCols !== sim.building.cols || assetsChanged) {
      this.buildBase()
      this.staticsDirty = true
    }
    if (this.layoutVersion !== sim.layoutVersion || assetsChanged) {
      this.layoutVersion = sim.layoutVersion
      this.staticsDirty = true
      const want = new Set<string>()
      for (const a of [...sim.building.core, sim.building.corridor]) {
        want.add(a.id)
        const cur = this.areaOf(a.id)
        if (!cur && budget) {
          missing.push({ id: a.id, layout: a, room: undefined })
          continue
        }
        if (!cur || cur.layout !== a || assetsChanged) this.putArea(a.id, buildAreaVis(this.art, a, undefined, this.assets, theme))
      }
      for (const room of sim.rooms.values()) if (room.present) want.add(room.id)
      for (const id of [...this.areas.keys()]) if (!want.has(id)) this.areas.delete(id)
      for (const id of [...this.staged.keys()]) if (!want.has(id)) this.staged.delete(id)
      this.elevatorVis = this.areas.get('core:recepcao')?.wallItems.filter((w) => w.kind === 'elevator') ?? []
    }
    this.occupiedSlots.clear()
    for (const room of sim.rooms.values()) {
      if (!room.present) continue
      this.occupiedSlots.add(room.slot)
      const cur = this.areaOf(room.id)
      if (!cur && budget) {
        missing.push({ id: room.id, layout: room.layout, room })
        continue
      }
      if (!cur || cur.layout !== room.layout || cur.version !== room.version || assetsChanged) {
        this.putArea(room.id, buildAreaVis(this.art, room.layout, room, this.assets, theme))
        this.staticsDirty = true
      } else cur.room = room
    }
    for (const [id, vis] of this.areas) {
      if (vis.room && !vis.room.present) {
        this.areas.delete(id)
        this.staticsDirty = true
      }
    }
    for (const [id, vis] of this.staged) if (vis.room && !vis.room.present) this.staged.delete(id)
    if (budget) this.warmBuild(budget, missing, theme)
    this.builtAssetsVersion = this.assetsVersion
    this.areaList = [...this.areas.values()]
    if (this.staticsDirty) this.buildStatics()
  }

  private areaOf(id: string): AreaVis | undefined {
    return this.areas.get(id) ?? this.staged.get(id)
  }

  private putArea(id: string, vis: AreaVis): void {
    const rv = this.reveal
    if (rv && (this.staged.has(id) || !rv.started(id))) this.staged.set(id, vis)
    else this.areas.set(id, vis)
  }

  private promoteStaged(): void {
    const rv = this.reveal
    if (!rv || !this.staged.size) return
    const now = rv.now()
    for (const [id, vis] of [...this.staged]) {
      if (!rv.started(id, now)) continue
      this.staged.delete(id)
      this.areas.set(id, vis)
      this.staticsDirty = true
      if (id === 'core:recepcao') this.elevatorVis = vis.wallItems.filter((w) => w.kind === 'elevator')
    }
  }

  private viewBox(): ScreenBox {
    const { scale, ox, oy } = this.camera.transform()
    const k = scale || 1
    return { x0: -ox / k, y0: -oy / k, x1: (this.canvas.width - ox) / k, y1: (this.canvas.height - oy) / k }
  }

  private areaBox(layout: AreaVis['layout']): RevealCandidate['box'] {
    const r = layout.rect
    const b = this.view.bounds({ x: r.x * TILE, y: r.y * TILE, w: r.w * TILE, h: r.h * TILE }, WALL_H)
    return { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h }
  }

  private warmBuild(budget: BuildBudget, missing: WarmItem[], theme: SeasonalTheme): void {
    const rv = this.reveal
    budget.begin()
    this.warmSteps++
    const corridorId = this.sim.building.corridor.id
    let list = missing
    if (rv) {
      rv.setExpected(this.areas.size + this.staged.size + missing.length)
      const corridor = missing.filter((m) => m.id === corridorId)
      const rest = missing.filter((m) => m.id !== corridorId)
      list = [...corridor, ...revealOrder(rest.map((m) => ({ ...m, box: this.areaBox(m.layout) })), this.viewBox())]
    }
    let done = 0
    for (const m of list) {
      if (budget.exhausted()) break
      if (rv && this.warmSteps === 1 && done > 0) break
      const vis = buildAreaVis(this.art, m.layout, m.room, this.assets, theme)
      rv?.schedule(m.id)
      this.putArea(m.id, vis)
      this.warmArea(vis)
      this.staticsDirty = true
      budget.spend()
      done++
    }
    this.lastWarmBuilt = done
    if (missing.length) this.layoutVersion = -1
    if (done < list.length) {
      this.warmPending = true
      return
    }
    this.warmPending = false
    this.budget = null
    rv?.finishAreas(this.archList.length)
  }

  private warmArea(vis: AreaVis): void {
    const art = this.art3d
    if (!art) return
    const lay = vis.layout
    for (const f of lay.floors) {
      const s = art.floors.get(f.kind)
      if (!s) continue
      const tint = s.tint ? (hexOk(f.tint) ? f.tint : hexOk(lay.floorTint) ? lay.floorTint : null) : null
      this.pattern('floor', s, tint)
    }
    if (lay.kind !== 'corridor' && art.rugs.length) {
      for (const rug of lay.rugs) this.rugSource(art.rugs[(rug.seed >>> 0) % art.rugs.length]!, seasonalRugColor(this.theme, rug.color))
    }
    for (const w of lay.walls) {
      if (w.kind !== 'face') continue
      const style = seasonalWallStyle(this.theme, w.style)
      const surface = this.wallSurface(style)
      if (surface) this.pattern('wall', surface, surface.tint && hexOk(style.base) ? style.base : null)
    }
  }

  private rugSource(s: SurfaceArt, color: string): CanvasImageSource {
    if (!s.tint || !hexOk(color)) return s.img.src
    const key = `${s.key}|${color}`
    let c = this.tintCache.get(key)
    if (!c) {
      c = frozen(this.tinted(s.img, color))
      this.tintCache.set(key, c)
    }
    return c
  }

  private enterScope(k: number, dy: number): void {
    if (!this.alphaCtx) return
    this.alphaCtx.begin(k, dy)
    this.scoped = true
  }

  private exitScope(): void {
    if (!this.scoped || !this.alphaCtx) return
    this.scoped = false
    this.alphaCtx.end()
  }

  private charGroup(ch: Character): number {
    const def = this.archetypeOf(ch)
    if (!def) return 0
    const i = this.archList.findIndex((a) => a.id === def.id)
    return i < 0 ? 0 : i
  }

  private buildBase(): void {
    const cols = this.sim.building.cols
    this.baseCols = cols
    this.shells = []
    for (let col = CORE_COLS; col < cols; col++) {
      for (const side of ['north', 'south'] as const) this.shells.push(slotShell(slotAt(col, side), col === cols - 1))
    }
  }

  private readTheme(now: number): void {
    if (now - this.bgReadAt < 1000) return
    this.bgReadAt = now
    let bg: string | null = null
    let dark = false
    try {
      const root = document.documentElement
      if (root && typeof getComputedStyle === 'function') {
        dark = root.classList.contains('dark')
        const v = getComputedStyle(root).getPropertyValue('--ccm-canvas').trim()
        if (/^#[0-9a-f]{6}$/i.test(v)) bg = v
      }
    } catch {
      bg = null
    }
    const base = bg ?? (dark ? DARK_BG : LIGHT_BG)
    const n = parseInt(base.slice(1), 16)
    const isDark = ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 < 128
    this.bg = base
    this.pad = shade(base, isDark ? 0.07 : -0.08)
    this.halo = shade(base, isDark ? 0.035 : -0.04)
  }

  private drawPad(): void {
    const { ctx } = this
    const w = this.sim.building.cols * COL_W * TILE
    const h = BUILDING_H * TILE
    ctx.fillStyle = this.halo
    ctx.fillRect(-2 * TILE, -2 * TILE, w + 4 * TILE, h + 4 * TILE)
    ctx.fillStyle = this.pad
    ctx.fillRect(-TILE, -TILE, w + 2 * TILE, h + 2 * TILE)
  }

  private faceCanvas(p: FacePiece, style: Parameters<ArtModule['drawWallFace']>[4]): HTMLCanvasElement | null {
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.ceil(p.x1 - p.x0))
    c.height = FACE_SRC_H
    const ctx = c.getContext('2d')
    if (!ctx) return null
    ctx.imageSmoothingEnabled = false
    ctx.translate(-p.x0, -(p.top - WALL_MARGIN))
    try {
      this.art.drawWallFace(ctx, p.x0, p.top, p.x1 - p.x0, style)
    } catch {
      ctx.fillStyle = style.base
      ctx.fillRect(p.x0, p.top, p.x1 - p.x0, 2 * TILE)
    }
    return c
  }

  private buildStatics(): void {
    this.staticsDirty = false
    this.floorVersion++
    const list: StaticEnt[] = []
    this.furnByArea.clear()
    this.furnEnt.clear()
    this.coreSigns.clear()
    this.signSpareW.clear()
    this.signFits.clear()
    const signArt = wallItemArt(this.art3d, 'sign') !== null
    for (const vis of this.areas.values()) {
      const extra = signArt && !vis.sign ? coreSignOf(vis) : null
      if (extra) this.coreSigns.set(vis.id, extra)
      const byId = new Map<string, FurniturePlacement>()
      for (const f of vis.layout.furniture) byId.set(f.id, f)
      this.furnByArea.set(vis.id, byId)
      const areaEnts: FurnEnt[] = []
      const seasonalEnts: FurnEnt[] = []
      for (const f of vis.furniture) {
        const pl = byId.get(f.id)
        const def = FURNITURE[f.kind]
        if (!pl || !def) continue
        const box = { minX: pl.tx * TILE + 1, minY: pl.ty * TILE + 1, maxX: (pl.tx + def.footprint.w) * TILE - 1, maxY: (pl.ty + def.footprint.h) * TILE - 1 }
        const height = FURN_H[f.kind] ?? 12
        const sea = this.seasonalFloor(vis, f)
        const look = this.furnLook(f, pl, def.footprint, box, height, sea)
        const ent: FurnEnt = { kind: 'furn', furn: f, box, rank: 0, area: vis, height, color: FURN_COLOR[f.kind] ?? '#9aa3ad', ...look, pl, footH: def.footprint.h }
        this.furnEnt.set(f.id, ent)
        list.push(ent)
        areaEnts.push(ent)
        if (sea) seasonalEnts.push(ent)
      }
      for (const e of seasonalEnts) {
        if (seasonalCover(e, areaEnts) <= SEASONAL_COVER_MAX) continue
        Object.assign(e, this.furnLook(e.furn, e.pl, FURNITURE[e.furn.kind].footprint, e.box, e.height, null))
      }
      const dynamicIds = new Set(vis.wallItems.map((w) => w.id))
      if (vis.sign) dynamicIds.add(vis.sign.id)
      const staticItems = vis.layout.wallItems.filter((it) => !dynamicIds.has(it.id)).map((it) => toWallVis(it, vis.id))
      for (const piece of wallPieces(vis.layout.walls)) {
        const items =
          piece.kind === 'face'
            ? [...vis.wallItems, ...staticItems].filter((it) => it.on === 'face' && it.baseY === piece.baseY && it.cx >= piece.x0 && it.cx <= piece.x1 && !(extra && signClears(extra, it))).sort((a, b) => a.order - b.order)
            : []
        const sign = vis.sign ?? extra
        if (piece.kind === 'face' && sign && sign.on === 'face' && sign.baseY === piece.baseY && sign.cx >= piece.x0 && sign.cx <= piece.x1) {
          const span = this.wallSpan(sign)
          if (span) this.signSpareW.set(sign.id, signSpare(span, { x0: piece.x0, x1: piece.x1 }, items.map((it) => this.wallSpan(it)).filter((s): s is Span => !!s)))
        }
        list.push({
          kind: 'wall',
          piece,
          box: piece.box,
          screen: screenOf(this.view, piece.box, piece.height + (piece.kind === 'face' ? WALL_MARGIN : 0)),
          rank: 0,
          area: vis,
          slot: null,
          canvas: null,
          windows: [],
          style: piece.kind === 'face' ? seasonalWallStyle(this.theme, piece.style) : piece.style,
          items,
        })
      }
    }
    for (const sh of this.shells) {
      for (const piece of wallPieces(sh.walls)) {
        const seg = sh.walls.find((w) => w.kind === 'face' && piece.kind === 'face' && w.y === piece.top)
        const canvas = piece.kind === 'face' && seg ? this.faceCanvas(piece, seg.style) : null
        const windows = piece.kind === 'face' ? sh.windows.filter((w) => w.baseY === piece.baseY && w.cx >= piece.x0 && w.cx <= piece.x1).map((w) => toWallVis(w, `shell:${sh.slot}`)) : []
        list.push({ kind: 'wall', piece, box: piece.box, screen: screenOf(this.view, piece.box, piece.height + WALL_MARGIN), rank: 0, area: null, slot: sh.slot, canvas, windows, style: seg?.style ?? piece.style, items: [] })
      }
    }
    const sorted = topoSort(list, this.view.depthW)
    sorted.forEach((e, i) => (e.rank = i))
    this.statics = sorted
    this.frontIdx.clear()
    for (const e of sorted) if (e.kind === 'furn' && e.sprite?.front) this.frontIdx.set(e, e.rank)
  }

  private furnLook(f: FurnVis, pl: FurniturePlacement, fp: { w: number; h: number }, box: DepthBox, height: number, sea: SeasonalArt | null): { sprite: FurnArt | null; draw: ImgRect | null; pivot: { x: number; y: number }; screen: ScreenBox } {
    const sprite: FurnArt | null = sea ?? furnitureArt(this.art3d, f.kind, f.variant)
    const screen = screenOf(this.view, box, height)
    let draw: ImgRect | null = null
    let pivot = this.view.toView((box.minX + box.maxX) / 2, box.maxY)
    if (sprite) {
      const r = furnitureDrawRect(this.view, sprite, sea ? seasonalPlacement(pl, fp, sea.footprint) : pl, fp.h)
      draw = { x: r.x, y: r.y, w: r.w, h: r.h }
      pivot = { x: r.ax, y: r.ay }
      screen.x0 = Math.min(screen.x0, r.x)
      screen.y0 = Math.min(screen.y0, r.y)
      screen.x1 = Math.max(screen.x1, r.x + r.w)
      screen.y1 = Math.max(screen.y1, r.y + r.h)
    }
    return { sprite, draw, pivot, screen }
  }

  private seasonalFloor(vis: AreaVis, f: FurnVis): SeasonalArt | null {
    if (this.theme === 'none' || !this.art3d?.seasonal?.size) return null
    const sp = seasonalArt(this.art3d, seasonalFurnitureProp(this.theme, f.kind, vis.layout, f.seed), this.theme)
    return sp && !sp.wall ? sp : null
  }

  private drawSeasonalOnWall(prop: string | null, cx: number, baseY: number): void {
    const sp = seasonalArt(this.art3d, prop, this.theme)
    if (!sp || !sp.wall) return
    this.blit(sp.img, this.wallRect(sp, cx, baseY))
  }

  private drawSeasonalWallDecor(vis: AreaVis, p: FacePiece): void {
    const theme = this.theme
    if (theme === 'none') return
    for (const seg of vis.layout.walls) {
      if (seg.kind !== 'face' || seg.y !== p.top || seg.x > p.x1 || seg.x + seg.w < p.x0) continue
      const span = garlandSpan(seg, p)
      if (span) drawGarland(this.ctx, theme, seg, span)
      if (theme === 'halloween') drawCornerWebs(this.ctx, seg, p)
      const bat = seasonalWallBat(theme, seg)
      if (bat && bat.cx >= p.x0 && bat.cx <= p.x1) this.drawSeasonalOnWall('bat', bat.cx, p.baseY)
    }
  }

  private drawElevatorDecor(w: WallVis): void {
    if (this.theme !== 'none') this.drawSeasonalOnWall(seasonalElevatorProp(this.theme), w.cx, w.baseY)
  }

  private drawSeasonalLights(now: number, v: ScreenBox): void {
    const theme = this.theme
    if (theme === 'none' || !this.art3d) return
    const glow = softGlow(BULB_GLOW_RGB[theme], 32, 0.9)
    const { ctx } = this
    const k = Math.hypot(this.view.ax.x, this.view.ax.y) || 1
    ctx.save()
    for (const vis of this.areas.values()) {
      if (vis.room && vis.room.phase !== 'ready') continue
      const light = vis.room ? vis.room.light(now) : 1
      if (light <= 0.01) continue
      for (const seg of vis.layout.walls) {
        if (seg.kind !== 'face') continue
        const [a, b, c, d, e, f] = this.view.wallMatrix(seg.y + 2 * TILE)
        for (const s of bulbSpots(seg)) {
          const x = a * s.x + c * s.y + e
          const y = b * s.x + d * s.y + f
          if (x < v.x0 - 20 || x > v.x1 + 20 || y < v.y0 - 20 || y > v.y1 + 20) continue
          if (glow) {
            ctx.globalAlpha = light * 0.3
            ctx.drawImage(glow, x - 16 * k * 0.5, y - 16 * k * 0.5, 16 * k, 16 * k)
          }
          ctx.globalAlpha = light * 0.85
          ctx.fillStyle = BULB[theme]
          ctx.beginPath()
          ctx.arc(x, y, 1.1 * k * 0.5 + 0.4, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }
    ctx.restore()
  }

  frame(now: number, dt: number, opts: WorldOptions, sel: Sel): void {
    const { ctx, camera } = this
    this.date.setTime(this.clock())
    this.dt = dt
    const W = this.canvas.width
    const H = this.canvas.height
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.imageSmoothingEnabled = false
    this.readTheme(now)
    ctx.fillStyle = this.bg
    ctx.fillRect(0, 0, W, H)
    const { scale, ox, oy } = camera.transform()
    this.devScale = scale
    ctx.setTransform(scale, 0, 0, scale, ox, oy)
    const view: ScreenBox = { x0: -ox / scale, y0: -oy / scale, x1: (W - ox) / scale, y1: (H - oy) / scale }
    const inView = (s: ScreenBox) => s.x0 < view.x1 && s.x1 > view.x0 && s.y0 < view.y1 && s.y1 > view.y0

    if (this.hourOverride !== null) {
      const min = Math.round(this.hourOverride * 60)
      this.date.setHours(Math.floor(min / 60) % 24, min % 60)
    }
    const hour = this.lighting.update(now, daylightModeOf(opts), this.hourOverride, this.date)

    const rv = this.reveal
    const rt = rv ? rv.now() : 0
    const layer = rv ? null : this.cachedFloor(W, H, scale, ox, oy, now)
    if (layer) {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.drawImage(layer, 0, 0)
      ctx.setTransform(scale, 0, 0, scale, ox, oy)
    }
    ctx.save()
    ctx.transform(...this.view.ground)
    if (!layer) this.drawFloors(now, rv, rt)
    this.safe(() => this.roomFx.drawFloor(ctx, this.sim, now, HUGE_VIEW))
    ctx.globalAlpha = 1
    ctx.restore()

    this.placeChars(now, view)
    const fades = this.wallFades(sel)
    this.iconCount = 0
    const chars = this.chars
    const statics = this.statics
    const pos = this.charPos
    pos.length = chars.length
    for (let i = 0; i < chars.length; i++) pos[i] = chars[i]!.pos
    const ops = frameOps(statics.length, pos, this.occupancy(), (i) => this.frontIdx.has(statics[i] as FurnEnt), this.ops)
    for (const op of ops) {
      if (op.k === 'char') {
        const e = chars[op.i]!
        const ca = rv ? rv.charAlpha(this.charGroup(e.ch), rt) : 1
        if (ca <= 0) continue
        if (ca < 1) {
          this.enterScope(ca, 0)
          this.iconK = ca
        }
        this.drawCharacter(e, now, sel)
        if (ca < 1) {
          this.iconK = 1
          this.exitScope()
          if (ca < CHAR_SHOWN) this.headOf(e.ch).visible = false
        }
        continue
      }
      const s = statics[op.i]!
      if (!inView(s.screen)) continue
      const ra = rv && s.area ? rv.alpha(s.area.id, rt) : 1
      if (ra <= 0) continue
      if (ra < 1) this.enterScope(ra, -rv!.drop(s.area!.id, rt))
      if (op.k === 'front') this.drawFront(s as FurnEnt, now)
      else if (s.kind === 'furn') this.drawFurniture(s, now)
      else this.drawWall(s, now, hour, fades.get(s) ?? 1)
      if (ra < 1) this.exitScope()
    }

    if (!rv || rv.charAlpha(0, rt) > 0) {
      this.drawPingPong(now)
      this.drawCobwebs(now)
    }
    this.drainEffects(now)
    this.emitRoomFx(now, dt, view)
    this.particles.update(dt)
    this.particles.draw(ctx, view.x0, view.y0, view.x1, view.y1, now)

    this.night = this.lighting.night
    const reduced = reducedMotion()
    this.light.updateOccupancy(this.areas.values(), now, dt, reduced)
    this.safe(() => this.light.draw(ctx, this.lighting.ambient, this.areaList, now))
    this.safe(() => this.drawGlows(now, view))
    this.safe(() => this.drawSeasonalLights(now, view))
    this.safe(() => this.drawAlarmLights(now, view))

    for (let i = 0; i < this.iconCount; i++) this.safe(() => this.drawHeadIcon(this.icons[i]!))
    ctx.globalAlpha = 1
    if (rv && !this.budget && rv.done(rt)) this.reveal = null
  }

  private drawFloors(now: number, rv: IsoReveal | null, rt: number): void {
    const { ctx } = this
    this.drawPad()
    for (const vis of this.areas.values()) {
      const anim = vis.room ? buildAnim(vis.room.phase, vis.room.progress(now)) : NO_ANIM
      if (anim.floor <= 0) continue
      const ra = rv ? rv.alpha(vis.id, rt) : 1
      if (ra <= 0) continue
      if (ra < 1) this.enterScope(ra, 0)
      if (anim.floor < 1) {
        ctx.save()
        this.sweepClip(vis, anim.floor)
        this.drawAreaFloor(vis)
        ctx.restore()
      } else this.drawAreaFloor(vis)
      if (ra < 1) this.exitScope()
    }
  }

  private floorKey(W: number, H: number, scale: number, ox: number, oy: number, now: number): string | null {
    for (const vis of this.areas.values()) if (vis.room && buildAnim(vis.room.phase, vis.room.progress(now)).floor < 1) return null
    if (this.staged.size) return null
    return `${W}x${H}|${scale}|${ox}|${oy}|${this.floorVersion}|${this.artVersion}|${this.theme}|${this.halo}|${this.pad}`
  }

  private cachedFloor(W: number, H: number, scale: number, ox: number, oy: number, now: number): CanvasImageSource | null {
    const key = this.floorKey(W, H, scale, ox, oy, now)
    if (!key) {
      this.floorCandidate = ''
      return null
    }
    if (key === this.floorLayerKey && this.floorLayer) return this.floorBitmap ?? this.floorLayer
    if (key !== this.floorCandidate) {
      this.floorCandidate = key
      return null
    }
    const c = this.floorLayer ?? document.createElement('canvas')
    if (c.width !== W) c.width = W
    if (c.height !== H) c.height = H
    const g = c.getContext('2d')
    if (!g) return null
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.clearRect(0, 0, W, H)
    g.setTransform(scale, 0, 0, scale, ox, oy)
    g.imageSmoothingEnabled = false
    g.transform(...this.view.ground)
    this.layerCtx = g
    try {
      this.drawFloors(now, null, 0)
    } finally {
      this.layerCtx = null
    }
    g.globalAlpha = 1
    this.floorLayer = c
    this.floorLayerKey = key
    this.floorBitmap?.close()
    this.floorBitmap = snapshot(c)
    return this.floorBitmap ?? c
  }

  private drawHeadIcon(ic: { x: number; y: number; name: IconName; alpha: number; bounce: number; badge: number }): void {
    const { ctx } = this
    ctx.globalAlpha = ic.alpha
    const y = ic.y - ic.bounce
    let box: ImgRect | null = null
    const art = iconArt(this.art3d, ic.name)
    if (art) {
      box = iconViewRect(art, ic.x, y, HEAD_ICON_VIEW)
      this.blit(art.img, box)
    } else if (VECTOR_ICONS.has(ic.name)) {
      box = drawVectorIcon(ctx, ic.name, ic.x, y)
    } else {
      const s = this.icon(ic.name)
      if (!s) return
      const ix = Math.round(ic.x - s.ax)
      const iy = Math.round(y - s.ay)
      ctx.drawImage(s.canvas, ix, iy)
      box = { x: ix, y: iy, w: s.canvas.width, h: s.canvas.height }
    }
    if (box && ic.badge > 1) {
      const b = countBadge(ic.badge)
      ctx.drawImage(b.canvas, Math.round(box.x + box.w - 1), Math.round(box.y + box.h - b.ay + 1))
    }
  }

  private drawHeldCoffee(hx: number, hy: number): void {
    const art = iconArt(this.art3d, 'coffee')
    if (art) return this.blit(art.img, iconViewRect(art, hx, hy, HELD_ICON_VIEW))
    const ic = this.icon('coffee')
    if (ic) this.ctx.drawImage(ic.canvas, Math.round(hx - ic.ax * COFFEE_ICON_K), Math.round(hy - ic.ay * COFFEE_ICON_K), ic.canvas.width * COFFEE_ICON_K, ic.canvas.height * COFFEE_ICON_K)
  }

  private sweepClip(vis: AreaVis, floor: number): void {
    const { ctx } = this
    const r = vis.layout.rect
    const p = vis.px
    const k = floor * 1.06
    ctx.beginPath()
    for (let j = 0; j < r.h; j++) {
      for (let i = 0; i < r.w; i++) {
        if (sweepDelay(i, j, r.w, r.h) > k) continue
        ctx.rect(p.x + i * TILE - 0.25, p.y + j * TILE - 0.25, TILE + 0.5, TILE + 0.5)
      }
    }
    ctx.clip()
  }

  private pattern(group: string, s: SurfaceArt, tint: string | null): CanvasPattern | null {
    const key = `${group}:${s.key}|${tint ?? ''}`
    const hit = this.patterns.get(key)
    if (hit !== undefined) return hit
    let p: CanvasPattern | null = null
    try {
      const src = tint ? this.tinted(s.img, tint) : s.img.src
      p = this.ctx.createPattern(frozen(src), 'repeat')
    } catch {
      p = null
    }
    this.patterns.set(key, p)
    return p
  }

  private tinted(img: IsoImage, color: string): CanvasImageSource {
    const c = document.createElement('canvas')
    c.width = img.w
    c.height = img.h
    const g = c.getContext('2d')
    if (!g) return img.src
    g.drawImage(img.src, 0, 0)
    g.globalCompositeOperation = 'multiply'
    g.fillStyle = color
    g.fillRect(0, 0, img.w, img.h)
    g.globalCompositeOperation = 'destination-in'
    g.drawImage(img.src, 0, 0)
    g.globalCompositeOperation = 'source-over'
    return c
  }

  private fillPattern(p: CanvasPattern, x: number, y: number, w: number, h: number, sx: number, sy: number): void {
    const { ctx } = this
    ctx.save()
    ctx.scale(sx, sy)
    ctx.fillStyle = p
    ctx.fillRect(x / sx, y / sy, w / sx, h / sy)
    ctx.restore()
  }

  private drawAreaFloor(vis: AreaVis): void {
    const { ctx } = this
    const art = this.art3d
    const lay = vis.layout
    const usable = !!art && (lay.floors.some((f) => art.floors.has(f.kind)) || (art.rugs.length > 0 && lay.rugs.length > 0))
    if (!art || !usable) {
      ctx.drawImage(vis.floor, vis.px.x, vis.px.y)
      return
    }
    const px = vis.px
    const was = ctx.imageSmoothingEnabled
    for (const f of lay.floors) {
      const s = art.floors.get(f.kind)
      const tint = s?.tint ? (hexOk(f.tint) ? f.tint : hexOk(lay.floorTint) ? lay.floorTint : null) : null
      const p = s ? this.pattern('floor', s, tint) : null
      if (s && p) {
        ctx.imageSmoothingEnabled = true
        this.fillPattern(p, f.x, f.y, f.w, f.h, (TILE * s.tiles) / s.tile[0], (TILE * s.tiles) / s.tile[1])
        ctx.imageSmoothingEnabled = was
        continue
      }
      const sx = Math.max(0, f.x - px.x)
      const sy = Math.max(0, f.y - px.y)
      const w = Math.min(f.w, px.w - sx)
      const h = Math.min(f.h, px.h - sy)
      if (w > 0 && h > 0) ctx.drawImage(vis.floor, sx, sy, w, h, px.x + sx, px.y + sy, w, h)
    }
    if (lay.kind === 'corridor') return
    for (const rug of lay.rugs) {
      const s = art.rugs.length ? art.rugs[(rug.seed >>> 0) % art.rugs.length]! : null
      if (s) {
        const src = this.rugSource(s, seasonalRugColor(this.theme, rug.color))
        ctx.imageSmoothingEnabled = true
        for (const p of rugSlices(s.img, rug)) ctx.drawImage(src, p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.dw, p.dh)
        ctx.imageSmoothingEnabled = was
        continue
      }
      this.safe(() => this.art.drawRug(ctx, rug.x, rug.y, rug.w, rug.h, rug.color, rug.seed))
    }
  }

  private headOf(ch: Character): HeadInfo {
    let h = this.heads.get(ch.id)
    if (!h) this.heads.set(ch.id, (h = { x: 0, y: 0, feetY: 0, visible: false, bx: 0, by: 0, bw: 0, bh: 0, depth: 0 }))
    return h
  }

  private groundOf(ch: Character): { x: number; y: number; seatRank: number } {
    if (ch.seated && ch.atSpot) {
      const spot = this.sim.spots.get(ch.atSpot)
      const ent = spot?.furnitureId ? this.furnEnt.get(spot.furnitureId) : undefined
      if (ent) return { x: (ent.box.minX + ent.box.maxX) / 2, y: (ent.box.minY + ent.box.maxY) / 2, seatRank: ent.rank }
    }
    return { x: ch.x + ch.offX, y: ch.y + ch.offY + (TILE / 2 - FOOT_DY), seatRank: -1 }
  }

  private archetypeOf(ch: Character): CharArchetypeDef | null {
    if (!this.archById.size) return null
    const seed = ch.info.seed
    let id = this.archOf.get(seed)
    if (id === undefined) {
      id = archetypeFor(seed, ch.appearance.look, this.archList)
      this.archOf.set(seed, id)
    }
    return this.archById.get(id) ?? null
  }

  private charSheetFor(ch: Character): { def: CharArchetypeDef; sheet: IsoImage; chars: CharArt } | null {
    const chars = this.art3d?.chars
    if (!chars) return null
    const def = this.archetypeOf(ch)
    const sheet = def ? chars.sheets.get(def.id) : undefined
    return def && sheet ? { def, sheet, chars } : null
  }

  private charSize(): { hw: number; top: number } {
    const chars = this.art3d?.chars
    if (!chars) return PLACEHOLDER_CHAR
    const k = charViewScale(chars)
    const feet = chars.anchors.feet
    return { hw: Math.max(feet[0], chars.frame.w - feet[0]) * k * 0.6, top: feet[1] * k }
  }

  private placeChars(now: number, view: ScreenBox): void {
    const chars = this.chars
    chars.length = 0
    let used = 0
    const size = this.art3d?.chars ? this.charSize() : PLACEHOLDER_CHAR
    for (const ch of this.sim.people()) {
      const head = this.headOf(ch)
      head.visible = false
      if (ch.inside || ch.alpha <= 0.01 || now < ch.hiddenUntil) continue
      const g = this.groundOf(ch)
      const f = this.view.toView(g.x, g.y)
      const sprites = this.charSheetFor(ch) !== null
      const lift = ch.seated && !sprites ? 4 : 0
      const sz = sprites ? size : PLACEHOLDER_CHAR
      const screen = { x0: f.x - sz.hw, y0: f.y - sz.top - lift, x1: f.x + sz.hw, y1: f.y + 4 }
      if (!(screen.x0 < view.x1 && screen.x1 > view.x0 && screen.y0 < view.y1 && screen.y1 > view.y0)) {
        head.x = f.x
        head.y = f.y - 26
        head.feetY = f.y
        continue
      }
      const box = { minX: g.x - 3, minY: g.y - 3, maxX: g.x + 3, maxY: g.y + 3 }
      const pos = g.seatRank >= 0 ? Math.max(insertRank(this.statics, box, screen, g.seatRank), g.seatRank + 0.5) : insertRank(this.statics, box, screen)
      let e = this.charPool[used]
      if (!e) this.charPool[used] = e = { ch, pos, gx: g.x, gy: g.y, fx: f.x, fy: f.y - lift }
      else {
        e.ch = ch
        e.pos = pos
        e.gx = g.x
        e.gy = g.y
        e.fx = f.x
        e.fy = f.y - lift
      }
      used++
      chars.push(e)
    }
    const [wx, wy] = this.view.depthW
    chars.sort((a, b) => a.pos - b.pos || wx * (a.gx - b.gx) + wy * (a.gy - b.gy))
  }

  private occupancy(): number[][] {
    const out = this.charFronts
    out.length = this.chars.length
    for (let i = 0; i < this.chars.length; i++) {
      const list = out[i] ?? (out[i] = [])
      list.length = 0
      if (!this.frontIdx.size) continue
      const c = this.chars[i]!
      const spot = c.ch.atSpot ? this.sim.spots.get(c.ch.atSpot) : undefined
      for (const id of [spot?.furnitureId, spot?.deskId]) {
        const ent = id ? this.furnEnt.get(id) : undefined
        const idx = ent ? this.frontIdx.get(ent) : undefined
        if (idx !== undefined && !list.includes(idx)) list.push(idx)
      }
      for (const [ent, idx] of this.frontIdx) {
        if (list.includes(idx)) continue
        const b = ent.box
        if (c.gx >= b.minX - 1 && c.gx <= b.maxX + 1 && c.gy >= b.minY - 1 && c.gy <= b.maxY + 1) list.push(idx)
      }
    }
    return out
  }

  private wallFades(sel: Sel): Map<StaticEnt, number> {
    const out = new Map<StaticEnt, number>()
    const room = sel.room ? this.sim.rooms.get(sel.room) : undefined
    const rr = room?.present ? room.layout.rect : null
    const roomScreen = rr ? screenOf(this.view, { minX: rr.x * TILE, minY: rr.y * TILE, maxX: (rr.x + rr.w) * TILE, maxY: (rr.y + rr.h) * TILE }, 0) : null
    const tall = this.art3d?.chars ? CHAR_STAND_VIEW : PLACEHOLDER_STAND
    for (const s of this.statics) {
      if (s.kind !== 'wall' || s.piece.kind !== 'face') continue
      const p = s.piece
      let fade = false
      for (const c of this.chars) {
        if (c.pos > s.rank) continue
        if (coversPoint(p, c.fx, c.fy - 2, this.view) || coversPoint(p, c.fx, c.fy - tall * 0.5, this.view) || coversPoint(p, c.fx, c.fy - tall * 0.9, this.view)) {
          fade = true
          break
        }
      }
      if (!fade && rr && roomScreen && s.area?.id !== sel.room) {
        const south = p.baseY > rr.y * TILE + 2 * TILE
        const across = p.x1 > rr.x * TILE && p.x0 < (rr.x + rr.w) * TILE + 6 * TILE
        if (south && across && s.screen.x0 < roomScreen.x1 && s.screen.x1 > roomScreen.x0 && s.screen.y0 < roomScreen.y1 && s.screen.y1 > roomScreen.y0) fade = true
      }
      if (fade) out.set(s, XRAY_ALPHA)
    }
    return out
  }

  private drawBox(box: DepthBox, h: number, color: string): void {
    const { ctx } = this
    const toView = this.view.toView
    const a = toView(box.minX, box.minY, h)
    const b = toView(box.maxX, box.minY, h)
    const c = toView(box.maxX, box.maxY, h)
    const d = toView(box.minX, box.maxY, h)
    const b0 = toView(box.maxX, box.minY)
    const c0 = toView(box.maxX, box.maxY)
    const d0 = toView(box.minX, box.maxY)
    ctx.fillStyle = shade(color, -0.12)
    ctx.beginPath()
    ctx.moveTo(d.x, d.y)
    ctx.lineTo(c.x, c.y)
    ctx.lineTo(c0.x, c0.y)
    ctx.lineTo(d0.x, d0.y)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = shade(color, -0.3)
    ctx.beginPath()
    ctx.moveTo(c.x, c.y)
    ctx.lineTo(b.x, b.y)
    ctx.lineTo(b0.x, b0.y)
    ctx.lineTo(c0.x, c0.y)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = shade(color, 0.18)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.lineTo(c.x, c.y)
    ctx.lineTo(d.x, d.y)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = 'rgba(30,34,52,0.35)'
    ctx.lineWidth = 0.5
    ctx.stroke()
  }

  private blit(img: IsoImage, r: ImgRect, flip = false): void {
    const { ctx } = this
    const was = ctx.imageSmoothingEnabled
    ctx.imageSmoothingEnabled = true
    if (flip) {
      ctx.save()
      ctx.translate(r.x + r.w / 2, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(img.src, -r.w / 2, r.y, r.w, r.h)
      ctx.restore()
    } else ctx.drawImage(img.src, r.x, r.y, r.w, r.h)
    ctx.imageSmoothingEnabled = was
  }

  private drawFurniture(e: FurnEnt, now: number): void {
    const room = e.area?.room
    const anim = room ? buildAnim(room.phase, room.progress(now)) : NO_ANIM
    const s = anim.mode === 'none' ? 1 : furnitureScale(anim, e.furn.order)
    if (s <= 0.01) return
    const { ctx } = this
    ctx.globalAlpha = Math.min(1, s)
    const look = this.lookOf(e, now)
    if (look.sprite && look.draw) {
      const k = Math.min(1, s)
      ctx.save()
      if (k < 1) {
        ctx.translate(e.pivot.x, e.pivot.y)
        ctx.scale(k, k)
        ctx.translate(-e.pivot.x, -e.pivot.y)
      }
      this.blit(look.sprite.img, look.draw)
      this.drawFurnitureLive(e, now)
      ctx.restore()
    } else {
      this.drawBox(e.box, e.height * Math.min(1, s), e.color)
      if (e.furn.kind === 'coffee_machine' && s >= 1 && (this.sim.machineUntil.get(e.furn.id) ?? 0) > now) {
        const top = this.view.toView((e.box.minX + e.box.maxX) / 2, (e.box.minY + e.box.maxY) / 2, e.height)
        this.drawSteam(top.x, top.y - 1, now, e.furn.seed)
      }
    }
    ctx.globalAlpha = 1
  }

  private paintLive(owner: object, now: number, r: ImgRect, viewW: number, viewH: number, draw: LivePaint, sheen = true): void {
    this.safe(() => this.live.paintCached(this.ctx, owner, now, r, viewW, viewH, draw, sheen))
  }

  private lookOf(e: FurnEnt, now: number): FurnLook {
    const busy = e.furn.kind === 'toilet_stall' ? this.sim.stallBusy.has(e.furn.id) : e.furn.kind === 'coffee_machine' ? (this.sim.machineUntil.get(e.furn.id) ?? 0) > now : false
    if (!busy || !e.sprite) return e
    if (e.alt === undefined) {
      const sp = furnitureArt(this.art3d, e.furn.kind, '1')
      if (sp && sp !== e.sprite) {
        const r = furnitureDrawRect(this.view, sp, e.pl, e.footH)
        e.alt = { sprite: sp, draw: { x: r.x, y: r.y, w: r.w, h: r.h } }
      } else e.alt = null
    }
    return e.alt ?? e
  }

  private drawFront(e: FurnEnt, now: number): void {
    const look = this.lookOf(e, now)
    const front = look.sprite?.front
    if (!front || !look.draw) return
    const room = e.area?.room
    const anim = room ? buildAnim(room.phase, room.progress(now)) : NO_ANIM
    const s = anim.mode === 'none' ? 1 : furnitureScale(anim, e.furn.order)
    if (s < 0.99) return
    this.blit(front, look.draw)
  }

  private spriteRect(e: FurnEnt, b: Box4): ImgRect | null {
    if (!e.draw || !e.sprite) return null
    const k = e.draw.w / e.sprite.img.w
    return { x: e.draw.x + b[0] * k, y: e.draw.y + b[1] * k, w: b[2] * k, h: b[3] * k }
  }

  private drawFurnitureLive(e: FurnEnt, now: number): void {
    const sp = e.sprite
    if (!sp) return
    const f = e.furn
    if ((f.kind === 'desk' || f.kind === 'desk_back') && sp.rects.screen && e.area) {
      const r = this.spriteRect(e, sp.rects.screen)
      const mode = this.deskScreen(f, e.area)
      if (r) this.paintLive(e, now, r, r.w, r.h, (g, rr) => this.art.drawScreen(g, rr, mode, now, f.seed))
    } else if (f.kind === 'arcade' && sp.rects.screen) {
      const seed = this.sim.social.arcadeSeed()
      const r = this.spriteRect(e, sp.rects.screen)
      if (r && seed !== null) this.paintLive(e, now, r, r.w, r.h, (g, rr) => this.art.drawScreen(g, rr, 'game', now, seed))
    } else if (f.kind === 'coffee_machine' && e.draw && (this.sim.machineUntil.get(f.id) ?? 0) > now) {
      this.drawSteam(e.draw.x + e.draw.w * 0.55, e.draw.y + e.draw.h * 0.18, now, f.seed)
    }
  }

  private drawSteam(x: number, y: number, now: number, seed: number): void {
    const { ctx } = this
    const was = ctx.globalAlpha
    ctx.fillStyle = '#ffffff'
    for (let i = 0; i < 3; i++) {
      const ph = (((now / 900 + i / 3 + (seed % 7) / 7) % 1) + 1) % 1
      ctx.globalAlpha = was * 0.7 * (1 - ph)
      ctx.beginPath()
      ctx.arc(x + Math.sin(ph * 6 + i * 2) * 2 + (i - 1) * 1.5, y - ph * 12, 1 + ph * 1.5, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = was
  }

  deskScreen(f: FurnVis, area: AreaVis): ScreenMode {
    const room = area.room
    if (room && room.light(this.sim.now) < 0.3) return 'off'
    const owner = f.seatSpot ? this.sim.spots.ownerOf(f.seatSpot) : undefined
    const ch = owner ? this.sim.chars.get(owner) : undefined
    if (!ch || ch.leaving) return 'off'
    if (ch.mode === 'wait') return 'alert'
    if (ch.atSpot !== f.seatSpot) return 'idle'
    if (ch.mode === 'work') return screenModeFor(ch.info.activity?.kind)
    if (ch.mode === 'shell') return 'progress'
    return 'idle'
  }

  private wallSurface(style: WallStyle): SurfaceArt | null {
    const walls = this.art3d?.walls
    if (!walls?.size) return null
    return walls.get(style.pattern ?? 'plain') ?? walls.get('plain') ?? null
  }

  private drawWall(e: WallEnt, now: number, hour: number, fade: number): void {
    const { ctx } = this
    let alpha = fade
    let rise = 0
    if (e.slot !== null) {
      const room = this.roomInSlot(e.slot)
      if (room && room.phase === 'ready') {
        const ra = this.revealAlpha(room.id)
        if (ra >= 1) return
        alpha *= 1 - ra
      } else if (room) alpha *= 0.5
    } else if (e.area?.room) {
      const anim = buildAnim(e.area.room.phase, e.area.room.progress(now))
      if (anim.walls <= 0) return
      alpha *= Math.min(1, anim.walls)
      rise = (1 - Math.min(1, anim.walls)) * WALL_H * WALL_RISE
    }
    const p = e.piece
    if (p.kind === 'low') {
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.translate(0, rise)
      this.drawBox(p.box, p.height, p.base)
      ctx.restore()
      ctx.globalAlpha = 1
      return
    }
    const own = this.art3d !== null
    const surface = own ? this.wallSurface(e.style) : null
    ctx.save()
    ctx.globalAlpha = alpha
    if (rise) ctx.translate(0, rise)
    ctx.transform(...this.view.wallMatrix(p.baseY))
    const w = p.x1 - p.x0
    if (own) {
      this.drawWallBase(e, surface)
      if (e.area) {
        for (const it of e.items) this.drawWallItemOwn(e.area, it, now, hour)
        this.safe(() => this.drawSeasonalWallDecor(e.area!, p))
        const sign = this.signOf(e.area)
        if (sign && sign.on === 'face' && sign.baseY === p.baseY && sign.cx >= p.x0 && sign.cx <= p.x1) this.drawSign(e.area, sign, now)
      } else for (const win of e.windows) this.drawWindowOwn(win, hour, now)
    } else if (e.area) {
      const px = e.area.px
      const sx = p.x0 - px.x
      const sy = p.top - px.y
      if (sx >= 0 && sy >= 0 && w > 0) ctx.drawImage(e.area.walls, sx, sy, w, FACE_SRC_H, p.x0, p.top - WALL_MARGIN, w, FACE_SRC_H)
      for (const it of e.area.wallItems) if (it.on === 'face' && it.baseY === p.baseY && it.cx >= p.x0 && it.cx <= p.x1) this.drawWallItem(e.area, it, now, hour)
      const sign = e.area.sign
      if (sign && sign.on === 'face' && sign.baseY === p.baseY && sign.cx >= p.x0 && sign.cx <= p.x1) this.drawSign(e.area, sign, now)
    } else if (e.canvas) {
      ctx.drawImage(e.canvas, p.x0, p.top - WALL_MARGIN)
      for (const win of e.windows) this.drawWindow(win, hour, now)
    } else {
      ctx.fillStyle = p.base
      ctx.fillRect(p.x0, p.top, w, 2 * TILE)
    }
    ctx.restore()
    ctx.globalAlpha = alpha
    const a = this.view.toView(p.x0, p.baseY, p.height - rise)
    const b = this.view.toView(p.x1, p.baseY, p.height - rise)
    if (surface && hexOk(surface.cap)) {
      const a2 = this.view.toView(p.x0, p.baseY - 3, p.height - rise)
      const b2 = this.view.toView(p.x1, p.baseY - 3, p.height - rise)
      ctx.fillStyle = surface.cap
      ctx.beginPath()
      ctx.moveTo(a2.x, a2.y)
      ctx.lineTo(b2.x, b2.y)
      ctx.lineTo(b.x, b.y)
      ctx.lineTo(a.x, a.y)
      ctx.closePath()
      ctx.fill()
    }
    ctx.strokeStyle = 'rgba(40,36,48,0.55)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  private drawWallBase(e: WallEnt, surface: SurfaceArt | null): void {
    const { ctx } = this
    const p = e.piece as FacePiece
    const w = p.x1 - p.x0
    const tint = surface?.tint && hexOk(e.style.base) ? e.style.base : null
    const pat = surface ? this.pattern('wall', surface, tint) : null
    if (surface && pat) {
      const was = ctx.imageSmoothingEnabled
      ctx.imageSmoothingEnabled = true
      this.fillPattern(pat, p.x0, p.top, w, 2 * TILE, (TILE * surface.tiles) / surface.tile[0], (2 * TILE) / surface.tile[1])
      ctx.imageSmoothingEnabled = was
      return
    }
    if (!e.canvas) e.canvas = this.faceCanvas(p, e.style)
    if (e.canvas) ctx.drawImage(e.canvas, p.x0, p.top - WALL_MARGIN)
    else {
      ctx.fillStyle = p.base
      ctx.fillRect(p.x0, p.top, w, 2 * TILE)
    }
  }

  private wallRect(sp: FurnArt, cx: number, baseY: number): ImgRect & { sx: number; sy: number } {
    const { sx, sy } = wallLocalScale(this.view, sp.scale)
    return { x: cx - sp.anchor[0] * sx, y: baseY - sp.anchor[1] * sy, w: sp.img.w * sx, h: sp.img.h * sy, sx, sy }
  }

  private wallSub(r: ImgRect & { sx: number; sy: number }, b: Box4 | undefined): ImgRect | null {
    return b ? { x: r.x + b[0] * r.sx, y: r.y + b[1] * r.sy, w: b[2] * r.sx, h: b[3] * r.sy } : null
  }

  private drawWallItemOwn(vis: AreaVis, w: WallVis, now: number, hour: number): void {
    if (w.kind === 'window') return this.drawWindowOwn(w, hour, now)
    if (w.kind === 'painting' || w.kind === 'poster') return this.drawWallArt(w)
    let variant = w.variant
    let state = 0
    if (w.kind === 'light_switch') variant = vis.room && !vis.room.lightOn ? 'off' : 'on'
    if (w.kind === 'elevator') {
      state = this.sim.elevators[this.elevatorVis.indexOf(w)]?.state ?? 0
      variant = String(state)
    }
    const sp = wallItemArt(this.art3d, w.kind, variant)
    if (!sp) {
      if (w.kind === 'clock' || w.kind === 'whiteboard' || w.kind === 'tv' || w.kind === 'elevator' || w.kind === 'light_switch' || w.kind === 'mirror') return this.drawWallItem(vis, w, now, hour)
      const s = wallSprites(this.art, w.kind, w.variant === 'wide' ? undefined : w.variant, 0, w.seed)
      if (!s) return
      const o = wallItemOrigin(w, s.base)
      this.ctx.drawImage(s.base.canvas, o.x, o.y)
      return
    }
    const r = this.wallRect(sp, w.cx, w.baseY)
    this.blit(sp.img, r)
    if (w.kind === 'elevator') this.safe(() => this.drawElevatorDecor(w))
    const ctx = this.ctx
    const u = this.wallUnit()
    this.safe(() => {
      const face = this.wallSub(r, sp.rects.face)
      const board = this.wallSub(r, sp.rects.board)
      const tv = this.wallSub(r, sp.rects.tv ?? sp.rects.screen)
      const glass = this.wallSub(r, sp.rects.glass)
      if (w.kind === 'clock' && face) drawClockHands(ctx, face, this.date, u)
      else if (w.kind === 'whiteboard' && board) {
        const items = vis.room?.board ?? []
        this.paintLive(w, now, board, board.w * u.x, board.h * u.y, (g, rr) => this.art.drawBoard(g, rr, items, now), false)
      } else if (w.kind === 'tv' && tv) {
        const live = this.sim.social.tvScreen()
        const mode = live ? live.mode : TV_MODES[Math.floor(now / 9000) % TV_MODES.length]!
        const seed = live ? live.seed : w.seed
        this.paintLive(w, now, tv, tv.w * u.x, tv.h * u.y, (g, rr) => this.art.drawScreen(g, rr, mode, now, seed))
      } else if (w.kind === 'mirror' && glass) this.drawReflection(w, glass)
    })
  }

  private drawReflection(w: WallVis, glass: ImgRect): void {
    const chars = this.art3d?.chars
    if (!chars) return
    for (const ch of this.sim.chars.values()) {
      if (ch.inside || ch.alpha < 0.5 || ch.dir !== 'up' || ch.seated) continue
      if (Math.abs(ch.x - w.cx) > 5) continue
      const dy = ch.y - w.baseY
      if (dy < 14 || dy > 30) continue
      const s = this.charSheetFor(ch)
      if (!s) return
      const pick = pickAnim(s.def.anims, 'stand', 'down', false, 'none', (a) => animFits(a, chars.frame, s.sheet))
      if (!pick) return
      const { ctx } = this
      const u = this.wallUnit()
      const k = charViewScale(chars)
      const fw = chars.frame.w
      const fh = chars.frame.h
      const dw = (fw * k) / u.x
      const dh = (fh * k) / u.y
      const head = chars.anchors.head
      const dx = glass.x + glass.w / 2 - (head[0] * k) / u.x
      const dy2 = glass.y + glass.h * 0.4 - (head[1] * k) / u.y
      ctx.save()
      ctx.beginPath()
      ctx.rect(glass.x, glass.y, glass.w, glass.h)
      ctx.clip()
      ctx.globalAlpha *= 0.8 * ch.alpha
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(s.sheet.src, frameIndex(pick.anim, ch.animT) * fw, pick.anim.row * fh, fw, fh, dx, dy2, dw, dh)
      ctx.globalAlpha = 0.28
      ctx.fillStyle = '#cfe6f2'
      ctx.fillRect(glass.x, glass.y, glass.w, glass.h)
      ctx.restore()
      return
    }
  }

  private drawWallArt(w: WallVis): void {
    const { ctx } = this
    const kind = w.kind as 'painting' | 'poster'
    const tiles = kind === 'poster' ? 1 : w.variant === 'wide' ? 4 : 2
    const iso = pickIsoWallArt(this.art3d, kind, tiles, w.variant, w.seed)
    if (iso) {
      const img = iso.framed ?? iso.img
      const { sx, sy } = wallLocalScale(this.view, 2)
      const ww = img.w * sx
      const hh = img.h * sy
      const top = Math.max(w.baseY - 2 * TILE + 1, w.baseY - WALL_ART_MID - hh / 2)
      this.blit(img, { x: w.cx - ww / 2, y: top, w: ww, h: hh })
      return
    }
    const sp = wallItemArt(this.art3d, kind, w.variant)
    if (sp) {
      this.blit(sp.img, this.wallRect(sp, w.cx, w.baseY))
      return
    }
    const pack = pickWallArt(this.assets, kind, tiles, w.variant, w.seed)
    const img = pack ? (pack.framed ?? (pack.kind === 'poster' ? pack : null)) : null
    if (img) {
      ctx.drawImage(img.img, Math.round(w.cx - img.w / 2), w.baseY - 28)
      return
    }
    const s = wallSprites(this.art, kind, w.variant === 'wide' ? undefined : w.variant, 0, w.seed)
    if (!s) return
    const o = wallItemOrigin(w, s.base)
    ctx.drawImage(s.base.canvas, o.x, o.y)
  }

  private wallSpan(w: WallVis): Span | null {
    try {
      if (w.kind === 'painting' || w.kind === 'poster') {
        const tiles = w.kind === 'poster' ? 1 : w.variant === 'wide' ? 4 : 2
        const iso = pickIsoWallArt(this.art3d, w.kind, tiles, w.variant, w.seed)
        if (iso) {
          const img = iso.framed ?? iso.img
          const half = (img.w * wallLocalScale(this.view, 2).sx) / 2
          return { x0: w.cx - half, x1: w.cx + half }
        }
      }
      const sp = wallItemArt(this.art3d, w.kind, w.kind === 'elevator' ? '0' : w.variant)
      if (sp) {
        const r = this.wallRect(sp, w.cx, w.baseY)
        return { x0: r.x, x1: r.x + r.w }
      }
      const s = wallSprites(this.art, w.kind, w.variant === 'wide' ? undefined : w.variant, 0, w.seed)
      if (!s) return null
      const o = wallItemOrigin(w, s.base)
      return { x0: o.x, x1: o.x + s.base.canvas.width }
    } catch {
      return null
    }
  }

  private signLayout(vis: AreaVis, sign: WallVis): { sp: FurnArt; r: ImgRect & { sx: number; sy: number }; box: ImgRect; fit: SignFit | null } | null {
    const sp = wallItemArt(this.art3d, 'sign', sign.variant)
    if (!sp) return null
    const r = this.wallRect(sp, sign.cx, sign.baseY)
    const box = this.wallSub(r, sp.rects.sign)
    const text = this.signName(vis)
    if (!box || !text) return { sp, r, box: box ?? r, fit: null }
    const u = this.wallUnit()
    const w = box.w * u.x
    const h = box.h * u.y
    const spare = (this.signSpareW.get(sign.id) ?? 0) * u.x
    const growW = Math.max(0, Math.min(spare, (SIGN_STRETCH_MAX - 1) * r.w * u.x))
    const below = Math.max(0, (r.y + r.h - (box.y + box.h)) * u.y - h * SIGN_PAD_X * 2)
    const growH = Math.min(below, h * SIGN_GROW_H)
    const key = `${text}|${w.toFixed(2)}|${h.toFixed(2)}|${growW.toFixed(1)}|${growH.toFixed(1)}`
    let fit = this.signFits.get(key)
    if (!fit) {
      const { ctx } = this
      const font = ctx.font
      fit = fitSign(
        (font, t) => {
          ctx.font = font
          return ctx.measureText(t).width
        },
        text,
        { w, h },
        growW,
        growH,
      )
      ctx.font = font
      if (this.signFits.size > 256) this.signFits.clear()
      this.signFits.set(key, fit)
    }
    return { sp, r, box, fit }
  }

  private drawSignName(box: ImgRect, fit: SignFit): void {
    if (!fit.lines.length) return
    const { ctx } = this
    const u = this.wallUnit()
    ctx.save()
    ctx.translate(box.x + box.w / 2, box.y + box.h / 2)
    ctx.scale(1 / u.x, 1 / u.y)
    ctx.font = fit.font
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    const m = textMetrics(ctx, TEXT_REF, fit.size)
    ctx.fillStyle = SIGN_INK
    const ys = signLineYs(fit, 0, (m.asc - m.desc) / 2)
    fit.lines.forEach((line, i) => ctx.fillText(line, 0, ys[i]!))
    ctx.restore()
  }

  private wallUnit(): { x: number; y: number } {
    return { x: Math.hypot(this.view.ax.x, this.view.ax.y) || 1, y: WALL_HK }
  }

  signName(vis: AreaVis): string | null {
    if (vis.room) return vis.room.info.name
    if (vis.id === 'core:recepcao') return RECEPTION_SIGN
    const core = CORE_SIGNS[vis.id]
    return core ? tr(core.name) : null
  }

  signOf(vis: AreaVis): WallVis | null {
    return vis.sign ?? this.coreSigns.get(vis.id) ?? null
  }

  private grownSign(L: { r: ImgRect; box: ImgRect; fit: SignFit | null }): { r: ImgRect; box: ImgRect; gw: number; gh: number } {
    const u = this.wallUnit()
    const gw = L.fit ? L.fit.growW / u.x : 0
    const gh = L.fit ? L.fit.growH / u.y : 0
    return { r: L.r, box: { x: L.box.x - gw / 2, y: L.box.y, w: L.box.w + gw, h: L.box.h + gh }, gw, gh }
  }

  private drawSign(vis: AreaVis, sign: WallVis, now: number): void {
    const L = this.signLayout(vis, sign)
    if (L) {
      const anim = vis.room ? buildAnim(vis.room.phase, vis.room.progress(now)) : NO_ANIM
      if (anim.sign <= 0) return
      const g = this.grownSign(L)
      const { ctx } = this
      ctx.save()
      if (anim.sign < 1) {
        ctx.globalAlpha *= anim.sign
        ctx.translate(0, -(1 - anim.sign) * SIGN_SLIDE)
      }
      const center = L.sp.rects.sign
      if (center && (g.gw > 0 || g.gh > 0)) {
        const was = ctx.imageSmoothingEnabled
        ctx.imageSmoothingEnabled = true
        for (const p of nineSlice(L.sp.img, center, L.r, g.gw, g.gh)) ctx.drawImage(L.sp.img.src, p.sx, p.sy, p.sw, p.sh, p.dx, p.dy, p.dw, p.dh)
        ctx.imageSmoothingEnabled = was
      } else this.blit(L.sp.img, L.r)
      const fit = L.fit
      if (fit && anim.sign >= 1) this.safe(() => this.drawSignName(g.box, fit))
      ctx.restore()
      return
    }
    const s = wallSprites(this.art, 'sign', sign.variant, 0, sign.seed)
    if (s) {
      const o = wallItemOrigin(sign, s.base)
      this.ctx.drawImage(s.base.canvas, o.x, o.y)
    }
  }

  private drawWindowOwn(w: WallVis, hour: number, now: number): void {
    const sp = wallItemArt(this.art3d, 'window', w.variant)
    if (!sp) return this.drawWindow(w, hour, now)
    const r = this.wallRect(sp, w.cx, w.baseY)
    const glass = this.wallSub(r, sp.rects.glass)
    const u = this.wallUnit()
    const theme = this.theme
    if (glass)
      this.paintLive(
        w,
        now,
        glass,
        glass.w * u.x,
        glass.h * u.y,
        (g, rr) => {
          this.art.drawWindowView(g, rr, hour, now, w.seed)
          if (theme !== 'none') drawSeasonalWindow(g, theme, rr, now, w.seed)
        },
        false,
      )
    this.blit(sp.img, r)
  }

  private drawWallItem(vis: AreaVis, w: WallVis, now: number, hour: number): void {
    const { ctx } = this
    if (w.kind === 'window') return this.drawWindow(w, hour, now)
    let variant = w.variant
    let state = 0
    if (w.kind === 'light_switch') variant = vis.room && !vis.room.lightOn ? 'off' : 'on'
    if (w.kind === 'elevator') state = this.sim.elevators[this.elevatorVis.indexOf(w)]?.state ?? 0
    const s = wallSprites(this.art, w.kind, variant, state, w.seed)
    if (!s) return
    const o = wallItemOrigin(w, s.base)
    ctx.drawImage(s.base.canvas, o.x, o.y)
    if (w.kind === 'elevator' && this.art3d) this.safe(() => this.drawElevatorDecor(w))
    const rects = s.base.rects
    this.safe(() => {
      if (w.kind === 'clock' && rects?.face) this.art.drawClock(ctx, { x: o.x + rects.face.x, y: o.y + rects.face.y, w: rects.face.w, h: rects.face.h }, this.date)
      else if (w.kind === 'whiteboard' && rects?.board) this.art.drawBoard(ctx, { x: o.x + rects.board.x, y: o.y + rects.board.y, w: rects.board.w, h: rects.board.h }, vis.room?.board ?? [], now)
      else if (w.kind === 'tv' && rects?.tv) {
        const live = this.sim.social.tvScreen()
        const mode = live ? live.mode : TV_MODES[Math.floor(now / 9000) % TV_MODES.length]!
        this.art.drawScreen(ctx, { x: o.x + rects.tv.x, y: o.y + rects.tv.y, w: rects.tv.w, h: rects.tv.h }, mode, now, live ? live.seed : w.seed)
      }
    })
  }

  private drawWindow(w: WallVis, hour: number, now: number): void {
    const s = wallSprites(this.art, 'window', w.variant, 0, w.seed)
    if (!s) return
    const o = wallItemOrigin(w, s.base)
    let r = s.base.rects?.glass
    if (!r) {
      const b = opaqueBounds(s.base.canvas)
      r = { x: b.x + 2, y: b.y + 2, w: b.w - 4, h: b.h - 4 }
    }
    const g = r
    this.safe(() => this.art.drawWindowView(this.ctx, { x: o.x + g.x, y: o.y + g.y, w: g.w, h: g.h }, hour, now, w.seed))
    this.ctx.drawImage(s.base.canvas, o.x, o.y)
  }

  private charSprite(req: CharacterFrameRequest, animT: number): Sprite {
    const count = Math.max(1, this.art.poseFrameCount(req.pose) || 1)
    const dur = Math.max(30, this.art.poseFrameDuration(req.pose) || 500)
    req.frame = Math.floor(animT / dur) % count
    return this.art.characterSprite(req)
  }

  private drawCharacter(e: CharEnt, now: number, sel: Sel): void {
    const { ctx } = this
    const ch = e.ch
    const head = this.headOf(ch)
    const x = Math.round(e.fx)
    const y = Math.round(e.fy)
    ctx.globalAlpha = ch.alpha
    const sheet = this.charSheetFor(ch)
    const ring = sheet ? RING_R : PLACEHOLDER_RING_R
    if (ch.mode === 'wait') this.drawRing(x, y, '#ffb11f', 1 + ((now % 1100) / 1100) * 1.5, 0.9 * (1 - (now % 1100) / 1100), ring)
    if (sel.agent === ch.id) this.drawRing(x, y, '#7fe3ff', 1 + Math.sin(now / 220) * 0.08, 0.95, ring, SEL_FILL)
    else if (sel.hover === ch.id) this.drawRing(x, y, '#ffffff', 1, 0.6, ring)
    if (sheet && this.drawSheetCharacter(e, sheet, head, x, y, now)) {
      ctx.globalAlpha = 1
      this.finishHead(ch, head, x, y, e.pos, now)
      return
    }
    if (!ch.seated) {
      const sh = shadowSprite()
      ctx.drawImage(sh.canvas, x - sh.ax, y - sh.ay)
    }
    const req = this.req
    req.appearance = ch.appearance
    req.dir = ch.dir
    req.pose = ch.pose
    req.held = ch.held
    req.seated = ch.seated
    let sprite: Sprite | null = null
    try {
      sprite = this.charSprite(req, ch.animT)
    } catch {
      sprite = null
    }
    if (!sprite && (req.pose === 'wait' || req.held === 'popcorn')) {
      req.pose = req.pose === 'wait' ? 'sit' : req.pose
      req.held = 'none'
      try {
        sprite = this.charSprite(req, ch.animT)
      } catch {
        sprite = null
      }
    }
    if (sprite) {
      const sx = x - sprite.ax
      const sy = y - sprite.ay
      ctx.drawImage(sprite.canvas, sx, sy)
      const b = opaqueBounds(sprite.canvas)
      head.bx = sx + b.x
      head.by = sy + b.y
      head.bw = b.w
      head.bh = b.h
      head.y = sy + b.y
    } else {
      head.bx = x - 7
      head.by = y - 26
      head.bw = 14
      head.bh = 26
      head.y = y - 26
    }
    ctx.globalAlpha = 1
    this.finishHead(ch, head, x, y, e.pos, now)
    if (sprite) this.popcorn(ch, x, head.y + 10, now)
  }

  private popcorn(ch: Character, x: number, y: number, now: number): void {
    if (ch.mode !== 'shell' || !ch.shellSince || ch.leaving || ch.pose !== 'wait' || ch.held !== 'popcorn' || now < ch.popcornAt) return
    ch.popcornAt = now + 450 + Math.random() * 1200
    this.particles.popcorn(x, y)
    if (Math.random() < 0.3) this.particles.popcorn(x, y)
  }

  private drawSheetCharacter(e: CharEnt, s: { def: CharArchetypeDef; sheet: IsoImage; chars: CharArt }, head: HeadInfo, x: number, y: number, now: number): boolean {
    const ch = e.ch
    const { chars, sheet } = s
    const pick = pickAnim(s.def.anims, ch.pose, ch.dir, ch.seated, ch.held, (a) => animFits(a, chars.frame, sheet))
    if (!pick) return false
    const fw = chars.frame.w
    const fh = chars.frame.h
    const i = frameIndex(pick.anim, ch.animT)
    const sx = i * fw
    const sy = pick.anim.row * fh
    if (sx + fw > sheet.w || sy + fh > sheet.h) return false
    const k = charViewScale(chars)
    const anchor = pick.anim.anchor === 'seat' ? chars.anchors.seat : chars.anchors.feet
    const lift = pick.anim.anchor === 'seat' ? Math.min(SEAT_LIFT_MAX, (chars.anchors.feet[1] - chars.anchors.seat[1]) * k) : 0
    const bob = bobOffset(pick.bob, ch.animT, (ch.info.seed % 628) / 100)
    const ax = x
    const ay = y - lift + bob
    const { ctx } = this
    if (!ch.seated) {
      ctx.save()
      ctx.globalAlpha *= 0.22
      ctx.fillStyle = '#1e2234'
      ctx.beginPath()
      ctx.ellipse(x, y, fw * k * 0.26, fw * k * 0.26 * this.view.params.k * 0.6, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
    const dx = ax - anchor[0] * k
    const dy = ay - anchor[1] * k
    const was = ctx.imageSmoothingEnabled
    ctx.imageSmoothingEnabled = true
    const devH = fh * k * this.devScale
    const lk = sheet.k ?? 1
    const pick2 = lk < 1 && devH > fh * lk * HI_SHEET_AT ? (chars.hi?.(s.def.id) ?? sheet) : sheet
    const sk = pick2.k ?? 1
    const bmp = this.frames.get(pick2, sx, sy, fw, fh, devH, sheet)
    const src = bmp ?? pick2.src
    const bx = bmp ? 0 : sx * sk
    const by = bmp ? 0 : sy * sk
    const bw = bmp ? bmp.width : fw * sk
    const bh = bmp ? bmp.height : fh * sk
    if (pick.flip) {
      ctx.save()
      ctx.translate(ax, 0)
      ctx.scale(-1, 1)
      ctx.drawImage(src, bx, by, bw, bh, -anchor[0] * k, dy, fw * k, fh * k)
      ctx.restore()
    } else ctx.drawImage(src, bx, by, bw, bh, dx, dy, fw * k, fh * k)
    const hand = chars.anchors.hand
    const hx = pick.flip ? ax - (hand[0] - anchor[0]) * k : ax + (hand[0] - anchor[0]) * k
    const hy = ay + (hand[1] - anchor[1]) * k
    if (ch.held === 'coffee' && !pick.name.includes('coffee') && !pick.name.startsWith('drink')) {
      this.drawHeldCoffee(hx, hy)
    } else if (ch.held === 'popcorn') {
      const px = ch.seated ? x + (pick.flip ? -1 : 1) * fw * k * 0.12 : hx
      const py = ch.seated ? ay - fw * k * 0.02 : hy
      drawPopcornBucket(ctx, px, py, POPCORN_K)
      this.popcorn(ch, px, py - 6 * POPCORN_K, now)
    }
    ctx.imageSmoothingEnabled = was
    const headTop = chars.anchors.head[1] - (chars.anchors.chest[1] - chars.anchors.head[1]) * 0.5
    const top = dy + Math.max(0, headTop) * k
    const half = fw * k * 0.3
    head.bx = x - half
    head.by = top
    head.bw = half * 2
    head.bh = ay - top
    head.y = top
    return true
  }

  private finishHead(ch: Character, head: HeadInfo, x: number, y: number, pos: number, now: number): void {
    head.x = x
    head.feetY = y
    head.visible = true
    head.depth = pos
    let name: IconName | null = ch.mode === 'wait' ? 'alert' : ch.icon
    const shell = ch.mode === 'shell' && ch.shellSince > 0 && !ch.leaving
    let badge = 0
    if (shell && (!name || name === 'zzz')) {
      name = hourglassIcon(now)
      badge = ch.shellCount
    }
    if (name) {
      const bounce =
        name === 'alert'
          ? Math.abs(Math.sin(now / 180)) * 4
          : name === 'zzz'
            ? Math.sin(now / 500) * 1.5
            : name === 'hourglass' || name === 'hourglass_flip'
              ? now % HOURGLASS_FLIP_MS < 110
                ? 1
                : 0
              : Math.max(0, 1 - (now - ch.iconAt) / 250) * 4
      const lift = name === 'storm' ? STORM_LIFT : 0
      this.pushIcon(x, head.y - 2 - lift, name, bounce, ch.alpha, badge)
      if (name === 'storm' && Math.random() < this.dt * 24) this.particles.rain(x - 3 + Math.random() * 7, head.y - 3 - lift, lift + 2)
    }
    if (shell && ch.shellStage === 'nap' && ch.pose === 'sleep') this.pushIcon(x + 10, head.y - 13, 'zzz', Math.sin(now / 500) * 1.5, ch.alpha, 0)
  }

  private pushIcon(x: number, y: number, name: IconName, bounce: number, alpha: number, badge: number): void {
    if (this.iconCount >= 256) return
    let ic = this.icons[this.iconCount]
    if (!ic) this.icons[this.iconCount] = ic = { x: 0, y: 0, name, alpha: 1, bounce: 0, badge: 0 }
    ic.x = x
    ic.y = y
    ic.name = name
    ic.alpha = alpha * this.iconK
    ic.bounce = bounce
    ic.badge = badge
    this.iconCount++
  }

  private drawRing(x: number, y: number, color: string, k: number, alpha: number, r: number, fill?: string): void {
    const { ctx } = this
    ctx.save()
    ctx.globalAlpha *= alpha
    ctx.beginPath()
    ctx.ellipse(x, y, r * k, r * this.view.params.k * k, 0, 0, Math.PI * 2)
    if (fill) {
      ctx.fillStyle = fill
      ctx.fill()
    }
    ctx.strokeStyle = color
    ctx.lineWidth = fill ? 1.25 : 1
    ctx.stroke()
    ctx.restore()
  }

  private drawPingPong(now: number): void {
    const { ctx } = this
    for (const g of this.sim.social.gatherings) {
      if (g.kind !== 'pingpong' || g.phase !== 'run') continue
      let a: Character | undefined
      let b: Character | undefined
      for (const m of g.members) {
        if (m.role !== 'player' || m.left) continue
        if (!a) a = this.sim.chars.get(m.id)
        else b = this.sim.chars.get(m.id)
      }
      if (!a || !b || a.inside || b.inside) continue
      const ga = this.groundOf(a)
      const gb = this.groundOf(b)
      const ball = pingPongBall(ga, gb, g.startAt, now)
      const shadow = this.view.toView(ball.x, ball.y)
      const p = this.view.toView(ball.x, ball.y, PING_TABLE_H + ball.arc)
      ctx.save()
      ctx.fillStyle = 'rgba(30,40,60,0.28)'
      ctx.beginPath()
      ctx.ellipse(shadow.x, shadow.y - PING_TABLE_H, BALL_R * 1.2, BALL_R * 0.6, 0, 0, Math.PI * 2)
      ctx.fill()
      const grad = ctx.createRadialGradient(p.x - BALL_R * 0.4, p.y - BALL_R * 0.4, 0.1, p.x, p.y, BALL_R)
      grad.addColorStop(0, '#ffffff')
      grad.addColorStop(1, '#e9e4da')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(p.x, p.y, BALL_R, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  private drawCobwebs(now: number): void {
    if (this.sim.visit) return
    const { ctx } = this
    for (const ch of this.sim.chars.values()) {
      if (ch.mode !== 'shell' || !ch.shellSince || ch.leaving || !ch.seated || ch.atSpot !== ch.homeSpot) continue
      const scale = cobwebScale(now - ch.shellSince)
      if (!scale) continue
      const head = this.heads.get(ch.id)
      if (!head || !head.visible) continue
      const busyL = this.neighborAt(head, -1)
      const busyR = this.neighborAt(head, 1)
      const side = cobwebSide(ch.info.seed, busyL, busyR)
      ctx.save()
      ctx.globalAlpha = ch.alpha
      this.drawWeb(head, side === 'left', scale === 2 ? 1.5 : 1, side === 'left' ? busyL : busyR)
      if (ch.shellStage === 'nap') this.drawWeb(head, side !== 'left', 1, side === 'left' ? busyR : busyL)
      ctx.restore()
    }
  }

  private drawWeb(head: HeadInfo, left: boolean, scale: number, crowded: boolean): void {
    const size = WEB_SIZE * scale
    const out = crowded ? Math.min(size * 0.8, WEB_MAX_OUT) : size * 0.8
    const y = head.by + 3
    if (left) drawCobweb(this.ctx, head.bx - out, y, size, false)
    else drawCobweb(this.ctx, head.bx + head.bw + out, y, size, true)
  }

  private neighborAt(head: HeadInfo, side: -1 | 1): boolean {
    for (const h of this.heads.values()) {
      if (h === head || !h.visible || Math.abs(h.feetY - head.feetY) > NEIGHBOR_DY) continue
      const dx = (h.x - head.x) * side
      if (dx > 0 && dx < NEIGHBOR_DX) return true
    }
    return false
  }

  private emitRoomFx(now: number, dt: number, v: ScreenBox): void {
    const fxs = this.sim.roomFx.active
    if (!fxs.size) {
      if (this.confettiAcc.size) this.confettiAcc.clear()
      return
    }
    const still = reducedMotion()
    for (const [id, fx] of fxs) {
      const room = this.sim.rooms.get(fx.roomId)
      if (fx.kind !== 'party' || now >= fx.end || still || !room || !room.present || room.phase === 'dismantling') {
        this.confettiAcc.delete(id)
        continue
      }
      const r = room.layout.rect
      const fl = { x: (r.x + 0.5) * TILE, y: (r.y + 2) * TILE, w: (r.w - 1) * TILE, h: (r.h - 3) * TILE }
      const sb = this.view.bounds(fl, CONFETTI_DROP)
      if (sb.x > v.x1 || sb.x + sb.w < v.x0 || sb.y > v.y1 || sb.y + sb.h < v.y0) continue
      const k = Math.min(1, (fx.end - now) / 2000) * (now - fx.start < 1500 ? 1.6 : 1)
      let a = (this.confettiAcc.get(id) ?? 0) + Math.min(0.1, dt) * CONFETTI_RATE * k
      while (a >= 1) {
        a -= 1
        const g = this.view.toView(fl.x + 2 + Math.random() * (fl.w - 4), fl.y + 2 + Math.random() * (fl.h - 4))
        const top = g.y - CONFETTI_DROP - Math.random() * 8
        this.particles.confettiFall(g.x, top, g.y - top)
      }
      this.confettiAcc.set(id, a)
    }
    for (const id of this.confettiAcc.keys()) if (!fxs.has(id)) this.confettiAcc.delete(id)
  }

  private drawAlarmLights(now: number, v: ScreenBox): void {
    const fxs = this.sim.roomFx.active
    if (!fxs.size) return
    const { ctx } = this
    const still = reducedMotion()
    for (const fx of fxs.values()) {
      if (fx.kind !== 'alarm' || now >= fx.end) continue
      const fade = fxFade(fx, now)
      const room = this.sim.rooms.get(fx.roomId)
      if (room && room.present && room.phase !== 'dismantling') {
        const r = room.layout.rect
        const sb = this.view.bounds({ x: r.x * TILE, y: r.y * TILE, w: r.w * TILE, h: r.h * TILE }, WALL_H)
        if (!(sb.x > v.x1 || sb.x + sb.w < v.x0 || sb.y > v.y1 || sb.y + sb.h < v.y0)) this.drawBeacons(r, now - fx.start, fade, still)
      }
      const head = fx.agentId ? this.heads.get(fx.agentId) : undefined
      if (head?.visible) {
        const bob = still ? 0 : Math.abs(Math.sin((now - fx.start) / 260)) * 2
        ctx.save()
        ctx.globalAlpha = fade
        drawBang(ctx, head.x + 5, head.y - 3 - bob)
        ctx.restore()
      }
    }
  }

  private drawBeacons(r: { x: number; y: number; w: number; h: number }, t: number, fade: number, still: boolean): void {
    const { ctx } = this
    const ph = still ? 0 : t / BEACON_SPIN_MS
    const baseY = (r.y + 2) * TILE
    const spots = [r.x * TILE + BEACON_INSET, (r.x + r.w) * TILE - BEACON_INSET]
    const fl = { x: (r.x + 0.5) * TILE, y: baseY, w: (r.w - 1) * TILE, h: (r.h - 3) * TILE }
    if (!still) {
      const sweep = softGlow(ALARM_RED, 128)
      if (sweep) {
        ctx.save()
        ctx.transform(...this.view.ground)
        ctx.beginPath()
        ctx.rect(fl.x, fl.y, fl.w, fl.h)
        ctx.clip()
        const cx = fl.x + fl.w / 2
        const cy = fl.y + fl.h / 2
        for (let i = 0; i < 2; i++) {
          const a = ph * Math.PI * 2 + i * Math.PI
          ctx.globalAlpha = 0.3 * fade
          ctx.drawImage(sweep, cx + Math.cos(a) * fl.w * 0.3 - 64, cy + Math.sin(a) * fl.h * 0.3 - 64, 128, 128)
        }
        ctx.restore()
      }
    }
    const halo = softGlow(ALARM_RED, 64)
    for (const [i, x] of spots.entries()) {
      const p = this.view.toView(x, baseY, WALL_H)
      const facing = still ? 0.6 : Math.max(0, Math.cos((ph + i * 0.5) * Math.PI * 2))
      ctx.save()
      if (halo) {
        ctx.globalAlpha = (0.25 + 0.75 * facing) * fade
        ctx.drawImage(halo, p.x - 32, p.y - 36, 64, 64)
      }
      ctx.globalAlpha = fade
      drawBeacon(ctx, p.x, p.y, ph + i * 0.5, still)
      ctx.restore()
    }
  }

  private drawGlows(now: number, v: ScreenBox): void {
    const { ctx } = this
    const amb = this.lighting.ambient
    const n = amb.night
    const cool = softGlow(COOL, 64, 0.9)
    const warm = glowSprite('#ffcf7a', 64)
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.imageSmoothingEnabled = true
    const near = (x: number, y: number, m: number) => x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m
    for (const s of this.statics) {
      if (s.kind !== 'furn' || !s.area) continue
      const f = s.furn
      const room = s.area.room
      const dark = room ? 1 - room.light(now) : 0
      const ra = this.revealAlpha(s.area.id)
      const k = Math.max(n, dark) * ra
      if (Math.max(n, dark) < 0.2 || !near(s.pivot.x, s.pivot.y, 80)) continue
      if (room && room.phase !== 'ready') continue
      if (f.kind === 'desk' || f.kind === 'desk_back') {
        const mode = this.deskScreen(f, s.area)
        if (mode === 'off' || !cool) continue
        const c = this.glowAt(s, 'screen', 14)
        ctx.globalAlpha = (mode === 'idle' ? 0.2 : 0.35) * k
        ctx.drawImage(cool, c.x - MONITOR_GLOW / 2, c.y - MONITOR_GLOW / 2, MONITOR_GLOW, MONITOR_GLOW)
      } else if (f.kind === 'floor_lamp' && n > 0.2 && (!room || room.lightOn)) {
        const c = this.glowAt(s, 'glow', 40)
        ctx.globalAlpha = 0.5 * n * ra
        ctx.drawImage(warm, c.x - BULB_GLOW / 2, c.y - BULB_GLOW / 2, BULB_GLOW, BULB_GLOW)
      } else if ((f.kind === 'vending_machine' || f.kind === 'arcade') && cool) {
        const c = this.glowAt(s, 'screen', 28)
        ctx.globalAlpha = 0.25 * k
        ctx.drawImage(cool, c.x - MACHINE_GLOW / 2, c.y - MACHINE_GLOW / 2, MACHINE_GLOW, MACHINE_GLOW)
      }
    }
    if (n > 0.2 && cool) {
      for (const vis of this.areas.values()) {
        for (const w of vis.wallItems) {
          if (w.kind !== 'tv') continue
          const p = this.view.toView(w.cx, w.baseY, WALL_H * 0.45)
          if (!near(p.x, p.y, TV_GLOW)) continue
          ctx.globalAlpha = 0.3 * n * this.revealAlpha(vis.id)
          ctx.drawImage(cool, p.x - TV_GLOW / 2, p.y - TV_GLOW / 2, TV_GLOW, TV_GLOW)
        }
      }
    }
    this.drawSunbeams()
    ctx.restore()
  }

  private glowAt(s: FurnEnt, rect: 'screen' | 'glow', up: number): { x: number; y: number } {
    const b = s.sprite?.rects[rect]
    const r = b ? this.spriteRect(s, b) : null
    if (r) return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
    return { x: s.pivot.x, y: s.pivot.y - up }
  }

  private drawSunbeams(): void {
    const sun = sunbeamAt(this.lighting.ambient.hour)
    if (!sun) return
    const img = beamSprite(mixRgb([255, 226, 160], [255, 150, 64], this.lighting.ambient.warm))
    if (!img) return
    const { ctx } = this
    for (const vis of this.areas.values()) {
      if (vis.layout.rect.y !== 0) continue
      if (vis.room && vis.room.phase !== 'ready') continue
      const ws = vis.wallItems.filter((w) => w.kind === 'window')
      if (!ws.length) continue
      const f = floorRect(vis)
      ctx.save()
      ctx.transform(...this.view.ground)
      ctx.beginPath()
      ctx.rect(f.x0, f.y0, f.x1 - f.x0, f.y1 - f.y0 - TILE)
      ctx.clip()
      ctx.globalAlpha = sun.alpha
      for (const w of ws) {
        const g = this.windowGlass(w)
        if (!g) continue
        ctx.save()
        ctx.transform(1, 0, sun.skew, 1, g.x - sun.skew * w.baseY, 0)
        ctx.drawImage(img, 0, w.baseY, g.w, sun.len)
        ctx.restore()
      }
      ctx.restore()
    }
  }

  private windowGlass(w: WallVis): { x: number; w: number } | null {
    const sp = wallItemArt(this.art3d, 'window', w.variant)
    if (sp?.rects.glass) {
      const g = this.wallSub(this.wallRect(sp, w.cx, w.baseY), sp.rects.glass)
      if (g) return { x: g.x, w: g.w }
    }
    const s = wallSprites(this.art, 'window', w.variant, 0, w.seed)
    if (!s) return null
    const o = wallItemOrigin(w, s.base)
    const g = s.base.rects?.glass
    return g ? { x: o.x + g.x, w: g.w } : { x: o.x + 3, w: s.base.canvas.width - 6 }
  }

  private drainEffects(now: number): void {
    const fx = this.sim.effects
    for (const e of fx) {
      const head = this.heads.get(e.charId)
      if (!head || !head.visible || now - e.at > 1500) continue
      if (e.kind === 'confetti') this.particles.confetti(head.x, head.y - 4)
      else if (e.kind === 'sparkle') this.particles.sparkle(head.x, head.y + 4)
      else if (e.kind === 'coins') {
        const to = this.heads.get(e.toId)
        if (to && to.visible) this.particles.coins(head.x, head.y + 2, to.x, to.y + 2)
      }
    }
    fx.length = 0
  }

  private icon(name: IconName): Sprite | null {
    try {
      const s = this.art.iconSprite(name)
      if (s && s.canvas.width > 0) return s
    } catch {
      return fallbackIcon(name)
    }
    return fallbackIcon(name)
  }

  pruneHeads(): void {
    for (const id of this.heads.keys()) if (!this.sim.person(id)) this.heads.delete(id)
  }

  roomInSlot(slot: number): RoomState | undefined {
    if (!this.occupiedSlots.has(slot)) return undefined
    for (const r of this.sim.rooms.values()) if (r.slot === slot && r.present) return r
    return undefined
  }

  paintingRect(): ViewRect | null {
    return null
  }

  signRect(vis: AreaVis): ViewRect | null {
    const sign = this.signOf(vis)
    const sp = sign ? wallItemArt(this.art3d, 'sign', sign.variant) : null
    if (!sign || !sp?.rects.sign || !this.signName(vis)) return null
    const L = this.signLayout(vis, sign)
    if (!L?.fit) return null
    const b = this.grownSign(L).box
    const [a, bb, c, d, e, f] = this.view.wallMatrix(sign.baseY)
    const xs = [b.x, b.x + b.w]
    const ys = [b.y, b.y + b.h]
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (const x of xs) {
      for (const y of ys) {
        const vx = a * x + c * y + e
        const vy = bb * x + d * y + f
        x0 = Math.min(x0, vx)
        y0 = Math.min(y0, vy)
        x1 = Math.max(x1, vx)
        y1 = Math.max(y1, vy)
      }
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  }

  signIsDark(): boolean {
    return false
  }

  get staticCount(): number {
    return this.statics.length
  }

  private safe(fn: () => void): void {
    try {
      fn()
    } catch {
      return
    }
  }
}

export function createIsoRenderer(canvas: HTMLCanvasElement, art: ArtModule, sim: Sim, camera: Camera): WorldRenderer {
  return new IsoRenderer(canvas, art, sim, camera, isoProjection, loadedIsoArt() ?? isoArt())
}
