import { checkEntryName } from '@ccm/shared'
import { describe, expect, it, vi } from 'vitest'
import { createChangesScheduler, type SchedulerClock } from './changesScheduler'
import { nextRevealStep, type RevealState } from './reveal'
import {
  createTargetDirectory,
  fileGlyph,
  flattenTree,
  openDirectories,
  parentDirectory,
  relativeTo,
  resolveFocusIndex,
  sortEntries,
  toggleExpanded,
  visibleEntries,
  type DirEntry,
} from './tree'

const R = '/repo'
const dir = (path: string, outOfRoot = false): DirEntry => ({ name: path.split('/').pop()!, path, directory: true, outOfRoot })
const file = (path: string): DirEntry => ({ name: path.split('/').pop()!, path, directory: false, outOfRoot: false })

const listings = new Map<string, DirEntry[]>([
  [R, [file(`${R}/b.ts`), dir(`${R}/src`), file(`${R}/A.md`), dir(`${R}/node_modules`), file(`${R}/.env`), dir(`${R}/.github`), dir(`${R}/link`, true)]],
  [`${R}/src`, [file(`${R}/src/main.ts`), dir(`${R}/src/lib`)]],
  [`${R}/src/lib`, [file(`${R}/src/lib/x.ts`)]],
])

describe('tree model', () => {
  it('sorts folders first, case-insensitive, with a stable tie-break', () => {
    const names = sortEntries([file('/z'), file('/README'), file('/readme'), dir('/b'), file('/a')]).map((e) => e.name)
    expect(names).toEqual(['b', 'a', 'README', 'readme', 'z'])
  })

  it('hides excluded names always and dot-entries unless asked', () => {
    expect(visibleEntries(listings.get(R)!, false).map((e) => e.name)).toEqual(['link', 'src', 'A.md', 'b.ts'])
    expect(visibleEntries(listings.get(R)!, true).map((e) => e.name)).toEqual(['.github', 'link', 'src', '.env', 'A.md', 'b.ts'])
  })

  it('flattens with the root as row 0 and descends only into expanded, listed folders', () => {
    const rows = flattenTree(R, listings, new Set([`${R}/src`]), false, true)
    expect(rows.map((r) => `${r.depth}:${r.name}`)).toEqual(['0:repo', '1:link', '1:src', '2:lib', '2:main.ts', '1:A.md', '1:b.ts'])
    expect(flattenTree(R, listings, new Set([`${R}/src`]), false, false).map((r) => r.name)).toEqual(['repo'])
  })

  it('never expands a link out of the root and survives a listing cycle', () => {
    const cyc = new Map([[R, [dir(`${R}/a`)]], [`${R}/a`, [dir(R)]]])
    expect(flattenTree(R, cyc, new Set([`${R}/a`, R]), false, true).length).toBe(3)
    expect(flattenTree(R, listings, new Set([`${R}/link`]), false, true).find((r) => r.name === 'link')?.expanded).toBe(false)
  })

  it('open directories = root + expanded rows, deduplicated', () => {
    const rows = flattenTree(R, listings, new Set([`${R}/src`, `${R}/src/lib`]), false, true)
    expect(openDirectories(rows, R)).toEqual([R, `${R}/src`, `${R}/src/lib`])
    expect(toggleExpanded(new Set(['a']), 'a').size).toBe(0)
  })

  it('focus follows the path, clamps when it leaves', () => {
    const rows = flattenTree(R, listings, new Set(), false, true)
    expect(resolveFocusIndex(rows, `${R}/A.md`, 0)).toBe(3)
    expect(resolveFocusIndex(rows, null, 3)).toBe(0)
    expect(resolveFocusIndex(rows, '/gone', 99)).toBe(rows.length - 1)
  })

  it('creates into the focused folder, else its parent, else the root', () => {
    const rows = flattenTree(R, listings, new Set([`${R}/src`]), false, true)
    expect(createTargetDirectory(rows, `${R}/src`, R)).toBe(`${R}/src`)
    expect(createTargetDirectory(rows, `${R}/src/main.ts`, R)).toBe(`${R}/src`)
    expect(createTargetDirectory(rows, `${R}/link`, R)).toBe(R)
    expect(createTargetDirectory(rows, null, R)).toBe(R)
    expect(createTargetDirectory(rows, '/elsewhere', R)).toBe(R)
  })

  it('path helpers', () => {
    expect(parentDirectory('C:\\a\\b.ts')).toBe('C:\\a')
    expect(parentDirectory('C:\\b.ts')).toBe('C:\\')
    expect(relativeTo('C:\\repo', 'C:\\repo\\src\\a.ts')).toBe('src/a.ts')
    expect(relativeTo(R, R)).toBe('')
    expect([fileGlyph('a.ts'), fileGlyph('p.json'), fileGlyph('x.PNG'), fileGlyph('README.md'), fileGlyph('.env'), fileGlyph('Makefile')]).toEqual([
      'code',
      'json',
      'image',
      'text',
      'file',
      'file',
    ])
  })
})

