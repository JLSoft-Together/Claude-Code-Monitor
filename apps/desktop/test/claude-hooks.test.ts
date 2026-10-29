import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import {
  canonical,
  clipOutput,
  fakePayload,
  flattenHooks,
  hookKey,
  maskHookText,
  removeHookEntry,
  restoreHookEntry,
} from '../src/claudeHooks/model'
import { HooksManager, HOOKS_STASH_FILE, shellFor, testEnv, type SpawnFn } from '../src/claudeHooks/manager'

const settings = {
  model: 'opus',
  hooks: {
    SessionStart: [{ hooks: [{ type: 'command', command: 'node a.js', timeout: 5 }] }],
    PreToolUse: [
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook' }, { type: 'command', command: 'lint.sh' }] },
      { matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'fmt.sh' }] },
    ],
  },
  statusLine: { type: 'command', command: 'x' },
}

describe('flattenHooks / hookKey', () => {
  it('lists every entry in file order with its event and matcher', () => {
    const flat = flattenHooks(settings.hooks)
    expect(flat.map((f) => [f.event, f.matcher, f.hook.command])).toEqual([
      ['SessionStart', null, 'node a.js'],
      ['PreToolUse', 'Bash', 'rtk hook'],
      ['PreToolUse', 'Bash', 'lint.sh'],
      ['PreToolUse', 'Edit|Write', 'fmt.sh'],
    ])
    expect(flattenHooks({ Stop: 'bad', X: [null, { hooks: 'no' }] })).toEqual([])
  })
  it('keys ignore field order and file path case on Windows', () => {
    const a = { event: 'Stop', matcher: null, hook: { type: 'command', command: 'x', timeout: 3 } }
    const b = { event: 'Stop', matcher: null, hook: { timeout: 3, command: 'x', type: 'command' } }
    expect(canonical(a.hook)).toBe(canonical(b.hook))
    expect(hookKey('C:\\U\\settings.json', a, 'win32')).toBe(hookKey('c:/u/settings.json', b, 'win32'))
    expect(hookKey('/u/settings.json', a, 'linux')).not.toBe(hookKey('/u/settings.json', { ...a, matcher: 'Bash' }, 'linux'))
    expect(hookKey('/u/settings.json', a, 'linux')).toMatch(/^[0-9a-f]{24}$/)
  })
})

describe('removeHookEntry / restoreHookEntry', () => {
  it('removes one entry, dropping empty groups, events and the hooks key, other keys kept', () => {
    const lint = { event: 'PreToolUse', matcher: 'Bash', hook: { type: 'command', command: 'lint.sh' } }
    const next = removeHookEntry(settings, lint)!
    expect((next.hooks as Record<string, unknown[]>).PreToolUse[0]).toEqual({ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook' }] })
    expect(Object.keys(next)).toEqual(['model', 'hooks', 'statusLine'])
    const fmt = { event: 'PreToolUse', matcher: 'Edit|Write', hook: { type: 'command', command: 'fmt.sh' } }
    expect((removeHookEntry(settings, fmt)!.hooks as Record<string, unknown[]>).PreToolUse).toHaveLength(1)
    const only = { hooks: { Stop: [{ hooks: [{ type: 'command', command: 'z' }] }] }, a: 1 }
    expect(removeHookEntry(only, { event: 'Stop', matcher: null, hook: { type: 'command', command: 'z' } })).toEqual({ a: 1 })
    expect(removeHookEntry(settings, { event: 'Stop', matcher: null, hook: { command: 'nope' } })).toBeNull()
    expect(removeHookEntry(settings, { ...lint, matcher: 'Edit' })).toBeNull()
  })
  it('puts an entry back into its matcher group or a new group, and is a no-op when present', () => {
    const lint = { event: 'PreToolUse', matcher: 'Bash', hook: { type: 'command', command: 'lint.sh' } }
    const without = removeHookEntry(settings, lint)!
    const back = restoreHookEntry(without, lint)
    expect(back).toEqual(settings)
    expect(restoreHookEntry(settings, lint)).toBe(settings)
    const fresh = restoreHookEntry({ a: 1 }, { event: 'Stop', matcher: null, hook: { type: 'command', command: 'z' } })
    expect(fresh).toEqual({ a: 1, hooks: { Stop: [{ hooks: [{ type: 'command', command: 'z' }] }] } })
    const grouped = restoreHookEntry({ hooks: {} }, { event: 'PostToolUse', matcher: 'Edit', hook: { type: 'command', command: 'y' } })
    expect(grouped).toEqual({ hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'y' }] }] } })
  })
})

