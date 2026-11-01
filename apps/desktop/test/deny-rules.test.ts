import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { SECRET_FILE_GLOBS, denyRulesFor } from '@ccm/shared'
import { denyFile, isSessionProject, planDeny, sessionCwds, writeDeny } from '../src/preview/denyRules'

describe('denyRulesFor', () => {
  it('maps secret and simple custom globs to one Edit rule for file tools only', () => {
    for (const g of SECRET_FILE_GLOBS) expect(denyRulesFor(g, 'Write')).toEqual([`Edit(**/${g})`])
    expect(denyRulesFor('.env*', 'NotebookEdit')).toEqual(['Edit(**/.env*)'])
    expect(denyRulesFor('custom:*.secret', 'Edit')).toEqual(['Edit(**/*.secret)'])
    expect(denyRulesFor('.env*', 'Bash')).toEqual([])
    expect(denyRulesFor('custom:config/prod/**', 'Edit')).toEqual([])
    expect(denyRulesFor('custom:*', 'Edit')).toEqual([])
    expect(denyRulesFor('custom:a(b)', 'Edit')).toEqual([])
  })

  it('maps command rules per shell tool, none for rules with no faithful prefix', () => {
    expect(denyRulesFor('git-force-push', 'Bash')).toEqual(['Bash(git push --force *)', 'Bash(git push -f *)', 'Bash(git push * --force *)', 'Bash(git push * -f *)'])
    expect(denyRulesFor('git-reset-hard', 'PowerShell')).toEqual(['PowerShell(git reset --hard *)', 'PowerShell(git reset * --hard *)'])
    expect(denyRulesFor('git-clean', 'Bash')).toEqual(['Bash(git clean *)'])
    expect(denyRulesFor('rm-rf', 'Bash')).toEqual(['Bash(rm -rf *)', 'Bash(rm -fr *)', 'Bash(rm -Rf *)'])
    expect(denyRulesFor('adb-uninstall', 'Bash')).toEqual(['Bash(adb uninstall *)', 'Bash(adb * uninstall *)'])
    expect(denyRulesFor('rm-rf', 'PowerShell')).toEqual([])
    for (const r of ['outside-project', 'drop-table', 'del-s', 'remove-item-recurse']) expect(denyRulesFor(r, 'Bash')).toEqual([])
    expect(denyRulesFor('git-force-push', 'Edit')).toEqual([])
    expect(denyRulesFor('Bash(curl *)', 'Bash')).toEqual([])
    expect(denyRulesFor(undefined, 'Bash')).toEqual([])
  })
})

describe('planDeny', () => {
  it('appends new deny rules once, keeps other keys and their order', () => {
    const settings = { model: 'opus', permissions: { allow: ['Edit'], deny: ['Bash(git push --force *)'], defaultMode: 'acceptEdits' }, env: { A: '1' } }
    const { next, added } = planDeny(settings, ['Bash(git push --force *)', 'Bash(git push -f *)', 'Bash(git push -f *)'])
    expect(added).toEqual(['Bash(git push -f *)'])
    expect(next).toEqual({ model: 'opus', permissions: { allow: ['Edit'], deny: ['Bash(git push --force *)', 'Bash(git push -f *)'], defaultMode: 'acceptEdits' }, env: { A: '1' } })
    expect(Object.keys(next)).toEqual(['model', 'permissions', 'env'])
  })
})

