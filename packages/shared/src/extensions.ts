// Extensions tab (v28): a curated catalog of MCP servers and plugins the desktop app installs into Claude Code
// through the `claude` CLI. The page only ever sends a catalog id + field values; desktop main builds the argv.

/** `user` = every project (global); `project` = shared via the repo (`.mcp.json` / `.claude/settings.json`); `local` = this project, only me. */
export type ExtScope = 'user' | 'project' | 'local'
export const EXT_SCOPES: readonly ExtScope[] = ['user', 'project', 'local']
export const isExtScope = (v: unknown): v is ExtScope => v === 'user' || v === 'project' || v === 'local'

export type ExtPrereq = 'node' | 'uv' | 'docker'
export const EXT_PREREQS: readonly ExtPrereq[] = ['node', 'uv', 'docker']

export interface ExtField {
  /** Env var / template key, also the i18n key suffix. */
  key: string
  secret: boolean
  required: boolean
  /** Anchored regex source the value must match. */
  pattern: string
  default?: string
}

export type ExtInstall =
  /** `url` and the header value may hold `{FIELD}` placeholders. */
  | { type: 'http'; url: string; oauth: boolean; header?: { name: string; value: string } }
  /** `env` lists field keys passed as env vars (empty optional values are left out). */
  | { type: 'stdio'; command: string; args: string[]; env: string[]; winShim?: boolean }
  /** Plugins from one marketplace; `repo` = GitHub `owner/repo` added first when the marketplace is missing. */
  | { type: 'plugins'; marketplace: string; repo?: string; plugins: string[] }
  /** Configured outside Claude Code (e.g. from the Unity editor); the tab shows steps + status only. */
  | { type: 'guide' }

export interface CatalogEntry {
  id: string
  kind: 'mcp' | 'plugin'
  name: string
  vendor: string
  docs: string
  /** MCP server name written to the config (and matched in `claude mcp list`). */
  server?: string
  /** Other server names that count as this entry (configured by another tool, or a plugin's `plugin:<p>:<s>`). */
  match?: string[]
  fields: ExtField[]
  prereqs: ExtPrereq[]
  install: ExtInstall
  /** Number of manual setup steps (i18n `ext.guide.<id>.<n>`), shown in the install sheet. */
  steps?: number
}

const TOKEN = '^[A-Za-z0-9_.\\-]{8,512}$'

export const PM_SKILLS = [
  'pm-product-discovery',
  'pm-product-strategy',
  'pm-execution',
  'pm-market-research',
  'pm-data-analytics',
  'pm-go-to-market',
  'pm-marketing-growth',
  'pm-toolkit',
  'pm-ai-shipping',
]

