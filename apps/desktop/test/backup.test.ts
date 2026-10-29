import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerBackupIpc } from '../src/backup/ipc'
import {
  buildBackup, cleanSectionIds, collectPaths, exportName, fileSection, filterLocal, localSection, parseBackup, pickSections, pruneList, REMOVED, scrubJson, sectionsOf,
} from '../src/backup/format'
import { BackupService } from '../src/backup/service'

const NOW = new Date('2026-10-29T10:00:00Z')

describe('backup format', () => {
  it('sorts ccm.* keys into sections and skips machine-bound or secret ones', () => {
    expect(localSection('ccm.theme')).toBe('appearance')
    expect(localSection('ccm.font.code')).toBe('appearance')
    expect(localSection('ccm.workspace.panes')).toBe('workspace')
    expect(localSection('ccm.mapLayout.v53')).toBe('workspace')
    expect(localSection('ccm.promptQueue.abc')).toBe('notes')
    expect(localSection('ccm.bookmarks')).toBe('notes')
    expect(localSection('ccm.notify.waiting')).toBe('settings')
    expect(localSection('ccm.whatsNew.seen')).toBeNull()
    expect(localSection('ccm.inbox')).toBeNull()
    expect(localSection('ccm.http.env:/x')).toBeNull()
    expect(localSection('ccm.github.token')).toBeNull()
    expect(localSection('other.theme')).toBeNull()
  })

  it('classifies data files, never trust grants or caches', () => {
    expect(fileSection('aliases.json')).toBe('names')
    expect(fileSection('adb-devices.json')).toBe('devices')
    expect(fileSection('notes/' + 'a'.repeat(40) + '.md')).toBe('notes')
    for (const f of ['run-trust.json', 'preview-grants.json', 'usage-index.json', 'github-accounts.json', 'timeline.json', '../aliases.json', 'notes/x.md']) expect(fileSection(f)).toBeNull()
  })

  it('removes secrets from values and env maps', () => {
    const v = scrubJson({ name: 'a', token: 'x', apiKey: 'y', env: { DB: 'postgres://u:p@h' }, nested: [{ password: 'p', note: 'use ghp_abcdefghijklmnopqrstuvwx1234 here' }] })
    expect(v).toEqual({ name: 'a', env: {}, nested: [{ note: `use ${REMOVED} here` }] })
    expect(filterLocal({ 'ccm.prompts': 'key sk-ant-api03-abcdefghijk', 'ccm.theme': 'dark', 'ccm.x': 5, 'ccm.auth': 'z' })).toEqual({ 'ccm.prompts': `key ${REMOVED}`, 'ccm.theme': 'dark' })
  })

  it('round-trips and re-filters an edited file', () => {
    const b = buildBackup({ app: '2.5.0', platform: 'win32', now: NOW, local: { 'ccm.theme': 'dark' }, files: { 'aliases.json': '{"a":"b"}' }, github: [{ login: 'octo', name: 'Octo', token: 'ghp_x' }] })
    expect(b.github).toEqual([{ login: 'octo', name: 'Octo' }])
    const text = JSON.stringify({ ...b, local: { ...b.local, 'ccm.inbox': '{}' }, files: { ...b.files, 'run-trust.json': '{}', 'favorites.json': 'not json' } })
    const back = parseBackup(text)!
    expect(back.local).toEqual({ 'ccm.theme': 'dark' })
    expect(Object.keys(back.files)).toEqual(['aliases.json'])
    expect(parseBackup('{"format":"other","version":1}')).toBeNull()
    expect(parseBackup('nope')).toBeNull()
  })

  it('finds absolute paths, also inside JSON strings', () => {
    const paths = collectPaths({ a: 'C:\\work\\app', b: ['/home/u/proj', 'relative/x', '/compact'], c: JSON.stringify({ cwd: 'D:/x/y' }), 'E:\\key': 1 })
    expect([...paths].sort()).toEqual(['/home/u/proj', 'C:\\work\\app', 'D:/x/y', 'E:\\key'])
  })

  it('counts sections and flags missing paths', () => {
    const b = buildBackup({
      app: '2.5.0', platform: 'linux', now: NOW,
      local: { 'ccm.theme': 'dark', 'ccm.locale': 'vi', 'ccm.workspace.recent': JSON.stringify(['/home/u/a', '/home/u/b']) },
      files: { 'favorites.json': JSON.stringify([{ path: '/home/u/a' }]) },
      github: [{ login: 'octo' }],
    })
    const s = sectionsOf(b, (p) => p === '/home/u/a')
    expect(s).toEqual([
      { id: 'appearance', count: 2, missingPaths: [] },
      { id: 'workspace', count: 1, missingPaths: ['/home/u/b'] },
      { id: 'names', count: 1, missingPaths: [] },
      { id: 'github', count: 1, missingPaths: [] },
    ])
    const picked = pickSections(b, new Set(['workspace', 'github']))
    expect(picked).toEqual({ local: { 'ccm.workspace.recent': b.local['ccm.workspace.recent'] }, files: {}, github: ['octo'] })
  })

  it('validates section ids', () => {
    expect(cleanSectionIds(['notes', 'run'])).toEqual(new Set(['notes', 'run']))
    expect(cleanSectionIds(['notes', 'evil'])).toBeNull()
    expect(cleanSectionIds('notes')).toBeNull()
  })

  it('keeps the newest N of one kind', () => {
    const e = [
      { name: 'pre-update-2.5.0.json', mtime: 3 },
      { name: 'pre-update-2.4.0.json', mtime: 2 },
      { name: 'pre-update-2.3.0.json', mtime: 1 },
      { name: 'pre-update-2.2.0.json', mtime: 0 },
      { name: 'pre-import-x.json', mtime: 0 },
    ]
    expect(pruneList(e, 'pre-update-', 3)).toEqual(['pre-update-2.2.0.json'])
    expect(exportName(new Date(2026, 9, 9))).toBe('orrery-backup-2026-10-09.json')
  })
})

