import { defineStore } from 'pinia'
import { computed, reactive, ref, watch } from 'vue'
import { estimateCost, type UsageBucket, type UsageScan, type UsageSnapshot, type UsageTotals } from '@ccm/shared'

export type UsageRange = 'today' | '7d' | '30d' | 'all'
export type UsageMetric = 'tokens' | 'cost'
export type SeriesKey = 'input' | 'output' | 'cacheWrite' | 'cacheRead'

/** Stack order matches the validated categorical slot order (adjacent pairs are CVD-checked). */
export const SERIES: SeriesKey[] = ['input', 'output', 'cacheWrite', 'cacheRead']
export const MODEL_SLOTS = 8

export interface Aggregate {
  messages: number
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  cost: number
  unpriced: number
}

export interface GroupRow extends Aggregate {
  id: string
  value: number
}

export interface ProjectRow extends Aggregate {
  id: string
  folders: number
  drive: string
  tokens: number
  value: number
  models: number
  activeDays: number
  lastDay: string
}

/** Drive letter ("C:"), "\\" for UNC shares, "/" for POSIX paths. */
export function driveOf(path: string): string {
  const m = path.match(/^([A-Za-z]):/)
  if (m) return `${m[1]!.toUpperCase()}:`
  return path.startsWith('\\\\') ? '\\\\' : '/'
}

export interface DayRow {
  day: string
  values: Record<SeriesKey, number>
  total: number
}

const RANGE_DAYS: Record<UsageRange, number | null> = { today: 1, '7d': 7, '30d': 30, all: null }

/** Share of prompt tokens served from cache: read / (read + fresh input + cache writes). */
export function cacheHitRate(a: Pick<Aggregate, 'input' | 'cacheWrite' | 'cacheRead'>): number | null {
  const denom = a.cacheRead + a.input + a.cacheWrite
  return denom > 0 ? a.cacheRead / denom : null
}

/** Relative change; null when there is nothing to compare against. */
export function change(current: number, previous: number): number | null {
  return previous > 0 ? (current - previous) / previous : null
}

export const emptyAggregate = (): Aggregate => ({ messages: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, cost: 0, unpriced: 0 })

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number)
  return dayKey(new Date(y!, m! - 1, d! + delta))
}

const only = (b: UsageBucket, key: SeriesKey): UsageTotals => ({
  messages: 0,
  input: key === 'input' ? b.input : 0,
  output: key === 'output' ? b.output : 0,
  cacheWrite5m: key === 'cacheWrite' ? b.cacheWrite5m : 0,
  cacheWrite1h: key === 'cacheWrite' ? b.cacheWrite1h : 0,
  cacheRead: key === 'cacheRead' ? b.cacheRead : 0,
})

export function seriesTokens(b: UsageBucket, key: SeriesKey): number {
  if (key === 'cacheWrite') return b.cacheWrite5m + b.cacheWrite1h
  return b[key]
}

export function seriesValue(b: UsageBucket, key: SeriesKey, metric: UsageMetric): number {
  if (metric === 'tokens') return seriesTokens(b, key)
  return estimateCost(only(b, key), b.model, b.fast) ?? 0
}

function addBucket(agg: Aggregate, b: UsageBucket): void {
  agg.messages += b.messages
  agg.input += b.input
  agg.output += b.output
  agg.cacheWrite += b.cacheWrite5m + b.cacheWrite1h
  agg.cacheRead += b.cacheRead
  const cost = estimateCost(b, b.model, b.fast)
  if (cost === null) agg.unpriced += b.messages
  else agg.cost += cost
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    return
  }
}

