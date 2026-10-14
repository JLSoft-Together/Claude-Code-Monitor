/** Fixed launch presets: the client only ever names one of these, never a command string. */
export const PTY_PRESETS = ['claude', 'codex', 'shell'] as const
export type PtyPreset = (typeof PTY_PRESETS)[number]

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Only a bare UUID ever reaches a shell command line. */
export const isAgentSessionId = (v: unknown): v is string => typeof v === 'string' && SESSION_ID.test(v)

export const isPtyPreset = (v: unknown): v is PtyPreset => typeof v === 'string' && (PTY_PRESETS as readonly string[]).includes(v)

/** Token travels as a WebSocket subprotocol so it never lands in a URL or access log. */
export const PTY_PROTOCOL_PREFIX = 'ccm.pty.'

/** Text frames client → host. Keystrokes go as binary frames. */
export type PtyClientMessage =
  /** `resume`: an agent session id (UUID) to continue, claude / codex only. */
  | { t: 'spawn'; preset: PtyPreset; cols: number; rows: number; cwd?: string; resume?: string }
  | { t: 'attach'; id: string }
  | { t: 'resize'; cols: number; rows: number }
  /** Without id: the attached session. With id: any session (closing a pane whose socket already dropped). */
  | { t: 'kill'; id?: string }
  /** Which of these process ids run inside a CCM terminal (any depth), answered with `owners`. */
  | { t: 'owners'; pids: number[] }
  /** Git worktrees of the repo holding cwd. */
  | { t: 'wt.list'; cwd: string }
  /** New worktree in `<repo>-wt/<branch>`; an existing branch is checked out, otherwise created from cwd's HEAD. */
  | { t: 'wt.add'; cwd: string; branch: string }
  /** Never forced: refused while dirty, for the main checkout, or while a terminal runs inside it. */
  | { t: 'wt.remove'; cwd: string; path: string }

/** Text frames host → client. Terminal output goes as binary frames. */
export type PtyServerMessage =
  | { t: 'ready'; id: string; preset: PtyPreset; pid: number; cwd: string; replay: boolean }
  | { t: 'pid'; pid: number }
  | { t: 'exit'; code: number }
  | { t: 'gone' }
  | { t: 'error'; message: string }
  /** pid → PTY session id, only for pids that descend from a live session; null when the process scan failed. */
  | { t: 'owners'; owners: Record<string, string> | null }
  /** Current branch of the attached session's folder (short commit id when detached); pushed on change. */
  | { t: 'branch'; branch: string | null }
  | { t: 'wt.list'; repo: string | null; worktrees: PtyWorktree[] }
  | { t: 'wt.added'; path: string; branch: string }
  | { t: 'wt.removed'; path: string }
  | { t: 'wt.error'; code: WorktreeError; detail?: string }

export type WorktreeError = 'noGit' | 'notRepo' | 'branch' | 'exists' | 'dirty' | 'main' | 'busy' | 'unknown' | 'git'

export interface PtyWorktree {
  path: string
  /** Branch name without refs/heads/; absent when detached. */
  branch?: string
  head: string
  main: boolean
  locked: boolean
  prunable: boolean
}

/** What the Electron preload hands the page; null outside the desktop app. */
export interface PtyEndpoint {
  url: string
  protocol: string
}

export interface PtySessionInfo {
  id: string
  preset: PtyPreset
  cwd: string
  pid: number
  alive: boolean
}
