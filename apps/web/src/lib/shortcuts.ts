/**
 * Keys are tokens: `Mod` is the command key (⌘ on macOS, Ctrl elsewhere), `Ctrl` the real Control key (⌃ on macOS),
 * `Alt`, `Shift`, `Enter`; anything else prints as is. `formatKeys` maps them per platform.
 */
export interface Shortcut {
  id: string
  keys: string[]
  group: 'panels' | 'map' | 'help' | 'workspace' | 'view'
}

export const SHORTCUTS: Shortcut[] = [
  { id: 'sessions', keys: ['S'], group: 'panels' },
  { id: 'sessionsPin', keys: ['Shift', 'S'], group: 'panels' },
  { id: 'tabs', keys: ['0', '…', '9'], group: 'map' },
  { id: 'fit', keys: ['F'], group: 'map' },
  { id: 'esc', keys: ['Esc'], group: 'map' },
  { id: 'mapNav', keys: ['←↑↓→'], group: 'map' },
  { id: 'mapEnter', keys: ['Enter'], group: 'map' },
  { id: 'mapFold', keys: ['Space'], group: 'map' },
  { id: 'mapCopy', keys: ['Mod', 'C'], group: 'map' },
  { id: 'mapFind', keys: ['Mod', 'F'], group: 'map' },
  { id: 'mapMenu', keys: ['Shift', 'F10'], group: 'map' },
  { id: 'hints', keys: ['H'], group: 'help' },
  { id: 'help', keys: ['?'], group: 'help' },
  { id: 'palette', keys: ['Mod', 'K'], group: 'help' },
]

/** Workspace chords, mirroring `workspaceAction` in lib/workspaceKeys.ts (they work even while a terminal has focus). */
export function workspaceShortcuts(mac: boolean): Shortcut[] {
  const group = 'workspace' as const
  if (mac)
    return [
      { id: 'wsNew', keys: ['Mod', 'T'], group },
      { id: 'wsSplitRight', keys: ['Mod', 'D'], group },
      { id: 'wsSplitDown', keys: ['Mod', 'Shift', 'D'], group },
      { id: 'wsClose', keys: ['Mod', 'W'], group },
      { id: 'wsReopen', keys: ['Mod', 'Shift', 'T'], group },
      { id: 'wsZoom', keys: ['Mod', 'Shift', 'Enter'], group },
      { id: 'wsAttention', keys: ['Mod', 'Shift', 'A'], group },
      { id: 'wsCycle', keys: ['Mod', 'Shift', '[', ']'], group },
      { id: 'wsMoveTab', keys: ['Mod', 'Shift', 'PgUp', 'PgDn'], group },
      { id: 'wsTab', keys: ['Mod', '1', '…', '9'], group },
      { id: 'wsFocus', keys: ['Alt', 'Mod', '←↑↓→'], group },
      { id: 'wsSwap', keys: ['Alt', 'Mod', 'Shift', '←↑↓→'], group },
      { id: 'wsQuickOpen', keys: ['Mod', 'P'], group },
      { id: 'wsExplorer', keys: ['Mod', 'Shift', 'E'], group },
    { id: 'wsSearch', keys: ['Mod', 'Shift', 'F'], group },
      { id: 'wsMission', keys: ['Mod', 'Shift', 'O'], group },
      { id: 'wsPrompts', keys: ['Mod', 'Shift', 'P'], group },
      { id: 'wsOutline', keys: ['Mod', 'F12'], group },
      { id: 'wsUsages', keys: ['Shift', 'F12'], group },
      { id: 'wsRecent', keys: ['Mod', 'E'], group },
      { id: 'wsBookmark', keys: ['F11'], group },
      { id: 'wsNavBack', keys: ['Ctrl', '-'], group },
      { id: 'wsNavForward', keys: ['Ctrl', 'Shift', '-'], group },
      { id: 'wsFind', keys: ['Mod', 'F'], group },
      { id: 'wsNextChange', keys: ['F7', 'Shift', 'F7'], group },
      { id: 'wsDiffFile', keys: ['[', ']'], group },
      { id: 'wsJumpSource', keys: ['F4'], group },
      { id: 'wsShowDiff', keys: ['Alt', 'Mod', 'D'], group },
    ]
  return [
    { id: 'wsNew', keys: ['Ctrl', 'Shift', 'T'], group },
    { id: 'wsSplit', keys: ['Alt', 'Shift', 'D'], group },
    { id: 'wsSplitRight', keys: ['Alt', 'Shift', '+'], group },
    { id: 'wsSplitDown', keys: ['Alt', 'Shift', '-'], group },
    { id: 'wsClose', keys: ['Ctrl', 'Shift', 'W'], group },
    { id: 'wsReopen', keys: ['Ctrl', 'Shift', 'Z'], group },
    { id: 'wsZoom', keys: ['Ctrl', 'Shift', 'Enter'], group },
    { id: 'wsAttention', keys: ['Ctrl', 'Shift', 'A'], group },
    { id: 'wsCycle', keys: ['Ctrl', 'Tab'], group },
    { id: 'wsMoveTab', keys: ['Ctrl', 'Shift', 'PgUp', 'PgDn'], group },
    { id: 'wsTab', keys: ['Ctrl', 'Alt', '1', '…', '9'], group },
    { id: 'wsFocus', keys: ['Alt', '←↑↓→'], group },
    { id: 'wsSwap', keys: ['Alt', 'Shift', '←↑↓→'], group },
    { id: 'wsQuickOpen', keys: ['Ctrl', 'Shift', 'P'], group },
    { id: 'wsExplorer', keys: ['Ctrl', 'Shift', 'E'], group },
    { id: 'wsSearch', keys: ['Alt', 'Shift', 'F'], group },
    { id: 'wsMission', keys: ['Ctrl', 'Shift', 'O'], group },
    { id: 'wsPrompts', keys: ['Alt', 'Shift', 'P'], group },
    { id: 'wsOutline', keys: ['Ctrl', 'F12'], group },
    { id: 'wsUsages', keys: ['Shift', 'F12'], group },
    { id: 'wsRecent', keys: ['Alt', 'Shift', 'E'], group },
    { id: 'wsBookmark', keys: ['F11'], group },
    { id: 'wsNavBack', keys: ['Ctrl', 'Alt', '←'], group },
    { id: 'wsNavForward', keys: ['Ctrl', 'Alt', '→'], group },
    { id: 'wsFind', keys: ['Ctrl', 'Shift', 'F'], group },
    { id: 'wsNextChange', keys: ['F7', 'Shift', 'F7'], group },
    { id: 'wsDiffFile', keys: ['[', ']'], group },
    { id: 'wsJumpSource', keys: ['F4'], group },
    { id: 'wsShowDiff', keys: ['Ctrl', 'D'], group },
  ]
}