export const CATALOG: readonly CatalogEntry[] = [
  {
    id: 'figma',
    kind: 'mcp',
    name: 'Figma',
    vendor: 'Figma',
    docs: 'https://developers.figma.com/docs/figma-mcp-server/remote-server-installation/',
    server: 'figma',
    match: ['plugin:figma:figma', 'figma-desktop'],
    fields: [],
    prereqs: [],
    install: { type: 'http', url: 'https://mcp.figma.com/mcp', oauth: true },
  },
  {
    id: 'meshy',
    kind: 'mcp',
    name: 'Meshy AI',
    vendor: 'Meshy',
    docs: 'https://docs.meshy.ai/api/ai',
    server: 'meshy',
    match: ['meshy-ai'],
    fields: [{ key: 'MESHY_API_KEY', secret: true, required: true, pattern: TOKEN }],
    prereqs: ['node'],
    install: { type: 'stdio', command: 'npx', args: ['-y', '@meshy-ai/meshy-mcp-server'], env: ['MESHY_API_KEY'], winShim: true },
  },
  {
    id: 'unity',
    kind: 'mcp',
    name: 'Unity',
    vendor: 'CoplayDev (MCP for Unity)',
    docs: 'https://github.com/CoplayDev/unity-mcp',
    match: ['unityMCP', 'UnityMCP', 'unity-mcp', 'mcp-for-unity', 'unity'],
    fields: [],
    prereqs: ['uv'],
    install: { type: 'guide' },
    steps: 3,
  },
  {
    id: 'blender',
    kind: 'mcp',
    name: 'Blender',
    vendor: 'ahujasid/blender-mcp',
    docs: 'https://github.com/ahujasid/blender-mcp',
    server: 'blender',
    match: ['blender-mcp'],
    fields: [],
    prereqs: ['uv'],
    install: { type: 'stdio', command: 'uvx', args: ['mcp-for-blender'], env: [] },
    steps: 2,
  },
  {
    id: 'github',
    kind: 'mcp',
    name: 'GitHub',
    vendor: 'GitHub',
    docs: 'https://github.com/github/github-mcp-server/blob/main/docs/installation-guides/install-claude.md',
    server: 'github',
    match: ['plugin:github:github'],
    fields: [{ key: 'GITHUB_PAT', secret: true, required: true, pattern: TOKEN }],
    prereqs: [],
    install: { type: 'http', url: 'https://api.githubcopilot.com/mcp/', oauth: false, header: { name: 'Authorization', value: 'Bearer {GITHUB_PAT}' } },
  },
  {
    id: 'gitlab',
    kind: 'mcp',
    name: 'GitLab',
    vendor: 'GitLab',
    docs: 'https://docs.gitlab.com/user/model_context_protocol/mcp_server/',
    server: 'gitlab',
    match: ['GitLab', 'plugin:gitlab:gitlab'],
    fields: [{ key: 'GITLAB_HOST', secret: false, required: true, pattern: '^[A-Za-z0-9.-]{1,253}(:[0-9]{1,5})?$', default: 'gitlab.com' }],
    prereqs: [],
    install: { type: 'http', url: 'https://{GITLAB_HOST}/api/v4/mcp', oauth: true },
  },
  {
    id: 'discord',
    kind: 'mcp',
    name: 'Discord',
    vendor: 'SaseQ/discord-mcp',
    docs: 'https://github.com/SaseQ/discord-mcp',
    server: 'discord',
    match: ['discord-mcp'],
    fields: [
      { key: 'DISCORD_TOKEN', secret: true, required: true, pattern: TOKEN },
      { key: 'DISCORD_GUILD_ID', secret: false, required: false, pattern: '^[0-9]{5,25}$' },
    ],
    prereqs: ['docker'],
    install: {
      type: 'stdio',
      command: 'docker',
      args: ['run', '--rm', '-i', '-e', 'DISCORD_TOKEN', '-e', 'DISCORD_GUILD_ID', 'saseq/discord-mcp:latest'],
      env: ['DISCORD_TOKEN', 'DISCORD_GUILD_ID'],
    },
  },
  {
    id: 'pm-skills',
    kind: 'plugin',
    name: 'PM Skills',
    vendor: 'phuryn',
    docs: 'https://github.com/phuryn/pm-skills',
    fields: [],
    prereqs: [],
    install: { type: 'plugins', marketplace: 'pm-skills', repo: 'phuryn/pm-skills', plugins: PM_SKILLS },
  },
  {
    id: 'ui-ux-pro-max',
    kind: 'plugin',
    name: 'UI/UX Pro Max',
    vendor: 'nextlevelbuilder',
    docs: 'https://github.com/nextlevelbuilder/ui-ux-pro-max-skill',
    fields: [],
    prereqs: [],
    install: { type: 'plugins', marketplace: 'ui-ux-pro-max-skill', repo: 'nextlevelbuilder/ui-ux-pro-max-skill', plugins: ['ui-ux-pro-max'] },
  },
  {
    id: 'frontend-design',
    kind: 'plugin',
    name: 'Frontend Design',
    vendor: 'Anthropic',
    docs: 'https://github.com/anthropics/claude-code/tree/main/plugins/frontend-design',
    fields: [],
    prereqs: [],
    install: { type: 'plugins', marketplace: 'claude-plugins-official', repo: 'anthropics/claude-plugins-official', plugins: ['frontend-design'] },
  },
  {
    id: 'unity-plugin',
    kind: 'plugin',
    name: 'Unity Agent',
    vendor: 'Unity Technologies',
    docs: 'https://github.com/Unity-Technologies/unity-agent-plugin',
    fields: [],
    prereqs: [],
    install: { type: 'plugins', marketplace: 'claude-plugins-official', repo: 'anthropics/claude-plugins-official', plugins: ['unity'] },
  },
]

