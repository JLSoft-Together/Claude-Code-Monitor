import { desktop } from './desktop'
import { reducedMotion } from './motion'

const MAX_PIXELS = 160_000
const DURATION_MS = 1000
const STAGGER_MS = 24
const KEEP_MS = 4000
const UNDO_LIMIT = 12
const GATHER_MS = 700
const FADE_MS = 150
const SCATTER_EASE = 'cubic-bezier(0.4, 0, 0.7, 1)'
const GATHER_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

export const UNDO_MS = 8000
export const GATHER_LAYER_MS = 540

export const layerOf = (x: number, width: number, layers: number, random: number): number =>
  Math.min(layers - 1, Math.max(0, Math.floor((layers * (random + (2 * x) / Math.max(1, width))) / 3)))

export const layerBand = (n: number, width: number, layers: number): [number, number] => [
  Math.max(0, Math.floor((((3 * n) / layers - 1) * width) / 2)),
  Math.min(width, Math.ceil((((3 * (n + 1)) / layers) * width) / 2)),
]

export interface Scatter {
  dx: number
  dy: number
  rot: number
}

export const travelOf = (width: number, height: number): number => Math.min(160, 48 + Math.max(width, height) * 0.3)

export function scatterOf(travel: number, r1: number, r2: number, r3: number): Scatter {
  const angle = -Math.PI / 2 + (r1 * 0.9 + 0.15) * (Math.PI / 2)
  const dist = travel * (0.55 + r2 * 0.6)
  return { dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist, rot: (r3 - 0.5) * 24 }
}

const pose = (s: Scatter, move: number, turn: number): string =>
  `translate3d(${s.dx * move}px, ${s.dy * move}px, 0) rotate(${s.rot * turn}deg)`

export const scatterFrames = (s: Scatter): Keyframe[] => [
  { transform: pose(s, 0, 0), opacity: 1 },
  { transform: pose(s, 0.3, 0.35), opacity: 0.85, offset: 0.35 },
  { transform: pose(s, 1, 1), opacity: 0 },
]

export const gatherFrames = (s: Scatter): Keyframe[] =>
  scatterFrames(s)
    .reverse()
    .map((f) => (typeof f.offset === 'number' ? { ...f, offset: 1 - f.offset } : f))

export const gatherDelay = (n: number, count: number): number =>
  count > 1 ? ((count - 1 - Math.min(count - 1, Math.max(0, n))) * (GATHER_MS - GATHER_LAYER_MS)) / (count - 1) : 0

export interface KeepStore<T> {
  put(key: string, value: T): void
  take(key: string): T | undefined
  drop(key: string): void
  has(key: string): boolean
  readonly size: number
}

export function keepStore<T>(limit: number, ttl: number, free: (value: T) => void): KeepStore<T> {
  const items = new Map<string, { value: T; timer: ReturnType<typeof setTimeout> }>()
  const take = (key: string): T | undefined => {
    const item = items.get(key)
    if (!item) return undefined
    clearTimeout(item.timer)
    items.delete(key)
    return item.value
  }
  const drop = (key: string): void => {
    const item = items.get(key)
    if (!item) return
    take(key)
    free(item.value)
  }
  return {
    put(key, value) {
      drop(key)
      items.set(key, { value, timer: setTimeout(() => drop(key), ttl) })
      for (const oldest of items.keys()) {
        if (items.size <= limit) break
        drop(oldest)
      }
    },
    take,
    drop,
    has: (key) => items.has(key),
    get size() {
      return items.size
    },
  }
}

let enabled = false

export function setDustEnabled(on: boolean): void {
  enabled = on
}

export const dustOn = (): boolean => enabled && !reducedMotion() && !!desktop?.captureRect

let host: HTMLDivElement | null = null
let playing = 0

function overlay(): HTMLDivElement {
  if (host?.isConnected) return host
  host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.dataset.dust = ''
  Object.assign(host.style, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '2147483000', overflow: 'hidden', contain: 'strict' })
  document.body.appendChild(host)
  return host
}

function track(delta: number): void {
  playing = Math.max(0, playing + delta)
  if (host) host.style.viewTransitionName = playing ? 'ccm-dust' : ''
}

export interface DustShot {
  rect: DOMRect
  image: ImageBitmap
}

export interface DustOutOptions {
  keep?: (el: HTMLElement) => string | undefined
}

interface DustLayer {
  lo: number
  width: number
  bitmap: ImageBitmap
}

interface Dust {
  w: number
  h: number
  layers: DustLayer[]
}

interface Flake {
  lo: number
  width: number
  canvas: HTMLCanvasElement
  scatter: Scatter
}

interface Ash {
  w: number
  travel: number
  flakes: Flake[]
  claimed: boolean
  freed: boolean
}

const ground = new WeakMap<Element, Dust>()