export const useUsageStore = defineStore('usage', () => {
  const buckets = reactive<Record<string, UsageBucket>>({})
  const scan = ref<UsageScan>({ state: 'idle', filesDone: 0, filesTotal: 0 })
  const received = ref(false)

  const roots = reactive<Record<string, string>>({})
  const saved = readJson<{ range?: UsageRange; metric?: UsageMetric; hidden?: SeriesKey[]; groupRepos?: boolean }>('ccm.usage', {})
  const groupRepos = ref(saved.groupRepos !== false)
  const range = ref<UsageRange>(saved.range && saved.range in RANGE_DAYS ? saved.range : '7d')
  const metric = ref<UsageMetric>(saved.metric === 'cost' ? 'cost' : 'tokens')
  const hidden = ref<SeriesKey[]>(Array.isArray(saved.hidden) ? saved.hidden.filter((k) => SERIES.includes(k)) : ['cacheRead'])
  const project = ref<string | null>(null)
  const model = ref<string | null>(null)
  const today = ref(dayKey(new Date()))

  watch(
    [range, metric, hidden, groupRepos],
    () => writeJson('ccm.usage', { range: range.value, metric: metric.value, hidden: hidden.value, groupRepos: groupRepos.value }),
    { deep: true },
  )
  watch(groupRepos, () => (project.value = null))

  /** With grouping on, a sub folder (app/src/...) counts toward its git repo root. */
  const projectOf = (dir: string): string => (groupRepos.value ? (roots[dir] ?? dir) : dir)

  function reset(snapshot: UsageSnapshot | undefined): void {
    for (const key of Object.keys(buckets)) delete buckets[key]
    for (const b of snapshot?.buckets ?? []) buckets[b.key] = b
    for (const key of Object.keys(roots)) delete roots[key]
    Object.assign(roots, snapshot?.roots ?? {})
    if (snapshot?.scan) scan.value = snapshot.scan
    received.value = snapshot !== undefined
    today.value = dayKey(new Date())
  }

  function update(list: UsageBucket[]): void {
    for (const b of list) buckets[b.key] = b
    today.value = dayKey(new Date())
  }

  function setRoots(added: Record<string, string>): void {
    Object.assign(roots, added)
  }

  function setScan(value: UsageScan): void {
    scan.value = value
  }

  function toggleSeries(key: SeriesKey): void {
    const set = new Set(hidden.value)
    if (set.has(key)) set.delete(key)
    else if (SERIES.length - set.size > 1) set.add(key)
    hidden.value = SERIES.filter((k) => set.has(k))
  }

  const all = computed(() => Object.values(buckets))

  const models = computed(() => [...new Set(all.value.map((b) => b.model))].sort())
  const projects = computed(() => [...new Set(all.value.map((b) => projectOf(b.project)))].sort())

  /** Color follows the model, not its rank: slot comes from the stable sorted list of every model seen. */
  const modelSlot = computed(() => {
    const out: Record<string, number | null> = {}
    models.value.forEach((m, i) => (out[m] = i < MODEL_SLOTS ? i + 1 : null))
    return out
  })

  const startDay = computed(() => {
    const days = RANGE_DAYS[range.value]
    if (days !== null) return shiftDay(today.value, -(days - 1))
    let min = today.value
    for (const b of all.value) if (b.day < min) min = b.day
    return min
  })

  const filtered = computed(() =>
    all.value.filter(
      (b) =>
        b.day >= startDay.value &&
        b.day <= today.value &&
        (project.value === null || projectOf(b.project) === project.value) &&
        (model.value === null || b.model === model.value),
    ),
  )

  /** The window of the same length right before the current one (same project / model filter); none for "all". */
  const previous = computed<{ from: string; to: string; totals: Aggregate } | null>(() => {
    const days = RANGE_DAYS[range.value]
    if (days === null) return null
    const to = shiftDay(startDay.value, -1)
    const from = shiftDay(startDay.value, -days)
    const agg = emptyAggregate()
    let any = false
    for (const b of all.value) {
      if (b.day < from || b.day > to) continue
      if (project.value !== null && projectOf(b.project) !== project.value) continue
      if (model.value !== null && b.model !== model.value) continue
      addBucket(agg, b)
      any = true
    }
    return any ? { from, to, totals: agg } : null
  })

  const visibleSeries = computed(() => SERIES.filter((k) => !hidden.value.includes(k)))

  const totals = computed(() => {
    const agg = emptyAggregate()
    for (const b of filtered.value) addBucket(agg, b)
    return agg
  })

  const valueOf = (b: UsageBucket): number => {
    let v = 0
    for (const k of visibleSeries.value) v += seriesValue(b, k, metric.value)
    return v
  }

  const daily = computed<DayRow[]>(() => {
    const rows = new Map<string, DayRow>()
    for (let d = startDay.value; d <= today.value; d = shiftDay(d, 1)) {
      rows.set(d, { day: d, values: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 }, total: 0 })
    }
    for (const b of filtered.value) {
      const row = rows.get(b.day)
      if (!row) continue
      for (const k of SERIES) row.values[k] += seriesValue(b, k, metric.value)
    }
    for (const row of rows.values()) row.total = visibleSeries.value.reduce((s, k) => s + row.values[k], 0)
    return [...rows.values()]
  })

  function groupBy(pick: (b: UsageBucket) => string): GroupRow[] {
    const map = new Map<string, GroupRow>()
    for (const b of filtered.value) {
      const id = pick(b)
      let row = map.get(id)
      if (!row) map.set(id, (row = { id, value: 0, ...emptyAggregate() }))
      addBucket(row, b)
      row.value += valueOf(b)
    }
    return [...map.values()].sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))
  }

  /** Range + model filters only, so the project table and picker can list every project. */
  const projectRows = computed<ProjectRow[]>(() => {
    const map = new Map<string, ProjectRow & { modelSet: Set<string>; daySet: Set<string>; folderSet: Set<string> }>()
    for (const b of all.value) {
      if (b.day < startDay.value || b.day > today.value || (model.value !== null && b.model !== model.value)) continue
      const id = projectOf(b.project)
      let row = map.get(id)
      if (!row) {
        row = {
          id,
          drive: driveOf(id),
          folders: 0,
          tokens: 0,
          value: 0,
          models: 0,
          activeDays: 0,
          lastDay: b.day,
          modelSet: new Set(),
          daySet: new Set(),
          folderSet: new Set(),
          ...emptyAggregate(),
        }
        map.set(id, row)
      }
      row.folderSet.add(b.project)
      addBucket(row, b)
      row.value += valueOf(b)
      row.modelSet.add(b.model)
      row.daySet.add(b.day)
      if (b.day > row.lastDay) row.lastDay = b.day
    }
    return [...map.values()].map(({ modelSet, daySet, folderSet, ...row }) => ({
      ...row,
      folders: folderSet.size,
      tokens: row.input + row.output + row.cacheWrite + row.cacheRead,
      models: modelSet.size,
      activeDays: daySet.size,
    }))
  })

  const byModel = computed(() => groupBy((b) => b.model))
  const byProject = computed(() => groupBy((b) => projectOf(b.project)))

  const hasData = computed(() => all.value.length > 0)

  /** API-list-price estimate of one local day, unfiltered (budget, recap). */
  function dayCost(day: string): number {
    let sum = 0
    for (const b of all.value) if (b.day === day) sum += estimateCost(b, b.model, b.fast) ?? 0
    return sum
  }
  const todayCost = computed(() => dayCost(today.value))

  return {
    buckets,
    scan,
    received,
    range,
    metric,
    hidden,
    project,
    model,
    today,
    models,
    projects,
    modelSlot,
    startDay,
    filtered,
    visibleSeries,
    totals,
    previous,
    daily,
    byModel,
    byProject,
    projectRows,
    roots,
    groupRepos,
    projectOf,
    hasData,
    dayCost,
    todayCost,
    reset,
    update,
    setScan,
    setRoots,
    toggleSeries,
  }
})
