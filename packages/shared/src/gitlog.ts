// v30 Git Log (desktop IPC only, no WS events). Raw rows from git; the page lays out the graph.
export const LOG_PAGE = 500

export type LogError = 'denied' | 'no-git' | 'not-repo' | 'failed' | 'missing'

/** `ref` = full refname (`refs/heads/main`), `name` = short (`main`, `origin/main`, `v1.0`). */
export interface LogRef {
  ref: string
  name: string
  hash: string
}

export interface LocalRef extends LogRef {
  upstream: string | null
  ahead: number
  behind: number
  /** Upstream branch was deleted on the remote. */
  gone: boolean
}

export interface RemoteGroup {
  name: string
  refs: LogRef[]
}

export type RefsResult =
  | { ok: true; root: string; head: { branch: string | null; hash: string | null }; local: LocalRef[]; remotes: RemoteGroup[]; tags: LogRef[]; me: string | null }
  | { ok: false; error: LogError }

export interface LogCommit {
  hash: string
  parents: string[]
  author: string
  email: string
  /** Author time, epoch seconds. */
  time: number
  /** Raw `%D` decorations: `HEAD -> main, origin/main, tag: v1`. */
  refs: string
  subject: string
}

export interface LogQuery {
  /** Full refname or `HEAD`; null = every branch, remote and tag. */
  branch: string | null
  /** With `branch`: hide commits reachable from this ref (`git log <branch> --not <notRef>`). */
  notRef: string | null
  author: string | null
  since: number | null
  until: number | null
  text: string | null
  regex: boolean
  matchCase: boolean
  /** Repo-relative, `/` separators. */
  paths: string[]
  skip: number
}

export type LogPageResult =
  // `injected`: leading rows that git paging did not return (a commit found by hash); the next `skip` must not count them.
  | { ok: true; commits: LogCommit[]; more: boolean; injected?: number }
  | { ok: false; error: LogError }

export type CommitFileKind = 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'typechange'

export interface CommitFile {
  path: string
  origPath?: string
  kind: CommitFileKind
  added?: number
  removed?: number
  binary?: boolean
}

export type CommitDetail =
  | {
      ok: true
      hash: string
      parents: string[]
      author: string
      email: string
      authorTime: number
      committer: string
      committerEmail: string
      commitTime: number
      message: string
      /** Compared with the first parent (empty tree for a root commit). */
      files: CommitFile[]
      truncated: boolean
    }
  | { ok: false; error: LogError }

export type ContainsResult = { ok: true; branches: string[] } | { ok: false; error: LogError }

export const isHash = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{4,40}$/i.test(v)
