import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PLAY_TARGET_SDK, type ReleaseCheckResult, type ReleaseFinding, type ReleaseVerifyResult } from '@ccm/shared'
import { registerReleaseIpc } from '../src/releaseCheck/ipc'
import {
  admobFindings,
  buildFindings,
  certFinding,
  extrasFindings,
  manifestFindings,
  maskComments,
  parseApksigner,
  parseGradleApp,
  parseKeytool,
  parsePubspecVersion,
  sdkFindings,
  versionFindings,
} from '../src/releaseCheck/rules'
import { newestArtifact, scanRelease } from '../src/releaseCheck/scan'
import { findSignTools, readSigner } from '../src/releaseCheck/sign'
import { ReleaseStore } from '../src/releaseCheck/store'

const FIXTURE = path.resolve(__dirname, '../e2e/fixtures/release-check')
const SHA_A = Array.from({ length: 32 }, () => 'AB').join(':')
const SHA_B = Array.from({ length: 32 }, () => 'CD').join(':')

const tmps: string[] = []
const tmp = (): string => {
  const d = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ccm-release-')))
  tmps.push(d)
  return d
}
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true })
})

const put = (root: string, rel: string, text: string): string => {
  const file = path.join(root, rel)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text)
  return file
}
const by = (list: ReleaseFinding[], rule: string): ReleaseFinding[] => list.filter((f) => f.rule === rule)
const one = (list: ReleaseFinding[], rule: string): ReleaseFinding => {
  const hit = by(list, rule)
  expect(hit, rule).toHaveLength(1)
  return hit[0]!
}

const KTS = `plugins { id("com.android.application") }
android {
  compileSdk = 36 // keep in sync
  defaultConfig {
    minSdk = 24
    targetSdk = 36
    versionCode = 12
    versionName = "2.1.0"
  }
  signingConfigs { release { storeFile = file("k.jks") } }
  buildTypes {
    getByName("release") {
      isMinifyEnabled = true
      isShrinkResources = true
      signingConfig = signingConfigs.getByName("release")
    }
  }
}`

const GROOVY = `android {
    compileSdkVersion 33
    /* versionCode 99 */
    defaultConfig {
        minSdkVersion flutter.minSdkVersion
        targetSdkVersion 33
        versionCode flutterVersionCode.toInteger()
        versionName flutterVersionName
    }
    buildTypes {
        release { signingConfig signingConfigs.debug }
    }
}`

describe('release rules: gradle', () => {
  it('masks comments but keeps strings and line numbers', () => {
    const src = 'a = "http://x" // note\n/* b\nc */ d'
    const m = maskComments(src, 'c')
    expect(m).toHaveLength(src.length)
    expect(m).toContain('"http://x"')
    expect(m).not.toContain('note')
    expect(m.split('\n')).toHaveLength(3)
    expect(maskComments('<a/><!-- x\ny -->', 'xml')).toBe(`<a/>${' '.repeat(6)}\n${' '.repeat(5)}`)
  })

  it('reads a Kotlin DSL app module', () => {
    const g = parseGradleApp(KTS)
    expect(g.versionCode).toMatchObject({ value: 12, line: 7 })
    expect(g.versionName).toMatchObject({ value: '2.1.0', line: 8 })
    expect(g.compileSdk?.value).toBe(36)
    expect(g.targetSdk?.value).toBe(36)
    expect(g.release?.minify?.value).toBe(true)
    expect(g.release?.signing?.name).toBe('release')
    const f = buildFindings(g, 'b', false)
    expect(f.map((x) => x.status)).toEqual(['ok', 'ok', 'ok', 'ok'])
    expect(sdkFindings(g, 'b', false).map((x) => [x.rule, x.status])).toEqual([
      ['target-sdk', 'ok'],
      ['min-sdk', 'ok'],
      ['compile-sdk', 'ok'],
    ])
  })

  it('reads Groovy, ignoring commented values, and flags the Flutter debug signing trap', () => {
    const g = parseGradleApp(GROOVY)
    expect(g.versionCode).toMatchObject({ value: null, raw: 'flutterVersionCode.toInteger()', line: 7 })
    expect(g.minSdk?.raw).toBe('flutter.minSdkVersion')
    expect(g.release?.signing?.name).toBe('debug')
    const f = buildFindings(g, 'b', true)
    expect(one(f, 'minify')).toMatchObject({ status: 'ok', detail: 'flutterDefault' })
    expect(one(f, 'signing')).toMatchObject({ status: 'warn', detail: 'debugKey', line: 11 })
    const sdk = sdkFindings(g, 'b', true)
    expect(one(sdk, 'target-sdk')).toMatchObject({ status: 'fail', detail: 'low', params: { n: 33, need: PLAY_TARGET_SDK } })
    expect(one(sdk, 'min-sdk').status).toBe('unknown')
  })

  it('handles a missing release block and debuggable builds', () => {
    const none = buildFindings(parseGradleApp('android {\n  buildTypes {\n    debug {}\n  }\n}'), 'b', false)
    expect(one(none, 'minify')).toMatchObject({ status: 'warn', detail: 'missing', line: 2 })
    expect(one(none, 'signing').detail).toBe('none')
    const dbg = buildFindings(parseGradleApp('android { buildTypes { release { debuggable true; minifyEnabled false } } }'), 'b', false)
    expect(one(dbg, 'debuggable').status).toBe('fail')
    expect(one(dbg, 'minify')).toMatchObject({ status: 'warn', detail: 'off' })
    expect(parseGradleApp('android { compileSdk {\n version = release(36)\n } }').compileSdk?.value).toBe(36)
  })
})

