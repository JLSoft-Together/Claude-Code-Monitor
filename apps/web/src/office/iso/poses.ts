import type { Dir, HeldItem, Pose } from '@ccm/habblaud/client/src/art/api'
import type { CharAnim } from './isoArt'

export type ViewDir = 'down' | 'up' | 'right'

export interface AnimPick {
  name: string
  flip: boolean
  bob: 'none' | 'breathe' | 'type' | 'step'
}

export const VIEW_DIR: Readonly<Record<Dir, { dir: ViewDir; flip: boolean }>> = {
  down: { dir: 'down', flip: false },
  up: { dir: 'up', flip: false },
  right: { dir: 'right', flip: false },
  left: { dir: 'right', flip: true },
}

const TALK_LIKE: ReadonlySet<Pose> = new Set<Pose>(['talk', 'laugh', 'rps'])

export function animCandidates(pose: Pose, dir: Dir, seated: boolean, held: HeldItem = 'none'): string[] {
  const d = VIEW_DIR[dir].dir
  const coffee = held === 'coffee'
  if (seated) {
    const sit = d === 'up' ? ['sit_type_up', 'sit_down'] : ['sit_down', 'sit_type_up']
    if (pose === 'raise_hand') return ['raise_hand_seated_down', ...sit]
    if (pose === 'sleep') return d === 'up' ? sit : ['sleep_down', ...sit]
    return sit
  }
  const stand = coffee ? [`stand_coffee_${d}`, `stand_${d}`] : [`stand_${d}`]
  const tail = [...stand, 'stand_down']
  if (pose === 'walk' || pose === 'run') return [...(coffee ? [`walk_coffee_${d}`] : []), `walk_${d}`, ...tail]
  if (pose === 'raise_hand') return ['raise_hand_down', ...tail]
  if (pose === 'cheer') return ['cheer_down', ...(d === 'up' ? [] : ['talk_down']), ...tail]
  if (TALK_LIKE.has(pose)) return d === 'up' ? tail : ['talk_down', ...tail]
  if (pose === 'drink') return d === 'up' || (held !== 'coffee' && held !== 'water') ? tail : ['drink_down', ...tail]
  return tail
}

function bobFor(pose: Pose, seated: boolean, name: string, anim: CharAnim): AnimPick['bob'] {
  if (seated) return pose === 'type' && name.startsWith('sit_type') ? 'type' : 'none'
  if (anim.frames > 1) return 'none'
  if (pose === 'walk' || pose === 'run' || name.startsWith('walk')) return 'step'
  return name.startsWith('stand') ? 'breathe' : 'none'
}

export function pickAnim(
  anims: Readonly<Record<string, CharAnim>>,
  pose: Pose,
  dir: Dir,
  seated: boolean,
  held: HeldItem = 'none',
  fits: (a: CharAnim) => boolean = () => true,
): (AnimPick & { anim: CharAnim }) | null {
  const ok = (n: string) => !!anims[n] && fits(anims[n])
  const cands = animCandidates(pose, dir, seated, held)
  let name = cands.find(ok)
  if (!name && seated) name = Object.keys(anims).find((n) => anims[n]!.anchor === 'seat' && ok(n))
  if (!name) name = Object.keys(anims).find((n) => n.startsWith('stand') && ok(n)) ?? Object.keys(anims).find(ok)
  if (!name) return null
  const anim = anims[name]!
  const flip = VIEW_DIR[dir].flip && name.endsWith('_right')
  return { name, flip, bob: bobFor(pose, seated, name, anim), anim }
}

export function animFits(anim: CharAnim, frame: { w: number; h: number }, sheet: { w: number; h: number }): boolean {
  return anim.frames * frame.w <= sheet.w && (anim.row + 1) * frame.h <= sheet.h
}

export function frameIndex(anim: CharAnim, animT: number): number {
  if (anim.frames <= 1 || anim.ms <= 0) return 0
  return Math.floor(Math.max(0, animT) / anim.ms) % anim.frames
}

export function bobOffset(bob: AnimPick['bob'], animT: number, phase = 0): number {
  if (bob === 'type') return Math.floor(animT / 140) % 2 === 0 ? 0 : 1
  if (bob === 'step') return -Math.abs(Math.sin(animT / 110)) * 1.5
  if (bob === 'breathe') return Math.sin(animT / 700 + phase) * 0.5
  return 0
}
