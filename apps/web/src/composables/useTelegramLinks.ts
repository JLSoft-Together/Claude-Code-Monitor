import { useI18n } from 'vue-i18n'
import { isSessionId } from '@ccm/shared'
import { paneState, RAIL_BADGE, stateWord, type RailState } from '../lib/rail/railModel'
import { hasTelegram } from '../lib/telegram'
import { waitDisplay } from '../lib/wait'
import { useTelegramStore } from '../stores/telegram'
import { useUiStore } from '../stores/ui'
import { isTerm, useWorkspaceStore, workCwd, type Pane } from '../stores/workspace'
import { agentLive } from './useTelegramInbound'
import { usePaneInfo } from './usePaneInfo'

/** The topic a pane's Claude session is connected to ("Group › Topic"), or null. */
export function useTelegramLinks(): (pane: Pane | undefined) => string | null {
  if (!hasTelegram) return () => null
  const telegram = useTelegramStore()
  telegram.start()
  return (pane) => {
    if (!pane || !isTerm(pane) || !isSessionId(pane.agentSessionId)) return null
    const session = pane.agentSessionId.toLowerCase()
    const route = telegram.state?.sessionRoutes.find((r) => r.session === session)
    return route ? (route.where ?? `#${route.threadId ?? ''}`) : null
  }
}

/** Opens the Telegram link dialog of a pane's agent session (the ✈ glyph on tabs and rail rows). */
export function openTelegramLink(pane: Pane | undefined, name: string): void {
  if (!pane || !isTerm(pane) || !isSessionId(pane.agentSessionId)) return
  const cwd = workCwd(pane)
  if (cwd) useUiStore().telegramLink = { cwd, session: pane.agentSessionId.toLowerCase(), name }
}

export interface SessionLive {
  pane: Pane
  state: RailState
  /** StatusIcon status. */
  badge: string
  word: string
}

/** Live state of the Workspace pane running a Claude session (null when no live pane runs it), as the rail shows it. */
export function useSessionLive(): (session: string) => SessionLive | null {
  const { t } = useI18n()
  const workspace = useWorkspaceStore()
  const { sessionOf } = usePaneInfo()
  return (session) => {
    const pane = workspace.panes.find((p) => isTerm(p) && p.agentSessionId?.toLowerCase() === session && agentLive(p))
    if (!pane) return null
    const s = sessionOf(pane)
    const state = paneState(pane, s ? { status: s.status, title: '', subagents: 0 } : undefined)
    const wait = state === 'asked' && s?.status === 'waiting' ? waitDisplay(s.waitingFor, undefined, t) : null
    const w = stateWord(state, 0)
    return { pane, state, badge: RAIL_BADGE[state] ?? 'idle', word: wait?.text ?? t(w.key) }
  }
}
