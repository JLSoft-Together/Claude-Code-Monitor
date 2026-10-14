import { useI18n } from 'vue-i18n'
import type { TerminalSession } from '@ccm/shared'
import { shortPath } from '../lib/format'
import { displayTitle } from '../lib/title'
import { useTerminalsStore } from '../stores/terminals'
import type { Pane } from '../stores/workspace'

/** What the workspace shows about a pane, drawn from the monitor session linked to it. */
export function usePaneInfo() {
  const { t } = useI18n()
  const terminals = useTerminalsStore()

  function sessionOf(pane: Pane | undefined): TerminalSession | undefined {
    const term = pane?.terminalId ? terminals.byId[pane.terminalId] : undefined
    return term && term.status !== 'stale' ? term : undefined
  }

  function labelOf(pane: Pane): string {
    const session = sessionOf(pane)
    return session ? displayTitle(session) : t(`workspace.preset.${pane.preset}`)
  }

  /** "Claude Code · …/repo/src": names what closing would stop. */
  function describe(pane: Pane): string {
    const where = pane.cwd ? shortPath(pane.cwd) : ''
    const session = sessionOf(pane)
    const what = session ? `${t(`workspace.preset.${pane.preset}`)} — ${displayTitle(session)}` : t(`workspace.preset.${pane.preset}`)
    return where ? `${what} · ${where}` : what
  }

  /** Closing would kill something the user may care about: an agent, or any program found running in a shell. */
  function isBusy(pane: Pane): boolean {
    if (pane.state !== 'running' && pane.state !== 'starting') return false
    return pane.preset !== 'shell' || !!sessionOf(pane)
  }

  return { sessionOf, labelOf, describe, isBusy }
}
