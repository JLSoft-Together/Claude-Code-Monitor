/** What the host page needs to rebuild a `KeyboardEvent` for its workspace / palette handlers. */
export interface ForwardedKey {
  key: string
  code: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

type KeyInput = Pick<Electron.Input, 'type' | 'key' | 'code' | 'control' | 'shift' | 'alt' | 'meta' | 'isComposing'> & { modifiers?: string[] }

const DIGIT = /^Digit[1-9]$/

/**
 * Chords from web `lib/workspaceKeys.ts` `workspaceAction` plus the Ctrl/⌘+K palette. Alt+arrows stay with the page
 * (browser back/forward). Keep in sync with that file.
 */
export function workspaceChord(input: KeyInput, mac: boolean): ForwardedKey | null {
  if (input.type !== 'keyDown' || input.isComposing) return null
  const { control: ctrl, shift, alt, meta, code } = input
  const hit = (): ForwardedKey => ({ key: input.key, code, ctrlKey: ctrl, shiftKey: shift, altKey: alt, metaKey: meta })
  if (mac) {
    if (ctrl && alt && !meta && !shift && code === 'KeyN') return hit()
    if (!meta || ctrl) return null
    if (alt) return null
    if (code === 'KeyT' || code === 'KeyW' || code === 'KeyK' || code === 'KeyP') return shift ? null : hit()
    if (code === 'KeyA' || code === 'KeyE' || code === 'KeyO' || code === 'KeyF') return shift ? hit() : null
    if (code === 'KeyD') return hit()
    if (code === 'BracketLeft' || code === 'BracketRight') return shift ? hit() : null
    if (DIGIT.test(code)) return shift ? null : hit()
    return null
  }
  if (meta) return null
  if (ctrl && shift && !alt && (code === 'KeyT' || code === 'KeyW' || code === 'KeyA' || code === 'KeyP' || code === 'KeyE' || code === 'KeyO')) return hit()
  if (alt && shift && !ctrl && ['KeyD', 'KeyF', 'Equal', 'NumpadAdd', 'Minus', 'NumpadSubtract'].includes(code)) return hit()
  if (ctrl && !alt && code === 'Tab') return hit()
  if (ctrl && !alt && !shift && code === 'KeyK') return hit()
  // AltGr arrives as Ctrl+Alt and types characters (@ { [) on many layouts: a non-digit key means it typed one.
  if (ctrl && alt && !shift && DIGIT.test(code) && /^[1-9]$/.test(input.key) && !input.modifiers?.includes('altgraph')) return hit()
  if (ctrl && alt && !shift && code === 'KeyN' && input.key.toLowerCase() === 'n' && !input.modifiers?.includes('altgraph')) return hit()
  return null
}