describe('nextRevealStep', () => {
  const state = (over: Partial<RevealState>): RevealState => ({
    target: `${R}/src/lib/x.ts`,
    root: R,
    listings,
    expanded: new Set(),
    rootExpanded: true,
    showHidden: false,
    errors: new Map(),
    ...over,
  })

  it('opens the outermost closed ancestor, then waits for listings, then is done', () => {
    expect(nextRevealStep(state({}))).toEqual({ kind: 'expand', directory: `${R}/src` })
    expect(nextRevealStep(state({ expanded: new Set([`${R}/src`]) }))).toEqual({ kind: 'expand', directory: `${R}/src/lib` })
    expect(nextRevealStep(state({ expanded: new Set([`${R}/src`, `${R}/src/lib`]) }))).toEqual({ kind: 'done' })
    expect(nextRevealStep(state({ rootExpanded: false }))).toEqual({ kind: 'open-root' })
    expect(nextRevealStep(state({ listings: new Map() }))).toEqual({ kind: 'wait' })
  })

  it('gives up on hidden, missing, out-of-root or failed paths', () => {
    expect(nextRevealStep(state({ target: `${R}/.env` }))).toEqual({ kind: 'none' })
    expect(nextRevealStep(state({ target: `${R}/.env`, showHidden: true }))).toEqual({ kind: 'done' })
    expect(nextRevealStep(state({ target: `${R}/nope.ts` }))).toEqual({ kind: 'none' })
    expect(nextRevealStep(state({ target: `${R}/link/a` }))).toEqual({ kind: 'none' })
    expect(nextRevealStep(state({ listings: new Map(), errors: new Map([[R, 'x']]) }))).toEqual({ kind: 'none' })
  })

  it('matches Windows paths across separators and case', () => {
    const W = 'C:\\Repo'
    const win = new Map([[W, [{ name: 'Src', path: 'C:\\Repo\\Src', directory: true, outOfRoot: false }]]])
    expect(nextRevealStep({ ...state({}), root: W, listings: win, target: 'c:/repo/src/a.ts' })).toEqual({ kind: 'expand', directory: 'C:\\Repo\\Src' })
  })
})

describe('changes scheduler', () => {
  function fake() {
    let now = 0
    const timers = new Map<number, { at: number; cb: () => void }>()
    let id = 0
    const clock: SchedulerClock = {
      now: () => now,
      setTimer: (cb, ms) => (timers.set(++id, { at: now + ms, cb }), id),
      clearTimer: (h) => timers.delete(h as number),
    }
    const advance = async (ms: number) => {
      now += ms
      for (const [k, t] of [...timers]) if (t.at <= now) (timers.delete(k), t.cb())
      await Promise.resolve()
      await Promise.resolve()
    }
    return { clock, advance }
  }

  it('reads on becoming active, debounces watch bursts and spaces reads', async () => {
    const { clock, advance } = fake()
    const read = vi.fn(() => Promise.resolve())
    const s = createChangesScheduler({ read, clock })
    s.trigger('watch')
    expect(read).not.toHaveBeenCalled()
    s.setActive(true)
    expect(read).toHaveBeenCalledTimes(1)
    await advance(0)
    s.trigger('watch')
    await advance(200)
    expect(read).toHaveBeenCalledTimes(1)
    await advance(900)
    expect(read).toHaveBeenCalledTimes(2)
    await advance(0)
    s.trigger('refresh')
    expect(read).toHaveBeenCalledTimes(3)
    s.setActive(false)
    s.trigger('refresh')
    expect(read).toHaveBeenCalledTimes(3)
  })
})

describe('checkEntryName', () => {
  it.each([
    ['README.md', null],
    ['.github', null],
    ['', 'empty'],
    [' a', 'space'],
    ['a\tb', 'control'],
    ['a/b', 'separator'],
    ['..', 'reserved'],
    ['a.', 'dot'],
    ['CON.txt', 'device'],
    ['com9', 'device'],
    ['COM10', null],
    ['a'.repeat(256), 'long'],
    ['あ'.repeat(128), 'long'],
  ])('%j → %s', (name, reason) => {
    const res = checkEntryName(name)
    expect(res.ok ? null : res.reason).toBe(reason)
  })
})
