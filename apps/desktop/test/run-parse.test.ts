import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  flutterDevice,
  installFailure,
  lineSplitter,
  machineRequest,
  parseAdbDevices,
  parseBuildError,
  parseLogcat,
  parseMachineLine,
  parseOutputMetadata,
  parseResolvedActivity,
  readAdbFrames,
} from '../src/run/parse'

const cwd = path.resolve('/proj')

describe('flutter machine protocol', () => {
  it('events, responses and plain text', () => {
    expect(parseMachineLine('[{"event":"app.started","params":{"appId":"a1"}}]')).toEqual({ kind: 'event', event: 'app.started', params: { appId: 'a1' } })
    expect(parseMachineLine('[{"id":3,"result":{"code":0}}]')).toEqual({ kind: 'response', id: 3, result: { code: 0 }, error: undefined })
    expect(parseMachineLine('Running Gradle task...')).toEqual({ kind: 'text', text: 'Running Gradle task...' })
    expect(parseMachineLine('[{broken}]').kind).toBe('text')
  })

  it('request framing', () => {
    expect(machineRequest(1, 'app.restart', { appId: 'a', fullRestart: true })).toBe('[{"id":1,"method":"app.restart","params":{"appId":"a","fullRestart":true}}]\n')
  })

  it('line splitter keeps partial lines across chunks', () => {
    const lines: string[] = []
    const s = lineSplitter((l) => lines.push(l))
    s.push('a\r\nb')
    s.push('c\nd')
    s.flush()
    expect(lines).toEqual(['a', 'bc', 'd'])
  })
})

describe('build errors', () => {
  it('kotlin uri form (K2)', () => {
    const e = parseBuildError('e: file:///C:/work/app/src/main/java/Main.kt:12:5 Unresolved reference: foo', cwd)
    expect(e).toMatchObject({ line: 12, col: 5, message: 'Unresolved reference: foo', severity: 'error' })
    expect(e!.file.replace(/\\/g, '/')).toMatch(/C:\/work\/app\/src\/main\/java\/Main\.kt$/)
  })

  it('kotlin old form, javac, aapt, dart', () => {
    expect(parseBuildError('w: /a/B.kt: (3, 7): Unused', cwd)).toMatchObject({ line: 3, col: 7, severity: 'warning' })
    expect(parseBuildError('/a/X.java:9: error: cannot find symbol', cwd)).toMatchObject({ line: 9, col: 1, message: 'cannot find symbol' })
    expect(parseBuildError('ERROR: /a/res/layout/main.xml:4: AAPT: error: attribute x not found.', cwd)).toMatchObject({ line: 4, severity: 'error' })
    const d = parseBuildError("lib/main.dart:10:3: Error: Expected ';' after this.", cwd)
    expect(d).toMatchObject({ line: 10, col: 3, severity: 'error' })
    expect(d!.file).toBe(path.join(cwd, 'lib/main.dart'))
    expect(parseBuildError('BUILD SUCCESSFUL in 3s', cwd)).toBeNull()
  })
})

describe('adb', () => {
  it('logcat threadtime', () => {
    expect(parseLogcat('10-15 12:34:56.789  1234  1250 I ActivityManager: Start proc')).toEqual({ level: 'I', tag: 'ActivityManager', text: 'Start proc' })
    expect(parseLogcat('--------- beginning of main')).toBeNull()
  })

  it('devices -l', () => {
    const out = 'List of devices attached\nR58M123 device usb:1-1 product:x model:SM_G991B device:o1s transport_id:2\nemulator-5554 offline\nabc unauthorized usb:1-2 transport_id:3\n'
    expect(parseAdbDevices(out)).toEqual([
      { id: 'R58M123', name: 'SM G991B', platform: 'android', emulator: false, state: 'ready', source: 'adb' },
      { id: 'emulator-5554', name: 'emulator-5554', platform: 'android', emulator: true, state: 'offline', source: 'adb' },
      { id: 'abc', name: 'abc', platform: 'android', emulator: false, state: 'unauthorized', source: 'adb' },
    ])
  })

  it('track-devices frames', () => {
    const body = 'R58\tdevice\n'
    const hex = body.length.toString(16).padStart(4, '0')
    expect(readAdbFrames(hex + body + '0000' + '00')).toEqual({ frames: [body, ''], rest: '00' })
  })

  it('output-metadata, resolve-activity, install failures', () => {
    const meta = JSON.stringify({ applicationId: 'com.x', elements: [{ outputFile: 'app-debug.apk' }] })
    expect(parseOutputMetadata(meta, '/out')).toEqual({ apk: path.join('/out', 'app-debug.apk'), applicationId: 'com.x' })
    expect(parseOutputMetadata('{}', '/out')).toBeNull()
    expect(parseResolvedActivity('priority=0 preferredOrder=0\ncom.x/.MainActivity\n', 'com.x')).toBe('com.x/.MainActivity')
    expect(parseResolvedActivity('No activity found', 'com.x')).toBeNull()
    expect(installFailure('Performing Streamed Install\nSuccess\n')).toBeNull()
    expect(installFailure('Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: ...]')).toBe('signature')
    expect(installFailure('Failure [INSTALL_FAILED_NO_MATCHING_ABIS]')).toBe('abi')
  })
})

it('flutter device entry', () => {
  expect(flutterDevice({ id: 'chrome', name: 'Chrome', platform: 'web-javascript', emulator: false })).toEqual({
    id: 'chrome',
    name: 'Chrome',
    platform: 'web-javascript',
    emulator: false,
    state: 'ready',
    source: 'flutter',
  })
  expect(flutterDevice({ name: 'x' })).toBeNull()
})
