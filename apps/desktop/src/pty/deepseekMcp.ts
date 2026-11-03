import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const USER_FILE_MAX = 1024 * 1024

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Codewhale reads DEEPSEEK_MCP_CONFIG instead of the user's own mcp.json, so the pane's file carries the user's
 * servers too. Codewhale needs a literal url (no env expansion); the bearer comes from the env var it names.
 */
export function mergeDeepseekMcp(userRaw: string | null, port: number): string {
  let user: Record<string, unknown> = {}
  try {
    const parsed: unknown = userRaw ? JSON.parse(userRaw) : null
    if (isObj(parsed)) user = parsed
  } catch {
    // unreadable user file: only orrery
  }
  const { servers, mcpServers, ...rest } = user
  return JSON.stringify({
    ...rest,
    servers: {
      ...(isObj(mcpServers) ? mcpServers : {}),
      ...(isObj(servers) ? servers : {}),
      orrery: { url: `http://127.0.0.1:${port}/mcp`, bearer_token_env_var: 'ORRERY_TOKEN' },
    },
  })
}

/** The file Codewhale would read without our override: an inherited DEEPSEEK_MCP_CONFIG, else ~/.codewhale, else legacy ~/.deepseek. */
export function userDeepseekMcpFiles(env: NodeJS.ProcessEnv, home: string, own: string): string[] {
  const inherited = env.DEEPSEEK_MCP_CONFIG
  const first = inherited && path.isAbsolute(inherited) && path.resolve(inherited) !== path.resolve(own) ? [inherited] : []
  return [...first, path.join(home, '.codewhale', 'mcp.json'), path.join(home, '.deepseek', 'mcp.json')]
}

function readUser(files: readonly string[]): string | null {
  for (const file of files) {
    try {
      if (/^[\\/]{2}/.test(file) || statSync(file).size > USER_FILE_MAX) continue
      return readFileSync(file, 'utf8')
    } catch {
      // absent: try the next one
    }
  }
  return null
}

const written = new Set<string>()

/** Rewritten at every DeepSeek spawn so the pane sees the user's latest servers; tmp + rename so a starting pane never reads half a file. */
export function writeDeepseekMcpConfig(file: string, port: number, env: NodeJS.ProcessEnv, home: string): boolean {
  if (!file || !path.isAbsolute(file) || !port) return false
  const tmp = `${file}.${process.pid}.tmp`
  try {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(tmp, mergeDeepseekMcp(readUser(userDeepseekMcpFiles(env, home, file)), port), { mode: 0o600 })
    renameSync(tmp, file)
    written.add(`${port}|${file}`)
    return true
  } catch (err) {
    console.error('deepseek mcp config write failed:', err)
    try {
      rmSync(tmp, { force: true })
    } catch {
      // left for the next write to replace
    }
    // Windows refuses the rename while another pane's codewhale reads the file; one this process wrote for the same port still works.
    return written.has(`${port}|${file}`) && existsSync(file)
  }
}
