import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { MonitorEvent, MonitorSnapshot, PeerLink } from '@ccm/shared'
import { useConnectionStore } from './connection'
import { BOTH_MS, RECEIVED_MS, SENT_MS, WARM_MS, openedLinkId, peerLinkId, usePeersStore } from './peers'
import { now } from '../lib/format'

const T0 = Date.parse('2026-10-16T10:00:00.000Z')

const link = (a: string, b: string, over: Partial<PeerLink> = {}): PeerLink => ({
  id: peerLinkId(a, b),
  kind: 'message',
  a: a < b ? a : b,
  b: a < b ? b : a,
  ab: 1,
  ba: 0,
  firstAt: new Date(T0).toISOString(),
  lastAt: new Date(T0).toISOString(),
  lastDir: 'ab',
  ...over,
})

let seq = 0
const send = (...events: MonitorEvent[]) => useConnectionStore().onMessage(JSON.stringify({ seq: seq++, events }))
const snapshot = (peerLinks: PeerLink[]): MonitorEvent => ({
  type: 'snapshot',
  payload: { protocolVersion: 1, collectorStartedAt: '', supportedClaudeVersion: '', terminals: [], agents: [], activity: [], peerLinks } as MonitorSnapshot,
})

describe('peers store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0)
    now.value = T0
    setActivePinia(createPinia())
    seq = 0
  })
  afterEach(() => vi.useRealTimers())

  it('hydrates links from the snapshot without pulses', () => {
    send(snapshot([link('t1', 't2', { ab: 3, ba: 2 })]))
    const peers = usePeersStore()
    expect(peers.list).toHaveLength(1)
    expect(peers.pulses).toHaveLength(0)
    expect(peers.recentOf('t1')).toBeNull()
  })

  it('pulses a new link and every count that grows', () => {
    send(snapshot([]))
    send({ type: 'link.created', payload: link('t1', 't2') })
    const peers = usePeersStore()
    expect(peers.pulses.map((p) => [p.from, p.to, p.n])).toEqual([['t1', 't2', 1]])
    send({ type: 'link.updated', payload: { id: peerLinkId('t1', 't2'), ab: 3, lastDir: 'ab' } })
    expect(peers.pulses.at(-1)).toMatchObject({ from: 't1', to: 't2', n: 2 })
    send({ type: 'link.updated', payload: { id: peerLinkId('t1', 't2'), lastAt: new Date(T0 + 5).toISOString() } })
    expect(peers.pulses).toHaveLength(2)
  })

  it('does not pulse links rebuilt from older messages', () => {
    send(snapshot([]))
    const old = new Date(T0 - 60_000).toISOString()
    send({ type: 'link.created', payload: link('t1', 't2', { lastAt: old, firstAt: old }) })
    send({ type: 'link.updated', payload: { id: peerLinkId('t1', 't2'), ab: 2 } })
    const peers = usePeersStore()
    expect(peers.list).toHaveLength(1)
    expect(peers.pulses).toHaveLength(0)
    send({ type: 'link.updated', payload: { id: peerLinkId('t1', 't2'), ab: 3, lastAt: new Date(T0).toISOString() } })
    expect(peers.pulses.map((p) => p.n)).toEqual([1])
  })

  it('shows sent for 4 s and received for 8 s', () => {
    send(snapshot([]), { type: 'link.created', payload: link('t1', 't2') })
    const peers = usePeersStore()
    expect(peers.recentOf('t1')).toMatchObject({ dir: 'out', others: ['t2'], n: 1 })
    expect(peers.recentOf('t2')).toMatchObject({ dir: 'in', others: ['t1'], n: 1 })
    vi.advanceTimersByTime(SENT_MS + 50)
    expect(peers.recentOf('t1')).toBeNull()
    expect(peers.recentOf('t2')).not.toBeNull()
    vi.advanceTimersByTime(RECEIVED_MS - SENT_MS)
    expect(peers.recentOf('t2')).toBeNull()
  })

  it('reads a reply within 30 s as talking with', () => {
    send(snapshot([]), { type: 'link.created', payload: link('t1', 't2') })
    vi.advanceTimersByTime(BOTH_MS - 1_000)
    send({ type: 'link.updated', payload: { id: peerLinkId('t1', 't2'), ba: 1, lastDir: 'ba', lastAt: new Date(Date.now()).toISOString() } })
    const peers = usePeersStore()
    expect(peers.recentOf('t1')).toMatchObject({ dir: 'both', others: ['t2'], n: 2 })
    expect(peers.recentOf('t2')).toMatchObject({ dir: 'both', others: ['t1'] })
  })

  it('keeps talking with for 8 s on the side that replied', () => {
    send(snapshot([]), { type: 'link.created', payload: link('t1', 't2') })
    vi.advanceTimersByTime(2_000)
    send({ type: 'link.updated', payload: { id: peerLinkId('t1', 't2'), ba: 1, lastDir: 'ba', lastAt: new Date(Date.now()).toISOString() } })
    const peers = usePeersStore()
    vi.advanceTimersByTime(SENT_MS + 1_000)
    expect(peers.recentOf('t2')).toMatchObject({ dir: 'both' })
    vi.advanceTimersByTime(RECEIVED_MS - SENT_MS)
    expect(peers.recentOf('t2')).toBeNull()
  })

  it('stays quiet while the collector is still loading sessions', () => {
    send(snapshot([]), { type: 'sessions.loading', payload: { loading: true } }, { type: 'link.created', payload: link('t1', 't2') })
    const peers = usePeersStore()
    expect(peers.list).toHaveLength(1)
    expect(peers.pulses).toHaveLength(0)
    send({ type: 'sessions.loading', payload: { loading: false } })
    send({ type: 'link.updated', payload: { id: peerLinkId('t1', 't2'), ab: 2, lastAt: new Date(Date.now()).toISOString() } })
    expect(peers.pulses).toHaveLength(1)
  })

  it('keeps the warm list identity while nothing changes', () => {
    send(snapshot([link('a', 'b')]))
    const peers = usePeersStore()
    const first = peers.warm
    now.value = T0 + 20_000
    expect(peers.warm).toBe(first)
  })

  it('lists several receivers newest first', () => {
    send(snapshot([]), { type: 'link.created', payload: link('a', 'b') })
    vi.advanceTimersByTime(500)
    send({ type: 'link.created', payload: link('a', 'c') })
    expect(usePeersStore().recentOf('a')).toMatchObject({ dir: 'out', others: ['c', 'b'], n: 2 })
  })

  it('counts coordination over warm links only', () => {
    send(snapshot([link('a', 'b'), link('a', 'c'), link('b', 'c', { ab: 0, ba: 1, lastDir: 'ba' })]))
    const peers = usePeersStore()
    expect(peers.roleOf('a')).toMatchObject({ sentTo: ['b', 'c'], heardFrom: [], coordinating: 2 })
    expect(peers.roleOf('c')).toMatchObject({ sentTo: ['b'], heardFrom: ['a'], coordinating: 0 })
    now.value = T0 + WARM_MS + 30_000
    expect(peers.roleOf('a').coordinating).toBe(0)
  })

  it('drops links of a removed terminal and removed links', () => {
    send(snapshot([link('a', 'b'), link('c', 'd')]))
    send({ type: 'terminal.removed', payload: { id: 'a' } }, { type: 'link.removed', payload: { id: peerLinkId('c', 'd') } })
    expect(usePeersStore().list).toHaveLength(0)
  })

  it('keeps opened links apart and announces only new ones', () => {
    const peers = usePeersStore()
    const opened = (by: string, to: string): PeerLink => ({ ...link(by, to), id: openedLinkId(by, to), kind: 'opened', a: by, b: to })
    peers.setOpened([opened('a', 'b')], true)
    expect(peers.recentOf('b')).toBeNull()
    peers.setOpened([opened('a', 'b'), opened('a', 'c')])
    expect(peers.recentOf('c')).toMatchObject({ dir: 'in', kind: 'opened', others: ['a'] })
    expect(peers.recentOf('a')).toBeNull()
    expect(peers.roleOf('a')).toMatchObject({ opened: ['b', 'c'], coordinating: 0 })
    expect(peers.roleOf('b').openedBy).toBe('a')
  })
})
