import { describe, expect, it } from 'vitest'
import type { Agent } from '@ccm/shared'
import {
  BUS_LEAD,
  CHILD_INDENT,
  computeLayout,
  MAIN_HEIGHT,
  MAIN_WIDTH,
  PEER_ARC_MAX,
  PEER_ARC_MIN,
  PEER_ENTRY_Y,
  PEER_LANE,
  PEER_SLOT_GAP,
  peerArcHeight,
  peerPath,
  peerSlots,
  pickLayout,
  PILL_HEIGHT,
  PILL_WIDTH,
  TRAY_HEIGHT,
  TRAY_WIDTH,
  trayId,
  trayTerminal,
  treeOrder,
  treePath,
  visibleAgents,
} from './layout'
import { buildNav, navigate } from './mapNav'

const agent = (id: string, terminalId: string, over: Partial<Agent> = {}): Agent => ({
  id,
  terminalId,
  role: 'subagent',
  status: 'working',
  parentId: `${terminalId}:main`,
  ...over,
})

const main = (terminalId: string, over: Partial<Agent> = {}) => agent(`${terminalId}:main`, terminalId, { role: 'main', parentId: undefined, ...over })

function boxes(positions: Map<string, { x: number; y: number }>, mains: Set<string>) {
  return [...positions.entries()].map(([id, p]) => {
    const tray = !!trayTerminal(id)
    const w = tray ? TRAY_WIDTH : mains.has(id) ? MAIN_WIDTH : PILL_WIDTH
    const h = tray ? TRAY_HEIGHT : mains.has(id) ? MAIN_HEIGHT : PILL_HEIGHT
    return { id, x: p.x, y: p.y, w, h }
  })
}

function expectNoOverlap(list: { id: string; x: number; y: number; w: number; h: number }[]) {
  for (const a of list) {
    for (const b of list) {
      if (a === b) continue
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
      expect(overlap, `${a.id} overlaps ${b.id}`).toBe(false)
    }
  }
}

const tree = () => [
  main('t1'),
  agent('a1', 't1', { startedAt: '2026-10-07T10:00:01.000Z', status: 'completed' }),
  agent('a2', 't1', { startedAt: '2026-10-07T10:00:02.000Z' }),
  agent('n1', 't1', { parentId: 'a1', startedAt: '2026-10-07T10:00:03.000Z' }),
  agent('n2', 't1', { parentId: 'n1', startedAt: '2026-10-07T10:00:04.000Z', status: 'completed' }),
  agent('o1', 't1', { parentId: 'missing', startedAt: '2026-10-07T10:00:05.000Z', status: 'cancelled' }),
]

describe('agent map layout', () => {
  it('orders children depth-first under their parent', () => {
    expect(treeOrder(tree()).map((x) => `${x.agent.id}:${x.depth}`)).toEqual(['a1:1', 'n1:2', 'n2:3', 'a2:1', 'o1:1'])
  })

  it('places pills in rows under the main card, children indented under their parent', () => {
    const { positions } = computeLayout({ terminals: ['t1'], agentsByTerminal: { t1: tree() }, perRow: 3 })
    const m = positions.get('t1:main')!
    expect(m).toEqual({ x: 0, y: 0 })
    const a1 = positions.get('a1')!
    expect(a1.x).toBe(CHILD_INDENT)
    expect(a1.y).toBeGreaterThan(MAIN_HEIGHT)
    expect(positions.get('a2')!.y).toBe(a1.y)
    expect(positions.get('o1')!.y).toBe(a1.y)
    expect(positions.get('a2')!.x).toBeGreaterThan(a1.x + PILL_WIDTH)
    expect(positions.get('n1')!.x).toBe(a1.x + CHILD_INDENT)
    expect(positions.get('n2')!.x).toBe(a1.x + 2 * CHILD_INDENT)
    expect(positions.get('n1')!.y).toBeGreaterThan(a1.y + PILL_HEIGHT)
    expectNoOverlap(boxes(positions, new Set(['t1:main'])))
  })

  it('wraps siblings into rows of perRow and never overlaps, with trays below each tree', () => {
    const byTerminal: Record<string, Agent[]> = {}
    for (let t = 0; t < 5; t++) {
      const id = `t${t}`
      byTerminal[id] = [main(id)]
      for (let s = 0; s < t * 2 + 1; s++) byTerminal[id]!.push(agent(`${id}-s${s}`, id, s % 3 === 1 ? { parentId: `${id}-s${s - 1}` } : {}))
    }
    const trays = { t1: true, t3: true }
    for (const perRow of [1, 2, 3]) {
      const { positions, width, height } = computeLayout({ terminals: Object.keys(byTerminal), agentsByTerminal: byTerminal, perRow, rowWidth: 1600, trays })
      expect(positions.size).toBe(5 + 25 + 2)
      const list = boxes(positions, new Set(Object.keys(byTerminal).map((t) => `${t}:main`)))
      expectNoOverlap(list)
      for (const b of list) {
        expect(b.x + b.w).toBeLessThanOrEqual(width)
        expect(b.y + b.h).toBeLessThanOrEqual(height)
      }
      const tray = positions.get(trayId('t3'))!
      for (const id of byTerminal.t3!.map((a) => a.id)) expect(positions.get(id)!.y).toBeLessThan(tray.y)
    }
  })

  it('wraps sessions onto a new row when the row width runs out', () => {
    const byTerminal = { a: [main('a')], b: [main('b')], c: [main('c')] }
    const { positions } = computeLayout({ terminals: ['a', 'b', 'c'], agentsByTerminal: byTerminal, perRow: 1, rowWidth: MAIN_WIDTH * 2 + 80 })
    expect(positions.get('b:main')!.y).toBe(0)
    expect(positions.get('c:main')!.x).toBe(0)
    expect(positions.get('c:main')!.y).toBeGreaterThan(MAIN_HEIGHT)
  })

  it('honours a resized main card', () => {
    const { positions } = computeLayout({ terminals: ['t1'], agentsByTerminal: { t1: [main('t1'), agent('s', 't1')] }, perRow: 1, sizes: { 't1:main': { h: 200 } } })
    expect(positions.get('s')!.y).toBeGreaterThan(200)
  })

  it('picks the pills per row that gives the most readable zoom and sticks to the previous choice when close', () => {
    const byTerminal: Record<string, Agent[]> = { t: [main('t'), ...Array.from({ length: 9 }, (_, i) => agent(`s${i}`, 't'))] }
    const wide = pickLayout({ terminals: ['t'], agentsByTerminal: byTerminal }, { width: 2000, height: 420 })
    expect(wide.perRow).toBe(3)
    const tall = pickLayout({ terminals: ['t'], agentsByTerminal: byTerminal }, { width: 360, height: 1400 })
    expect(tall.perRow).toBe(1)
    const kept = pickLayout({ terminals: ['t'], agentsByTerminal: byTerminal }, { width: 2000, height: 420 }, 2)
    expect([2, 3]).toContain(kept.perRow)
  })
})

