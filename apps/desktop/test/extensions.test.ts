import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { CATALOG, checkFields, catalogEntry } from '@ccm/shared'
import { buildInstall, buildRemove, buildSource, mcpConfig, parseAvailable, parseMcpList, parsePluginList, showCommand } from '../src/extensions/commands'
import { checkDir, registerExtensionsIpc, type ConfirmPlan, type ExtRunner } from '../src/extensions/ipc'
import { readConfigured, sameDir } from '../src/extensions/status'

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ccm-ext-')))
const project = path.join(tmp, 'project')
const home = path.join(tmp, 'home')
mkdirSync(path.join(project, '.claude', 'skills', 'review'), { recursive: true })
mkdirSync(path.join(home, '.claude', 'skills', 'mine'), { recursive: true })
writeFileSync(path.join(project, '.mcp.json'), JSON.stringify({ mcpServers: { discord: { command: 'docker', env: { DISCORD_TOKEN: 'secret' } } } }))
writeFileSync(
  path.join(home, '.claude.json'),
  JSON.stringify({ mcpServers: { github: { type: 'http' } }, projects: { [project.replace(/\\/g, '/')]: { mcpServers: { meshy: {} } } } }),
)
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const MCP_LIST = `Checking MCP server health…

claude.ai Claude Docs: https://api.anthropic.com/v1/pages/mcp - ✔ Connected
plugin:figma:figma: https://mcp.figma.com/mcp (HTTP) - ✔ Connected
plugin:claude-mem:mcp-search: node -e const a=1; const b = a - 1; require('x') - ✔ Connected
gitlab: https://gitlab.com/api/v4/mcp (HTTP) - ⚠ Needs authentication
discord: docker run --rm -i -e DISCORD_TOKEN saseq/discord-mcp:latest - ✗ Failed to connect
team: npx team-mcp - ⏸ Pending approval (run \`claude\` to approve)
gh2: https://api.githubcopilot.com/mcp/ (HTTP) - ✘ Failed to connect — Server rejected the configured Authorization header (HTTP 401). Check the token - OAuth fallback is disabled
`

describe('catalog', () => {
  it('has unique ids and the requested entries', () => {
    const ids = CATALOG.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ['figma', 'meshy', 'unity', 'blender', 'godot', 'godot-editor', 'godot-funplay', 'github', 'gitlab', 'discord', 'pm-skills', 'ui-ux-pro-max', 'frontend-design']) expect(ids).toContain(id)
  })

  it('validates fields', () => {
    const github = catalogEntry('github')!
    expect(checkFields(github, {})).toBe('GITHUB_PAT')
    expect(checkFields(github, { GITHUB_PAT: 'ghp_abcdefghijklmnop' })).toBeNull()
    expect(checkFields(github, { GITHUB_PAT: 'bad token with spaces' })).toBe('GITHUB_PAT')
    expect(checkFields(github, { GITHUB_PAT: 'ghp_abcdefghijklmnop', EXTRA: 'x' })).toBe('EXTRA')
    // Optional with a default
    expect(checkFields(catalogEntry('gitlab')!, {})).toBeNull()
    expect(checkFields(catalogEntry('gitlab')!, { GITLAB_HOST: 'evil.com/x?' })).toBe('GITLAB_HOST')
    const godot = catalogEntry('godot')!
    expect(checkFields(godot, {})).toBeNull()
    expect(checkFields(godot, { GODOT_PATH: 'C:\\Program Files\\Godot\\Godot_v4.4-stable_win64.exe' })).toBeNull()
    expect(checkFields(godot, { GODOT_PATH: '/Applications/Godot.app/Contents/MacOS/Godot' })).toBeNull()
    expect(checkFields(godot, { GODOT_PATH: '-x' })).toBe('GODOT_PATH')
    expect(checkFields(godot, { GODOT_PATH: 'godot/bin' })).toBe('GODOT_PATH')
    expect(mcpConfig(godot, {}, 'win32')).toEqual({ type: 'stdio', command: 'cmd', args: ['/c', 'npx', '-y', '@coding-solo/godot-mcp'] })
  })
})