const drop = (dust: Dust | undefined): void => dust?.layers.forEach((l) => l.bitmap.close())

function stash(el: Element, dust: Dust): void {
  drop(ground.get(el))
  ground.set(el, dust)
  setTimeout(() => {
    if (ground.get(el) !== dust) return
    ground.delete(el)
    drop(dust)
  }, KEEP_MS)
}

function wipe(canvas: HTMLCanvasElement): void {
  canvas.remove()
  canvas.getContext('bitmaprenderer')?.transferFromImageBitmap(null)
  canvas.width = 0
  canvas.height = 0
}

function release(ash: Ash): void {
  ash.freed = true
  for (const f of ash.flakes) if (!f.canvas.isConnected) wipe(f.canvas)
}

const undo = keepStore<Ash>(UNDO_LIMIT, UNDO_MS, release)

export const dropKept = (key: string): void => undo.drop(key)

export const hasKept = (key: string): boolean => undo.has(key)

export const layerCount = (w: number, h: number): number => Math.min(16, Math.max(8, Math.round(Math.sqrt(w * h) / 25)))

const onScreen = (r: DOMRect): boolean => r.width >= 2 && r.height >= 2 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth

export async function captureEl(el: Element): Promise<DustShot | null> {
  if (!dustOn() || !desktop?.captureRect) return null
  const rect = el.getBoundingClientRect()
  if (!onScreen(rect)) return null
  try {
    const png = await desktop.captureRect({ x: rect.left, y: rect.top, width: rect.width, height: rect.height })
    if (!png?.byteLength) return null
    return { rect, image: await createImageBitmap(new Blob([png as BlobPart], { type: 'image/png' })) }
  } catch {
    return null
  }
}

async function grind(image: ImageBitmap): Promise<Dust | null> {
  const scale = Math.min(1, Math.sqrt(MAX_PIXELS / Math.max(1, image.width * image.height)))
  const w = Math.max(1, Math.round(image.width * scale))
  const h = Math.max(1, Math.round(image.height * scale))
  const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    image.close()
    return null
  }
  ctx.drawImage(image, 0, 0, w, h)
  image.close()
  const src = new Uint32Array(ctx.getImageData(0, 0, w, h).data.buffer)
  const count = layerCount(w, h)
  const layers = Array.from({ length: count }, (_, n) => {
    const [lo, hi] = layerBand(n, w, count)
    const data = new ImageData(Math.max(1, hi - lo), h)
    return { lo, data, px: new Uint32Array(data.data.buffer) }
  })
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      const p = src[row + x]!
      if (!(p >>> 24)) continue
      const layer = layers[layerOf(x, w, count, Math.random())]!
      layer.px[y * layer.data.width + x - layer.lo] = p
    }
  }
  try {
    const bitmaps = await Promise.all(layers.map((l) => createImageBitmap(l.data)))
    return { w, h, layers: layers.map((l, i) => ({ lo: l.lo, width: l.data.width, bitmap: bitmaps[i]! })) }
  } catch {
    return null
  }
}

function paint(layer: DustLayer, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = layer.width
  canvas.height = height
  const bits = canvas.getContext('bitmaprenderer')
  if (bits) bits.transferFromImageBitmap(layer.bitmap)
  else {
    canvas.getContext('2d')?.drawImage(layer.bitmap, 0, 0)
    layer.bitmap.close()
  }
  Object.assign(canvas.style, { position: 'absolute', willChange: 'transform, opacity' })
  return canvas
}

function place(canvas: HTMLCanvasElement, rect: DOMRect, w: number, lo: number, width: number): void {
  const sx = rect.width / w
  Object.assign(canvas.style, { left: `${rect.left + lo * sx}px`, top: `${rect.top}px`, width: `${width * sx}px`, height: `${rect.height}px` })
}

function settle(canvas: HTMLCanvasElement, run: Animation, ash: Ash | undefined): void {
  if (ash?.claimed) return
  canvas.remove()
  if (!ash) return
  run.cancel()
  if (ash.freed) wipe(canvas)
}

function play(rect: DOMRect, dust: Dust, ash?: Ash): Promise<void> {
  const root = overlay()
  const travel = travelOf(rect.width, rect.height)
  if (ash) ash.travel = travel
  track(1)
  const runs = dust.layers.map((layer, n) => {
    const canvas = paint(layer, dust.h)
    place(canvas, rect, dust.w, layer.lo, layer.width)
    root.appendChild(canvas)
    const scatter = scatterOf(travel, Math.random(), Math.random(), Math.random())
    ash?.flakes.push({ lo: layer.lo, width: layer.width, canvas, scatter })
    const run = canvas.animate(scatterFrames(scatter), { duration: DURATION_MS, delay: n * STAGGER_MS, easing: SCATTER_EASE, fill: 'forwards' })
    return run.finished.catch(() => undefined).then(() => settle(canvas, run, ash))
  })
  return Promise.all(runs).then(() => track(-1))
}

