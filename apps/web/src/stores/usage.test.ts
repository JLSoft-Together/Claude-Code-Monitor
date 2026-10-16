import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import type { UsageBucket } from '@ccm/shared'
import { displayTitle, isAutoNamed } from '../lib/title'
import { useConnectionStore } from './connection'
import { dayKey, useUsageStore } from './usage'

const today = dayKey(new Date())
const yesterday = dayKey(new Date(Date.now() - 86_400_000))
const old = '2020-01-01'

const bucket = (day: string, model: string, project: string, over: Partial<UsageBucket> = {}): UsageBucket => ({
  key: `${day}|${model}|${project}|s`,
  day,
  model,
  project,
  messages: 1,
  input: 10,
  output: 100,
  cacheWrite5m: 1000,
  cacheWrite1h: 0,
  cacheRead: 10_000,
  ...over,
})

const msg = (seq: number, events: unknown[]) => JSON.stringify({ seq, events })

describe('period comparison', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('compares today with yesterday under the same filters', () => {
    const usage = useUsageStore()
    usage.range = 'today'
    usage.reset({ buckets: [bucket(today, 'm1', 'p'), bucket(yesterday, 'm1', 'p', { input: 30, key: 'y1' }), bucket(yesterday, 'm2', 'p', { key: 'y2' })], scan: { state: 'ready', filesDone: 0, filesTotal: 0 } })
    expect(usage.previous?.totals.input).toBe(40)
    usage.model = 'm1'
    expect(usage.previous?.totals.input).toBe(30)
    usage.range = 'all'
    expect(usage.previous).toBeNull()
  })

  it('computes cache hit rate and change', async () => {
    const { cacheHitRate, change } = await import('./usage')
    expect(cacheHitRate({ input: 10, cacheWrite: 90, cacheRead: 900 })).toBeCloseTo(0.9)
    expect(cacheHitRate({ input: 0, cacheWrite: 0, cacheRead: 0 })).toBeNull()
    expect(change(150, 100)).toBeCloseTo(0.5)
    expect(change(5, 0)).toBeNull()
  })
})

describe('usage store', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('hydrates from snapshot, applies updates and scan progress', () => {
    const connection = useConnectionStore()
    const usage = useUsageStore()
    connection.onMessage(
      msg(1, [
        {
          type: 'snapshot',
          payload: {
            protocolVersion: 1,
            collectorStartedAt: '',
            supportedClaudeVersion: '',
            terminals: [],
            agents: [],
            activity: [],
            usage: { buckets: [bucket(today, 'claude-opus-5-5', 'D:/a')], scan: { state: 'scanning', filesDone: 1, filesTotal: 4 } },
          },
        },
      ]),
    )
    expect(usage.received).toBe(true)
    expect(usage.scan.filesTotal).toBe(4)
    connection.onMessage(msg(2, [{ type: 'usage.updated', payload: { buckets: [bucket(today, 'claude-opus-5-5', 'D:/a', { output: 500 })] } }, { type: 'usage.scan', payload: { state: 'ready', filesDone: 4, filesTotal: 4 } }]))
    expect(usage.totals.output).toBe(500)
    expect(usage.scan.state).toBe('ready')
  })

  it('filters by range, model and project and splits by model', () => {
    const usage = useUsageStore()
    usage.reset({
      buckets: [
        bucket(today, 'claude-opus-5-5', 'D:/a'),
        bucket(yesterday, 'claude-haiku-4-5', 'D:/b'),
        bucket(old, 'claude-opus-5-5', 'D:/a'),
      ],
      scan: { state: 'ready', filesDone: 1, filesTotal: 1 },
    })
    usage.range = 'today'
    expect(usage.totals.messages).toBe(1)
    usage.range = '7d'
    expect(usage.totals.messages).toBe(2)
    expect(usage.daily).toHaveLength(7)
    expect(usage.byModel.map((r) => r.id)).toEqual(['claude-haiku-4-5', 'claude-opus-5-5'].sort())
    usage.range = 'all'
    expect(usage.totals.messages).toBe(3)
    usage.model = 'claude-haiku-4-5'
    expect(usage.totals).toMatchObject({ messages: 1, cacheWrite: 1000 })
    usage.model = null
    usage.project = 'D:/a'
    expect(usage.byProject.map((r) => r.id)).toEqual(['D:/a'])
  })

  it('keeps model colors stable when filtering and hides cache read by default', () => {
    const usage = useUsageStore()
    usage.reset({ buckets: [bucket(today, 'b-model', 'p'), bucket(today, 'a-model', 'p')], scan: { state: 'ready', filesDone: 0, filesTotal: 0 } })
    const before = { ...usage.modelSlot }
    usage.model = 'b-model'
    expect(usage.modelSlot).toEqual(before)
    expect(before['a-model']).toBe(1)
    usage.model = null
    expect(usage.visibleSeries).not.toContain('cacheRead')
    const row = usage.daily.at(-1)!
    expect(row.total).toBe(2 * (10 + 100 + 1000))
    usage.toggleSeries('cacheRead')
    expect(usage.daily.at(-1)!.total).toBe(2 * (10 + 100 + 1000 + 10_000))
  })

  it('prices known models and counts unpriced messages', () => {
    const usage = useUsageStore()
    usage.reset({
      buckets: [
        bucket(today, 'claude-opus-5-5', 'p', { input: 1_000_000, output: 0, cacheWrite5m: 0, cacheRead: 0 }),
        bucket(today, 'mystery', 'p'),
      ],
      scan: { state: 'ready', filesDone: 0, filesTotal: 0 },
    })
    expect(usage.totals.cost).toBeCloseTo(4)
    expect(usage.totals.unpriced).toBe(1)
  })
})