describe('release rules: version', () => {
  const base = { codeRaw: '12', file: 'f', codeLine: 3, nameLine: 4 }
  it('compares with the version marked released', () => {
    expect(versionFindings({ ...base, code: 12, name: '2.0' }, null)[0]).toMatchObject({ status: 'ok', detail: 'first' })
    expect(versionFindings({ ...base, code: 13, name: '2.1' }, { code: 12, name: '2.0', at: 1 }).map((f) => f.status)).toEqual(['ok', 'ok'])
    const same = versionFindings({ ...base, code: 12, name: '2.0' }, { code: 12, name: '2.0', at: 1 })
    expect(same.map((f) => [f.status, f.detail])).toEqual([
      ['fail', 'notRaised'],
      ['warn', 'same'],
    ])
    expect(versionFindings({ ...base, code: 14, name: '1.9' }, { code: 12, name: '2.0', at: 1 })[1]!.detail).toBe('lower')
    expect(versionFindings({ ...base, code: null, codeRaw: null, name: null }, null).map((f) => f.status)).toEqual(['fail', 'warn'])
  })

  it('reads the pubspec version', () => {
    expect(parsePubspecVersion('name: app\n# version: 9.9.9+99\nversion: 1.4.2+31\n')).toEqual({ name: '1.4.2', code: 31, raw: '1.4.2+31', line: 3 })
    expect(parsePubspecVersion('version: 1.0.0')?.code).toBeNull()
  })
})