describe('backup ipc', () => {
  it('gates frames, section ids and asks before staging', async () => {
    const handlers = new Map<string, (e: unknown, ...a: unknown[]) => unknown>()
    const ipcMain = { handle: (ch: string, fn: never) => void handlers.set(ch, fn), removeHandler: (ch: string) => void handlers.delete(ch) }
    let app = false
    const staged = { ok: true, local: {}, github: [] }
    const service = { stagedSections: (tok: string) => (tok === 'tok' ? {} : null), stage: vi.fn(() => staged), snapshot: vi.fn(), preview: vi.fn() }
    const confirmApply = vi.fn(async () => true)
    const relaunch = vi.fn()
    const dispose = registerBackupIpc({
      ipcMain: ipcMain as never, isAppFrame: () => app, service: service as never, readLocal: async () => ({}),
      saveDialog: async () => null, openDialog: async () => null, confirmApply, relaunch, documentsDir: '/docs',
    })
    const ev = { sender: {} }
    expect(await handlers.get('ccm:backup-export')!(ev)).toEqual({ ok: false, error: 'denied' })
    expect(await handlers.get('ccm:backup-relaunch')!(ev)).toBe(false)
    app = true
    expect(await handlers.get('ccm:backup-apply')!(ev, 'tok', ['evil'])).toEqual({ ok: false, error: 'invalid' })
    expect(await handlers.get('ccm:backup-apply')!(ev, 'old', ['notes'])).toEqual({ ok: false, error: 'expired' })
    confirmApply.mockResolvedValueOnce(false)
    expect(await handlers.get('ccm:backup-apply')!(ev, 'tok', ['notes'])).toEqual({ ok: false, error: 'cancelled' })
    expect(service.stage).not.toHaveBeenCalled()
    expect(await handlers.get('ccm:backup-apply')!(ev, 'tok', ['notes'])).toEqual(staged)
    expect(await handlers.get('ccm:backup-export')!(ev)).toEqual({ ok: false, error: 'cancelled' })
    expect(await handlers.get('ccm:backup-relaunch')!(ev)).toBe(true)
    expect(relaunch).toHaveBeenCalled()
    dispose()
    expect(handlers.size).toBe(0)
  })
})

describe('BackupService', () => {
  let dir = ''
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function setup() {
    dir = mkdtempSync(path.join(os.tmpdir(), 'ccm-backup-'))
    writeFileSync(path.join(dir, 'aliases.json'), '{"t1":"api"}')
    writeFileSync(path.join(dir, 'run-trust.json'), '{"/x":true}')
    mkdirSync(path.join(dir, 'notes'))
    writeFileSync(path.join(dir, 'notes', 'b'.repeat(40) + '.md'), '# todo')
    return new BackupService({ dataDir: dir, app: '2.5.0', platform: 'win32', github: () => [{ login: 'octo', name: null }], now: () => NOW, exists: () => true })
  }

  it('snapshots config files only', () => {
    const b = setup().snapshot({ 'ccm.theme': 'dark' })
    expect(Object.keys(b.files).sort()).toEqual(['aliases.json', 'notes/' + 'b'.repeat(40) + '.md'])
    expect(b.github).toEqual([{ login: 'octo', name: null }])
  })

  it('writes automatic backups and keeps 3', () => {
    const s = setup()
    for (const [i, v] of ['2.1.0', '2.2.0', '2.3.0', '2.4.0'].entries()) {
      const f = s.writeAuto('pre-update', v, {})!
      utimesSync(f, 1000 + i, 1000 + i)
    }
    expect(readdirSync(path.join(dir, 'backups')).sort()).toEqual(['pre-update-2.2.0.json', 'pre-update-2.3.0.json', 'pre-update-2.4.0.json'])
  })

  it('previews, stages and applies on the next start', () => {
    const s = setup()
    const other = buildBackup({ app: '2.5.0', platform: 'darwin', now: NOW, local: { 'ccm.theme': 'light', 'ccm.bookmarks': '[]' }, files: { 'aliases.json': '{"t2":"web"}', 'adb-devices.json': '{}' }, github: [] })
    const p = s.preview(JSON.stringify(other), '/tmp/orrery-backup.json')
    expect(p.ok && p.sections.map((x) => x.id)).toEqual(['appearance', 'notes', 'names', 'devices'])
    if (!p.ok) return
    expect(s.stage('wrong', new Set(['names']), {})).toEqual({ ok: false, error: 'expired' })
    const r = s.stage(p.token, new Set(['appearance', 'names']), { 'ccm.theme': 'dark' })
    expect(r).toEqual({ ok: true, local: { 'ccm.theme': 'light' }, github: [] })
    expect(readFileSync(path.join(dir, 'aliases.json'), 'utf8')).toBe('{"t1":"api"}')
    expect(readdirSync(path.join(dir, 'backups')).some((n) => n.startsWith('pre-import-'))).toBe(true)
    expect(s.applyPending()).toBe(1)
    expect(readFileSync(path.join(dir, 'aliases.json'), 'utf8')).toBe('{"t2":"web"}')
    expect(existsSync(path.join(dir, 'adb-devices.json'))).toBe(false)
    expect(s.applyPending()).toBe(0)
    expect(s.stage(p.token, new Set(['names']), {})).toEqual({ ok: false, error: 'expired' })
  })

  it('refuses invalid files', () => {
    const s = setup()
    expect(s.preview('{"format":"orrery-backup","version":2}', 'x.json')).toEqual({ ok: false, error: 'invalid' })
  })
})