describe('maskHookText', () => {
  it('masks env assignments, flags, bearer tokens, URL credentials and known tokens; home becomes ~', () => {
    const home = '/home/me'
    const out = maskHookText(
      'API_KEY=abc123 GITHUB_TOKEN="x y" node /home/me/h.js --token s3cr3t --api-key=zz curl -H "Authorization: Bearer abcdefghijkl" https://u:p@host/x?token=qq sk-abcdefghijklmnop',
      home,
      'linux',
    )
    expect(out).not.toMatch(/abc123|x y|s3cr3t|=zz|abcdefghijkl|u:p@|qq|sk-abc/)
    expect(out).toContain('~/h.js')
    expect(out).toContain('API_KEY=••••')
    expect(maskHookText('node "${CLAUDE_PLUGIN_ROOT}/hooks/run.js" --verbose', home, 'linux')).toBe('node "${CLAUDE_PLUGIN_ROOT}/hooks/run.js" --verbose')
  })
})

describe('fakePayload', () => {
  it('builds the event fields with the base keys', () => {
    const p = fakePayload('PreToolUse', 'Edit|Write', '/w', 's1')
    expect(p).toMatchObject({ session_id: 's1', cwd: '/w', hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/w/orrery-hook-test.txt' } })
    expect(fakePayload('PreToolUse', '*', '/w', 's').tool_name).toBe('Bash')
    expect(fakePayload('SessionStart', 'resume|clear', '/w', 's').source).toBe('resume')
    expect(fakePayload('PreCompact', 'auto', '/w', 's')).toMatchObject({ trigger: 'auto', custom_instructions: null })
    expect(fakePayload('SubagentStop', null, '/w', 's')).toMatchObject({ stop_hook_active: false, agent_type: 'general-purpose' })
    expect(Object.keys(fakePayload('Whatever', null, '/w', 's'))).toEqual(['session_id', 'transcript_path', 'cwd', 'hook_event_name', 'permission_mode'])
  })
  it('clipOutput keeps the tail', () => {
    expect(clipOutput('abcdef', 3)).toEqual({ text: '…def', cut: true })
    expect(clipOutput('ab', 3)).toEqual({ text: 'ab', cut: false })
  })
})

describe('shellFor / testEnv', () => {
  it('uses exec form, PowerShell when asked, Git Bash on Windows when present', () => {
    expect(shellFor({ args: ['a', 1, 'b'] }, 'node', {}, 'linux')).toEqual({ file: 'node', args: ['a', 'b'] })
    expect(shellFor({ shell: 'powershell' }, 'x', {}, 'win32').file).toBe('powershell.exe')
    expect(shellFor({}, 'x', { ProgramFiles: 'C:\\PF' }, 'win32', (p) => p === 'C:\\PF\\Git\\bin\\bash.exe')).toEqual({ file: 'C:\\PF\\Git\\bin\\bash.exe', args: ['-c', 'x'] })
    expect(shellFor({}, 'x', {}, 'win32', () => false).file).toBe('powershell.exe')
    expect(shellFor({}, 'x', { SHELL: '/bin/zsh' }, 'darwin')).toEqual({ file: '/bin/zsh', args: ['-c', 'x'] })
  })
  it('keeps only the minimal environment', () => {
    const env = testEnv({ PATH: '/bin', Path: 'C:\\x', HOME: '/h', ANTHROPIC_API_KEY: 'k', CCM_APP_KEY: 'a', GITHUB_TOKEN: 't', SystemRoot: 'C:\\W' }, '/p', '/plug')
    expect(env).toEqual({ PATH: '/bin', Path: 'C:\\x', HOME: '/h', SystemRoot: 'C:\\W', CLAUDE_PROJECT_DIR: '/p', CLAUDE_PLUGIN_ROOT: '/plug' })
  })
})

describe('HooksManager', () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'ccm-hooks-'))
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))
  const home = path.join(tmp, 'home')
  const root = path.join(home, '.claude')
  const dataDir = path.join(tmp, 'data')
  const project = path.join(tmp, 'proj')
  mkdirSync(path.join(project, '.claude'), { recursive: true })
  mkdirSync(dataDir, { recursive: true })
  const userFile = path.join(root, 'settings.json')
  const plugin = path.join(root, 'plugins', 'cache', 'mk', 'demo', '1.0.0')
  mkdirSync(path.join(plugin, 'hooks'), { recursive: true })
  mkdirSync(path.join(plugin, '.claude-plugin'), { recursive: true })
  const userText = `{\n    "model": "opus",\n    "hooks": {\n        "Stop": [{ "hooks": [{ "type": "command", "command": "say done" }] }],\n        "PreCompact": [{ "hooks": [{ "type": "command", "command": "node \\"/x/hook-bridge.mjs\\"", "async": true }] }]\n    },\n    "enabledPlugins": { "demo@mk": true, "off@mk": false }\n}\n`
  writeFileSync(userFile, userText)
  writeFileSync(path.join(project, '.claude', 'settings.local.json'), JSON.stringify({ hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'TOKEN=abc fmt' }] }] } }))
  writeFileSync(path.join(plugin, 'hooks', 'hooks.json'), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/s.js"' }] }] } }))
  writeFileSync(path.join(plugin, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'demo', hooks: { UserPromptSubmit: [{ hooks: [{ type: 'http', url: 'https://x' }] }] } }))
  writeFileSync(
    path.join(root, 'plugins', 'installed_plugins.json'),
    JSON.stringify({ version: 2, plugins: { 'demo@mk': [{ scope: 'user', installPath: plugin }], 'evil@mk': [{ scope: 'user', installPath: tmp }] } }),
  )

  const confirmWrite = vi.fn(async () => true)
  const confirmTest = vi.fn(async () => true)
  const make = (spawn?: SpawnFn) => new HooksManager({ env: { PATH: process.env.PATH }, home, platform: process.platform, dataDir, confirmWrite, confirmTest, spawn })

  it('lists user + project-local + plugin hooks, Orrery bridge badged, plugin outside the plugins folder skipped', async () => {
    const res = await make().list(project)
    if (!res.ok) throw new Error('list failed')
    const brief = res.rows.map((r) => [r.event, r.source, r.orrery, r.toggleable, r.testable, r.plugin ?? null])
    expect(brief).toEqual([
      ['SessionStart', 'plugin', false, false, true, 'demo@mk'],
      ['UserPromptSubmit', 'plugin', false, false, false, 'demo@mk'],
      ['PostToolUse', 'local', false, true, true, null],
      ['Stop', 'user', false, true, true, null],
      ['PreCompact', 'user', true, false, false, null],
    ])
    expect(res.rows.find((r) => r.source === 'local')!.text).toBe('TOKEN=•••• fmt')
    expect(res.files).toEqual([
      { source: 'user', state: 'ok' },
      { source: 'project', state: 'none' },
      { source: 'local', state: 'ok' },
    ])
    const global = await make().list(null)
    expect(global.ok && global.rows.some((r) => r.source === 'local')).toBe(false)
  })

  it('turns a hook off into the stash and back on, keeping formatting, backup and other keys', async () => {
    const m = make()
    const list = await m.list(null)
    if (!list.ok) throw new Error('list failed')
    const stop = list.rows.find((r) => r.event === 'Stop')!
    expect(await m.toggle(stop.id, null, false)).toEqual({ ok: true })
    const after = readFileSync(userFile, 'utf8')
    expect(after).not.toContain('say done')
    expect(after).toContain('\n    "model": "opus"')
    expect(after).toContain('enabledPlugins')
    expect(readFileSync(`${userFile}.ccm-backup`, 'utf8')).toBe(userText)
    const stash = JSON.parse(readFileSync(path.join(dataDir, HOOKS_STASH_FILE), 'utf8'))
    expect(stash.entries).toHaveLength(1)
    expect(confirmWrite.mock.calls.at(-1)![0]).toMatchObject({ action: 'disable', event: 'Stop' })

    const off = await m.list(null)
    const row = off.ok ? off.rows.find((r) => r.event === 'Stop')! : null
    expect(row).toMatchObject({ enabled: false, id: stop.id })
    expect(await m.toggle(stop.id, null, true)).toEqual({ ok: true })
    expect(JSON.parse(readFileSync(userFile, 'utf8'))).toEqual(JSON.parse(userText))
    expect(JSON.parse(readFileSync(path.join(dataDir, HOOKS_STASH_FILE), 'utf8')).entries).toEqual([])
  })

  it('refuses Orrery and plugin hooks, bad ids, cancels and files changed during the confirm', async () => {
    const m = make()
    const list = await m.list(project)
    if (!list.ok) throw new Error('list failed')
    const bridge = list.rows.find((r) => r.orrery)!
    const pluginRow = list.rows.find((r) => r.source === 'plugin')!
    expect(await m.toggle(bridge.id, project, false)).toEqual({ ok: false, error: 'orrery' })
    expect(await m.toggle(pluginRow.id, project, false)).toEqual({ ok: false, error: 'readOnly' })
    expect(await m.toggle('../x', project, false)).toEqual({ ok: false, error: 'invalid' })
    const local = list.rows.find((r) => r.source === 'local')!
    confirmWrite.mockResolvedValueOnce(false)
    expect(await m.toggle(local.id, project, false)).toEqual({ ok: false, error: 'cancelled' })
    const file = path.join(project, '.claude', 'settings.local.json')
    confirmWrite.mockImplementationOnce(async () => {
      writeFileSync(file, `${readFileSync(file, 'utf8')} `)
      return true
    })
    expect(await m.toggle(local.id, project, false)).toEqual({ ok: false, error: 'changed' })
    expect(readFileSync(file, 'utf8')).toContain('TOKEN=abc')
    expect(existsSync(`${file}.ccm-backup`)).toBe(false)
  })

  it('test-runs a command with the fake payload on stdin, asking once per hook', async () => {
    const calls: { file: string; args: string[]; env: NodeJS.ProcessEnv | undefined; cwd: unknown; stdin: string }[] = []
    const spawn: SpawnFn = (file, args, opts) => {
      const child = new EventEmitter() as ChildProcess & EventEmitter
      const stdin = new PassThrough()
      const stdout = new PassThrough()
      const stderr = new PassThrough()
      let input = ''
      stdin.on('data', (c) => (input += String(c)))
      stdin.on('finish', () => {
        calls.push({ file, args, env: opts.env, cwd: opts.cwd, stdin: input })
        stdout.write('ok GITHUB_TOKEN=abc\n')
        stderr.write('warn\n')
        setTimeout(() => child.emit('close', 2), 5)
      })
      Object.assign(child, { stdin, stdout, stderr, pid: undefined })
      return child
    }
    const m = make(spawn)
    const list = await m.list(project)
    if (!list.ok) throw new Error('list failed')
    const local = list.rows.find((r) => r.source === 'local')!
    confirmTest.mockClear()
    const res = await m.test(local.id, project)
    expect(res).toMatchObject({ ok: true, code: 2, timedOut: false, stderr: 'warn\n' })
    expect(res.ok && res.stdout).toBe('ok GITHUB_TOKEN=••••\n')
    expect(JSON.parse(calls[0]!.stdin)).toMatchObject({ hook_event_name: 'PostToolUse', tool_name: 'Edit', cwd: project })
    expect(calls[0]!.env).toMatchObject({ CLAUDE_PROJECT_DIR: project })
    expect(calls[0]!.cwd).toBe(project)
    await m.test(local.id, project)
    expect(confirmTest).toHaveBeenCalledTimes(1)
    const pluginRow = list.rows.find((r) => r.event === 'SessionStart')!
    await m.test(pluginRow.id, project)
    expect(calls[2]!.args.join(' ')).toContain(path.join(plugin, 's.js').replace(/\\/g, '/').split('/').pop()!)
    expect(calls[2]!.env).toMatchObject({ CLAUDE_PLUGIN_ROOT: expect.any(String) })
    const bridge = list.rows.find((r) => r.orrery)!
    expect(await m.test(bridge.id, project)).toEqual({ ok: false, error: 'notTestable' })
  })
})
