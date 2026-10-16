import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { analyzeGradleRoot, parseCatalogLibraries } from '../src/run/android/detect'
import { pomDependencies } from '../src/layout/gradleCache'
import { buildSourceModel, scriptDependencies } from '../src/layout/sourceModel'
import { extractZip } from '../src/layout/zip'
import { makeZip } from './make-zip'

const tmp = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'ccm-source-model-')))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

function write(file: string, text: string | Buffer): void {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text)
}

const CATALOG = `[versions]
sdpAndroid = "1.1.1" # sizes
glide = { strictly = "4.16.0" }

[libraries]
sdp-android = { module = "com.intuit.sdp:sdp-android", version.ref = "sdpAndroid" }
ssp-android = { group = "com.intuit.ssp", name = "ssp-android", version = "1.1.1" }
glide = { module = "com.github.bumptech.glide:glide", version.ref = "glide" }
short = "com.example:short:2.0"
firebase-bom = { module = "com.google.firebase:firebase-bom", version = "33.0.0" }
firebase-analytics = { module = "com.google.firebase:firebase-analytics" }
junit = "junit:junit:4.13.2"

[bundles]
sizes = ["sdp-android", "ssp-android"]

[plugins]
android-application = { id = "com.android.application", version = "8.5.0" }
`

describe('parseCatalogLibraries', () => {
  it('reads module / group+name, version.ref, rich and short notations, bundles', () => {
    const { libraries, bundles } = parseCatalogLibraries(CATALOG)
    expect(libraries.get('sdp.android')).toEqual({ group: 'com.intuit.sdp', name: 'sdp-android', version: '1.1.1' })
    expect(libraries.get('ssp.android')).toEqual({ group: 'com.intuit.ssp', name: 'ssp-android', version: '1.1.1' })
    expect(libraries.get('glide')).toEqual({ group: 'com.github.bumptech.glide', name: 'glide', version: '4.16.0' })
    expect(libraries.get('short')).toEqual({ group: 'com.example', name: 'short', version: '2.0' })
    expect(libraries.get('firebase.analytics')).toEqual({ group: 'com.google.firebase', name: 'firebase-analytics', version: null })
    expect(libraries.has('android.application')).toBe(false)
    expect(bundles.get('sizes')).toEqual(['sdp.android', 'ssp.android'])
  })
})

describe('scriptDependencies', () => {
  it('takes non-test configurations, strings and catalog accessors, skips project / platform / test deps', () => {
    const kts = `
      dependencies {
        implementation(project(":Core"))
        implementation(platform(libs.firebase.bom))
        implementation(libs.sdp.android)
        debugImplementation("com.example:debug-only:1.0@aar")
        api(libs.bundles.sizes)
        // implementation("com.example:commented:1.0")
        testImplementation(libs.junit)
        androidTestImplementation("androidx.test:runner:1.5.0")
        implementation("com.example:dynamic:1.+")
        implementation("../evil:x:1")
      }`
    const deps = scriptDependencies(kts, CATALOG).map((c) => `${c.group}:${c.name}:${c.version ?? '?'}`)
    expect(deps).toEqual(['com.intuit.sdp:sdp-android:1.1.1', 'com.example:debug-only:1.0', 'com.intuit.sdp:sdp-android:1.1.1', 'com.intuit.ssp:ssp-android:1.1.1', 'com.example:dynamic:?'])
    const groovy = "dependencies {\n  implementation 'com.example:groovy:3.0'\n  implementation libs.short\n}"
    expect(scriptDependencies(groovy, CATALOG).map((c) => c.name)).toEqual(['groovy', 'short'])
  })
})

describe('extractZip filter', () => {
  it('extracts only the matching entries', async () => {
    const zip = path.join(tmp, 'f.zip')
    write(zip, makeZip([{ name: 'classes.jar', data: Buffer.alloc(10) }, { name: 'res/values/v.xml', data: Buffer.from('<resources/>') }]))
    const out = path.join(tmp, 'f-out')
    const r = await extractZip(zip, out, { maxTotal: 1e6, filter: (n) => n.startsWith('res/') })
    expect(r.files).toBe(1)
    expect(existsSync(path.join(out, 'classes.jar'))).toBe(false)
    expect(existsSync(path.join(out, 'res', 'values', 'v.xml'))).toBe(true)
  })
})

