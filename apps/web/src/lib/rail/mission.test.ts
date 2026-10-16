import { describe, expect, it } from 'vitest'
import type { Tab } from '../../stores/workspace'
import type { LayoutNode } from '../splitLayout'
import {
  attentionOrder,
  attentionRank,
  filterTerms,
  flipFrames,
  flipOnto,
  foldText,
  missionDrop,
  missionFilter,
  missionGrid,
  spatialStep,
  unionRect,
  type MissionGridInput,
  type MissionPaneFacts,
  type NavRect,
} from './mission'

const cluster = (key: string, tabKeys: string[], over: Partial<MissionGridInput['clusters'][number]> = {}) => ({
  key,
  aliases: [] as string[],
  name: key,
  root: `C:\\work\\${key}`,
  live: true,
  tabKeys,
  ...over,
})

function tab(key: string, panes: string[], over: Partial<Tab> = {}): Tab {
  const root: LayoutNode = panes.length === 1 ? { pane: panes[0]! } : { dir: 'row', ratio: 0.5, a: { pane: panes[0]! }, b: { pane: panes[1]! } }
  return { key, root, focus: panes.at(-1)!, ...over }
}

const IDLE: MissionPaneFacts = { state: 'idle', run: null, subagents: 0 }

function input(over: Partial<MissionGridInput> = {}, facts: Record<string, Partial<MissionPaneFacts>> = {}): MissionGridInput {
  return {
    clusters: [cluster('app', ['t1', 't2']), cluster('notes', ['t3'])],
    tabs: [tab('t1', ['a', 'b']), tab('t2', ['c']), tab('t3', ['d'])],
    activeTabKey: 't3',
    tabTitle: (x) => x.name ?? `auto ${x.key}`,
    paneTitle: (k) => `pane ${k}`,
    facts: (k) => ({ ...IDLE, ...facts[k] }),
    ...over,
  }
}

describe('mission grid', () => {
  it('draws every project in rail order, one card per tab with its panes as boxes', () => {
    const grid = missionGrid(input())
    expect(grid.map((s) => [s.key, s.cards.map((c) => c.tabKey)])).toEqual([
      ['app', ['t1', 't2']],
      ['notes', ['t3']],
    ])
    const t1 = grid[0]!.cards[0]!
    expect(t1).toMatchObject({ title: 'auto t1', focus: 'b', named: false, current: false })
    expect(t1.tiles.map((x) => [x.paneKey, x.title, x.box])).toEqual([
      ['a', 'pane a', { x: 0, y: 0, w: 0.5, h: 1 }],
      ['b', 'pane b', { x: 0.5, y: 0, w: 0.5, h: 1 }],
    ])
  })

  it('puts the lead project first, found by key or by an old alias', () => {
    expect(missionGrid(input({ lead: 'notes' })).map((s) => s.key)).toEqual(['notes', 'app'])
    const clusters = [cluster('app', ['t1', 't2']), cluster('repo:notes', ['t3'], { aliases: ['plain:notes'] })]
    expect(missionGrid(input({ clusters, lead: 'plain:notes' })).map((s) => s.key)).toEqual(['repo:notes', 'app'])
    expect(missionGrid(input({ lead: 'gone' })).map((s) => s.key)).toEqual(['app', 'notes'])
  })

  it('leaves out remembered projects and tabs that no longer exist', () => {
    const clusters = [cluster('app', ['t1', 't2', 'zz']), cluster('old', [], { live: false }), cluster('ghost', ['yy'])]
    const grid = missionGrid(input({ clusters }))
    expect(grid.map((s) => s.key)).toEqual(['app'])
    expect(grid[0]!.cards.map((c) => c.tabKey)).toEqual(['t1', 't2'])
  })

  it('marks the current tab, its project and a custom name', () => {
    const grid = missionGrid(input({ tabs: [tab('t1', ['a', 'b']), tab('t2', ['c'], { name: 'Review' }), tab('t3', ['d'])], activeTabKey: 't2' }))
    expect(grid[0]!.current).toBe(true)
    expect(grid[1]!.current).toBe(false)
    expect(grid[0]!.cards[1]).toMatchObject({ title: 'Review', named: true, current: true })
  })

  it('rolls pane states up into the card and the project', () => {
    const grid = missionGrid(
      input({}, { a: { state: 'working', subagents: 2 }, b: { state: 'asked' }, c: { state: 'failed', run: 'failed' }, d: { state: null } }),
    )
    const [t1, t2] = grid[0]!.cards
    expect(t1).toMatchObject({ state: 'asked', subagents: 2, needs: 1, failed: 0 })
    expect(t1!.tiles[0]).toMatchObject({ state: 'working', subagents: 2, run: null })
    expect(t2).toMatchObject({ state: 'failed', needs: 1, failed: 1 })
    expect(t2!.tiles[0]!.run).toBe('failed')
    expect(grid[0]).toMatchObject({ needs: 2, failed: 1 })
    expect(grid[1]!.cards[0]).toMatchObject({ state: null, needs: 0 })
  })

  it('shows a main agent waiting on its subagents as busy', () => {
    const grid = missionGrid(input({}, { a: { state: 'subagents', subagents: 1 }, b: { state: 'done' } }))
    expect(grid[0]!.cards[0]).toMatchObject({ state: 'subagents', subagents: 1, needs: 0 })
  })

  it('puts tabs that need the user first, then busy ones, keeping open order otherwise', () => {
    const clusters = [cluster('app', ['t1', 't2', 't3', 't4', 't5'])]
    const tabs = [tab('t1', ['a']), tab('t2', ['b']), tab('t3', ['c']), tab('t4', ['d']), tab('t5', ['e'])]
    const grid = missionGrid(input({ clusters, tabs }, { a: { state: 'done' }, b: { state: 'working' }, c: { state: 'failed' }, d: { state: 'idle' }, e: { state: 'asked' } }))
    expect(grid[0]!.cards.map((c) => c.tabKey)).toEqual(['t3', 't5', 't2', 't1', 't4'])
  })
})