describe('release rules: manifest, ads, extras, certificates', () => {
  it('reports cleartext, debuggable, bare exported components and sensitive permissions', () => {
    const xml = `<manifest>
  <uses-permission android:name="android.permission.READ_SMS" />
  <uses-permission android:name="android.permission.QUERY_ALL_PACKAGES" tools:node="remove" />
  <!-- <uses-permission android:name="android.permission.READ_CALL_LOG" /> -->
  <application
      android:usesCleartextTraffic="true" android:debuggable="true">
    <activity android:name=".Main" android:exported="true"><intent-filter><action android:name="x"/></intent-filter></activity>
    <receiver android:name=".Boot" android:exported="true" />
    <service android:name=".Quiet" android:exported="false" />
  </application>
</manifest>`
    const f = manifestFindings(xml, 'm', true)
    expect(one(f, 'cleartext')).toMatchObject({ status: 'warn', line: 6 })
    expect(one(f, 'manifest-debuggable').status).toBe('fail')
    expect(one(f, 'exported')).toMatchObject({ status: 'warn', line: 8, params: { name: '.Boot', tag: 'receiver' } })
    expect(one(f, 'permission')).toMatchObject({ status: 'warn', line: 2, params: { name: 'READ_SMS' } })
    expect(manifestFindings('<manifest><application/></manifest>', 'm', true).every((x) => x.status === 'ok')).toBe(true)
    expect(manifestFindings('<manifest><application/></manifest>', 'm', false)).toEqual([])
  })

  it('tells release AdMob test ids from debug-only ones', () => {
    const dart = `final a = 'ca-app-pub-3940256099942544/6300978111';
// final b = 'ca-app-pub-3940256099942544/1111111111';
String unit() {
  if (kDebugMode) {
    return 'ca-app-pub-3940256099942544/1033173712';
  }
  return prodUnit;
}`
    const f = admobFindings(dart, 'lib/ads.dart', false)
    expect(f.map((x) => [x.status, x.detail, x.line])).toEqual([
      ['fail', 'release', 1],
      ['warn', 'guarded', 5],
    ])
    expect(admobFindings('<string>ca-app-pub-3940256099942544~3347511713</string>', 'v.xml', true)[0]).toMatchObject({ status: 'warn', detail: 'debugPath', params: { kind: 'app' } })
    expect(admobFindings('ca-app-pub-1234/5', 'a.kt', false)).toEqual([])
  })

  it('adds UMP / billing / Firebase warnings only when the project uses them', () => {
    expect(extrasFindings({ ads: null, consent: false, billing: null, acknowledge: false, googleServicesJson: null, gmsPlugin: null })).toEqual([])
    const f = extrasFindings({ ads: { file: 'p', line: 3 }, consent: false, billing: { file: 'p', line: 4, revenueCat: false }, acknowledge: false, googleServicesJson: 'g.json', gmsPlugin: null })
    expect(f.map((x) => [x.rule, x.status, x.detail])).toEqual([
      ['ump', 'warn', 'missing'],
      ['billing-ack', 'warn', 'missing'],
      ['firebase', 'warn', 'noPlugin'],
    ])
    expect(extrasFindings({ ads: null, consent: false, billing: null, acknowledge: false, googleServicesJson: null, gmsPlugin: { file: 'b', line: 2 } })[0]!.detail).toBe('noJson')
  })

  it('parses signer output and compares with the remembered key', () => {
    const hex = 'ab'.repeat(32)
    expect(parseApksigner(`Signer #1 certificate DN: CN=Android Debug, O=Android, C=US\nSigner #1 certificate SHA-256 digest: ${hex}\n`)).toEqual({ sha256: SHA_A, subject: 'CN=Android Debug, O=Android, C=US' })
    expect(parseKeytool(`Signer #1:\n\nCertificate #1:\nOwner: CN=Shop\nCertificate fingerprints:\n\t SHA1: 00\n\t SHA256: ${SHA_B}\n`)).toEqual({ sha256: SHA_B, subject: 'CN=Shop' })
    expect(parseKeytool('Not a signed jar file')).toBeNull()
    expect(certFinding(SHA_A, SHA_A, false, 'x').status).toBe('ok')
    expect(certFinding(SHA_A, SHA_B, false, 'x')).toMatchObject({ status: 'fail', detail: 'mismatch' })
    expect(certFinding(SHA_A, null, true, 'x')).toMatchObject({ status: 'fail', detail: 'debugKey' })
    expect(certFinding(null, null, false, null)).toMatchObject({ status: 'unknown', detail: 'notVerified' })
  })
})

