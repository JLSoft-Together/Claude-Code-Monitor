import { describe, expect, it } from 'vitest'
import type { AndroidProject, FlutterProject, RunDevice, RunSession } from '@ccm/shared'
import { fitsPlatforms, isErrorLine, newConfig, projectMark, runStep } from './runUi'

const dev = (platform: string): RunDevice => ({ id: platform, name: platform, platform, emulator: false, state: 'ready', source: 'flutter' })
const flutter = (over: Partial<FlutterProject> = {}): FlutterProject => ({
  kind: 'flutter',
  dir: 'C:\\app',
  name: 'app',
  type: 'app',
  entrypoints: ['lib/main.dart'],
  platforms: ['android', 'ios'],
  flavors: ['dev'],
  needsPubGet: false,
  fvm: null,
  ...over,
})
const android = (over: Partial<AndroidProject> = {}): AndroidProject => ({ kind: 'android', dir: 'C:\\n', name: 'n', framework: 'native', status: 'runnable', modules: [], ...over })

describe('run gaps (UI helpers)', () => {
  it('filters devices by the project platforms; unknown platforms and empty lists pass', () => {
    const platforms = flutter().platforms
    expect(fitsPlatforms(dev('android-arm64'), platforms)).toBe(true)
    expect(fitsPlatforms(dev('web-javascript'), platforms)).toBe(false)
    expect(fitsPlatforms(dev('windows-x64'), platforms)).toBe(false)
    expect(fitsPlatforms(dev('darwin'), ['macos'])).toBe(true)
    expect(fitsPlatforms(dev('fuchsia'), platforms)).toBe(true)
    expect(fitsPlatforms(dev('web-javascript'), [])).toBe(true)
  })

  it('error lines in raw build output', () => {
    for (const l of ['e: file:///a/Main.kt:3:5 Unresolved reference', 'FAILURE: Build failed with an exception.', 'BUILD FAILED in 3s', "lib/main.dart:5:3: Error: Expected ';'", '* What went wrong:'])
      expect(isErrorLine(l), l).toBe(true)
    for (const l of ['> Task :app:compileDebugKotlin', 'BUILD SUCCESSFUL in 2s', 'Running Gradle task'.toString()]) expect(isErrorLine(l), l).toBe(false)
  })

  it('project marks: framework, unsure state and reason', () => {
    expect(projectMark(flutter())).toEqual({ kind: 'flutter', label: 'type.app', unsure: false, reason: null, runnable: true })
    expect(projectMark(flutter({ type: 'package' }))).toMatchObject({ unsure: true, reason: 'package', runnable: false })
    expect(projectMark(flutter({ type: 'plugin', example: 'C:\\app\\example' }))).toMatchObject({ unsure: false, reason: 'pluginExample', runnable: true })
    expect(projectMark(android({ status: 'no-app' }))).toMatchObject({ label: 'framework.native', unsure: true, reason: 'no-app', runnable: false })
    const guessed = android({ status: 'unknown', modules: [{ path: ':app', dir: 'C:\\n\\app', type: 'unknown', manifest: null, launcher: true, guessed: true }] })
    expect(projectMark(guessed)).toMatchObject({ unsure: true, reason: 'unknown', runnable: true })
  })

  it('android pipeline step; flutter is indeterminate', () => {
    const s = (type: RunSession['type'], state: RunSession['state']) => ({ type, state }) as RunSession
    expect(runStep(s('android', 'installing'))).toEqual({ n: 2, total: 3 })
    expect(runStep(s('android', 'running'))).toBeNull()
    expect(runStep(s('flutter', 'starting'))).toBeNull()
  })

  it('new configs take the templates; the flavor only when the project declares it', () => {
    const templates = { flutter: { mode: 'profile' as const, flavor: 'dev', args: '--x' }, android: { variant: 'release', args: '--offline' } }
    expect(newConfig('flutter', 'a', 'A', [flutter()], 'C:\\', templates)).toMatchObject({ mode: 'profile', flavor: 'dev', args: '--x' })
    expect(newConfig('flutter', 'a', 'A', [flutter({ flavors: [] })], 'C:\\', templates)).toMatchObject({ flavor: '' })
    expect(newConfig('android', 'b', 'B', [android()], 'C:\\', templates)).toMatchObject({ variant: 'release', args: '--offline' })
  })
})
