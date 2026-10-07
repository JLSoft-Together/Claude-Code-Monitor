import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { MonitorEvent, MonitorSnapshot, ServerMessage } from '@ccm/shared'
import { useActivityStore } from './activity'
import { useAgentsStore } from './agents'
import { useTerminalsStore } from './terminals'
import { useUiStore } from './ui'

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'

const MIN_RETRY_MS = 1_000
const MAX_RETRY_MS = 10_000

function isServerMessage(value: unknown): value is ServerMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as ServerMessage).seq === 'number' &&
    Array.isArray((value as ServerMessage).events)
  )
}

export const useConnectionStore = defineStore('connection', () => {
  const state = ref<ConnectionState>('connecting')
  const lastEventAt = ref<number | null>(null)
  const hasData = ref(false)
  const supportedClaudeVersion = ref<string | null>(null)

  let socket: WebSocket | null = null
  let lastSeq = -1
  let awaitingResync = false
  let retryMs = MIN_RETRY_MS
  let retryTimer: number | null = null
  let started = false

  const terminals = useTerminalsStore()
  const agents = useAgentsStore()
  const activity = useActivityStore()
  const ui = useUiStore()

  function url(): string {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${location.host}/ws`
  }

  function hydrate(snapshot: MonitorSnapshot): void {
    terminals.replaceAll(snapshot.terminals ?? [])
    agents.replaceAll(snapshot.agents ?? [])
    activity.replaceAll(snapshot.activity ?? [])
    supportedClaudeVersion.value = snapshot.supportedClaudeVersion ?? null
    if (ui.selectedAgentId && !agents.byId[ui.selectedAgentId]) ui.selectAgent(null)
    hasData.value = true
  }

  function apply(events: MonitorEvent[]): void {
    const newActivity = []
    for (const event of events) {
      switch (event.type) {
        case 'snapshot':
          hydrate(event.payload)
          break
        case 'terminal.created':
          terminals.upsert(event.payload)
          break
        case 'terminal.updated':
          terminals.patch(event.payload)
          break
        case 'terminal.removed':
          terminals.remove(event.payload.id)
          break
        case 'agent.created':
          agents.upsert(event.payload)
          break
        case 'agent.updated':
          agents.patch(event.payload)
          break
        case 'agent.removed':
          agents.remove(event.payload.id)
          if (ui.selectedAgentId === event.payload.id) ui.selectAgent(null)
          break
        case 'activity':
          newActivity.push(event.payload)
          break
        default:
          break
      }
    }
    activity.push(newActivity)
  }

  function onMessage(raw: string): void {
    let message: unknown
    try {
      message = JSON.parse(raw)
    } catch {
      return
    }
    if (!isServerMessage(message)) return
    const isSnapshot = message.events[0]?.type === 'snapshot'
    if (!isSnapshot && lastSeq >= 0 && message.seq !== lastSeq + 1) {
      if (message.seq > lastSeq + 1 && !awaitingResync) {
        awaitingResync = true
        send({ type: 'resync' })
      }
      return
    }
    if (isSnapshot) awaitingResync = false
    lastSeq = message.seq
    lastEventAt.value = Date.now()
    apply(message.events)
  }

  function send(payload: unknown): void {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload))
  }

  function scheduleReconnect(): void {
    if (retryTimer !== null) return
    state.value = hasData.value ? 'reconnecting' : 'disconnected'
    retryTimer = window.setTimeout(() => {
      retryTimer = null
      connect()
    }, retryMs)
    retryMs = Math.min(retryMs * 2, MAX_RETRY_MS)
  }

  function connect(): void {
    lastSeq = -1
    awaitingResync = false
    if (!hasData.value && state.value !== 'disconnected') state.value = 'connecting'
    let ws: WebSocket
    try {
      ws = new WebSocket(url())
    } catch {
      scheduleReconnect()
      return
    }
    socket = ws
    ws.onopen = () => {
      state.value = 'connected'
      retryMs = MIN_RETRY_MS
    }
    ws.onmessage = (e) => onMessage(String(e.data))
    ws.onclose = () => {
      if (socket === ws) socket = null
      scheduleReconnect()
    }
    ws.onerror = () => ws.close()
  }

  function start(): void {
    if (started) return
    started = true
    connect()
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && !socket && retryTimer !== null) {
        clearTimeout(retryTimer)
        retryTimer = null
        retryMs = MIN_RETRY_MS
        connect()
      }
    })
  }

  return { state, lastEventAt, hasData, supportedClaudeVersion, start, apply, onMessage }
})