describe('hero, picked day and top lists', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  const sum = (rows: { total: number }[]) => rows.reduce((s, r) => s + r.total, 0)

  function seed() {
    const usage = useUsageStore()
    usage.reset({
      buckets: [
        bucket(today, 'claude-opus-5-5', 'D:/a', { key: 't1', input: 1_000, output: 2_000 }),
        bucket(today, 'claude-haiku-4-5', 'D:/b', { key: 't2' }),
        bucket(yesterday, 'claude-opus-5-5', 'D:/c', { key: 'y1', output: 50_000 }),
        bucket(yesterday, 'claude-opus-5-5', 'D:/a', { key: 'y2' }),
        bucket(old, 'claude-opus-5-5', 'D:/z', { key: 'o1' }),
      ],
      scan: { state: 'ready', filesDone: 1, filesTotal: 1 },
    })
    usage.range = '7d'
    return usage
  }

  it('keeps the hero total equal to the sum of the visible bars, tokens and cost', () => {
    const usage = seed()
    expect(usage.visibleSeries).not.toContain('cacheRead')
    expect(usage.heroTotal).toBe(sum(usage.daily))
    expect(usage.heroTotal).toBe(usage.totals.input + usage.totals.output + usage.totals.cacheWrite)
    usage.toggleSeries('cacheRead')
    expect(usage.heroTotal).toBe(sum(usage.daily))
    usage.toggleSeries('output')
    expect(usage.heroTotal).toBe(sum(usage.daily))
    usage.metric = 'cost'
    expect(usage.heroTotal).toBeGreaterThan(0)
    expect(usage.heroTotal).toBeCloseTo(sum(usage.daily), 9)
    usage.toggleSeries('output')
    expect(usage.heroTotal).toBeCloseTo(sum(usage.daily), 9)
    expect(usage.heroTotal).toBeCloseTo(usage.totals.cost, 9)
  })

  it('reports every series for the legend and a daily average over the range', () => {
    const usage = seed()
    expect(usage.seriesTotals.cacheRead).toBe(4 * 10_000)
    expect(usage.dailyAverage).toBeCloseTo(sum(usage.daily) / 7)
    usage.range = 'today'
    expect(usage.dailyAverage).toBeNull()
  })

  it('narrows totals, models and projects to the picked day; the chart keeps every day', () => {
    const usage = seed()
    usage.selectDay(yesterday)
    expect(usage.selectedDay).toBe(yesterday)
    expect(usage.daily).toHaveLength(7)
    expect(usage.totals.messages).toBe(2)
    expect(usage.totals.output).toBe(50_100)
    expect(usage.byModel.map((r) => r.id)).toEqual(['claude-opus-5-5'])
    expect(usage.byProject.map((r) => r.id)).toEqual(['D:/c', 'D:/a'])
    expect(usage.heroTotal).toBe(usage.daily.find((r) => r.day === yesterday)!.total)
    expect(usage.byProject.reduce((s, r) => s + r.value, 0)).toBe(usage.heroTotal)
    usage.selectDay(yesterday)
    expect(usage.selectedDay).toBeNull()
    expect(usage.totals.messages).toBe(4)
    usage.selectDay(old)
    expect(usage.selectedDay).toBeNull()
  })

  it('clears the picked day when the range changes or no longer holds it', async () => {
    const usage = seed()
    usage.selectDay(today)
    usage.range = '30d'
    expect(usage.selectedDay).toBeNull()
    usage.selectDay(yesterday)
    expect(usage.selectedDay).toBe(yesterday)
    usage.range = 'today'
    expect(usage.selectedDay).toBeNull()
    usage.range = '7d'
    usage.selectDay(yesterday)
    usage.model = 'claude-haiku-4-5'
    expect(usage.selectedDay).toBe(yesterday)
    expect(usage.totals.messages).toBe(0)
    usage.model = null
    usage.range = 'all'
    usage.selectDay(old)
    expect(usage.selectedDay).toBe(old)
    usage.reset({ buckets: [bucket(today, 'm', 'p')], scan: { state: 'ready', filesDone: 1, filesTotal: 1 } })
    await nextTick()
    expect(usage.selectedDay).toBeNull()
  })

  it('orders top projects by the current measure, at most six', async () => {
    const { TOP_PROJECTS } = await import('./usage')
    const usage = useUsageStore()
    const list = Array.from({ length: 9 }, (_, i) => bucket(today, 'claude-opus-5-5', `D:/p${i}`, { key: `p${i}`, output: (i + 1) * 100 }))
    usage.reset({ buckets: list, scan: { state: 'ready', filesDone: 1, filesTotal: 1 } })
    expect(TOP_PROJECTS).toBe(6)
    expect(usage.topProjects.map((r) => r.id)).toEqual(['D:/p8', 'D:/p7', 'D:/p6', 'D:/p5', 'D:/p4', 'D:/p3'])
    expect(usage.topProjects.every((r, i, a) => i === 0 || a[i - 1]!.value >= r.value)).toBe(true)
    expect(usage.projectRows).toHaveLength(9)
  })

  it('compares the hero measure with the previous window', () => {
    const usage = useUsageStore()
    usage.reset({
      buckets: [bucket(today, 'm', 'p', { key: 'a' }), bucket(yesterday, 'm', 'p', { key: 'b', output: 300 })],
      scan: { state: 'ready', filesDone: 0, filesTotal: 0 },
    })
    usage.range = 'today'
    expect(usage.heroTotal).toBe(10 + 100 + 1000)
    expect(usage.previous?.value).toBe(10 + 300 + 1000)
    usage.toggleSeries('cacheRead')
    expect(usage.previous?.value).toBe(10 + 300 + 1000 + 10_000)
  })
})

