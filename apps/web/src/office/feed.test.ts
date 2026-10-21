import { describe, expect, it, vi } from 'vitest'
import type { OfficeSnapshot } from '@ccm/habblaud/shared/types'
import { applyOfficeLocale } from './i18n'
import { OfficeFeed } from './feed'

const colors = { claude: '#111111', codex: '#222222' }
const snap = (rev: number, role = 'main'): OfficeSnapshot =>
  ({
    rev,
    serverTime: rev,
    rooms: [],
    agents: [{ id: 'a', kind: 'main', role, recent: [], tasks: [], shells: [] }],
    accounts: [{ id: '.claude', short: 'C', name: 'C', color: '#000000' }],
    meta: {},
  }) as unknown as OfficeSnapshot

describe('OfficeFeed', () => {
  it('emits on ingest and localizes', async () => {
    await applyOfficeLocale('en')
    const feed = new OfficeFeed({ colors: () => colors })
    const cb = vi.fn()
    feed.on('snapshot', cb)
    feed.ingestLive(snap(1))
    expect(cb).toHaveBeenCalledTimes(1)
    expect(feed.snapshot!.agents[0]!.role).toBe('Main agent')
    expect(feed.snapshot!.accounts[0]!.color).toBe('#111111')
  })

  it('unsubscribes', () => {
    const feed = new OfficeFeed({ colors: () => colors })
    const cb = vi.fn()
    const off = feed.on('snapshot', cb)
    off()
    feed.ingestLive(snap(1))
    expect(cb).not.toHaveBeenCalled()
  })

  it('ignores live updates while replaying but keeps liveSnapshot, and stopReplay restores', () => {
    const feed = new OfficeFeed({ colors: () => colors })
    feed.ingestLive(snap(1))
    feed.pushReplay(snap(50))
    expect(feed.replaying).toBe(true)
    feed.ingestLive(snap(2))
    expect(feed.snapshot!.rev).toBe(50)
    expect(feed.liveSnapshot!.rev).toBe(2)
    const cb = vi.fn()
    feed.on('snapshot', cb)
    feed.stopReplay()
    expect(feed.replaying).toBe(false)
    expect(feed.snapshot!.rev).toBe(2)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('relocalize rebuilds from raw with the current locale and emits', async () => {
    await applyOfficeLocale('en')
    const feed = new OfficeFeed({ colors: () => colors })
    feed.ingestLive(snap(1))
    expect(feed.snapshot!.agents[0]!.role).toBe('Main agent')
    await applyOfficeLocale('vi')
    const cb = vi.fn()
    feed.on('snapshot', cb)
    feed.relocalize()
    expect(feed.snapshot!.agents[0]!.role).not.toBe('Main agent')
    expect(feed.liveSnapshot!.agents[0]!.role).toBe(feed.snapshot!.agents[0]!.role)
    expect(cb).toHaveBeenCalledTimes(1)
  })
})
