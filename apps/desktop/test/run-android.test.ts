import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  androidFramework,
  detectAndroid,
  hasLauncher,
  parseCatalogPlugins,
  parseIncludes,
  parseProjectDirs,
  pluginIds,
} from '../src/run/android/detect'
import { androidEnv, gradlewSpawn, parseJavaVersion, quoteCmdArg, readProperty, type EnvDeps } from '../src/run/android/env'

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ccm-android-')))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

let n = 0
function fixture(files: Record<string, string>): string {
  const dir = path.join(tmp, `p${n++}`)
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(dir, rel)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, text)
  }
  mkdirSync(dir, { recursive: true })
  return dir
}

const LAUNCHER_MANIFEST = `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application>
    <activity android:name=".Settings" android:exported="false" />
    <activity
        android:name=".MainActivity"
        android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
  </application>
</manifest>`
const PLAIN_MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application /></manifest>`

describe('settings parsing', () => {
  it('reads Groovy and KTS includes, several per statement and multi-line', () => {
    expect(parseIncludes(`include ':app', ':core:data'\ninclude ':lib1',\n  ':lib2'\n// include ':ghost'`)).toEqual([':app', ':core:data', ':lib1', ':lib2'])
    expect(parseIncludes(`include(\n  ":app",\n  ":feature:login",\n)\ninclude(":a", ":b")\nincludeBuild("build-logic")`)).toEqual([
      ':app',
      ':feature:login',
      ':a',
      ':b',
    ])
    expect(parseIncludes(`include 'app'`)).toEqual([':app'])
  })

  it('reads simple projectDir overrides', () => {
    const dirs = parseProjectDirs(`project(':lib').projectDir = new File(settingsDir, 'libs/lib')\nproject(":x").projectDir = file("modules/x")`)
    expect(dirs.get(':lib')).toBe('libs/lib')
    expect(dirs.get(':x')).toBe('modules/x')
  })
})

describe('build script parsing', () => {
  const catalogs = new Map([['libs', parseCatalogPlugins(`[versions]\nagp = "8.5.0"\n[plugins]\nandroid-application = { id = "com.android.application", version.ref = "agp" }\nandroid_library = "com.android.library:8.5.0"\nkotlin-multiplatform = { id = "org.jetbrains.kotlin.multiplatform", version = "2.0.0" }`)]])

  it('resolves ids, legacy apply, catalog aliases and skips apply false', () => {
    expect(pluginIds(`plugins {\n  id 'com.android.application'\n  id 'org.jetbrains.kotlin.android'\n}`, catalogs)).toEqual(['com.android.application', 'org.jetbrains.kotlin.android'])
    expect(pluginIds(`apply plugin: 'com.android.library'`, catalogs)).toEqual(['com.android.library'])
    expect(pluginIds(`plugins { alias(libs.plugins.android.application) }`, catalogs)).toEqual(['com.android.application'])
    expect(pluginIds(`plugins { alias(libs.plugins.android.library) }`, catalogs)).toEqual(['com.android.library'])
    expect(pluginIds(`plugins {\n  id("com.android.application") version "8.5.0" apply false\n  alias(libs.plugins.android.library) apply false\n}`, catalogs)).toEqual([])
    expect(pluginIds(`plugins { kotlin("multiplatform") }`, catalogs)).toEqual(['org.jetbrains.kotlin.multiplatform'])
  })

  it('finds MAIN + LAUNCHER activities only', () => {
    expect(hasLauncher(LAUNCHER_MANIFEST)).toBe(true)
    expect(hasLauncher(PLAIN_MANIFEST)).toBe(false)
    expect(hasLauncher(`<application><activity-alias android:name=".A"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LEANBACK_LAUNCHER"/></intent-filter></activity-alias></application>`)).toBe(true)
    expect(hasLauncher(`<application><!-- <activity android:name=".A"><intent-filter><action android:name="android.intent.action.MAIN"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity> --></application>`)).toBe(false)
    expect(hasLauncher(`<activity android:name=".A"><intent-filter><action android:name="android.intent.action.VIEW"/><category android:name="android.intent.category.LAUNCHER"/></intent-filter></activity>`)).toBe(false)
  })
})

