import type { FloorKind, WallPattern } from '@ccm/habblaud/client/src/art/api'

export const ISO3D_DIR = '/assets/iso3d/'
export const ISO3D_ROOT = `${ISO3D_DIR}manifest.json`

export interface IsoImage {
  src: CanvasImageSource
  w: number
  h: number
}

export type Pt = readonly [number, number]
export type Box4 = readonly [number, number, number, number]

export type CharAnchor = 'feet' | 'seat'

export interface CharAnim {
  row: number
  frames: number
  ms: number
  anchor: CharAnchor
}

export interface CharArchetypeDef {
  id: string
  look: 'f' | 'm'
  name: string
  sheet: string
  anims: Record<string, CharAnim>
}

export interface CharManifest {
  scale: number
  viewScale: number | null
  standH: number | null
  frame: { w: number; h: number }
  anchors: { feet: Pt; head: Pt; chest: Pt; hand: Pt; seat: Pt }
  archetypes: CharArchetypeDef[]
}

export interface CharArt extends CharManifest {
  sheets: Map<string, IsoImage>
}

export type FurnRectName = 'screen' | 'board' | 'tv' | 'glass' | 'face' | 'art' | 'sign' | 'door' | 'opening' | 'glow'

export interface FurnItemDef {
  file: string
  front: string | null
  anchor: Pt
  footprint: Pt | null
  height: number | null
  rects: Partial<Record<FurnRectName, Box4>>
}

export interface FurnManifest {
  scale: number
  items: Record<string, FurnItemDef>
}

export interface FurnArt {
  key: string
  img: IsoImage
  front: IsoImage | null
  anchor: Pt
  footprint: Pt | null
  height: number | null
  rects: Partial<Record<FurnRectName, Box4>>
  scale: number
}

export interface SurfaceDef {
  file: string
  tile: Pt
  tiles: number
  tint: boolean
  cap: string | null
}

export interface SurfacesManifest {
  scale: number
  floors: Record<string, SurfaceDef>
  walls: Record<string, SurfaceDef>
  rugs: Record<string, SurfaceDef>
}

export interface SurfaceArt extends SurfaceDef {
  key: string
  img: IsoImage
}

export interface WallArtDef {
  id: string
  kind: 'painting' | 'poster'
  file: string
  tiles: number
  variant: string | null
  framed: string | null
}

export interface IsoWallArt {
  id: string
  kind: 'painting' | 'poster'
  tiles: number
  variant: string | null
  img: IsoImage
  framed: IsoImage | null
}

export interface SeasonalItemDef {
  file: string
  anchor: Pt
  footprint: Pt | null
  wall: boolean
}

export interface SeasonalManifest {
  scale: number
  items: Record<string, SeasonalItemDef>
}

export interface SeasonalArt extends FurnArt {
  wall: boolean
}

export interface IconItemDef {
  file: string
  size: Pt | null
  anchor: Pt | null
}

export interface IconManifest {
  scale: number
  items: Record<string, IconItemDef>
}

export interface IconArt {
  key: string
  img: IsoImage
  size: Pt
  anchor: Pt
  scale: number
}

export interface IsoArt {
  missing: boolean
  chars: CharArt | null
  furniture: Map<string, FurnArt>
  floors: Map<string, SurfaceArt>
  walls: Map<string, SurfaceArt>
  rugs: SurfaceArt[]
  wallArt: IsoWallArt[]
  seasonal?: Map<string, SeasonalArt>
  icons?: Map<string, IconArt>
}

export interface RootManifest {
  scale: number
  chars: string | null
  furniture: string | null
  surfaces: string | null
  wallArt: string | null
  seasonal: string | null
  icons: string | null
}

export const DEFAULT_ROOT: RootManifest = {
  scale: 2,
  chars: 'chars/manifest.json',
  furniture: 'furniture/manifest.json',
  surfaces: 'surfaces/manifest.json',
  wallArt: 'wallart/manifest.json',
  seasonal: 'seasonal/manifest.json',
  icons: 'icons/manifest.json',
}

