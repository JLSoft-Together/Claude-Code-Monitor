import { hasTelegram } from '../lib/telegram'
import { runPaneAction, telegramMenuState, type PaneActionDeps, type PaneActionHooks, type PaneActionSubject } from '../lib/paneActions'
import { useTelegramStore } from '../stores/telegram'
import { useUiStore } from '../stores/ui'
import { useWorkspaceStore, type Pane } from '../stores/workspace'
import { useCompact } from './useCompact'

/** Runner for the pane actions of the tab and rail context menus (lib/paneActions). */
export function usePaneActions() {
  const workspace = useWorkspaceStore()
  const ui = useUiStore()
  const telegram = useTelegramStore()
  const compactFlow = useCompact()

  const deps: PaneActionDeps = {
    compact: (key) => void compactFlow.start(key),
    compactCancel: (key) => compactFlow.cancel(key),
    telegramLink: (ctx) => (ui.telegramLink = ctx),
    focus: (key) => workspace.activate(key),
    monitor: (terminalId) => {
      ui.setView('monitor')
      ui.focusTerminal(terminalId)
    },
  }

  const run = (id: string, subject: PaneActionSubject, hooks: PaneActionHooks = {}): boolean => runPaneAction(id, subject, hooks, deps)

  const telegramOf = (pane: Pane | undefined): 'linked' | 'unlinked' | undefined =>
    hasTelegram ? telegramMenuState(pane, (session) => !!telegram.state?.sessionRoutes.some((r) => r.session === session)) : undefined

  return { run, telegramOf }
}
