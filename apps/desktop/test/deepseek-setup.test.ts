import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { findCodewhale, installPlan, updatePlan, wrapperDownloads, type CliRunner, type CodewhaleInstall, type FsProbe, type InstallStep } from '../src/deepseek/cli'
import { registerDeepSeekIpc, SYNC_RECORD, type DeepSeekConfirm, type DeepSeekEvent } from '../src/deepseek/ipc'
import { cleanApiKey, compareVersions, parseAuthStatus, parseDoctorUpdates, parseDownloadProgress, parseTelemetry, parseVersion } from '../src/deepseek/parse'
import { importPath, inlineImports, isManagedSkill, mergeManagedBlock, mergeMcp, planSync, applySync, ensureOutboxPath, readSyncRecord, syncFingerprint, syncState, upsertTomlArrayValue } from '../src/deepseek/sync'
import { BLOCK_BEGIN, BLOCK_END, DELEGATE_SKILL, HANDOFF_SKILL, WORKFLOW_BLOCK } from '../src/deepseek/templates'

const AUTH_STATUS = `account: not signed in (api https://api.codewhale.net)

active provider: deepseek (set via config or CODEWHALE_PROVIDER)

provider       config   keyring    env      status
----------------------------------------------------------------------
deepseek       -        -          -        unset *
nvidia-nim     -        -          -        unset
openai-codex   -        -          -        missing (run \`codewhale auth chatgpt\` to register an official grant)
`

describe('codewhale output parsing (0.10.2)', () => {
  it('reads the version line', () => {
    expect(parseVersion('codewhale 0.10.2 (ff466b2ed0bf)\n')).toBe('0.10.2')
    expect(parseVersion('garbage')).toBeNull()
  })

  it('reads the deepseek row of auth status', () => {
    expect(parseAuthStatus(AUTH_STATUS)).toBe(false)
    expect(parseAuthStatus(AUTH_STATUS.replace('-        unset *', 'file     set *'))).toBe(true)
    expect(parseAuthStatus(AUTH_STATUS, 'openai-codex')).toBe(false)
    expect(parseAuthStatus('provider status\n')).toBeNull()
  })

  it('reads the telemetry switch', () => {
    expect(parseTelemetry('Usage reporting: On (default)\nDetails: codewhale config telemetry\n')).toBe(true)
    expect(parseTelemetry('Usage reporting: Off\n')).toBe(false)
    expect(parseTelemetry('')).toBeNull()
  })

  it('reads download progress lines of the npm wrapper', () => {
    expect(parseDownloadProgress('codewhale: downloading codewhale-windows-x64.exe: 12 / 128 MB (9%)')).toEqual({ mb: 12, totalMb: 128, pct: 9 })
    expect(parseDownloadProgress('codewhale: downloading codewhale-macos-arm64: 40 MB downloaded')).toEqual({ mb: 40, totalMb: null, pct: null })
    expect(parseDownloadProgress('added 1 package in 2s')).toBeNull()
  })

  it('accepts only a plain printable key', () => {
    expect(cleanApiKey('  sk-abcdef0123456789\n')).toBe('sk-abcdef0123456789')
    expect(cleanApiKey('sk-abc def0123456')).toBeNull()
    expect(cleanApiKey('sk-abc\u0007def0123456')).toBeNull()
    expect(cleanApiKey('short')).toBeNull()
    expect(cleanApiKey(42)).toBeNull()
  })
})

