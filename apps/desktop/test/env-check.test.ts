import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { checkEnv, compareEnv, countRows, ENV_MAX_BYTES, isEnvFileName, isEnvTemplate, parseEnv, revealEnv } from '../src/preview/envCheck'
import { registerPreviewIpc } from '../src/preview/ipc'
import type { PreviewServer } from '../src/preview/server'
import type { RootWatcher } from '../src/preview/watch'

const tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'ccm-env-')))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const values = (text: string) => Object.fromEntries([...parseEnv(text)].map(([k, e]) => [k, e.value]))

function project(name: string, files: Record<string, string>): string {
  const dir = path.join(tmp, name)
  mkdirSync(dir, { recursive: true })
  for (const [f, text] of Object.entries(files)) writeFileSync(path.join(dir, f), text)
  return dir
}

describe('parseEnv', () => {
  it('reads plain pairs, export, spaces around = and comments', () => {
    expect(
      values(['# comment', '', 'A=1', 'export B=two', '  C = three  ', 'D=', 'E=value # trailing', 'F=a#b', 'G=#only', 'not a pair', '1BAD=x', 'H.I-J=k'].join('\n')),
    ).toEqual({ A: '1', B: 'two', C: 'three', D: '', E: 'value', F: 'a#b', G: '', 'H.I-J': 'k' })
  })

  it('reads quoted values, keeping # and spaces inside quotes', () => {
    expect(values(`A="x # y"\nB='  z  '\nC=\`t\` # c\nD="" \nE=''`)).toEqual({ A: 'x # y', B: '  z  ', C: 't', D: '', E: '' })
  })

  it('expands escapes in double quotes only', () => {
    expect(values(String.raw`A="l1\nl2\t\"q\"\\"` + '\n' + String.raw`B='raw\n'` + '\n' + String.raw`C="keep\x"`)).toEqual({
      A: 'l1\nl2\t"q"\\',
      B: 'raw\\n',
      C: 'keep\\x',
    })
  })

  it('reads multi-line quoted values and carries on after them', () => {
    const map = parseEnv('KEY="-----BEGIN-----\r\nabc\r\n-----END-----"\r\nNEXT=1\r\n')
    expect(map.get('KEY')).toEqual({ value: '-----BEGIN-----\nabc\n-----END-----', line: 1 })
    expect(map.get('NEXT')).toEqual({ value: '1', line: 4 })
  })

  it('treats an unclosed quote as a plain value of that line', () => {
    expect(values('A="open\nB=2')).toEqual({ A: '"open', B: '2' })
  })

  it('lets the last assignment win, keeping the first position', () => {
    const map = parseEnv('A=1\nB=2\nA=3')
    expect([...map.keys()]).toEqual(['A', 'B'])
    expect(map.get('A')).toEqual({ value: '3', line: 3 })
  })

  it('ignores a BOM', () => {
    expect(values('﻿A=1')).toEqual({ A: '1' })
  })
})

describe('compareEnv', () => {
  const template = parseEnv('A=\nB=example\nC=')
  it('marks missing, empty, ok and extra keys, template order first', () => {
    const rows = compareEnv(template, parseEnv('C=set\nA=  \nZ=extra\nY='))
    expect(rows.map((r) => [r.key, r.status, r.empty])).toEqual([
      ['A', 'empty', true],
      ['B', 'missing', false],
      ['C', 'ok', false],
      ['Z', 'extra', false],
      ['Y', 'extra', true],
    ])
    expect(rows.find((r) => r.key === 'B')!.line).toBeNull()
    expect(countRows(rows)).toEqual({ ok: 1, empty: 1, missing: 1, extra: 2 })
  })
  it('without a template only says ok or empty', () => {
    expect(compareEnv(null, parseEnv('A=1\nB=')).map((r) => r.status)).toEqual(['ok', 'empty'])
  })
})

describe('file names', () => {
  it('accepts .env and .env.* only, templates by suffix', () => {
    for (const n of ['.env', '.env.local', '.env.development', '.env.production.local', '.env.example']) expect(isEnvFileName(n)).toBe(true)
    for (const n of ['env', '.envrc', '.env.', '.env/x', '.env\\x', 'a.env', '.env..', '../.env']) expect(isEnvFileName(n)).toBe(false)
    expect(isEnvTemplate('.env.example')).toBe(true)
    expect(isEnvTemplate('.env.local.sample')).toBe(true)
    expect(isEnvTemplate('.env.local')).toBe(false)
  })
})

