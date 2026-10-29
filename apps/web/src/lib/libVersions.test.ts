import { describe, expect, it } from 'vitest'
import type { TreeRow } from './explorer/tree'
import { explorerMenu } from './explorer/contextMenu'
import { depFileKind, libPage, libRows, parseGradleDeps, parsePackageJson, parsePubspec, parseVersionsToml, queriesOf, rangeBase, upgradePrompt } from './libVersions'

const TOML = `[versions]
agp = "8.5.0"
kotlin = "2.0.0" # comment
coreKtx = { strictly = "1.13.1" }
compose-bom = "2024.06.00"

[libraries]
androidx-core-ktx = { group = "androidx.core", name = "core-ktx", version.ref = "coreKtx" }
compose-bom = { module = "androidx.compose:compose-bom", version.ref = "compose-bom" }
compose-ui = { group = "androidx.compose.ui", name = "ui" }
okhttp = "com.squareup.okhttp3:okhttp:4.12.0"
retrofit = { module = "com.squareup.retrofit2:retrofit", version = "2.11.0" }
gson = { module = "com.google.code.gson:gson", version = { ref = "kotlin" } }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
kotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }
ksp = "com.google.devtools.ksp:2.0.0-1.0.22"
`

describe('dependency file parsers', () => {
  it('reads version catalogs: refs, rich versions, plugins; skips BOM-managed entries', () => {
    const deps = parseVersionsToml(TOML)
    expect(deps.map((d) => [d.name, d.current, d.ref ?? null, d.line])).toEqual([
      ['androidx.core:core-ktx', '1.13.1', 'coreKtx', 8],
      ['androidx.compose:compose-bom', '2024.06.00', 'compose-bom', 9],
      ['com.squareup.okhttp3:okhttp', '4.12.0', null, 11],
      ['com.squareup.retrofit2:retrofit', '2.11.0', null, 12],
      ['com.google.code.gson:gson', '2.0.0', 'kotlin', 13],
      ['com.android.application:com.android.application.gradle.plugin', '8.5.0', 'agp', 16],
      ['org.jetbrains.kotlin.android:org.jetbrains.kotlin.android.gradle.plugin', '2.0.0', 'kotlin', 17],
      ['com.google.devtools.ksp:com.google.devtools.ksp.gradle.plugin', '2.0.0-1.0.22', null, 18],
    ])
    expect(deps[5]!.plugin).toBe('com.android.application')
  })

  it('reads plain Gradle literals and plugin versions, not $vars', () => {
    const kts = `plugins {\n  id("com.google.gms.google-services") version "4.4.2" apply false\n}\ndependencies {\n  implementation("androidx.appcompat:appcompat:1.7.0")\n  implementation("com.x:y:$v")\n  testImplementation 'junit:junit:4.13.2'\n  implementation(libs.foo)\n}`
    expect(parseGradleDeps(kts).map((d) => [d.name, d.current, d.line])).toEqual([
      ['com.google.gms.google-services:com.google.gms.google-services.gradle.plugin', '4.4.2', 2],
      ['androidx.appcompat:appcompat', '1.7.0', 5],
      ['junit:junit', '4.13.2', 7],
    ])
  })

  it('reads pubspec hosted packages, skips sdk / path / git', () => {
    const yaml = `name: app\ndependencies:\n  flutter:\n    sdk: flutter\n  http: ^1.2.0\n  intl: ">=0.18.0 <0.20.0"\n  local:\n    path: ../local\n  hosted_pkg:\n    hosted: https://x\n    version: ^2.0.0\n  any_pkg: any\ndev_dependencies:\n  lints: 4.0.0 # pinned\nflutter:\n  uses-material-design: true\n`
    expect(parsePubspec(yaml).map((d) => [d.name, d.current, d.section, d.line])).toEqual([
      ['http', '1.2.0', 'dependencies', 5],
      ['intl', '0.18.0', 'dependencies', 6],
      ['hosted_pkg', '2.0.0', 'dependencies', 9],
      ['lints', '4.0.0', 'dev_dependencies', 14],
    ])
  })

  it('reads package.json ranges and skips tags, workspaces and git', () => {
    const json = JSON.stringify({ dependencies: { vue: '^3.5.0', '@vue/shared': '~3.4.1', local: 'workspace:*', gh: 'github:a/b', tag: 'latest' }, devDependencies: { vitest: '>=2.0.0 <3', x: '1.x' } }, null, 2)
    expect(parsePackageJson(json).map((d) => [d.name, d.current, d.section])).toEqual([
      ['vue', '3.5.0', 'dependencies'],
      ['@vue/shared', '3.4.1', 'dependencies'],
      ['vitest', '2.0.0', 'devDependencies'],
      ['x', '1.0', 'devDependencies'],
    ])
    expect(parsePackageJson('{')).toEqual([])
  })

  it('reduces ranges to their lower bound', () => {
    expect(rangeBase('^1.2.3')).toBe('1.2.3')
    expect(rangeBase('v2.0.0-beta.1')).toBe('2.0.0-beta.1')
    expect(rangeBase('npm:other@1.0.0')).toBeNull()
    expect(rangeBase('*')).toBeNull()
  })
})

