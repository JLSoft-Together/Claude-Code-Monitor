import { isAgentSessionId, uniquePaneNames, waitReason, type SessionActError, type SessionRef, type SessionTarget, type TelegramKey, type TelegramPaneInfo, type TerminalSession } from '@ccm/shared'
import { hasSnapshot, snapshotOf } from '../lib/paneSnapshots'
import { baseName } from '../lib/preview'
import { isAutoNamed } from '../lib/title'
import { useAgentsStore } from '../stores/agents'
import { dirKey } from '../stores/favorites'
import { useTerminalsStore } from '../stores/terminals'
import { isTerm, presetOf, tabProject, useWorkspaceStore, workCwd, type Pane } from '../stores/workspace'

const KEYS = { approve: '1', deny: '\x1b', stop: '\x1b' } as const
const TYPED_MS = 1500
const AGENT_PANES = new Set(['claude', 'codex'])
const LIST_MAX = 16

/** Why an agent's MCP call on another pane was refused: no such pane in its project, or the pane has a prompt waiting. */
export type AgentSessionFail = 'caller' | 'target' | 'busy'

export interface KeyPress {
  key: TelegramKey
  option?: number
  /** statusSince of the prompt the press answers: a newer prompt refuses it. */
  since?: number
  tool?: string
}

export const keyOf = (req: Pick<KeyPress, 'key' | 'option'>): string => (req.key === 'option' ? String(req.option ?? 0) : KEYS[req.key])

export function keysReady(req: KeyPress, s: Pick<TerminalSession, 'status' | 'statusSince' | 'waitingFor'> | undefined, claude: boolean, tool?: string): boolean {
  if (!s) return false
  const reason = req.key === 'option' ? 'question' : 'permission'
  const ready = req.key === 'stop' ? s.status === 'working' : s.status === 'waiting' && waitReason(s.waitingFor) === reason && claude
  if (!ready) return false
  if (req.since !== undefined && (!s.statusSince || Date.parse(s.statusSince) !== req.since)) return false
  return req.key === 'stop' || req.key === 'option' || !req.tool || !tool || req.tool === tool
}

export type ActFail = { ok: false; error: SessionActError; panes?: Pane[] }
export type ActOk<T = object> = { ok: true; pane: Pane } & T

export interface NameOpts {
  /** Use the session's auto title. MCP callers say no: it is summarised from that session's chat. */
  title?: boolean
}

