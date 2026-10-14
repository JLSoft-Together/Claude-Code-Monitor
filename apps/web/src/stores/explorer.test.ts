import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DirEntry } from '../lib/explorer/tree'
import type { PreviewChange } from '../lib/preview'

const bridge = vi.hoisted(() => ({
  listDir: vi.fn<(root: string, dir: string) => Promise<DirEntry[] | null>>(),
  createEntry: vi.fn(),
  watchRoot: vi.fn(() => Promise.resolve(true)),
  unwatchRoot: vi.fn(() => Promise.resolve(true)),
  handlers: new Set<(c: PreviewChange) => void>(),
}))

vi.mock('../lib/preview', () => ({
  listDir: bridge.listDir,
  createEntry: bridge.createEntry,
  watchRoot: bridge.watchRoot,
  unwatchRoot: bridge.unwatchRoot,
  onPreviewChanged: (h: (c: PreviewChange) => void) => {
    bridge.handlers.add(h)
    return () => bridge.handlers.delete(h)
  },
}))

const { useExplorerStore, TREE_REFRESH_MS } = await import('./explorer')

const R = 'C:\\repo'
const e = (name: string, directory = false, dir = R): DirEntry => ({ name, path: `${dir}\\${name}`, directory, outOfRoot: false })
let fs: Record<string, DirEntry[]>

const flush = () => new Promise((r) => setTimeout(r, 0))

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  fs = { [R]: [e('src', true), e('a.ts')], [`${R}\\src`]: [e('main.ts', false, `${R}\\src`)] }
  bridge.listDir.mockReset().mockImplementation(async (_root, dir) => fs[dir] ?? null)
  bridge.createEntry.mockReset()
  bridge.watchRoot.mockClear()
  bridge.unwatchRoot.mockClear()
  bridge.handlers.clear()
})

afterEach(() => vi.useRealTimers())

describe('explorer store', () => {
  it('lists the root, expands lazily and keeps state per root', async () => {
    const s = useExplorerStore()
    s.setRoot(R)
    await flush()
    expect(s.rows.map((r) => r.name)).toEqual(['repo', 'src', 'a.ts'])
    s.toggle(`${R}\\src`)
    await flush()
    expect(s.rows.map((r) => r.name)).toEqual(['repo', 'src', 'main.ts', 'a.ts'])
    s.setRoot('C:\\other')
    await flush()
    expect(s.state.expanded.size).toBe(0)
    s.setRoot('c:/REPO')
    expect(s.root).toBe('c:/REPO')
    expect(s.state.expanded.has(`${R}\\src`)).toBe(true)
    s.setRoot(null)
    expect(s.root).toBe('c:/REPO')
  })

  it('drops a stale reply and keeps the last listing when a read fails', async () => {
    const s = useExplorerStore()
    let release!: (v: DirEntry[]) => void
    bridge.listDir.mockImplementationOnce(() => new Promise((r) => (release = r)))
    s.setRoot(R)
    const second = s.loadListing(R)
    await second
    release([e('stale.ts')])
    await flush()
    expect(s.rows.map((r) => r.name)).toEqual(['repo', 'src', 'a.ts'])
    bridge.listDir.mockResolvedValueOnce(null)
    await s.loadListing(R)
    expect(s.state.errors.has(R)).toBe(true)
    expect(s.rows).toHaveLength(3)
    await s.loadListing(R)
    expect(s.state.errors.has(R)).toBe(false)
  })

  it('watches only while attached and re-lists folders touched by watcher events', async () => {
    vi.useFakeTimers()
    const s = useExplorerStore()
    s.setRoot(R)
    await vi.runAllTimersAsync()
    expect(bridge.watchRoot).not.toHaveBeenCalled()
    s.attach()
    expect(bridge.watchRoot).toHaveBeenCalledWith(R)
    await vi.runAllTimersAsync()
    bridge.listDir.mockClear()
    fs[R] = [...fs[R]!, e('b.ts')]
    for (const h of bridge.handlers) h({ root: R, tokens: [], paths: [`${R}\\b.ts`, `${R}\\c.ts`, `${R}\\closed\\x.ts`] })
    await vi.advanceTimersByTimeAsync(TREE_REFRESH_MS)
    expect(bridge.listDir).toHaveBeenCalledTimes(1)
    expect(s.rows.map((r) => r.name)).toContain('b.ts')
    s.detach()
    expect(bridge.unwatchRoot).toHaveBeenCalledWith(R)
    expect(bridge.handlers.size).toBe(0)
  })

  it('creates into a folder, opens it, focuses the row and reveals hidden names', async () => {
    const s = useExplorerStore()
    s.setRoot(R)
    await flush()
    bridge.createEntry.mockImplementation(async (_r: string, parent: string, name: string) => {
      fs[parent] = [...(fs[parent] ?? []), e(name, false, parent)]
      return { ok: true, path: `${parent}\\${name}` }
    })
    const path = await s.create(`${R}\\src`, '.env', 'file')
    expect(path).toBe(`${R}\\src\\.env`)
    expect(s.state.expanded.has(`${R}\\src`)).toBe(true)
    expect(s.state.showHidden).toBe(true)
    expect(s.status?.key).toBe('shownHidden')
    expect(s.pendingFocus).toBe(path)
    expect(s.rows.some((r) => r.path === path)).toBe(true)
    bridge.createEntry.mockResolvedValueOnce({ ok: false, error: 'exists' })
    expect(await s.create(R, 'a.ts', 'file')).toBeNull()
    expect(s.status).toMatchObject({ key: 'exists', failed: true })
  })
})
