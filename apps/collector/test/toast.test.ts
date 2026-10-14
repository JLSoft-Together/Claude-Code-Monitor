import { mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ActivityEvent, BackgroundJob, PlanLimits, TerminalSession, TerminalStatus } from '@ccm/shared'
import { SnoozeStore } from '../src/snooze'
import { TOAST_THROTTLE_MS, Toaster, toastContent, toastTag, type ToastContent } from '../src/toast'

function term(id: string, status: TerminalStatus, extra: Partial<TerminalSession> = {}): TerminalSession {
  return { id, title: `title-${id}`, status, ...extra }
}

const T0 = Date.parse('2026-10-08T10:00:00')

function setup(supported = true) {
  const calls: string[] = []
  const shown: ToastContent[] = []
  let now = T0
  const toaster = new Toaster(
    { supported, port: 4317 },
    {
      show: async (c) => {
        calls.push(`show:${c.tag}`)
        shown.push(c)
        return true
      },
      hide: async (tag) => {
        calls.push(`hide:${tag}`)
        return true
      },
      now: () => now,
    },
  )
  const flush = () => new Promise((r) => setTimeout(r, 0))
  const see = (...terminals: TerminalSession[]) => toaster.observe({ terminals })
  return { toaster, calls, shown, flush, see, advance: (ms: number) => (now += ms), nowMs: () => now }
}

const w = (id: string) => toastTag(`waiting:${id}`)

