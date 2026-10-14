import { shortcutText } from './shortcuts'

/** Workspace actions that have a chord; the tip names it after repeated mouse use. */
export type TipAction = 'newTab' | 'split' | 'closePane' | 'tab' | 'attention' | 'focus'

export interface TipState {
  off: boolean
  /** Used once by keyboard: never tipped again. */
  learned: TipAction[]
  /** How often each tip was shown (max TIP_MAX_SHOWN). */
  shown: Partial<Record<TipAction, number>>
}

export const TIP_USES = 3
export const TIP_WINDOW_MS = 10 * 60_000
export const TIP_GAP_MS = 3 * 60_000
export const TIP_MAX_SHOWN = 2
const ACTIONS: TipAction[] = ['newTab', 'split', 'closePane', 'tab', 'attention', 'focus']

export function shouldTip(state: TipState, action: TipAction, uses: number[], now: number, lastTipAt: number): boolean {
  if (state.off || state.learned.includes(action) || (state.shown[action] ?? 0) >= TIP_MAX_SHOWN) return false
  if (now - lastTipAt < TIP_GAP_MS) return false
  return uses.filter((at) => now - at <= TIP_WINDOW_MS).length >= TIP_USES
}

export function parseTipState(raw: string | null): TipState {
  const empty: TipState = { off: false, learned: [], shown: {} }
  try {
    const v = JSON.parse(raw ?? 'null') as Partial<TipState> | null
    if (!v || typeof v !== 'object') return empty
    const shown: TipState['shown'] = {}
    for (const a of ACTIONS) {
      const n = v.shown?.[a]
      if (typeof n === 'number' && n > 0) shown[a] = Math.min(n, TIP_MAX_SHOWN)
    }
    return { off: v.off === true, learned: Array.isArray(v.learned) ? ACTIONS.filter((a) => v.learned!.includes(a)) : [], shown }
  } catch {
    return empty
  }
}

/** i18n params of `tips.<action>`. */
export function tipKeys(action: TipAction, mac: boolean): Record<string, string> {
  const k = (id: string) => shortcutText(id, mac)
  switch (action) {
    case 'newTab':
      return { keys: k('wsNew') }
    case 'split':
      return { keys: k(mac ? 'wsSplitRight' : 'wsSplit') }
    case 'closePane':
      return { keys: k('wsClose') }
    case 'tab':
      return { keys: mac ? '⌘1…9' : 'Ctrl+Alt+1…9', cycle: k('wsCycle') }
    case 'attention':
      return { keys: k('wsAttention') }
    case 'focus':
      return { keys: k('wsFocus') }
  }
}
