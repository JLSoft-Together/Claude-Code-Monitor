import type { McpDeskCall } from '../../../packages/shared/src/mcpDesk'
import {
  ORRERY_ACTIONS,
  isOrreryAction,
  parseOrreryCaller,
  type OrreryActionOn,
  type OrreryArgs,
  type OrreryCaller,
  type OrreryError,
  type OrreryFailure,
  type OrreryRequest,
} from '../../../packages/shared/src/orreryApi'

export type PageAction = OrreryActionOn<'page'>
export type MainAction = OrreryActionOn<'main'>

export interface OrreryDeps {
  /** Asks the workspace page over `ccm:orrery`; answers `unavailable` when it is not there or too slow. */
  page: (req: OrreryRequest) => Promise<unknown>
  desk: (call: McpDeskCall) => Promise<unknown>
  main: { [A in MainAction]: (args: OrreryArgs<A>, caller: OrreryCaller) => Promise<unknown> }
  /** Work main adds to a page answer (notify_owner reaches the toasts / phone through the collector). */
  after?: { [A in PageAction]?: (result: unknown, args: OrreryArgs<A>, caller: OrreryCaller) => unknown }
  newId: () => string
}

export type OrreryCall = (action: string, args: unknown, caller: OrreryCaller) => Promise<unknown>

const fail = (error: OrreryError): OrreryFailure => ({ ok: false, error })

/** The one gate every outside caller (MCP, agent-monitor:// links, the Telegram bot) goes through. */
export function createOrrery(deps: OrreryDeps): OrreryCall {
  return async (action, args, rawCaller) => {
    if (!isOrreryAction(action)) return fail('unknown')
    const caller = parseOrreryCaller(rawCaller)
    const spec = ORRERY_ACTIONS[action]
    if (!caller || !spec.sources.includes(caller.source)) return fail('source')
    const parsed = spec.parse(args)
    if (!parsed) return fail('args')
    // An MCP call speaks for the pane the host checked the token of, and only for it.
    if (caller.source === 'mcp' && caller.pane && 'from' in parsed && parsed.from !== caller.pane) return fail('source')
    try {
      if (spec.runs === 'desk') return await deps.desk(parsed as McpDeskCall)
      if (spec.runs === 'main') return await deps.main[action as MainAction](parsed as OrreryArgs<MainAction>, caller)
      const result = await deps.page({ id: deps.newId(), action, args: parsed, caller })
      const after = deps.after?.[action as PageAction] as ((result: unknown, args: unknown, caller: OrreryCaller) => unknown) | undefined
      return after ? await after(result, parsed, caller) : result
    } catch {
      return fail('failed')
    }
  }
}

interface PageTarget {
  send: (channel: string, req: OrreryRequest) => void
}

interface ReplyEvent {
  sender: unknown
}

export interface PageAskerDeps<E extends ReplyEvent> {
  /** The app page's webContents when it can answer now, else null. */
  target: () => (PageTarget & object) | null
  on: (channel: string, listener: (event: E, id: unknown, result: unknown) => void) => void
  off: (channel: string, listener: (event: E, id: unknown, result: unknown) => void) => void
  /** Only a top-level app frame may answer. */
  trusted: (event: E) => boolean
  timeoutMs: number
}

export function createPageAsker<E extends ReplyEvent>(deps: PageAskerDeps<E>): (req: OrreryRequest) => Promise<unknown> {
  return (req) => {
    const contents = deps.target()
    if (!contents) return Promise.resolve(fail('unavailable'))
    return new Promise((resolve) => {
      const timer = setTimeout(() => done(fail('unavailable')), deps.timeoutMs)
      const onReply = (event: E, id: unknown, result: unknown): void => {
        if (event.sender === contents && id === req.id && deps.trusted(event)) done(result)
      }
      const done = (result: unknown): void => {
        clearTimeout(timer)
        deps.off('ccm:orrery-reply', onReply)
        resolve(result)
      }
      deps.on('ccm:orrery-reply', onReply)
      contents.send('ccm:orrery', req)
    })
  }
}
