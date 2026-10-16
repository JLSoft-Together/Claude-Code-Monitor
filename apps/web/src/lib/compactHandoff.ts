import type { TerminalStatus } from '@ccm/shared'
import type { MenuEntry } from './menu'

type T = (key: string, params?: Record<string, unknown>) => string

export type CompactStep = 'writing' | 'compact'

export interface CompactFlow {
  step: CompactStep
  file: string
  base: number
  worked: boolean
  missing?: boolean
}

export type CompactState = 'ready' | 'busy' | 'asking' | 'unlinked' | 'running'

export type CompactAction = 'check' | 'resume' | null

const pad = (n: number): string => String(n).padStart(2, '0')

export function handoffFile(cwd: string, now: Date): string {
  const sep = /^[A-Za-z]:/.test(cwd) || cwd.includes('\\') ? '\\' : '/'
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  return [cwd.replace(/[\\/]+$/, ''), '.planning', `HANDOFF-${stamp}.md`].join(sep)
}

export function compactState(status: TerminalStatus | undefined, flow: CompactFlow | undefined): CompactState {
  if (flow) return 'running'
  if (!status || status === 'stale' || status === 'unknown') return 'unlinked'
  if (status === 'idle') return 'ready'
  if (status === 'waiting') return 'asking'
  return 'busy'
}

export function compactTick(flow: CompactFlow, now: { status?: TerminalStatus; compactions: number }): { flow: CompactFlow; action: CompactAction } {
  if (now.compactions > flow.base) return { flow, action: 'resume' }
  if (flow.step !== 'writing') return { flow, action: null }
  if (now.status === 'working' || now.status === 'waiting') return { flow: flow.worked ? flow : { ...flow, worked: true }, action: null }
  if (now.status === 'idle' && flow.worked) return { flow: { ...flow, worked: false }, action: 'check' }
  return { flow, action: null }
}

const C = 'workspace.compact.'

export function compactEntry(state: CompactState | null | undefined, t: T): MenuEntry[] {
  if (!state) return []
  if (state === 'running') return [{ id: 'compact-cancel', label: t(`${C}cancel`) }]
  return [{ id: 'compact', label: t(`${C}menu`), disabled: state !== 'ready', hint: t(state === 'ready' ? `${C}hint` : `${C}block.${state}`) }]
}