describe('detectAndroid', () => {
  it('native Groovy app', async () => {
    const root = fixture({
      'settings.gradle': `rootProject.name = 'Hello'\ninclude ':app'`,
      'build.gradle': `plugins { id 'com.android.application' version '8.5.0' apply false }`,
      'app/build.gradle': `plugins { id 'com.android.application' }`,
      'app/src/main/AndroidManifest.xml': LAUNCHER_MANIFEST,
    })
    const [p] = await detectAndroid(root)
    expect(p).toMatchObject({ kind: 'android', dir: root, name: 'Hello', framework: 'native', status: 'runnable' })
    expect(p!.modules).toEqual([
      { path: ':app', dir: path.join(root, 'app'), type: 'application', manifest: path.join(root, 'app', 'src', 'main', 'AndroidManifest.xml'), launcher: true, guessed: false },
    ])
  })

  it('native KTS with version catalog alias', async () => {
    const root = fixture({
      'settings.gradle.kts': `include(":app")`,
      'gradle/libs.versions.toml': `[plugins]\nandroid-application = { id = "com.android.application", version = "8.5.0" }`,
      'app/build.gradle.kts': `plugins {\n    alias(libs.plugins.android.application)\n}`,
      'app/src/main/AndroidManifest.xml': LAUNCHER_MANIFEST,
    })
    const [p] = await detectAndroid(root)
    expect(p).toMatchObject({ name: path.basename(root), status: 'runnable' })
    expect(p!.modules[0]!.type).toBe('application')
  })

  it('multi-module app + library with a custom projectDir', async () => {
    const root = fixture({
      'settings.gradle': `include ':app', ':core:ui', ':lib'\nproject(':lib').projectDir = file('libs/mylib')`,
      'app/build.gradle': `apply plugin: 'com.android.application'`,
      'app/src/main/AndroidManifest.xml': LAUNCHER_MANIFEST,
      'core/ui/build.gradle': `plugins { id 'com.android.library' }`,
      'core/ui/src/main/AndroidManifest.xml': PLAIN_MANIFEST,
      'libs/mylib/build.gradle': `plugins { id 'java-library' }`,
    })
    const [p] = await detectAndroid(root)
    expect(p!.status).toBe('runnable')
    expect(p!.modules.map((m) => [m.path, m.type, m.dir])).toEqual([
      [':app', 'application', path.join(root, 'app')],
      [':core:ui', 'library', path.join(root, 'core', 'ui')],
      [':lib', 'unknown', path.join(root, 'libs', 'mylib')],
    ])
  })

  it('KMP with androidMain manifest', async () => {
    const root = fixture({
      'settings.gradle.kts': `rootProject.name = "Kmp"\ninclude(":composeApp")`,
      'composeApp/build.gradle.kts': `plugins {\n  kotlin("multiplatform")\n  id("com.android.application")\n}`,
      'composeApp/src/androidMain/AndroidManifest.xml': LAUNCHER_MANIFEST,
    })
    const [p] = await detectAndroid(root)
    expect(p).toMatchObject({ name: 'Kmp', framework: 'kmp', status: 'runnable' })
    expect(p!.modules[0]!.manifest).toBe(path.join(root, 'composeApp', 'src', 'androidMain', 'AndroidManifest.xml'))
  })

  it('React Native android/', async () => {
    const root = fixture({
      'package.json': JSON.stringify({ name: 'rn', dependencies: { react: '18', 'react-native': '0.76.0' } }),
      'android/settings.gradle': `rootProject.name = 'RnApp'\ninclude ':app'`,
      'android/app/build.gradle': `apply plugin: "com.android.application"`,
      'android/app/src/main/AndroidManifest.xml': LAUNCHER_MANIFEST,
    })
    const res = await detectAndroid(root)
    expect(res).toHaveLength(1)
    expect(res[0]).toMatchObject({ dir: path.join(root, 'android'), name: 'RnApp', framework: 'react-native', status: 'runnable' })
  })

  it('Capacitor android/', async () => {
    const root = fixture({
      'capacitor.config.ts': `export default {}`,
      'android/settings.gradle': `include ':app'`,
      'android/app/build.gradle': `apply plugin: 'com.android.application'`,
    })
    const [p] = await detectAndroid(root)
    expect(p).toMatchObject({ framework: 'capacitor', name: path.basename(root) })
  })

  it("skips a Flutter project's android/ (the Flutter detector owns it)", async () => {
    const root = fixture({
      'pubspec.yaml': `name: demo\ndependencies:\n  flutter:\n    sdk: flutter\n`,
      'android/settings.gradle.kts': `include(":app")`,
      'android/app/build.gradle.kts': `plugins { id("com.android.application") }`,
      'android/app/src/main/AndroidManifest.xml': LAUNCHER_MANIFEST,
    })
    expect(await detectAndroid(root)).toEqual([])
    expect(await androidFramework(path.join(root, 'android'), false)).toBe('flutter')
  })

  it('library only → no-app', async () => {
    const root = fixture({
      'settings.gradle.kts': `include(":lib")`,
      'lib/build.gradle.kts': `plugins { id("com.android.library") }`,
      'lib/src/main/AndroidManifest.xml': PLAIN_MANIFEST,
    })
    expect((await detectAndroid(root))[0]!.status).toBe('no-app')
  })

  it('pure Java / Kotlin Gradle and TS projects are not Android', async () => {
    const java = fixture({
      'settings.gradle.kts': `include(":core")`,
      'build.gradle.kts': `plugins { kotlin("jvm") version "2.0.0" }`,
      'core/build.gradle.kts': `plugins { id("java-library") }`,
    })
    expect(await detectAndroid(java)).toEqual([])
    const ts = fixture({ 'package.json': '{"name":"x"}', 'src/index.ts': 'export {}', 'tsconfig.json': '{}' })
    expect(await detectAndroid(ts)).toEqual([])
  })

  it('convention plugin: LAUNCHER manifest → guessed runnable, none → unknown', async () => {
    const files = {
      'settings.gradle.kts': `pluginManagement { includeBuild("build-logic") }\ninclude(":app")`,
      'build-logic/settings.gradle.kts': `rootProject.name = "build-logic"\ninclude(":convention")`,
      'build-logic/convention/build.gradle.kts': `plugins { \`kotlin-dsl\` }`,
      'app/build.gradle.kts': `plugins { id("nowinandroid.android.application") }`,
    }
    const guessed = fixture({ ...files, 'app/src/main/AndroidManifest.xml': LAUNCHER_MANIFEST })
    const res = await detectAndroid(guessed)
    expect(res).toHaveLength(1)
    expect(res[0]!.status).toBe('runnable')
    expect(res[0]!.modules[0]).toMatchObject({ type: 'unknown', launcher: true, guessed: true })

    const unknown = fixture({ ...files, 'app/src/main/AndroidManifest.xml': PLAIN_MANIFEST })
    const [u] = await detectAndroid(unknown)
    expect(u!.status).toBe('unknown')
    expect(u!.modules[0]).toMatchObject({ type: 'unknown', launcher: false, guessed: false })
  })

  it('scans 1–2 levels down, skipping node_modules / build / hidden folders', async () => {
    const app = { 'settings.gradle': `include ':app'`, 'app/build.gradle': `apply plugin: 'com.android.application'` }
    const prefix = (p: string, files: Record<string, string>): Record<string, string> =>
      Object.fromEntries(Object.entries(files).map(([k, v]) => [`${p}/${k}`, v]))
    const root = fixture({
      ...prefix('apps/native', app),
      ...prefix('apps/rn/android', app),
      ...prefix('node_modules/pkg', app),
      ...prefix('build/out', app),
      ...prefix('.hidden', app),
      ...prefix('a/b/c', app),
    })
    const dirs = (await detectAndroid(root)).map((p) => path.relative(root, p.dir).replace(/\\/g, '/'))
    expect(dirs).toEqual(['apps/native', 'apps/rn/android'])
  })
})

