import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { GrantStore } from '../src/preview/grants'
import { registerPreviewIpc } from '../src/preview/ipc'
import { workspaceChord } from '../src/preview/keys'
import type { PreviewServer } from '../src/preview/server'
import type { RootWatcher } from '../src/preview/watch'

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ccm-ipc-')))
const project = path.join(tmp, 'project')
const outside = path.join(tmp, 'outside')
mkdirSync(project, { recursive: true })
mkdirSync(outside, { recursive: true })
writeFileSync(path.join(outside, 'report.txt'), 'hello')
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

type Handler = (event: unknown, ...args: unknown[]) => unknown

function setup(answer: boolean, grants?: GrantStore) {
  const handlers = new Map<string, Handler>()
  const asked: string[] = []
  const ipc = registerPreviewIpc({
    ipcMain: { handle: (ch: string, fn: Handler) => handlers.set(ch, fn), removeHandler: (ch: string) => handlers.delete(ch) } as never,
    isAppFrame: () => true,
    server: { tokensUnder: () => [] } as unknown as PreviewServer,
    watcher: { listen: () => undefined } as unknown as RootWatcher,
    shell: {} as never,
    dialog: {} as never,
    getWindow: () => null,
    getRoots: () => [project],
    confirmAccess: async (folder) => {
      asked.push(folder)
      return answer
    },
    grants,
  })
  const call = (ch: string, ...args: unknown[]) => Promise.resolve(handlers.get(ch)!({ sender: { id: 1 } }, ...args))
  return { ipc, handlers, asked, call }
}

describe('ccm:request-access', () => {
  const file = path.join(outside, 'report.txt')

  it('asks once per folder and grants it on yes', async () => {
    const { call, asked } = setup(true)
    expect(((await call('ccm:read-file', file)) as { kind: string }).kind).toBe('denied')
    const [a, b] = await Promise.all([call('ccm:request-access', file), call('ccm:request-access', file)])
    expect([a, b]).toEqual([true, true])
    expect(asked).toEqual([outside])
    expect(((await call('ccm:read-file', file)) as { kind: string }).kind).toBe('text')
    expect(await call('ccm:request-access', file)).toBe(true)
    expect(asked).toHaveLength(1)
  })

  it('keeps the folder closed on no', async () => {
    const { call } = setup(false)
    expect(await call('ccm:request-access', file)).toBe(false)
    expect(((await call('ccm:read-file', file)) as { kind: string }).kind).toBe('denied')
  })

  it('never asks for paths already inside a root, filesystem roots, relative or missing paths', async () => {
    const { call, asked } = setup(true)
    expect(await call('ccm:request-access', project)).toBe(true)
    expect(await call('ccm:request-access', path.parse(tmp).root)).toBe(false)
    expect(await call('ccm:request-access', 'relative/file.txt')).toBe(false)
    expect(await call('ccm:request-access', path.join(outside, 'nope.txt'))).toBe(false)
    expect(asked).toEqual([])
  })

  it('remembers an allowed folder across a restart until forgotten', async () => {
    const file = path.join(tmp, 'data', 'preview-grants.json')
    const first = setup(true, new GrantStore(file))
    expect(await first.call('ccm:request-access', path.join(outside, 'report.txt'))).toBe(true)
    first.ipc.dispose()
    const second = setup(false, new GrantStore(file))
    expect(((await second.call('ccm:read-file', path.join(outside, 'report.txt'))) as { kind: string }).kind).toBe('text')
    expect(second.asked).toEqual([])
    expect(await second.call('ccm:forget-grants')).toBe(true)
    expect(((await second.call('ccm:read-file', path.join(outside, 'report.txt'))) as { kind: string }).kind).toBe('denied')
    expect(new GrantStore(file).list()).toEqual([])
  })

  it('dispose removes every handler', () => {
    const { ipc, handlers } = setup(true)
    ipc.dispose()
    expect(handlers.size).toBe(0)
  })
})

const key = (code: string, mods: { control?: boolean; shift?: boolean; alt?: boolean; meta?: boolean } = {}, k = '') =>
  ({ type: 'keyDown', key: k || code.replace(/^(Key|Digit)/, '').toLowerCase(), code, control: false, shift: false, alt: false, meta: false, isComposing: false, ...mods }) as const

describe('workspaceChord', () => {
  it('forwards the Windows workspace chords and Ctrl+K', () => {
    for (const k of [
      key('KeyT', { control: true, shift: true }),
      key('KeyW', { control: true, shift: true }),
      key('KeyA', { control: true, shift: true }),
      key('KeyD', { alt: true, shift: true }),
      key('Equal', { alt: true, shift: true }),
      key('Tab', { control: true }),
      key('Tab', { control: true, shift: true }),
      key('Digit3', { control: true, alt: true }, '3'),
      key('KeyK', { control: true }),
    ])
      expect(workspaceChord(k, false), k.code).not.toBeNull()
  })

  it('leaves page keys alone', () => {
    for (const k of [
      key('KeyT', { control: true }),
      key('KeyW', { control: true }),
      key('KeyC', { control: true }),
      key('ArrowLeft', { alt: true }),
      key('Digit2', { control: true, alt: true }, '@'),
      key('F5'),
      { ...key('KeyT', { control: true, shift: true }), type: 'keyUp' as const },
      { ...key('KeyK', { control: true }), isComposing: true },
    ])
      expect(workspaceChord(k as never, false), k.code).toBeNull()
  })

  it('uses Cmd chords on macOS', () => {
    expect(workspaceChord(key('KeyT', { meta: true }), true)).toMatchObject({ code: 'KeyT', metaKey: true })
    expect(workspaceChord(key('KeyD', { meta: true, shift: true }), true)).not.toBeNull()
    expect(workspaceChord(key('BracketRight', { meta: true, shift: true }), true)).not.toBeNull()
    expect(workspaceChord(key('Digit1', { meta: true }, '1'), true)).not.toBeNull()
    expect(workspaceChord(key('KeyK', { meta: true }), true)).not.toBeNull()
    expect(workspaceChord(key('KeyC', { meta: true }), true)).toBeNull()
    expect(workspaceChord(key('Tab', { control: true }), true)).toBeNull()
  })
})
