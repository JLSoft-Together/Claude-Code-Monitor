import type { PeerLink, PeerLinkDir } from '@ccm/shared'

export interface PeerInbound {
  receiver: string
  fromKey: string
  msgId?: string
  dedupeKey: string
  at?: string
  live: boolean
}

export interface PeerSent {
  terminalId: string
  agentId: string
  msgId: string
  at?: string
}

export interface PeerMessage {
  from: string
  to: string
  agentId: string
  at: string
}

export interface PeerLinkSink {
  upsertLink(link: PeerLink): void
  removeLink(id: string): void
}

export interface PeerLinkOptions {
  ttlMs: number
  holdMs?: number
  now?: () => number
  clock?: () => number
  senderOf: (fromKey: string) => string | undefined
  onMessage?: (message: PeerMessage) => void
}

export const PEER_TTL_MS = 60 * 60_000
export const PEER_HOLD_MS = 2_000

export function peerLinkId(a: string, b: string): string {
  return a < b ? `${a}>${b}` : `${b}>${a}`
}

const mainAgentOf = (terminalId: string): string => `${terminalId}:main`

function timeOf(at: string | undefined, fallback: number): number {
  const t = at ? Date.parse(at) : Number.NaN
  return Number.isFinite(t) ? t : fallback
}

interface Pending extends PeerInbound {
  queuedAt: number
}

export class PeerLinkStore {
  private readonly links = new Map<string, PeerLink>()
  private readonly seen = new Map<string, number>()
  private readonly senders = new Map<string, PeerSent & { atMs: number }>()
  private pending: Pending[] = []
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly sink: PeerLinkSink,
    private readonly options: PeerLinkOptions,
  ) {}

  private now(): number {
    return (this.options.now ?? Date.now)()
  }

  private clock(): number {
    return (this.options.clock ?? Date.now)()
  }

  list(): PeerLink[] {
    return [...this.links.values()].map((l) => ({ ...l }))
  }

  sent(items: PeerSent[]): void {
    const now = this.now()
    const cutoff = now - this.options.ttlMs
    for (const s of items) {
      const atMs = timeOf(s.at, now)
      if (atMs >= cutoff) this.senders.set(s.msgId, { ...s, atMs })
    }
  }

  inbound(items: PeerInbound[]): void {
    const queuedAt = this.clock()
    for (const item of items) this.pending.push({ ...item, queuedAt })
  }

  flush(final = false): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const now = this.now()
    const clock = this.clock()
    const hold = this.options.holdMs ?? PEER_HOLD_MS
    const cutoff = now - this.options.ttlMs
    const keep: Pending[] = []
    let wake = Infinity
    for (const p of this.pending) {
      const atMs = timeOf(p.at, now)
      const key = p.msgId ?? `${p.receiver}|${p.dedupeKey}`
      if (atMs < cutoff || this.seen.has(key)) continue
      const sent = p.msgId ? this.senders.get(p.msgId) : undefined
      const sender = this.options.senderOf(p.fromKey) ?? sent?.terminalId
      const deadline = p.queuedAt + hold
      const waiting = p.live && p.msgId !== undefined && !sent && clock < deadline
      if (sender && !waiting) {
        this.seen.set(key, atMs)
        if (sender !== p.receiver) this.apply(p, sender, sent, atMs)
        continue
      }
      if (!sender && !waiting && final) continue
      keep.push(p)
      if (waiting) wake = Math.min(wake, deadline)
    }
    this.pending = keep
    if (wake !== Infinity) {
      this.timer = setTimeout(() => {
        this.timer = null
        this.flush()
      }, Math.max(0, wake - clock))
      this.timer.unref?.()
    }
  }

  private apply(p: Pending, sender: string, sent: PeerSent | undefined, atMs: number): void {
    const id = peerLinkId(sender, p.receiver)
    const [a, b] = sender < p.receiver ? [sender, p.receiver] : [p.receiver, sender]
    const dir: PeerLinkDir = sender === a ? 'ab' : 'ba'
    const at = new Date(atMs).toISOString()
    const agentId = sent && sent.terminalId === sender ? sent.agentId : mainAgentOf(sender)
    const prev = this.links.get(id)
    const link: PeerLink = prev ? { ...prev } : { id, kind: 'message', a, b, ab: 0, ba: 0, firstAt: at, lastAt: at, lastDir: dir, lastAgentId: agentId }
    if (dir === 'ab') link.ab++
    else link.ba++
    if (at < link.firstAt) link.firstAt = at
    if (at >= link.lastAt) {
      link.lastAt = at
      link.lastDir = dir
      link.lastAgentId = agentId
    }
    this.links.set(id, link)
    this.sink.upsertLink({ ...link })
    if (p.live) this.options.onMessage?.({ from: sender, to: p.receiver, agentId, at })
  }

  prune(): void {
    const cutoff = this.now() - this.options.ttlMs
    for (const [id, link] of this.links) {
      if (Date.parse(link.lastAt) >= cutoff) continue
      this.links.delete(id)
      this.sink.removeLink(id)
    }
    for (const [key, at] of this.seen) if (at < cutoff) this.seen.delete(key)
    for (const [key, s] of this.senders) if (s.atMs < cutoff) this.senders.delete(key)
  }

  dropTerminal(terminalId: string): void {
    for (const [id, link] of this.links) {
      if (link.a !== terminalId && link.b !== terminalId) continue
      this.links.delete(id)
      this.sink.removeLink(id)
    }
    this.pending = this.pending.filter((p) => p.receiver !== terminalId)
    for (const [key, s] of this.senders) if (s.terminalId === terminalId) this.senders.delete(key)
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
