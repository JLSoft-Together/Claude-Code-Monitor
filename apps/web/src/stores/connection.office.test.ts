import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { OfficeSnapshot } from '@ccm/habblaud/shared/types'
import { officeFeed } from '../office/feed'
import { useConnectionStore } from './connection'

class FakeSocket {
  static OPEN = 1
  static instances: FakeSocket[] = []
  readyState = 0
  sent: unknown[] = []
  onopen: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public url: string) {
    FakeSocket.instances.push(this)
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data))
  }
  close(): void {
    this.readyState = 3
    this.onclose?.()
  }
  open(): void {
    this.readyState = 1
    this.onopen?.()
  }
}

const officeSnap = (rev: number): OfficeSnapshot =>
  ({ rev, serverTime: rev, rooms: [], agents: [], accounts: [], meta: {} }) as unknown as OfficeSnapshot

const subscribes = (s: FakeSocket) => s.sent.filter((m) => (m as { type: string }).type === 'office.subscribe')

describe('connection office routing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FakeSocket.instances = []
    vi.stubGlobal('WebSocket', FakeSocket)
    setActivePinia(createPinia())
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('routes a direct office.snapshot to the feed', () => {
    const conn = useConnectionStore()
    conn.onMessage(JSON.stringify({ seq: -1, direct: true, events: [{ type: 'office.snapshot', payload: officeSnap(7) }] }))
    expect(officeFeed.snapshot?.rev).toBe(7)
  })

  it('re-sends office.subscribe after a reconnect and keeps the last snapshot', () => {
    const conn = useConnectionStore()
    conn.start()
    const first = FakeSocket.instances[0]!
    first.open()
    conn.subscribeOffice(true)
    expect(subscribes(first)).toEqual([{ type: 'office.subscribe', on: true }])
    officeFeed.ingestLive(officeSnap(3))

    first.close()
    expect(officeFeed.snapshot?.rev).toBe(3)
    vi.advanceTimersByTime(1_500)
    const second = FakeSocket.instances[1]!
    second.open()
    expect(subscribes(second)).toEqual([{ type: 'office.subscribe', on: true }])
  })

  it('does not re-subscribe after being turned off', () => {
    const conn = useConnectionStore()
    conn.start()
    const first = FakeSocket.instances[0]!
    first.open()
    conn.subscribeOffice(true)
    conn.subscribeOffice(false)
    first.close()
    vi.advanceTimersByTime(1_500)
    const second = FakeSocket.instances[1]!
    second.open()
    expect(subscribes(second)).toEqual([])
  })
})
