import type { Tab } from '../../stores/workspace'
import type { RunBadge } from '../runUi'
import { boxes, type Box } from '../splitLayout'
import { groupState, needsUser, type RailCluster, type RailState } from './railModel'

/** FLIP: the transform that puts an element laid out at `from` exactly over `to` (transform-origin 0 0). */
export function flipTransform(
  from: { left: number; top: number; width: number; height: number },
  to: { left: number; top: number; width: number; height: number },
): string {
  const sx = to.width / from.width
  const sy = to.height / from.height
  return `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${+sx.toFixed(4)}, ${+sy.toFixed(4)})`
}

export interface MissionPaneFacts {
  state: RailState | null
  run: RunBadge | null
  subagents: number
}

export interface MissionTile extends MissionPaneFacts {
  paneKey: string
  box: Box
  title: string
}

export interface MissionCard {
  tabKey: string
  title: string
  named: boolean
  current: boolean
  focus: string
  state: RailState | null
  subagents: number
  needs: number
  failed: number
  tiles: MissionTile[]
}

export interface MissionSection {
  key: string
  name: string
  root: string | null
  current: boolean
  needs: number
  failed: number
  cards: MissionCard[]
}

export interface MissionGridInput {
  clusters: readonly Pick<RailCluster, 'key' | 'aliases' | 'name' | 'root' | 'live' | 'tabKeys'>[]
  tabs: readonly Tab[]
  activeTabKey: string | null
  lead?: string | null
  tabTitle: (tab: Tab) => string
  paneTitle: (paneKey: string) => string
  facts: (paneKey: string) => MissionPaneFacts
}

function missionCard(tab: Tab, input: MissionGridInput): MissionCard {
  const tiles = [...boxes(tab.root)].map(([paneKey, box]): MissionTile => ({ paneKey, box, title: input.paneTitle(paneKey), ...input.facts(paneKey) }))
  const states = tiles.map((x) => x.state).filter((s): s is RailState => !!s)
  return {
    tabKey: tab.key,
    title: input.tabTitle(tab),
    named: !!tab.name,
    current: tab.key === input.activeTabKey,
    focus: tab.focus,
    state: states.length ? groupState(states) : null,
    subagents: tiles.reduce((n, x) => n + x.subagents, 0),
    needs: states.filter(needsUser).length,
    failed: states.filter((s) => s === 'failed').length,
    tiles,
  }
}

const ATTENTION_RANK: Partial<Record<RailState, number>> = { failed: 0, asked: 0, working: 1, subagents: 1 }

export const attentionRank = (state: RailState | null): number => (state ? (ATTENTION_RANK[state] ?? 2) : 2)

export function attentionOrder<T extends { state: RailState | null }>(cards: readonly T[]): T[] {
  return cards
    .map((card, at) => ({ card, at, rank: attentionRank(card.state) }))
    .sort((a, b) => a.rank - b.rank || a.at - b.at)
    .map((x) => x.card)
}

export function missionGrid(input: MissionGridInput): MissionSection[] {
  const byKey = new Map(input.tabs.map((t) => [t.key, t]))
  const live = input.clusters.filter((c) => c.live)
  const lead = input.lead ? live.find((c) => c.key === input.lead || c.aliases.includes(input.lead!)) : undefined
  const ordered = lead ? [lead, ...live.filter((c) => c !== lead)] : live
  return ordered.flatMap((c): MissionSection[] => {
    const cards = c.tabKeys.flatMap((key): MissionCard[] => {
      const tab = byKey.get(key)
      return tab ? [missionCard(tab, input)] : []
    })
    if (!cards.length) return []
    return [
      {
        key: c.key,
        name: c.name,
        root: c.root,
        current: cards.some((k) => k.current),
        needs: cards.reduce((n, k) => n + k.needs, 0),
        failed: cards.reduce((n, k) => n + k.failed, 0),
        cards: attentionOrder(cards),
      },
    ]
  })
}

export function foldText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/đ/g, 'd')
}

export function filterTerms(query: string): string[] {
  return foldText(query).split(/\s+/).filter(Boolean)
}

export function missionFilter(sections: readonly MissionSection[], query: string, sectionName: (s: MissionSection) => string = (s) => s.name): MissionSection[] {
  const terms = filterTerms(query)
  if (!terms.length) return [...sections]
  return sections.flatMap((s): MissionSection[] => {
    const name = sectionName(s)
    const cards = s.cards.filter((c) => {
      const hay = foldText([name, c.title, ...c.tiles.map((x) => x.title)].join('\n'))
      return terms.every((term) => hay.includes(term))
    })
    if (!cards.length) return []
    return [cards.length === s.cards.length ? s : { ...s, cards }]
  })
}

export type MissionDragSource =
  | { kind: 'tile'; paneKey: string; tabKey: string; section: string; alone: boolean }
  | { kind: 'card'; tabKey: string; section: string }

export type MissionDropTarget = { kind: 'card'; tabKey: string; section: string } | { kind: 'slot'; section: string }