describe('sync helpers', () => {
  it('replaces or appends the managed AGENTS.md block, keeping the rest', () => {
    expect(mergeManagedBlock(null, 'X')).toBe(`${BLOCK_BEGIN}\nX\n${BLOCK_END}\n`)
    const mine = `# Mine\n\nkeep\n\n${BLOCK_BEGIN}\nold\n${BLOCK_END}\n\ntail\n`
    expect(mergeManagedBlock(mine, 'new')).toBe(`# Mine\n\nkeep\n\n${BLOCK_BEGIN}\nnew\n${BLOCK_END}\n\ntail\n`)
    expect(mergeManagedBlock('# Mine\n\n', 'B')).toBe(`# Mine\n\n${BLOCK_BEGIN}\nB\n${BLOCK_END}\n`)
  })

  it('inlines whole-line imports one level, outside fences, dropping missing ones', () => {
    const text = ['# Rules', '@RTK.md', 'see @inline.md here', '```', '@fenced.md', '```', '@missing.md'].join('\n')
    const read = (ref: string) => (ref === 'RTK.md' ? 'rtk body\n@nested.md\n' : null)
    expect(inlineImports(text, read)).toBe(['# Rules', 'rtk body\n@nested.md', 'see @inline.md here', '```', '@fenced.md', '```'].join('\n'))
  })

  it('keeps imports inside the Claude folder', () => {
    const root = path.resolve('/h/.claude')
    const home = path.resolve('/h')
    expect(importPath('RTK.md', root, home)).toBe(path.join(root, 'RTK.md'))
    expect(importPath('~/.claude/a.md', root, home)).toBe(path.join(root, 'a.md'))
    expect(importPath('../secret.md', root, home)).toBeNull()
    expect(importPath('~/notes.md', root, home)).toBeNull()
  })

  it('upserts a top-level TOML array key without touching the rest', () => {
    const key = 'project_instruction_imports'
    expect(upsertTomlArrayValue(null, key, 'claude')).toEqual({ text: `${key} = ["claude"]\n`, changed: true })
    expect(upsertTomlArrayValue(`${key} = ["claude"]\n`, key, 'claude').changed).toBe(false)
    expect(upsertTomlArrayValue(`model = "x"\n\n[tui]\ntheme = "dark"\n`, key, 'claude').text).toBe(`model = "x"\n\n${key} = ["claude"]\n\n[tui]\ntheme = "dark"\n`)
    expect(upsertTomlArrayValue(`${key} = ["agents"] # mine\n[a]\n`, key, 'claude').text).toBe(`${key} = ["agents", "claude"]\n[a]\n`)
    expect(upsertTomlArrayValue(`${key} = [\n  "x",\n]\nother = 1\n`, key, 'claude').text).toBe(`${key} = ["claude"]\nother = 1\n`)
    // A same-named key inside a table is not the top-level one.
    expect(upsertTomlArrayValue(`[t]\n${key} = []\n`, key, 'claude').text).toBe(`${key} = ["claude"]\n\n[t]\n${key} = []\n`)
    expect(upsertTomlArrayValue('a = 1\r\n', key, 'claude').text).toBe(`a = 1\r\n${key} = ["claude"]\r\n`)
  })

  it('adds missing Claude MCP servers, never overwriting and never orrery', () => {
    const claude = {
      rea: { type: 'stdio', command: 'rea', args: ['mcp'], env: { TOKEN: 'x' } },
      docs: { type: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer y' } },
      orrery: { type: 'http', url: 'http://127.0.0.1:1/mcp' },
      mine: { command: 'other' },
      broken: { type: 'stdio' },
      'bad name': { command: 'x' },
    }
    const res = mergeMcp(JSON.stringify({ servers: { mine: { command: 'keep' } } }), claude)
    if ('error' in res) throw new Error('unexpected')
    expect(res.added).toEqual(['rea', 'docs'])
    expect(JSON.parse(res.text)).toEqual({
      servers: {
        mine: { command: 'keep' },
        rea: { command: 'rea', args: ['mcp'], env: { TOKEN: 'x' } },
        docs: { url: 'https://example.com/mcp', headers: { Authorization: 'Bearer y' } },
      },
    })
    const legacy = mergeMcp(JSON.stringify({ mcpServers: { rea: { command: 'a' } } }), claude)
    if ('error' in legacy) throw new Error('unexpected')
    expect(legacy.added).toEqual(['docs', 'mine'])
    expect(Object.keys(JSON.parse(legacy.text))).toEqual(['mcpServers'])
    expect(mergeMcp('{not json', claude)).toEqual({ error: 'unreadable' })
    expect(mergeMcp(null, null)).toEqual({ text: '', added: [] })
  })

  it('recognises managed skills by frontmatter only', () => {
    expect(isManagedSkill(HANDOFF_SKILL)).toBe(true)
    expect(isManagedSkill(DELEGATE_SKILL)).toBe(true)
    expect(isManagedSkill('---\nname: x\nx-orrery-managed: true\n---\nbody')).toBe(true)
    expect(isManagedSkill('---\nname: x\n---\norrery-managed: true')).toBe(false)
  })

  it('templates stay generic', () => {
    for (const text of [WORKFLOW_BLOCK, HANDOFF_SKILL, DELEGATE_SKILL]) expect(text).not.toMatch(/chủ nhân|dauph|hoanxu|caveman|rtk/i)
    expect(WORKFLOW_BLOCK).toContain('hand_back')
    expect(DELEGATE_SKILL).toContain('open_session')
  })
})

describe('ensureOutboxPath', () => {
  const fresh = '[lifecycle_outbox]\npath = "~/.codewhale/notifications/outbox.jsonl"\n'

  it('adds the outbox path once and never changes one the user set', () => {
    expect(ensureOutboxPath(null)).toEqual({ text: fresh, changed: true })
    expect(ensureOutboxPath('telemetry = false\n\n')).toEqual({ text: `telemetry = false\n\n${fresh}`, changed: true })
    expect(ensureOutboxPath('[lifecycle_outbox]\nmax_bytes = 10\n[x]\na = 1\n').text).toBe(
      '[lifecycle_outbox]\npath = "~/.codewhale/notifications/outbox.jsonl"\nmax_bytes = 10\n[x]\na = 1\n',
    )
    const own = "a = 1\r\n[ lifecycle_outbox ]\r\npath = 'D:\\o.jsonl'\r\n"
    expect(ensureOutboxPath(own)).toEqual({ text: own, changed: false })
    expect(ensureOutboxPath('lifecycle_outbox.path = "/x"\n').changed).toBe(false)
    // Another table's `path` is not ours.
    expect(ensureOutboxPath('[mcp]\npath = "/m"\n').changed).toBe(true)
    expect(ensureOutboxPath('a = 1\r\n').text).toBe('a = 1\r\n\r\n[lifecycle_outbox]\r\npath = "~/.codewhale/notifications/outbox.jsonl"\r\n')
  })
})

describe('planSync / applySync', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ccm-ds-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const home = path.join(dir, 'home')
  const p = {
    home,
    codewhaleHome: path.join(home, '.codewhale'),
    claudeRoot: path.join(home, '.claude'),
    claudeJson: path.join(home, '.claude.json'),
    codexHome: path.join(home, '.codex'),
  }
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, text)
  }

  it('plans, writes with one backup, then reports nothing to do', async () => {
    write(path.join(p.claudeRoot, 'CLAUDE.md'), '# Claude rules\n@RTK.md\n@../outside.md\n')
    write(path.join(p.claudeRoot, 'RTK.md'), 'rtk rules\n')
    write(path.join(home, 'outside.md'), 'nope\n')
    write(p.claudeJson, JSON.stringify({ mcpServers: { rea: { command: 'rea' } } }))
    write(path.join(p.codewhaleHome, 'AGENTS.md'), '# My own notes\n')
    write(path.join(p.codexHome, 'skills', 'orrery-delegate', 'SKILL.md'), '---\nname: orrery-delegate\n---\nhand written\n')

    const plan = await planSync(p)
    const by = Object.fromEntries(plan.files.map((f) => [f.id, f]))
    expect(by.agents!.action).toBe('update')
    expect(by.agents!.content).toContain('# My own notes')
    expect(by.agents!.content).toContain('rtk rules')
    expect(by.agents!.content).not.toContain('nope')
    expect(by.config!.action).toBe('create')
    expect(by.mcp!.action).toBe('create')
    expect(plan.mcpAdded).toEqual(['rea'])
    expect(by['skill-handoff']!.action).toBe('create')
    expect(by['skill-delegate-claude']!.action).toBe('create')
    expect(by['skill-delegate-codex']).toMatchObject({ action: 'skip', reason: 'notManaged' })

    await applySync(plan)
    expect(readFileSync(path.join(p.codewhaleHome, 'AGENTS.md.orrery-backup'), 'utf8')).toBe('# My own notes\n')
    expect(plan.outboxAdded).toBe(true)
    expect(readFileSync(path.join(p.codewhaleHome, 'config.toml'), 'utf8')).toBe(
      'project_instruction_imports = ["claude"]\n\n[lifecycle_outbox]\npath = "~/.codewhale/notifications/outbox.jsonl"\n',
    )
    expect(readFileSync(path.join(p.codexHome, 'skills', 'orrery-delegate', 'SKILL.md'), 'utf8')).toContain('hand written')
    expect(existsSync(path.join(p.claudeRoot, 'skills', 'orrery-delegate', 'SKILL.md'))).toBe(true)

    const again = await planSync(p)
    expect(again.files.filter((f) => f.action === 'create' || f.action === 'update')).toEqual([])
  })
})

