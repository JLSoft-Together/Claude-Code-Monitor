import { describe, expect, it } from 'vitest'
import type { RunConfig, RunSession } from '@ccm/shared'
import { configChanges, configIssues, issueKey, moveItem, newConfig, runBadge, tidyIssueText } from './runUi'

const cfg = (id: string, over: Partial<RunConfig> = {}): RunConfig =>
  ({ id, name: id, cwd: 'C:\\app', shared: false, env: {}, beforeLaunch: [], type: 'flutter', entrypoint: 'lib/main.dart', device: 'selected', mode: 'debug', flavor: '', args: '', attachArgs: '', ...over }) as RunConfig

const session = (id: string, state: RunSession['state'], startedAt: number): RunSession => ({
  id, configId: 'c', configName: 'c', type: 'flutter', cwd: 'C:\\app', deviceId: null, deviceName: null, mode: 'debug', state, startedAt,
  endedAt: null, appId: null, vmServiceUri: null, devtoolsUri: null, failure: null, progress: null,
})

describe('run ui helpers', () => {
  it('resolves issue keys: detail sub-key, then .other, then the code, then generic', () => {
    const keys = new Set(['run.fail.install.signature', 'run.fail.install.other', 'run.env.sdk-missing', 'run.error.denied'])
    const te = (k: string): boolean => keys.has(k)
    expect(issueKey({ code: 'install', detail: 'signature' }, ['fail'], te).key).toBe('run.fail.install.signature')
    expect(issueKey({ code: 'install', detail: 'weird' }, ['fail'], te).key).toBe('run.fail.install.other')
    expect(issueKey({ code: 'sdk-missing' }, ['fail', 'env'], te).key).toBe('run.env.sdk-missing')
    expect(issueKey({ code: 'nope' }, ['error'], te)).toEqual({ key: 'run.error.unknown', params: { detail: '', code: 'nope' } })
    expect(tidyIssueText('Install failed ().')).toBe('Install failed.')
  })

  it('badge: building beats running; failed only when the newest run failed', () => {
    expect(runBadge([])).toBeNull()
    expect(runBadge([session('a', 'running', 1), session('b', 'building', 2)])).toBe('busy')
    expect(runBadge([session('a', 'running', 1), session('b', 'reloading', 2)])).toBe('running')
    expect(runBadge([session('a', 'stopped', 3), session('b', 'failed', 2)])).toBeNull()
    expect(runBadge([session('a', 'stopped', 1), session('b', 'failed', 2)])).toBe('failed')
  })

  it('apply saves changed and new configs, deletes removed ones, and keeps every generated default', () => {
    const stored = [cfg('a'), cfg('b')]
    expect(configChanges(stored, stored.map((c) => ({ ...c })))).toEqual({ save: [], remove: [] })
    const edited = configChanges(stored, [{ ...stored[0]!, name: 'A' } as RunConfig, cfg('c')])
    expect(edited.save.map((c) => c.id)).toEqual(['a', 'c'])
    expect(edited.remove).toEqual(['b'])
    const defaults = [cfg('auto-1'), cfg('auto-2'), cfg('auto-3')]
    const res = configChanges(defaults, [{ ...defaults[0]!, args: '--x' } as RunConfig, defaults[1]!])
    expect(res.save.map((c) => c.id)).toEqual(['auto-1', 'auto-2'])
    expect(res.remove).toEqual([])
  })

  it('validates names, env keys and flavors; moves steps; blank configs point at the first project', () => {
    expect(configIssues(cfg('a', { name: ' ', flavor: 'bad-flavor' } as Partial<RunConfig>), [{ key: '1X', value: '' }, { key: 'A', value: '' }, { key: 'A', value: '' }]).map((i) => i.code)).toEqual([
      'name',
      'env',
      'envDup',
      'flavor',
    ])
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b'])
    expect(moveItem(['a', 'b'], 0, -1)).toEqual(['a', 'b'])
    const android = newConfig('android', 'n', 'New', [{ kind: 'android', dir: 'C:\\app\\android', name: 'a', framework: 'native', status: 'runnable', modules: [{ path: ':lib', dir: '', type: 'library', manifest: null, launcher: false, guessed: false }, { path: ':app', dir: '', type: 'application', manifest: null, launcher: true, guessed: false }] }], 'C:\\app')
    expect(android).toMatchObject({ type: 'android', cwd: 'C:\\app\\android', module: ':app', variant: 'debug' })
    expect(newConfig('custom', 'n', 'Cmd', [], 'C:\\app')).toMatchObject({ type: 'custom', cwd: 'C:\\app', command: '' })
  })
})
