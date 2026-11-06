import { useI18n } from 'vue-i18n'
import { telegramLinkCtx, telegramRouteOf, telegramTopicLink } from '../lib/paneActions'
import { paneState, RAIL_BADGE, stateWord, type RailState } from '../lib/rail/railModel'
import { hasTelegram } from '../lib/telegram'
import { openExternal } from '../lib/preview'
import { waitDisplay } from '../lib/wait'
import { useTelegramStore } from '../stores/telegram'
import { useUiStore } from '../stores/ui'
import { isTerm, useWorkspaceStore, type Pane } from '../stores/workspace'
import { agentLive } from './useTelegramInbound'
import { usePaneInfo } from './usePaneInfo'

/** The topic a pane is connected to ("Group › Topic"): its session's own, else its project folder's. Null when none. */
export function useTelegramLinks(): (pane: Pane | undefined) => string | null {
  if (!hasTelegram) return () => null
  const telegram = useTelegramStore()
  telegram.start()
  return (pane) => {
    const route = telegramRouteOf(pane, telegram.state ?? undefined)
    return route ? (route.where ?? `#${route.threadId ?? ''}`) : null
  }
}

/** Opens the Telegram link dialog of a pane's agent session (the ✈ glyph on tabs and rail rows). */
export function openTelegramLink(pane: Pane | undefined, name: string): void {
  const ctx = telegramLinkCtx(pane, name)
  if (ctx) useUiStore().telegramLink = ctx
}

/** The ✈ glyph: opens the connected topic in the Telegram app, or the link dialog when the group has no topic link. */
export function openTelegramGlyph(pane: Pane | undefined, name: string): void {
  const url = telegramTopicLink(pane, useTelegramStore().state ?? undefined)
  if (url) void openExternal(url)
  else openTelegramLink(pane, name)
}

/** Telegram topic URL of a pane's session, or null. */
export function useTelegramTopicUrl(): (pane: Pane | undefined) => string | null {
  if (!hasTelegram) return () => null
  const telegram = useTelegramStore()
  return (pane) => telegramTopicLink(pane, telegram.state ?? undefined)
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