describe('env helpers', () => {
  it('unescapes local.properties values', () => {
    expect(readProperty(`## generated\nsdk.dir=C\\:\\\\Users\\\\me\\\\AppData\\\\Local\\\\Android\\\\Sdk\n`, 'sdk.dir')).toBe('C:\\Users\\me\\AppData\\Local\\Android\\Sdk')
    expect(readProperty(`sdk.dir = /Users/me/Library/Android/sdk`, 'sdk.dir')).toBe('/Users/me/Library/Android/sdk')
    expect(readProperty(`ndk.dir=/x`, 'sdk.dir')).toBeNull()
  })

  it('parses java -version majors', () => {
    expect(parseJavaVersion(`java version "1.8.0_381"\nJava(TM) SE Runtime Environment`)).toBe(8)
    expect(parseJavaVersion(`openjdk version "11.0.21" 2023-10-17`)).toBe(11)
    expect(parseJavaVersion(`openjdk version "17.0.9" 2023-10-17\nOpenJDK Runtime Environment`)).toBe(17)
    expect(parseJavaVersion(`openjdk version "21" 2023-09-19`)).toBe(21)
    expect(parseJavaVersion(`garbage`)).toBeNull()
  })
})

function fakeDeps(files: Record<string, string>, opts: { modes?: Record<string, number>; java?: Record<string, string> } = {}): EnvDeps & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    isFile: async (f) => f in files,
    readText: async (f) => files[f] ?? null,
    mode: async (f) => (f in files ? (opts.modes?.[f] ?? 0o755) : null),
    exec: async (file, args) => {
      calls.push([file, ...args].join(' '))
      const v = opts.java?.[file]
      return v === undefined ? null : { stdout: '', stderr: `openjdk version "${v}" 2024-01-16` }
    },
  }
}

