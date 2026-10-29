import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { cwdSlug } from '../src/preview/contextSources'
import { frontmatter, INDEX_LINES, LARGE_CHARS, lintDocs, pathTokens, type LintDoc } from '../src/preview/memoryDoctor'
import { memoryDoctor } from '../src/preview/memoryDoctorIo'

const P = path.resolve('/proj')
const MEM = path.resolve('/cfg/projects/x/memory')
const at = (...p: string[]) => path.join(...p)

describe('memory doctor lint', () => {
  it('reads top-level and metadata frontmatter', () => {
    const fm = frontmatter('---\nname: a\ndescription: "d"\nmetadata:\n  type: feedback\n  name: ignored\n---\nbody')
    expect(Object.fromEntries(fm!.fields)).toEqual({ name: 'a', description: 'd', type: 'feedback' })
    expect(fm!.end).toBe(7)
    expect(frontmatter('no fm')).toBeNull()
  })

  it('picks relative path tokens only', () => {
    expect(pathTokens('see `apps/web/src/a.ts:12`, .planning/PLAN.md. and src/ ok/ UI/UX https://x.io/a/b.md ../up/x.md ./docs/b.md#x')).toEqual(['apps/web/src/a.ts', '.planning/PLAN.md', 'docs/b.md'])
  })

  it('finds broken links, index gaps, frontmatter, duplicates, missing paths and imports, size', async () => {
    const existing = new Set([at(MEM, 'a.md'), at(MEM, 'b.md'), at(MEM, 'c.md'), at(P, 'apps'), at(P, 'apps', 'web', 'ok.ts'), at(P, '.planning'), at(P, 'pkg', 'lib'), at(P, 'pkg', 'lib', 'x', 'y.ts')].map((p) => path.resolve(p)))
    const docs: LintDoc[] = [
      { path: at(P, 'CLAUDE.md'), role: 'instructions', text: 'Use apps/web/ok.ts and apps/web/gone.ts\n@docs/missing.md\n```\napps/web/fenced.ts\n```\nlib/x/y.ts lib/gone2.ts\n' + 'z'.repeat(LARGE_CHARS), bytes: 0, inProject: true },
      { path: at(MEM, 'MEMORY.md'), role: 'memory-index', text: '- [A](a.md) — x\n- [Gone](gone.md) — y\n- [[b]]\n' + '- l\n'.repeat(INDEX_LINES), bytes: 0, inProject: false },
      { path: at(MEM, 'a.md'), role: 'memory', text: '---\nname: same\ndescription: d\nmetadata:\n  type: user\n---\nSee [[b]] and [[nowhere]], .planning/old.md\n', bytes: 0, inProject: false },
      { path: at(MEM, 'b.md'), role: 'memory', text: '---\nname: same\ntype: project\n---\n', bytes: 0, inProject: false },
      { path: at(MEM, 'c.md'), role: 'memory', text: 'no frontmatter', bytes: 0, inProject: false },
    ]
    const { findings, truncated } = await lintDocs(docs, { cwd: P, home: path.resolve('/h'), memoryDir: MEM, subRoots: [at(P, 'pkg')], exists: async (p) => existing.has(path.resolve(p)), foldCase: false })
    expect(truncated).toBe(false)
    const short = findings.map((f) => `${path.basename(f.file)}:${f.line} ${f.kind} ${f.kind === 'missing-import' ? path.basename(f.text) : f.text}`)
    expect(short).toEqual(
      expect.arrayContaining([
        'b.md:1 frontmatter description',
        'c.md:1 frontmatter name, description, type',
        'a.md:1 duplicate-name same',
        'b.md:1 duplicate-name same',
        `MEMORY.md:${INDEX_LINES + 1} index-too-long ${INDEX_LINES + 3}`,
        'MEMORY.md:2 index-missing-file gone.md',
        'c.md:1 not-indexed c.md',
        `CLAUDE.md:1 too-large ${docs[0]!.text!.length}`,
        'CLAUDE.md:1 missing-path apps/web/gone.ts',
        'CLAUDE.md:2 missing-import missing.md',
        'CLAUDE.md:6 missing-path lib/gone2.ts',
        'a.md:7 broken-link nowhere',
        'a.md:7 missing-path .planning/old.md',
      ]),
    )
    expect(short.join('\n')).not.toMatch(/fenced|lib\/x\/y|ok\.ts|broken-link b$|a\.md:1 not-indexed|b\.md:1 not-indexed/)
    expect(findings).toHaveLength(13)
  })
})

describe('memoryDoctor (disk)', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ccm-memdoc-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, text)
  }

  it('lints the project files and the auto memory folder, marking what may be opened', async () => {
    const home = path.join(dir, 'home')
    const config = path.join(home, '.claude')
    const proj = path.join(dir, 'app')
    write(path.join(config, 'CLAUDE.md'), '# user\n')
    write(path.join(proj, 'CLAUDE.md'), 'Read docs/gone.md\n')
    write(path.join(proj, 'docs', 'here.md'), 'x')
    const mem = path.join(config, 'projects', cwdSlug(proj), 'memory')
    write(path.join(mem, 'MEMORY.md'), '- [a](a.md)\n')
    write(path.join(mem, 'a.md'), '---\nname: a\ndescription: d\ntype: user\n---\n[[ghost]]\n')
    const res = await memoryDoctor(proj, { env: { CLAUDE_CONFIG_DIR: config }, home, platform: process.platform })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const mine = res.findings.filter((f) => !path.relative(dir, f.file).startsWith('..'))
    expect(mine.map((f) => [path.basename(f.file), f.line, f.kind, f.text, f.openable])).toEqual([
      ['CLAUDE.md', 1, 'missing-path', 'docs/gone.md', true],
      ['a.md', 6, 'broken-link', 'ghost', true],
    ])
    expect(res.memoryDir).toBe(mem)
  })
})
