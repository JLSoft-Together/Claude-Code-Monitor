import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createEntry, fsFailure, listDir, renameEntry, trashEntry } from '../src/preview/explorer'
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
    trash: async () => undefined,
  })
  const call = (ch: string, arg: unknown) => Promise.resolve(handlers.get(ch)!({ sender: { id: 1 } }, arg))

  it('only serves roots the page may read', async () => {
    expect(Array.isArray(await call('ccm:list-dir', { root: project, dir: path.join(project, 'src') }))).toBe(true)
    expect(await call('ccm:list-dir', { root: outside, dir: outside })).toBeNull()
    expect(await call('ccm:list-dir', null)).toBeNull()
    expect(await call('ccm:create-entry', { root: outside, parent: outside, name: 'y.txt', kind: 'file' })).toEqual({ ok: false, error: 'denied' })
    expect(await call('ccm:create-entry', { root: project, parent: project, name: 'y.txt', kind: 'file' })).toMatchObject({ ok: true })
  })

  it('renames and trashes only inside readable roots', async () => {
    writeFileSync(path.join(project, 'ipc.txt'), 'i')
    expect(await call('ccm:rename-entry', { root: outside, path: path.join(outside, 'secret.txt'), name: 'x' })).toEqual({ ok: false, error: 'denied' })
    expect(await call('ccm:rename-entry', { root: project, path: path.join(project, 'ipc.txt'), name: 'ipc2.txt' })).toMatchObject({ ok: true })
    expect(await call('ccm:trash-entry', { root: project, path: path.join(project, 'ipc2.txt') })).toEqual({ ok: true })
  })
})

describe('renameEntry', () => {
  it('renames inside the root and never overwrites', async () => {
    writeFileSync(path.join(project, 'src', 'r1.ts'), '1')
    writeFileSync(path.join(project, 'src', 'r2.ts'), '2')
    expect(await renameEntry(project, path.join(project, 'src', 'r1.ts'), 'r3.ts')).toEqual({ ok: true, path: path.join(project, 'src', 'r3.ts') })
    expect(await renameEntry(project, path.join(project, 'src', 'r3.ts'), 'r2.ts')).toEqual({ ok: false, error: 'exists' })
  })

  it('allows a case-only rename of the same file', async () => {
    writeFileSync(path.join(project, 'src', 'case.md'), 'c')
    expect(await renameEntry(project, path.join(project, 'src', 'case.md'), 'CASE.md')).toMatchObject({ ok: true })
    expect(readdirSync(path.join(project, 'src'))).toContain('CASE.md')
    expect(readdirSync(path.join(project, 'src'))).not.toContain('case.md')
  })

  it('refuses the root, outside paths, `..` and bad names', async () => {
    expect(await renameEntry(project, project, 'x')).toEqual({ ok: false, error: 'denied' })
    expect(await renameEntry(project, path.join(outside, 'secret.txt'), 'x')).toEqual({ ok: false, error: 'denied' })
    expect(await renameEntry(project, `${path.join(project, 'src')}${path.sep}..`, 'x')).toEqual({ ok: false, error: 'denied' })
    expect(await renameEntry(project, path.join(project, 'README.md'), 'a/b')).toMatchObject({ ok: false, error: 'invalid' })
    expect(await renameEntry(project, path.join(project, 'nope.txt'), 'x')).toEqual({ ok: false, error: 'missing' })
  })
})

describe('trashEntry', () => {
  it('hands the entry to the trash and refuses the root', async () => {
    writeFileSync(path.join(project, 'src', 'gone.ts'), 'g')
    const trashed: string[] = []
    const trash = async (p: string) => void trashed.push(p)
    expect(await trashEntry(project, path.join(project, 'src', 'gone.ts'), trash)).toEqual({ ok: true })
    expect(trashed).toEqual([path.join(project, 'src', 'gone.ts')])
    expect(await trashEntry(project, project, trash)).toEqual({ ok: false, error: 'denied' })
    expect(await trashEntry(project, path.join(outside, 'secret.txt'), trash)).toEqual({ ok: false, error: 'denied' })
    expect(await trashEntry(project, path.join(project, 'missing.ts'), trash)).toEqual({ ok: false, error: 'missing' })
    expect(await trashEntry(project, path.join(project, 'src', 'a.ts'), async () => { throw new Error('busy') })).toEqual({ ok: false, error: 'failed' })
  })

  it('reports a held file or folder as busy', async () => {
    const held = async () => { throw Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' }) }
    expect(await trashEntry(project, path.join(project, 'src', 'a.ts'), held)).toEqual({ ok: false, error: 'busy' })
    expect(await trashEntry(project, path.join(project, 'src', 'a.ts'), async () => { throw new Error('EPERM: operation not permitted') })).toEqual({ ok: false, error: 'busy' })
  })

  it('reports a trash name clash as a failed trash, not as an existing entry', async () => {
    const clash = (code: string) => async () => { throw Object.assign(new Error(code), { code }) }
    expect(await trashEntry(project, path.join(project, 'src', 'a.ts'), clash('ENOTEMPTY'))).toEqual({ ok: false, error: 'failed' })
    expect(await trashEntry(project, path.join(project, 'src', 'a.ts'), clash('EEXIST'))).toEqual({ ok: false, error: 'failed' })
  })

  it('names each fs failure by its code or message', () => {
    const coded = (code: string) => Object.assign(new Error(code), { code })
    expect(fsFailure(coded('EPERM'))).toBe('busy')
    expect(fsFailure(coded('EBUSY'))).toBe('busy')
    expect(fsFailure(new Error('The process cannot access the file because it is being used by another process.'))).toBe('busy')
    expect(fsFailure(coded('EACCES'))).toBe('denied')
    expect(fsFailure(new Error('EACCES: permission denied, rename'))).toBe('denied')
    expect(fsFailure(coded('ENOENT'))).toBe('missing')
    expect(fsFailure(coded('EEXIST'))).toBe('exists')
    expect(fsFailure(new Error('ENOTEMPTY: directory not empty'))).toBe('exists')
    expect(fsFailure(new Error('nope'))).toBe('failed')
    expect(fsFailure(null)).toBe('failed')
  })
})
