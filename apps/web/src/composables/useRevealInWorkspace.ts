import { isAgentSessionId, type TerminalSession } from '@ccm/shared'
import { hasDeepSeek, hasTerminals, presetEnabled } from '../lib/desktop'
import { sessionIdOf } from '../lib/mapText'
import { useUiStore } from '../stores/ui'
import { useWorkspaceStore } from '../stores/workspace'

/** Workspace pane of a monitored session: show it, or reopen the agent session in a new pane. */
export function useRevealInWorkspace() {
  const ui = useUiStore()
  const workspace = useWorkspaceStore()

  const paneOf = (terminalId: string) => workspace.paneByTerminal.get(terminalId)
  const resumeIdOf = (t: TerminalSession) => sessionIdOf(t)

  function show(terminalId: string): boolean {
    const pane = paneOf(terminalId)
    if (!pane) return false
    workspace.activate(pane.key)
    ui.setView('workspace')
    return true
  }

  function canReopen(t: TerminalSession): boolean {
    return hasTerminals && presetEnabled(t.provider ?? 'claude', hasDeepSeek) && !paneOf(t.id) && !!t.cwd && isAgentSessionId(resumeIdOf(t))
  }

  /** Callers ask first when the session still runs: two live instances would append to one transcript. */
  function reopen(t: TerminalSession): boolean {
    if (!canReopen(t)) return false
    workspace.resumeSession(t.provider ?? 'claude', t.cwd!, resumeIdOf(t)!)
    ui.setView('workspace')
    return true
  }

  return { paneOf, show, canReopen, reopen }
}
