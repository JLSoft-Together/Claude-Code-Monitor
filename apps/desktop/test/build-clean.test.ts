import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildDirKind, isBuildRel, parseBuildClean, parseBuildRoots, type BuildProgress } from '@ccm/shared'
import { findBuildDirs, gitIgnoredOnly, isGitWorkTree, refusedRoot, type GitRun } from '../src/buildClean/scan'
import { runGit } from '../src/pty/git'
import { BuildCleanService, type BuildCleanDeps } from '../src/buildClean/service'
import type { ConfirmSpec } from '../src/agentData/service'

let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'ccm-buildclean-'))
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

function put(rel: string, text = 'x'): void {
  const file = path.join(tmp, rel)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text)
}

const noGit: GitRun = async () => ({ ok: false, stdout: '', stderr: 'fatal: not a git repository' })

describe('buildDirKind', () => {
  const s = (...n: string[]) => new Set(n)
  it('labels by the build tool next to the folder', () => {
    expect(buildDirKind('node_modules', s(), false)).toBe('node')
    expect(buildDirKind('build', s('build.gradle.kts'), false)).toBe('gradle')
    expect(buildDirKind('build', s('pubspec.yaml'), false)).toBe('flutter')
    expect(buildDirKind('target', s('cargo.toml'), false)).toBe('rust')
    expect(buildDirKind('target', s('pom.xml'), false)).toBe('maven')
    expect(buildDirKind('.venv', s(), false)).toBe('python')
  })
  it('outside git, ambiguous names need their tool; inside git they count as other', () => {
    expect(buildDirKind('out', s(), false)).toBeNull()
    expect(buildDirKind('build', s(), false)).toBeNull()
    expect(buildDirKind('.gradle', s(), false)).toBeNull()
    expect(buildDirKind('out', s(), true)).toBe('other')
    expect(buildDirKind('src', s('package.json'), true)).toBeNull()
  })
})

describe('request parsing', () => {
  it('accepts only build folder names inside the project', () => {
    expect(isBuildRel('app/build')).toBe(true)
    expect(isBuildRel('node_modules')).toBe(true)
    expect(isBuildRel('../node_modules')).toBe(false)
    expect(isBuildRel('src')).toBe(false)
    expect(isBuildRel('C:/x/build')).toBe(false)
    expect(isBuildRel('a\\build')).toBe(false)
    expect(isBuildRel('a/b/c/d/build')).toBe(false)
    expect(parseBuildClean({ items: [{ root: 'C:\\p', rel: 'src' }], trash: false })).toBeNull()
    expect(parseBuildClean({ items: [{ root: 'C:\\p', rel: 'build' }], trash: true, busy: [{ name: 'x', cwd: 'C:\\p' }] })).toEqual({
      items: [{ root: 'C:\\p', rel: 'build' }],
      trash: true,
      busy: [{ name: 'x', cwd: 'C:\\p' }],
    })
    expect(parseBuildRoots(['a', 'a', 'b'])).toEqual(['a', 'b'])
    expect(parseBuildRoots('a')).toBeNull()
  })
  it('refuses drive roots and the home folder', () => {
    expect(refusedRoot(path.parse(tmp).root, tmp)).toBe(true)
    expect(refusedRoot(tmp, tmp)).toBe(true)
    expect(refusedRoot(path.join(tmp, 'p'), tmp)).toBe(false)
  })
})