export const EMPTY_ART: IsoArt = Object.freeze({
  missing: true,
  chars: null,
  furniture: new Map(),
  floors: new Map(),
  walls: new Map(),
  rugs: [],
  wallArt: [],
  seasonal: new Map(),
  icons: new Map(),
}) as IsoArt

const FILE_RE = /^[A-Za-z0-9_@.-]+(\/[A-Za-z0-9_@.-]+)*$/
const ID_RE = /^[a-z0-9-]{1,32}$/
const ANIM_RE = /^[a-z][a-z0-9_]{0,47}$/
const FURN_KEY_RE = /^(wall:)?[a-z][a-z_]{0,31}(:[a-z0-9_-]{1,32})?$/
const ITEM_KEY_RE = /^[a-z][a-z0-9_]{0,31}(:[a-z0-9_-]{1,32})?$/
const COLOR_RE = /^#[0-9a-f]{6}$/i
const RECTS: readonly FurnRectName[] = ['screen', 'board', 'tv', 'glass', 'face', 'art', 'sign', 'door', 'opening', 'glow']
const FLOORS: readonly FloorKind[] = ['carpet', 'wood', 'tile_check', 'tile_white', 'concrete', 'marble', 'grass', 'sidewalk', 'street']
const WALLS: readonly WallPattern[] = ['plain', 'stripes', 'tiles', 'wood_panel', 'brick', 'glass', 'marble']

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const num = (v: unknown, min = -Infinity, max = Infinity): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const int = (v: unknown, min: number, max: number): v is number => num(v, min, max) && Number.isInteger(v)

export function validFile(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0 && v.length <= 160 && FILE_RE.test(v) && !v.split('/').some((p) => p === '..' || p === '.')
}

function pt(v: unknown, min = -4096, max = 4096): Pt | null {
  return Array.isArray(v) && v.length === 2 && num(v[0], min, max) && num(v[1], min, max) ? [v[0], v[1]] : null
}

function box4(v: unknown): Box4 | null {
  if (!Array.isArray(v) || v.length !== 4) return null
  const [x, y, w, h] = v as unknown[]
  if (!num(x, -4096, 4096) || !num(y, -4096, 4096) || !num(w, 0, 4096) || !num(h, 0, 4096)) return null
  return w > 0 && h > 0 ? [x, y, w, h] : null
}

function scaleOf(v: unknown, fallback = 2): number {
  return num(v, 0.25, 8) ? v : fallback
}

export function parseRoot(raw: unknown): RootManifest | null {
  const o = obj(raw)
  if (!o) return null
  const sub = (k: keyof Omit<RootManifest, 'scale'>): string | null => (validFile(o[k]) ? (o[k] as string) : null)
  return { scale: scaleOf(o.scale), chars: sub('chars'), furniture: sub('furniture'), surfaces: sub('surfaces'), wallArt: sub('wallArt'), seasonal: sub('seasonal'), icons: sub('icons') }
}

export function parseSeasonalManifest(raw: unknown): SeasonalManifest | null {
  const o = obj(raw)
  const items = obj(o?.items)
  if (!o || !items) return null
  const out: Record<string, SeasonalItemDef> = {}
  for (const [key, v] of Object.entries(items)) {
    const r = obj(v)
    if (!r || !ITEM_KEY_RE.test(key) || !validFile(r.file)) continue
    const anchor = pt(r.anchor)
    if (!anchor) continue
    out[key] = { file: r.file, anchor, footprint: pt(r.footprint, 0.25, 16), wall: r.wall === true }
  }
  return { scale: scaleOf(o.scale), items: out }
}

export function parseIconManifest(raw: unknown): IconManifest | null {
  const o = obj(raw)
  const items = obj(o?.items)
  if (!o || !items) return null
  const out: Record<string, IconItemDef> = {}
  for (const [key, v] of Object.entries(items)) {
    const r = obj(v)
    if (!r || !ITEM_KEY_RE.test(key) || !validFile(r.file)) continue
    const size = pt(r.size, 1, 1024)
    out[key] = { file: r.file, size, anchor: pt(r.anchor) }
  }
  return { scale: scaleOf(o.scale), items: out }
}