/** Gradle root like the user's: `:app` (flavors, catalog deps) depends on `:Core`; `:Lonely` is a library nobody uses. */
function project(): { root: string; gradleHome: string; aarCacheDir: string } {
  const root = path.join(tmp, `p${Math.random().toString(36).slice(2, 8)}`)
  write(path.join(root, 'settings.gradle.kts'), 'rootProject.name = "Art"\ninclude(":app", ":Core", ":Lonely")\n')
  write(path.join(root, 'gradle', 'libs.versions.toml'), CATALOG)
  write(
    path.join(root, 'app', 'build.gradle.kts'),
    'plugins { id("com.android.application") }\nandroid {\n  namespace = "com.art.app"\n  defaultConfig { minSdk = 24\n targetSdk = 35 }\n}\ndependencies {\n  implementation(project(":Core"))\n  implementation(libs.sdp.android)\n  implementation(libs.glide)\n  implementation("com.example:missing:1.0")\n  implementation("androidx.appcompat:appcompat:1.7.0")\n}\n',
  )
  write(path.join(root, 'app', 'src', 'main', 'AndroidManifest.xml'), '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n<application android:theme="@style/Theme.Art">\n<activity android:name=".MainActivity" android:theme="@style/Theme.Art.Main"/>\n<activity android:name="com.art.app.Other"/>\n</application>\n</manifest>\n')
  write(path.join(root, 'app', 'src', 'main', 'res', 'values', 'colors.xml'), '<resources><color name="white">#FFFFFF</color></resources>')
  write(path.join(root, 'app', 'src', 'appDev', 'res', 'drawable', 'dev.xml'), '<shape/>')
  write(path.join(root, 'Core', 'build.gradle.kts'), 'plugins { id("com.android.library") }\ndependencies { api(libs.ssp.android) }\n')
  write(path.join(root, 'Core', 'src', 'main', 'res', 'values', 'colors.xml'), '<resources><color name="bottom_nav_selected">#123456</color></resources>')
  write(path.join(root, 'Lonely', 'build.gradle.kts'), 'plugins { id("com.android.library") }\n')
  write(path.join(root, 'Lonely', 'src', 'main', 'res', 'drawable', 'x.xml'), '<shape/>')

  const gradleHome = path.join(root, '.gradle-home')
  const files = path.join(gradleHome, 'caches', 'modules-2', 'files-2.1')
  const aar = (group: string, name: string, version: string, entries: { name: string; data: Buffer }[]) =>
    write(path.join(files, group, name, version, 'abc123', `${name}-${version}.aar`), makeZip([{ name: 'classes.jar', data: Buffer.alloc(4) }, ...entries]))
  aar('com.intuit.sdp', 'sdp-android', '1.1.1', [{ name: 'res/values/dimens.xml', data: Buffer.from('<resources><dimen name="_60sdp">60dp</dimen></resources>') }, { name: 'R.txt', data: Buffer.from('int dimen _60sdp 0x7f010001') }])
  aar('com.intuit.ssp', 'ssp-android', '1.1.1', [{ name: 'res/values/dimens.xml', data: Buffer.from('<resources><dimen name="_12ssp">12sp</dimen></resources>') }])
  aar('androidx.appcompat', 'appcompat', '1.7.0', [{ name: 'res/values/values.xml', data: Buffer.from('<resources/>') }])
  // A plain jar library: skipped without a warning.
  write(path.join(files, 'com.github.bumptech.glide', 'glide', '4.16.0', 'def456', 'glide-4.16.0.jar'), 'jar')
  return { root, gradleHome, aarCacheDir: path.join(root, '.aars') }
}

const kit = {
  resDirs: [],
  aarResDirs: [{ dir: '/kit/aars/appcompat-1.6.1/res', name: 'appcompat-1.6.1' }],
  classpath: ['/kit/classes.jar'],
  rJar: '/kit/R.jar',
  packageName: 'dev.ccm.loosekit',
  namespace: 'dev.ccm.loosekit',
  appTheme: '@style/Theme.Material3.DayNight.NoActionBar',
  activityThemes: {},
}

