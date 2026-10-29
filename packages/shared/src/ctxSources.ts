export type CtxKind = 'managed' | 'user' | 'project' | 'local' | 'rules' | 'import' | 'memory-index' | 'memory' | 'skill' | 'mcp-config'

/** `start`: read into every new session; `on-demand`: read when Claude opens it; `listed`: name + description only until used. */
export type CtxLoad = 'start' | 'on-demand' | 'listed'

export interface CtxSource {
  kind: CtxKind
  load: CtxLoad
  path: string
  /** File size on disk, not tokens. */
  bytes: number
  lines?: number
  /** The file whose `@import` pulled this one in. */
  from?: string
}

export type CtxSources =
  | {
      ok: true
      cwd: string
      /** Home folder, for `~/` display. */
      home: string
      files: CtxSource[]
      /** MCP server names per scope (never their config values). */
      mcp: { name: string; scopes: string[] }[]
      plugins: string[]
      truncated: boolean
    }
  | { ok: false; error: 'denied' | 'unavailable' }