describe('checkEnv', () => {
  it('compares every .env* in the root against the first template, keys and flags only', async () => {
    const dir = project('p1', {
      '.env.example': 'API_KEY=\nDB_URL=postgres://localhost\nDEBUG=',
      '.env.sample': 'OTHER=1',
      '.env': 'API_KEY=secret-1\nDB_URL=\nEXTRA=1',
      '.env.local': 'API_KEY=secret-2\nDB_URL=x\nDEBUG=1',
      'not-env.txt': 'A=1',
    })
    mkdirSync(path.join(dir, '.env.dir'))
    const res = await checkEnv(dir)
    if (!res.ok) throw new Error(res.error)
    expect(res.template?.name).toBe('.env.example')
    expect(res.template?.keys.map((k) => [k.key, k.empty])).toEqual([
      ['API_KEY', true],
      ['DB_URL', false],
      ['DEBUG', true],
    ])
    expect(res.files.map((f) => f.name)).toEqual(['.env', '.env.local'])
    expect(res.files[0]!.counts).toEqual({ ok: 1, empty: 1, missing: 1, extra: 1 })
    expect(res.files[1]!.counts).toEqual({ ok: 3, empty: 0, missing: 0, extra: 0 })
    expect(JSON.stringify(res)).not.toMatch(/secret|postgres/)
  })

  it('works without a template and flags oversized files', async () => {
    const dir = project('p2', { '.env': 'A=1\nB=', '.env.big': `A=${'x'.repeat(ENV_MAX_BYTES)}` })
    const res = await checkEnv(dir)
    if (!res.ok) throw new Error(res.error)
    expect(res.template).toBeNull()
    expect(res.files[0]!.rows.map((r) => r.status)).toEqual(['ok', 'empty'])
    expect(res.files[1]).toMatchObject({ name: '.env.big', error: 'too-large', rows: [] })
  })

  it('reports an unreadable root as failed', async () => {
    expect(await checkEnv(path.join(tmp, 'nope'))).toEqual({ ok: false, error: 'failed' })
  })
})

describe('revealEnv', () => {
  const dir = project('p3', { '.env': 'TOKEN="abc def"\nEMPTY=', '.env.example': 'TOKEN=sample' })
  mkdirSync(path.join(dir, 'sub'))
  writeFileSync(path.join(dir, 'sub', '.env'), 'TOKEN=inner')

  it('returns one value of a key in a .env* file directly in the root', async () => {
    expect(await revealEnv(dir, '.env', 'TOKEN')).toEqual({ ok: true, value: 'abc def' })
    expect(await revealEnv(dir, '.env', 'EMPTY')).toEqual({ ok: true, value: '' })
    expect(await revealEnv(dir, '.env.example', 'TOKEN')).toEqual({ ok: true, value: 'sample' })
  })

  it('refuses other names, traversal, missing files and keys', async () => {
    expect(await revealEnv(dir, '.env', 'NOPE')).toEqual({ ok: false, error: 'missing' })
    expect(await revealEnv(dir, '.env.local', 'TOKEN')).toEqual({ ok: false, error: 'denied' })
    for (const name of ['sub/.env', 'sub\\.env', '../p1/.env', 'package.json', '', 3, null]) expect(await revealEnv(dir, name, 'TOKEN')).toEqual({ ok: false, error: 'denied' })
    for (const key of ['', 5, null, 'K'.repeat(300)]) expect(await revealEnv(dir, '.env', key)).toEqual({ ok: false, error: 'denied' })
  })

  it('refuses a .env symlink that points elsewhere', async () => {
    const link = project('p4', {})
    try {
      symlinkSync(path.join(tmp, 'p1', '.env'), path.join(link, '.env'))
    } catch {
      return
    }
    expect(await revealEnv(link, '.env', 'API_KEY')).toEqual({ ok: false, error: 'denied' })
    const res = await checkEnv(link)
    expect(res.ok && res.files).toEqual([])
  })
})

describe('ccm:env-check / ccm:env-reveal', () => {
  const dir = project('p5', { '.env': 'A=1', '.env.example': 'A=' })
  const outside = project('p6', { '.env': 'A=2' })
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
  registerPreviewIpc({
    ipcMain: { handle: (ch: string, fn: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(ch, fn), removeHandler: (ch: string) => handlers.delete(ch) } as never,
    isAppFrame: () => true,
    server: { tokensUnder: () => [] } as unknown as PreviewServer,
    watcher: { listen: () => undefined } as unknown as RootWatcher,
    shell: {} as never,
    dialog: {} as never,
    getWindow: () => null,
    getRoots: () => [dir],
    confirmAccess: async () => false,
  })
  const call = (ch: string, ...args: unknown[]) => Promise.resolve(handlers.get(ch)!({ sender: { id: 1 } }, ...args))

  it('checks and reveals inside an allowed folder only', async () => {
    expect(await call('ccm:env-check', dir)).toMatchObject({ ok: true, files: [{ name: '.env', counts: { ok: 1 } }] })
    expect(await call('ccm:env-reveal', { root: dir, file: '.env', key: 'A' })).toEqual({ ok: true, value: '1' })
    expect(await call('ccm:env-check', outside)).toEqual({ ok: false, error: 'denied' })
    expect(await call('ccm:env-reveal', { root: outside, file: '.env', key: 'A' })).toEqual({ ok: false, error: 'denied' })
    expect(await call('ccm:env-reveal', null)).toEqual({ ok: false, error: 'denied' })
  })
})
