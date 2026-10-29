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

/** v75 CLAUDE.md / memory doctor (`ccm:memory-doctor`): read-only lint, never edits a file. */
export type MemLintKind =
  | 'broken-link'
  | 'index-missing-file'
  | 'not-indexed'
  | 'frontmatter'
  | 'duplicate-name'
  | 'missing-path'
  | 'missing-import'
  | 'too-large'
  | 'index-too-long'

export interface MemFinding {
  file: string
  /** 1-based; 1 for whole-file findings. */
  line: number
  kind: MemLintKind
  /** The offending token only (link, path, field names, size), never file content around it. */
  text: string
  /** Size findings: the line / character limit `text` went over. */
  limit?: number
  /** Inside the project or the Claude config folder: the page may open it at the line. */
  openable: boolean
}

export type MemDoctorResult =
  | { ok: true; cwd: string; home: string; memoryDir: string; files: number; findings: MemFinding[]; truncated: boolean }
  | { ok: false; error: 'denied' | 'unavailable' }

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
