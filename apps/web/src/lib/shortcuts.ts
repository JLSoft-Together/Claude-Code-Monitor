export interface Shortcut {
  id: string
  keys: string[]
  group: 'panels' | 'map' | 'help' | 'workspace'
}

export const SHORTCUTS: Shortcut[] = [
  { id: 'sessions', keys: ['S'], group: 'panels' },
  { id: 'sessionsPin', keys: ['Shift', 'S'], group: 'panels' },
  { id: 'activity', keys: ['A'], group: 'panels' },
  { id: 'activityPin', keys: ['Shift', 'A'], group: 'panels' },
  { id: 'bar', keys: ['B'], group: 'panels' },
  { id: 'barDock', keys: ['Shift', 'B'], group: 'panels' },
  { id: 'tabs', keys: ['0', '…', '9'], group: 'map' },
  { id: 'fit', keys: ['F'], group: 'map' },
  { id: 'esc', keys: ['Esc'], group: 'map' },
  { id: 'hints', keys: ['H'], group: 'help' },
  { id: 'help', keys: ['?'], group: 'help' },
  { id: 'palette', keys: ['Ctrl', 'K'], group: 'help' },
]

/** Workspace chords, mirroring `workspaceAction` in lib/workspaceKeys.ts (they work even while a terminal has focus). */
export function workspaceShortcuts(mac: boolean): Shortcut[] {
  const group = 'workspace' as const
  if (mac)
    return [
      { id: 'wsNew', keys: ['⌘', 'T'], group },
      { id: 'wsSplitRight', keys: ['⌘', 'D'], group },
      { id: 'wsSplitDown', keys: ['⌘', '⇧', 'D'], group },
      { id: 'wsClose', keys: ['⌘', 'W'], group },
      { id: 'wsAttention', keys: ['⌘', '⇧', 'A'], group },
      { id: 'wsCycle', keys: ['⌘', '⇧', '[', ']'], group },
      { id: 'wsTab', keys: ['⌘', '1', '…', '9'], group },
      { id: 'wsFocus', keys: ['⌥', '⌘', '←↑↓→'], group },
      { id: 'wsQuickOpen', keys: ['⌘', 'P'], group },
      { id: 'wsFind', keys: ['⌘', 'F'], group },
    ]
  return [
    { id: 'wsNew', keys: ['Ctrl', 'Shift', 'T'], group },
    { id: 'wsSplit', keys: ['Alt', 'Shift', 'D'], group },
    { id: 'wsSplitRight', keys: ['Alt', 'Shift', '+'], group },
    { id: 'wsSplitDown', keys: ['Alt', 'Shift', '-'], group },
    { id: 'wsClose', keys: ['Ctrl', 'Shift', 'W'], group },
    { id: 'wsAttention', keys: ['Ctrl', 'Shift', 'A'], group },
    { id: 'wsCycle', keys: ['Ctrl', 'Tab'], group },
    { id: 'wsTab', keys: ['Ctrl', 'Alt', '1', '…', '9'], group },
    { id: 'wsFocus', keys: ['Alt', '←↑↓→'], group },
    { id: 'wsQuickOpen', keys: ['Ctrl', 'Shift', 'P'], group },
    { id: 'wsFind', keys: ['Ctrl', 'Shift', 'F'], group },
  ]
}

export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true
  // Comboboxes and listboxes use letters for typeahead.
  return !!target.closest('[role="combobox"], [role="listbox"]')
}
