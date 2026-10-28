import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe as group, expect, it } from 'vitest'
import { describe, listCommands, userCommandsDir } from '../src/preview/commands'

const tmp = mkdtempSync(path.join(os.tmpdir(), 'ccm-cmds-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

group('commands', () => {
  it('reads the description from front matter or the first line', () => {
    expect(describe('---\nallowed-tools: Bash\ndescription: "Run the tests"\n---\n# Body')).toBe('Run the tests')
    expect(describe('\n# Review the diff\nmore')).toBe('Review the diff')
    expect(describe('---\nname: x\n---\n\nPlain first line')).toBe('Plain first line')
  })

  it('lists top-level md files of each dir with their scope', async () => {
    const project = path.join(tmp, 'p', '.claude', 'commands')
    const user = path.join(tmp, 'u', 'commands')
    mkdirSync(path.join(project, 'nested'), { recursive: true })
    mkdirSync(user, { recursive: true })
    writeFileSync(path.join(project, 'fix.md'), '---\ndescription: Fix it\n---\n')
    writeFileSync(path.join(project, 'nested', 'deep.md'), 'deep')
    writeFileSync(path.join(project, 'notes.txt'), 'x')
    writeFileSync(path.join(user, 'review.md'), '# Review')
    const list = await listCommands([
      { dir: project, scope: 'project' },
      { dir: user, scope: 'user' },
      { dir: path.join(tmp, 'missing'), scope: 'user' },
    ])
    expect(list).toEqual([
      { name: 'fix', description: 'Fix it', scope: 'project' },
      { name: 'review', description: 'Review', scope: 'user' },
    ])
  })

  it('uses CLAUDE_CONFIG_DIR for user commands', () => {
    expect(userCommandsDir({ CLAUDE_CONFIG_DIR: path.join(tmp, 'cfg') })).toBe(path.join(tmp, 'cfg', 'commands'))
  })
})
