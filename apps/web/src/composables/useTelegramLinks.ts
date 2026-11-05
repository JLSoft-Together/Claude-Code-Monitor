import { isSessionId } from '@ccm/shared'
import { hasTelegram } from '../lib/telegram'
import { useTelegramStore } from '../stores/telegram'
import { useUiStore } from '../stores/ui'
import { isTerm, workCwd, type Pane } from '../stores/workspace'

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
