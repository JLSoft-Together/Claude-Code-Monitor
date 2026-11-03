import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { BLOCK_BEGIN, BLOCK_END, CLAUDE_RULES_HEADING, DELEGATE_SKILL, HANDOFF_SKILL, TEMPLATES_VERSION, WORKFLOW_BLOCK } from './templates'

/** Replaces the `<!-- orrery:begin/end -->` block (markers included) or appends it; text outside stays as written. */
export function mergeManagedBlock(existing: string | null, block: string): string {
  const wrapped = `${BLOCK_BEGIN}\n${block.trim()}\n${BLOCK_END}`
  if (existing === null || existing.trim() === '') return `${wrapped}\n`
  const begin = existing.indexOf(BLOCK_BEGIN)
  const end = begin >= 0 ? existing.indexOf(BLOCK_END, begin) : -1
  if (begin >= 0 && end > begin) return existing.slice(0, begin) + wrapped + existing.slice(end + BLOCK_END.length)
  return `${existing.replace(/\s+$/, '')}\n\n${wrapped}\n`
}

const IMPORT_LINE = /^\s*@(\S+\.md)\s*$/i

/**
 * Whole-line `@file.md` imports replaced by the file's text, one level; outside ``` fences only.
 * `read` returns null for a missing or disallowed file, and that line is dropped.
 */
export function inlineImports(text: string, read: (ref: string) => string | null): string {
  let fence = false
  const out: string[] = []
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    const m = fence ? null : IMPORT_LINE.exec(line)
    if (!m) {
      out.push(line)
      continue
    }
    const body = read(m[1]!)
    if (body !== null) out.push(body.replace(/\s+$/, ''))
  }
  return out.join('\n')
}

/** Path of an import, only when it stays inside `root` (relative to it, or `~/…` from home). */
export function importPath(ref: string, root: string, home: string): string | null {
  const abs = ref.startsWith('~/') ? path.join(home, ref.slice(2)) : path.isAbsolute(ref) ? ref : path.join(root, ref)
  const rel = path.relative(root, path.resolve(abs))
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? path.resolve(abs) : null
}

/**
 * Top-level `key = ["value", …]` in TOML text: an existing line before the first table is kept when it already
 * lists `value`, gets `value` appended when it is a one-line array, else is replaced; a missing key goes right
 * before the first `[table]`. Everything else is left byte for byte.
 */
