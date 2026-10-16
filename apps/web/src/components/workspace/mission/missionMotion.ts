import { motionMs } from '../../../lib/motion'
import { flipFrames } from '../../../lib/rail/mission'

export type DurToken = 'press' | 'fast' | 'base' | 'slow' | 'emph'
export type EaseToken = 'out-quint' | 'spring' | 'exit'

const DUR_FALLBACK: Record<DurToken, number> = { press: 100, fast: 150, base: 220, slow: 300, emph: 520 }
const STAGGER_FALLBACK = 28
const tokens = new Map<string, string>()

function token(name: string): string {
  const known = tokens.get(name)
  if (known !== undefined) return known
  const value = typeof document === 'undefined' ? '' : getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  if (value) tokens.set(name, value)
  return value
}

export function parseDuration(value: string): number | null {
  const m = /^(\d*\.?\d+)(ms|s)$/.exec(value.trim())
  return m ? Number(m[1]) * (m[2] === 's' ? 1000 : 1) : null
}

export function ease(name: EaseToken): string {
  return token(`--ease-${name}`) || 'ease-out'
}

export function dur(name: DurToken, factor = 1): number {
  return motionMs(Math.round((parseDuration(token(`--ccm-dur-${name}`)) ?? DUR_FALLBACK[name]) * factor))
}

export function stagger(): number {
  return motionMs(parseDuration(token('--ccm-stagger')) ?? STAGGER_FALLBACK)
}

type Box = { left: number; top: number; width: number; height: number }

const running = new WeakMap<HTMLElement, Animation[]>()

export function stopFlip(el: HTMLElement): void {
  const list = running.get(el)
  if (!list) return
  running.delete(el)
  for (const a of list) a.cancel()
}

export function viewportBox(el: HTMLElement): Box {
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top, width: r.width, height: r.height }
}

export function layoutBox(el: HTMLElement): Box {
  return { left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight }
}

export interface FlipItem {
  el: HTMLElement
  from: Box | undefined
  inner?: HTMLElement | null
  scale?: boolean
}

export function flipAll(items: readonly FlipItem[], opts: { ms: number; easing: string; measure?: (el: HTMLElement) => Box }): Promise<void> {
  if (!opts.ms) return Promise.resolve()
  const live = items.filter((x): x is FlipItem & { from: Box } => !!x.from && x.el.isConnected)
  for (const x of live) {
    stopFlip(x.el)
    if (x.inner) stopFlip(x.inner)
  }
  const measure = opts.measure ?? viewportBox
  const tos = live.map((x) => measure(x.el))
  const done: Promise<unknown>[] = []
  live.forEach((x, i) => {
    const frames = flipFrames(x.from, tos[i]!, { scale: x.scale !== false })
    if (!frames) return
    const timing: KeyframeAnimationOptions = { duration: opts.ms, easing: opts.easing }
    const outer = x.el.animate(frames.outer, timing)
    running.set(x.el, [outer])
    if (frames.inner && x.inner) running.set(x.inner, [x.inner.animate(frames.inner, timing)])
    done.push(
      outer.finished
        .catch(() => undefined)
        .then(() => {
          if (running.get(x.el)?.[0] === outer) running.delete(x.el)
        }),
    )
  })
  return Promise.all(done).then(() => undefined)
}