describe('install discovery', () => {
  const probe = (files: string[], links: Record<string, string> = {}): FsProbe => ({
    isFile: (f) => files.includes(f),
    realpath: (f) => links[f] ?? f,
  })

  it('Windows npm shim: needs the download until the binary exists', () => {
    const env = { PATH: 'C:\\Windows', APPDATA: 'C:\\U\\AppData\\Roaming', PATHEXT: '.EXE;.CMD', SystemRoot: 'C:\\Windows' }
    const shim = 'C:\\U\\AppData\\Roaming\\npm\\codewhale.cmd'
    const exe = 'C:\\U\\AppData\\Roaming\\npm\\node_modules\\codewhale\\bin\\downloads\\codewhale.exe'
    const pending = findCodewhale(env, 'C:\\U', 'win32', probe([shim]))
    expect(pending?.needsDownload).toBe(true)
    expect(pending?.cmd.file).toMatch(/cmd\.exe$/)
    expect(wrapperDownloads(shim, 'win32')).toBe(path.win32.dirname(exe))
    expect(findCodewhale(env, 'C:\\U', 'win32', probe([shim, exe]))).toMatchObject({ cmd: { file: exe, args: [] }, needsDownload: false, origin: 'npm', wrapper: { file: expect.stringMatching(/cmd\.exe$/) } })
  })

  it('winget exe and posix symlinked wrapper', () => {
    const links = 'C:\\U\\AppData\\Local\\Microsoft\\WinGet\\Links\\codewhale.exe'
    expect(findCodewhale({ PATH: '', LOCALAPPDATA: 'C:\\U\\AppData\\Local', PATHEXT: '.EXE' }, 'C:\\U', 'win32', probe([links]))).toEqual({ cmd: { file: links, args: [] }, needsDownload: false, origin: 'winget' })
    const bin = '/usr/local/bin/codewhale'
    const js = '/usr/local/lib/node_modules/codewhale/bin/codewhale.js'
    const res = findCodewhale({ PATH: '/usr/bin' }, '/Users/u', 'darwin', probe([bin], { [bin]: js }))
    expect(res).toEqual({ cmd: { file: bin, args: [] }, needsDownload: true, origin: 'npm', wrapper: { file: bin, args: [] } })
    expect(findCodewhale({ PATH: '' }, '/Users/u', 'darwin', probe([]))).toBeNull()
  })

  it('picks winget, then npm, then the script on macOS', () => {
    const winget = 'C:\\U\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe'
    const env = { PATH: 'C:\\node', LOCALAPPDATA: 'C:\\U\\AppData\\Local', PATHEXT: '.EXE;.CMD', SystemRoot: 'C:\\Windows' }
    expect(installPlan(env, 'C:\\U', 'win32', probe([winget]))?.steps[0]).toMatchObject({ cmd: { file: winget }, display: expect.stringContaining('HunterBown.CodeWhale') })
    const npm = installPlan(env, 'C:\\U', 'win32', probe(['C:\\node\\npm.cmd']))
    expect(npm?.route).toBe('npm')
    expect(npm?.steps[0]!.cmd.args.join(' ')).toContain('codewhale')
    expect(installPlan(env, 'C:\\U', 'win32', probe([]))).toBeNull()
    expect(installPlan({ PATH: '/usr/bin' }, '/Users/u', 'darwin', probe([]))).toMatchObject({ route: 'script', steps: [{ cmd: { file: '/bin/sh' } }] })
  })
})