export const catalogEntry = (id: unknown): CatalogEntry | undefined => CATALOG.find((e) => e.id === id)

export const MARKETPLACE_REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/
export const MCP_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/
export const PLUGIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

/** Field values the entry accepts: required present, every value matches its pattern; unknown keys rejected. */
export function checkFields(entry: CatalogEntry, values: Record<string, string>): string | null {
  for (const key of Object.keys(values)) if (!entry.fields.some((f) => f.key === key)) return key
  for (const f of entry.fields) {
    const v = (values[f.key] ?? '').trim()
    if (!v) {
      if (f.required && !f.default) return f.key
      continue
    }
    if (!new RegExp(f.pattern).test(v)) return f.key
  }
  return null
}

// --- status ---

export type McpState = 'connected' | 'needsAuth' | 'failed' | 'pending' | 'unknown'

export interface McpServerRow {
  name: string
  state: McpState
  /** Scopes whose config holds this name (empty for plugin servers and claude.ai connectors). */
  scopes: ExtScope[]
  /** `plugin:<plugin>:<server>` → plugin name. */
  plugin?: string
  connector?: boolean
}

export interface PluginRow {
  id: string
  scope: ExtScope
  enabled: boolean
}

export interface ExtStatus {
  cli: boolean
  dir: string | null
  prereqs: Record<ExtPrereq, boolean>
  plugins: PluginRow[]
  marketplaces: string[]
  /** Configured servers read from the config files (names + scope only), fast, before health checks. */
  configured: { name: string; scopes: ExtScope[] }[]
  skills: { user: string[]; project: string[] }
}

export interface AvailablePlugin {
  id: string
  name: string
  marketplace: string
  description: string
}

export type ExtErrorCode = 'noCli' | 'busy' | 'cancelled' | 'badInput' | 'needsTerminal' | 'failed' | 'timeout'
export type ExtResult = { ok: true; detail?: string } | { ok: false; code: ExtErrorCode; detail?: string }

export interface ExtInstallRequest {
  id: string
  values: Record<string, string>
  scope: ExtScope
  dir?: string
  /** Subset of a `plugins` entry; all when omitted. */
  plugins?: string[]
}

/** Plugins may be removed several at once (one consent). */
export type ExtRemoveRequest = { kind: 'mcp' | 'plugin'; name: string | string[]; scope: ExtScope; dir?: string }

export type ExtSourceRequest =
  | { type: 'marketplace'; repo: string }
  | { type: 'mcp'; name: string; url: string; header?: string; scope: ExtScope; dir?: string }
  | { type: 'plugin'; ids: string[]; scope: ExtScope; dir?: string }

/** Parses one line of `claude mcp list` (`name: target - ✔ Connected`); null for headers / noise. */
export function parseMcpLine(line: string): Omit<McpServerRow, 'scopes'> | null {
  // Split at the first " - " that starts a status (commands and error details may hold " - " too).
  const m = /^(.+?): .*? - ([✔✓✗✘⚠⏸].*|(?:Connected|Failed|Needs|Pending).*)$/u.exec(line.trim())
  if (!m) return null
  const name = m[1]!.trim()
  // Judge by the head of the status ("✘ Failed to connect — … Authorization header …" is a failure, not a sign-in).
  const head = m[2]!.slice(0, 40)
  const state: McpState = /^\W*connected/i.test(head)
    ? 'connected'
    : /^\W*fail|[✗✘]/i.test(head)
      ? 'failed'
      : /needs? auth/i.test(head)
        ? 'needsAuth'
        : /pending|approval/i.test(head)
          ? 'pending'
          : /fail|error/i.test(head)
            ? 'failed'
            : 'unknown'
  const plugin = /^plugin:([^:]+):/.exec(name)?.[1]
  return { name, state, ...(plugin ? { plugin } : {}), ...(name.startsWith('claude.ai ') ? { connector: true } : {}) }
}
