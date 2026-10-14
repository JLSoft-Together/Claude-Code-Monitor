import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createEntry, listDir } from '../src/preview/explorer'
import { registerPreviewIpc } from '../src/preview/ipc'
import type { PreviewServer } from '../src/preview/server'
import type { RootWatcher } from '../src/preview/watch'

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ccm-explorer-')))
const project = path.join(tmp, 'project')
const outside = path.join(tmp, 'outside')
mkdirSync(path.join(project, 'src'), { recursive: true })
mkdirSync(outside, { recursive: true })
writeFileSync(path.join(project, 'README.md'), '# hi')
writeFileSync(path.join(project, 'src', 'a.ts'), 'x')
writeFileSync(path.join(outside, 'secret.txt'), 's')
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

// Directory junctions need no privilege on Windows; file symlinks do.
const linkDir = (target: string, at: string): boolean => {
  try {
    symlinkSync(target, at, 'junction')
    return true
  } catch {
    return false
  }
}

describe('listDir', () => {
  it('lists one folder with real paths and kinds', async () => {
    const rows = await listDir(project, project)
    expect(rows?.map((r) => [r.name, r.directory, r.outOfRoot]).sort()).toEqual([
      ['README.md', false, false],
      ['src', true, false],
    ])
    expect(rows?.find((r) => r.name === 'src')?.path).toBe(path.join(project, 'src'))
  })

  it('refuses folders outside the root, relative paths and NUL bytes', async () => {
    expect(await listDir(project, outside)).toBeNull()
    expect(await listDir(project, path.join(project, '..', 'outside'))).toBeNull()
    expect(await listDir(project, 'src')).toBeNull()
    expect(await listDir(project, `${project}\0`)).toBeNull()
    expect(await listDir(project, path.join(project, 'missing'))).toBeNull()
  })

  it('marks a link out of the root as a leaf and refuses to list through it', async () => {
    const at = path.join(project, 'escape')
    if (!linkDir(outside, at)) return
    try {
      const row = (await listDir(project, project))?.find((r) => r.name === 'escape')
      expect(row).toMatchObject({ directory: true, outOfRoot: true })
      expect(await listDir(project, at)).toBeNull()
    } finally {
      // Node 24 rmSync refuses a junction ("Path is a directory"); unlink removes only the link.
      unlinkSync(at)
    }
  })
})

describe('createEntry', () => {
  it('creates an empty file and a folder, never overwriting', async () => {
    const file = await createEntry(project, project, 'new.txt', 'file')
    expect(file).toEqual({ ok: true, path: path.join(project, 'new.txt') })
    expect(statSync(path.join(project, 'new.txt')).size).toBe(0)
    expect(await createEntry(project, project, 'new.txt', 'file')).toEqual({ ok: false, error: 'exists' })
    expect(await createEntry(project, path.join(project, 'src'), 'lib', 'directory')).toMatchObject({ ok: true })
    expect(statSync(path.join(project, 'src', 'lib')).isDirectory()).toBe(true)
    expect(await createEntry(project, project, 'src', 'directory')).toEqual({ ok: false, error: 'exists' })
  })

  it('validates the name again in main', async () => {
    expect(await createEntry(project, project, '../x', 'file')).toEqual({ ok: false, error: 'invalid', reason: 'separator' })
    expect(await createEntry(project, project, 'con.txt', 'file')).toEqual({ ok: false, error: 'invalid', reason: 'device' })
    expect(existsSync(path.join(tmp, 'x'))).toBe(false)
  })

  it('refuses a parent outside the root or a bad kind', async () => {
    expect(await createEntry(project, outside, 'x.txt', 'file')).toEqual({ ok: false, error: 'denied' })
    expect(await createEntry(project, project, 'x.txt', 'socket')).toEqual({ ok: false, error: 'denied' })
    expect(existsSync(path.join(outside, 'x.txt'))).toBe(false)
  })
})

describe('ccm:list-dir / ccm:create-entry', () => {
  type Handler = (event: unknown, ...args: unknown[]) => unknown
  const handlers = new Map<string, Handler>()
  registerPreviewIpc({
    ipcMain: { handle: (ch: string, fn: Handler) => handlers.set(ch, fn), removeHandler: (ch: string) => handlers.delete(ch) } as never,
    isAppFrame: () => true,
    server: { tokensUnder: () => [] } as unknown as PreviewServer,
    watcher: { listen: () => undefined } as unknown as RootWatcher,
    shell: {} as never,
    dialog: {} as never,
    getWindow: () => null,
    getRoots: () => [project],
    confirmAccess: async () => false,
  })
  const call = (ch: string, arg: unknown) => Promise.resolve(handlers.get(ch)!({ sender: { id: 1 } }, arg))

  it('only serves roots the page may read', async () => {
    expect(Array.isArray(await call('ccm:list-dir', { root: project, dir: path.join(project, 'src') }))).toBe(true)
    expect(await call('ccm:list-dir', { root: outside, dir: outside })).toBeNull()
    expect(await call('ccm:list-dir', null)).toBeNull()
    expect(await call('ccm:create-entry', { root: outside, parent: outside, name: 'y.txt', kind: 'file' })).toEqual({ ok: false, error: 'denied' })
    expect(await call('ccm:create-entry', { root: project, parent: project, name: 'y.txt', kind: 'file' })).toMatchObject({ ok: true })
  })
})