describe('registerDeepSeekIpc', () => {
  const cw: CodewhaleInstall = { cmd: { file: '/bin/codewhale', args: [] }, needsDownload: false, origin: 'standalone' }
  const home = mkdtempSync(path.join(os.tmpdir(), 'ccm-ds-ipc-'))
  afterAll(() => rmSync(home, { recursive: true, force: true }))
  function setup(opts: { found?: typeof cw | null; find?: () => typeof cw | null; confirm?: boolean; run?: CliRunner; now?: () => number; update?: () => InstallStep[] | null } = {}) {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    const ipcMain = { handle: (ch: string, fn: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(ch, fn), removeHandler: (ch: string) => handlers.delete(ch) }
    const calls: { args: string[]; stdin?: string }[] = []
    const confirms: DeepSeekConfirm[] = []
    const events: DeepSeekEvent[] = []
    const run: CliRunner =
      opts.run ??
      (async (_cmd, args, o) => {
        calls.push({ args, stdin: o.stdin })
        if (args[0] === '--version') return { code: 0, stdout: 'codewhale 0.10.2 (abc)\n', stderr: '' }
        if (args[0] === 'auth' && args[1] === 'status') return { code: 0, stdout: AUTH_STATUS, stderr: '' }
        if (args[0] === 'config' && args[1] === 'get') return { code: 0, stdout: 'Usage reporting: Off\n', stderr: '' }
        return { code: 0, stdout: '', stderr: '' }
      })
    const dispose = registerDeepSeekIpc({
      ipcMain: ipcMain as never,
      isAppFrame: (e) => (e as { app?: boolean }).app !== false,
      confirm: async (_e, plan) => (confirms.push(plan), opts.confirm ?? true),
      emit: (e) => events.push(e),
      run,
      find: opts.find ?? (() => (opts.found === undefined ? cw : opts.found)),
      plan: () => null,
      ...(opts.update ? { update: opts.update } : {}),
      home,
      dataDir: path.join(home, 'data'),
      env: {},
      ...(opts.now ? { now: opts.now } : {}),
    })
    const call = (ch: string, ...args: unknown[]) => handlers.get(ch)!({ sender: {} } as unknown as IpcMainInvokeEvent, ...args)
    return { call, calls, confirms, events, dispose, handlers }
  }

  it('status reads version, login and telemetry', async () => {
    const { call } = setup()
    expect(await call('ccm:deepseek-status')).toMatchObject({ installed: true, version: '0.10.2', loggedIn: false, telemetry: false, installRoute: null })
  })

  it('status never runs a wrapper that still has to download', async () => {
    const { call, calls } = setup({ found: { ...cw, needsDownload: true } })
    expect(await call('ccm:deepseek-status')).toMatchObject({ installed: false, needsDownload: true, version: null })
    expect(calls).toEqual([])
  })

  it('login passes the key on stdin only and never returns it', async () => {
    const key = 'sk-0123456789abcdef'
    const { call, calls } = setup({ run: async (_c, args, o) => (args[1] === 'set' ? { code: 1, stdout: '', stderr: `bad key ${o.stdin?.trim()}` } : { code: 0, stdout: '', stderr: '' }) })
    const res = (await call('ccm:deepseek-login', `  ${key} `)) as { ok: boolean; detail?: string }
    expect(res.ok).toBe(false)
    expect(res.detail).not.toContain(key)
    expect(calls).toEqual([])
    const ok = setup()
    expect(await ok.call('ccm:deepseek-login', key)).toEqual({ ok: true })
    expect(ok.calls).toEqual([{ args: ['auth', 'set', '--provider', 'deepseek', '--api-key-stdin'], stdin: `${key}\n` }])
    expect(await ok.call('ccm:deepseek-login', 'has space in it')).toEqual({ ok: false, code: 'badInput' })
  })

  it('logout and install ask first', async () => {
    const no = setup({ confirm: false })
    expect(await no.call('ccm:deepseek-logout')).toEqual({ ok: false, code: 'cancelled' })
    expect(no.calls).toEqual([])
    const yes = setup()
    expect(await yes.call('ccm:deepseek-logout')).toEqual({ ok: true })
    expect(yes.calls[0]!.args).toEqual(['auth', 'clear', '--provider', 'deepseek'])
    expect(await yes.call('ccm:deepseek-install')).toEqual({ ok: false, code: 'installed' })
  })

  it('download streams progress and can be cancelled', async () => {
    let downloaded = false
    const s = setup({
      find: () => ({ ...cw, needsDownload: !downloaded }),
      run: async (_c, _args, o) => {
        o.onLine?.('codewhale: downloading codewhale-x: 64 / 128 MB (50%)')
        downloaded = true
        return { code: 0, stdout: '', stderr: '' }
      },
    })
    expect(await s.call('ccm:deepseek-install')).toEqual({ ok: true })
    expect(s.confirms[0]).toEqual({ kind: 'download', commands: ['codewhale --version'] })
    expect(s.events).toEqual([{ phase: 'download', mb: 64, totalMb: 128, pct: 50 }])

    const slow = setup({
      find: () => ({ ...cw, needsDownload: true }),
      run: (_c, _args, o) => new Promise((resolve) => o.signal?.addEventListener('abort', () => resolve({ code: null, stdout: '', stderr: '', cancelled: true }))),
    })
    expect(await slow.call('ccm:deepseek-cancel')).toBe(false)
    const pending = slow.call('ccm:deepseek-install')
    await vi.waitFor(async () => expect(await slow.call('ccm:deepseek-cancel')).toBe(true))
    expect(await pending).toEqual({ ok: false, code: 'cancelled' })
  })

  it('rejects other frames and frees its channels', async () => {
    const { handlers, dispose } = setup()
    expect(await handlers.get('ccm:deepseek-status')!({ app: false })).toBeNull()
    expect(await handlers.get('ccm:deepseek-sync')!({ app: false })).toEqual({ ok: false, code: 'badInput' })
    dispose()
    expect(handlers.size).toBe(0)
  })

  it('caches the CLI part for a minute, asks again when forced or after a login', async () => {
    let clock = 1_000_000
    const s = setup({ now: () => clock })
    const versions = () => s.calls.filter((c) => c.args[0] === '--version').length
    await s.call('ccm:deepseek-status')
    await s.call('ccm:deepseek-status')
    expect(versions()).toBe(1)
    clock += 61_000
    await s.call('ccm:deepseek-status')
    expect(versions()).toBe(2)
    await s.call('ccm:deepseek-status', true)
    expect(versions()).toBe(3)
    await s.call('ccm:deepseek-login', 'sk-0123456789abcdef')
    await s.call('ccm:deepseek-status')
    expect(versions()).toBe(4)
  })

  it('sync state: never, current after a sync, stale when Claude rules change', async () => {
    const s = setup()
    expect(await s.call('ccm:deepseek-status')).toMatchObject({ sync: 'never', syncedAt: null })
    mkdirSync(path.join(home, '.claude'), { recursive: true })
    writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), '# rules\n')
    expect(await s.call('ccm:deepseek-sync')).toMatchObject({ ok: true })
    await expect(readSyncRecord(path.join(home, 'data', SYNC_RECORD))).resolves.toMatchObject({ hash: expect.any(String) })
    expect(await s.call('ccm:deepseek-status')).toMatchObject({ sync: 'current', syncedAt: expect.any(Number) })
    writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), '# rules, changed\n')
    expect(await s.call('ccm:deepseek-status')).toMatchObject({ sync: 'stale' })
  })

  it('checks for an update through doctor and confirms the route command', async () => {
    const doctor = 'Version Information:\n  codewhale: 0.10.2 (ff466b2ed0bf)\n\nUpdates:\n  · current: v0.10.2\n  · latest: v0.11.0\n\nConfiguration:\n  ✓ ok\n'
    const s = setup({
      run: async (_c, args) => (args[0] === 'doctor' ? { code: 0, stdout: doctor, stderr: '' } : { code: 0, stdout: '', stderr: '' }),
      update: () => [{ cmd: { file: '/bin/codewhale', args: ['update'] }, display: 'codewhale update' }],
      confirm: false,
    })
    expect(await s.call('ccm:deepseek-check-update')).toEqual({ ok: true, current: '0.10.2', latest: '0.11.0', newer: true })
    expect(await s.call('ccm:deepseek-update')).toEqual({ ok: false, code: 'cancelled' })
    expect(s.confirms).toEqual([{ kind: 'update', commands: ['codewhale update'] }])
  })
})

