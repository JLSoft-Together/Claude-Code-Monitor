import { computed, onScopeDispose, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from 'vue'
import type { CommitDetail, LogCommit, LogError } from '@ccm/shared'
import { emptyGraph, extendGraph, flatRows, type GraphRow, type GraphState } from '../lib/commitGraph'
import { samePath } from '../lib/changesView'
import type { RefsOk } from '../lib/gitRefs'
import { emptyFilters, graphMode, toQuery, type LogFilters } from '../lib/logQuery'
import { changesUnwatch, changesWatch, logCommit, logContains, logPage, logRefs, onChangesUpdated } from '../lib/preview'

export type LogLoadError = LogError | 'unavailable'

export interface GitLog {
  root: Ref<string | null>
  refs: ShallowRef<RefsOk | null>
  error: Ref<LogLoadError | null>
  filters: Ref<LogFilters>
  commits: ShallowRef<LogCommit[]>
  rows: ShallowRef<GraphRow[]>
  mode: ComputedRef<'graph' | 'flat'>
  more: Ref<boolean>
  loading: Ref<boolean>
  loadingMore: Ref<boolean>
  selected: Ref<string | null>
  detail: ShallowRef<CommitDetail | null>
  detailLoading: Ref<boolean>
  authors: ComputedRef<string[]>
  reload(): Promise<void>
  loadMore(): Promise<void>
  select(hash: string | null): void
  setFilters(patch: Partial<LogFilters>): void
  contains(hash: string): Promise<string[] | null>
  refreshIfMoved(): Promise<void>
}

const DETAIL_CACHE = 50

/** HEAD + every ref hash: unchanged after a file save, changed by a commit / fetch / checkout. */
export const refsSignature = (r: RefsOk): string =>
  JSON.stringify([r.head, r.local.map((l) => [l.ref, l.hash, l.ahead, l.behind]), r.remotes.map((g) => g.refs.map((x) => [x.ref, x.hash])), r.tags.map((t) => [t.ref, t.hash])])

export function useGitLog(cwd: () => string, active: () => boolean, opts: { debounceMs?: number; now?: () => number } = {}): GitLog {
  const debounceMs = opts.debounceMs ?? 250
  const now = opts.now ?? Date.now
  const root = ref<string | null>(null)
  const refs = shallowRef<RefsOk | null>(null)
  const error = ref<LogLoadError | null>(null)
  const filters = ref<LogFilters>(emptyFilters())
  const commits = shallowRef<LogCommit[]>([])
  const rows = shallowRef<GraphRow[]>([])
  const mode = computed(() => graphMode(filters.value))
  const more = ref(false)
  const loading = ref(true)
  const loadingMore = ref(false)
  const selected = ref<string | null>(null)
  const detail = shallowRef<CommitDetail | null>(null)
  const detailLoading = ref(false)
  const cache = new Map<string, CommitDetail>()
  let graph: GraphState = emptyGraph()
  let seq = 0
  let detailSeq = 0
  let refsSeq = 0
  let disposed = false
  let signature = ''
  let watched: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  const authors = computed(() => {
    const names = new Set<string>()
    for (const c of commits.value) names.add(c.author)
    return [...names].sort((a, b) => a.localeCompare(b))
  })

  function applyPage(list: LogCommit[], append: boolean): void {
    if (mode.value === 'graph') {
      const next = extendGraph(append ? graph : emptyGraph(), list)
      graph = next.state
      rows.value = append ? [...rows.value, ...next.rows] : next.rows
    } else {
      graph = emptyGraph()
      rows.value = append ? [...rows.value, ...flatRows(list.length)] : flatRows(list.length)
    }
    commits.value = append ? [...commits.value, ...list] : list
  }

  /** 'stale' = superseded by a newer call, cwd change or dispose: the caller must touch nothing. */
  async function loadRefs(): Promise<'ok' | 'fail' | 'stale'> {
    const run = ++refsSeq
    const res = await logRefs(root.value ?? cwd())
    if (disposed || run !== refsSeq) return 'stale'
    if (!res.ok) {
      error.value = res.error
      if (!commits.value.length) refs.value = null
      return 'fail'
    }
    refs.value = res
    signature = refsSignature(res)
    if (root.value !== res.root) {
      root.value = res.root
      void watchRoot(res.root)
    }
    return 'ok'
  }

  async function firstPage(): Promise<void> {
    const run = ++seq
    const r = root.value
    if (!r) return
    loading.value = true
    const res = await logPage(r, toQuery(filters.value, now(), 0))
    if (disposed || run !== seq) return
    loading.value = false
    if (!res.ok) {
      error.value = res.error
      applyPage([], false)
      more.value = false
      return
    }
    error.value = null
    applyPage(res.commits, false)
    more.value = res.more
    if (selected.value && !res.commits.some((c) => c.hash === selected.value)) select(res.commits[0]?.hash ?? null)
    else if (!selected.value) select(res.commits[0]?.hash ?? null)
  }

  async function reload(): Promise<void> {
    const st = await loadRefs()
    if (st === 'ok') await firstPage()
    else if (st === 'fail') loading.value = false
  }

  async function loadMore(): Promise<void> {
    const r = root.value
    if (!r || !more.value || loadingMore.value || loading.value) return
    const run = seq
    loadingMore.value = true
    const res = await logPage(r, toQuery(filters.value, now(), commits.value.length))
    loadingMore.value = false
    if (disposed || run !== seq || !res.ok) return
    applyPage(res.commits, true)
    more.value = res.more
  }

  function select(hash: string | null): void {
    selected.value = hash
    const run = ++detailSeq
    if (!hash || !root.value) {
      detail.value = null
      detailLoading.value = false
      return
    }
    const hit = cache.get(hash)
    if (hit) {
      cache.delete(hash)
      cache.set(hash, hit)
      detail.value = hit
      detailLoading.value = false
      return
    }
    detail.value = null
    detailLoading.value = true
    void logCommit(root.value, hash).then((res) => {
      if (run !== detailSeq) return
      detailLoading.value = false
      if (res.ok || res.error !== 'unavailable') {
        const d = res as CommitDetail
        if (d.ok) {
          cache.set(hash, d)
          if (cache.size > DETAIL_CACHE) cache.delete(cache.keys().next().value!)
        }
        detail.value = d
      } else detail.value = null
    })
  }

  function setFilters(patch: Partial<LogFilters>): void {
    filters.value = { ...filters.value, ...patch }
  }

  watch(
    filters,
    () => {
      if (timer) clearTimeout(timer)
      seq++
      timer = setTimeout(() => {
        timer = null
        void firstPage()
      }, debounceMs)
    },
    { deep: true },
  )

  async function contains(hash: string): Promise<string[] | null> {
    if (!root.value) return null
    const res = await logContains(root.value, hash)
    return res.ok ? res.branches : null
  }

  async function refreshIfMoved(): Promise<void> {
    const before = signature
    if ((await loadRefs()) !== 'ok') return
    if (signature !== before || error.value) {
      cache.clear()
      await firstPage()
    }
  }

  async function watchRoot(r: string): Promise<void> {
    if (disposed || watched === r) return
    if (watched) void changesUnwatch(watched)
    watched = r
    await changesWatch(r)
  }

  const off = onChangesUpdated(({ root: changed }) => {
    if (root.value && active() && samePath(changed, root.value)) void refreshIfMoved()
  })

  watch(active, (on) => {
    if (on) void refreshIfMoved()
  })
  watch(cwd, () => {
    seq++
    detailSeq++
    root.value = null
    cache.clear()
    graph = emptyGraph()
    signature = ''
    error.value = null
    commits.value = []
    rows.value = []
    more.value = false
    loadingMore.value = false
    selected.value = null
    detail.value = null
    detailLoading.value = false
    loading.value = true
    void reload()
  })

  onScopeDispose(() => {
    disposed = true
    seq++
    detailSeq++
    refsSeq++
    off()
    if (timer) clearTimeout(timer)
    if (watched) void changesUnwatch(watched)
  })

  void reload()

  return { root, refs, error, filters, commits, rows, mode, more, loading, loadingMore, selected, detail, detailLoading, authors, reload, loadMore, select, setFilters, contains, refreshIfMoved }
}