describe('androidEnv', () => {
  const mac = { platform: 'darwin' as const, home: '/Users/me' }
  const root = '/work/app'

  it('setting wins over ANDROID_HOME; JAVA_HOME over JBR', async () => {
    const deps = fakeDeps(
      {
        '/opt/sdk/platform-tools/adb': '',
        '/opt/sdk/emulator/emulator': '',
        '/env/sdk/platform-tools/adb': '',
        '/jdk17/bin/java': '',
        '/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/java': '',
        '/work/app/gradlew': '',
      },
      { java: { '/jdk17/bin/java': '17.0.9' } },
    )
    const env = await androidEnv(root, { ...mac, sdkSetting: '/opt/sdk', env: { ANDROID_HOME: '/env/sdk', JAVA_HOME: '/jdk17' } }, deps)
    expect(env).toEqual({
      kind: 'android',
      sdk: '/opt/sdk',
      adb: '/opt/sdk/platform-tools/adb',
      emulator: '/opt/sdk/emulator/emulator',
      jdk: '/jdk17',
      jdkVersion: 17,
      gradlew: true,
      issues: [],
    })
    expect(deps.calls).toEqual(['/jdk17/bin/java -version'])
  })

  it('passive check never runs a java that lives inside the project / repo', async () => {
    const files = { '/opt/sdk/platform-tools/adb': '', '/work/app/tools/jdk/bin/java': '', '/work/app/gradlew': '' }
    const deps = fakeDeps(files, { java: { '/work/app/tools/jdk/bin/java': '17.0.9' } })
    const env = await androidEnv(root, { ...mac, env: { ANDROID_HOME: '/opt/sdk', JAVA_HOME: '/work/app/tools/jdk' } }, deps)
    expect(env).toMatchObject({ jdk: '/work/app/tools/jdk', jdkVersion: null, issues: [{ code: 'jdk-local-unverified', detail: '/work/app/tools/jdk' }] })
    expect(deps.calls).toEqual([])
    const linked = fakeDeps({ ...files, '/jdk/bin/java': '' }, { java: { '/jdk/bin/java': '17.0.9' } })
    const viaLink = await androidEnv(root, { ...mac, env: { ANDROID_HOME: '/opt/sdk', JAVA_HOME: '/jdk' }, repoRoot: '/work' }, { ...linked, realpath: async (f) => (f === '/jdk/bin/java' ? '/work/vendor/java' : f) })
    expect(viaLink.jdkVersion).toBeNull()
    expect(linked.calls).toEqual([])
    const trusted = await androidEnv(root, { ...mac, env: { ANDROID_HOME: '/opt/sdk', JAVA_HOME: '/work/app/tools/jdk' }, trusted: true }, deps)
    expect(trusted.jdkVersion).toBe(17)
  })

  it('falls through invalid entries: ANDROID_SDK_ROOT, then local.properties, then default', async () => {
    const jbr = '/Applications/Android Studio.app/Contents/jbr/Contents/Home'
    const base = { [`${jbr}/bin/java`]: '', '/work/app/gradlew': '' }
    const withRoot = await androidEnv(root, { ...mac, env: { ANDROID_HOME: '/nope', ANDROID_SDK_ROOT: '/r/sdk' } }, fakeDeps({ ...base, '/r/sdk/platform-tools/adb': '' }, { java: { [`${jbr}/bin/java`]: '21.0.3' } }))
    expect(withRoot).toMatchObject({ sdk: '/r/sdk', jdk: jbr, jdkVersion: 21, emulator: null })

    const props = await androidEnv(root, { ...mac, env: {} }, fakeDeps({ ...base, '/work/app/local.properties': 'sdk.dir=/p/sdk', '/p/sdk/platform-tools/adb': '' }))
    expect(props.sdk).toBe('/p/sdk')

    const def = await androidEnv(root, { ...mac, env: {} }, fakeDeps({ ...base, '/Users/me/Library/Android/sdk/platform-tools/adb': '' }))
    expect(def.sdk).toBe('/Users/me/Library/Android/sdk')
  })

  it('Windows: local.properties escapes, .exe names, LOCALAPPDATA default, gradlew.bat', async () => {
    const files = {
      'C:\\proj\\local.properties': 'sdk.dir=D\\:\\\\Android\\\\Sdk',
      'D:\\Android\\Sdk\\platform-tools\\adb.exe': '',
      'D:\\Android\\Sdk\\emulator\\emulator.exe': '',
      'C:\\Program Files\\Android\\Android Studio\\jbr\\bin\\java.exe': '',
      'C:\\proj\\gradlew.bat': '',
    }
    const env = await androidEnv('C:\\proj', { platform: 'win32', home: 'C:\\Users\\me', env: {} }, fakeDeps(files, { java: { 'C:\\Program Files\\Android\\Android Studio\\jbr\\bin\\java.exe': '17.0.11' } }))
    expect(env).toMatchObject({
      sdk: 'D:\\Android\\Sdk',
      adb: 'D:\\Android\\Sdk\\platform-tools\\adb.exe',
      emulator: 'D:\\Android\\Sdk\\emulator\\emulator.exe',
      jdk: 'C:\\Program Files\\Android\\Android Studio\\jbr',
      jdkVersion: 17,
      gradlew: true,
      issues: [],
    })
    const def = await androidEnv('C:\\proj', { platform: 'win32', home: 'C:\\Users\\me', env: { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' } }, fakeDeps({ 'C:\\Users\\me\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe': '' }))
    expect(def.sdk).toBe('C:\\Users\\me\\AppData\\Local\\Android\\Sdk')
  })

  it('reports missing SDK / old JDK / missing gradlew; adb and java from PATH', async () => {
    const deps = fakeDeps({ '/usr/local/bin/adb': '', '/usr/lib/jvm/bin/java': '' }, { java: { '/usr/lib/jvm/bin/java': '1.8.0_381' } })
    const env = await androidEnv(root, { ...mac, env: { PATH: 'relative/bin:/usr/local/bin:/usr/lib/jvm/bin' } }, deps)
    expect(env).toMatchObject({ sdk: null, adb: '/usr/local/bin/adb', emulator: null, jdk: '/usr/lib/jvm', jdkVersion: 8, gradlew: false })
    expect(env.issues).toEqual([{ code: 'sdk-missing' }, { code: 'jdk-old', detail: '8' }, { code: 'gradlew-missing' }])
  })

  it('reports missing JDK and a non-executable gradlew on macOS', async () => {
    const env = await androidEnv(root, { ...mac, env: {} }, fakeDeps({ '/work/app/gradlew': '' }, { modes: { '/work/app/gradlew': 0o644 } }))
    expect(env.issues.map((i) => i.code)).toEqual(['sdk-missing', 'jdk-missing', 'gradlew-not-executable'])
    expect(env.jdk).toBeNull()
  })
})

describe('gradlewSpawn', () => {
  it('POSIX runs the wrapper directly', () => {
    expect(gradlewSpawn('/work/my app', [':app:assembleDebug', '--console=plain'], 'darwin')).toEqual({
      file: '/work/my app/gradlew',
      args: [':app:assembleDebug', '--console=plain'],
      verbatim: false,
    })
  })

  it('Windows goes through cmd.exe with caret-escaped quoting', () => {
    const s = gradlewSpawn('C:\\My Apps\\demo', [':app:assembleDebug', '-Pname=a b&c'], 'win32', { SystemRoot: 'C:\\Windows' })
    expect(s.file).toBe('C:\\Windows\\System32\\cmd.exe')
    expect(s.verbatim).toBe(true)
    expect(s.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    expect(s.args[3]).toBe(`"C:\\My^ Apps\\demo\\gradlew.bat ^^^":app:assembleDebug^^^" ^^^"-Pname=a^^^ b^^^&c^^^""`)
    expect(quoteCmdArg('plain')).toBe('^^^"plain^^^"')
  })
})