describe('sync fingerprint', () => {
  it('changes with the rules, the MCP names (not their order) and the template version', () => {
    const base = syncFingerprint('rules', ['a', 'b'], 1)
    expect(syncFingerprint('rules', ['b', 'a'], 1)).toBe(base)
    expect(syncFingerprint('rules!', ['a', 'b'], 1)).not.toBe(base)
    expect(syncFingerprint('rules', ['a'], 1)).not.toBe(base)
    expect(syncFingerprint('rules', ['a', 'b'], 2)).not.toBe(base)
    expect(syncState(null, base)).toBe('never')
    expect(syncState({ at: 1, hash: base }, base)).toBe('current')
    expect(syncState({ at: 1, hash: 'old' }, base)).toBe('stale')
  })
})

describe('updates', () => {
  it('parses doctor --check-updates (0.10.2 layout)', () => {
    const out = 'Updates:\n  · current: v0.10.2\n  · latest: v0.10.2\n    Already up to date.\n\nConfiguration:\n'
    expect(parseDoctorUpdates(out)).toEqual({ current: '0.10.2', latest: '0.10.2' })
    expect(parseDoctorUpdates('Configuration:\n  ok\n')).toBeNull()
  })

  it('compares versions', () => {
    expect(compareVersions('0.11.0', '0.10.2')).toBe(1)
    expect(compareVersions('0.10.2', '0.10.2')).toBe(0)
    expect(compareVersions('0.10.10', '0.10.9')).toBe(1)
    expect(compareVersions('1.0.0-beta.1', '1.0.0')).toBe(-1)
  })

  it('picks the update command by install origin', () => {
    const probe: FsProbe = { isFile: (f) => ['C:\\node\\npm.cmd', 'C:\\U\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe'].includes(f), realpath: (f) => f }
    const env = { PATH: 'C:\\node', LOCALAPPDATA: 'C:\\U\\AppData\\Local', PATHEXT: '.EXE;.CMD', SystemRoot: 'C:\\Windows' }
    const base = { cmd: { file: 'C:\\x\\codewhale.exe', args: [] }, needsDownload: false }
    expect(updatePlan({ ...base, origin: 'npm' }, env, 'C:\\U', 'win32', probe)?.[0]?.display).toBe('npm i -g codewhale@latest')
    expect(updatePlan({ ...base, origin: 'winget' }, env, 'C:\\U', 'win32', probe)?.[0]).toMatchObject({
      cmd: { file: 'C:\\U\\AppData\\Local\\Microsoft\\WindowsApps\\winget.exe', args: expect.arrayContaining(['upgrade', 'HunterBown.CodeWhale']) },
    })
    expect(updatePlan({ ...base, origin: 'standalone' }, env, 'C:\\U', 'win32', probe)).toEqual([{ cmd: { file: 'C:\\x\\codewhale.exe', args: ['update'] }, display: 'codewhale update' }])
    expect(updatePlan({ ...base, origin: 'npm' }, { PATH: '' }, 'C:\\U', 'win32', { isFile: () => false, realpath: (f) => f })).toBeNull()
  })
})