describe('release scan', () => {
  it('finds one failure of each kind in the E2E fixture', async () => {
    const [app] = await scanRelease(FIXTURE, new ReleaseStore(tmp()))
    expect(app).toMatchObject({ kind: 'android', name: ':app', version: { code: 7, name: '1.0.0' } })
    const f = app!.findings
    const st = (rule: string) => by(f, rule).map((x) => x.status)
    expect(st('version-code')).toEqual(['ok'])
    expect(st('minify')).toEqual(['warn'])
    expect(st('debuggable')).toEqual(['fail'])
    expect(one(f, 'signing').detail).toBe('debugKey')
    expect(st('target-sdk')).toEqual(['fail'])
    expect(st('cleartext')).toEqual(['warn'])
    expect(st('manifest-debuggable')).toEqual(['fail'])
    expect(st('exported')).toEqual(['warn'])
    expect(st('permission')).toEqual(['warn', 'warn'])
    expect(by(f, 'admob-test').map((x) => [x.status, x.detail]).sort()).toEqual([
      ['fail', 'release'],
      ['fail', 'release'],
      ['warn', 'debugPath'],
      ['warn', 'guarded'],
    ])
    expect(st('ump')).toEqual(['warn'])
    expect(st('billing-ack')).toEqual(['warn'])
    expect(one(f, 'firebase').detail).toBe('noJson')
    expect(one(f, 'cert').detail).toBe('notVerified')
  })

  it('reads a Flutter app: pubspec version, Flutter defaults, consent found', async () => {
    const root = tmp()
    put(root, 'pubspec.yaml', 'name: shop\nversion: 1.2.0+5\ndependencies:\n  flutter:\n    sdk: flutter\n  google_mobile_ads: ^5.0.0\n')
    put(root, 'android/app/build.gradle.kts', GROOVY.replace('versionName flutterVersionName', 'versionName = flutter.versionName'))
    put(root, 'android/app/google-services.json', '{}')
    put(root, 'lib/consent.dart', 'void c() { ConsentInformation.instance.requestConsentInfoUpdate(); }\n')
    put(root, 'test/ads_test.dart', "const id = 'ca-app-pub-3940256099942544/6300978111';\n")
    const [app] = await scanRelease(root, new ReleaseStore(tmp()))
    expect(app).toMatchObject({ kind: 'flutter', name: 'shop', version: { code: 5, name: '1.2.0' } })
    expect(one(app!.findings, 'version-code')).toMatchObject({ file: path.join(root, 'pubspec.yaml'), line: 2 })
    expect(one(app!.findings, 'ump').status).toBe('ok')
    expect(one(app!.findings, 'firebase').detail).toBe('noPlugin')
    expect(by(app!.findings, 'admob-test')).toEqual([])
  })

  it('picks the newest release artifact', async () => {
    const root = tmp()
    const a = put(root, 'build/outputs/apk/debug/app-debug.apk', 'x')
    const b = put(root, 'build/outputs/bundle/release/app-release.aab', 'x')
    expect(await newestArtifact({ kind: 'android', dir: root })).toBe(b)
    rmSync(b)
    expect(await newestArtifact({ kind: 'android', dir: root })).toBe(a)
  })
})

describe('release store + tools', () => {
  it('keeps the released version and certificate per app', async () => {
    const store = new ReleaseStore(tmp())
    expect(await store.get('/x/app')).toEqual({ released: null, cert: null })
    await store.markReleased('/x/app', { code: 3, name: '1.0' }, 10)
    expect(await store.rememberCert('/x/app', 'nope')).toBe(false)
    await store.rememberCert('/x/app', SHA_A, 11)
    expect(await store.get('/x/app')).toEqual({ released: { code: 3, name: '1.0', at: 10 }, cert: { sha256: SHA_A, at: 11 } })
  })

  it('finds the newest apksigner.jar and runs it through java', async () => {
    const files = new Set(['/jdk/bin/java', '/jdk/bin/keytool', '/sdk/build-tools/35.0.0/lib/apksigner.jar', '/sdk/build-tools/34.0.0/lib/apksigner.jar'])
    const calls: string[][] = []
    const deps = {
      isFile: async (f: string) => files.has(f),
      readText: async () => null,
      mode: async () => null,
      listDirs: async (d: string) => (d === '/sdk/build-tools' ? ['34.0.0', '35.0.0', 'junk'] : []),
      exec: async (file: string, args: string[]) => {
        calls.push([file, ...args])
        if (args[0] === '-version') return { stdout: '', stderr: 'openjdk version "17.0.9"' }
        return { stdout: `Signer #1 certificate SHA-256 digest: ${'ab'.repeat(32)}\n`, stderr: '' }
      },
    }
    const tools = await findSignTools({ jdkSetting: '/jdk', sdkSetting: '/sdk', env: {}, platform: 'linux', home: '/h' }, deps)
    expect(tools).toEqual({ java: '/jdk/bin/java', keytool: '/jdk/bin/keytool', apksignerJar: '/sdk/build-tools/35.0.0/lib/apksigner.jar' })
    expect(await readSigner('/a/app.apk', tools, deps)).toMatchObject({ ok: true, sha256: SHA_A, debugKey: false })
    expect(calls.at(-1)).toEqual(['/jdk/bin/java', '-jar', '/sdk/build-tools/35.0.0/lib/apksigner.jar', 'verify', '--print-certs', '/a/app.apk'])
    expect(await readSigner('/a/app.aab', { ...tools, keytool: null }, deps)).toEqual({ ok: false, error: 'no-jdk' })
  })
})