describe('session sort', () => {
  it('orders by latest activity, keeps ended sessions last', async () => {
    const { sortSessions } = await import('../lib/sessionSort')
    const s = (id: string, status: string, startedAt: string, lastActivityAt?: string) => ({ id, title: id, status, startedAt, lastActivityAt }) as never
    const list = [
      s('a', 'idle', '2026-10-07T08:00:00Z', '2026-10-07T09:00:00Z'),
      s('b', 'working', '2026-10-07T07:00:00Z', '2026-10-07T10:00:00Z'),
      s('c', 'stale', '2026-10-07T11:00:00Z', '2026-10-07T12:00:00Z'),
      s('d', 'waiting', '2026-10-07T06:00:00Z'),
    ]
    const ids = (by: Parameters<typeof sortSessions>[1]) => sortSessions(list, by).map((x) => x.id)
    expect(ids('activity')).toEqual(['b', 'a', 'd', 'c'])
    expect(ids('started')).toEqual(['a', 'b', 'd', 'c'])
    expect(ids('status')).toEqual(['d', 'b', 'a', 'c'])
    expect(ids('name')).toEqual(['a', 'b', 'd', 'c'])
  })
})

describe('terminal titles', () => {
  it('prefers the dashboard alias and flags auto names', () => {
    expect(displayTitle({ title: 'repo-1a', alias: 'Ads' })).toBe('Ads')
    expect(displayTitle({ title: 'repo-1a' })).toBe('repo-1a')
    expect(isAutoNamed({ nameSource: 'derived' })).toBe(true)
    expect(isAutoNamed({ nameSource: 'user' })).toBe(false)
    expect(isAutoNamed({ nameSource: 'derived', alias: 'x' })).toBe(false)
  })
})