describe('mission attention order', () => {
  it('ranks needs-you and failed above working and subagents above the rest', () => {
    expect(['failed', 'asked', 'working', 'subagents', 'starting', 'done', 'ended', 'idle', null].map((s) => attentionRank(s as never))).toEqual([0, 0, 1, 1, 2, 2, 2, 2, 2])
  })

  it('is stable inside a rank and leaves the input alone', () => {
    const list = [
      { key: 'a', state: 'idle' as const },
      { key: 'b', state: 'asked' as const },
      { key: 'c', state: 'done' as const },
      { key: 'd', state: 'failed' as const },
      { key: 'e', state: 'subagents' as const },
    ]
    expect(attentionOrder(list).map((x) => x.key)).toEqual(['b', 'd', 'e', 'a', 'c'])
    expect(list.map((x) => x.key)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })
})

describe('mission filter', () => {
  const sections = () =>
    missionGrid(
      input({
        clusters: [cluster('app', ['t1', 't2'], { name: 'Ứng dụng' }), cluster('notes', ['t3'])],
        tabs: [tab('t1', ['a', 'b'], { name: 'Sửa lỗi đăng nhập' }), tab('t2', ['c']), tab('t3', ['d'])],
        paneTitle: (k) => ({ a: 'Claude', b: 'Shell', c: 'Build Đà Nẵng', d: 'Docs' })[k] ?? k,
      }),
    )

  it('folds case and Vietnamese marks, đ included', () => {
    expect(foldText('Sửa LỖI Đăng nhập')).toBe('sua loi dang nhap')
    expect(filterTerms('  ĐÀ   nẵng ')).toEqual(['da', 'nang'])
    expect(filterTerms('   ')).toEqual([])
  })

  it('matches the tab title, pane titles and the project name', () => {
    const keys = (q: string) => missionFilter(sections(), q).map((s) => [s.key, s.cards.map((c) => c.tabKey)])
    expect(keys('dang nhap')).toEqual([['app', ['t1']]])
    expect(keys('shell')).toEqual([['app', ['t1']]])
    expect(keys('da nang')).toEqual([['app', ['t2']]])
    expect(keys('ung dung')).toEqual([['app', ['t1', 't2']]])
    expect(keys('notes')).toEqual([['notes', ['t3']]])
  })

  it('needs every word to match and drops empty projects', () => {
    expect(missionFilter(sections(), 'claude docs')).toEqual([])
    expect(missionFilter(sections(), 'zzzz')).toEqual([])
  })

  it('keeps everything for a blank query and names projects through the caller', () => {
    const all = sections()
    expect(missionFilter(all, '  ')).toEqual(all)
    expect(missionFilter(all, 'home', (s) => (s.key === 'notes' ? 'Home' : s.name)).map((s) => s.key)).toEqual(['notes'])
  })
})

describe('mission drop', () => {
  const tile = { kind: 'tile' as const, paneKey: 'a', tabKey: 't1', section: 'app', alone: false }
  const card = { kind: 'card' as const, tabKey: 't1', section: 'app' }

  it('moves a pane into another tab of the same project', () => {
    expect(missionDrop(tile, { kind: 'card', tabKey: 't2', section: 'app' })).toEqual({ drop: { kind: 'move', paneKey: 'a', tabKey: 't2' }, blocked: false })
  })

  it('merges a whole tab into another one', () => {
    expect(missionDrop(card, { kind: 'card', tabKey: 't2', section: 'app' })).toEqual({ drop: { kind: 'merge', tabKey: 't1', into: 't2' }, blocked: false })
  })

  it('gives a pane its own tab on the new-tab slot, unless it is alone already', () => {
    expect(missionDrop(tile, { kind: 'slot', section: 'app' })).toEqual({ drop: { kind: 'detach', paneKey: 'a' }, blocked: false })
    expect(missionDrop({ ...tile, alone: true }, { kind: 'slot', section: 'app' })).toEqual({ drop: null, blocked: false })
    expect(missionDrop(card, { kind: 'slot', section: 'app' })).toEqual({ drop: null, blocked: false })
  })

  it('does nothing over its own tab or empty space and refuses another project', () => {
    expect(missionDrop(tile, { kind: 'card', tabKey: 't1', section: 'app' })).toEqual({ drop: null, blocked: false })
    expect(missionDrop(tile, null)).toEqual({ drop: null, blocked: false })
    expect(missionDrop(tile, { kind: 'card', tabKey: 't3', section: 'notes' })).toEqual({ drop: null, blocked: true })
    expect(missionDrop(card, { kind: 'slot', section: 'notes' })).toEqual({ drop: null, blocked: true })
  })
})

describe('mission keyboard steps', () => {
  const box = (key: string, left: number, top: number, width = 100, height = 80): NavRect => ({ key, left, top, width, height })
  const grid = [box('a', 0, 0), box('b', 112, 0), box('c', 224, 0), box('d', 0, 92), box('e', 112, 92), box('f', 0, 230)]

  it('←/→ follow reading order across rows and stop at the ends', () => {
    expect(spatialStep(grid, 'c', 'right', true)).toBe('d')
    expect(spatialStep(grid, 'd', 'left', true)).toBe('c')
    expect(spatialStep(grid, 'a', 'left', true)).toBeNull()
    expect(spatialStep(grid, 'f', 'right', true)).toBeNull()
  })

  it('↑/↓ go to the nearest row, then the closest column', () => {
    expect(spatialStep(grid, 'b', 'down')).toBe('e')
    expect(spatialStep(grid, 'c', 'down')).toBe('e')
    expect(spatialStep(grid, 'e', 'down')).toBe('f')
    expect(spatialStep(grid, 'f', 'up')).toBe('d')
    expect(spatialStep(grid, 'b', 'up')).toBeNull()
  })

  it('moves between split panes by position', () => {
    const tiles = [box('l', 0, 0, 50, 100), box('rt', 50, 0, 50, 50), box('rb', 50, 50, 50, 50)]
    expect(spatialStep(tiles, 'l', 'right')).toBe('rt')
    expect(spatialStep(tiles, 'rb', 'left')).toBe('l')
    expect(spatialStep(tiles, 'rt', 'down')).toBe('rb')
    expect(spatialStep(tiles, 'l', 'down')).toBeNull()
  })

  it('starts from the first item when the current one is gone', () => {
    expect(spatialStep(grid, 'zz', 'down')).toBe('a')
    expect(spatialStep([], 'zz', 'down')).toBeNull()
  })
})

describe('mission zoom', () => {
  it('unites pane rects, skipping missing and empty ones', () => {
    expect(unionRect([{ left: 10, top: 20, width: 100, height: 50 }, null, { left: 110, top: 20, width: 90, height: 120 }, { left: 0, top: 0, width: 0, height: 0 }])).toEqual({
      left: 10,
      top: 20,
      width: 190,
      height: 120,
    })
    expect(unionRect([null, undefined])).toBeNull()
  })

  it('lands the pane map of a card on the canvas', () => {
    expect(flipOnto({ left: 0, top: 0, width: 100, height: 60 }, { left: 0, top: 20, width: 100, height: 40 }, { left: 10, top: 10, width: 200, height: 80 })).toBe(
      'translate(10px, -30px) scale(2, 2)',
    )
  })
})

describe('mission flip', () => {
  const at = (left: number, top: number, width = 100, height = 50) => ({ left, top, width, height })

  it('does nothing when the box did not move', () => {
    expect(flipFrames(at(10, 10), at(10.2, 9.8))).toBeNull()
    expect(flipFrames(at(0, 0, 0, 0), at(10, 10))).toBeNull()
  })

  it('only translates a box that kept its size', () => {
    expect(flipFrames(at(40, 0), at(10, 20))).toEqual({
      outer: [
        { transformOrigin: '0 0', transform: 'translate(30px, -20px)' },
        { transformOrigin: '0 0', transform: 'none' },
      ],
      inner: null,
    })
  })

  it('can ignore a size change and translate only', () => {
    expect(flipFrames(at(0, 0, 200, 100), at(10, 0), { scale: false })?.inner).toBeNull()
    expect(flipFrames(at(10, 0, 200, 100), at(10, 0), { scale: false })).toBeNull()
  })

  it('scales a resized box and counter-scales its content so text never stretches', () => {
    const frames = flipFrames(at(0, 0, 50, 50), at(0, 0, 100, 50), { steps: 4 })!
    expect(frames.outer[0]).toEqual({ transformOrigin: '0 0', transform: 'translate(0px, 0px) scale(0.5, 1)' })
    expect(frames.outer[1]!.transform).toBe('none')
    expect(frames.inner!.map((k) => [k.offset, k.transform])).toEqual([
      [0, 'scale(2, 1)'],
      [0.25, 'scale(1.6, 1)'],
      [0.5, 'scale(1.3333, 1)'],
      [0.75, 'scale(1.1429, 1)'],
      [1, 'none'],
    ])
  })
})
