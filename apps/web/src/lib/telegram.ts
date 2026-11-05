import type { TelegramCommandResult, TelegramCreateTopicInput, TelegramCreateTopicResult, TelegramDiscoverResult, TelegramError, TelegramPaneLink, TelegramPatch, TelegramRouteInput, TelegramSessionRouteInput, TelegramSetResult, TelegramState, TelegramTestResult } from '@ccm/shared'
import { desktop } from './desktop'

export type TelegramEvent = { state: TelegramState } | { failed: TelegramError }

interface TelegramBridge {
  telegramState?: () => Promise<TelegramState | null>
  telegramSet?: (patch: TelegramPatch) => Promise<TelegramSetResult>
  telegramRouteSet?: (input: TelegramRouteInput) => Promise<TelegramSetResult>
  telegramRouteRemove?: (project: string) => Promise<TelegramSetResult>
  telegramSessionRouteSet?: (input: TelegramSessionRouteInput) => Promise<TelegramSetResult>
  telegramSessionRouteRemove?: (session: string) => Promise<TelegramSetResult>
  telegramPanes?: (links: TelegramPaneLink[]) => Promise<boolean>
  telegramTest?: (project?: string, session?: string) => Promise<TelegramTestResult>
  telegramInstallCommand?: () => Promise<TelegramCommandResult>
  telegramDiscover?: () => Promise<TelegramDiscoverResult>
  telegramCreateTopic?: (input: TelegramCreateTopicInput) => Promise<TelegramCreateTopicResult>
  telegramPair?: (on: boolean) => Promise<TelegramSetResult>
  telegramUnpair?: () => Promise<TelegramSetResult>
  telegramInstallReceive?: () => Promise<TelegramCommandResult>
  onTelegram?: (handler: (event: TelegramEvent) => void) => () => void
}
const bridge = desktop as unknown as TelegramBridge | undefined

export const hasTelegram = typeof bridge?.telegramState === 'function'

const quiet = <T>(p: Promise<T> | undefined, fallback: T): Promise<T> => (p ? p.catch(() => fallback) : Promise.resolve(fallback))
const setFailed = { ok: false, error: 'failed' } as TelegramSetResult

export const telegramState = (): Promise<TelegramState | null> => quiet(bridge?.telegramState?.(), null)
export const telegramSet = (patch: TelegramPatch): Promise<TelegramSetResult> => quiet(bridge?.telegramSet?.(patch), setFailed)
export const telegramRouteSet = (input: TelegramRouteInput): Promise<TelegramSetResult> => quiet(bridge?.telegramRouteSet?.(input), setFailed)
export const telegramRouteRemove = (project: string): Promise<TelegramSetResult> => quiet(bridge?.telegramRouteRemove?.(project), setFailed)
export const telegramSessionRouteSet = (input: TelegramSessionRouteInput): Promise<TelegramSetResult> => quiet(bridge?.telegramSessionRouteSet?.(input), setFailed)
export const telegramSessionRouteRemove = (session: string): Promise<TelegramSetResult> => quiet(bridge?.telegramSessionRouteRemove?.(session), setFailed)
export const telegramPanes = (links: TelegramPaneLink[]): Promise<boolean> => quiet(bridge?.telegramPanes?.(links), false)
export const telegramTest = (project?: string, session?: string): Promise<TelegramTestResult> =>
  quiet(bridge?.telegramTest?.(project, session), { ok: false, error: 'network' } as TelegramTestResult)
export const telegramInstallCommand = (): Promise<TelegramCommandResult> =>
  quiet(bridge?.telegramInstallCommand?.(), { ok: false, error: 'failed' } as TelegramCommandResult)
export const telegramDiscover = (): Promise<TelegramDiscoverResult> => quiet(bridge?.telegramDiscover?.(), { ok: false, error: 'network' } as TelegramDiscoverResult)
export const telegramCreateTopic = (input: TelegramCreateTopicInput): Promise<TelegramCreateTopicResult> =>
  quiet(bridge?.telegramCreateTopic?.(input), { ok: false, error: 'network' } as TelegramCreateTopicResult)
export const telegramPair = (on: boolean): Promise<TelegramSetResult> => quiet(bridge?.telegramPair?.(on), setFailed)
export const telegramUnpair = (): Promise<TelegramSetResult> => quiet(bridge?.telegramUnpair?.(), setFailed)
export const telegramInstallReceive = (): Promise<TelegramCommandResult> =>
  quiet(bridge?.telegramInstallReceive?.(), { ok: false, error: 'failed' } as TelegramCommandResult)
export const onTelegram = (handler: (event: TelegramEvent) => void): (() => void) => bridge?.onTelegram?.(handler) ?? (() => undefined)

export const projectLabel = (dir: string): string => dir.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || dir

export const topicText = (r: { chatId: string; threadId: number | null; where?: string }, general: string): string =>
  r.where ?? `${r.chatId} · ${r.threadId === null ? general : `#${r.threadId}`}`

export function countdown(until: number | null, at: number): string | null {
  if (until === null) return null
  const s = Math.max(0, Math.ceil((until - at) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function projectChoices(dirs: (string | undefined | null)[], taken: string[]): string[] {
  const key = (d: string) => d.replace(/[\\/]+$/, '').toLowerCase()
  const used = new Set(taken.map(key))
  const seen = new Set<string>()
  const out: string[] = []
  for (const d of dirs) {
    if (!d) continue
    const k = key(d)
    if (!k || seen.has(k) || used.has(k)) continue
    seen.add(k)
    out.push(d.replace(/[\\/]+$/, '') || d)
  }
  return out.sort((a, b) => projectLabel(a).localeCompare(projectLabel(b)))
}
