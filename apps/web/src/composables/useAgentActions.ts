import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Agent } from '@ccm/shared'
import { hasTerminals } from '../lib/desktop'
import type { NodeAction, NodeMenuState } from '../lib/mapMenu'
import { agentName, agentSummary, mapTree, sessionIdOf, type MapTextLabels } from '../lib/mapText'
import { statusMeta } from '../lib/status'
import { useAgentsStore } from '../stores/agents'
import { useConnectionStore } from '../stores/connection'
import { useTerminalsStore } from '../stores/terminals'
import { useUiStore } from '../stores/ui'
import { useRevealInWorkspace } from './useRevealInWorkspace'

export type AgentMenuBase = Pick<NodeMenuState, 'agent' | 'workspace' | 'canJump' | 'sessionId' | 'cwd' | 'branch' | 'description'>

/**
 * Session / agent actions shared by the Agent Map node menu and the session card menu: copies with a "Copied"
 * notice, workspace pane, terminal window. `sessionAgents` gives the agents a "Session as text" copy lists.
 */
export function useAgentActions(sessionAgents: (terminalId: string) => Agent[]) {
  const { t } = useI18n()
  const agents = useAgentsStore()
  const terminals = useTerminalsStore()
  const connection = useConnectionStore()
  const ui = useUiStore()
  const reveal = useRevealInWorkspace()

  const labels = computed<MapTextLabels>(() => ({
    status: (s) => t(statusMeta(s).labelKey),
    field: (f) => t(`map.field.${f}`),
    main: t('agent.main'),
    subagent: t('agent.subagent'),
    codexRun: t('agent.codexRun'),
  }))

  const notice = ref<{ text: string; failed: boolean; n: number } | null>(null)
  let noticeTimer: number | undefined
  function announce(text: string, failed = false): void {
    notice.value = { text, failed, n: (notice.value?.n ?? 0) + 1 }
    window.clearTimeout(noticeTimer)
    noticeTimer = window.setTimeout(() => (notice.value = null), failed ? 4000 : 1800)
  }
  onBeforeUnmount(() => window.clearTimeout(noticeTimer))

  async function copyText(text: string | undefined, what: string, args?: Record<string, unknown>): Promise<void> {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      announce(t(`map.copied.${what}`, args ?? {}))
    } catch {
      announce(t('map.copied.failed'), true)
    }
  }

  const sessionsText = (ids: string[]): string => mapTree(ids.map((id) => ({ terminal: terminals.byId[id], agents: sessionAgents(id) })), labels.value)

  function copySummary(agentId: string): void {
    const a = agents.byId[agentId]
    if (a) void copyText(agentSummary(a, terminals.byId[a.terminalId], labels.value, Date.now()), 'summary')
  }

  function menuBase(terminalId: string, agentId: string | undefined): AgentMenuBase {
    const a = agentId ? agents.byId[agentId] : undefined
    const term = terminals.byId[terminalId]
    const ended = term?.status === 'stale'
    const pane = term ? reveal.paneOf(term.id) : undefined
    return {
      agent: !!a,
      workspace: !hasTerminals ? 'off' : pane ? 'show' : term && reveal.canReopen(term) ? (ended ? 'reopen' : 'reopen-live') : 'none',
      canJump: !!term && !ended && !!term.processId && !pane,
      sessionId: !!sessionIdOf(term),
      cwd: !!term?.cwd,
      branch: !!term?.gitBranch,
      description: !!a && a.role !== 'main' && !!a.description,
    }
  }

  /** Runs the actions both menus share; returns false for the caller's own (details, zoom, fold, picked). */
  function run(action: NodeAction, terminalId: string, agentId: string | undefined): boolean {
    const a = agentId ? agents.byId[agentId] : undefined
    const term = terminals.byId[terminalId]
    switch (action) {
      case 'show-in-workspace':
        reveal.show(terminalId)
        return true
      case 'reopen':
      case 'reopen-confirm':
        if (term) reveal.reopen(term)
        return true
      case 'jump':
        if (!connection.focusWindow(terminalId)) ui.reportWindowResult(terminalId, 'offline')
        return true
      case 'copy-summary':
        if (a) copySummary(a.id)
        return true
      case 'copy-name':
        if (a) void copyText(agentName(a, term, labels.value), 'name')
        return true
      case 'copy-agent-id':
        void copyText(a?.id, 'agentId')
        return true
      case 'copy-session-id':
        void copyText(sessionIdOf(term), 'sessionId')
        return true
      case 'copy-cwd':
        void copyText(term?.cwd, 'cwd')
        return true
      case 'copy-branch':
        void copyText(term?.gitBranch, 'branch')
        return true
      case 'copy-description':
        void copyText(a?.description, 'description')
        return true
      case 'copy-session-tree':
        void copyText(sessionsText([terminalId]), 'tree')
        return true
      default:
        return false
    }
  }

  return { labels, notice, copyText, copySummary, sessionsText, menuBase, run }
}