describe('rows, links and prompt', () => {
  const deps = parsePackageJson(JSON.stringify({ dependencies: { a: '^1.0.0', b: '2.0.0-rc.1', c: '1.0.0', d: '1.0.0' } }))
  const rows = libRows(deps, [
    { eco: 'npm', name: 'a', ok: true, registry: 'npm', stable: '2.1.0', pre: '3.0.0-beta.1', checkedAt: 1 },
    { eco: 'npm', name: 'b', ok: true, registry: 'npm', stable: '1.9.0', pre: '2.0.0-rc.2', checkedAt: 1 },
    { eco: 'npm', name: 'c', ok: true, registry: 'npm', stable: '1.0.0', pre: null, checkedAt: 1 },
    { eco: 'npm', name: 'd', ok: false, error: 'not-found' },
  ])

  it('ignores prereleases unless the current version is one', () => {
    expect(rows.map((r) => [r.name, r.latest, r.bump, r.status])).toEqual([
      ['a', '2.1.0', 'major', 'outdated'],
      ['b', '2.0.0-rc.2', 'patch', 'outdated'],
      ['c', '1.0.0', 'none', 'current'],
      ['d', null, 'none', 'error'],
    ])
    expect(rows[1]!.latestPre).toBe(true)
    expect(queriesOf([...deps, ...deps])).toHaveLength(4)
  })

  it('links to the package page and builds an upgrade prompt', () => {
    expect(libPage('maven', 'androidx.core:core-ktx', 'google')).toBe('https://maven.google.com/web/index.html#androidx.core:core-ktx')
    expect(libPage('maven', 'com.squareup.okhttp3:okhttp', 'central')).toBe('https://central.sonatype.com/artifact/com.squareup.okhttp3/okhttp/versions')
    expect(libPage('pub', 'http', 'pub')).toBe('https://pub.dev/packages/http/changelog')
    expect(libPage('npm', '../x', 'npm')).toBeNull()
    const text = upgradePrompt('package.json', rows)!
    expect(text).toContain('- a: ^1.0.0 → 2.1.0 (major)')
    expect(text).toContain('then build the project')
    expect(text).not.toContain('- c:')
    expect(upgradePrompt('x', rows.filter((r) => r.status !== 'outdated'))).toBeNull()
  })

  it('offers Check for updates on dependency files only', () => {
    expect(depFileKind('libs.versions.toml')).toBe('toml')
    expect(depFileKind('build.gradle.kts')).toBe('gradle')
    expect(depFileKind('settings.gradle')).toBeNull()
    const row = (name: string): TreeRow => ({ name, path: `/p/${name}`, directory: false, depth: 1, outOfRoot: false }) as TreeRow
    const ids = (r: TreeRow) => explorerMenu(r, { mac: false, repo: false, changed: false, libs: true, strings: true }, (k) => k).flatMap((e) => ('id' in e ? [e.id] : []))
    expect(ids(row('pubspec.yaml'))).toContain('lib-updates')
    expect(ids(row('README.md'))).not.toContain('lib-updates')
    expect(ids(row('app_vi.arb'))).toContain('strings')
  })
})
