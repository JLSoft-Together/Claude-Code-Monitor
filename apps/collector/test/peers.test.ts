import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PeerLink } from '@ccm/shared'
import { PeerLinkStore, peerLinkId, type PeerInbound, type PeerLinkOptions, type PeerMessage } from '../src/peers'

const A = '100:1'
const B = '200:2'
const C = '300:3'
const SUB = 'a0123456789abcdef'
const T0 = Date.parse('2026-10-16T10:00:00.000Z')
const iso = (s: number) => new Date(T0 + s * 1000).toISOString()

interface Event {
  type: 'upsert' | 'remove'
  link?: PeerLink
  id?: string
}

function setup(options: Partial<PeerLinkOptions> = {}) {
  const events: Event[] = []
  const messages: PeerMessage[] = []
  const keys = new Map([
    ['ka', A],
    ['kb', B],
    ['kc', C],
  ])
  const store = new PeerLinkStore(
    { upsertLink: (link) => events.push({ type: 'upsert', link }), removeLink: (id) => events.push({ type: 'remove', id }) },
    { ttlMs: 60 * 60_000, senderOf: (k) => keys.get(k), onMessage: (m) => messages.push(m), ...options },
  )
  const last = () => events.filter((e) => e.type === 'upsert').at(-1)?.link
  return { store, events, messages, keys, last }
}

const received = (receiver: string, fromKey: string, msgId: string | undefined, s: number, live = true, dedupeKey = `u-${msgId ?? s}`): PeerInbound => ({
  receiver,
  fromKey,
  msgId,
  dedupeKey,
  at: iso(s),
  live,
})

describe('PeerLinkStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(T0 + 60_000)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('uses the same link id as the web store', () => {
    expect(peerLinkId(B, A)).toBe(`${A}>${B}`)
    expect(peerLinkId(A, B)).toBe(`${A}>${B}`)
  })

  it('counts each message once by msg_id, in both directions', () => {
    const { store, events, messages, last } = setup()
    store.sent([{ terminalId: B, agentId: `${B}:main`, msgId: 'msg-0001', at: iso(1) }])
    store.inbound([received(A, 'kb', 'msg-0001', 1), received(A, 'kb', 'msg-0001', 1, true, 'src-copy')])
    store.flush()
    expect(last()).toEqual({ id: `${A}>${B}`, kind: 'message', a: A, b: B, ab: 0, ba: 1, firstAt: iso(1), lastAt: iso(1), lastDir: 'ba', lastAgentId: `${B}:main` })

    store.sent([{ terminalId: A, agentId: `${A}:main`, msgId: 'msg-0002', at: iso(5) }])
    store.inbound([received(B, 'ka', 'msg-0002', 5)])
    store.flush()
    store.inbound([received(A, 'kb', 'msg-0001', 1)])
    store.flush(true)
    expect(last()).toMatchObject({ ab: 1, ba: 1, firstAt: iso(1), lastAt: iso(5), lastDir: 'ab', lastAgentId: `${A}:main` })
    expect(events).toHaveLength(2)
    expect(messages).toEqual([
      { from: B, to: A, agentId: `${B}:main`, at: iso(1) },
      { from: A, to: B, agentId: `${A}:main`, at: iso(5) },
    ])
    expect(store.list()).toHaveLength(1)
  })

  it('credits the subagent that sent it, waiting up to the hold for the sender file', () => {
    const { store, events, messages, last } = setup()
    store.inbound([received(A, 'kb', 'msg-0003', 2)])
    store.flush()
    expect(events).toHaveLength(0)
    store.sent([{ terminalId: B, agentId: SUB, msgId: 'msg-0003', at: iso(2) }])
    store.flush()
    expect(last()).toMatchObject({ ba: 1, lastAgentId: SUB })
    expect(messages.at(-1)).toMatchObject({ from: B, agentId: SUB })

    store.inbound([received(A, 'kb', 'msg-0004', 3)])
    store.flush()
    expect(events).toHaveLength(1)
    vi.advanceTimersByTime(1_999)
    expect(events).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(last()).toMatchObject({ ba: 2, lastAgentId: `${B}:main` })
  })

  it('dedupes a message without msg_id by receiver and record key', () => {
    const { store, last } = setup()
    store.inbound([received(A, 'kb', undefined, 1, true, 'u-1'), received(A, 'kb', undefined, 1, true, 'u-1'), received(A, 'kb', undefined, 2, true, 'u-2')])
    store.flush()
    expect(last()).toMatchObject({ ba: 2 })
  })

  it('builds catch-up links without messages and skips ones past the TTL', () => {
    const { store, messages, last } = setup()
    vi.setSystemTime(T0 + 30 * 60_000)
    store.inbound([received(A, 'kb', 'msg-0005', 0, false), received(A, 'kc', 'msg-0006', -3 * 60 * 60, false)])
    store.flush(true)
    expect(store.list().map((l) => l.id)).toEqual([`${A}>${B}`])
    expect(last()).toMatchObject({ ba: 1, lastAgentId: `${B}:main` })
    expect(messages).toEqual([])
  })

  it('drops a link once quiet past the TTL, and when one of its terminals goes', () => {
    const { store, events } = setup()
    store.inbound([received(A, 'kb', 'msg-0007', 1), received(C, 'ka', 'msg-0008', 1)])
    store.flush()
    vi.advanceTimersByTime(2_000)
    expect(store.list()).toHaveLength(2)

    store.dropTerminal(C)
    expect(events.at(-1)).toEqual({ type: 'remove', id: `${A}>${C}` })
    vi.setSystemTime(T0 + 61 * 60_000)
    store.prune()
    expect(events.at(-1)).toEqual({ type: 'remove', id: `${A}>${B}` })
    expect(store.list()).toEqual([])
    store.inbound([received(A, 'kb', 'msg-0007', 1)])
    store.flush(true)
    expect(store.list()).toEqual([])
  })

  it('holds an unknown sender until the final flush, resolves one by msg_id, and ignores its own messages', () => {
    const { store, events, last } = setup()
    store.inbound([received(A, 'kx', undefined, 1, false)])
    store.flush()
    store.flush(true)
    expect(events).toHaveLength(0)

    store.sent([{ terminalId: C, agentId: `${C}:main`, msgId: 'msg-0009', at: iso(2) }])
    store.inbound([received(A, 'kx', 'msg-0009', 2)])
    store.flush()
    expect(last()).toMatchObject({ id: `${A}>${C}`, ab: 0, ba: 1 })

    store.inbound([received(A, 'ka', 'msg-0010', 3, false)])
    store.flush(true)
    expect(events).toHaveLength(1)
  })

  it('stops its hold timer', () => {
    const { store, events } = setup()
    store.inbound([received(A, 'kb', 'msg-0011', 1)])
    store.flush()
    store.stop()
    vi.advanceTimersByTime(5_000)
    expect(events).toHaveLength(0)
  })
})