export function parseCharManifest(raw: unknown): CharManifest | null {
  const o = obj(raw)
  if (!o) return null
  const frame = obj(o.frame)
  if (!frame || !int(frame.w, 1, 2048) || !int(frame.h, 1, 2048)) return null
  const a = obj(o.anchors) ?? {}
  const feet = pt(a.feet)
  if (!feet) return null
  const head = pt(a.head) ?? [feet[0], feet[1] - frame.h * 0.78]
  const chest = pt(a.chest) ?? [feet[0], (feet[1] + head[1]) / 2 - frame.h * 0.1]
  const hand = pt(a.hand) ?? [feet[0] + frame.w * 0.15, (feet[1] + head[1]) / 2]
  const seat = pt(a.seat) ?? [feet[0], feet[1] - frame.h * 0.22]
  if (!Array.isArray(o.archetypes) || o.archetypes.length < 1 || o.archetypes.length > 12) return null
  const archetypes: CharArchetypeDef[] = []
  const seen = new Set<string>()
  for (const it of o.archetypes) {
    const r = obj(it)
    if (!r) continue
    const { id, look, sheet } = r
    if (typeof id !== 'string' || !ID_RE.test(id) || seen.has(id) || (look !== 'f' && look !== 'm') || !validFile(sheet)) continue
    const anims: Record<string, CharAnim> = {}
    for (const [name, v] of Object.entries(obj(r.anims) ?? {})) {
      const an = obj(v)
      if (!ANIM_RE.test(name) || !an || !int(an.row, 0, 256) || !int(an.frames, 1, 64)) continue
      const ms = num(an.ms, 0, 60_000) ? an.ms : 0
      anims[name] = { row: an.row, frames: an.frames, ms, anchor: an.anchor === 'seat' ? 'seat' : 'feet' }
    }
    if (!Object.keys(anims).length) continue
    seen.add(id)
    archetypes.push({ id, look, name: typeof r.name === 'string' ? r.name.slice(0, 40) : id, sheet, anims })
  }
  if (!archetypes.length) return null
  const fig = obj(o.figure)
  return {
    scale: scaleOf(o.scale),
    viewScale: num(o.viewScale, 0.02, 4) ? o.viewScale : null,
    standH: fig && num(fig.standH, 1, frame.h) ? fig.standH : null,
    frame: { w: frame.w, h: frame.h },
    anchors: { feet, head, chest, hand, seat },
    archetypes,
  }
}

export function parseFurnitureManifest(raw: unknown): FurnManifest | null {
  const o = obj(raw)
  const items = obj(o?.items)
  if (!o || !items) return null
  const out: Record<string, FurnItemDef> = {}
  for (const [key, v] of Object.entries(items)) {
    const r = obj(v)
    if (!r || !FURN_KEY_RE.test(key) || !validFile(r.file)) continue
    const anchor = pt(r.anchor)
    if (!anchor) continue
    const rects: Partial<Record<FurnRectName, Box4>> = {}
    const rr = obj(r.rects)
    if (rr) for (const n of RECTS) {
      const b = box4(rr[n])
      if (b) rects[n] = b
    }
    const fp = pt(r.footprint, 0.25, 16)
    out[key] = {
      file: r.file,
      front: validFile(r.front) ? r.front : null,
      anchor,
      footprint: fp,
      height: num(r.height, 0, 16) ? r.height : null,
      rects,
    }
  }
  return { scale: scaleOf(o.scale), items: out }
}

function parseSurfaceGroup(v: unknown, allowed: readonly string[] | null): Record<string, SurfaceDef> {
  const out: Record<string, SurfaceDef> = {}
  for (const [key, it] of Object.entries(obj(v) ?? {})) {
    const r = obj(it)
    if (!r || !validFile(r.file) || (allowed ? !allowed.includes(key) : !ID_RE.test(key))) continue
    const tile = pt(r.tile, 1, 4096) ?? [64, 64]
    out[key] = {
      file: r.file,
      tile,
      tiles: int(r.tiles, 1, 8) ? r.tiles : 1,
      tint: r.tint === true,
      cap: typeof r.cap === 'string' && COLOR_RE.test(r.cap) ? r.cap : null,
    }
  }
  return out
}