describe('writeDeny', () => {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ccm-deny-')))
  const project = path.join(dir, 'proj')
  const config = path.join(dir, 'config')
  const shared = path.join(project, '.claude', 'settings.json')
  const local = path.join(project, '.claude', 'settings.local.json')
  mkdirSync(project, { recursive: true })
  mkdirSync(config, { recursive: true })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const req = (scope: string, rule = '.env*', tool = 'Edit') => ({ project, rule, tool, scope, configDir: config })

  it('picks the file per scope', () => {
    expect(denyFile('project', project, config)).toBe(shared)
    expect(denyFile('local', project, config)).toBe(local)
    expect(denyFile('user', project, config)).toBe(path.join(config, 'settings.json'))
  })

  it('creates the file after the confirm saw file, rules and diff', async () => {
    const confirm = vi.fn(async () => true)
    expect(await writeDeny(req('local'), confirm)).toEqual({ ok: true, scope: 'local', added: ['Edit(**/.env*)'] })
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ file: local, scope: 'local', added: ['Edit(**/.env*)'], diff: expect.stringContaining('+       "Edit(**/.env*)"') }))
    expect(JSON.parse(readFileSync(local, 'utf8'))).toEqual({ permissions: { deny: ['Edit(**/.env*)'] } })
    expect(existsSync(`${local}.orrery-bak`)).toBe(false)
  })

  it('merges into an existing file with its indent and EOL, backs it up, skips duplicates', async () => {
    const before = '{\r\n\t"model": "opus",\r\n\t"permissions": {\r\n\t\t"allow": ["Read"],\r\n\t\t"deny": ["Bash(git push -f *)"]\r\n\t},\r\n\t"env": {}\r\n}\r\n'
    mkdirSync(path.dirname(shared), { recursive: true })
    writeFileSync(shared, before)
    const res = await writeDeny(req('project', 'git-force-push', 'Bash'), async () => true)
    expect(res).toEqual({ ok: true, scope: 'project', added: ['Bash(git push --force *)', 'Bash(git push * --force *)', 'Bash(git push * -f *)'] })
    const text = readFileSync(shared, 'utf8')
    expect(text).toContain('\r\n\t"model": "opus"')
    expect(Object.keys(JSON.parse(text))).toEqual(['model', 'permissions', 'env'])
    expect(JSON.parse(text).permissions.deny).toHaveLength(4)
    expect(readFileSync(`${shared}.orrery-bak`, 'utf8')).toBe(before)
    const again = vi.fn(async () => true)
    expect(await writeDeny(req('project', 'git-force-push', 'Bash'), again)).toEqual({ ok: true, scope: 'project', added: [] })
    expect(again).not.toHaveBeenCalled()
  })

  it('writes user settings under the config dir', async () => {
    expect(await writeDeny(req('user', 'custom:*.secret'), async () => true)).toEqual({ ok: true, scope: 'user', added: ['Edit(**/*.secret)'] })
    expect(JSON.parse(readFileSync(path.join(config, 'settings.json'), 'utf8')).permissions.deny).toEqual(['Edit(**/*.secret)'])
  })

  it('refuses invalid JSON, a non-array deny, unknown rules / scopes and a cancelled confirm', async () => {
    writeFileSync(local, '{ "permissions": { "deny": [ } ')
    const confirm = vi.fn(async () => true)
    expect(await writeDeny(req('local'), confirm)).toEqual({ ok: false, error: 'unreadable' })
    writeFileSync(local, '{"permissions":{"deny":"Edit"}}')
    expect(await writeDeny(req('local'), confirm)).toEqual({ ok: false, error: 'unreadable' })
    expect(confirm).not.toHaveBeenCalled()
    expect(readFileSync(local, 'utf8')).toBe('{"permissions":{"deny":"Edit"}}')
    expect(await writeDeny(req('local', 'outside-project'), confirm)).toEqual({ ok: false, error: 'invalid' })
    expect(await writeDeny(req('elsewhere'), confirm)).toEqual({ ok: false, error: 'invalid' })
    rmSync(local)
    expect(await writeDeny(req('local'), async () => false)).toEqual({ ok: false, error: 'cancelled' })
    expect(existsSync(local)).toBe(false)
  })
})

describe('session project check', () => {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ccm-deny-p-')))
  const config = path.join(dir, 'config')
  const repo = path.join(dir, 'repo')
  const app = path.join(repo, 'app')
  const plain = path.join(dir, 'plain')
  const sub = path.join(plain, 'sub')
  for (const d of [path.join(config, 'sessions'), path.join(repo, '.git'), app, sub]) mkdirSync(d, { recursive: true })
  writeFileSync(path.join(config, 'sessions', '1.json'), JSON.stringify({ pid: 1, cwd: app, sessionId: 'x' }))
  writeFileSync(path.join(config, 'sessions', '2.json'), JSON.stringify({ pid: 2, cwd: sub }))
  writeFileSync(path.join(config, 'sessions', '3.json'), 'nope')
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('accepts a session folder or the git root above it, nothing else', async () => {
    const cwds = await sessionCwds(config)
    expect(cwds.sort()).toEqual([app, sub].sort())
    expect(await isSessionProject(app, cwds)).toBe(true)
    expect(await isSessionProject(repo, cwds)).toBe(true)
    expect(await isSessionProject(sub, cwds)).toBe(true)
    expect(await isSessionProject(plain, cwds)).toBe(false)
    expect(await isSessionProject(dir, cwds)).toBe(false)
    expect(await sessionCwds(path.join(dir, 'missing'))).toEqual([])
  })
})
