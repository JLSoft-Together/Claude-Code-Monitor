import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ancestors, contextSources, cwdSlug, importsOf } from '../src/preview/contextSources'

describe('importsOf', () => {
  it('finds @imports outside code, relative to the file or home', () => {
    const text = ['See @docs/rules.md and @~/notes/me.md.', '`@not/this.md`', '```', '@nor/this.md', '```', 'mail a@b.com', '@Composable fun x()', '@../up.md'].join('\n')
    expect(importsOf(text, path.resolve('/p'), path.resolve('/h'))).toEqual([path.resolve('/p/docs/rules.md'), path.join(path.resolve('/h'), 'notes/me.md'), path.resolve('/up.md')])
  })

  it('lists folders from the root down', () => {
    const list = ancestors(path.resolve('/a/b'))
    expect(list.slice(-2)).toEqual([path.resolve('/a'), path.resolve('/a/b')])
    expect(path.dirname(list[0]!)).toBe(list[0])
  })
})

describe('contextSources', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ccm-ctx-'))
  const home = path.join(dir, 'home')
  const config = path.join(home, '.claude')
  const proj = path.join(dir, 'work', 'app')
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, text)
  }

  it('lists CLAUDE.md files, imports, rules, memory, skills and MCP names with sizes', async () => {
    write(path.join(config, 'CLAUDE.md'), '# user\n@RTK.md\n')
    write(path.join(config, 'RTK.md'), 'rtk\n')
    write(path.join(config, 'rules', 'style.md'), 'x\n')
    write(path.join(dir, 'work', 'CLAUDE.md'), 'parent\n')
    write(path.join(proj, 'CLAUDE.md'), 'one\ntwo\n@docs/a.md\n')
    write(path.join(proj, 'docs', 'a.md'), 'A')
    write(path.join(proj, 'CLAUDE.local.md'), 'local')
    write(path.join(proj, '.claude', 'rules', 'api', 'r.md'), 'r')
    write(path.join(proj, '.claude', 'skills', 'deploy', 'SKILL.md'), '---\nname: deploy\n---\nbody')
    write(path.join(proj, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'x@m': true, 'y@m': false } }))
    write(path.join(proj, '.mcp.json'), JSON.stringify({ mcpServers: { db: { command: 'secret' } } }))
    const mem = path.join(config, 'projects', cwdSlug(proj), 'memory')
    write(path.join(mem, 'MEMORY.md'), '- [a](a.md)\n')
    write(path.join(mem, 'a.md'), 'aaaa')
    const res = await contextSources(proj, { env: { CLAUDE_CONFIG_DIR: config }, home, platform: process.platform })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const rel = (p: string) => path.relative(dir, p).replace(/\\/g, '/')
    const mine = res.files.filter((f) => !path.relative(dir, f.path).startsWith('..'))
    expect(mine.map((f) => [rel(f.path), f.kind, f.load, f.bytes, f.lines])).toEqual([
      ['home/.claude/CLAUDE.md', 'user', 'start', 15, 2],
      ['home/.claude/RTK.md', 'import', 'start', 4, 1],
      ['home/.claude/rules/style.md', 'rules', 'start', 2, 1],
      ['work/CLAUDE.md', 'project', 'start', 7, 1],
      ['work/app/CLAUDE.md', 'project', 'start', 19, 3],
      ['work/app/docs/a.md', 'import', 'start', 1, 1],
      ['work/app/CLAUDE.local.md', 'local', 'start', 5, 1],
      ['work/app/.claude/rules/api/r.md', 'rules', 'start', 1, 1],
      ['home/.claude/projects/' + cwdSlug(proj) + '/memory/MEMORY.md', 'memory-index', 'start', 12, 1],
      ['home/.claude/projects/' + cwdSlug(proj) + '/memory/a.md', 'memory', 'on-demand', 4, undefined],
      ['work/app/.claude/skills/deploy/SKILL.md', 'skill', 'listed', 25, undefined],
      ['work/app/.mcp.json', 'mcp-config', 'start', 42, undefined],
    ])
    expect(mine[1]!.from).toBe(path.join(config, 'CLAUDE.md'))
    expect(res.mcp).toEqual([{ name: 'db', scopes: ['project'] }])
    expect(res.plugins).toEqual(['x@m'])
    expect(JSON.stringify(res)).not.toContain('secret')
  })

  it('labels ~/.claude/CLAUDE.md as user when CLAUDE_CONFIG_DIR points elsewhere', async () => {
    const other = path.join(dir, 'other-config')
    const inHome = path.join(home, 'code', 'app')
    write(path.join(inHome, 'CLAUDE.md'), 'p\n')
    const res = await contextSources(inHome, { env: { CLAUDE_CONFIG_DIR: other }, home, platform: process.platform })
    if (!res.ok) throw new Error('scan failed')
    const kindOf = (p: string) => res.files.find((f) => path.resolve(f.path) === path.resolve(p))?.kind
    expect(kindOf(path.join(config, 'CLAUDE.md'))).toBe('user')
    expect(kindOf(path.join(inHome, 'CLAUDE.md'))).toBe('project')
  })
})
