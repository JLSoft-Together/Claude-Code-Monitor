import { useI18n } from 'vue-i18n'
import type { GitDiffStat, TerminalSession, TerminalStatus } from '@ccm/shared'
import { shortPath } from '../lib/format'
import { paneState, stateWord, type RailState } from '../lib/rail/railModel'
import { waitDisplay } from '../lib/wait'
import { shellTitle } from '../lib/sidebarRows'
import { effectiveStatus, runningSubagents } from '../lib/subagents'
import { displayTitle } from '../lib/title'
import { useAgentsStore } from '../stores/agents'
import { useTerminalsStore } from '../stores/terminals'
import { baseName } from '../lib/preview'
import { isTerm, tabTitle as titleOfTab, useWorkspaceStore, workCwd, type Pane, type Tab } from '../stores/workspace'

/** What the workspace shows about a pane, drawn from the monitor session linked to it. */
export function usePaneInfo() {
  const { t } = useI18n()
  const terminals = useTerminalsStore()
  const agents = useAgentsStore()
  const workspace = useWorkspaceStore()

  function sessionOf(pane: Pane | undefined): TerminalSession | undefined {
    const term = pane?.terminalId ? terminals.byId[pane.terminalId] : undefined
    return term && term.status !== 'stale' ? term : undefined
  }

  /** Browser: host[:port] or file name; file: name; changes: "Changes (N)". */
  function viewLabel(pane: Pane): string {
    if (pane.kind === 'file') return pane.path ? baseName(pane.path) : t('workspace.viewer.title')
    if (pane.kind === 'log') return pane.root ? `${t('workspace.log.title')}: ${baseName(pane.root)}` : t('workspace.log.title')
    if (pane.kind === 'changes') return pane.count ? t('workspace.changes.titleCount', { n: pane.count }) : t('workspace.changes.title')
    if (pane.kind === 'run') return pane.cwd ? t('run.titleIn', { name: baseName(pane.cwd) }) : t('run.title')
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
    if (pane.kind === 'run') return pane.cwd
    return pane.url || undefined
  }

  function labelOf(pane: Pane): string {
    if (!isTerm(pane)) return viewLabel(pane)
    const session = sessionOf(pane)
    return session ? displayTitle(session) : t(`workspace.preset.${pane.preset}`)
  }

  function titleOf(pane: Pane): string {
    return isTerm(pane) && pane.preset === 'shell' && !sessionOf(pane) ? (shellTitle(pane) ?? labelOf(pane)) : labelOf(pane)
  }

  function tabTitle(tab: Tab): string {
    return titleOfTab(tab, (k) => workspace.panes.find((p) => p.key === k), titleOf)
  }

  function subagentsOf(pane: Pane | undefined): number {
    return pane?.terminalId && sessionOf(pane) ? runningSubagents(agents.byTerminal[pane.terminalId]) : 0
  }

  function statusOf(pane: Pane | undefined): TerminalStatus | undefined {
    const session = sessionOf(pane)
    return session ? effectiveStatus(session.status, subagentsOf(pane)) : undefined
  }

  function railStateOf(pane: Pane | undefined): RailState | null {
    if (!pane || !isTerm(pane)) return null
    const s = sessionOf(pane)
    return paneState(pane, s ? { status: s.status, title: '', subagents: subagentsOf(pane) } : undefined)
  }

  function stateText(pane: Pane | undefined): string | null {
    const state = railStateOf(pane)
    if (!state || !pane) return null
    if (state === 'asked') {
      const s = sessionOf(pane)
      const wait = s?.status === 'waiting' ? waitDisplay(s.waitingFor, undefined, t) : null
      if (wait) return wait.text
    }
    const w = stateWord(state, subagentsOf(pane))
    return w.n === undefined ? t(w.key) : t(w.key, { n: w.n }, w.n)
  }

  function activityOf(pane: Pane | undefined): { tool: string | null; since?: string; diff?: GitDiffStat } | null {
    const s = sessionOf(pane)
    if (!s) return null
    const tool = s.status === 'working' ? (agents.mainOf(s.id)?.currentTool ?? null) : null
    return { tool, since: s.statusSince, diff: s.diff }
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

  return { sessionOf, labelOf, titleOf, tabTitle, subagentsOf, statusOf, railStateOf, stateText, activityOf, viewLabel, viewDetail, describe, isBusy }
}
