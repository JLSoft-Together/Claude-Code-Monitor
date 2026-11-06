import {
  ORRERY_ACTIONS,
  isOrreryAction,
  parseOrreryCaller,
  type OrreryActionOn,
  type OrreryArgs,
  type OrreryCaller,
  type OrreryError,
  type OrreryFailure,
} from '@ccm/shared'
import { desktop } from '../lib/desktop'

export type PageAction = OrreryActionOn<'page'>
export type OrreryHandler<A extends PageAction> = (args: OrreryArgs<A>, caller: OrreryCaller) => unknown

const handlers: { [A in PageAction]?: OrreryHandler<A> } = {}
let installed = false

const fail = (error: OrreryError): OrreryFailure => ({ ok: false, error })

/** Page side of the Orrery API: one table of handlers, filled by the composables that own each action's state. */
export function handleOrrery<A extends PageAction>(action: A, handler: OrreryHandler<A>): void {
  ;(handlers as Record<PageAction, unknown>)[action] = handler
}

/** Main already checked the call; checked again here because this is where it touches the workspace. */
export async function runOrrery(action: unknown, args: unknown, rawCaller: unknown): Promise<unknown> {
  if (!isOrreryAction(action) || ORRERY_ACTIONS[action].runs !== 'page') return fail('unknown')
  const caller = parseOrreryCaller(rawCaller)
  const spec = ORRERY_ACTIONS[action]
  if (!caller || !spec.sources.includes(caller.source)) return fail('source')
  const parsed = spec.parse(args)
  if (!parsed) return fail('args')
  const handler = handlers[action as PageAction] as ((args: unknown, caller: OrreryCaller) => unknown) | undefined
  if (!handler) return fail('unavailable')
  try {
    return await handler(parsed, caller)
  } catch {
    return fail('failed')
  }
}

export function installOrreryApi(): void {
  if (installed || !desktop?.onOrrery) return
  installed = true
  desktop.onOrrery(runOrrery)
}

export const hasOrrery = (): boolean => !!desktop?.onOrrery