function remember(key: string, dust: Dust): Ash {
  const ash: Ash = { w: dust.w, travel: 0, flakes: [], claimed: false, freed: false }
  undo.put(key, ash)
  return ash
}

function lock(el: HTMLElement): void {
  Object.assign(el.style, { transition: 'none', animation: 'none', opacity: '1' })
}

async function dustOf(el: Element): Promise<{ rect: DOMRect; dust: Dust } | null> {
  const ready = ground.get(el)
  if (ready) {
    ground.delete(el)
    return { rect: el.getBoundingClientRect(), dust: ready }
  }
  const shot = await captureEl(el)
  const dust = shot && (await grind(shot.image))
  return dust ? { rect: shot.rect, dust } : null
}

export async function dustOutAll(els: readonly HTMLElement[], later: readonly Element[] = [], opts: DustOutOptions = {}): Promise<boolean[]> {
  if (!dustOn()) return els.map(() => false)
  const keys = els.map((el) => opts.keep?.(el))
  for (const el of els) lock(el)
  const [now, saved] = await Promise.all([Promise.all(els.map(dustOf)), Promise.all(later.map(dustOf))])
  saved.forEach((got, i) => got && stash(later[i]!, got.dust))
  return els.map((el, i) => {
    const got = now[i]
    if (!got) {
      el.style.opacity = ''
      return false
    }
    const rect = el.getBoundingClientRect()
    el.style.visibility = 'hidden'
    const key = keys[i]
    void play(rect.width >= 2 && rect.height >= 2 ? rect : got.rect, got.dust, key ? remember(key, got.dust) : undefined)
    return true
  })
}

function fadeMs(): number {
  const ms = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ccm-dur-fast'))
  return Number.isFinite(ms) && ms > 0 ? ms : FADE_MS
}

export async function dustIn(el: HTMLElement, key: string): Promise<boolean> {
  const ash = undo.take(key)
  if (!ash) return false
  const rect = el.getBoundingClientRect()
  if (!dustOn() || !ash.flakes.length || !onScreen(rect)) {
    release(ash)
    return false
  }
  ash.claimed = true
  const group = document.createElement('div')
  group.dataset.dust = 'in'
  Object.assign(group.style, { position: 'absolute', inset: '0' })
  overlay().appendChild(group)
  const prev = { transition: el.style.transition, opacity: el.style.opacity }
  Object.assign(el.style, { transition: 'none', opacity: '0' })
  track(1)
  const k = travelOf(rect.width, rect.height) / Math.max(1, ash.travel)
  const count = ash.flakes.length
  const runs = ash.flakes.map((f, n) => {
    for (const run of f.canvas.getAnimations()) run.cancel()
    place(f.canvas, rect, ash.w, f.lo, f.width)
    group.appendChild(f.canvas)
    const s = { dx: f.scatter.dx * k, dy: f.scatter.dy * k, rot: f.scatter.rot }
    return f.canvas
      .animate(gatherFrames(s), { duration: GATHER_LAYER_MS, delay: gatherDelay(n, count), easing: GATHER_EASE, fill: 'both' })
      .finished.catch(() => undefined)
  })
  await Promise.all(runs)
  el.style.opacity = prev.opacity
  void group
    .animate([{ opacity: 1 }, { opacity: 0 }], { duration: fadeMs(), easing: GATHER_EASE, fill: 'forwards' })
    .finished.catch(() => undefined)
    .then(() => {
      group.remove()
      for (const f of ash.flakes) wipe(f.canvas)
      el.style.transition = prev.transition
      track(-1)
    })
  return true
}

let batch: Array<{ el: HTMLElement; done: (ok: boolean) => void }> = []

async function flush(): Promise<void> {
  const items = batch
  batch = []
  const ok = await dustOutAll(items.map((it) => it.el)).catch(() => items.map(() => false))
  items.forEach((it, i) => it.done(ok[i] ?? false))
}

export function dustOut(el: HTMLElement): Promise<boolean> {
  return new Promise((done) => {
    batch.push({ el, done })
    if (batch.length === 1) queueMicrotask(() => void flush())
  })
}

function fadeAway(el: HTMLElement, done: () => void): void {
  const ms = reducedMotion() ? 0 : fadeMs()
  if (!ms) return done()
  const ease = getComputedStyle(document.documentElement).getPropertyValue('--ease-exit').trim() || SCATTER_EASE
  el.animate([{ opacity: 1 }, { opacity: 0, transform: 'scale(0.98)' }], { duration: ms, easing: ease, fill: 'forwards' })
    .finished.catch(() => undefined)
    .then(done)
}

export function onDustLeave(el: Element, done: () => void): void {
  void dustOut(el as HTMLElement).then(
    (ok) => (ok ? done() : fadeAway(el as HTMLElement, done)),
    done,
  )
}
