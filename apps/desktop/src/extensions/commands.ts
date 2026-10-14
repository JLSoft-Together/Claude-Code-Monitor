import {
  catalogEntry,
  checkFields,
  MARKETPLACE_REPO,
  MCP_NAME,
  parseMcpLine,
  PLUGIN_NAME,
  type AvailablePlugin,
  type CatalogEntry,
  type ExtInstallRequest,
  type ExtRemoveRequest,
  type ExtScope,
  type ExtSourceRequest,
  type McpServerRow,
  isExtScope,
  type PluginRow,
} from '@ccm/shared'

/** One `claude` invocation; `secrets` are masked wherever the command is shown or logged. */
export interface CliStep {
  args: string[]
  secrets: string[]
}

const fill = (template: string, entry: CatalogEntry, values: Record<string, string>): string =>
  template.replace(/\{([A-Z0-9_]+)\}/g, (_, key: string) => (values[key] ?? '').trim() || entry.fields.find((f) => f.key === key)?.default || '')

const secretsOf = (entry: CatalogEntry, values: Record<string, string>): string[] =>
  entry.fields.filter((f) => f.secret && (values[f.key] ?? '').trim()).map((f) => values[f.key]!.trim())

/** The JSON `claude mcp add-json` stores for a catalog MCP entry. */
export function mcpConfig(entry: CatalogEntry, values: Record<string, string>, platform: NodeJS.Platform): Record<string, unknown> | null {
  const inst = entry.install
  if (inst.type === 'http') {
    const out: Record<string, unknown> = { type: 'http', url: fill(inst.url, entry, values) }
    if (inst.header) out.headers = { [inst.header.name]: fill(inst.header.value, entry, values) }
    return out
  }
  if (inst.type === 'stdio') {
    const env: Record<string, string> = {}
    for (const key of inst.env) {
      const v = (values[key] ?? '').trim()
      if (v) env[key] = v
    }
    // npx is a .cmd shim on Windows: Claude Code spawns without a shell, so it needs `cmd /c`.
    const shim = platform === 'win32' && inst.winShim
    return {
      type: 'stdio',
      command: shim ? 'cmd' : inst.command,
      args: shim ? ['/c', inst.command, ...inst.args] : [...inst.args],
      ...(Object.keys(env).length ? { env } : {}),
    }
  }
  return null
}

const scopeArgs = (scope: ExtScope): string[] => ['-s', scope]

/** Steps for a catalog install, or a reason it cannot be built. */
export function buildInstall(
  req: ExtInstallRequest,
  ctx: { platform: NodeJS.Platform; marketplaces: readonly string[] },
): CliStep[] | 'badInput' {
  const entry = catalogEntry(req.id)
  if (!entry || !isExtScope(req.scope) || !req.values || typeof req.values !== 'object') return 'badInput'
  const values: Record<string, string> = {}
  for (const [k, v] of Object.entries(req.values)) {
    if (typeof v !== 'string' || v.length > 1024) return 'badInput'
    values[k] = v
  }
  if (checkFields(entry, values) !== null) return 'badInput'
  const inst = entry.install
  if (inst.type === 'plugins') {
    const wanted = req.plugins === undefined ? inst.plugins : req.plugins
    if (!Array.isArray(wanted) || !wanted.length || wanted.some((p) => !inst.plugins.includes(p))) return 'badInput'
    const steps: CliStep[] = []
    if (!ctx.marketplaces.includes(inst.marketplace)) {
      if (!inst.repo) return 'badInput'
      steps.push({ args: ['plugin', 'marketplace', 'add', inst.repo], secrets: [] })
    }
    for (const p of wanted) steps.push({ args: ['plugin', 'install', `${p}@${inst.marketplace}`, ...scopeArgs(req.scope)], secrets: [] })
    return steps
  }
  const config = mcpConfig(entry, values, ctx.platform)
  if (!config || !entry.server) return 'badInput'
  return [{ args: ['mcp', 'add-json', ...scopeArgs(req.scope), entry.server, JSON.stringify(config)], secrets: secretsOf(entry, values) }]
}

/** `name@marketplace`, neither part able to pass for a flag. */
export const isPluginId = (id: unknown): id is string => {
  if (typeof id !== 'string') return false
  const [name, market, ...rest] = id.split('@')
  return !rest.length && !!name && !!market && PLUGIN_NAME.test(name) && PLUGIN_NAME.test(market)
}

const idList = (v: unknown): string[] | null => {
  const list = Array.isArray(v) ? v : [v]
  return list.length > 0 && list.length <= 20 && list.every(isPluginId) ? [...new Set(list as string[])] : null
}

export function buildRemove(req: ExtRemoveRequest): CliStep[] | 'badInput' {
  if (!req || !isExtScope(req.scope)) return 'badInput'
  if (req.kind === 'mcp') {
    // Servers added by other tools may hold dots or spaces; never a leading dash (it would parse as a flag).
    if (typeof req.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/.test(req.name)) return 'badInput'
    return [{ args: ['mcp', 'remove', req.name, ...scopeArgs(req.scope)], secrets: [] }]
  }
  if (req.kind === 'plugin') {
    const ids = idList(req.name)
    return ids ? ids.map((id) => ({ args: ['plugin', 'uninstall', id, ...scopeArgs(req.scope)], secrets: [] })) : 'badInput'
  }
  return 'badInput'
}

