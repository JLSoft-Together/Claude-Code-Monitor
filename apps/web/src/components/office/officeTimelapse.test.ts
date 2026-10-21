import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { WorldPlayback } from '@ccm/habblaud/client/src/world/api'
import type { TimelineRecord } from '@ccm/habblaud/shared/timeline'
import { dayKey, dayStart, shiftDay } from '@ccm/habblaud/shared/timeline'
import { animScale } from '@ccm/habblaud/client/src/world/playback'
import { officeFeed } from '../../office/feed'
import { hourTicks, SPEEDS, sortDays } from '../../office/timelapse'
import { i18n } from '../../i18n'
import { useOfficeStore } from '../../stores/office'
import OfficeTimelapse from './OfficeTimelapse.vue'

type Route = { status: number; body: string }
let routes: Record<string, Route | Error>
let fetchMock: ReturnType<typeof vi.fn>
let rafQueue: FrameRequestCallback[]
let now: number
let w: VueWrapper | null = null
let world: { setPlayback: ReturnType<typeof vi.fn> }

const today = dayKey(Date.now())
const yesterday = shiftDay(today, -1)
const older = shiftDay(today, -3)
const FROM = dayStart(today) + 10 * 3_600_000
const TO = FROM + 60 * 60_000

function dayRecords(from: number): TimelineRecord[] {
  const room = { id: 'r1', name: 'app', path: '', slot: 0, seed: 1, createdAt: from }
  const agent = {
    id: 'a1',
    kind: 'main' as const,
    roomId: 'r1',
    name: 'Ada',
    look: 'f' as const,
    role: 'main',
    account: 'acc',
    status: 'working' as const,
    statusSince: from,
    startedAt: from,
    seed: 7,
  }
  return [
    { t: 'k', at: from, v: 1, every: 300_000, rooms: [room], agents: [agent], accounts: [] },
    { t: 'd', at: from + 30 * 60_000, agents: [['a1', { status: 'idle' }]] },
    { t: 'k', at: from + 60 * 60_000, v: 1, every: 300_000, rooms: [room], agents: [{ ...agent, status: 'idle' }], accounts: [] },
  ]
}

const jsonl = (records: TimelineRecord[]): string => records.map((r) => JSON.stringify(r)).join('\n') + '\n'

function daysBody(days: string[]): string {
  return JSON.stringify({ recording: true, days: days.map((day) => ({ day, bytes: 100, from: dayStart(day) + 36_000_000, to: dayStart(day) + 39_600_000 })) })
}

async function mountBar(): Promise<VueWrapper> {
  w = mount(OfficeTimelapse, { global: { plugins: [i18n] }, attachTo: document.body })
  await flushPromises()
  return w
}

function frame(ms: number): void {
  now += ms
  const q = rafQueue.splice(0)
  for (const cb of q) cb(now)
}

beforeEach(() => {
  setActivePinia(createPinia())
  i18n.global.locale.value = 'en'
  routes = {
    '/api/timeline/days': { status: 200, body: daysBody([older, today, yesterday]) },
    [`/api/timeline/${today}`]: { status: 200, body: jsonl(dayRecords(FROM)) },
    [`/api/timeline/${yesterday}`]: { status: 200, body: jsonl(dayRecords(dayStart(yesterday) + 36_000_000)) },
  }
  fetchMock = vi.fn(async (url: string) => {
    const r = routes[url]
    if (r instanceof Error) throw r
    if (!r) return new Response('not found', { status: 404 })
    return new Response(r.body, { status: r.status })
  })
  vi.stubGlobal('fetch', fetchMock)
  rafQueue = []
  now = 1000
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => rafQueue.push(cb))
  vi.stubGlobal('cancelAnimationFrame', () => {
    rafQueue.length = 0
  })
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  world = { setPlayback: vi.fn() }
  const office = useOfficeStore()
  office.world = world as never
  office.timelapse = true
})