describe('buildInstall', () => {
  const ctx = { platform: 'linux' as const, marketplaces: ['claude-plugins-official'] }

  it('http + header, secret masked in the shown command', () => {
    const steps = buildInstall({ id: 'github', values: { GITHUB_PAT: 'ghp_secretsecret1234' }, scope: 'user' }, ctx)
    expect(steps).not.toBe('badInput')
    const [step] = steps as Exclude<typeof steps, 'badInput'>
    expect(step!.args.slice(0, 5)).toEqual(['mcp', 'add-json', '-s', 'user', 'github'])
    expect(JSON.parse(step!.args[5]!)).toEqual({ type: 'http', url: 'https://api.githubcopilot.com/mcp/', headers: { Authorization: 'Bearer ghp_secretsecret1234' } })
    expect(showCommand(step!)).not.toContain('ghp_secretsecret1234')
    expect(showCommand(step!)).toContain('Bearer ••••')
  })

  it('fills url templates with defaults', () => {
    expect(mcpConfig(catalogEntry('gitlab')!, {}, 'linux')).toEqual({ type: 'http', url: 'https://gitlab.com/api/v4/mcp' })
    expect(mcpConfig(catalogEntry('gitlab')!, { GITLAB_HOST: 'git.acme.io' }, 'linux')).toEqual({ type: 'http', url: 'https://git.acme.io/api/v4/mcp' })
  })

  it('stdio: npx gets cmd /c on Windows, empty optional env left out', () => {
    expect(mcpConfig(catalogEntry('meshy')!, { MESHY_API_KEY: 'msy_abcdefgh123' }, 'win32')).toEqual({
      type: 'stdio',
      command: 'cmd',
      args: ['/c', 'npx', '-y', '@meshy-ai/meshy-mcp-server'],
      env: { MESHY_API_KEY: 'msy_abcdefgh123' },
    })
    expect(mcpConfig(catalogEntry('meshy')!, { MESHY_API_KEY: 'msy_abcdefgh123' }, 'darwin')).toMatchObject({ command: 'npx' })
    expect(mcpConfig(catalogEntry('discord')!, { DISCORD_TOKEN: 'tok.abcdefgh' }, 'win32')).toMatchObject({ command: 'docker', env: { DISCORD_TOKEN: 'tok.abcdefgh' } })
  })

  it('plugins: adds a missing marketplace first, installs the picked subset with scope', () => {
    const steps = buildInstall({ id: 'pm-skills', values: {}, scope: 'project', plugins: ['pm-toolkit', 'pm-execution'] }, ctx) as { args: string[] }[]
    expect(steps.map((s) => s.args)).toEqual([
      ['plugin', 'marketplace', 'add', 'phuryn/pm-skills'],
      ['plugin', 'install', 'pm-toolkit@pm-skills', '-s', 'project'],
      ['plugin', 'install', 'pm-execution@pm-skills', '-s', 'project'],
    ])
    const fd = buildInstall({ id: 'frontend-design', values: {}, scope: 'local' }, ctx) as { args: string[] }[]
    expect(fd.map((s) => s.args)).toEqual([['plugin', 'install', 'frontend-design@claude-plugins-official', '-s', 'local']])
  })

  it('rejects bad input', () => {
    expect(buildInstall({ id: 'nope', values: {}, scope: 'user' }, ctx)).toBe('badInput')
    expect(buildInstall({ id: 'github', values: {}, scope: 'user' }, ctx)).toBe('badInput')
    expect(buildInstall({ id: 'figma', values: {}, scope: 'everywhere' as never }, ctx)).toBe('badInput')
    expect(buildInstall({ id: 'pm-skills', values: {}, scope: 'user', plugins: ['evil'] }, ctx)).toBe('badInput')
    expect(buildInstall({ id: 'unity', values: {}, scope: 'user' }, ctx)).toBe('badInput')
  })
})