describe('Toaster', () => {
  it('shows a toast when a known session starts waiting and hides it when it moves on', async () => {
    const { toaster, calls, shown, flush, see } = setup()
    see(term('a', 'working'))
    see(term('a', 'waiting', { waitingFor: 'permission' }))
    see(term('a', 'working'))
    await flush()
    expect(calls).toEqual([`show:${w('a')}`, `hide:${w('a')}`])
    expect(shown[0]?.title).toBe('title-a đang chờ chủ nhân')
    expect(shown[0]?.body).toBe('Đang chờ permission')
    expect(shown[0]?.persistent).toBe(true)
    expect(shown[0]?.url).toBe(`http://127.0.0.1:4317/focus?k=${toaster.key}&t=a`)
  })

  it('stays quiet for sessions already waiting when first seen', async () => {
    const { calls, flush, see } = setup()
    see(term('a', 'waiting'))
    see(term('a', 'waiting'))
    await flush()
    expect(calls).toEqual([])
  })

  it('skips while a dashboard tab is in front of the user', async () => {
    const { toaster, calls, flush, see } = setup()
    toaster.setPresence(1, true)
    see(term('a', 'idle'))
    see(term('a', 'waiting'))
    toaster.dropClient(1)
    see(term('a', 'idle'), term('b', 'idle'))
    see(term('a', 'idle'), term('b', 'waiting'))
    await flush()
    expect(calls).toEqual([`show:${w('b')}`])
  })

  it('hides open toasts when the user comes back to the dashboard', async () => {
    const { toaster, calls, flush, see } = setup()
    see(term('a', 'idle'))
    see(term('a', 'waiting'))
    toaster.setPresence(2, true, 'en')
    await flush()
    expect(calls).toEqual([`show:${w('a')}`, `hide:${w('a')}`])
  })

  it('throttles repeat toasts per session', async () => {
    const { calls, flush, advance, see } = setup()
    see(term('a', 'idle'))
    see(term('a', 'waiting'))
    see(term('a', 'working'))
    see(term('a', 'waiting'))
    advance(TOAST_THROTTLE_MS)
    see(term('a', 'working'))
    see(term('a', 'waiting'))
    await flush()
    expect(calls.filter((c) => c.startsWith('show'))).toHaveLength(2)
  })

  it('does nothing when turned off or unsupported, and turning off hides open toasts', async () => {
    const { toaster, calls, flush, see } = setup()
    see(term('a', 'idle'))
    see(term('a', 'waiting'))
    toaster.setEnabled(false)
    expect(toaster.state).toBe('off')
    see(term('b', 'idle'))
    see(term('b', 'waiting'))
    await flush()
    expect(calls).toEqual([`show:${w('a')}`, `hide:${w('a')}`])

    const other = setup(false)
    expect(other.toaster.state).toBe('unsupported')
    other.toaster.update({ toast: true })
    expect(other.toaster.state).toBe('unsupported')
    other.see(term('a', 'idle'))
    other.see(term('a', 'waiting'))
    await other.flush()
    expect(other.calls).toEqual([])
  })

  it('hides the toast of a removed session and only accepts its own link key', async () => {
    const { toaster, calls, flush, see } = setup()
    see(term('a', 'idle'))
    see(term('a', 'waiting'))
    see()
    await flush()
    expect(calls).toEqual([`show:${w('a')}`, `hide:${w('a')}`])
    expect(toaster.accepts(toaster.key)).toBe(true)
    expect(toaster.accepts('nope')).toBe(false)
    expect(toaster.accepts(null)).toBe(false)
    expect(toaster.accepts(toaster.key.slice(1))).toBe(false)
    expect(toaster.linkFor()).toBe(`http://127.0.0.1:4317/focus?k=${toaster.key}`)
  })

  it('builds English text with the alias first', () => {
    const c = toastContent(term('a', 'waiting', { alias: 'API fix' }), 'en', 'http://x')
    expect(c.title).toBe('API fix needs you')
    expect(c.body).toBe('Claude is waiting for your input')
    expect(c.open).toBe('Open terminal')
  })

  it('labels permission and question waits, with the open tool when known', () => {
    const perm = term('a', 'waiting', { waitingFor: 'permission prompt' })
    expect(toastContent(perm, 'en', 'http://x', 'Bash').body).toBe('Needs approval: Bash')
    expect(toastContent(perm, 'en', 'http://x').body).toBe('Needs approval')
    expect(toastContent(perm, 'en', 'http://x', 'ExitPlanMode').body).toBe('Plan needs approval')
    expect(toastContent(perm, 'vi', 'http://x', 'Bash').body).toBe('Cần duyệt: Bash')
    expect(toastContent(term('a', 'waiting', { waitingFor: 'input needed' }), 'en', 'http://x').body).toBe('Asking you')
    expect(toastContent(term('a', 'waiting', { waitingFor: 'foo' }), 'en', 'http://x').body).toBe('Waiting for foo')
  })

  it('uses toolOf from observe for the waiting toast body', async () => {
    const { toaster, shown, flush } = setup()
    toaster.observe({ terminals: [term('a', 'working')], toolOf: () => 'Bash' })
    toaster.observe({ terminals: [term('a', 'waiting', { waitingFor: 'permission prompt' })], toolOf: () => 'Bash' })
    await flush()
    expect(shown[0]?.body).toContain('Bash')
  })

  it('reminds every 5 minutes while still waiting, at most 3 times', async () => {
    const { shown, flush, advance, see, nowMs } = setup()
    const since = new Date(T0).toISOString()
    see(term('a', 'working'))
    see(term('a', 'waiting', { statusSince: since }))
    for (let i = 0; i < 5; i++) {
      advance(5 * 60_000)
      see(term('a', 'waiting', { statusSince: since }))
    }
    await flush()
    expect(shown.map((c) => c.title)).toEqual([
      'title-a đang chờ chủ nhân',
      'title-a vẫn đang chờ chủ nhân (5 phút)',
      'title-a vẫn đang chờ chủ nhân (10 phút)',
      'title-a vẫn đang chờ chủ nhân (15 phút)',
    ])
    expect(nowMs() - T0).toBe(25 * 60_000)
  })

  it('does not replay reminders for a session already waiting at startup', async () => {
    const { shown, flush, advance, see } = setup()
    const since = new Date(T0 - 12 * 60_000).toISOString()
    see(term('a', 'waiting', { statusSince: since }))
    see(term('a', 'waiting', { statusSince: since }))
    advance(3 * 60_000)
    see(term('a', 'waiting', { statusSince: since }))
    await flush()
    expect(shown.map((c) => c.title)).toEqual(['title-a vẫn đang chờ chủ nhân (15 phút)'])
  })

  it('respects snooze for the first toast and reminders, and hides an open one', async () => {
    const { toaster, calls, flush, advance, see, nowMs } = setup()
    const snoozes = new SnoozeStore(undefined, nowMs)
    toaster.snoozed = (t) => snoozes.isSnoozed(t)
    const since = new Date(T0).toISOString()
    see(term('a', 'working'))
    see(term('a', 'waiting', { statusSince: since }))
    expect(snoozes.set(term('a', 'waiting', { statusSince: since }), 15)).toBe(true)
    advance(10 * 60_000)
    see(term('a', 'waiting', { statusSince: since }))
    advance(6 * 60_000)
    see(term('a', 'waiting', { statusSince: since }))
    await flush()
    expect(calls).toEqual([`show:${w('a')}`, `hide:${w('a')}`, `show:${w('a')}`])
  })

  it('stays silent during quiet hours', async () => {
    const { toaster, calls, flush, see, advance } = setup()
    toaster.update({ quiet: { enabled: true, from: '09:00', to: '11:00' } })
    see(term('a', 'idle'))
    see(term('a', 'waiting'))
    advance(2 * 3_600_000)
    see(term('a', 'idle'))
    see(term('a', 'waiting'))
    await flush()
    expect(calls).toEqual([`show:${w('a')}`])
  })

  it('toasts finished sessions only when that kind is on', async () => {
    const { toaster, shown, flush, see } = setup()
    see(term('a', 'working'))
    see(term('a', 'idle'))
    toaster.update({ kinds: { done: true } })
    see(term('a', 'working'))
    see(term('a', 'idle'))
    await flush()
    expect(shown.map((c) => [c.title, c.persistent])).toEqual([['title-a đã xong', false]])
    expect(toaster.settings().kinds.done).toBe(true)
  })

  it('toasts blocked jobs after the first sighting and links to the owning session', async () => {
    const { toaster, shown, calls, flush } = setup()
    const owner = term('a', 'working', { claudeSessionId: 's1' })
    const job = (state: BackgroundJob['state']): BackgroundJob => ({ id: 'j1', name: 'nightly', state, sessionId: 's1' })
    toaster.observe({ terminals: [owner], jobs: [job('blocked')] })
    toaster.observe({ terminals: [owner], jobs: [job('working')] })
    toaster.observe({ terminals: [owner], jobs: [job('blocked')] })
    toaster.observe({ terminals: [owner], jobs: [] })
    await flush()
    expect(shown.map((c) => c.title)).toEqual(['Job nền cần chủ nhân: nightly'])
    expect(shown[0]?.url).toBe(toaster.linkFor('a'))
    expect(calls.at(-1)).toBe(`hide:${toastTag('job:j1')}`)
  })

  it('warns once per window when the 5-hour limit runs out within the hour', async () => {
    const { toaster, shown, flush } = setup()
    const limits = (pct: number, inMin: number, resetsAt = '2026-10-08T12:00:00Z'): PlanLimits => ({
      updatedAt: new Date(T0).toISOString(),
      fiveHour: { usedPct: pct, resetsAt, forecast: { pctPerHour: 40, fullAt: new Date(T0 + inMin * 60_000).toISOString(), beforeReset: true } },
    })
    toaster.observe({ terminals: [], limits: limits(50, 120) })
    toaster.observe({ terminals: [], limits: limits(80, 30) })
    toaster.observe({ terminals: [], limits: limits(85, 20) })
    await flush()
    expect(shown.map((c) => c.title)).toEqual(['Giới hạn 5h đã dùng 80%'])
    expect(shown[0]?.url).toBe(toaster.linkFor())
  })

  it('toasts a session stuck in an error loop once per episode', async () => {
    const { toaster, shown, flush, see } = setup()
    see(term('a', 'working'))
    const events: ActivityEvent[] = []
    for (let i = 0; i < 6; i++) {
      const at = new Date(T0 - 60_000 + i * 1000).toISOString()
      events.push({ id: `s${i}`, at, kind: 'tool.started', terminalId: 'a', data: { tool: 'Bash' } })
      events.push({ id: `f${i}`, at, kind: 'tool.failed', terminalId: 'a', data: { tool: 'Bash' } })
    }
    toaster.checkLoops(events)
    toaster.checkLoops(events)
    await flush()
    expect(shown.map((c) => [c.title, c.body])).toEqual([['title-a lỗi liên tục', 'Bash lỗi 6 lần trong 5 phút.']])
  })
})

