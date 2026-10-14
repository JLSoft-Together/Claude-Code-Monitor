import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { AvailablePlugin, ExtInstallRequest, ExtRemoveRequest, ExtResult, ExtScope, ExtSourceRequest, ExtStatus, McpServerRow } from '@ccm/shared'
import { findClaudeCli, type CliRun } from '../../../collector/src/job-stop'
import { maskLog } from '../log-mask'
import { childEnv } from '../pty/presets'
import {
  buildInstall,
  buildRemove,
  buildSource,
  marketplaceFromOutput,
  parseAvailable,
  parseMarketplaces,
  parseMcpList,
  parsePluginList,
  showCommand,
  type CliStep,
} from './commands'
import { claudeJsonFile, claudeRoot, listSkills, probePrereqs, readConfigured, sameDir } from './status'

export type ExtRunner = (file: string, args: string[], opts: { cwd: string; timeout: number }) => Promise<CliRun & { timedOut?: boolean }>

export interface ConfirmPlan {
  kind: 'install' | 'remove' | 'source'
  commands: string[]
  scope: ExtScope | null
  dir: string | null
}

export interface ExtensionsDeps {
  ipcMain: IpcMain
  isAppFrame: (event: IpcMainInvokeEvent) => boolean
  /** Native consent showing the exact (masked) commands; false = cancelled. */
  confirm: (event: IpcMainInvokeEvent, plan: ConfirmPlan) => Promise<boolean>
  findCli?: () => Promise<string | null>
  run?: ExtRunner
  env?: NodeJS.ProcessEnv
  home?: string
  platform?: NodeJS.Platform
}

const LIST_TIMEOUT = 60_000
const MCP_LIST_TIMEOUT = 120_000
const MUTATE_TIMEOUT = 180_000
const LOGIN_TIMEOUT = 300_000
const MCP_TTL = 30_000

export function defaultRunner(env: NodeJS.ProcessEnv): ExtRunner {
  // The CLI runs as a plain child: no app key, no Electron/Node injection, no parent-session vars.
  const childVars = { ...childEnv(env), NO_COLOR: '1' }
  return (file, args, opts) =>
    new Promise((resolve) => {
      execFile(
        file,
        args,
        { cwd: opts.cwd, env: childVars, windowsHide: true, timeout: opts.timeout, maxBuffer: 48 * 1024 * 1024, shell: false },
        (err, stdout, stderr) => {
          const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: number | string }) | null
          const code = !e ? 0 : typeof e.code === 'number' ? e.code : null
          resolve({ code, stdout: String(stdout), stderr: String(stderr), timedOut: !!e?.killed })
        },
      )
    })
}

/** Absolute, existing folder below a filesystem root, not UNC → its real path; `undefined`/`null` → null (no project). */
export async function checkDir(dir: unknown): Promise<string | null | 'bad'> {
  if (dir === undefined || dir === null || dir === '') return null
  if (typeof dir !== 'string' || dir.length > 1024 || !path.isAbsolute(dir) || /^[\\/]{2}/.test(dir) || path.dirname(dir) === dir) return 'bad'
  try {
    const real = await fs.realpath(dir)
    if (path.dirname(real) === real || !(await fs.stat(real)).isDirectory()) return 'bad'
    return real
  } catch {
    return 'bad'
  }
}

const CHANNELS = ['ccm:ext-status', 'ccm:ext-mcp', 'ccm:ext-install', 'ccm:ext-remove', 'ccm:ext-source', 'ccm:ext-login']

