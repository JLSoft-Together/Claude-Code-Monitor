import type { TerminalSession } from '@ccm/shared'

export function displayTitle(terminal: Pick<TerminalSession, 'title' | 'alias'> | undefined): string {
  if (!terminal) return ''
  return terminal.alias || terminal.title
}

/** Claude picked the name itself (folder-based), so the user has not named this session yet. */
export function isAutoNamed(terminal: Pick<TerminalSession, 'alias' | 'nameSource'>): boolean {
  return !terminal.alias && (terminal.nameSource === undefined || terminal.nameSource === 'derived' || terminal.nameSource === 'auto')
}