describe('release IPC', () => {
  function setup(root: string) {
    const handlers = new Map<string, (e: unknown, req: unknown) => Promise<unknown>>()
    const ipcMain = { handle: (c: string, h: (e: unknown, req: unknown) => Promise<unknown>) => handlers.set(c, h), removeHandler: (c: string) => handlers.delete(c) }
    const dispose = registerReleaseIpc({
      ipcMain: ipcMain as never,
      isAppFrame: (e) => e === 'app',
      resolveDir: async (d) => (d === root ? root : null),
      dataDir: tmp(),
      pickArtifact: async () => null,
      findTools: async () => ({ java: '/j/java', keytool: '/j/keytool', apksignerJar: '/s/apksigner.jar' }),
      readSigner: async () => ({ ok: true, sha256: SHA_A, subject: 'CN=Shop', debugKey: false }),
    })
    const call = <T>(ch: string, req: unknown, frame = 'app') => handlers.get(ch)!(frame, req) as Promise<T>
    return { call, dispose, handlers }
  }

  it('gates frames and folders, marks a release, verifies and remembers the key', async () => {
    const root = tmp()
    put(root, 'settings.gradle', "include ':app'\n")
    put(root, 'app/build.gradle', "plugins { id 'com.android.application' }\nandroid { defaultConfig { versionCode 4\n versionName '1.0' } }\n")
    const apk = put(root, 'app/build/outputs/apk/release/app-release.apk', 'x')
    const { call, dispose, handlers } = setup(root)
    expect(await call('ccm:release-check', root, 'guest')).toEqual({ ok: false, error: 'denied' })
    expect(await call('ccm:release-check', 'relative')).toEqual({ ok: false, error: 'invalid' })
    expect(await call('ccm:release-check', path.join(root, '..'))).toEqual({ ok: false, error: 'denied' })
    const first = await call<ReleaseCheckResult>('ccm:release-check', root)
    if (!first.ok) throw new Error('scan failed')
    const app = first.apps[0]!.dir
    expect(await call('ccm:release-mark', { root, app: path.join(root, 'other') })).toEqual({ ok: false, error: 'invalid' })
    const marked = await call<ReleaseCheckResult>('ccm:release-mark', { root, app })
    expect(marked.ok && one(marked.apps[0]!.findings, 'version-code').status).toBe('fail')
    expect(await call('ccm:release-remember', { root, app })).toEqual({ ok: false, error: 'invalid' })
    const v = await call<ReleaseVerifyResult>('ccm:release-verify', { root, app })
    expect(v).toMatchObject({ ok: true, file: realpathSync(apk), artifact: 'apk', sha256: SHA_A, finding: { status: 'unknown', detail: 'notRemembered' } })
    const kept = await call<ReleaseCheckResult>('ccm:release-remember', { root, app })
    expect(kept.ok && kept.apps[0]!.cert?.sha256).toBe(SHA_A)
    expect(kept.ok && one(kept.apps[0]!.findings, 'cert').status).toBe('ok')
    expect(await call('ccm:release-verify', { root, app, pick: true })).toEqual({ ok: false, error: 'cancelled' })
    dispose()
    expect(handlers.size).toBe(0)
  })
})
