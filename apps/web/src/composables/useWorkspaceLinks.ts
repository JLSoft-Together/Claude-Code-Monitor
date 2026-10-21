import { onBeforeUnmount, watch } from 'vue'
import { PtyConnection } from '../lib/ptyClient'
import { effectiveStatus, runningSubagents } from '../lib/subagents'
import { useAgentsStore } from '../stores/agents'
import { useTerminalsStore } from '../stores/terminals'
import { agentNow, useWorkspaceStore } from '../stores/workspace'

const RETRY_MS = 10_000
// Host caches its process table 1.5 s; a "not ours" answer only counts once the table is surely newer than the agent.
const SETTLE_MS = 4_000

/**
 * Ties monitor sessions to the panes they run in: the PTY host walks each agent's process ancestry
 * up to a pane's shell. Status, context and branch then come from the collector, never from output.
 */
export function useWorkspaceLinks(viewShown: () => boolean): void {
  const workspace = useWorkspaceStore()
  const terminals = useTerminalsStore()
  const agents = useAgentsStore()
  // An agent's parent chain is fixed at birth, so one settled answer per terminal is final.
  const resolved = new Set<string>()
  const firstSeen = new Map<string, number>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let scanning = false

  function schedule(delay = 600): void {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void scan(), delay)
  }

  async function scan(): Promise<void> {
    timer = null
    if (scanning) return schedule()
    const running = workspace.panes.filter((p) => p.state === 'running' && p.sessionId)
    const unresolved = terminals.live.filter((t) => t.processId && !resolved.has(t.id))
    if (!running.length || !unresolved.length) return
    // Host answers at most 64 pids per question; the rest go in the next round.
    const candidates = unresolved.slice(0, 64)
    const asked = Date.now()
    for (const t of candidates) if (!firstSeen.has(t.id)) firstSeen.set(t.id, asked)
    if (unresolved.length > candidates.length) schedule()
    scanning = true
    const reply = await PtyConnection.request({ t: 'owners', pids: candidates.map((t) => t.processId!) })
    scanning = false
    if (reply?.t !== 'owners' || !reply.owners) return schedule(RETRY_MS)
    for (const t of candidates) {
      const sessionId = reply.owners[String(t.processId)]
      if (!sessionId) {
        if (asked - firstSeen.get(t.id)! >= SETTLE_MS) resolved.add(t.id)
        else schedule(SETTLE_MS)
        continue
      }
      const pane = workspace.panes.find((p) => p.sessionId === sessionId)
      if (!pane) continue
      resolved.add(t.id)
      workspace.update(pane.key, { terminalId: t.id })
    }
  }

  watch(
    () => [terminals.live.map((t) => t.id).join(), workspace.panes.map((p) => `${p.sessionId}:${p.state}`).join()],
    () => {
      for (const p of workspace.panes) if (p.terminalId && !terminals.byId[p.terminalId]) workspace.update(p.key, { terminalId: undefined })
      schedule()
    },
    { immediate: true },
  )

  // /clear and resume switch the session id under the same process; a later restore must pick the latest.
  watch(
    () => workspace.panes.map((p) => {
      const term = p.terminalId ? terminals.byId[p.terminalId] : undefined
      return [p.key, term?.claudeSessionId ?? term?.codexSessionId] as const
    }),
    (pairs) => {
      for (const [key, id] of pairs) {
        const pane = workspace.panes.find((p) => p.key === key)
        if (id && pane && pane.agentSessionId !== id) workspace.update(key, { agentSessionId: id })
      }
    },
  )

  // `claude` / `codex` typed in a shell pane shows that agent while its session lives, then a shell again;
  // an agent pane whose agent quit (its preset runs inside a shell) shows that shell.
  watch(
    () => workspace.panes.map((p) => [p.key, agentNow(p, p.terminalId ? terminals.byId[p.terminalId] : undefined)] as const),
    (pairs) => {
      for (const [key, agent] of pairs) {
        const pane = workspace.panes.find((p) => p.key === key)
        if (pane && pane.agent !== agent) workspace.update(key, { agent })
      }
    },
    { immediate: true },
  )

  // Attention latches on the transition, so an agent that asked and then moved on is still flagged until seen.
  const seen = (key: string): boolean =>
    viewShown() && workspace.activeKey === key && document.visibilityState === 'visible' && document.hasFocus()
  watch(
    () =>
      workspace.panes.map((p) => {
        const term = p.terminalId ? terminals.byId[p.terminalId] : undefined
        const running = term ? runningSubagents(agents.byTerminal[term.id]) : 0
        return [p.key, term ? effectiveStatus(term.status, running) : undefined, running] as const
      }),
    (now, before) => {
      const prev = new Map(before.map(([key, status]) => [key, status]))
      for (const [key, status] of now) {
        const was = prev.get(key)
        if (!was || was === status || seen(key)) continue
        if (status === 'waiting') workspace.update(key, { attention: 'waiting' })
        else if (was === 'working' && status === 'idle') workspace.update(key, { attention: 'done' })
        else if (status === 'working') {
          const pane = workspace.panes.find((p) => p.key === key)
          // Answered from elsewhere (another device, the Monitor view): the question is gone.
          if (pane?.attention === 'waiting') workspace.update(key, { attention: undefined })
        }
      }
    },
  )

  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer)
  })
}