describe('tree edge path', () => {
  it('goes down the trunk, along a bus just above the child and drops into it', () => {
    const d = treePath(20, 96, 80, 140)
    expect(d.startsWith('M 20 96')).toBe(true)
    expect(d).toContain(`${140 - BUS_LEAD}`)
    expect(d.endsWith('L 80 140')).toBe(true)
  })

  it('is a straight line when the child sits right under the trunk', () => {
    expect(treePath(20, 96, 20, 140)).toBe('M 20 96 L 20 140')
  })
})

describe('peer arc path', () => {
  const card = (x: number, y: number, over: { w?: number; h?: number } = {}) => ({ x, y, w: over.w ?? MAIN_WIDTH, h: over.h ?? MAIN_HEIGHT })

  it('joins the top edges at the thirds facing each other and rises above the cards', () => {
    const arc = peerPath(card(0, 0), card(364, 0))
    expect(arc.sameRow).toBe(true)
    expect(arc.from).toEqual({ x: 200, y: 0 })
    expect(arc.to).toEqual({ x: 464, y: 0 })
    expect(arc.d.startsWith('M 200 0 C 200 ')).toBe(true)
    expect(arc.d.endsWith(' 464 0')).toBe(true)
    expect(arc.mid.x).toBe(332)
    expect(arc.mid.y).toBeCloseTo(-peerArcHeight(264))
  })

  it('draws one arc for both directions: swapping the ends only reverses it', () => {
    const forward = peerPath(card(0, 0), card(364, 0))
    const back = peerPath(card(364, 0), card(0, 0))
    expect(back.from).toEqual(forward.to)
    expect(back.to).toEqual(forward.from)
    expect(back.mid.x).toBeCloseTo(forward.mid.x)
    expect(back.mid.y).toBeCloseTo(forward.mid.y)
  })

  it('clamps the arch height between 20 and 44 px', () => {
    expect(peerArcHeight(40)).toBe(PEER_ARC_MIN)
    expect(peerArcHeight(300)).toBeCloseTo(36)
    expect(peerArcHeight(-2000)).toBe(PEER_ARC_MAX)
  })

  it('measures the arch from the top of the higher card', () => {
    const arc = peerPath(card(0, 30), card(364, 0, { h: 200 }))
    expect(arc.sameRow).toBe(true)
    expect(arc.mid.y).toBeCloseTo(-peerArcHeight(arc.to.x - arc.from.x))
  })

  it('runs a bracket down the left gap when the cards share a column in different rows', () => {
    const arc = peerPath(card(0, 0), card(0, 400))
    expect(arc.sameRow).toBe(false)
    expect(arc.from).toEqual({ x: 0, y: PEER_ENTRY_Y })
    expect(arc.to).toEqual({ x: 0, y: 400 + PEER_ENTRY_Y })
    expect(arc.d).toBe('M 0 22 L -12 22 Q -20 22 -20 30 L -20 414 Q -20 422 -12 422 L 0 422')
    expect(arc.mid).toEqual({ x: -PEER_LANE, y: 364 })
  })

  it('crosses columns through the corridor in the gap above the lower row', () => {
    const arc = peerPath(card(0, 0), card(400, 400))
    expect(arc.d).toBe('M 0 22 L -12 22 Q -20 22 -20 30 L -20 356 Q -20 364 -12 364 L 372 364 Q 380 364 380 372 L 380 414 Q 380 422 388 422 L 400 422')
    expect(arc.mid).toEqual({ x: 180, y: 364 })
    expect(arc.mid.y).toBeGreaterThan(MAIN_HEIGHT)
    expect(arc.mid.y).toBeLessThan(400)
  })

  it('takes the same route backwards when the receiver sits above the sender', () => {
    const down = peerPath(card(0, 0), card(400, 400))
    const up = peerPath(card(400, 400), card(0, 0))
    expect(up.sameRow).toBe(false)
    expect(up.from).toEqual(down.to)
    expect(up.to).toEqual(down.from)
    expect(up.mid).toEqual(down.mid)
    expect(up.d.startsWith('M 400 422 L 388 422 Q 380 422 380 414')).toBe(true)
    expect(up.d.endsWith('L 0 22')).toBe(true)
  })

  it('offsets lanes that share a column gap by the slot gap, the longer one outside', () => {
    const boxes = new Map([
      ['x', card(0, 0)],
      ['below', card(0, 400)],
      ['diagonal', card(400, 400)],
    ])
    const slots = peerSlots(
      [
        { id: 'x-below', a: 'x', b: 'below' },
        { id: 'x-diagonal', a: 'x', b: 'diagonal' },
      ],
      boxes,
    )
    expect(slots.get('x-diagonal')).toEqual({ a: -PEER_SLOT_GAP / 2, b: 0 })
    expect(slots.get('x-below')).toEqual({ a: PEER_SLOT_GAP / 2, b: 0 })
    const outer = peerPath(boxes.get('x')!, boxes.get('diagonal')!, slots.get('x-diagonal'))
    const inner = peerPath(boxes.get('x')!, boxes.get('below')!, slots.get('x-below'))
    expect(outer.d).toContain('Q -23 19 -23 27')
    expect(inner.d).toContain('Q -17 25 -17 33')
    expect(inner.from.y - outer.from.y).toBe(PEER_SLOT_GAP)
    expect(outer.mid.y).not.toBe(inner.mid.y)
  })

  it('spreads arcs that share a card side so they do not overlap, the longer one outside', () => {
    const boxes = new Map([
      ['x', card(0, 0)],
      ['near', card(364, 0)],
      ['far', card(728, 0)],
      ['left', card(-364, 0)],
    ])
    const slots = peerSlots(
      [
        { id: 'x-near', a: 'x', b: 'near' },
        { id: 'far-x', a: 'far', b: 'x' },
        { id: 'left-x', a: 'left', b: 'x' },
        { id: 'gone', a: 'x', b: 'missing' },
      ],
      boxes,
    )
    expect(slots.get('gone')).toBeUndefined()
    expect(slots.get('x-near')).toEqual({ a: PEER_SLOT_GAP / 2, b: 0 })
    expect(slots.get('far-x')).toEqual({ a: 0, b: -PEER_SLOT_GAP / 2 })
    expect(slots.get('left-x')).toEqual({ a: 0, b: 0 })
    const near = peerPath(boxes.get('x')!, boxes.get('near')!, slots.get('x-near'))
    const far = peerPath(boxes.get('far')!, boxes.get('x')!, slots.get('far-x'))
    expect(far.to.x).toBeLessThan(near.from.x)
    expect(near.from.x - far.to.x).toBe(PEER_SLOT_GAP)
    expect(far.mid.y).toBeLessThan(near.mid.y)
  })
})

describe('finished subagents and trays', () => {
  it('hides finished subagents but keeps ancestors of live ones', () => {
    expect(visibleAgents(tree(), false).hidden).toBe(0)
    const { visible, hidden } = visibleAgents(tree(), true)
    expect([...visible].sort()).toEqual(['a1', 'a2', 'n1', 't1:main'])
    expect(hidden).toBe(2)
    const errored = visibleAgents([main('t1'), agent('e1', 't1', { status: 'error' })], true)
    expect(errored.visible.has('e1')).toBe(true)
  })

  it('puts the tray at the end of its session column for keyboard navigation', () => {
    const list = [main('t1'), agent('s1', 't1')]
    const nav = buildNav(['t1'], { t1: list }, ['t1'])
    expect(nav.columns[0]).toEqual(['t1:main', 's1', trayId('t1')])
    expect(navigate(nav, 's1', 'ArrowDown')).toBe(trayId('t1'))
    expect(navigate(nav, trayId('t1'), 'ArrowLeft')).toBe('t1:main')
    expect(trayTerminal(trayId('t1'))).toBe('t1')
    expect(trayTerminal('t1:main')).toBeNull()
  })
})