export function upsertTomlArrayValue(text: string | null, key: string, value: string): { text: string; changed: boolean } {
  const literal = JSON.stringify(value)
  const fresh = `${key} = [${literal}]`
  if (text === null || text.trim() === '') return { text: `${fresh}\n`, changed: true }
  const nl = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const firstTable = lines.findIndex((l) => /^\s*\[/.test(l))
  const top = firstTable < 0 ? lines.length : firstTable
  const keyRe = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`)
  const at = lines.slice(0, top).findIndex((l) => keyRe.test(l))
  if (at >= 0) {
    const line = lines[at]!
    const rhs = line.slice(line.indexOf('=') + 1).replace(/\s+#.*$/, '').trim()
    if (rhs.includes(literal) || rhs.includes(`'${value}'`)) return { text, changed: false }
    let span = 1
    if (rhs.startsWith('[') && !rhs.includes(']')) {
      while (at + span < lines.length && !lines[at + span - 1]!.includes(']')) span++
    }
    const oneLine = span === 1 && /^\[.*\]$/.test(rhs)
    const inner = oneLine ? rhs.slice(1, -1).trim().replace(/,\s*$/, '') : ''
    const next = oneLine && inner ? `${key} = [${inner}, ${literal}]` : fresh
    lines.splice(at, span, next)
    return { text: lines.join(nl), changed: true }
  }
  if (firstTable < 0) return { text: `${text.replace(/\s+$/, '')}${nl}${fresh}${nl}`, changed: true }
  lines.splice(firstTable, 0, fresh, '')
  return { text: lines.join(nl), changed: true }
}

export const OUTBOX_PATH = '~/.codewhale/notifications/outbox.jsonl'

/**
 * Sets `[lifecycle_outbox] path` when the file has none (Codewhale 0.10.2 writes no outbox without it, see
 * docs/deepseek-integration.md); a path the user set, in the table or as dotted `lifecycle_outbox.path`, is kept.
 * The key goes right under an existing table header, else a new table is appended.
 */
export function ensureOutboxPath(text: string | null, value = OUTBOX_PATH): { text: string; changed: boolean } {
  const entry = `path = ${JSON.stringify(value)}`
  if (text === null || text.trim() === '') return { text: `[lifecycle_outbox]\n${entry}\n`, changed: true }
  const nl = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  let table = ''
  let header = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim()
    const h = /^\[\s*([^\]]+?)\s*\]\s*(#.*)?$/.exec(line)
    if (h) {
      table = h[1]!.replace(/\s+/g, '')
      if (table === 'lifecycle_outbox') header = i
      continue
    }
    const key = /^([A-Za-z0-9_."-]+?)\s*=/.exec(line)?.[1]?.replace(/"/g, '')
    if (key && (table ? `${table}.${key}` : key) === 'lifecycle_outbox.path') return { text, changed: false }
  }
  if (header >= 0) {
    lines.splice(header + 1, 0, entry)
    return { text: lines.join(nl), changed: true }
  }
  return { text: `${text.replace(/\s+$/, '')}${nl}${nl}[lifecycle_outbox]${nl}${entry}${nl}`, changed: true }
}
const SERVER_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

const strRecord = (v: unknown): Record<string, string> | undefined => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const out: Record<string, string> = {}
  for (const [k, x] of Object.entries(v)) if (typeof x === 'string') out[k] = x
  return Object.keys(out).length ? out : undefined
}

/** A Claude `mcpServers` entry in Codewhale's shape; null when neither a command nor a URL. */
export function toCodewhaleServer(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const s = raw as Record<string, unknown>
  if ((s.type === 'http' || s.type === 'sse' || typeof s.url === 'string') && typeof s.url === 'string' && /^https?:\/\//i.test(s.url)) {
    const headers = strRecord(s.headers)
    return { url: s.url, ...(headers ? { headers } : {}) }
  }
  if (typeof s.command === 'string' && s.command.trim()) {
    const args = Array.isArray(s.args) ? s.args.filter((a): a is string => typeof a === 'string') : []
    const env = strRecord(s.env)
    return { command: s.command, ...(args.length ? { args } : {}), ...(env ? { env } : {}) }
  }
  return null
}

export type McpMerge = { text: string; added: string[] } | { error: 'unreadable' }

/** Adds Claude user-scope servers missing by name; never overwrites one, never adds `orrery` (injected per pane). */
export function mergeMcp(existing: string | null, claudeServers: unknown): McpMerge {
  let doc: Record<string, unknown> = {}
  if (existing !== null && existing.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(existing)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { error: 'unreadable' }
      doc = parsed as Record<string, unknown>
    } catch {
      return { error: 'unreadable' }
    }
  }
  const asMap = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
  const key = asMap(doc.servers) || !asMap(doc.mcpServers) ? 'servers' : 'mcpServers'
  const target = { ...(asMap(doc[key]) ?? {}) }
  const known = new Set([...Object.keys(asMap(doc.servers) ?? {}), ...Object.keys(asMap(doc.mcpServers) ?? {})].map((n) => n.toLowerCase()))
  const added: string[] = []
  for (const [name, raw] of Object.entries(asMap(claudeServers) ?? {})) {
    if (!SERVER_NAME.test(name) || name.toLowerCase() === 'orrery' || known.has(name.toLowerCase())) continue
    const server = toCodewhaleServer(raw)
    if (!server) continue
    target[name] = server
    known.add(name.toLowerCase())
    added.push(name)
  }
  if (!added.length) return { text: existing ?? '', added }
  return { text: `${JSON.stringify({ ...doc, [key]: target }, null, 2)}\n`, added }
}

/** Frontmatter carries `orrery-managed: true` (under `metadata` or as `x-orrery-managed`). */
export function isManagedSkill(text: string): boolean {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1]
  return !!fm && /^\s*(x-)?orrery-managed:\s*["']?true["']?\s*$/m.test(fm)
}

export function agentsBlock(claudeRules: string | null): string {
  const rules = claudeRules?.trim()
  return rules ? `${WORKFLOW_BLOCK}\n\n${CLAUDE_RULES_HEADING}\n\n${rules}` : WORKFLOW_BLOCK
}

export interface SyncPaths {
  home: string
  codewhaleHome: string
  claudeRoot: string
  claudeJson: string
  codexHome: string
}

export type FileAction = 'create' | 'update' | 'unchanged' | 'skip'

export interface PlannedFile {
  id: 'agents' | 'config' | 'mcp' | 'skill-handoff' | 'skill-delegate-claude' | 'skill-delegate-codex'
  file: string
  action: FileAction
  /** skip: why the file is left alone. */
  reason?: 'notManaged' | 'unreadable' | 'nothingToAdd'
  content?: string
  private?: boolean
}

export interface SyncPlan {
  files: PlannedFile[]
  mcpAdded: string[]
  /** config.toml gains `[lifecycle_outbox] path` (session status for the Monitor). */
  outboxAdded: boolean
  fingerprint: string
}

const readText = async (file: string): Promise<string | null> => {
  try {
    return await fs.readFile(file, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw e
  }
}

const actionFor = (old: string | null, next: string): FileAction => (old === null ? 'create' : old === next ? 'unchanged' : 'update')

/** `~/.claude/CLAUDE.md` with its imports inlined; null when there is none. */
export async function readClaudeRules(p: SyncPaths): Promise<string | null> {
  const claudeMd = await readText(path.join(p.claudeRoot, 'CLAUDE.md')).catch(() => null)
  if (claudeMd === null) return null
  const imports = new Map<string, string | null>()
  for (const line of claudeMd.split(/\r?\n/)) {
    const ref = IMPORT_LINE.exec(line)?.[1]
    if (!ref || imports.has(ref)) continue
    const file = importPath(ref, p.claudeRoot, p.home)
    imports.set(ref, file ? await readText(file).catch(() => null) : null)
  }
  return inlineImports(claudeMd, (ref) => imports.get(ref) ?? null)
}

export async function readClaudeServers(p: SyncPaths): Promise<Record<string, unknown> | null> {
  try {
    const cj: unknown = JSON.parse((await readText(p.claudeJson)) ?? 'null')
    const servers = cj && typeof cj === 'object' ? (cj as { mcpServers?: unknown }).mcpServers : null
    return servers && typeof servers === 'object' && !Array.isArray(servers) ? (servers as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** What a sync depends on: the Claude rules text, Claude's MCP server names and the template version. */
export function syncFingerprint(rules: string | null, serverNames: readonly string[], version = TEMPLATES_VERSION): string {
  const names = [...serverNames].sort().join('\n')
  return createHash('sha256').update(`v${version}\0${rules ?? ''}\0${names}`).digest('hex')
}

export async function currentFingerprint(p: SyncPaths): Promise<string> {
  const [rules, servers] = await Promise.all([readClaudeRules(p), readClaudeServers(p)])
  return syncFingerprint(rules, Object.keys(servers ?? {}))
}

export type SyncState = 'never' | 'current' | 'stale'

export interface SyncRecord {
  at: number
  hash: string
}

export async function readSyncRecord(file: string): Promise<SyncRecord | null> {
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<SyncRecord>
    return typeof raw.at === 'number' && typeof raw.hash === 'string' ? { at: raw.at, hash: raw.hash } : null
  } catch {
    return null
  }
}

export function syncState(record: SyncRecord | null, hash: string): SyncState {
  return !record ? 'never' : record.hash === hash ? 'current' : 'stale'
}

/** Reads everything and decides each file's fate; writes nothing. */
export async function planSync(p: SyncPaths): Promise<SyncPlan> {
  const files: PlannedFile[] = []
  const [rules, claudeServers] = await Promise.all([readClaudeRules(p), readClaudeServers(p)])
  const agentsFile = path.join(p.codewhaleHome, 'AGENTS.md')
  const agentsOld = await readText(agentsFile)
  const agentsNew = mergeManagedBlock(agentsOld, agentsBlock(rules))
  files.push({ id: 'agents', file: agentsFile, action: actionFor(agentsOld, agentsNew), content: agentsNew })

  const configFile = path.join(p.codewhaleHome, 'config.toml')
  const configOld = await readText(configFile)
  const imports = upsertTomlArrayValue(configOld, 'project_instruction_imports', 'claude')
  const toml = ensureOutboxPath(imports.text)
  const configChanged = imports.changed || toml.changed
  files.push({ id: 'config', file: configFile, action: configChanged ? (configOld === null ? 'create' : 'update') : 'unchanged', content: toml.text })

  const mcpFile = path.join(p.codewhaleHome, 'mcp.json')
  const mcpOld = await readText(mcpFile)
  const mcp = mergeMcp(mcpOld, claudeServers)
  let mcpAdded: string[] = []
  if ('error' in mcp) files.push({ id: 'mcp', file: mcpFile, action: 'skip', reason: 'unreadable' })
  else if (!mcp.added.length) files.push({ id: 'mcp', file: mcpFile, action: mcpOld === null ? 'skip' : 'unchanged', ...(mcpOld === null ? { reason: 'nothingToAdd' as const } : {}) })
  else {
    mcpAdded = mcp.added
    files.push({ id: 'mcp', file: mcpFile, action: mcpOld === null ? 'create' : 'update', content: mcp.text, private: true })
  }

  const skills: [PlannedFile['id'], string, string][] = [
    ['skill-handoff', path.join(p.codewhaleHome, 'skills', 'orrery-handoff', 'SKILL.md'), HANDOFF_SKILL],
    ['skill-delegate-claude', path.join(p.claudeRoot, 'skills', 'orrery-delegate', 'SKILL.md'), DELEGATE_SKILL],
    ['skill-delegate-codex', path.join(p.codexHome, 'skills', 'orrery-delegate', 'SKILL.md'), DELEGATE_SKILL],
  ]
  for (const [id, file, body] of skills) {
    const old = await readText(file)
    if (old !== null && !isManagedSkill(old)) files.push({ id, file, action: 'skip', reason: 'notManaged' })
    else files.push({ id, file, action: actionFor(old, body), content: body })
  }
  return { files, mcpAdded, outboxAdded: toml.changed, fingerprint: syncFingerprint(rules, Object.keys(claudeServers ?? {})) }
}

/** Backs an existing file up once (`<file>.orrery-backup`), then writes through a temp file + rename. */
export async function writeWithBackup(file: string, content: string, opts: { private?: boolean } = {}): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const backup = `${file}.orrery-backup`
  try {
    await fs.copyFile(file, backup, fs.constants.COPYFILE_EXCL)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code !== 'ENOENT' && code !== 'EEXIST') throw e
  }
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, content, { encoding: 'utf8', mode: opts.private ? 0o600 : 0o644 })
  try {
    await fs.rename(tmp, file)
  } catch (e) {
    await fs.rm(tmp, { force: true })
    throw e
  }
}

/** Writes the planned files, then records the fingerprint in `recordFile` (Orrery's data dir). */
export async function applySync(plan: SyncPlan, recordFile?: string, at = Date.now()): Promise<void> {
  for (const f of plan.files) {
    if ((f.action === 'create' || f.action === 'update') && f.content !== undefined) await writeWithBackup(f.file, f.content, { private: f.private })
  }
  if (recordFile) await writeAtomic(recordFile, `${JSON.stringify({ at, hash: plan.fingerprint } satisfies SyncRecord)}\n`)
}

async function writeAtomic(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, file)
}
