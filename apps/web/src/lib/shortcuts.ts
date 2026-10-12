export interface Shortcut {
  id: string
  keys: string[]
  group: 'panels' | 'map' | 'help'
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

export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true
  // Comboboxes and listboxes use letters for typeahead.
  return !!target.closest('[role="combobox"], [role="listbox"]')
}