describe('project rows, favorites and notifications', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('lists every project with drive, days and models, ignoring the project filter', async () => {
    const { driveOf } = await import('./usage')
    const usage = useUsageStore()
    usage.reset({
      buckets: [
        bucket(today, 'claude-opus-5-5', String.raw`C:\a`),
        bucket(yesterday, 'claude-haiku-4-5', String.raw`C:\a`),
        bucket(today, 'claude-opus-5-5', String.raw`F:\work\b`),
      ],
      scan: { state: 'ready', filesDone: 1, filesTotal: 1 },
    })
    usage.range = '7d'
    usage.project = String.raw`F:\work\b`
    const a = usage.projectRows.find((r) => r.id === String.raw`C:\a`)!
    expect(usage.projectRows).toHaveLength(2)
    expect(a).toMatchObject({ drive: 'C:', models: 2, activeDays: 2, lastDay: today, messages: 2, tokens: 2 * 11_110 })
    expect([driveOf(String.raw`d:\x`), driveOf(String.raw`\\srv\share`), driveOf('/home/x')]).toEqual(['D:', String.raw`\\`, '/'])
  })

  it('matches favorites case-insensitively and maps status transitions to notifications', async () => {
    const { useFavoritesStore } = await import('./favorites')
    const { transitionKind } = await import('../composables/useNotifications')
    const favorites = useFavoritesStore()
    favorites.replaceAll([{ dir: String.raw`D:\Work\Demo`, label: 'Demo', addedAt: today }])
    expect(favorites.has('d:/work/demo/')).toBe(true)
    expect(favorites.has(String.raw`D:\work\other`)).toBe(false)
    expect(transitionKind('working', 'waiting')).toBe('waiting')
    expect(transitionKind('idle', 'waiting')).toBe('waiting')
    expect(transitionKind('working', 'idle')).toBe('done')
    expect(transitionKind(undefined, 'waiting')).toBeNull()
    expect(transitionKind('idle', 'working')).toBeNull()
  })

  it('schedules waiting reminders every 5 minutes, at most 3', async () => {
    const { remindersDue } = await import('../composables/useNotifications')
    const since = '2026-10-07T10:00:00.000Z'
    const at = (min: number) => Date.parse(since) + min * 60_000
    expect([remindersDue(since, at(4)), remindersDue(since, at(5)), remindersDue(since, at(11)), remindersDue(since, at(60))]).toEqual([0, 1, 2, 3])
    expect(remindersDue(undefined, at(60))).toBe(0)
  })

  it('groups sub folders under their repo root and filters by the group', () => {
    const usage = useUsageStore()
    const repo = 'F:/work/app'
    usage.reset({
      buckets: [bucket(today, 'claude-opus-5-5', repo), bucket(today, 'claude-opus-5-5', `${repo}/src/main`), bucket(today, 'claude-opus-5-5', 'C:/other')],
      scan: { state: 'ready', filesDone: 1, filesTotal: 1 },
      roots: { [`${repo}/src/main`]: repo },
    })
    usage.setRoots({ [repo]: repo })
    expect(usage.groupRepos).toBe(true)
    expect(usage.projectRows.map((r) => [r.id, r.folders, r.messages])).toEqual(
      expect.arrayContaining([
        [repo, 2, 2],
        ['C:/other', 1, 1],
      ]),
    )
    usage.project = repo
    expect(usage.filtered).toHaveLength(2)
    usage.groupRepos = false
    expect(usage.projectRows).toHaveLength(3)
  })
})

describe('panel sizes', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('clamps, persists on save and resets to defaults', async () => {
    const { useUiStore, PANEL_DEFAULTS } = await import('./ui')
    const ui = useUiStore()
    ui.setPanelSize('sessions', 10)
    expect(ui.panelSize.sessions).toBe(260)
    ui.setPanelSize('activityHeight', 9999)
    expect(ui.panelSize.activityHeight).toBe(640)
    ui.savePanelSizes()
    expect(JSON.parse(localStorage.getItem('ccm.panelSize')!)).toMatchObject({ sessions: 260, activityHeight: 640 })
    ui.resetPanelSize('sessions')
    expect(ui.panelSize.sessions).toBe(PANEL_DEFAULTS.sessions)
  })
})

describe('model label', () => {
  it('shortens known model ids and flags the 1M window', async () => {
    const { modelLabel } = await import('../lib/model')
    expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelLabel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(modelLabel('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5')
    expect(modelLabel('claude-opus-5-5', 1_000_000)).toBe('Opus 5.5 · 1M')
    expect(modelLabel('gpt-x')).toBe('gpt-x')
    expect(modelLabel(undefined)).toBeNull()
  })
})
