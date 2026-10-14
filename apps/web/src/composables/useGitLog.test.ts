import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LogCommit, LogQuery } from '@ccm/shared'

const refs = { ok: true as const, root: '/r', head: { branch: 'main', hash: 'h0' }, local: [], remotes: [], tags: [], me: 'Ann' }
const commit = (i: number): LogCommit => ({ hash: `h${i}`, parents: [`h${i + 1}`], author: i % 2 ? 'Bo' : 'Ann', email: '', time: 0, refs: '', subject: `c${i}` })
const pages: LogQuery[] = []
let pageImpl: (q: LogQuery) => Promise<unknown>
let updated: ((c: { root: string }) => void) | null = null

vi.mock('../lib/preview', () => ({
  logRefs: vi.fn(async () => refs),
  logPage: vi.fn(async (_root: string, q: LogQuery) => {
    pages.push(q)
    return pageImpl(q)
  }),
  logCommit: vi.fn(async (_r: string, hash: string) => ({ ok: true, hash, parents: [], author: 'Ann', email: '', authorTime: 0, committer: 'Ann', committerEmail: '', commitTime: 0, message: 'm', files: [], truncated: false })),
  logContains: vi.fn(async () => ({ ok: true, branches: ['main'] })),
  changesWatch: vi.fn(async () => true),
  changesUnwatch: vi.fn(async () => true),
  onChangesUpdated: vi.fn((h: (c: { root: string }) => void) => {
    updated = h
    return () => (updated = null)
  }),
}))

const { useGitLog } = await import('./useGitLog')
const preview = await import('../lib/preview')
const flush = async () => {
  for (let i = 0; i < 5; i++) await nextTick()
  await new Promise((r) => setTimeout(r, 0))
}

beforeEach(() => {
  pages.length = 0
  pageImpl = async (q) => ({ ok: true, commits: Array.from({ length: q.skip ? 2 : 500 }, (_, i) => commit(q.skip + i)), more: !q.skip })
})
afterEach(() => vi.clearAllMocks())