/** App zoom and code size (useWheelZoom + the main process). */
export function viewShortcuts(mac: boolean): Shortcut[] {
  const group = 'view' as const
  return mac
    ? [
        { id: 'zoomApp', keys: ['Mod', '+', '−', '0'], group },
        { id: 'zoomCode', keys: ['Alt', 'Mod', '+', '−', '0'], group },
        { id: 'zoomWheel', keys: ['Ctrl', 'Scroll'], group },
      ]
    : [
        { id: 'zoomApp', keys: ['Ctrl', '+', '−', '0'], group },
        { id: 'zoomCode', keys: ['Ctrl', 'Alt', '+', '−', '0'], group },
        { id: 'zoomWheel', keys: ['Ctrl', 'Wheel'], group },
      ]
}

const MAC_ORDER = ['Ctrl', 'Alt', 'Shift', 'Mod']
const WIN_ORDER = ['Mod', 'Ctrl', 'Alt', 'Shift']
const MAC_SYMBOL: Record<string, string> = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Mod: '⌘', Enter: '↩', Backspace: '⌫' }

/** Key tokens → labels; each run of modifiers is sorted the platform's way (⌃⌥⇧⌘ on macOS, Ctrl Alt Shift elsewhere). */
export function formatKeys(keys: readonly string[], mac: boolean): string[] {
  const order = mac ? MAC_ORDER : WIN_ORDER
  const out: string[] = []
  let mods: string[] = []
  const flush = (): void => {
    const names = [...new Set(mods.map((k) => (!mac && k === 'Mod' ? 'Ctrl' : k)))]
    for (const m of names.sort((a, b) => order.indexOf(a) - order.indexOf(b))) out.push(mac ? MAC_SYMBOL[m]! : m)
    mods = []
  }
  for (const k of keys) {
    if (order.includes(k)) {
      mods.push(k)
      continue
    }
    flush()
    out.push(mac ? (MAC_SYMBOL[k] ?? k) : k)
  }
  flush()
  return out
}

/** One chord as text: "Ctrl+Shift+T", or "⇧⌘T" on macOS. */
export function keyCombo(keys: readonly string[], mac: boolean): string {
  return formatKeys(keys, mac).join(mac ? '' : '+')
}

/** One workspace chord as text. */
export function shortcutText(id: string, mac: boolean): string {
  return keyCombo(workspaceShortcuts(mac).find((s) => s.id === id)?.keys ?? [], mac)
}

export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true
  // Comboboxes and listboxes use letters for typeahead.
  return !!target.closest('[role="combobox"], [role="listbox"]')
}
