import { describe, expect, it } from 'vitest'
import { findAction, isSeparator, type MenuEntry } from '../menu'
import { explorerKey, explorerMenu, isRunConfigPath, isRunnableRow, riskHintKey } from './contextMenu'
import type { TreeRow } from './tree'

const t = (k: string) => k.split('.').pop()!
const row = (p: Partial<TreeRow>): TreeRow => ({ path: 'C:\\r\\a.ts', name: 'a.ts', directory: false, depth: 1, expanded: false, outOfRoot: false, ...p })
const ids = (e: MenuEntry[]) => e.map((x) => (isSeparator(x) ? '-' : x.id))
const ctx = { mac: false, repo: true, changed: true }

describe('explorerMenu', () => {
  it('has the minimal Android Studio set, in order', () => {
    expect(ids(explorerMenu(row({}), ctx, t))).toEqual(['new', '-', 'copy-ref', '-', 'rename', 'trash', '-', 'open-split', 'open-in', '-', 'git', '-', 'reload'])
  })
  it('protects the root row and keeps folders out of the right split', () => {
    const root = explorerMenu(row({ depth: 0, directory: true }), ctx, t)
    expect(findAction(root, 'rename')?.disabled).toBe(true)
    expect(findAction(root, 'trash')?.disabled).toBe(true)
    expect(findAction(explorerMenu(row({ directory: true }), ctx, t), 'open-split')?.disabled).toBe(true)
  })
  it('enables Show Diff only on a changed file and drops Git outside a repo', () => {
    expect(findAction(explorerMenu(row({}), { ...ctx, changed: false }, t), 'show-diff')?.disabled).toBe(true)
    expect(ids(explorerMenu(row({}), { ...ctx, repo: false }, t))).not.toContain('git')
  })
  it('names the file manager and shortcuts per platform', () => {
    expect(findAction(explorerMenu(row({}), { ...ctx, mac: true }, t), 'reveal')?.label).toBe('finder')
    expect(findAction(explorerMenu(row({}), { ...ctx, mac: true }, t), 'trash')?.shortcut).toBe('⌘⌫')
    expect(findAction(explorerMenu(row({}), ctx, t), 'trash')?.shortcut).toBe('Delete')
  })
  it('offers Run… on folders and project files only when the Run pane exists', () => {
    const run = { ...ctx, run: true }
    expect(ids(explorerMenu(row({ name: 'pubspec.yaml', path: 'C:\\r\\pubspec.yaml' }), run, t))).toContain('run')
    expect(ids(explorerMenu(row({ name: 'app', directory: true }), run, t))).toContain('run')
    expect(ids(explorerMenu(row({ depth: 0, directory: true }), run, t))).toContain('run')
    expect(ids(explorerMenu(row({}), run, t))).not.toContain('run')
    expect(ids(explorerMenu(row({ name: 'pubspec.yaml' }), ctx, t))).not.toContain('run')
  })
  it('warns before renaming or deleting shared run configurations', () => {
    const cfg = explorerMenu(row({ path: 'C:\\r\\.agent-monitor\\run\\app.json', name: 'app.json' }), ctx, t)
    expect(findAction(cfg, 'rename')?.hint).toBe('runConfigHint')
    expect(findAction(cfg, 'trash')?.disabled).toBe(false)
    expect(findAction(explorerMenu(row({}), ctx, t), 'rename')?.hint).toBeUndefined()
  })
  it('warns before deleting .git or anything inside it', () => {
    expect(findAction(explorerMenu(row({ path: 'C:\\r\\.git', name: '.git', directory: true }), ctx, t), 'trash')?.hint).toBe('gitHint')
    expect(findAction(explorerMenu(row({ path: '/r/.git/HEAD', name: 'HEAD' }), ctx, t), 'trash')?.hint).toBe('gitHint')
    expect(riskHintKey('/r/.gitignore')).toBeNull()
    expect(riskHintKey('/r/.github/workflows/a.yml')).toBeNull()
    expect(riskHintKey('/r/.agent-monitor/run/a.json')).toBe('workspace.explorer.menu.runConfigHint')
  })
})

describe('row helpers', () => {
  it('decides runnable rows by name', () => {
    expect(isRunnableRow({ name: 'build.gradle.kts', directory: false, depth: 2, outOfRoot: false })).toBe(true)
    expect(isRunnableRow({ name: 'Settings.gradle', directory: false, depth: 2, outOfRoot: false })).toBe(true)
    expect(isRunnableRow({ name: 'main.dart', directory: false, depth: 2, outOfRoot: false })).toBe(false)
    expect(isRunnableRow({ name: 'link', directory: true, depth: 2, outOfRoot: true })).toBe(false)
  })
  it('spots the shared run configuration folder', () => {
    expect(isRunConfigPath('/r/.agent-monitor/run/a.json')).toBe(true)
    expect(isRunConfigPath('C:\\r\\.agent-monitor\\run')).toBe(true)
    expect(isRunConfigPath('C:\\r\\.agent-monitor')).toBe(true)
    expect(isRunConfigPath('/r/.agent-monitor/runner.json')).toBe(false)
    expect(isRunConfigPath('/r/src/run/a.json')).toBe(false)
  })
})

describe('explorerKey', () => {
  const k = (key: string, m: Partial<Record<'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {}) => ({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...m })
  it('maps the JetBrains keys', () => {
    expect(explorerKey(k('F6', { shiftKey: true }), false)).toBe('rename')
    expect(explorerKey(k('Delete'), false)).toBe('trash')
    expect(explorerKey(k('Backspace', { metaKey: true }), true)).toBe('trash')
    expect(explorerKey(k('Delete'), true)).toBeNull()
    expect(explorerKey(k('Enter', { shiftKey: true }), false)).toBe('open-split')
    expect(explorerKey(k('ContextMenu'), false)).toBe('menu')
    expect(explorerKey(k('F10', { shiftKey: true }), false)).toBe('menu')
    expect(explorerKey(k('Enter'), false)).toBeNull()
  })
})