afterEach(() => {
  w?.unmount()
  w = null
  officeFeed.stopReplay()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('OfficeTimelapse days', () => {
  it('lists the recorded days with today first, then yesterday, then a weekday date', async () => {
    await mountBar()
    const opts = w!.findAll('select option')
    expect(opts.map((o) => o.attributes('value'))).toEqual([today, yesterday, older])
    expect(opts[0]!.text()).toMatch(/^Today · /)
    expect(opts[1]!.text()).toMatch(/^Yesterday · /)
    const weekday = new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short' }).format(dayStart(older))
    expect(opts[2]!.text().startsWith(weekday)).toBe(true)
    expect((w!.find('select').element as HTMLSelectElement).value).toBe(today)
    expect(fetchMock).toHaveBeenCalledWith('/api/timeline/days', expect.anything())
    expect(fetchMock).toHaveBeenCalledWith(`/api/timeline/${today}`, expect.anything())
  })

  it('labels the days in Vietnamese with the active locale', async () => {
    i18n.global.locale.value = 'vi'
    await mountBar()
    const opts = w!.findAll('select option')
    expect(opts[0]!.text()).toMatch(/^Hôm nay · /)
    expect(opts[1]!.text()).toMatch(/^Hôm qua · /)
  })

  it('sorts days newest first and ignores order from the server', () => {
    const d = (day: string) => ({ day, bytes: 1, from: 0, to: 0 })
    expect(sortDays([d('2026-10-01'), d('2026-10-03'), d('2026-10-02')]).map((x) => x.day)).toEqual(['2026-10-03', '2026-10-02', '2026-10-01'])
  })

  it('places at most ~6 hour ticks on whole hours', () => {
    const base = new Date(2026, 9, 21, 9, 30).getTime()
    const ticks = hourTicks(base, base + 3 * 3_600_000)
    expect(ticks.map((t) => new Date(t).getHours())).toEqual([10, 11, 12])
    expect(hourTicks(base, base + 20 * 3_600_000).length).toBeLessThanOrEqual(6)
  })
})

describe('OfficeTimelapse playback', () => {
  it('plays the day: pushes replay snapshots and sets the world playback', async () => {
    const push = vi.spyOn(officeFeed, 'pushReplay')
    await mountBar()
    expect(push).toHaveBeenCalled()
    expect(push.mock.calls.at(-1)![0].serverTime).toBe(FROM)
    expect(push.mock.calls.at(-1)![0].agents.map((a) => a.id)).toEqual(['a1'])
    expect(officeFeed.replaying).toBe(true)
    expect(useOfficeStore().replaying).toBe(true)
    const playback = world.setPlayback.mock.calls.at(-1)![0] as WorldPlayback
    expect(playback.clock()).toBe(FROM)
    expect(playback.scale()).toBe(animScale(180))

    // 250 ms at 180× = 45 s of the day; the push throttle (200 ms) lets it through.
    frame(250)
    expect(push.mock.calls.at(-1)![0].serverTime).toBe(FROM + 45_000)
    expect(playback.clock()).toBe(FROM + 45_000)
    // A frame within 200 ms of the last push advances the clock but does not push.
    const pushes = push.mock.calls.length
    frame(100)
    expect(push.mock.calls.length).toBe(pushes)
    expect(playback.clock()).toBe(FROM + 63_000)

    await w!.find('[data-lapse-play]').trigger('click')
    expect(playback.scale()).toBe(0)
  })

  it('shows the REPLAY badge with the replay clock', async () => {
    await mountBar()
    const badge = w!.find('[data-lapse-badge]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toContain('REPLAY')
    const hhmm = new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(FROM)
    expect(badge.text()).toContain(hhmm)
  })

  it('offers 60×, 180× and 600× with 180× picked', async () => {
    await mountBar()
    const radios = w!.findAll('[data-lapse-speed] [role="radio"]')
    expect(radios.map((r) => r.text())).toEqual(['60×', '180×', '600×'])
    expect(SPEEDS).toEqual([60, 180, 600])
    expect(radios[1]!.attributes('aria-checked')).toBe('true')
    await radios[2]!.trigger('click')
    const playback = world.setPlayback.mock.calls.at(-1)![0] as WorldPlayback
    expect(playback.scale()).toBe(animScale(600))
  })

  it('steps the scrubber by 60 s and seeks the world to the picked moment', async () => {
    const push = vi.spyOn(officeFeed, 'pushReplay')
    await mountBar()
    const range = w!.find('input[type="range"]')
    expect(range.attributes('step')).toBe('60')
    expect(range.attributes('max')).toBe(String((TO - FROM) / 1000))
    ;(range.element as HTMLInputElement).value = '1800'
    await range.trigger('change')
    expect(push.mock.calls.at(-1)![0].serverTime).toBe(FROM + 1_800_000)
    expect(push.mock.calls.at(-1)![0].agents[0]!.status).toBe('idle')
  })

  it('keeps the thumb where the user put it when the bar re-renders', async () => {
    await mountBar()
    await w!.find('[data-lapse-play]').trigger('click')
    const range = w!.find('input[type="range"]')
    const el = range.element as HTMLInputElement
    el.value = '600'
    await range.trigger('input')
    await flushPromises()
    expect(el.value).toBe('600')
    expect(w!.find('[data-lapse-bar] strong').text()).toBe(new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(FROM + 600_000))
  })

  it('jumps to a peak when its mark is clicked', async () => {
    const push = vi.spyOn(officeFeed, 'pushReplay')
    await mountBar()
    const peak = w!.find('[data-lapse-peak]')
    expect(peak.exists()).toBe(true)
    expect(peak.attributes('aria-label')).toMatch(/1 agent working|one agent working/)
    await peak.trigger('click')
    expect(push.mock.calls.at(-1)![0].serverTime).toBeGreaterThanOrEqual(FROM - 60_000)
  })

  it('"Back to live" stops the replay and clears the world playback', async () => {
    const stop = vi.spyOn(officeFeed, 'stopReplay')
    await mountBar()
    await w!.find('[data-lapse-live]').trigger('click')
    expect(stop).toHaveBeenCalled()
    expect(world.setPlayback).toHaveBeenLastCalledWith(null)
    expect(officeFeed.replaying).toBe(false)
    expect(useOfficeStore().timelapse).toBe(false)
    expect(useOfficeStore().replaying).toBe(false)
  })

  it('ends the replay on unmount (leaving the Office view)', async () => {
    await mountBar()
    expect(officeFeed.replaying).toBe(true)
    w!.unmount()
    w = null
    expect(officeFeed.replaying).toBe(false)
    expect(world.setPlayback).toHaveBeenLastCalledWith(null)
    expect(rafQueue.length).toBe(0)
  })

  it('re-applies the playback to a world rebuilt by a language switch and re-publishes the paused moment', async () => {
    const push = vi.spyOn(officeFeed, 'pushReplay')
    await mountBar()
    frame(250)
    await w!.find('[data-lapse-play]').trigger('click') // pause at FROM + 45 s
    const at = FROM + 45_000
    push.mockClear()
    // The rebuilt world's setPlayback restarts its sim empty: a snapshot must follow it.
    const order: string[] = []
    const next = { setPlayback: vi.fn((_p: WorldPlayback | null) => order.push('setPlayback')) }
    push.mockImplementation(function (this: typeof officeFeed, s) {
      order.push('push')
      return Object.getPrototypeOf(officeFeed).pushReplay.call(this, s)
    })
    useOfficeStore().world = next as never
    await flushPromises()
    expect(next.setPlayback).toHaveBeenCalledWith(expect.objectContaining({ clock: expect.any(Function) }))
    expect(push).toHaveBeenCalledTimes(1)
    expect(push.mock.calls[0]![0].serverTime).toBe(at)
    expect(push.mock.calls[0]![0].agents.map((a) => a.id)).toEqual(['a1'])
    expect(order).toEqual(['setPlayback', 'push'])
    expect((next.setPlayback.mock.calls[0]![0] as WorldPlayback).scale()).toBe(0)
  })
})

describe('OfficeTimelapse without history', () => {
  it('shows "no history" when the timeline is not served (404), without an error', async () => {
    routes['/api/timeline/days'] = { status: 404, body: '' }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await mountBar()
    expect(w!.find('[data-lapse-msg]').text()).toBe(i18n.global.t('officeV60.timelapse.noHistory'))
    expect(w!.find('[data-lapse-error]').exists()).toBe(false)
    expect(officeFeed.replaying).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  it('shows "no history" when no day was recorded', async () => {
    routes['/api/timeline/days'] = { status: 200, body: daysBody([]) }
    await mountBar()
    expect(w!.find('[data-lapse-msg]').text()).toBe(i18n.global.t('officeV60.timelapse.noHistory'))
    expect(w!.find('[data-lapse-error]').exists()).toBe(false)
  })

  it('shows "nothing on this day" for a day file that is gone (404) or empty', async () => {
    routes[`/api/timeline/${today}`] = { status: 404, body: '' }
    await mountBar()
    expect(w!.find('[data-lapse-msg]').text()).toBe(i18n.global.t('officeV60.timelapse.emptyDay'))
    expect(w!.find('[data-lapse-error]').exists()).toBe(false)
    expect(officeFeed.replaying).toBe(false)

    routes[`/api/timeline/${yesterday}`] = { status: 200, body: '' }
    await w!.find('select').setValue(yesterday)
    await flushPromises()
    expect(w!.find('[data-lapse-msg]').text()).toBe(i18n.global.t('officeV60.timelapse.emptyDay'))
    expect(w!.find('[data-lapse-error]').exists()).toBe(false)
  })

  it('shows the error text when the fetch fails, never an unhandled rejection', async () => {
    routes['/api/timeline/days'] = new TypeError('Failed to fetch')
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await mountBar()
    expect(w!.find('[data-lapse-error]').exists()).toBe(true)
    expect(w!.find('[data-lapse-msg]').text()).toBe(i18n.global.t('officeV60.timelapse.errorDays'))
  })

  it('shows the error text when a day cannot be loaded (HTTP 500)', async () => {
    routes[`/api/timeline/${today}`] = { status: 500, body: '' }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await mountBar()
    expect(w!.find('[data-lapse-msg]').text()).toBe(i18n.global.t('officeV60.timelapse.errorDay'))
    expect(w!.find('[data-lapse-play]').attributes('disabled')).toBeDefined()
  })
})
