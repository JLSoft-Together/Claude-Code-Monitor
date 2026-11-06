import { cleanNoteText, cleanPanePrompt, handBackPrompt, isAgentNoteLevel, type McpPageCall, type McpPageResult } from '@ccm/shared'
import { i18n } from '../i18n'
import { createRunCalls } from '../lib/mcpRun'
import { rootKey, type CheckoutChanges } from '../lib/overlap'
import { hasOverlap, overlapFiles } from '../lib/preview'
import { whoIsEditing, type EditorPane } from '../lib/whoIsEditing'
import { useInboxStore } from '../stores/inbox'
import { useRunStore } from '../stores/run'
import { useToastsStore } from '../stores/toasts'
import { isTerm, presetOf, useWorkspaceStore, workCwd, type Pane } from '../stores/workspace'
import { handleOrrery, hasOrrery } from './useOrreryApi'
import { usePaneInfo } from './usePaneInfo'
import { useSessionActions } from './useSessionActions'

const DIRS_MAX = 12
const HAND_BACK_TOAST_MS = 8000
let installed = false

/**
 * Page side of the v80 MCP tools (docs §11w). The PTY host already checked the token, the arguments and that
 * paths are inside the caller's project. Only hand_back submits input, into the pane that opened the caller (docs §11am).
 */
export function installMcpCalls(): void {
  if (installed || !hasOrrery()) return
  installed = true
  const workspace = useWorkspaceStore()
  const inbox = useInboxStore()
  const toasts = useToastsStore()
  const runCalls = createRunCalls(useRunStore())

  const callerOf = (from: string): Pane | undefined => (from ? workspace.panes.find((p) => isTerm(p) && p.sessionId === from) : undefined)
  const act = useSessionActions()
  const sessionOf = act.sessionOf
  // Alias the owner typed or the folder: never the auto title, which is summarised from that session's chat.
  const nameOf = (p: Pane): string => act.nameOf(p, { title: false })

  function notify(call: Extract<McpPageCall, { tool: 'notify_owner' }>): McpPageResult {
    const caller = callerOf(call.from)
    const text = cleanNoteText(call.text)
    if (!caller || !text || !isAgentNoteLevel(call.level)) return { ok: false, error: caller ? 'failed' : 'caller' }
    const session = sessionOf(caller)
    if (session) inbox.addNote(session.id, { text, level: call.level, at: new Date().toISOString(), merged: Math.max(0, Math.floor(call.merged) || 0) })
    return { ok: true, tool: 'notify_owner', name: nameOf(caller), ...(session ? { terminalId: session.id } : {}), inbox: !!session }
  }

  function show(call: Extract<McpPageCall, { tool: 'open_in_workspace' }>): McpPageResult {
    const line = typeof call.line === 'number' && Number.isInteger(call.line) && call.line > 0 ? call.line : undefined
    const out = typeof call.path === 'string' && call.path ? workspace.showForAgent(call.from, { path: call.path, line, diff: call.diff === true, root: call.cwd }) : 'caller'
    return typeof out === 'object' ? { ok: true, tool: 'open_in_workspace', ...out } : { ok: false, error: out }
  }

  function handBack(call: Extract<McpPageCall, { tool: 'hand_back' }>): McpPageResult {
    const prompt = cleanPanePrompt(handBackPrompt(call.report, call.summary))
    if (!prompt) return { ok: false, error: 'failed' }
    const out = workspace.handBack(call.from, prompt)
    if (typeof out === 'string') return { ok: false, error: out }
    const origin = nameOf(out)
    toasts.push({ kind: 'info', text: i18n.global.t('workspace.handBack.said', { name: origin }), detail: call.report, timeoutMs: HAND_BACK_TOAST_MS })
    return { ok: true, tool: 'hand_back', origin }
  }

  const sessionFail = (error: 'caller' | 'target' | 'busy'): McpPageResult => ({ ok: false, error })
  const { isBusy } = usePaneInfo()

  function listSessions(call: Extract<McpPageCall, { tool: 'list_sessions' }>): McpPageResult {
    const sessions = act.listFor(call.from)
    return typeof sessions === 'string' ? sessionFail(sessions) : { ok: true, tool: 'list_sessions', sessions }
  }

  function sendToSession(call: Extract<McpPageCall, { tool: 'send_to_session' }>): McpPageResult {
    const text = cleanPanePrompt(call.text)
    if (!text) return { ok: false, error: 'failed' }
    const out = act.typeInto(call.from, call.session, text)
    return typeof out === 'string' ? sessionFail(out) : { ok: true, tool: 'send_to_session', name: out.name }
  }

  function closeSession(call: Extract<McpPageCall, { tool: 'close_session' }>): McpPageResult {
    const out = act.closeOpened(call.from, call.session, isBusy)
    return typeof out === 'string' ? sessionFail(out) : { ok: true, tool: 'close_session', ...out }
  }

  async function who(call: Extract<McpPageCall, { tool: 'who_is_editing' }>): Promise<McpPageResult> {
    const caller = callerOf(call.from)
    const callerDir = caller ? (workCwd(caller) ?? caller.cwd) : undefined
    if (!caller || !callerDir) return { ok: false, error: 'caller' }
    if (!hasOverlap) return { ok: false, error: 'unavailable' }
    const others: EditorPane[] = workspace.panes
      .filter((p) => p.key !== caller.key && isTerm(p) && presetOf(p) !== 'shell' && p.state === 'running' && !!workCwd(p))
      .map((p) => {
        const s = sessionOf(p)
        return { name: nameOf(p), agent: presetOf(p), dir: workCwd(p)!, ...(s ? { status: s.status, lastActivityAt: s.lastActivityAt } : {}) }
      })
    const dirs = new Map<string, string>([[rootKey(callerDir), callerDir]])
    for (const o of others) if (dirs.size < DIRS_MAX && !dirs.has(rootKey(o.dir))) dirs.set(rootKey(o.dir), o.dir)
    const results = await Promise.all([...dirs.values()].map((d) => overlapFiles(d)))
    const checkouts: CheckoutChanges[] = []
    for (const r of results) if (r.ok && !checkouts.some((c) => rootKey(c.root) === rootKey(r.root))) checkouts.push({ root: r.root, common: r.common, branch: r.branch, files: r.files })
    return { ok: true, tool: 'who_is_editing', ...whoIsEditing(call.path, callerDir, others, checkouts) }
  }

  const fromCaller =
    <C extends { from: string }>(run: (call: C) => McpPageResult | Promise<McpPageResult>) =>
    (call: C): McpPageResult | Promise<McpPageResult> =>
      callerOf(call.from) ? run(call) : { ok: false, error: 'caller' }
  handleOrrery('owner.notify', notify)
  handleOrrery('workspace.show', show)
  handleOrrery('file.editors', who)
  handleOrrery('session.handBack', handBack)
  handleOrrery('session.list', listSessions)
  handleOrrery('session.sendTo', sendToSession)
  handleOrrery('session.close', closeSession)
  handleOrrery('run.app', fromCaller(runCalls.app))
  handleOrrery('run.status', fromCaller(runCalls.status))
  handleOrrery('run.log', fromCaller(runCalls.log))
}