describe('useGitLog', () => {
  it('loads refs then the first page with graph rows', async () => {
    const scope = effectScope()
    const log = scope.run(() => useGitLog(() => '/r/sub', () => true, { debounceMs: 0 }))!
    await flush()
    expect(log.root.value).toBe('/r')
    expect(log.commits.value).toHaveLength(500)
    expect(log.rows.value).toHaveLength(500)
    expect(log.more.value).toBe(true)
    expect(log.authors.value).toEqual(['Ann', 'Bo'])
    await log.loadMore()
    expect(pages.at(-1)!.skip).toBe(500)
    expect(log.commits.value).toHaveLength(502)
    expect(log.rows.value).toHaveLength(502)
    scope.stop()
  })

  it('stops paging after a failed page so it is not retried forever', async () => {
    const scope = effectScope()
    const log = scope.run(() => useGitLog(() => '/r/sub', () => true, { debounceMs: 0 }))!
    await flush()
    pageImpl = async () => ({ ok: false, error: 'failed' })
    await log.loadMore()
    expect(log.more.value).toBe(false)
    expect(log.commits.value).toHaveLength(500)
    const calls = pages.length
    await log.loadMore()
    expect(pages.length).toBe(calls)
    scope.stop()
  })

  it('drops a late reply for an old query', async () => {
    let release: (v: unknown) => void = () => undefined
    pageImpl = (q) => (q.text ? Promise.resolve({ ok: true, commits: [commit(9)], more: false }) : new Promise((r) => (release = r)))
    const scope = effectScope()
    const log = scope.run(() => useGitLog(() => '/r', () => true, { debounceMs: 0 }))!
    await flush()
    log.setFilters({ text: 'x' })
    await flush()
    release({ ok: true, commits: [commit(1), commit(2)], more: false })
    await flush()
    expect(log.commits.value.map((c) => c.hash)).toEqual(['h9'])
    expect(log.mode.value).toBe('flat')
    scope.stop()
  })

  it('reloads on changes-updated only when refs moved', async () => {
    const scope = effectScope()
    scope.run(() => useGitLog(() => '/r', () => true, { debounceMs: 0 }))
    await flush()
    const before = pages.length
    updated?.({ root: '/r' })
    await flush()
    expect(pages.length).toBe(before)
    vi.mocked(preview.logRefs).mockResolvedValueOnce({ ...refs, head: { branch: 'main', hash: 'new' } } as never)
    updated?.({ root: '/r' })
    await flush()
    expect(pages.length).toBe(before + 1)
    scope.stop()
  })

  it('loads and caches the selected commit detail', async () => {
    const scope = effectScope()
    const log = scope.run(() => useGitLog(() => '/r', () => true, { debounceMs: 0 }))!
    await flush()
    log.select('h3')
    await flush()
    expect(log.detail.value && log.detail.value.ok && log.detail.value.hash).toBe('h3')
    log.select('h4')
    await flush()
    log.select('h3')
    await flush()
    expect(vi.mocked(preview.logCommit).mock.calls.filter((c) => c[1] === 'h3')).toHaveLength(1)
    scope.stop()
  })
  it('clears detailLoading when a cached or null selection supersedes a pending load', async () => {
    const scope = effectScope()
    const log = scope.run(() => useGitLog(() => '/r', () => true, { debounceMs: 0 }))!
    await flush()
    log.select('h3')
    await flush()
    let release: (v: unknown) => void = () => undefined
    vi.mocked(preview.logCommit).mockImplementationOnce((() => new Promise((r) => (release = r))) as never)
    log.select('h4')
    expect(log.detailLoading.value).toBe(true)
    expect(log.detail.value).toBeNull()
    log.select('h3')
    expect(log.detailLoading.value).toBe(false)
    log.select('h5')
    log.select(null)
    expect(log.detailLoading.value).toBe(false)
    release({ ok: true, hash: 'h4' })
    await flush()
    expect(log.detailLoading.value).toBe(false)
    scope.stop()
  })

  it('clears detail when the commit is unavailable', async () => {
    const scope = effectScope()
    const log = scope.run(() => useGitLog(() => '/r', () => true, { debounceMs: 0 }))!
    await flush()
    log.select('h3')
    await flush()
    vi.mocked(preview.logCommit).mockResolvedValueOnce({ ok: false, error: 'unavailable' } as never)
    log.select('h4')
    await flush()
    expect(log.detail.value).toBeNull()
    scope.stop()
  })

  it('ignores in-flight replies and clears the list when cwd changes', async () => {
    let release: (v: unknown) => void = () => undefined
    const dir = ref('/r')
    const scope = effectScope()
    const log = scope.run(() => useGitLog(() => dir.value, () => true, { debounceMs: 0 }))!
    await flush()
    pageImpl = () => new Promise((r) => (release = r))
    vi.mocked(preview.logRefs).mockResolvedValueOnce({ ok: false, error: 'unavailable' } as never)
    dir.value = '/other'
    await flush()
    expect(log.commits.value).toEqual([])
    expect(log.rows.value).toEqual([])
    expect(log.selected.value).toBeNull()
    expect(log.detail.value).toBeNull()
    release({ ok: true, commits: [commit(1)], more: false })
    await flush()
    expect(log.commits.value).toEqual([])
    scope.stop()
  })

  it('drops an older refs reply that resolves after a newer one', async () => {
    let releaseOld: (v: unknown) => void = () => undefined
    const scope = effectScope()
    const log = scope.run(() => useGitLog(() => '/r', () => true, { debounceMs: 0 }))!
    await flush()
    vi.mocked(preview.logRefs).mockImplementationOnce((() => new Promise((r) => (releaseOld = r))) as never)
    const slow = log.reload()
    vi.mocked(preview.logRefs).mockResolvedValueOnce({ ...refs, root: '/new' } as never)
    await log.reload()
    releaseOld({ ...refs, root: '/old' })
    await slow
    await flush()
    expect(log.root.value).toBe('/new')
    scope.stop()
  })

  it('does not watch or write after dispose', async () => {
    let releaseRefs: (v: unknown) => void = () => undefined
    vi.mocked(preview.logRefs).mockImplementationOnce((() => new Promise((r) => (releaseRefs = r))) as never)
    const scope = effectScope()
    const log = scope.run(() => useGitLog(() => '/r', () => true, { debounceMs: 0 }))!
    scope.stop()
    releaseRefs(refs)
    await flush()
    expect(preview.changesWatch).not.toHaveBeenCalled()
    expect(log.root.value).toBeNull()
    expect(pages).toHaveLength(0)
  })

  it('recovers from a transient refs failure on the next refresh', async () => {
    const scope = effectScope()
    const log = scope.run(() => useGitLog(() => '/r', () => true, { debounceMs: 0 }))!
    await flush()
    vi.mocked(preview.logRefs).mockResolvedValueOnce({ ok: false, error: 'unavailable' } as never)
    await log.refreshIfMoved()
    expect(log.error.value).toBe('unavailable')
    expect(log.refs.value).not.toBeNull()
    expect(log.commits.value).toHaveLength(500)
    await log.refreshIfMoved()
    expect(log.error.value).toBeNull()
    scope.stop()
  })
})