/** "Add source": a GitHub marketplace, a plugin from an added marketplace, or a remote (http/https) MCP server. */
export function buildSource(req: ExtSourceRequest): CliStep[] | 'badInput' {
  if (!req || typeof req !== 'object') return 'badInput'
  if (req.type === 'marketplace') {
    return typeof req.repo === 'string' && MARKETPLACE_REPO.test(req.repo) ? [{ args: ['plugin', 'marketplace', 'add', req.repo, '--json'], secrets: [] }] : 'badInput'
  }
  if (!isExtScope(req.scope)) return 'badInput'
  if (req.type === 'plugin') {
    const ids = idList(req.ids)
    return ids ? ids.map((id) => ({ args: ['plugin', 'install', id, ...scopeArgs(req.scope)], secrets: [] })) : 'badInput'
  }
  if (req.type === 'mcp') {
    if (typeof req.name !== 'string' || !MCP_NAME.test(req.name) || typeof req.url !== 'string' || req.url.length > 2048) return 'badInput'
    let url: URL
    try {
      url = new URL(req.url)
    } catch {
      return 'badInput'
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'badInput'
    const config: Record<string, unknown> = { type: 'http', url: url.href }
    const secrets: string[] = []
    if (req.header !== undefined && req.header !== '') {
      const m = typeof req.header === 'string' ? /^([A-Za-z0-9-]{1,64}):\s*(.{1,2048})$/.exec(req.header) : null
      if (!m || /[\r\n]/.test(req.header)) return 'badInput'
      config.headers = { [m[1]!]: m[2]! }
      secrets.push(m[2]!)
    }
    return [{ args: ['mcp', 'add-json', ...scopeArgs(req.scope), req.name, JSON.stringify(config)], secrets }]
  }
  return 'badInput'
}

const quote = (arg: string): string => (/^[A-Za-z0-9_@:./=-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`)

/** `claude …` as shown in the consent dialog and logs, secrets replaced. */
export function showCommand(step: CliStep): string {
  const masked = step.args.map((a) => step.secrets.reduce((s, secret) => (secret ? s.split(secret).join('••••') : s), a))
  return ['claude', ...masked.map(quote)].join(' ')
}

/** `claude mcp list` text → rows (header and blank lines dropped). */
export function parseMcpList(text: string): Omit<McpServerRow, 'scopes'>[] {
  const out: Omit<McpServerRow, 'scopes'>[] = []
  for (const line of text.split(/\r?\n/)) {
    const row = parseMcpLine(line)
    if (row) out.push(row)
  }
  return out
}

interface RawPlugin {
  id?: unknown
  scope?: unknown
  enabled?: unknown
  projectPath?: unknown
}

/** `claude plugin list --json` → rows; project/local installs of other projects are dropped when `projectPath` says so. */
export function parsePluginList(json: string, sameDir: (p: string) => boolean): PluginRow[] {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return []
  }
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { installed?: unknown })?.installed) ? (raw as { installed: unknown[] }).installed : []
  const out: PluginRow[] = []
  for (const p of list as RawPlugin[]) {
    if (typeof p?.id !== 'string' || !isExtScope(p.scope)) continue
    if (p.scope !== 'user' && typeof p.projectPath === 'string' && !sameDir(p.projectPath)) continue
    out.push({ id: p.id, scope: p.scope, enabled: p.enabled !== false })
  }
  return out
}

export function parseMarketplaces(json: string): string[] {
  try {
    const raw = JSON.parse(json) as unknown
    return Array.isArray(raw) ? raw.flatMap((m) => (typeof (m as { name?: unknown })?.name === 'string' ? [(m as { name: string }).name] : [])) : []
  } catch {
    return []
  }
}

/** `claude plugin list --available --json` → one marketplace's plugins (capped). */
export function parseAvailable(json: string, marketplace: string, cap = 300): AvailablePlugin[] {
  try {
    const raw = JSON.parse(json) as { available?: unknown }
    const list = Array.isArray(raw?.available) ? raw.available : []
    const out: AvailablePlugin[] = []
    for (const p of list as Record<string, unknown>[]) {
      if (p?.marketplaceName !== marketplace || typeof p.pluginId !== 'string' || typeof p.name !== 'string') continue
      out.push({ id: p.pluginId, name: p.name, marketplace, description: typeof p.description === 'string' ? p.description.slice(0, 300) : '' })
      if (out.length >= cap) break
    }
    return out
  } catch {
    return []
  }
}

/** Marketplace name a GitHub repo was added as (`marketplace add` prints it; falls back to the repo name). */
export function marketplaceFromOutput(output: string, repo: string): string {
  try {
    const last = output.trim().split(/\r?\n/).pop() ?? ''
    const j = JSON.parse(last) as { name?: unknown; marketplace?: unknown }
    const name = typeof j.name === 'string' ? j.name : typeof j.marketplace === 'string' ? j.marketplace : null
    if (name && PLUGIN_NAME.test(name)) return name
  } catch {
    // human output
  }
  const m = /marketplace[:\s]+["']?([A-Za-z0-9._-]+)/i.exec(output)
  return m?.[1] ?? repo.split('/')[1]!
}
