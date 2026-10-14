import { useI18n } from 'vue-i18n'
import type { TerminalSession } from '@ccm/shared'
import { shortPath } from '../lib/format'
import { displayTitle } from '../lib/title'
import { useTerminalsStore } from '../stores/terminals'
import { baseName } from '../lib/preview'
import { isTerm, workCwd, type Pane } from '../stores/workspace'

/** What the workspace shows about a pane, drawn from the monitor session linked to it. */
export function usePaneInfo() {
  const { t } = useI18n()
  const terminals = useTerminalsStore()

  function sessionOf(pane: Pane | undefined): TerminalSession | undefined {
    const term = pane?.terminalId ? terminals.byId[pane.terminalId] : undefined
    return term && term.status !== 'stale' ? term : undefined
  }

  /** Browser: host[:port] or file name; file: name; changes: "Changes (N)". */
  function viewLabel(pane: Pane): string {
    if (pane.kind === 'file') return pane.path ? baseName(pane.path) : t('workspace.viewer.title')
    if (pane.kind === 'log') return pane.root ? `${t('workspace.log.title')}: ${baseName(pane.root)}` : t('workspace.log.title')
    if (pane.kind === 'changes') return pane.count ? t('workspace.changes.titleCount', { n: pane.count }) : t('workspace.changes.title')
    const url = pane.url ?? ''
    if (/^https?:\/\//i.test(url)) {
      try {
        return new URL(url).host
      } catch {
        return url
      }
    }
    return url ? baseName(url) : t('workspace.open.browser')
  }

  /** Full URL / path / repo root, for tooltips. */
  function viewDetail(pane: Pane): string | undefined {
    if (pane.kind === 'file') return pane.path
    if (pane.kind === 'changes' || pane.kind === 'log') return pane.root ?? pane.cwd
    return pane.url || undefined
  }

  function labelOf(pane: Pane): string {
    if (!isTerm(pane)) return viewLabel(pane)
    const session = sessionOf(pane)
    return session ? displayTitle(session) : t(`workspace.preset.${pane.preset}`)
  }

  /** "Claude Code · …/repo/src": names what closing would stop. */
  function describe(pane: Pane): string {
    if (!isTerm(pane)) return viewLabel(pane)
    const dir = workCwd(pane)
    const where = dir ? shortPath(dir) : ''
    const session = sessionOf(pane)
    const what = session ? `${t(`workspace.preset.${pane.preset}`)} — ${displayTitle(session)}` : t(`workspace.preset.${pane.preset}`)
    return where ? `${what} · ${where}` : what
  }

  /**
   * Closing would kill something the user may care about: an agent, an agent found running in a shell, or
   * whatever a command started there (`npm run dev` has no monitor session, so any entered command counts).
   */
  function isBusy(pane: Pane): boolean {
    if (!isTerm(pane) || (pane.state !== 'running' && pane.state !== 'starting')) return false
    return pane.preset !== 'shell' || !!pane.ranCommand || !!sessionOf(pane)
  }

  return { sessionOf, labelOf, viewLabel, viewDetail, describe, isBusy }
}