describe('SnoozeStore', () => {
  it('holds a snooze only for the waiting episode it was set on', () => {
    let now = T0
    const store = new SnoozeStore(undefined, () => now)
    const since = new Date(T0).toISOString()
    const a = term('a', 'waiting', { statusSince: since })
    expect(store.set(term('b', 'working'), 15)).toBe(false)
    expect(store.set(a, 0)).toBe(false)
    expect(store.set(a, 15)).toBe(true)
    expect(store.isSnoozed(a)).toBe(true)
    expect(store.isSnoozed(term('a', 'waiting', { statusSince: 'later' }))).toBe(false)
    expect(store.prune([a])).toBe(false)
    expect(store.prune([term('a', 'working')])).toBe(true)
    expect(store.all()).toEqual({})
    store.set(a, 15)
    now += 16 * 60_000
    expect(store.isSnoozed(a)).toBe(false)
    expect(store.set(a, null)).toBe(true)
  })
})

describe('app key', () => {
  it('refuses pages and the socket without the desktop key, keeps /health open', async () => {
    const { startServer } = await import('../src/server')
    const { MonitorStore } = await import('../src/store')
    const server = await startServer({ host: '127.0.0.1', port: 0, webDist: '.', appKey: 'k'.repeat(64), store: new MonitorStore({ activityLimit: 10, batchMs: 10 }) })
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    try {
      expect((await fetch(`${base}/health`)).status).toBe(200)
      expect((await fetch(`${base}/`)).status).toBe(403)
      expect((await fetch(`${base}/`, { headers: { 'x-ccm-app': 'x'.repeat(64) } })).status).toBe(403)
      expect((await fetch(`${base}/`, { headers: { 'x-ccm-app': 'k'.repeat(64) } })).status).not.toBe(403)
    } finally {
      server.close()
    }
  })
})

