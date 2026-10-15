import type { FocusDir, SplitDir } from './splitLayout'

export type WorkspaceAction =
  | { t: 'newTab' }
  | { t: 'split'; dir?: SplitDir }
  | { t: 'closePane' }
  | { t: 'cycleTab'; step: 1 | -1 }
  | { t: 'tab'; index: number }
  | { t: 'focus'; dir: FocusDir }
  /** Jump to the next pane whose agent waits for the user (or finished unseen). */
  | { t: 'attention' }
  /** ⌘P on macOS, Ctrl+Shift+P elsewhere: Ctrl+P is shell history. */
  | { t: 'quickOpen' }
  /** Sidebar → Explorer (⌘⇧E / Ctrl+Shift+E, as in VS Code). */
  | { t: 'explorer' }
  /** Mission Control: every tab of every project (⌘⇧O / Ctrl+Shift+O). */
  | { t: 'mission' }

const ARROWS: Record<string, FocusDir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }

/**
 * Windows Terminal's defaults (iTerm / Terminal.app on macOS), matched on `code` so Vietnamese IMEs and other
 * layouts keep working. Chosen to stay off the keys Claude Code and shells use (Ctrl+letter, Alt+letter).
 */
export function workspaceAction(e: KeyboardEvent, mac: boolean, multiPane: boolean): WorkspaceAction | null {
  if (e.type !== 'keydown' || e.isComposing) return null
  const { ctrlKey: ctrl, shiftKey: shift, altKey: alt, metaKey: meta, code } = e
  const digit = /^Digit([1-9])$/.exec(code)
  if (mac) {
    if (!meta || ctrl) return null
    if (code === 'KeyT' && !shift && !alt) return { t: 'newTab' }
    if (code === 'KeyA' && shift && !alt) return { t: 'attention' }
    if (code === 'KeyD' && !alt) return { t: 'split', dir: shift ? 'col' : 'row' }
    if (code === 'KeyW' && !shift && !alt) return { t: 'closePane' }
    if (code === 'KeyP' && !shift && !alt) return { t: 'quickOpen' }
    if (code === 'KeyE' && shift && !alt) return { t: 'explorer' }
    if (code === 'KeyO' && shift && !alt) return { t: 'mission' }
    if ((code === 'BracketLeft' || code === 'BracketRight') && shift && !alt) return { t: 'cycleTab', step: code === 'BracketRight' ? 1 : -1 }
    if (digit && !shift && !alt) return { t: 'tab', index: Number(digit[1]) - 1 }
    if (alt && !shift && ARROWS[code] && multiPane) return { t: 'focus', dir: ARROWS[code]! }
    return null
  }
  if (meta) return null
  if (ctrl && shift && !alt && code === 'KeyT') return { t: 'newTab' }
  if (ctrl && shift && !alt && code === 'KeyW') return { t: 'closePane' }
  if (ctrl && shift && !alt && code === 'KeyA') return { t: 'attention' }
  if (ctrl && shift && !alt && code === 'KeyP') return { t: 'quickOpen' }
  if (ctrl && shift && !alt && code === 'KeyE') return { t: 'explorer' }
  if (ctrl && shift && !alt && code === 'KeyO') return { t: 'mission' }
  if (alt && shift && !ctrl) {
    if (code === 'KeyD') return { t: 'split' }
    if (code === 'Equal' || code === 'NumpadAdd') return { t: 'split', dir: 'row' }
    if (code === 'Minus' || code === 'NumpadSubtract') return { t: 'split', dir: 'col' }
  }
  if (ctrl && !alt && code === 'Tab') return { t: 'cycleTab', step: shift ? -1 : 1 }
  // AltGr arrives as Ctrl+Alt on Windows; AltGr+digit types characters like @ { [ on many layouts.
  if (ctrl && alt && !shift && digit && !e.getModifierState?.('AltGraph')) return { t: 'tab', index: Number(digit[1]) - 1 }
  if (alt && !ctrl && !shift && ARROWS[code] && multiPane) return { t: 'focus', dir: ARROWS[code]! }
  return null
}