export function parseSurfacesManifest(raw: unknown): SurfacesManifest | null {
  const o = obj(raw)
  if (!o) return null
  return {
    scale: scaleOf(o.scale),
    floors: parseSurfaceGroup(o.floors, FLOORS),
    walls: parseSurfaceGroup(o.walls, WALLS),
    rugs: parseSurfaceGroup(o.rugs, null),
  }
}

export function parseWallArtManifest(raw: unknown): WallArtDef[] {
  const list = Array.isArray(raw) ? raw : obj(raw)?.wallArt
  if (!Array.isArray(list)) return []
  const out: WallArtDef[] = []
  const seen = new Set<string>()
  for (const it of list.slice(0, 64)) {
    const r = obj(it)
    if (!r || (r.kind !== 'painting' && r.kind !== 'poster') || !validFile(r.file)) continue
    const id = typeof r.id === 'string' && r.id ? r.id.slice(0, 64) : r.file
    if (seen.has(id)) continue
    seen.add(id)
    const framed = obj(r.framed)
    out.push({
      id,
      kind: r.kind,
      file: r.file,
      tiles: int(r.tiles, 1, 8) ? r.tiles : r.kind === 'poster' ? 1 : 2,
      variant: typeof r.variant === 'string' ? r.variant : null,
      framed: framed && validFile(framed.file) ? framed.file : validFile(r.framed) ? (r.framed as string) : null,
    })
  }
  return out
}

export type JsonFetcher = (url: string) => Promise<unknown>
export type ImageDecoder = (url: string) => Promise<IsoImage | null>

export interface IsoArtLoaders {
  json?: JsonFetcher
  image?: ImageDecoder
}

export async function fetchJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    return (await res.json()) as unknown
  } catch {
    return null
  }
}

function elementImage(url: string): Promise<IsoImage | null> {
  if (typeof Image === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img.naturalWidth > 0 ? { src: img, w: img.naturalWidth, h: img.naturalHeight } : null)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

export async function decodeImage(url: string): Promise<IsoImage | null> {
  if (typeof createImageBitmap === 'function' && typeof fetch === 'function') {
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      const bmp = await createImageBitmap(await res.blob())
      return bmp.width > 0 ? { src: bmp, w: bmp.width, h: bmp.height } : null
    } catch {
      return elementImage(url)
    }
  }
  return elementImage(url)
}

function dirOf(path: string): string {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i + 1)
}