describe('buildRemove / buildSource', () => {
  it('never lets a name become a flag', () => {
    expect(buildRemove({ kind: 'mcp', name: '--help', scope: 'user' })).toBe('badInput')
    expect(buildRemove({ kind: 'plugin', name: '-x@y', scope: 'user' })).toBe('badInput')
    expect(buildRemove({ kind: 'mcp', name: 'github', scope: 'local' })).toEqual([{ args: ['mcp', 'remove', 'github', '-s', 'local'], secrets: [] }])
    expect(buildRemove({ kind: 'plugin', name: 'a@b', scope: 'user' })).toEqual([{ args: ['plugin', 'uninstall', 'a@b', '-s', 'user'], secrets: [] }])
  })

  it('custom sources', () => {
    expect(buildSource({ type: 'marketplace', repo: 'phuryn/pm-skills' })).toEqual([{ args: ['plugin', 'marketplace', 'add', 'phuryn/pm-skills', '--json'], secrets: [] }])
    expect(buildSource({ type: 'marketplace', repo: '-x/y' })).toBe('badInput')
    expect(buildSource({ type: 'plugin', ids: ['a@m', 'b@m'], scope: 'user' })).toEqual([
      { args: ['plugin', 'install', 'a@m', '-s', 'user'], secrets: [] },
      { args: ['plugin', 'install', 'b@m', '-s', 'user'], secrets: [] },
    ])
    expect(buildSource({ type: 'plugin', ids: ['a@m', '--yes'], scope: 'user' })).toBe('badInput')
    expect(buildRemove({ kind: 'plugin', name: ['a@m', 'b@m'], scope: 'project' })).toHaveLength(2)
    expect(buildSource({ type: 'marketplace', repo: 'https://evil' })).toBe('badInput')
    expect(buildSource({ type: 'mcp', name: 'sentry', url: 'file:///etc/passwd', scope: 'user' })).toBe('badInput')
    expect(buildSource({ type: 'mcp', name: 'sentry', url: 'https://mcp.sentry.dev/mcp', header: 'X-Key: abc\r\nY: z', scope: 'user' })).toBe('badInput')
    const ok = buildSource({ type: 'mcp', name: 'sentry', url: 'https://mcp.sentry.dev/mcp', header: 'X-Key: abc123', scope: 'user' }) as { args: string[]; secrets: string[] }[]
    expect(JSON.parse(ok[0]!.args[5]!)).toEqual({ type: 'http', url: 'https://mcp.sentry.dev/mcp', headers: { 'X-Key': 'abc123' } })
    expect(ok[0]!.secrets).toEqual(['abc123'])
  })
})

describe('parsers', () => {
  it('parses claude mcp list', () => {
    const rows = parseMcpList(MCP_LIST)
    expect(rows.map((r) => [r.name, r.state])).toEqual([
      ['claude.ai Claude Docs', 'connected'],
      ['plugin:figma:figma', 'connected'],
      ['plugin:claude-mem:mcp-search', 'connected'],
      ['gitlab', 'needsAuth'],
      ['discord', 'failed'],
      ['team', 'pending'],
      ['gh2', 'failed'],
    ])
    expect(rows[0]!.connector).toBe(true)
    expect(rows[1]!.plugin).toBe('figma')
  })

  it('parses plugin lists', () => {
    const json = JSON.stringify([
      { id: 'a@m', scope: 'user', enabled: true },
      { id: 'b@m', scope: 'project', enabled: false, projectPath: '/other' },
      { id: 'c@m', scope: 'local', enabled: true, projectPath: '/here' },
      { id: 42, scope: 'user' },
    ])
    expect(parsePluginList(json, (p) => p === '/here')).toEqual([
      { id: 'a@m', scope: 'user', enabled: true },
      { id: 'c@m', scope: 'local', enabled: true },
    ])
    expect(parsePluginList('not json', () => true)).toEqual([])
    const avail = JSON.stringify({ available: [{ pluginId: 'x@pm', name: 'x', marketplaceName: 'pm', description: 'd' }, { pluginId: 'y@o', name: 'y', marketplaceName: 'o' }] })
    expect(parseAvailable(avail, 'pm')).toEqual([{ id: 'x@pm', name: 'x', marketplace: 'pm', description: 'd' }])
  })

  it('reads configured names per scope, never values', () => {
    const rows = readConfigured(path.join(home, '.claude.json'), project, process.platform)
    expect(rows).toEqual(
      expect.arrayContaining([
        { name: 'github', scopes: ['user'] },
        { name: 'meshy', scopes: ['local'] },
        { name: 'discord', scopes: ['project'] },
      ]),
    )
    expect(JSON.stringify(rows)).not.toContain('secret')
    expect(sameDir('D:/Code/x/', 'd:\\code\\x', 'win32')).toBe(true)
    expect(sameDir('/a/B', '/a/b', 'linux')).toBe(false)
  })
})

