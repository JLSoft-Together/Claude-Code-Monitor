import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { avdDir, avdHome, avdInfo, emulatorArgs, isAvdName, parseEmuAvdName, parseIni, parseListAvds } from '../src/devices/avd'
import { AvdManager, type AvdManagerDeps } from '../src/devices/emulators'
import type { SpawnSpec, Spawner } from '../src/run/proc'

describe('avd parsers', () => {
  it('validates AVD names', () => {
    expect(isAvdName('Pixel_7_API_34')).toBe(true)
    expect(isAvdName('tv-1080p.v2')).toBe(true)
    expect(isAvdName('-wipe-data')).toBe(false)
    expect(isAvdName('.hidden')).toBe(false)
    expect(isAvdName('a b')).toBe(false)
    expect(isAvdName('a;rm')).toBe(false)
    expect(isAvdName('x'.repeat(101))).toBe(false)
    expect(isAvdName(5)).toBe(false)
  })

  it('skips emulator log lines in -list-avds', () => {
    const out = 'INFO    | Storing crashdata in: C:\\tmp\nWARNING | ANDROID_SDK_ROOT is missing\nPixel_7_API_34\r\nSmall_Phone\n\nPixel_7_API_34\n'
    expect(parseListAvds(out)).toEqual(['Pixel_7_API_34', 'Small_Phone'])
  })

  it('parses ini files, first key wins, comments ignored', () => {
    expect(parseIni('# c\nabi.type = x86_64\r\nhw.device.name=pixel_7\nabi.type=arm\nbad\n=x')).toEqual({ 'abi.type': 'x86_64', 'hw.device.name': 'pixel_7' })
  })

  it('reads the avd name from the emulator console', () => {
    expect(parseEmuAvdName('Pixel_7_API_34\r\nOK\r\n')).toBe('Pixel_7_API_34')
    expect(parseEmuAvdName('\nOK\n')).toBeNull()
    expect(parseEmuAvdName('KO: unknown command')).toBeNull()
  })

  it('resolves the AVD home like the emulator', () => {
    expect(avdHome({}, 'linux', '/home/u')).toEqual({ avd: '/home/u/.android/avd', user: '/home/u/.android' })
    expect(avdHome({ ANDROID_USER_HOME: '/x/.android' }, 'linux', '/home/u')).toEqual({ avd: '/x/.android/avd', user: '/x/.android' })
    expect(avdHome({ ANDROID_AVD_HOME: '/avds', ANDROID_USER_HOME: '/x' }, 'linux', '/h').avd).toBe('/avds')
    expect(avdHome({ ANDROID_SDK_HOME: '/sdkhome' }, 'linux', '/h').user).toBe('/sdkhome/.android')
    expect(avdHome({}, 'win32', 'C:\\Users\\u').avd).toBe('C:\\Users\\u\\.android\\avd')
  })

  it('finds the AVD folder from path, path.rel or the default', () => {
    const homes = { avd: '/h/.android/avd', user: '/h/.android' }
    expect(avdDir('P', { path: '/data/P.avd' }, homes, 'linux')).toBe('/data/P.avd')
    expect(avdDir('P', { 'path.rel': 'avd/P.avd' }, homes, 'linux')).toBe('/h/.android/avd/P.avd')
    expect(avdDir('P', null, homes, 'linux')).toBe('/h/.android/avd/P.avd')
  })

  it('builds the row from ini + config', () => {
    const info = avdInfo(
      'Pixel_7_API_34',
      { target: 'android-34' },
      { 'avd.ini.displayname': 'Pixel 7 API 34', 'abi.type': 'x86_64', 'hw.device.name': 'pixel_7', 'tag.id': 'google_apis_playstore' },
      'emulator-5554',
    )
    expect(info).toEqual({ name: 'Pixel_7_API_34', displayName: 'Pixel 7 API 34', api: 34, abi: 'x86_64', device: 'pixel_7', tag: 'google_apis_playstore', serial: 'emulator-5554' })
    expect(avdInfo('Small_Phone', null, { 'image.sysdir.1': 'system-images\\android-30\\google_apis\\x86\\' }, null)).toMatchObject({ displayName: 'Small Phone', api: 30, abi: null })
    expect(avdInfo('Preview', { target: 'android-VanillaIceCream' }, null, null).api).toBeNull()
  })

  it('maps start modes to emulator flags', () => {
    expect(emulatorArgs('A', 'normal')).toEqual(['-avd', 'A'])
    expect(emulatorArgs('A', 'cold')).toEqual(['-avd', 'A', '-no-snapshot-load'])
    expect(emulatorArgs('A', 'wipe')).toEqual(['-avd', 'A', '-wipe-data'])
  })
})

interface Child extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
  kill: () => boolean
}

function fakeSpawn(reply: (spec: SpawnSpec, child: Child) => void): { spawn: Spawner; calls: SpawnSpec[] } {
  const calls: SpawnSpec[] = []
  const spawn: Spawner = (spec) => {
    calls.push(spec)
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), kill: () => true }) as Child
    process.nextTick(() => reply(spec, child))
    return child as never
  }
  return { spawn, calls }
}