export type MissionDrop =
  | { kind: 'move'; paneKey: string; tabKey: string }
  | { kind: 'detach'; paneKey: string }
  | { kind: 'merge'; tabKey: string; into: string }

export function missionDrop(src: MissionDragSource, target: MissionDropTarget | null): { drop: MissionDrop | null; blocked: boolean } {
  if (!target) return { drop: null, blocked: false }
  if (target.section !== src.section) return { drop: null, blocked: true }
  if (target.kind === 'slot') return { drop: src.kind === 'tile' && !src.alone ? { kind: 'detach', paneKey: src.paneKey } : null, blocked: false }
  if (target.tabKey === src.tabKey) return { drop: null, blocked: false }
  return {
    drop: src.kind === 'tile' ? { kind: 'move', paneKey: src.paneKey, tabKey: target.tabKey } : { kind: 'merge', tabKey: src.tabKey, into: target.tabKey },
    blocked: false,
  }
}

export type NavDir = 'left' | 'right' | 'up' | 'down'

export interface NavRect {
  key: string
  left: number
  top: number
  width: number
  height: number
}

const EDGE = 1

export function spatialStep(items: readonly NavRect[], from: string, dir: NavDir, linear = false): string | null {
  const at = items.findIndex((i) => i.key === from)
  const f = items[at]
  if (!f) return items[0]?.key ?? null
  if (linear && (dir === 'left' || dir === 'right')) return items[at + (dir === 'right' ? 1 : -1)]?.key ?? null
  const across = dir === 'left' || dir === 'right'
  const gap = (c: NavRect): number =>
    dir === 'right' ? c.left - (f.left + f.width) : dir === 'left' ? f.left - (c.left + c.width) : dir === 'down' ? c.top - (f.top + f.height) : f.top - (c.top + c.height)
  const centre = (r: NavRect): number => (across ? r.top + r.height / 2 : r.left + r.width / 2)
  const ahead = items.filter((c) => c !== f && gap(c) >= -EDGE)
  if (!ahead.length) return null
  const near = Math.min(...ahead.map(gap))
  const band = ahead.filter((c) => gap(c) <= near + EDGE)
  return band.reduce((best, c) => (Math.abs(centre(c) - centre(f)) < Math.abs(centre(best) - centre(f)) ? c : best)).key
}

type Rect = { left: number; top: number; width: number; height: number }

export function unionRect(rects: readonly (Rect | null | undefined)[]): Rect | null {
  const list = rects.filter((r): r is Rect => !!r && r.width > 0 && r.height > 0)
  if (!list.length) return null
  const left = Math.min(...list.map((r) => r.left))
  const top = Math.min(...list.map((r) => r.top))
  const right = Math.max(...list.map((r) => r.left + r.width))
  const bottom = Math.max(...list.map((r) => r.top + r.height))
  return { left, top, width: right - left, height: bottom - top }
}

export function flipOnto(outer: Rect, inner: Rect, to: Rect): string {
  const sx = to.width / inner.width
  const sy = to.height / inner.height
  const tx = to.left - outer.left - sx * (inner.left - outer.left)
  const ty = to.top - outer.top - sy * (inner.top - outer.top)
  return `translate(${+tx.toFixed(2)}px, ${+ty.toFixed(2)}px) scale(${+sx.toFixed(4)}, ${+sy.toFixed(4)})`
}

export interface FlipFrames {
  outer: Keyframe[]
  inner: Keyframe[] | null
}

const FLIP_EPS = 0.5

export function flipFrames(from: Rect, to: Rect, opts: { scale?: boolean; steps?: number } = {}): FlipFrames | null {
  if (!to.width || !to.height || !from.width || !from.height) return null
  const dx = from.left - to.left
  const dy = from.top - to.top
  const resized = opts.scale !== false && (Math.abs(from.width - to.width) > FLIP_EPS || Math.abs(from.height - to.height) > FLIP_EPS)
  if (!resized && Math.abs(dx) < FLIP_EPS && Math.abs(dy) < FLIP_EPS) return null
  const origin = '0 0'
  if (!resized)
    return {
      outer: [
        { transformOrigin: origin, transform: `translate(${+dx.toFixed(2)}px, ${+dy.toFixed(2)}px)` },
        { transformOrigin: origin, transform: 'none' },
      ],
      inner: null,
    }
  const sx = from.width / to.width
  const sy = from.height / to.height
  const steps = Math.max(2, Math.round(opts.steps ?? 12))
  const inner: Keyframe[] = []
  for (let i = 0; i <= steps; i++) {
    const p = i / steps
    const x = sx + (1 - sx) * p
    const y = sy + (1 - sy) * p
    inner.push({ offset: p, transformOrigin: origin, transform: i === steps ? 'none' : `scale(${+(1 / x).toFixed(4)}, ${+(1 / y).toFixed(4)})` })
  }
  return {
    outer: [
      { transformOrigin: origin, transform: flipTransform(to, from) },
      { transformOrigin: origin, transform: 'none' },
    ],
    inner,
  }
}
