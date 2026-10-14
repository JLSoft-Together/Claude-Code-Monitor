import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { LayoutStore, MAX_PER_PROJECT } from '../src/layouts'
import { registerPreviewIpc } from '../src/preview/ipc'
import { cargoCommands, detectScripts, justRecipes, makeTargets, packageScripts, pythonScripts } from '../src/preview/scripts'
import type { PreviewServer } from '../src/preview/server'
import type { RootWatcher } from '../src/preview/watch'

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ccm-tier2-')))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('script parsers', () => {
  it('package.json scripts use the lockfile runner and skip names a shell would split', () => {
    const json = JSON.stringify({ scripts: { dev: 'vite', 'test:unit': 'vitest', 'bad name': 'x', 'a;rm': 'x', n: 3 } })
    expect(packageScripts(json, 'npm').map((s) => s.run)).toEqual(['npm run dev', 'npm run test:unit'])
    expect(packageScripts(json, 'yarn')[0]!.run).toBe('yarn dev')
    expect(packageScripts(json, 'pnpm')[0]!.detail).toBe('vite')
    expect(packageScripts('{oops', 'npm')).toEqual([])
  })

  it('Makefile targets: plain names only', () => {
    const mk = ['.PHONY: build', 'CC := gcc', 'VAR = 1', 'build: deps', '\tgo build', '%.o: %.c', 'test:', 'build: again', 'x::'].join('\n')
    expect(makeTargets(mk).map((t) => t.name)).toEqual(['build', 'test'])
  })

  it('justfile recipes without parameters; settings skipped', () => {
    const just = ['set shell := ["bash", "-c"]', 'default: build', '@build:', '  cargo build', 'deploy env:', 'name := "x"', 'alias b := build'].join('\n')
    expect(justRecipes(just).map((t) => t.run)).toEqual(['just default', 'just build'])
  })

  it('Cargo and pyproject', () => {
    expect(cargoCommands('[package]\nname = "x"\n').map((c) => c.run)).toEqual(['cargo build', 'cargo test', 'cargo run'])
    expect(cargoCommands('[workspace]\nmembers = []\n').map((c) => c.name)).toEqual(['build', 'test'])
    expect(cargoCommands('[dependencies]\n')).toEqual([])
    const py = '[project]\nname = "x"\n[project.scripts]\nserve = "app.main:run"\n"bad;x" = "y:z"\n'
    expect(pythonScripts(py, 'uv')).toEqual([{ name: 'serve', detail: 'app.main:run', run: 'uv run serve' }])
    expect(pythonScripts(py, null)[0]!.run).toBe('serve')
  })

  it('detectScripts reads the folder without running anything', async () => {
    const dir = path.join(tmp, 'proj')
    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { hello: 'node -e "console.log(1)"' } }))
    writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '')
    writeFileSync(path.join(dir, 'Makefile'), 'all:\n\techo\n')
    const res = await detectScripts(dir)
    expect(res.groups.map((g) => `${g.source}:${g.items.map((i) => i.name).join(',')}`)).toEqual(['pnpm:hello', 'make:all'])
  })
})

describe('layout store', () => {
  const project = path.join(tmp, 'Repo')
  mkdirSync(project, { recursive: true })
  const draft = (name: string, extra: object = {}) => ({
    project,
    name,
    panes: { a: { kind: 'term', preset: 'claude', cwd: project, resume: 'not-a-uuid' }, b: { kind: 'browser', url: 'javascript:alert(1)' } },
    tabs: [{ root: { dir: 'row', ratio: 0.5, a: { pane: 'a' }, b: { pane: 'b' } } }],
    ...extra,
  })

  it('validates, persists, renames, keeps one open-on-start, deletes', () => {
    const file = path.join(tmp, 'data', 'layouts.json')
    const store = new LayoutStore(file)
    const res = store.save(draft('Dev'))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    // Bad URL pane dropped (tree collapses to the agent), bad resume id dropped.
    expect(Object.keys(res.layout.panes)).toEqual(['a'])
    expect(res.layout.tabs[0]!.root).toEqual({ pane: 'a' })
    expect(res.layout.panes.a!.resume).toBeUndefined()
    const second = store.save({ ...draft('Review'), openOnStart: true })
    expect(second.ok).toBe(true)
    const renamed = store.save({ ...res.layout, name: 'Daily', openOnStart: true })
    expect(renamed.ok && renamed.layout.id).toBe(res.layout.id)
    const reloaded = new LayoutStore(file)
    const list = reloaded.forProject(process.platform === 'win32' ? project.toUpperCase() : project)
    expect(list.map((l) => l.name).sort()).toEqual(['Daily', 'Review'])
    expect(list.filter((l) => l.openOnStart).map((l) => l.name)).toEqual(['Daily'])
    expect(reloaded.setOpenOnStart(project, null)).toBe(true)
    expect(reloaded.forProject(project).some((l) => l.openOnStart)).toBe(false)
    expect(reloaded.delete(project, res.layout.id)).toBe(true)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toHaveLength(1)
    expect(store.save({ ...draft('x'), tabs: [] })).toEqual({ ok: false, error: 'invalid' })
  })

  it('caps layouts per project', () => {
    const store = new LayoutStore()
    for (let i = 0; i < MAX_PER_PROJECT; i++) expect(store.save(draft(`L${i}`)).ok).toBe(true)
    expect(store.save(draft('one more'))).toEqual({ ok: false, error: 'limit' })
  })
})

describe('scripts ipc', () => {
  it('reads only allowed folders', async () => {
    const allowed = path.join(tmp, 'allowed')
    const other = path.join(tmp, 'other')
    for (const d of [allowed, other]) {
      mkdirSync(d, { recursive: true })
      writeFileSync(path.join(d, 'package.json'), JSON.stringify({ scripts: { hello: 'echo hi' } }))
    }
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    registerPreviewIpc({
      ipcMain: { handle: (ch: string, fn: never) => handlers.set(ch, fn), removeHandler: (ch: string) => handlers.delete(ch) } as never,
      isAppFrame: () => true,
      server: { tokensUnder: () => [] } as unknown as PreviewServer,
      watcher: { listen: () => undefined } as unknown as RootWatcher,
      shell: {} as never,
      dialog: {} as never,
      getWindow: () => null,
      getRoots: () => [allowed],
      confirmAccess: async () => false,
    })
    const call = (ch: string, ...args: unknown[]) => Promise.resolve(handlers.get(ch)!({ sender: { id: 1 } }, ...args))
    const res = (await call('ccm:scripts', allowed)) as { groups: { items: { run: string }[] }[] }
    expect(res.groups[0]!.items[0]!.run).toBe('npm run hello')
    expect(await call('ccm:scripts', other)).toBeNull()
    expect(await call('ccm:project-root', other)).toBeNull()
    expect(await call('ccm:project-root', allowed)).toMatchObject({ repo: expect.any(Boolean) })
  })
})