describe('focus routes', () => {
  it('runs focus over POST only for the right key', async () => {
    const { startServer } = await import('../src/server')
    const { MonitorStore } = await import('../src/store')
    const runs: string[] = []
    const server = await startServer({
      host: '127.0.0.1',
      port: 0,
      webDist: '.',
      store: new MonitorStore({ activityLimit: 10, batchMs: 10 }),
      onFocusRun: async (t, key) => {
        if (key !== 'good') return null
        runs.push(t)
        return t === 'a' ? 'ok' : 'notFound'
      },
    })
    const port = (server.address() as { port: number }).port
    const base = `http://127.0.0.1:${port}`
    try {
      const run = (t: string, k: string) => fetch(`${base}/focus`, { method: 'POST', body: JSON.stringify({ t, k }) }).then(async (r) => [r.status, ((await r.json()) as { result: string }).result])
      expect(await run('a', 'good')).toEqual([200, 'ok'])
      expect(await run('b', 'good')).toEqual([200, 'notFound'])
      expect(await run('a', 'bad')).toEqual([404, 'rejected'])
      expect(runs).toEqual(['a', 'b'])
    } finally {
      server.close()
    }
  })
})

describe('Toaster v11', () => {
  it('adds a snooze action to waiting toasts', async () => {
    const { toaster, shown, flush, see } = setup()
    see(term('a', 'idle'))
    see(term('a', 'waiting'))
    await flush()
    expect(shown[0]?.snoozeLabel).toBe('Hoãn 15 phút')
    expect(shown[0]?.snoozeUrl).toBe(`http://127.0.0.1:4317/snooze?k=${toaster.key}&t=a&m=15`)
  })

  it('toasts a quiet working session once per stretch, using the collector threshold', async () => {
    const { toaster, shown, flush, see, advance } = setup()
    const last = new Date(T0).toISOString()
    toaster.update({ stuckMinutes: 5 })
    see(term('a', 'working', { lastActivityAt: last }))
    advance(6 * 60_000)
    see(term('a', 'working', { lastActivityAt: last }))
    see(term('a', 'working', { lastActivityAt: last }))
    await flush()
    expect(shown.map((c) => [c.title, c.body])).toEqual([['title-a không có output', 'Đang chạy nhưng không có output 6 phút.']])
    expect(toaster.settings().stuckMinutes).toBe(5)
  })

  it('toasts once when context crosses the critical level', async () => {
    const { toaster, shown, flush } = setup()
    let pct = 80
    const snap = () => ({ terminals: [term('a', 'working')], contextPct: () => pct })
    toaster.observe(snap())
    pct = 96
    toaster.observe(snap())
    toaster.observe(snap())
    pct = 50
    toaster.observe(snap())
    pct = 97
    toaster.observe(snap())
    await flush()
    expect(shown.map((c) => c.title)).toEqual(['title-a đã dùng 96% context', 'title-a đã dùng 97% context'])
  })

  it('sends a test toast and reports Windows health', async () => {
    const shown: ToastContent[] = []
    const toaster = new Toaster(
      { supported: true, port: 1 },
      { show: async (c) => (shown.push(c), true), hide: async () => true, now: () => T0, health: async () => 'appOff' },
    )
    toaster.setPresence(1, true)
    expect(await toaster.test()).toEqual({ result: 'ok', health: 'appOff' })
    expect(shown[0]?.title).toBe('Thông báo thử')
    expect(toaster.settings().health).toBe('appOff')
    expect(await new Toaster({ supported: false, port: 1 }).test()).toEqual({ result: 'unsupported' })
  })
})