export function registerExtensionsIpc(deps: ExtensionsDeps): () => void {
  const { ipcMain, isAppFrame } = deps
  const env = deps.env ?? process.env
  const home = deps.home ?? os.homedir()
  const platform = deps.platform ?? process.platform
  const findCli = deps.findCli ?? (() => findClaudeCli(env, platform))
  const run = deps.run ?? defaultRunner(env)
  const mcpCache = new Map<string, { at: number; servers: McpServerRow[] }>()
  let busy = false

  const clean = (text: string, secrets: readonly string[]): string => {
    let out = text
    for (const s of secrets) if (s) out = out.split(s).join('••••')
    out = maskLog(out, home, platform).trim()
    return out.length > 600 ? `…${out.slice(-600)}` : out
  }

  const marketplaces = async (cli: string, cwd: string): Promise<string[]> => {
    const res = await run(cli, ['plugin', 'marketplace', 'list', '--json'], { cwd, timeout: LIST_TIMEOUT })
    return res.code === 0 ? parseMarketplaces(res.stdout) : []
  }

  async function runSteps(cli: string, steps: CliStep[], cwd: string, timeout = MUTATE_TIMEOUT): Promise<ExtResult & { output?: string }> {
    let output = ''
    for (const step of steps) {
      const res = await run(cli, step.args, { cwd, timeout })
      output = `${res.stdout}\n${res.stderr}`
      if (res.code === 0) continue
      const detail = clean(output, step.secrets)
      if (res.timedOut) return { ok: false, code: 'timeout', detail }
      // A marketplace-declared install command must be confirmed by a person in a terminal (`-y` is never passed here).
      if (/shownCommand|--accept-command|requires? (?:-y|--yes)|not a TTY/i.test(output)) return { ok: false, code: 'needsTerminal', detail }
      if (step.args[1] === 'marketplace' && step.args[2] === 'add' && /already/i.test(output)) continue
      return { ok: false, code: 'failed', detail }
    }
    return { ok: true, output }
  }

  /** Common path for every change: resolve dir + cli, confirm natively, run one at a time. */
  async function mutate(
    event: IpcMainInvokeEvent,
    kind: ConfirmPlan['kind'],
    scope: ExtScope | null,
    rawDir: unknown,
    build: (cli: string, cwd: string) => Promise<CliStep[] | 'badInput'>,
  ): Promise<ExtResult & { output?: string; cwd?: string; cli?: string }> {
    if (!isAppFrame(event)) return { ok: false, code: 'badInput' }
    if (busy) return { ok: false, code: 'busy' }
    const dir = await checkDir(rawDir)
    if (dir === 'bad' || (scope !== null && scope !== 'user' && !dir)) return { ok: false, code: 'badInput' }
    busy = true
    try {
      const cli = await findCli()
      if (!cli) return { ok: false, code: 'noCli' }
      const cwd = scope !== null && scope !== 'user' && dir ? dir : home
      const steps = await build(cli, cwd)
      if (steps === 'badInput') return { ok: false, code: 'badInput' }
      if (!(await deps.confirm(event, { kind, commands: steps.map(showCommand), scope, dir: scope === 'user' ? null : dir }))) {
        return { ok: false, code: 'cancelled' }
      }
      const res = await runSteps(cli, steps, cwd)
      mcpCache.clear()
      return { ...res, cwd, cli }
    } finally {
      busy = false
    }
  }

  ipcMain.handle('ccm:ext-status', async (event, rawDir: unknown): Promise<ExtStatus | null> => {
    if (!isAppFrame(event)) return null
    const dir = await checkDir(rawDir)
    if (dir === 'bad') return null
    const cli = await findCli()
    const cwd = dir ?? home
    const [plugins, markets] = cli
      ? await Promise.all([
          run(cli, ['plugin', 'list', '--json'], { cwd, timeout: LIST_TIMEOUT }).then((r) => (r.code === 0 ? parsePluginList(r.stdout, (p) => !!dir && sameDir(p, dir, platform)) : [])),
          marketplaces(cli, cwd),
        ])
      : [[], []]
    const skillDirs = { user: path.join(claudeRoot(env, home), 'skills'), project: dir ? path.join(dir, '.claude', 'skills') : null }
    return {
      cli: !!cli,
      dir,
      prereqs: probePrereqs(env, platform, home),
      plugins,
      marketplaces: markets,
      configured: readConfigured(claudeJsonFile(env, home), dir, platform),
      skills: { user: listSkills(skillDirs.user), project: skillDirs.project ? listSkills(skillDirs.project) : [] },
      skillDirs,
    }
  })

  // `claude mcp list` health-checks every server (seconds), so it is its own call and cached briefly.
  ipcMain.handle('ccm:ext-mcp', async (event, rawDir: unknown, fresh: unknown): Promise<{ servers: McpServerRow[]; at: number } | null> => {
    if (!isAppFrame(event)) return null
    const dir = await checkDir(rawDir)
    if (dir === 'bad') return null
    const key = dir ?? ''
    const hit = mcpCache.get(key)
    if (hit && fresh !== true && Date.now() - hit.at < MCP_TTL) return hit
    const cli = await findCli()
    if (!cli) return null
    const res = await run(cli, ['mcp', 'list'], { cwd: dir ?? home, timeout: MCP_LIST_TIMEOUT })
    if (res.code !== 0 && !res.stdout.trim()) return null
    const configured = new Map(readConfigured(claudeJsonFile(env, home), dir, platform).map((c) => [c.name, c.scopes]))
    const servers = parseMcpList(res.stdout).map((row) => ({ ...row, scopes: configured.get(row.name) ?? [] }))
    const out = { at: Date.now(), servers }
    mcpCache.set(key, out)
    return out
  })

  ipcMain.handle('ccm:ext-install', async (event, raw: unknown): Promise<ExtResult> => {
    const req = (raw ?? {}) as ExtInstallRequest
    const res = await mutate(event, 'install', req.scope ?? null, req.dir, async (cli, cwd) => buildInstall(req, { platform, marketplaces: await marketplaces(cli, cwd) }))
    return strip(res)
  })

  ipcMain.handle('ccm:ext-remove', async (event, raw: unknown): Promise<ExtResult> => {
    const req = (raw ?? {}) as ExtRemoveRequest
    return strip(await mutate(event, 'remove', req.scope ?? null, req.dir, async () => buildRemove(req)))
  })

  ipcMain.handle('ccm:ext-source', async (event, raw: unknown): Promise<(ExtResult & { marketplace?: string; plugins?: AvailablePlugin[] }) | null> => {
    const req = (raw ?? {}) as ExtSourceRequest
    const scope = req.type === 'marketplace' ? null : (req.scope ?? null)
    const dir = req.type === 'marketplace' ? undefined : req.dir
    const res = await mutate(event, 'source', scope, dir, async () => buildSource(req))
    if (!res.ok || req.type !== 'marketplace' || !res.cli || !res.cwd) return strip(res)
    // Show what the new marketplace offers so the user can pick plugins right away.
    const marketplace = marketplaceFromOutput(res.output ?? '', req.repo)
    const avail = await run(res.cli, ['plugin', 'list', '--available', '--json'], { cwd: res.cwd, timeout: LIST_TIMEOUT })
    return { ok: true, marketplace, plugins: avail.code === 0 ? parseAvailable(avail.stdout, marketplace) : [] }
  })

  // OAuth for an HTTP/SSE server: the CLI opens the browser and waits for the redirect.
  ipcMain.handle('ccm:ext-login', async (event, name: unknown, rawDir: unknown): Promise<ExtResult> => {
    if (!isAppFrame(event)) return { ok: false, code: 'badInput' }
    if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(name)) return { ok: false, code: 'badInput' }
    if (busy) return { ok: false, code: 'busy' }
    const dir = await checkDir(rawDir)
    if (dir === 'bad') return { ok: false, code: 'badInput' }
    busy = true
    try {
      const cli = await findCli()
      if (!cli) return { ok: false, code: 'noCli' }
      const res = await runSteps(cli, [{ args: ['mcp', 'login', name], secrets: [] }], dir ?? home, LOGIN_TIMEOUT)
      mcpCache.clear()
      return strip(res)
    } finally {
      busy = false
    }
  })

  return () => {
    for (const ch of CHANNELS) ipcMain.removeHandler(ch)
  }
}

/** Only the result reaches the page: never raw output, cwd or the CLI path. */
function strip(res: ExtResult & { output?: string; cwd?: string; cli?: string }): ExtResult {
  return res.ok ? { ok: true } : { ok: false, code: res.code, ...(res.detail ? { detail: res.detail } : {}) }
}
