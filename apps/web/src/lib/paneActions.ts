import { isSessionId } from '@ccm/shared'
import { topicUrl } from './telegram'
import { isTerm, workCwd, type Pane } from '../stores/workspace'

/** Context-menu items the tab strip and the rail share; each menu keeps its own entries, these ids run the same code. */
export const PANE_ACTIONS = ['telegram-link', 'telegram-open', 'compact', 'compact-cancel', 'rename', 'close', 'close-others', 'focus', 'monitor', 'copy-cwd'] as const
export type PaneActionId = (typeof PANE_ACTIONS)[number]

const ALIASES: Readonly<Record<string, PaneActionId>> = { 'rename-tab': 'rename' }

export const paneActionOf = (id: string): PaneActionId | null => ALIASES[id] ?? ((PANE_ACTIONS as readonly string[]).includes(id) ? (id as PaneActionId) : null)

export interface TelegramLinkCtx {
  cwd: string
  session: string
  name: string
}

/** What the ✈ dialog needs for a pane's Claude session, or null when the pane has no known session or folder. */
export function telegramLinkCtx(pane: Pane | undefined, name: string): TelegramLinkCtx | null {
  if (!pane || !isTerm(pane) || !isSessionId(pane.agentSessionId)) return null
  const cwd = workCwd(pane)
  return cwd ? { cwd, session: pane.agentSessionId.toLowerCase(), name } : null
}

export interface TelegramRouteView {
  chatId: string
  threadId: number | null
  where?: string
  /** 'project' = the pane's folder is connected, the session has no topic of its own. */
  via: 'session' | 'project'
}

interface RouteState {
  sessionRoutes?: ReadonlyArray<{ session: string; chatId: string; threadId: number | null; where?: string }>
  routes?: ReadonlyArray<{ project: string; chatId: string; threadId: number | null; where?: string }>
}

const dirKey = (p: string): string => {
  const n = p.replace(/[\\/]+/g, '/').replace(/\/$/, '')
  return /^[A-Za-z]:/.test(n) ? n.toLowerCase() : n
}

/** Same pick as the bot: a session's own topic wins, then the deepest connected project folder holding the pane's cwd. */
export function telegramRouteOf(pane: Pane | undefined, state: RouteState | undefined): TelegramRouteView | null {
  if (!pane || !isTerm(pane) || !state) return null
  if (isSessionId(pane.agentSessionId)) {
    const session = pane.agentSessionId.toLowerCase()
    const own = state.sessionRoutes?.find((r) => r.session === session)
    if (own) return { chatId: own.chatId, threadId: own.threadId, where: own.where, via: 'session' }
  }
  const cwd = workCwd(pane)
  if (!cwd) return null
  const at = dirKey(cwd)
  let best: NonNullable<RouteState['routes']>[number] | null = null
  let bestKey = ''
  for (const r of state.routes ?? []) {
    const k = dirKey(r.project)
    if ((at === k || at.startsWith(`${k}/`)) && (!best || k.length > bestKey.length)) {
      best = r
      bestKey = k
    }
  }
  return best ? { chatId: best.chatId, threadId: best.threadId, where: best.where, via: 'project' } : null
}

/** The ✈ menu item state: 'linked' when the session or its project folder has a topic. */
export function telegramMenuState(pane: Pane | undefined, state: RouteState | undefined): 'linked' | 'unlinked' | undefined {
  const ctx = telegramLinkCtx(pane, '')
  return ctx ? (telegramRouteOf(pane, state) ? 'linked' : 'unlinked') : undefined
}

/** t.me link of the topic a pane is connected to; null when unlinked or the group has no topic link (basic group). */
export function telegramTopicLink(pane: Pane | undefined, state: RouteState | undefined): string | null {
  const route = telegramRouteOf(pane, state)
  return route ? topicUrl(route.chatId, route.threadId) : null
}

export interface PaneActionSubject {
  /** Pane key the action applies to (the rail's tab row: the tab's focused pane). */
  key?: string
  /** Pane whose session the action reads (the rail's tab row: the tab's primary pane). */
  pane?: Pane
  name: string
  cwd?: string | null
}

/** What differs per menu: renaming, closing and copying live in the component that owns the UI. */
export interface PaneActionHooks {
  rename?(): void
  close?(): void
  closeOthers?(): void
  copy?(path: string): void
}

export interface PaneActionDeps {
  compact(key: string): void
  compactCancel(key: string): void
  telegramLink(ctx: TelegramLinkCtx): void
  telegramOpen(pane: Pane | undefined, name: string): void
  focus(key: string): void
  monitor(terminalId: string): void
}

/** Runs a shared pane action; false when `id` is not one, so the menu's own switch handles it. */
export function runPaneAction(id: string, subject: PaneActionSubject, hooks: PaneActionHooks, deps: PaneActionDeps): boolean {
  const action = paneActionOf(id)
  if (!action) return false
  switch (action) {
    case 'telegram-link': {
      const ctx = telegramLinkCtx(subject.pane, subject.name)
      if (ctx) deps.telegramLink(ctx)
      break
    }
    case 'telegram-open':
      deps.telegramOpen(subject.pane, subject.name)
      break
    case 'compact':
      if (subject.key) deps.compact(subject.key)
      break
    case 'compact-cancel':
      if (subject.key) deps.compactCancel(subject.key)
      break
    case 'focus':
      if (subject.key) deps.focus(subject.key)
      break
    case 'monitor':
      if (subject.pane?.terminalId) deps.monitor(subject.pane.terminalId)
      break
    case 'copy-cwd':
      if (subject.cwd) hooks.copy?.(subject.cwd)
      break
    case 'rename':
      hooks.rename?.()
      break
    case 'close':
      hooks.close?.()
      break
    case 'close-others':
      hooks.closeOthers?.()
      break
  }
  return true
}