const done = (child: Child, out: string, code = 0): void => {
  child.stdout.emit('data', out)
  child.emit('close', code)
}

function setup(over: Partial<AvdManagerDeps> = {}, opts: { emulatorExits?: number } = {}) {
  const { spawn, calls } = fakeSpawn((spec, child) => {
    const args = spec.args.join(' ')
    if (args === '-list-avds') return done(child, 'Pixel_7\nSmall_Phone\n')
    if (args.endsWith('emu avd name')) return done(child, spec.args[1] === 'emulator-5554' ? 'Pixel_7\r\nOK\r\n' : 'OK\n')
    if (args.endsWith('emu kill')) return done(child, 'OK: killing emulator, bye bye\n')
    if (spec.detached && opts.emulatorExits !== undefined) child.emit('exit', opts.emulatorExits)
  })
  const files: Record<string, string> = {
    '/h/.android/avd/Pixel_7.ini': 'path=/h/.android/avd/Pixel_7.avd\ntarget=android-34\n',
    '/h/.android/avd/Pixel_7.avd/config.ini': 'abi.type=x86_64\navd.ini.displayname=Pixel 7\n',
  }
  const confirmWipe = vi.fn(async () => true)
  const mgr = new AvdManager({
    spawn,
    env: {},
    platform: 'linux',
    home: '/h',
    tools: async () => ({ adb: '/sdk/adb', emulator: '/sdk/emulator' }),
    liveRows: async () => [
      { id: 'emulator-5554', state: 'ready', model: null, product: null, device: null, transportId: null, usb: null },
      { id: 'emulator-5556', state: 'offline', model: null, product: null, device: null, transportId: null, usb: null },
      { id: 'R5CT', state: 'ready', model: null, product: null, device: null, transportId: null, usb: null },
    ],
    readText: async (f) => files[f] ?? null,
    confirmWipe,
    timing: { startGraceMs: 20 },
    ...over,
  })
  return { mgr, calls, confirmWipe }
}

describe('AvdManager', () => {
  it('lists AVDs and marks the running one', async () => {
    const { mgr, calls } = setup()
    const r = await mgr.list()
    expect(r).toEqual({
      ok: true,
      avds: [
        { name: 'Pixel_7', displayName: 'Pixel 7', api: 34, abi: 'x86_64', device: null, tag: null, serial: 'emulator-5554' },
        { name: 'Small_Phone', displayName: 'Small Phone', api: null, abi: null, device: null, tag: null, serial: null },
      ],
    })
    expect(calls.some((c) => c.args[1] === 'R5CT')).toBe(false)
  })

  it('reports a missing emulator binary', async () => {
    const { mgr } = setup({ tools: async () => ({ adb: '/adb', emulator: null }) })
    expect(await mgr.list()).toEqual({ ok: false, error: 'emulator-missing' })
    expect(await mgr.start('Pixel_7', 'normal')).toEqual({ ok: false, error: 'emulator-missing' })
  })

  it('starts a stopped AVD detached with the mode flags', async () => {
    const { mgr, calls } = setup()
    expect(await mgr.start('Small_Phone', 'cold')).toEqual({ ok: true })
    const spawned = calls.find((c) => c.detached)
    expect(spawned?.args).toEqual(['-avd', 'Small_Phone', '-no-snapshot-load'])
  })

  it('refuses running, unknown and cancelled-wipe starts', async () => {
    const { mgr, confirmWipe, calls } = setup()
    expect(await mgr.start('Pixel_7', 'normal')).toEqual({ ok: false, error: 'avd-running' })
    expect(await mgr.start('Nope', 'normal')).toEqual({ ok: false, error: 'invalid' })
    confirmWipe.mockResolvedValueOnce(false)
    expect(await mgr.start('Small_Phone', 'wipe')).toEqual({ ok: false, error: 'cancelled' })
    expect(calls.some((c) => c.detached)).toBe(false)
  })

  it('wipes only after the confirm', async () => {
    const { mgr, confirmWipe, calls } = setup()
    expect(await mgr.start('Small_Phone', 'wipe')).toEqual({ ok: true })
    expect(confirmWipe).toHaveBeenCalledWith('Small_Phone')
    expect(calls.find((c) => c.detached)?.args).toEqual(['-avd', 'Small_Phone', '-wipe-data'])
  })

  it('fails when the emulator exits during the grace period', async () => {
    const { mgr } = setup({}, { emulatorExits: 1 })
    expect(await mgr.start('Small_Phone', 'normal')).toEqual({ ok: false, error: 'emulator-failed', detail: 'exit 1' })
  })

  it('stops a running AVD through its serial', async () => {
    const { mgr, calls } = setup()
    expect(await mgr.stop('Pixel_7')).toEqual({ ok: true })
    expect(calls.at(-1)?.args).toEqual(['-s', 'emulator-5554', 'emu', 'kill'])
    expect(await mgr.stop('Small_Phone')).toEqual({ ok: false, error: 'avd-not-running' })
  })
})
