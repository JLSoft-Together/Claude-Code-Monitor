import { describe, expect, it } from 'vitest'
import type { RunSession, TerminalStatus } from '@ccm/shared'
import { agentsFinished, autoReloadAction } from './runAutoReload'

const session = (over: Partial<RunSession>): RunSession =>
  ({ id: 's', configId: 'c', configName: 'c', type: 'flutter', cwd: 'C:/app', deviceId: null, deviceName: null, mode: 'debug', state: 'running', startedAt: 1, endedAt: null, appId: null, vmServiceUri: null, devtoolsUri: null, failure: null, progress: null, ...over }) as RunSession

describe('agentsFinished', () => {
  it('fires on working to idle only', () => {
    const prev = new Map<string, TerminalStatus>()
    expect(agentsFinished(prev, [{ id: 'a', status: 'working' }])).toEqual([])
    expect(agentsFinished(prev, [{ id: 'a', status: 'idle' }])).toEqual(['a'])
    expect(agentsFinished(prev, [{ id: 'a', status: 'idle' }])).toEqual([])
  })

  it('ignores errors, waiting and sessions first seen idle', () => {
    const prev = new Map<string, TerminalStatus>()
    agentsFinished(prev, [{ id: 'a', status: 'working' }, { id: 'b', status: 'working' }])
    expect(agentsFinished(prev, [{ id: 'a', status: 'error' }, { id: 'b', status: 'waiting' }, { id: 'c', status: 'idle' }])).toEqual([])
  })

  it('forgets terminals that disappeared', () => {
    const prev = new Map<string, TerminalStatus>()
    agentsFinished(prev, [{ id: 'a', status: 'working' }])
    agentsFinished(prev, [])
    expect(prev.size).toBe(0)
  })
})

describe('autoReloadAction', () => {
  it('hot reloads Flutter debug and custom runs with an app id', () => {
    expect(autoReloadAction(session({}))).toBe('reload')
    expect(autoReloadAction(session({ type: 'custom', mode: null, appId: 'x' }))).toBe('reload')
  })

  it('reruns Android, skips release / profile and anything not running', () => {
    expect(autoReloadAction(session({ type: 'android', mode: null }))).toBe('rerun')
    expect(autoReloadAction(session({ mode: 'release' }))).toBeNull()
    expect(autoReloadAction(session({ state: 'building' }))).toBeNull()
    expect(autoReloadAction(session({ type: 'custom', mode: null }))).toBeNull()
    expect(autoReloadAction(null)).toBeNull()
  })
})
