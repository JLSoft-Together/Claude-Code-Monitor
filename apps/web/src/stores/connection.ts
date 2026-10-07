import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ClientMessage, FolderPickResult, LaunchMode, MonitorEvent, MonitorSnapshot, ServerMessage } from '@ccm/shared'
import { useActivityStore } from './activity'
import { useAgentsStore } from './agents'
import { useExtrasStore } from './extras'
import { useFavoritesStore } from './favorites'
import { useHistoryStore } from './history'
import { useTerminalsStore } from './terminals'
import { useUiStore } from './ui'
import { useUsageStore } from './usage'

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
  const usage = useUsageStore()
  const favorites = useFavoritesStore()
  const extras = useExtrasStore()
  const history = useHistoryStore()

  function url(): string {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${proto}//${location.host}/ws`
  }

  function hydrate(snapshot: MonitorSnapshot): void {
    terminals.replaceAll(snapshot.terminals ?? [])
    agents.replaceAll(snapshot.agents ?? [])
    activity.replaceAll(snapshot.activity ?? [])
    usage.reset(snapshot.usage)
    favorites.replaceAll(snapshot.favorites ?? [])
    extras.hydrate(snapshot)
    history.invalidate()
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
        case 'usage.reset':
          usage.reset(event.payload)
          break
        case 'usage.updated':
          usage.update(event.payload.buckets ?? [])
          break
        case 'usage.scan':
          usage.setScan(event.payload)
          break
        case 'usage.roots':
          usage.setRoots(event.payload.roots ?? {})
          break
        case 'favorites.updated':
          favorites.replaceAll(event.payload.favorites ?? [])
          break
        case 'folder.picked': {
          // Every tab receives the answer; only the tab that asked has the request id.
          const done = folderPicks.get(event.payload.requestId)
          folderPicks.delete(event.payload.requestId)
          done?.({ result: event.payload.result, dir: event.payload.dir })
          break
        }
        case 'favorite.rejected':
          favorites.reject(event.payload.dir, event.payload.reason)
          break
        case 'jobs.updated':
          extras.setJobs(event.payload.jobs ?? [])
          break
        case 'limits.updated':
          extras.setLimits(event.payload)
          break
        case 'response.updated':
          extras.setResponse(event.payload)
          break
        case 'history.data':
          history.setSessions(event.payload.sessions ?? [])
          break
        case 'history.added':
          history.add(event.payload)
          break
        case 'timeline.data':
          history.setTimeline(event.payload)
          break
        case 'terminal.focusResult':
          ui.reportWindowResult(event.payload.terminalId, event.payload.result)
          break
        case 'models.updated':
          extras.setModelNames(event.payload.modelNames ?? {})
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
      for (const done of folderPicks.values()) done({ result: 'failed' })
      folderPicks.clear()
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

  const folderPicks = new Map<string, (r: { result: FolderPickResult; dir?: string }) => void>()

  function request(message: ClientMessage): boolean {
    if (socket?.readyState !== WebSocket.OPEN) return false
    send(message)
    return true
  }

  const setAlias = (terminalId: string, alias: string | null): boolean => request({ type: 'terminal.alias', terminalId, alias })
  const toggleFavorite = (terminalId: string): boolean => request({ type: 'favorite.toggle', terminalId })
  const removeFavorite = (dir: string): boolean => request({ type: 'favorite.remove', dir })
  const addFavorite = (dir: string, label: string | null): boolean => request({ type: 'favorite.add', dir, label })
  const renameFavorite = (dir: string, label: string | null): boolean => request({ type: 'favorite.rename', dir, label })
  const openFavorite = (dir: string, mode: LaunchMode): boolean => request({ type: 'favorite.open', dir, mode })
  const dismissEnded = (terminalId?: string): boolean => request({ type: 'terminal.dismiss', terminalId })
  const loadHistory = (): boolean => request({ type: 'history.get' })
  const loadTimeline = (): boolean => request({ type: 'timeline.get' })
  function pickFolder(): Promise<{ result: FolderPickResult | 'offline'; dir?: string }> {
    const requestId = Math.random().toString(36).slice(2) + Date.now().toString(36)
    if (!request({ type: 'folder.pick', requestId })) return Promise.resolve({ result: 'offline' })
    return new Promise((resolve) => folderPicks.set(requestId, resolve))
  }

  function focusWindow(terminalId: string): boolean {
    if (!request({ type: 'terminal.focusWindow', terminalId })) return false
    ui.startWindowFocus(terminalId)
    return true
  }

  return {
    state,
    lastEventAt,
    hasData,
    supportedClaudeVersion,
    start,
    apply,
    onMessage,
    setAlias,
    toggleFavorite,
    removeFavorite,
    addFavorite,
    renameFavorite,
    openFavorite,
    dismissEnded,
    focusWindow,
    pickFolder,
    loadHistory,
    loadTimeline,
  }
})
