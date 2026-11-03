import path from 'node:path'
import type { FileEditor, McpPageResult } from '../../../../../packages/shared/src/mcpCall'
import { isInsideDir, mtimeOf, PATH_MAX, realOf, resolveInside, type InsideError } from './paths'
import { toolResult, type McpTool, type ToolDef } from './types'

export const WHO_RATE_MAX = 20
export const WHO_RATE_MS = 60_000

export const WHO_IS_EDITING_TOOL = {
  name: 'who_is_editing',
  description:
    'Before editing a file, ask which other Orrery agent sessions changed the same file in their checkout (another git worktree of this repository, or the same folder) and have not merged it yet, to avoid conflicting edits. Lists name, agent, branch, status and when they were last active. Reads git status only, never file contents.',
  inputSchema: {
    type: 'object',
    properties: { path: { type: 'string', maxLength: PATH_MAX, description: "File inside this session's project folder: absolute, or relative to the project folder." } },
    required: ['path'],
    additionalProperties: false,
  },
  annotations: { title: 'Who else is editing a file', readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
} satisfies ToolDef

const ERRORS: Record<InsideError | 'rate' | 'unavailable' | 'caller' | 'failed' | 'limit', string> = {
  path: 'path must be a file path (no UNC or device paths).',
  outside: "That file is outside this session's project folder.",
  missing: 'Neither that file nor its folder exists.',
  folder: 'That is a folder; give a file.',
  rate: 'Too many who_is_editing calls from this session in the last minute; wait a little.',
  unavailable: 'The Orrery window is not ready right now.',
  caller: 'This session is not an Orrery workspace pane the window knows.',
  limit: 'Orrery could not check the other sessions.',
  failed: 'Orrery could not check the other sessions.',
}

const AGENT = { claude: 'Claude Code', codex: 'Codex', shell: 'shell' } as const

// Names and branches come from other sessions / the owner: quoted so they read as data, not instructions.
const q = (v: string): string => JSON.stringify(v)

function line(e: FileEditor): string {
  const where = e.sameCheckout ? 'same folder as you' : `${e.branch ? `branch ${q(e.branch)}, ` : ''}${q(e.root)}`
  const when = e.modifiedAt ? `, file written ${new Date(e.modifiedAt).toISOString()}` : ''
  const active = e.lastActivityAt ? `, last active ${e.lastActivityAt}` : ''
  return `- ${q(e.name)} (${AGENT[e.agent]}${e.status ? `, ${e.status}` : ''}; ${where}${active}${when})`
}

const sameRoot = (a: string, b: string): boolean => path.relative(a, b) === ''

/**
 * The page names the other checkout's copy; its mtime is read only when the root is one of the repo's worktrees
 * as git lists them to the host, and the real file (links resolved) is inside that root with the same name.
 */
function withMtime(e: FileEditor, base: string, roots: readonly string[]): FileEditor {
  if (!path.isAbsolute(e.file) || !path.isAbsolute(e.root) || /^[\\/]{2}/.test(e.file) || /^[\\/]{2}/.test(e.root) || path.basename(e.file) !== base) return e
  const root = roots.find((r) => sameRoot(r, e.root))
  const real = root ? realOf(e.file) : null
  const realRoot = root ? realOf(root) : null
  if (!real || !realRoot || path.basename(real) !== base || !isInsideDir(real, realRoot)) return e
  const at = mtimeOf(real)
  return at ? { ...e, modifiedAt: at } : e
}

export const whoIsEditing: McpTool = {
  def: WHO_IS_EDITING_TOOL,
  async call(args, host) {
    const fail = (error: keyof typeof ERRORS) => toolResult(ERRORS[error], { ok: false, error }, true)
    if (!host.take('who', WHO_RATE_MAX, WHO_RATE_MS)) return fail('rate')
    const target = resolveInside(host.root, args.path, { allowMissing: true })
    if (!target.ok) return fail(target.error)
    let res: McpPageResult
    try {
      res = await host.page({ tool: 'who_is_editing', path: target.path })
    } catch {
      res = { ok: false, error: 'failed' }
    }
    if (!res.ok) return fail(res.error)
    if (res.tool !== 'who_is_editing') return fail('failed')
    const roots = res.editors.length ? await host.checkoutRoots().catch((): string[] => []) : []
    const editors = res.editors.map((e) => withMtime(e, path.basename(target.path), roots))
    const out = { ok: true, path: target.path, repo: res.repo, editors }
    if (!res.repo) return toolResult(`${target.path} is not in a git repository, so Orrery cannot tell which sessions changed it.`, out)
    if (!editors.length) return toolResult(`No other Orrery agent session has an unmerged change to ${target.path}.`, out)
    const shared = editors.some((e) => e.sameCheckout)
      ? '\nSessions in the same folder share one working tree: the file has uncommitted changes there, but which of them made them cannot be told.'
      : ''
    return toolResult(`Other Orrery sessions with unmerged changes to ${target.path}:\n${editors.map(line).join('\n')}${shared}`, out)
  },
}
