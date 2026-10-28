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
  | { t: 'spawn'; preset: PtyPreset; cols: number; rows: number; cwd?: string; resume?: string; open?: string }
  | { t: 'attach'; id: string }
  | { t: 'resize'; cols: number; rows: number }
  /** Folder the attached shell reported (OSC 7 / 9;9) after a `cd`; answered with `cwd` once validated. */
  | { t: 'cwd'; cwd: string }
  /** Without id: the attached session. With id: any session (closing a pane whose socket already dropped). */
  | { t: 'kill'; id?: string }
  /** Which of these process ids run inside a CCM terminal (any depth), answered with `owners`. */
  | { t: 'owners'; pids: number[] }
  /** Git worktrees of the repo holding cwd. */
  | { t: 'wt.list'; cwd: string }
  /** New worktree in `<repo>-wt/<branch>`; an existing branch is checked out, otherwise created from cwd's HEAD. */
  // `copy`: patterns of untracked setup files (.env files, google-services.json) copied from the main checkout.
  | { t: 'wt.add'; cwd: string; branch: string; copy?: string[] }
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
  /** Validated (real, existing) shell folder; null = the reported one was refused. Re-sent on attach. */
  | { t: 'cwd'; cwd: string | null }
  | { t: 'wt.list'; repo: string | null; worktrees: PtyWorktree[] }
  | { t: 'wt.added'; path: string; branch: string; copied?: string[] }
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

export interface PaneOpenRequest {
  id: string
  from?: string
  preset: PtyPreset
  cwd: string
  prompt?: string
  resume?: string
}

export type PaneOpenError = 'unavailable' | 'limit' | 'cwd' | 'preset' | 'rate' | 'failed' | 'resume' | 'live'

export type PaneOpenResult = { ok: true; paneKey: string } | { ok: false; error: PaneOpenError }

export const PANE_OPEN_PROMPT_MAX = 8000

export const cleanPanePrompt = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined
  const text = v.replace(/\r\n?/g, '\n').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '').trim()
  return text ? text.slice(0, PANE_OPEN_PROMPT_MAX) : undefined
}

export interface PtySessionInfo {
  id: string
  preset: PtyPreset
  cwd: string
  /** Shell's current folder after `cd`, when the shell reported one. */
  liveCwd?: string
  pid: number
  alive: boolean
}
