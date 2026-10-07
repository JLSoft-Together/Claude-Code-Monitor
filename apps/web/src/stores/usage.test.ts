import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
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
