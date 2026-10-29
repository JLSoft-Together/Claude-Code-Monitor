import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { cleanRules, jsonDiff, parseAsks, planAllow, readPermissions, writeAllow } from '../src/preview/permRules'

const NOW = Date.parse('2026-10-29T10:00:00Z')

describe('parseAsks', () => {
  const root = path.resolve('/work/shop')
  const line = (o: object) => JSON.stringify(o)
  it('keeps recent asks inside the root with safe rules and prefixes only', () => {
    const text = [
      line({ at: '2026-10-29T09:00:00Z', cwd: path.join(root, 'app'), tool: 'Bash', rules: ['Bash(npm run test:*)', 'Bash(cat "/etc/passwd")'], prefix: 'npm run' }),
      line({ at: '2026-10-20T09:00:00Z', cwd: root, tool: 'Bash', rules: [] }),
      line({ at: '2026-10-29T09:30:00Z', cwd: path.resolve('/work/other'), tool: 'Edit', rules: [] }),
      line({ at: '2026-10-29T09:10:00Z', cwd: root, tool: 'WebFetch', rules: ['WebFetch(domain:pub.dev)'], prefix: 'x=1' }),
      'not json',
      line({ at: '2026-10-29T09:20:00Z', cwd: root, tool: 'rm -rf /' }),
    ].join('\n')
    expect(parseAsks(text, root, NOW)).toEqual([
      { at: '2026-10-29T09:00:00.000Z', tool: 'Bash', rules: ['Bash(npm run test:*)'], prefix: 'npm run' },
      { at: '2026-10-29T09:10:00.000Z', tool: 'WebFetch', rules: ['WebFetch(domain:pub.dev)'] },
    ])
  })
})

describe('cleanRules / planAllow', () => {
  it('accepts ticked rules, refuses malformed and risky ones', () => {
    expect(cleanRules(['Bash(npm run test:*)', 'Edit', 'Edit', 'WebFetch(domain:pub.dev)', 'mcp__github__get_me'])).toEqual(['Bash(npm run test:*)', 'Edit', 'WebFetch(domain:pub.dev)', 'mcp__github__get_me'])
    expect(cleanRules(['Bash'])).toBe('risky')
    expect(cleanRules(['Bash(*)'])).toBe('risky')
    expect(cleanRules(['Bash(rm -rf:*)'])).toBe('risky')
    expect(cleanRules(['Bash(git push:*)'])).toBe('risky')
    expect(cleanRules(['Bash(npm test && curl x)'])).toBe('risky')
    expect(cleanRules(['bad rule('])).toBeNull()
    expect(cleanRules([])).toBeNull()
    expect(cleanRules('Edit')).toBeNull()
  })

  it('appends only new rules and keeps every other key', () => {
    const settings = { model: 'opus', permissions: { allow: ['Edit'], deny: ['WebSearch'], defaultMode: 'acceptEdits' }, env: { A: '1' } }
    const { next, added } = planAllow(settings, ['Edit', 'Bash(npm test:*)'])
    expect(added).toEqual(['Bash(npm test:*)'])
    expect(next).toEqual({ model: 'opus', permissions: { allow: ['Edit', 'Bash(npm test:*)'], deny: ['WebSearch'], defaultMode: 'acceptEdits' }, env: { A: '1' } })
    expect(Object.keys(next)).toEqual(['model', 'permissions', 'env'])
  })

  it('diffs the file line by line', () => {
    const before = '{\n  "permissions": {\n    "allow": [\n      "Edit"\n    ]\n  }\n}\n'
    const after = '{\n  "permissions": {\n    "allow": [\n      "Edit",\n      "Bash(npm test:*)"\n    ]\n  }\n}\n'
    expect(jsonDiff(before, after)).toBe(['  {', '    "permissions": {', '      "allow": [', '-       "Edit"', '+       "Edit",', '+       "Bash(npm test:*)"', '      ]', '    }', '  }'].join('\n'))
  })
})

describe('writeAllow', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ccm-perm-'))
  const root = path.join(dir, 'proj')
  const local = path.join(root, '.claude', 'settings.local.json')
  const shared = path.join(root, '.claude', 'settings.json')
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('creates settings.local.json after the confirm and never touches settings.json', async () => {
    mkdirSync(path.join(root, '.claude'), { recursive: true })
    writeFileSync(shared, '{"permissions":{"allow":["Read"]}}')
    const confirm = vi.fn(async () => true)
    expect(await writeAllow(root, ['Bash(npm test:*)'], confirm)).toEqual({ ok: true, added: ['Bash(npm test:*)'] })
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ file: local, added: ['Bash(npm test:*)'], diff: expect.stringContaining('+       "Bash(npm test:*)"') }))
    expect(JSON.parse(readFileSync(local, 'utf8'))).toEqual({ permissions: { allow: ['Bash(npm test:*)'] } })
    expect(readFileSync(shared, 'utf8')).toBe('{"permissions":{"allow":["Read"]}}')
  })

  it('merges into an existing file with its indent, keeps a backup, skips rules already there', async () => {
    writeFileSync(local, '{\n\t"model": "opus",\n\t"permissions": {\n\t\t"allow": ["Bash(npm test:*)"]\n\t}\n}\n')
    const confirm = vi.fn(async () => true)
    expect(await writeAllow(root, ['Bash(npm test:*)'], confirm)).toEqual({ ok: true, added: [] })
    expect(confirm).not.toHaveBeenCalled()
    expect(await writeAllow(root, ['Edit', 'Bash(npm test:*)'], confirm)).toEqual({ ok: true, added: ['Edit'] })
    const text = readFileSync(local, 'utf8')
    expect(text).toContain('\n\t"model": "opus"')
    expect(JSON.parse(text)).toEqual({ model: 'opus', permissions: { allow: ['Bash(npm test:*)', 'Edit'] } })
    expect(readFileSync(`${local}.ccm-backup`, 'utf8')).toContain('"allow": ["Bash(npm test:*)"]')
    const perms = await readPermissions(root, null, NOW)
    expect(perms).toMatchObject({ ok: true, shared: { state: 'ok', allow: ['Read'] }, local: { state: 'ok', allow: ['Bash(npm test:*)', 'Edit'] } })
  })

  it('writes nothing when cancelled, when the file changed meanwhile, or when it is not plain JSON', async () => {
    const before = readFileSync(local, 'utf8')
    expect(await writeAllow(root, ['WebSearch'], async () => false)).toEqual({ ok: false, error: 'cancelled' })
    expect(readFileSync(local, 'utf8')).toBe(before)
    const changed = await writeAllow(root, ['WebSearch'], async () => {
      writeFileSync(local, before.replace('opus', 'sonnet'))
      return true
    })
    expect(changed).toEqual({ ok: false, error: 'changed' })
    expect(readFileSync(local, 'utf8')).toContain('sonnet')
    writeFileSync(local, '{ // comment\n}')
    expect(await writeAllow(root, ['WebSearch'], async () => true)).toEqual({ ok: false, error: 'unreadable' })
    expect(await writeAllow(root, ['Bash(*)'], async () => true)).toEqual({ ok: false, error: 'risky' })
  })
})