export async function loadIsoArt(loaders: IsoArtLoaders = {}): Promise<IsoArt> {
  const json = loaders.json ?? fetchJson
  const image = loaders.image ?? decodeImage
  const img = async (base: string, file: string | null): Promise<IsoImage | null> => {
    if (!file) return null
    try {
      const r = await image(`${ISO3D_DIR}${base}${file}`)
      return r && r.w > 0 && r.h > 0 ? r : null
    } catch {
      return null
    }
  }
  const read = async (path: string | null): Promise<unknown> => {
    if (!path) return null
    try {
      return await json(`${ISO3D_DIR}${path}`)
    } catch {
      return null
    }
  }
  const rootRaw = await read('manifest.json')
  const root = parseRoot(rootRaw) ?? DEFAULT_ROOT
  const [charsRaw, furnRaw, surfRaw, wallRaw, seasonalRaw, iconsRaw] = await Promise.all([
    read(root.chars),
    read(root.furniture),
    read(root.surfaces),
    read(root.wallArt),
    read(root.seasonal),
    read(root.icons),
  ])

  let chars: CharArt | null = null
  const cm = parseCharManifest(charsRaw)
  if (cm && root.chars) {
    const base = dirOf(root.chars)
    const sheets = new Map<string, IsoImage>()
    await Promise.all(
      cm.archetypes.map(async (a) => {
        const s = await img(base, a.sheet)
        if (s) sheets.set(a.id, s)
      }),
    )
    chars = { ...cm, sheets }
  }

  const furniture = new Map<string, FurnArt>()
  const fm = parseFurnitureManifest(furnRaw)
  if (fm && root.furniture) {
    const base = dirOf(root.furniture)
    await Promise.all(
      Object.entries(fm.items).map(async ([key, d]) => {
        const [main, front] = await Promise.all([img(base, d.file), img(base, d.front)])
        if (!main) return
        furniture.set(key, { key, img: main, front, anchor: d.anchor, footprint: d.footprint, height: d.height, rects: d.rects, scale: fm.scale })
      }),
    )
  }

  const floors = new Map<string, SurfaceArt>()
  const walls = new Map<string, SurfaceArt>()
  const rugs: SurfaceArt[] = []
  const sm = parseSurfacesManifest(surfRaw)
  if (sm && root.surfaces) {
    const base = dirOf(root.surfaces)
    const group = async (src: Record<string, SurfaceDef>, put: (s: SurfaceArt) => void) =>
      Promise.all(
        Object.entries(src).map(async ([key, d]) => {
          const i = await img(base, d.file)
          if (i) put({ ...d, key, img: i })
        }),
      )
    await Promise.all([group(sm.floors, (s) => floors.set(s.key, s)), group(sm.walls, (s) => walls.set(s.key, s)), group(sm.rugs, (s) => rugs.push(s))])
    rugs.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
  }

  const wallArt: IsoWallArt[] = []
  const wl = parseWallArtManifest(wallRaw)
  if (wl.length && root.wallArt) {
    const base = dirOf(root.wallArt)
    const loaded = await Promise.all(wl.map(async (d) => ({ d, i: await img(base, d.file), f: await img(base, d.framed) })))
    for (const { d, i, f } of loaded) if (i) wallArt.push({ id: d.id, kind: d.kind, tiles: d.tiles, variant: d.variant, img: i, framed: f })
  }

  const seasonal = new Map<string, SeasonalArt>()
  const sea = parseSeasonalManifest(seasonalRaw)
  if (sea && root.seasonal) {
    const base = dirOf(root.seasonal)
    await Promise.all(
      Object.entries(sea.items).map(async ([key, d]) => {
        const i = await img(base, d.file)
        if (i) seasonal.set(key, { key, img: i, front: null, anchor: d.anchor, footprint: d.footprint, height: null, rects: {}, scale: sea.scale, wall: d.wall })
      }),
    )
  }

  const icons = new Map<string, IconArt>()
  const ic = parseIconManifest(iconsRaw)
  if (ic && root.icons) {
    const base = dirOf(root.icons)
    await Promise.all(
      Object.entries(ic.items).map(async ([key, d]) => {
        const i = await img(base, d.file)
        if (!i) return
        const size: Pt = d.size ?? [i.w, i.h]
        icons.set(key, { key, img: i, size, anchor: d.anchor ?? [size[0] / 2, size[1]], scale: ic.scale })
      }),
    )
  }

  const any = !!chars?.sheets.size || furniture.size > 0 || floors.size > 0 || walls.size > 0 || rugs.length > 0 || wallArt.length > 0 || seasonal.size > 0 || icons.size > 0
  return { missing: !rootRaw && !any, chars, furniture, floors, walls, rugs, wallArt, seasonal, icons }
}

export const ISO_ART_BACKGROUND = 4
export const ISO_ART_URGENT = 8

export class Limiter {
  private active = 0
  private readonly queue: (() => void)[] = []

  constructor(private max: number) {}

  get limit(): number {
    return this.max
  }

  get running(): number {
    return this.active
  }

  raise(max: number): void {
    if (max <= this.max) return
    this.max = max
    this.pump()
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(() => {
        this.active++
        let p: Promise<T>
        try {
          p = task()
        } catch (e) {
          p = Promise.reject(e)
        }
        p.then(resolve, reject).finally(() => {
          this.active--
          this.pump()
        })
      })
      this.pump()
    })
  }

  private pump(): void {
    while (this.active < this.max && this.queue.length) this.queue.shift()!()
  }
}