describe('ipc', () => {
  type Handler = (event: unknown, ...args: unknown[]) => unknown

  function setup(answer: boolean, run: ExtRunner) {
    const handlers = new Map<string, Handler>()
    const plans: ConfirmPlan[] = []
    const dispose = registerExtensionsIpc({
      ipcMain: { handle: (ch: string, fn: Handler) => handlers.set(ch, fn), removeHandler: (ch: string) => handlers.delete(ch) } as never,
      isAppFrame: () => true,
      confirm: async (_e, plan) => {
        plans.push(plan)
        return answer
      },
      findCli: async () => '/bin/claude',
      run,
      env: { PATH: '' },
      home,
      platform: process.platform,
    })
    const call = (ch: string, ...args: unknown[]) => Promise.resolve(handlers.get(ch)!({ sender: { id: 1 } }, ...args))
    return { call, plans, dispose, handlers }
  }

  it('checkDir rejects relative, roots, UNC and missing folders', async () => {
    expect(await checkDir(undefined)).toBeNull()
    expect(await checkDir('relative/x')).toBe('bad')
    expect(await checkDir(path.parse(tmp).root)).toBe('bad')
    expect(await checkDir('\\\\server\\share\\x')).toBe('bad')
    expect(await checkDir(path.join(tmp, 'missing'))).toBe('bad')
    expect(await checkDir(project)).toBe(project)
  })

  it('cancel = nothing runs; yes = runs in the project folder, masked plan', async () => {
    const calls: { args: string[]; cwd: string }[] = []
    const run: ExtRunner = async (_f, args, opts) => {
      calls.push({ args, cwd: opts.cwd })
      return { code: 0, stdout: args[2] === 'list' ? '[]' : '', stderr: '' }
    }
    const no = setup(false, run)
    expect(await no.call('ccm:ext-install', { id: 'meshy', values: { MESHY_API_KEY: 'msy_secret_1234' }, scope: 'local', dir: project })).toEqual({ ok: false, code: 'cancelled' })
    expect(calls.filter((c) => c.args[1] === 'add-json')).toEqual([])
    expect(no.plans[0]!.commands.join(' ')).not.toContain('msy_secret_1234')
    no.dispose()

    const yes = setup(true, run)
    expect(await yes.call('ccm:ext-install', { id: 'meshy', values: { MESHY_API_KEY: 'msy_secret_1234' }, scope: 'local', dir: project })).toEqual({ ok: true })
    expect(calls.find((c) => c.args[1] === 'add-json')).toMatchObject({ cwd: project })
    // project scope without a folder
    expect(await yes.call('ccm:ext-install', { id: 'figma', values: {}, scope: 'project' })).toEqual({ ok: false, code: 'badInput' })
    yes.dispose()
    expect(yes.handlers.size).toBe(0)
  })

  it('one change at a time; failures come back masked', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    const run: ExtRunner = async (_f, args) => {
      if (args[1] === 'add-json') {
        await gate
        return { code: 1, stdout: '', stderr: `boom ${home}${path.sep}x Bearer ghp_secretsecret1234` }
      }
      return { code: 0, stdout: '[]', stderr: '' }
    }
    const { call } = setup(true, run)
    const first = call('ccm:ext-install', { id: 'github', values: { GITHUB_PAT: 'ghp_secretsecret1234' }, scope: 'user' })
    await new Promise((r) => setTimeout(r, 10))
    expect(await call('ccm:ext-remove', { kind: 'mcp', name: 'github', scope: 'user' })).toEqual({ ok: false, code: 'busy' })
    release()
    const res = (await first) as { ok: false; code: string; detail: string }
    expect(res.code).toBe('failed')
    expect(res.detail).not.toContain('ghp_secretsecret1234')
    expect(res.detail).not.toContain(home)
  })

  it('status lists skills, configured names and plugins', async () => {
    const run: ExtRunner = async (_f, args) => ({
      code: 0,
      stdout: args[1] === 'marketplace' ? JSON.stringify([{ name: 'claude-plugins-official' }]) : JSON.stringify([{ id: 'frontend-design@claude-plugins-official', scope: 'user', enabled: true }]),
      stderr: '',
    })
    const { call } = setup(true, run)
    const status = (await call('ccm:ext-status', project)) as { skills: { user: string[]; project: string[] }; skillDirs: { user: string; project: string | null }; marketplaces: string[]; plugins: unknown[]; cli: boolean }
    expect(status.cli).toBe(true)
    expect(status.skills).toEqual({ user: ['mine'], project: ['review'] })
    expect(status.skillDirs).toEqual({ user: path.join(home, '.claude', 'skills'), project: path.join(project, '.claude', 'skills') })
    expect(status.marketplaces).toEqual(['claude-plugins-official'])
    expect(status.plugins).toHaveLength(1)
    expect(await call('ccm:ext-status', 'relative')).toBeNull()
  })

  it('mcp list is cached and tagged with scopes', async () => {
    let n = 0
    const run: ExtRunner = async () => {
      n++
      return { code: 0, stdout: MCP_LIST, stderr: '' }
    }
    const { call } = setup(true, run)
    const a = (await call('ccm:ext-mcp', project)) as { servers: { name: string; scopes: string[] }[] }
    expect(a.servers.find((s) => s.name === 'discord')!.scopes).toEqual(['project'])
    await call('ccm:ext-mcp', project)
    expect(n).toBe(1)
    await call('ccm:ext-mcp', project, true)
    expect(n).toBe(2)
  })
})
