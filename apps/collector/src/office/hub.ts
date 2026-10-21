import type { ServerMessage } from '@ccm/shared'
import type { TimelineRecorder } from '@ccm/habblaud/server/history/timeline'
import type { MonitorStore } from '../store'
import type { OfficeModel } from './model'

export interface OfficeHubOptions {
  store: MonitorStore
  model: OfficeModel
  recorder?: Pick<TimelineRecorder, 'ingest'>
  /** Direct reply to one websocket client. */
  send: (clientId: string, message: ServerMessage) => void
  commitMs?: number
  tickMs?: number
}

/**
 * Turns store changes into office snapshots: at most one commit per `commitMs`, one `ingest` into the timeline
 * recorder per changed commit (also with zero subscribers), and a direct `office.snapshot` to subscribed clients only.
 */
export class OfficeHub {
  private readonly store: MonitorStore
  private readonly model: OfficeModel
  private readonly recorder?: Pick<TimelineRecorder, 'ingest'>
  private readonly send: (clientId: string, message: ServerMessage) => void
  private readonly commitMs: number
  private readonly tickMs: number
  private readonly subscribers = new Set<string>()
  private unsubscribe: (() => void) | null = null
  private commitTimer: ReturnType<typeof setTimeout> | null = null
  private tickTimer: ReturnType<typeof setInterval> | null = null
  private lastRev = -1

  constructor(o: OfficeHubOptions) {
    this.store = o.store
    this.model = o.model
    this.recorder = o.recorder
    this.send = o.send
    this.commitMs = o.commitMs ?? 200
    this.tickMs = o.tickMs ?? 1000
  }

  start(): void {
    if (this.unsubscribe) return
    this.unsubscribe = this.store.subscribe((message) => {
      for (const event of message.events) if (event.type === 'tool.span') this.model.addSpan(event.payload)
      this.schedule()
    })
    this.tickTimer = setInterval(() => {
      if (this.model.tick()) this.schedule()
    }, this.tickMs)
    this.tickTimer.unref()
    this.schedule()
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    if (this.commitTimer) clearTimeout(this.commitTimer)
    if (this.tickTimer) clearInterval(this.tickTimer)
    this.commitTimer = null
    this.tickTimer = null
    this.subscribers.clear()
  }

  subscribe(clientId: string, on: boolean): void {
    if (!on) {
      this.subscribers.delete(clientId)
      return
    }
    this.subscribers.add(clientId)
    // A subscriber gets the state as of now, not the last throttled commit.
    this.commit(true, clientId)
  }

  dropClient(clientId: string): void {
    this.subscribers.delete(clientId)
  }

  private schedule(): void {
    if (this.commitTimer) return
    this.commitTimer = setTimeout(() => {
      this.commitTimer = null
      this.commit(false)
    }, this.commitMs)
    this.commitTimer.unref()
  }

  private commit(force: boolean, only?: string): void {
    this.model.setState([...this.store.terminalList()], [...this.store.agentList()])
    const snapshot = this.model.snapshot()
    const changed = snapshot.rev !== this.lastRev
    this.lastRev = snapshot.rev
    if (changed) this.recorder?.ingest(snapshot)
    const message: ServerMessage = { seq: -1, direct: true, events: [{ type: 'office.snapshot', payload: snapshot }] }
    if (only !== undefined && force) {
      this.send(only, message)
      return
    }
    if (!changed) return
    for (const id of this.subscribers) this.send(id, message)
  }
}