/** Pane actions shared by the Telegram bot and in-app callers (`session.*` in the Orrery API). */
export function useSessionActions() {
  const workspace = useWorkspaceStore()
  const terminals = useTerminalsStore()
  const agents = useAgentsStore()

  const sessionOf = (p: Pane): TerminalSession | undefined => {
    const t = p.terminalId ? terminals.byId[p.terminalId] : undefined
    return t && t.status !== 'stale' ? t : undefined
  }
  const nameOf = (p: Pane, opts: NameOpts = {}): string => {
    const s = sessionOf(p)
    // A name the owner or open_session set is not a chat summary; only an auto title is withheld from MCP callers.
    const named = s && !isAutoNamed(s) ? s.title : ''
    return s?.alias || (opts.title ? s?.title : named) || workspace.tabOf(p.key)?.name || baseName(workCwd(p) ?? p.cwd ?? '') || 'Agent'
  }
  function paneInfo(p: Pane, opts: NameOpts = { title: true }): TelegramPaneInfo {
    const s = sessionOf(p)
    const tool = s && s.status === 'working' ? agents.mainOf(s.id)?.currentTool : undefined
    const since = s?.statusSince ? Date.parse(s.statusSince) : NaN
    return { name: nameOf(p, opts), status: s?.status ?? 'unknown', ...(s ? { terminalId: s.id } : {}), ...(tool ? { tool } : {}), ...(Number.isFinite(since) ? { since } : {}) }
  }
  const paneInfos = (panes: readonly Pane[], opts?: NameOpts): TelegramPaneInfo[] => uniquePaneNames(panes.map((p) => paneInfo(p, opts)))

  const status = (target: Pick<SessionTarget, 'project' | 'nested'>): Pane[] => workspace.sessionPanes(target.project, target.nested)

  function resolve(target: SessionTarget): Pane | ActFail {
    const pane = workspace.resolveTarget(target)
    if (typeof pane !== 'string') return pane
    return pane === 'many' ? { ok: false, error: 'many', panes: status(target) } : { ok: false, error: pane }
  }

  function send(target: SessionTarget, text: string): ActOk | ActFail {
    const out = workspace.sendPrompt(target, text)
    if (out === 'many') return { ok: false, error: 'many', panes: status(target) }
    if (typeof out === 'string') return { ok: false, error: out }
    if ('busy' in out) return { ok: false, error: 'busy', panes: [out.busy] }
    return { ok: true, pane: out }
  }

  /** Sends to every idle agent pane of the project; panes with a pending prompt are skipped. */
  function sendAll(target: Pick<SessionTarget, 'project' | 'nested'>, text: string): { ok: true; panes: Pane[] } | ActFail {
    const candidates = status(target)
    const sent: Pane[] = []
    for (const p of candidates) {
      if (p.prefill || p.compact || !p.terminalId) continue
      const out = workspace.sendPrompt({ ...target, terminalId: p.terminalId }, text)
      if (typeof out === 'object' && !('busy' in out)) sent.push(out)
    }
    return sent.length ? { ok: true, panes: sent } : { ok: false, error: candidates.length ? 'busy' : 'none' }
  }

  async function keys(target: SessionTarget, req: KeyPress, ms = TYPED_MS): Promise<ActOk | ActFail> {
    const pane = resolve(target)
    if ('ok' in pane) return pane
    const s = sessionOf(pane)
    const tool = s ? agents.mainOf(s.id)?.currentTool : undefined
    if (!keysReady(req, s, presetOf(pane) === 'claude', tool) || !pane.terminalId) return { ok: false, error: 'state' }
    const out = workspace.typeKeys({ ...target, terminalId: pane.terminalId }, keyOf(req))
    if (out === 'busy') return { ok: false, error: 'busy', panes: [pane] }
    if (typeof out === 'string') return { ok: false, error: out }
    if (!(await workspace.telegramTyped(out.key, ms))) return { ok: false, error: 'unavailable' }
    return { ok: true, pane: out }
  }

  const stop = (target: SessionTarget, req: Omit<KeyPress, 'key' | 'option'> = {}) => keys(target, { ...req, key: 'stop' })

  function tail(target: SessionTarget, lines: number): ActOk<{ text: string }> | ActFail {
    const pane = resolve(target)
    if ('ok' in pane) return pane
    if (!hasSnapshot(pane.key)) return { ok: false, error: 'gone' }
    return { ok: true, pane, text: snapshotOf(pane.key, lines) }
  }

  const paneOf = (key: string): Pane | undefined => workspace.panes.find((p) => p.key === key)
  const termBySession = (sessionId: string): Pane | undefined => workspace.panes.find((p) => isTerm(p) && p.sessionId === sessionId)
  const live = (p: Pane): boolean => isTerm(p) && (p.state === 'running' || p.state === 'starting')

  function projectOf(p: Pane): string | undefined {
    const tab = workspace.tabOf(p.key)
    return (tab && tabProject(tab, paneOf)) ?? workCwd(p)
  }

  function sameProject(p: Pane, project: string): boolean {
    const root = dirKey(project)
    const inside = (dir: string | undefined): boolean => !!dir && (dirKey(dir) === root || dirKey(dir).startsWith(root + '\\'))
    const mine = projectOf(p)
    return inside(workCwd(p)) || (!!mine && dirKey(mine) === root)
  }

  /** Same-project agent / shell panes as an MCP caller may see them: names and states only, never terminal content. */
  function listFor(from: string): SessionRef[] | 'caller' {
    const caller = termBySession(from)
    const project = caller && projectOf(caller)
    if (!caller || !project) return 'caller'
    return workspace.panes
      .filter((p) => !!p.sessionId && live(p) && sameProject(p, project))
      .slice(0, LIST_MAX)
      .map((p) => ({
        sessionId: p.sessionId!,
        ...(isAgentSessionId(p.agentSessionId) ? { agentSessionId: p.agentSessionId } : {}),
        name: nameOf(p, { title: false }),
        agent: presetOf(p),
        status: sessionOf(p)?.status ?? p.state,
        self: p.key === caller.key,
        openedByYou: p.openedBy === caller.key,
      }))
  }

  /** The prompt is only typed into the other pane (prefillSubmit stays off): the owner reads it and presses Enter. */
  function typeInto(from: string, sessionId: string, text: string): { name: string } | AgentSessionFail {
    const caller = termBySession(from)
    const project = caller && projectOf(caller)
    if (!caller || !project) return 'caller'
    const target = termBySession(sessionId)
    if (!target || target.key === caller.key || !live(target) || !AGENT_PANES.has(presetOf(target)) || !sameProject(target, project)) return 'target'
    if (target.prefill || target.compact) return 'busy'
    workspace.update(target.key, { prefill: text, prefillSubmit: undefined })
    return { name: nameOf(target, { title: false }) }
  }

  /** Closes like the owner's close button (busy pane: confirm sheet, then undoable); only panes the caller opened. */
  function closeOpened(from: string, sessionId: string, isBusy: (p: Pane) => boolean): { name: string; confirm: boolean } | AgentSessionFail {
    const caller = termBySession(from)
    if (!caller) return 'caller'
    const target = termBySession(sessionId)
    if (!target || target.openedBy !== caller.key || target.key === caller.key) return 'target'
    if (workspace.pendingClose?.length) return 'busy'
    const name = nameOf(target, { title: false })
    workspace.requestClose([target.key], isBusy)
    return { name, confirm: !!workspace.pendingClose?.includes(target.key) }
  }

  return { listFor, typeInto, closeOpened, sessionOf, nameOf, paneInfo, paneInfos, status, resolve, send, sendAll, keys, stop, tail }
}
