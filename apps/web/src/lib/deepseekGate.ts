import type { DeepSeekStatus } from './desktop'

export type DeepSeekBlocker = 'install' | 'download' | 'login'

/** Why a DeepSeek pane would not work; null = go ahead, also while the status is still unknown (the pane says so itself). */
export function deepseekBlocker(s: DeepSeekStatus | null): DeepSeekBlocker | null {
  if (!s) return null
  if (s.needsDownload) return 'download'
  if (!s.installed) return 'install'
  return s.loggedIn === false ? 'login' : null
}

export type SetupStepId = 'install' | 'login' | 'sync'
export type SetupStepState = 'done' | 'next' | 'todo'

/** First-run checklist: the first unfinished step is `next`; a stale sync is unfinished again. */
export function setupSteps(s: DeepSeekStatus | null): { id: SetupStepId; state: SetupStepState }[] {
  const done: Record<SetupStepId, boolean> = {
    install: !!s?.installed,
    login: !!s?.installed && s.loggedIn === true,
    sync: s?.sync === 'current',
  }
  let nextGiven = false
  return (['install', 'login', 'sync'] as const).map((id) => {
    if (done[id]) return { id, state: 'done' as const }
    const state: SetupStepState = nextGiven ? 'todo' : 'next'
    nextGiven = true
    return { id, state }
  })
}

/** After a key is saved: offer the copy from Claude right away when it never ran. */
export const autoSyncAfterLogin = (s: DeepSeekStatus | null): boolean => !!s?.installed && s.loggedIn === true && s.sync === 'never'