let shared: Promise<IsoArt> | null = null
let settled: IsoArt | null = null
let limiter: Limiter | null = null

export function isoArt(opts: { urgent?: boolean } = {}): Promise<IsoArt> {
  if (shared) {
    if (opts.urgent) limiter?.raise(ISO_ART_URGENT)
    return shared
  }
  const lim = new Limiter(opts.urgent ? ISO_ART_URGENT : ISO_ART_BACKGROUND)
  limiter = lim
  const p = loadIsoArt({ image: (url) => lim.run(() => decodeImage(url)) }).catch(() => EMPTY_ART)
  shared = p
  void p.then((a) => {
    if (shared === p) settled = a
  })
  return p
}

export function loadedIsoArt(): IsoArt | null {
  return settled
}

export function isoArtLimiter(): Limiter | null {
  return limiter
}

export function resetIsoArt(): void {
  shared = null
  settled = null
  limiter = null
}

export function isoArtImages(art: IsoArt): IsoImage[] {
  const out: IsoImage[] = []
  const add = (i: IsoImage | null | undefined) => {
    if (i) out.push(i)
  }
  for (const s of art.chars?.sheets.values() ?? []) add(s)
  for (const f of art.furniture.values()) {
    add(f.img)
    add(f.front)
  }
  for (const s of art.floors.values()) add(s.img)
  for (const s of art.walls.values()) add(s.img)
  for (const s of art.rugs) add(s.img)
  for (const w of art.wallArt) {
    add(w.img)
    add(w.framed)
  }
  for (const s of art.seasonal?.values() ?? []) add(s.img)
  for (const s of art.icons?.values() ?? []) add(s.img)
  return out
}

export function releaseIsoArt(): number {
  const p = shared
  const art = settled
  shared = null
  settled = null
  limiter = null
  if (!art) {
    if (p) void p.then((a) => closeImages(a))
    return 0
  }
  return closeImages(art)
}

function closeImages(art: IsoArt): number {
  let n = 0
  for (const i of isoArtImages(art)) {
    const src = i.src as { close?: () => void }
    if (typeof src.close === 'function') {
      src.close()
      n++
    }
  }
  return n
}

let manifests: Promise<void> | null = null

export function prefetchIsoManifests(json: JsonFetcher = fetchJson): Promise<void> {
  manifests ??= (async () => {
    const root = parseRoot(await json(ISO3D_ROOT).catch(() => null)) ?? DEFAULT_ROOT
    await Promise.all([root.chars, root.furniture, root.surfaces, root.wallArt, root.seasonal, root.icons].map((p) => (p ? json(`${ISO3D_DIR}${p}`).catch(() => null) : null)))
  })()
  return manifests
}

export function resetIsoManifests(): void {
  manifests = null
}

export function furnitureArt(art: IsoArt | null, kind: string, variant?: string | null): FurnArt | null {
  if (!art) return null
  return (variant ? art.furniture.get(`${kind}:${variant}`) : undefined) ?? art.furniture.get(kind) ?? null
}

export function seasonalArt(art: IsoArt | null, prop: string | null, theme?: string | null): SeasonalArt | null {
  if (!art?.seasonal || !prop) return null
  return (theme ? art.seasonal.get(`${prop}:${theme}`) : undefined) ?? art.seasonal.get(prop) ?? null
}

export function iconArt(art: IsoArt | null, name: string): IconArt | null {
  return art?.icons?.get(name) ?? null
}

export function wallItemArt(art: IsoArt | null, kind: string, variant?: string | null): FurnArt | null {
  return furnitureArt(art, `wall:${kind}`, variant)
}

export function pickIsoWallArt(art: IsoArt | null, kind: 'painting' | 'poster', tiles: number, variant: string | null | undefined, seed: number): IsoWallArt | null {
  if (!art) return null
  let pool = art.wallArt.filter((a) => a.kind === kind && a.tiles === tiles)
  if (kind === 'poster' && variant) {
    const same = pool.filter((a) => a.variant === variant)
    if (same.length) pool = same
  }
  return pool.length ? pool[(seed >>> 0) % pool.length]! : null
}
