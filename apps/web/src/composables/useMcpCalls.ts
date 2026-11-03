import { cleanNoteText, isAgentNoteLevel, type McpPageCall, type McpPageResult, type TerminalSession } from '@ccm/shared'
import { desktop } from '../lib/desktop'
import { createRunCalls } from '../lib/mcpRun'
import { rootKey, type CheckoutChanges } from '../lib/overlap'
import { baseName, hasOverlap, overlapFiles } from '../lib/preview'
import { whoIsEditing, type EditorPane } from '../lib/whoIsEditing'
import { useInboxStore } from '../stores/inbox'
import { useRunStore } from '../stores/run'
import { useTerminalsStore } from '../stores/terminals'
import { isTerm, presetOf, useWorkspaceStore, workCwd, type Pane } from '../stores/workspace'

const DIRS_MAX = 12
let installed = false

/**
 * Page side of the v80 MCP tools (docs §11w). The PTY host already checked the token, the arguments and that
 * paths are inside the caller's project; nothing here submits input to any agent.
 */
export function installMcpCalls(): void {
  if (installed || !desktop?.onMcpCall) return
  installed = true
  const workspace = useWorkspaceStore()
  const terminals = useTerminalsStore()
  const inbox = useInboxStore()
  const runCalls = createRunCalls(useRunStore())

  const callerOf = (from: string): Pane | undefined => (from ? workspace.panes.find((p) => isTerm(p) && p.sessionId === from) : undefined)
  const sessionOf = (p: Pane): TerminalSession | undefined => {
    const t = p.terminalId ? terminals.byId[p.terminalId] : undefined
    return t && t.status !== 'stale' ? t : undefined
  }
  // Alias the owner typed or the folder: never the auto title, which is summarised from that session's chat.
  const nameOf = (p: Pane): string => sessionOf(p)?.alias || workspace.tabOf(p.key)?.name || baseName(workCwd(p) ?? p.cwd ?? '') || 'Agent'

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

  desktop.onMcpCall((call) => {
    if (call.tool === 'notify_owner') return notify(call)
    if (call.tool === 'open_in_workspace') return show(call)
    if (call.tool === 'who_is_editing') return who(call)
    if (call.tool === 'run_app' || call.tool === 'run_status' || call.tool === 'run_log') {
      if (!callerOf(call.from)) return { ok: false, error: 'caller' }
      return call.tool === 'run_app' ? runCalls.app(call) : call.tool === 'run_status' ? runCalls.status(call) : runCalls.log(call)
    }
    return { ok: false, error: 'failed' }
  })
}
