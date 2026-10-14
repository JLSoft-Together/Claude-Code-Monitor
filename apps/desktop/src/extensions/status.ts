import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { ExtPrereq, ExtScope } from '@ccm/shared'
import { findOnPath } from '../../../collector/src/win-exe'

/** Claude Code's global config: `$CLAUDE_CONFIG_DIR/.claude.json`, else `~/.claude.json`. */
export function claudeJsonFile(env: NodeJS.ProcessEnv, home: string): string {
  return env.CLAUDE_CONFIG_DIR ? path.join(env.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(home, '.claude.json')
}

export function claudeRoot(env: NodeJS.ProcessEnv, home: string): string {
  return env.CLAUDE_CONFIG_DIR || path.join(home, '.claude')
}

/** `.claude.json` keys projects by path with `/` separators; compare loosely (case-insensitive on Windows). */
export function sameDir(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  const norm = (p: string): string => {
    const s = p.replace(/\\/g, '/').replace(/\/+$/, '')
    return platform === 'win32' ? s.toLowerCase() : s
  }
  return norm(a) === norm(b)
}

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown
  } catch {
    return null
  }
}

const serverNames = (v: unknown): string[] => {
  const servers = (v as { mcpServers?: unknown } | null)?.mcpServers
  return servers && typeof servers === 'object' && !Array.isArray(servers) ? Object.keys(servers) : []
}

/** Names (never values) of the MCP servers configured in each scope for `dir`. */
export function readConfigured(claudeJson: string, dir: string | null, platform: NodeJS.Platform = process.platform): { name: string; scopes: ExtScope[] }[] {
  const scopes = new Map<string, ExtScope[]>()
  const add = (name: string, scope: ExtScope): void => {
    const list = scopes.get(name) ?? []
    if (!list.includes(scope)) list.push(scope)
    scopes.set(name, list)
  }
  const global = readJson(claudeJson)
  for (const name of serverNames(global)) add(name, 'user')
  if (dir) {
    const projects = (global as { projects?: unknown } | null)?.projects
    if (projects && typeof projects === 'object') {
      for (const [key, value] of Object.entries(projects)) if (sameDir(key, dir, platform)) for (const name of serverNames(value)) add(name, 'local')
    }
    for (const name of serverNames(readJson(path.join(dir, '.mcp.json')))) add(name, 'project')
  }
  return [...scopes].map(([name, s]) => ({ name, scopes: s }))
}

export function listSkills(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
      .map((d) => d.name)
      .sort()
      .slice(0, 200)
  } catch {
    return []
  }
}

const PREREQ_FILES: Record<ExtPrereq, { win: string; posix: string }> = {
  node: { win: 'npx.cmd', posix: 'npx' },
  uv: { win: 'uvx.exe', posix: 'uvx' },
  docker: { win: 'docker.exe', posix: 'docker' },
}

export function probePrereqs(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): Record<ExtPrereq, boolean> {
  // uv installs into ~/.local/bin, which a GUI app's PATH often lacks.
  const extra = [path.join(home, '.local', 'bin'), path.join(home, '.cargo', 'bin')]
  const out = {} as Record<ExtPrereq, boolean>
  for (const [key, file] of Object.entries(PREREQ_FILES) as [ExtPrereq, { win: string; posix: string }][]) {
    out[key] = findOnPath(platform === 'win32' ? file.win : file.posix, env, extra) !== null
  }
  return out
}