describe('findBuildDirs', () => {
  it('finds nested module build folders up to depth 4, skips .git and never enters node_modules or links', async () => {
    put('package.json', '{}')
    put('node_modules/a/node_modules/b/index.js')
    put('app/build.gradle', '')
    put('app/build/out.bin')
    put('a/b/c/package.json', '{}')
    put('a/b/c/dist/x.js')
    put('a/b/c/d/package.json', '{}')
    put('a/b/c/d/dist/x.js')
    put('.git/build/x')
    put('docs/out/readme.txt')
    const outside = path.join(tmp, '..', `${path.basename(tmp)}-outside`)
    mkdirSync(path.join(outside, 'node_modules'), { recursive: true })
    try {
      symlinkSync(outside, path.join(tmp, 'linked'), 'junction')
      const found = (await findBuildDirs(tmp, false)).map((c) => `${c.rel}:${c.kind}`).sort()
      expect(found).toEqual(['a/b/c/dist:web', 'app/build:gradle', 'node_modules:node'])
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})

describe('gitIgnoredOnly', () => {
  it('keeps ignored folders without tracked files; a git error keeps none', async () => {
    const cands = [
      { rel: 'build', name: 'build', kind: 'other' as const },
      { rel: 'dist', name: 'dist', kind: 'web' as const },
      { rel: 'out', name: 'out', kind: 'other' as const },
    ]
    const git: GitRun = async (_cwd, args) => {
      if (args.includes('check-ignore')) return { ok: true, stdout: 'build/\ndist/\n', stderr: '' }
      return { ok: true, stdout: 'dist/keep.txt\0', stderr: '' }
    }
    expect((await gitIgnoredOnly(tmp, cands, git)).map((c) => c.rel)).toEqual(['build'])
    const broken: GitRun = async () => ({ ok: false, stdout: '', stderr: 'fatal: bad' })
    expect(await gitIgnoredOnly(tmp, cands, broken)).toEqual([])
  })

  it('with real git: ignored module build folders count, a tracked dist does not', async () => {
    put('.gitignore', 'node_modules/\nbuild/\n')
    put('package.json', '{}')
    put('node_modules/x.js')
    put('app/build.gradle', '')
    put('app/build/y.class')
    put('dist/app.js')
    const g = (...a: string[]) => runGit(tmp, a)
    expect((await g('init', '-q')).ok).toBe(true)
    await g('add', '.gitignore', 'package.json', 'dist', 'app/build.gradle')
    expect(await isGitWorkTree(tmp, (cwd, args) => runGit(cwd, args))).toBe(true)
    const cands = await findBuildDirs(tmp, true)
    const kept = await gitIgnoredOnly(tmp, cands, (cwd, args) => runGit(cwd, args))
    expect(kept.map((c) => c.rel).sort()).toEqual(['app/build', 'node_modules'])
  }, 30_000)
})

function service(over: Partial<BuildCleanDeps> = {}): { svc: BuildCleanService; asked: ConfirmSpec[]; events: BuildProgress[] } {
  const asked: ConfirmSpec[] = []
  const events: BuildProgress[] = []
  const svc = new BuildCleanService({
    git: noGit,
    confirm: async (spec) => {
      asked.push(spec)
      return 0
    },
    emit: (p) => events.push(p),
    running: () => [],
    daemons: () => [],
    trash: async (p) => rmSync(p, { recursive: true }),
    texts: () => ({ cancel: 'Cancel', title: (n, s) => `Delete ${n} (${s})`, detail: (l, _m, r, tr) => `${l.join('|')} ${r ? 'reinstall' : ''} ${tr ? 'trash' : 'gone'}`, confirm: 'Delete', confirmTrash: 'Trash' }),
    home: path.join(tmp, 'home'),
    ...over,
  })
  return { svc, asked, events }
}

describe('BuildCleanService', () => {
  const root = () => path.join(tmp, 'proj')
  beforeEach(() => {
    put('proj/package.json', '{}')
    put('proj/node_modules/a/index.js', 'x'.repeat(2000))
    put('proj/dist/app.js', 'y'.repeat(500))
    put('proj/src/main.ts', 'keep')
  })

  it('scans, deletes only scanned folders after the confirm, keeps sources', async () => {
    const { svc, asked } = service()
    const [p] = (await svc.scan([root()]))!
    expect(p!.dirs.map((d) => d.rel)).toEqual(['node_modules', 'dist'])
    expect(p!.dirs[0]!.reinstall).toBe(true)
    expect(await svc.clean({ items: [{ root: root(), rel: 'build' }], trash: false, busy: [] })).toEqual({ ok: false, error: 'invalid' })
    const r = await svc.clean({ items: [{ root: root(), rel: 'node_modules' }], trash: false, busy: [] })
    expect(r).toMatchObject({ ok: true, dirs: 1, failed: 0, removed: [{ root: root(), rel: 'node_modules' }] })
    expect(asked[0]!.message).toBe('Delete 1 (2 KB)')
    expect(asked[0]!.detail).toContain('reinstall')
    expect(existsSync(path.join(root(), 'node_modules'))).toBe(false)
    expect(existsSync(path.join(root(), 'src', 'main.ts'))).toBe(true)
  })

  it('refuses while something runs in the project, and asks about Gradle daemons', async () => {
    const { svc, asked } = service({ running: () => ['node (42)'], daemons: () => [{ pid: 7, start: '1', name: 'java' }] })
    await svc.scan([root()])
    const r = await svc.clean({ items: [{ root: root(), rel: 'dist' }], trash: false, busy: [{ name: 'shell', cwd: path.join(root(), 'src') }] })
    expect(r).toEqual({ ok: false, error: 'running', holders: ['node (42)', 'shell'] })
    expect(asked).toHaveLength(0)
    expect(existsSync(path.join(root(), 'dist'))).toBe(true)
  })

  it('gradle folders wait for the daemon question unless the owner chose to go on', async () => {
    put('proj/build.gradle', '')
    put('proj/build/x.class')
    const { svc } = service({ daemons: () => [{ pid: 7, start: '1', name: 'java' }] })
    await svc.scan([root()])
    expect(await svc.clean({ items: [{ root: root(), rel: 'build' }], trash: false, busy: [] })).toMatchObject({ ok: false, error: 'daemons' })
    expect(await svc.clean({ items: [{ root: root(), rel: 'build' }], trash: false, busy: [], ignoreDaemons: true })).toMatchObject({ ok: true, dirs: 1 })
  })

  it('cancel at the confirm deletes nothing; trash goes through the trash hook', async () => {
    const trashed: string[] = []
    const { svc } = service({ confirm: async () => 1 })
    await svc.scan([root()])
    expect(await svc.clean({ items: [{ root: root(), rel: 'dist' }], trash: false, busy: [] })).toEqual({ ok: false, error: 'cancelled' })
    expect(existsSync(path.join(root(), 'dist'))).toBe(true)
    const t2 = service({
      trash: async (p) => {
        trashed.push(p)
        rmSync(p, { recursive: true })
      },
    })
    await t2.svc.scan([root()])
    expect(await t2.svc.clean({ items: [{ root: root(), rel: 'dist' }], trash: true, busy: [] })).toMatchObject({ ok: true, dirs: 1 })
    expect(trashed).toEqual([path.join(root(), 'dist')])
    expect(t2.asked[0]!.buttons[0]).toBe('Trash')
  })

  it('marks missing and refused roots', async () => {
    mkdirSync(path.join(tmp, 'home'), { recursive: true })
    const { svc } = service()
    const r = (await svc.scan([path.join(tmp, 'nope'), path.join(tmp, 'home'), 'relative']))!
    expect(r.map((p) => p.error)).toEqual(['missing', 'refused', 'missing'])
  })
})
