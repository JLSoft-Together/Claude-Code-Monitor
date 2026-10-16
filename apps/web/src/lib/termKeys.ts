import type { PtyPreset } from '@ccm/shared'

export type EnterKey = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'altKey' | 'metaKey'>

export const AGENT_NEWLINE = '\n'

export function newlineFor(e: EnterKey, preset: PtyPreset): string | null {
  if (e.key !== 'Enter' || preset === 'shell' || e.altKey || e.metaKey) return null
  return e.shiftKey !== e.ctrlKey ? AGENT_NEWLINE : null
}