describe('snooze route', () => {
  it('snoozes through the toast link only with the right key', async () => {
    const { startServer } = await import('../src/server')
    const { MonitorStore } = await import('../src/store')
    const calls: string[] = []
    const server = await startServer({
      host: '127.0.0.1',
      port: 0,
      webDist: '.',
      store: new MonitorStore({ activityLimit: 10, batchMs: 10 }),
      onSnoozeLink: (t, key, m) => key === 'good' && calls.push(`${t}:${m}`) > 0,
    })
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
    try {
      expect((await fetch(`${base}/snooze?k=bad&t=a&m=15`)).status).toBe(404)
      expect((await fetch(`${base}/snooze?k=good&t=a&m=x`)).status).toBe(404)
      const ok = await fetch(`${base}/snooze?k=good&t=a&m=15`)
      expect(ok.status).toBe(204)
      expect(calls).toEqual(['a:15'])
    } finally {
      server.close()
    }
  })
})

describe('toast link key', () => {
  it('survives a restart so toasts left in the Action Center keep working', async () => {
    const file = path.join(await mkdtemp(path.join(os.tmpdir(), 'ccm-key-')), 'notify.json')
    const first = new Toaster({ supported: true, port: 4317, file })
    await first.load()
    await first.flush()
    const second = new Toaster({ supported: true, port: 4317, file })
    await second.load()
    expect(second.key).toMatch(/^[0-9a-f]{32}$/)
    expect(second.key).toBe(first.key)
    expect(second.accepts(first.key)).toBe(true)
  })
})