describe('buildSourceModel', () => {
  const opts = (p: { gradleHome: string; aarCacheDir: string }, k: typeof kit | null = kit) => ({ platform: process.platform, gradleHome: p.gradleHome, aarCacheDir: p.aarCacheDir, kit: k })

  it('reads res folders of the app and its modules, AAR res + classes from the Gradle cache, manifest themes, the kit classes', async () => {
    const p = project()
    const proj = (await analyzeGradleRoot(p.root))!
    const file = path.join(p.root, 'app', 'src', 'appDev', 'res', 'drawable', 'dev.xml')
    const m = (await buildSourceModel(proj, ':app', file, opts(p)))!
    const res = (mod: string, ss = 'main') => path.join(p.root, mod, 'src', ss, 'res')
    expect(m.payload.resDirs).toEqual([res('Core'), res('app'), res('app', 'appDev')])
    const sdp = path.join(p.aarCacheDir, 'com.intuit.sdp', 'sdp-android-1.1.1')
    const ssp = path.join(p.aarCacheDir, 'com.intuit.ssp', 'ssp-android-1.1.1')
    // appcompat comes from the kit (its res matches the kit's R.jar), not the cache.
    expect(m.payload.aarResDirs).toEqual([kit.aarResDirs[0], { dir: path.join(sdp, 'res'), name: 'com.intuit.sdp:sdp-android:1.1.1' }, { dir: path.join(ssp, 'res'), name: 'com.intuit.ssp:ssp-android:1.1.1' }])
    expect(readFileSync(path.join(sdp, 'res', 'values', 'dimens.xml'), 'utf8')).toContain('_60sdp')
    expect(existsSync(path.join(sdp, 'R.txt'))).toBe(true)
    const glideJar = path.join(p.gradleHome, 'caches', 'modules-2', 'files-2.1', 'com.github.bumptech.glide', 'glide', '4.16.0', 'def456', 'glide-4.16.0.jar')
    expect(m.payload.classpath).toEqual([path.join(sdp, 'classes.jar'), glideJar, path.join(ssp, 'classes.jar'), ...kit.classpath])
    expect(m.prebuiltAt).toBeUndefined()
    expect(m.payload).toMatchObject({ rJar: kit.rJar, packageName: 'com.art.app', namespace: 'com.art.app', appTheme: '@style/Theme.Art', minSdk: 24, targetSdk: 35 })
    expect(m.payload.activityThemes).toEqual({ 'com.art.app.MainActivity': '@style/Theme.Art.Main' })
    expect(m.themes).toEqual(['@style/Theme.Art', '@style/Theme.Art.Main'])
    expect(m.warnings.join('\n')).toContain('com.example:missing')
    expect(m.warnings.join('\n')).not.toContain('glide')

    // Second build reuses the extracted AAR.
    writeFileSync(path.join(sdp, 'res', 'values', 'dimens.xml'), 'kept')
    await buildSourceModel(proj, ':app', file, opts(p))
    expect(readFileSync(path.join(sdp, 'res', 'values', 'dimens.xml'), 'utf8')).toBe('kept')
  })

  it('uses classes + R.jar of an earlier build, with libraries resolved transitively', async () => {
    const p = project()
    const files = path.join(p.gradleHome, 'caches', 'modules-2', 'files-2.1')
    // ucrop (POM: runtime dep okhttp; optional + test deps skipped) → okhttp (.module: java-runtime variant → okio).
    write(
      path.join(files, 'com.yalantis', 'ucrop', '2.2.11', 'p1', 'ucrop-2.2.11.pom'),
      `<project><properties><ok.version>4.12.0</ok.version></properties><dependencies>
      <dependency><groupId>com.squareup.okhttp3</groupId><artifactId>okhttp</artifactId><version>$` + `{ok.version}</version><scope>runtime</scope></dependency>
      <dependency><groupId>com.example</groupId><artifactId>opt</artifactId><version>1</version><optional>true</optional></dependency>
      <dependency><groupId>junit</groupId><artifactId>junit</artifactId><version>4</version><scope>test</scope></dependency>
    </dependencies></project>`,
    )
    write(path.join(files, 'com.yalantis', 'ucrop', '2.2.11', 'a1', 'ucrop-2.2.11.aar'), makeZip([{ name: 'classes.jar', data: Buffer.alloc(4) }, { name: 'res/values/v.xml', data: Buffer.from('<resources/>') }]))
    write(
      path.join(files, 'com.squareup.okhttp3', 'okhttp', '4.12.0', 'm1', 'okhttp-4.12.0.module'),
      JSON.stringify({
        variants: [
          { name: 'apiElements', attributes: { 'org.gradle.usage': 'java-api' }, dependencies: [{ group: 'x', module: 'api-only', version: { requires: '1' } }] },
          { name: 'runtimeElements', attributes: { 'org.gradle.usage': 'java-runtime', 'org.gradle.category': 'library' }, dependencies: [{ group: 'com.squareup.okio', module: 'okio', version: { requires: '3.6.0' } }], files: [{ name: 'okhttp-4.12.0.jar' }] },
        ],
      }),
    )
    write(path.join(files, 'com.squareup.okhttp3', 'okhttp', '4.12.0', 'j1', 'okhttp-4.12.0.jar'), 'jar')
    // okio 3.6.0 was never downloaded: a conflict resolved it to 3.9.0.
    write(path.join(files, 'com.squareup.okio', 'okio', '3.9.0', 'j2', 'okio-3.9.0.jar'), 'jar')
    // rv 1.4.0 is cached without metadata (Gradle kept it in its binary descriptors): rv 1.3.1's POM stands in.
    write(path.join(files, 'com.example', 'rv', '1.4.0', 'a2', 'rv-1.4.0.aar'), makeZip([{ name: 'classes.jar', data: Buffer.alloc(4) }]))
    write(path.join(files, 'com.example', 'rv', '1.3.1', 'p2', 'rv-1.3.1.pom'), '<project><dependencies><dependency><groupId>com.example</groupId><artifactId>pool</artifactId><version>1.0.0</version></dependency></dependencies></project>')
    write(path.join(files, 'com.example', 'pool', '1.0.0', 'a3', 'pool-1.0.0.aar'), makeZip([{ name: 'classes.jar', data: Buffer.alloc(4) }]))
    const app = readFileSync(path.join(p.root, 'app', 'build.gradle.kts'), 'utf8').replace('implementation(libs.glide)', 'implementation(libs.glide)\n  implementation("com.yalantis:ucrop:2.2.11")\n  implementation("com.example:rv:1.4.0")')
    writeFileSync(path.join(p.root, 'app', 'build.gradle.kts'), app)
    const rBase = path.join(p.root, 'app', 'build', 'intermediates', 'compile_and_runtime_not_namespaced_r_class_jar')
    const rJar = path.join(rBase, 'appDevDebug', 'processAppDevDebugResources', 'R.jar')
    write(rJar, 'R')
    write(path.join(rBase, 'appProdRelease', 'R.jar'), 'R')
    const appKotlin = path.join(p.root, 'app', 'build', 'tmp', 'kotlin-classes', 'appDevDebug')
    write(path.join(appKotlin, 'A.class'), '')
    const appJavac = path.join(p.root, 'app', 'build', 'intermediates', 'javac', 'appDevDebug', 'compileAppDevDebugJavaWithJavac', 'classes')
    write(path.join(appJavac, 'B.class'), '')
    // The library module has no flavors: its debug output is used.
    const coreKotlin = path.join(p.root, 'Core', 'build', 'tmp', 'kotlin-classes', 'debug')
    write(path.join(coreKotlin, 'C.class'), '')
    write(path.join(p.root, 'Core', 'build', 'tmp', 'kotlin-classes', 'release', 'C.class'), '')

    const proj = (await analyzeGradleRoot(p.root))!
    const colors = path.join(p.root, 'app', 'src', 'main', 'res', 'values', 'colors.xml')
    const m = (await buildSourceModel(proj, ':app', colors, opts(p)))!
    expect(m.prebuiltAt).toBeGreaterThan(0)
    expect(m.payload.rJar).toBe(rJar)
    const cp = m.payload.classpath
    expect(cp.slice(0, 3)).toEqual([appKotlin, appJavac, coreKotlin])
    expect(cp.at(-1)).toBe(kit.classpath[0])
    const names = m.payload.aarResDirs.map((a) => a.name)
    // With the project's R.jar the project's appcompat wins over the kit's.
    expect(names).toContain('androidx.appcompat:appcompat:1.7.0')
    expect(names).not.toContain('appcompat-1.6.1')
    expect(names).toContain('com.yalantis:ucrop:2.2.11')
    expect(cp).toContain(path.join(files, 'com.squareup.okhttp3', 'okhttp', '4.12.0', 'j1', 'okhttp-4.12.0.jar'))
    expect(cp).toContain(path.join(files, 'com.squareup.okio', 'okio', '3.9.0', 'j2', 'okio-3.9.0.jar'))
    expect(cp.some((c) => /opt|junit|api-only/.test(c))).toBe(false)
    expect(cp).toContain(path.join(p.aarCacheDir, 'com.example', 'rv-1.4.0', 'classes.jar'))
    expect(cp).toContain(path.join(p.aarCacheDir, 'com.example', 'pool-1.0.0', 'classes.jar'))

    expect((await buildSourceModel(proj, ':app', colors, { ...opts(p), prebuilt: false }))!.prebuiltAt).toBeUndefined()
  })

  it('adds an unlinked library of the file and its sampledata, works without the kit, null without any res folder', async () => {
    const p = project()
    write(path.join(p.root, 'Lonely', 'sampledata', 'names'), 'A\nB\n')
    const proj = (await analyzeGradleRoot(p.root))!
    const file = path.join(p.root, 'Lonely', 'src', 'main', 'res', 'drawable', 'x.xml')
    const m = (await buildSourceModel(proj, ':app', file, opts(p, null)))!
    expect(m.payload.resDirs[0]).toBe(path.join(p.root, 'Lonely', 'src', 'main', 'res'))
    expect(m.payload.resDirs.at(-1)).toBe(path.join(p.root, 'app', 'src', 'main', 'res'))
    expect(m.payload.classpath.every((c) => c.startsWith(p.aarCacheDir) || c.startsWith(p.gradleHome))).toBe(true)
    expect(m.payload.rJar).toBeUndefined()
    expect(m.payload.sampleDataDirs).toEqual([path.join(p.root, 'Lonely', 'sampledata')])
    expect(m.payload.aarResDirs.map((a) => a.name)).toContain('androidx.appcompat:appcompat:1.7.0')

    for (const mod of ['app', 'Core', 'Lonely']) rmSync(path.join(p.root, mod, 'src'), { recursive: true, force: true })
    expect(await buildSourceModel(proj, ':app', file, opts(p))).toBeNull()
  })
})

describe('pomDependencies', () => {
  it('skips dependencyManagement, test / provided scopes, pom types and unresolved properties', () => {
    const v = (k: string) => '$' + `{${k}}`
    const pom = `<project><dependencyManagement><dependencies><dependency><groupId>m</groupId><artifactId>managed</artifactId><version>1</version></dependency></dependencies></dependencyManagement>
      <dependencies>
        <dependency><groupId>a</groupId><artifactId>b</artifactId><version>${v('project.version')}</version></dependency>
        <dependency><groupId>a</groupId><artifactId>c</artifactId><version>${v('unknown')}</version></dependency>
        <dependency><groupId>a</groupId><artifactId>p</artifactId><version>1</version><scope>provided</scope></dependency>
        <dependency><groupId>a</groupId><artifactId>bom</artifactId><version>1</version><type>pom</type></dependency>
      </dependencies></project>`
    expect(pomDependencies(pom, '2.0')).toEqual([
      { group: 'a', name: 'b', version: '2.0' },
      { group: 'a', name: 'c', version: null },
    ])
  })
})
