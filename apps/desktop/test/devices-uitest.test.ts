import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { filterLinks, gradleAppId, parseManifest, qualify, readProjectManifest, valuesLocale } from '../src/devices/manifest'
import { DeviceUiTester, type Shell } from '../src/devices/uiTester'
import {
  changeCommands,
  cleanChange,
  cleanLaunch,
  launchCommand,
  parseAppLocales,
  parseDensity,
  parseLaunch,
  parseNight,
  parseSetting,
  restoreCommands,
  shQuote,
} from '../src/devices/uiToggles'

describe('display test commands', () => {
  it('parses device answers', () => {
    expect(parseNight('Night mode: yes')).toBe('yes')
    expect(parseNight('Night mode: custom_schedule')).toBe('custom')
    expect(parseNight('')).toBeNull()
    expect(parseSetting('null\n')).toBeNull()
    expect(parseSetting('1.3\n')).toBe('1.3')
    expect(parseSetting('rm -rf')).toBeNull()
    expect(parseDensity('Physical density: 440\nOverride density: 400\n')).toEqual({ physical: 440, override: 400 })
    expect(parseDensity('Physical density: 440')).toEqual({ physical: 440, override: null })
    expect(parseAppLocales('Locales for com.app for user 0 are [vi-VN, en]')).toBe('vi-VN,en')
    expect(parseAppLocales('Locales for com.app for user 0 are []')).toBe('')
    expect(parseAppLocales('Unknown command: locale')).toBeNull()
  })

  it('accepts only in-range changes', () => {
    expect(cleanChange({ key: 'night', value: 'yes' })).toEqual({ key: 'night', value: 'yes' })
    expect(cleanChange({ key: 'night', value: 'yes; reboot' })).toBeNull()
    expect(cleanChange({ key: 'fontScale', value: 1.333 })).toEqual({ key: 'fontScale', value: 1.33 })
    expect(cleanChange({ key: 'fontScale', value: 9 })).toBeNull()
    expect(cleanChange({ key: 'density', value: null })).toEqual({ key: 'density', value: null })
    expect(cleanChange({ key: 'density', value: 420.5 })).toBeNull()
    expect(cleanChange({ key: 'locale', pkg: 'com.app', value: 'vi' })).toEqual({ key: 'locale', pkg: 'com.app', value: 'vi' })
    expect(cleanChange({ key: 'locale', pkg: 'com.app', value: "vi' ; rm" })).toBeNull()
    expect(cleanChange({ key: 'locale', pkg: 'com app', value: 'vi' })).toBeNull()
    expect(cleanChange({ key: 'other' })).toBeNull()
  })

  it('builds argv lists and their restores', () => {
    expect(changeCommands({ key: 'fontScale', value: 1.3 }, {})).toEqual([['settings', 'put', 'system', 'font_scale', '1.3']])
    expect(changeCommands({ key: 'density', value: null }, {})).toEqual([['wm', 'density', 'reset']])
    expect(changeCommands({ key: 'animations', off: true }, {})).toHaveLength(3)
    expect(changeCommands({ key: 'animations', off: false }, { animations: ['0.5', null, '1'] })).toEqual([
      ['settings', 'put', 'global', 'window_animation_scale', '0.5'],
      ['settings', 'put', 'global', 'transition_animation_scale', '1'],
      ['settings', 'put', 'global', 'animator_duration_scale', '1'],
    ])
    expect(changeCommands({ key: 'locale', pkg: 'com.app', value: '' }, {})).toEqual([['cmd', 'locale', 'set-app-locales', 'com.app', '--locales', "''"]])
    expect(restoreCommands({ night: 'custom', fontScale: null, density: 400, locales: { 'com.app': 'vi-VN,en', 'bad pkg': 'x' } })).toEqual([
      ['cmd', 'uimode', 'night', 'auto'],
      ['settings', 'delete', 'system', 'font_scale'],
      ['wm', 'density', '400'],
      ['cmd', 'locale', 'set-app-locales', 'com.app', '--locales', 'vi-VN,en'],
    ])
  })

  it('quotes deep links for the remote shell and validates targets', () => {
    expect(shQuote("a'b")).toBe(`'a'\\''b'`)
    expect(launchCommand({ kind: 'uri', uri: 'myapp://item/1?x=1&y=2', pkg: 'com.app' })).toEqual(['am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', "'myapp://item/1?x=1&y=2'", 'com.app'])
    expect(launchCommand({ kind: 'activity', pkg: 'com.app', activity: '.Main' })).toEqual(['am', 'start', '-W', '-n', 'com.app/.Main'])
    expect(cleanLaunch({ kind: 'uri', uri: 'https://x.dev/a b', pkg: null })).toBeNull()
    expect(cleanLaunch({ kind: 'uri', uri: 'myapp://x\n', pkg: null })).toBeNull()
    expect(cleanLaunch({ kind: 'uri', uri: 'myapp://x', pkg: null })).toEqual({ kind: 'uri', uri: 'myapp://x', pkg: null })
    expect(cleanLaunch({ kind: 'activity', pkg: 'com.app', activity: 'Main;reboot' })).toBeNull()
  })

  it('reads am start results', () => {
    expect(parseLaunch('Starting: Intent { }\nStatus: ok\nLaunchState: COLD\n')).toEqual({ ok: true })
    expect(parseLaunch('Warning: Activity not started, its current task has been brought to the front\nStatus: ok')).toEqual({ ok: true, detail: 'Activity not started, its current task has been brought to the front' })
    expect(parseLaunch('Error: Activity not started, unable to resolve Intent { act=android.intent.action.VIEW }')).toMatchObject({ ok: false })
    expect(parseLaunch('Error type 3\nError: Activity class {com.app/.X} does not exist.')).toMatchObject({ ok: false })
  })
})

const MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.app">
  <application>
    <!-- <activity android:name=".Hidden" android:exported="true" /> -->
    <activity android:name=".MainActivity" android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
      <intent-filter android:autoVerify="true">
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <data android:scheme="https" />
        <data android:scheme="myapp" />
        <data android:host="example.com" />
        <data android:pathPrefix="/item" />
      </intent-filter>
    </activity>
    <activity android:name="com.app.settings.SettingsActivity" android:exported="false" />
    <activity android:name="Detail">
      <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <data android:scheme="detail" />
      </intent-filter>
    </activity>
  </application>
</manifest>`

describe('manifest deep links', () => {
  it('lists activities, exported, launcher and sample links', () => {
    const m = parseManifest(MANIFEST)
    expect(m.pkg).toBe('com.app')
    expect(m.activities).toEqual([
      { activity: 'com.app.MainActivity', exported: true, launcher: true, links: ['https://example.com/item', 'myapp://example.com/item'] },
      { activity: 'com.app.settings.SettingsActivity', exported: false, launcher: false, links: [] },
      { activity: 'com.app.Detail', exported: true, launcher: false, links: ['detail://'] },
    ])
  })

  it('small helpers', () => {
    expect(qualify('.A', null)).toBe('.A')
    expect(filterLinks([{ scheme: 'https', host: '*.x.dev', path: 'p' }])).toEqual(['https://x.dev/p'])
    expect(gradleAppId('android {\n  namespace = "com.ns"\n  // applicationId "com.old"\n  defaultConfig { applicationId = "com.real" }\n}')).toBe('com.real')
    expect(gradleAppId('android { namespace "com.ns" }')).toBe('com.ns')
    expect(valuesLocale('values-vi')).toBe('vi')
    expect(valuesLocale('values-pt-rBR')).toBe('pt-BR')
    expect(valuesLocale('values-b+sr+Latn')).toBe('sr-Latn')
    expect(valuesLocale('values-night')).toBeNull()
    expect(valuesLocale('values-v21')).toBeNull()
  })

  it('reads the app module manifest, gradle id and locales from disk', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'ccm-manifest-'))
    const main = path.join(root, 'android', 'app', 'src', 'main')
    mkdirSync(path.join(main, 'res', 'values-vi'), { recursive: true })
    mkdirSync(path.join(main, 'res', 'values-night'), { recursive: true })
    mkdirSync(path.join(root, 'lib', 'l10n'), { recursive: true })
    writeFileSync(path.join(root, 'lib', 'l10n', 'app_ja.arb'), '{}')
    writeFileSync(path.join(main, 'AndroidManifest.xml'), MANIFEST.replace(' package="com.app"', ''))
    writeFileSync(path.join(root, 'android', 'app', 'build.gradle'), 'android { defaultConfig { applicationId "com.flutter.app" } }')
    const r = await readProjectManifest(root)
    expect(r).toMatchObject({ ok: true, manifest: 'android/app/src/main/AndroidManifest.xml', pkg: 'com.flutter.app', locales: ['ja', 'vi'] })
    expect(r.ok && r.activities[0]!.activity).toBe('com.flutter.app.MainActivity')
    expect(await readProjectManifest(path.join(root, 'lib'))).toEqual({ ok: false, error: 'no-manifest' })
  })
})

/** A fake device: `settings` / `wm` / `uimode` / `locale` commands against an in-memory table. */
function device(sdk = 34) {
  const s: Record<string, string | null> = { night: 'no', font_scale: null, density: null, window_animation_scale: '1.0', transition_animation_scale: '1.0', animator_duration_scale: null, 'locale:com.app': '' }
  const calls: string[] = []
  const shell: Shell = async (_id, args) => {
    calls.push(args.join(' '))
    const ok = (out = '') => ({ code: 0, out })
    const [a, b, c, d, e] = args
    if (a === 'getprop') return ok(`${sdk}\n`)
    if (a === 'cmd' && b === 'uimode') {
      if (d) s.night = d
      return ok(`Night mode: ${s.night}\n`)
    }
    if (a === 'settings' && b === 'get') return ok(`${s[d!] ?? 'null'}\n`)
    if (a === 'settings' && b === 'put') return (s[d!] = e!), ok()
    if (a === 'settings' && b === 'delete') return (s[d!] = null), ok('Deleted 1 rows')
    if (a === 'wm') {
      if (c === 'reset') s.density = null
      else if (c) s.density = c
      return ok(`Physical density: 440\n${s.density ? `Override density: ${s.density}\n` : ''}`)
    }
    if (a === 'cmd' && b === 'locale' && c === 'get-app-locales') return ok(`Locales for ${d} for user 0 are [${s[`locale:${d}`]}]`)
    if (a === 'cmd' && b === 'locale' && c === 'set-app-locales') return (s[`locale:${d}`] = args[5] === "''" ? '' : args[5]!), ok()
    return { code: 1, out: 'Unknown command' }
  }
  return { s, calls, shell }
}

describe('DeviceUiTester', () => {
  const file = () => path.join(mkdtempSync(path.join(os.tmpdir(), 'ccm-uitest-')), 'adb-ui-originals.json')

  it('keeps the first original, persists it and restores everything', async () => {
    const dev = device()
    const f = file()
    const t = new DeviceUiTester({ shell: dev.shell, file: f })
    const first = await t.read('d1', 'com.app')
    expect(first).toMatchObject({ ok: true, state: { sdk: 34, night: 'no', fontScale: 1, animationsOff: false, locale: { supported: true, current: '' }, changed: [] } })
    await t.apply('d1', { key: 'night', value: 'yes' }, 'com.app')
    await t.apply('d1', { key: 'fontScale', value: 1.3 }, 'com.app')
    await t.apply('d1', { key: 'fontScale', value: 2 }, 'com.app')
    await t.apply('d1', { key: 'density', value: 360 }, 'com.app')
    await t.apply('d1', { key: 'locale', pkg: 'com.app', value: 'vi' }, 'com.app')
    const r = await t.apply('d1', { key: 'animations', off: true }, 'com.app')
    expect(r).toMatchObject({ ok: true, state: { night: 'yes', fontScale: 2, density: { override: 360 }, animationsOff: true, locale: { current: 'vi' } } })
    expect(r.ok && r.state.changed).toEqual(['night', 'fontScale', 'density', 'animations', 'locale'])
    expect(JSON.parse(readFileSync(f, 'utf8')).devices.d1).toEqual({ night: 'no', fontScale: null, density: null, animations: ['1.0', '1.0', null], locales: { 'com.app': '' } })

    // A new tester (app restart) still knows the originals.
    const again = new DeviceUiTester({ shell: dev.shell, file: f })
    const back = await again.restore('d1', 'com.app')
    expect(back).toMatchObject({ ok: true, state: { night: 'no', fontScale: 1, density: { override: null }, animationsOff: false, locale: { current: '' }, changed: [] } })
    expect(dev.s.font_scale).toBeNull()
    expect(dev.s.animator_duration_scale).toBeNull()
    expect(JSON.parse(readFileSync(f, 'utf8')).devices).toEqual({})
  })

  it('animations back on drop their original', async () => {
    const dev = device()
    const t = new DeviceUiTester({ shell: dev.shell, file: file() })
    await t.apply('d1', { key: 'animations', off: true }, null)
    const r = await t.apply('d1', { key: 'animations', off: false }, null)
    expect(r.ok && r.state.changed).toEqual([])
    expect(dev.s.window_animation_scale).toBe('1.0')
  })

  it('per-app locale needs Android 13', async () => {
    const dev = device(30)
    const t = new DeviceUiTester({ shell: dev.shell, file: file() })
    expect(await t.read('d1', 'com.app')).toMatchObject({ ok: true, state: { locale: { supported: false, current: null } } })
    expect(await t.apply('d1', { key: 'locale', pkg: 'com.app', value: 'vi' }, 'com.app')).toEqual({ ok: false, error: 'unsupported' })
    expect(dev.calls.some((c) => c.includes('set-app-locales'))).toBe(false)
  })

  it('ignores a corrupt originals file', async () => {
    const f = file()
    writeFileSync(f, JSON.stringify({ devices: { d1: { night: 'rm -rf', fontScale: 'x; reboot' } } }))
    const t = new DeviceUiTester({ shell: device().shell, file: f })
    expect(await t.read('d1', null)).toMatchObject({ ok: true, state: { changed: [] } })
  })
})
