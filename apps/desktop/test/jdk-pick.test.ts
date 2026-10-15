import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { androidEnv, type EnvDeps } from '../src/run/android/env'
import { chooseJdk, clearJdkCache, maxJavaFor, parseGradleJvm, parseGradleVersion, parseRelease, pickFor, type JdkInfo } from '../src/run/android/jdkPick'

const ROOT = '/work/app'
const HOME = '/Users/me'
const mac = { platform: 'darwin' as const, home: HOME }
const JBR = '/Applications/Android Studio.app/Contents/jbr/Contents/Home'

function fakeFs(files: Record<string, string>): EnvDeps & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    isFile: async (f) => f in files,
    readText: async (f) => files[f] ?? null,
    mode: async () => 0o755,
    exec: async (file, args) => {
      calls.push([file, ...args].join(' '))
      return null
    },
    listDirs: async (dir) => {
      const prefix = `${dir}/`
      const names = Object.keys(files)
        .filter((f) => f.startsWith(prefix))
        .map((f) => f.slice(prefix.length).split('/')[0]!)
      return [...new Set(names)]
    },
  }
}

const jdk = (home: string, full: string): Record<string, string> => ({ [`${home}/bin/java`]: '', [`${home}/release`]: `IMPLEMENTOR="x"\nJAVA_VERSION="${full}"\n` })
const wrapper = (v: string): Record<string, string> => ({
  [`${ROOT}/gradle/wrapper/gradle-wrapper.properties`]: `distributionUrl=https\\://services.gradle.org/distributions/gradle-${v}-bin.zip\n`,
})
const JDKS: Record<number, Record<string, string>> = {
  25: jdk(`${HOME}/.gradle/jdks/eclipse_adoptium-25-amd64`, '25.0.1'),
  21: jdk(JBR, '21.0.10'),
  17: jdk(`${HOME}/.jdks/corretto-17.0.15`, '17.0.15'),
  11: jdk(`${HOME}/.jdks/jdk-11`, '11.0.21'),
}
const withJdks = (...versions: number[]): Record<string, string> => Object.assign({}, ...versions.map((v) => JDKS[v]))
const choose = (files: Record<string, string>, setting: string | null = null, env: NodeJS.ProcessEnv = {}) => chooseJdk(ROOT, { ...mac, setting, env }, fakeFs(files))

const info = (version: number, full = `${version}.0.1`): JdkInfo => ({ home: `/jdk${full}`, version, full, label: `jdk-${full}` })

describe('jdk pick rules', () => {
  it('parses wrapper versions and release files', () => {
    expect(parseGradleVersion('distributionUrl=https\\://services.gradle.org/distributions/gradle-7.3.3-bin.zip')).toEqual({ text: '7.3.3', parts: [7, 3, 3] })
    expect(parseGradleVersion('distributionUrl=https\\://x/gradle-8.0-rc-1-all.zip')?.parts).toEqual([8, 0, 0])
    expect(parseGradleVersion('distributionUrl=https\\://x/gradle-7.5-bin.zip')?.text).toBe('7.5')
    expect(parseGradleVersion('foo=bar')).toBeNull()
    expect(parseRelease('JAVA_VERSION="1.8.0_392"')).toEqual({ version: 8, full: '1.8.0_392' })
    expect(parseRelease('JAVA_VERSION="21"')?.version).toBe(21)
    expect(parseGradleJvm('<option name="gradleJvm" value="corretto-17" />')).toBe('corretto-17')
  })

  it.each([
    ['6.5', 14],
    ['6.7.1', 15],
    ['7.3.3', 17],
    ['7.5', 18],
    ['7.6.4', 19],
    ['8.2', 19],
    ['8.7', 21],
    ['8.14.3', 24],
    ['9.1.0', 25],
    ['4.10', 8],
  ])('Gradle %s runs on Java ≤ %i', (v, max) => {
    expect(maxJavaFor(parseGradleVersion(`distributionUrl=gradle-${v}-bin.zip`)!)).toBe(max)
  })

  it('unknown newer Gradle takes the newest JDK', () => {
    const g = parseGradleVersion('distributionUrl=gradle-9.4-bin.zip')!
    expect(maxJavaFor(g)).toBe(Infinity)
    expect(pickFor(g, [info(17), info(25), info(21)])?.version).toBe(25)
  })

  it.each([
    ['7.3.3', [21, 17, 11], 17],
    ['7.3.3', [21, 11], 11],
    ['7.5', [21, 18, 17], 18],
    ['8.7', [21, 17], 21],
    ['8.7', [25, 17], 17],
    ['6.5', [21, 11, 8], 11],
    ['6.5', [21, 8], 8],
  ] as const)('Gradle %s with %j → %i', (v, versions, want) => {
    const g = parseGradleVersion(`distributionUrl=gradle-${v}-bin.zip`)!
    expect(pickFor(g, versions.map((x) => info(x)))?.version).toBe(want)
  })

  it('same major: newest update wins', () => {
    const g = parseGradleVersion('distributionUrl=gradle-7.3.3-bin.zip')!
    expect(pickFor(g, [info(17, '17.0.7'), info(17, '17.0.15'), info(17, '17.0.14')])?.full).toBe('17.0.15')
  })
})

describe('chooseJdk', () => {
  it('Gradle 7.3.3 + {21 (Studio JBR), 17, 11} → corretto 17', async () => {
    clearJdkCache()
    const c = await choose({ ...wrapper('7.3.3'), ...withJdks(21, 17, 11) })
    expect(c.pick).toMatchObject({ home: `${HOME}/.jdks/corretto-17.0.15`, version: 17, label: 'corretto-17.0.15', source: 'discovered' })
    expect(c.minJdk).toBe(11)
  })

  it('finds JDKs under ~/.gradle/jdks (nested), macOS bundles and JAVA_HOME, deduped', async () => {
    const files = { ...wrapper('7.5'), ...jdk(`${HOME}/.gradle/jdks/adoptium-17/jdk-17.0.9+9`, '17.0.9'), ...jdk('/Library/Java/JavaVirtualMachines/zulu-18.jdk/Contents/Home', '18.0.2') }
    const c = await choose(files, null, { JAVA_HOME: '/Library/Java/JavaVirtualMachines/zulu-18.jdk/Contents/Home' })
    expect(c.pick).toMatchObject({ version: 18, label: 'zulu-18' })
  })

  it('org.gradle.java.home wins over everything', async () => {
    const files = { ...wrapper('7.3.3'), ...withJdks(21, 17), ...jdk('/opt/jdk11', '11.0.2'), [`${ROOT}/gradle.properties`]: 'org.gradle.java.home=/opt/jdk11\n' }
    expect((await choose(files, `${HOME}/.jdks/corretto-17.0.15`)).pick).toMatchObject({ home: '/opt/jdk11', source: 'gradle-properties' })
  })

  it('Run setting wins over .idea and discovery', async () => {
    const files = { ...wrapper('7.3.3'), ...withJdks(21, 17, 11) }
    expect((await choose(files, `${HOME}/.jdks/jdk-11`)).pick).toMatchObject({ home: `${HOME}/.jdks/jdk-11`, source: 'setting', version: 11 })
  })

  it('.idea gradleJvm by name, absolute path, local java home; stale / macro values skipped', async () => {
    const base = { ...wrapper('8.7'), ...withJdks(21, 17) }
    const idea = (v: string): Record<string, string> => ({ [`${ROOT}/.idea/gradle.xml`]: `<GradleProjectSettings>\n<option name="gradleJvm" value="${v}" />` })
    expect((await choose({ ...base, ...idea('corretto-17') })).pick).toMatchObject({ version: 17, source: 'idea' })
    expect((await choose({ ...base, ...idea(`${HOME}/.jdks/corretto-17.0.15`) })).pick).toMatchObject({ version: 17, source: 'idea' })
    const local = { ...base, ...idea('#GRADLE_LOCAL_JAVA_HOME'), [`${ROOT}/.gradle/config.properties`]: `java.home=${HOME}/.jdks/corretto-17.0.15` }
    expect((await choose(local)).pick).toMatchObject({ version: 17, source: 'idea' })
    expect((await choose({ ...base, ...idea('#JAVA_INTERNAL') })).pick).toMatchObject({ version: 21, source: 'discovered' })
    const stale = { ...wrapper('7.3.3'), ...withJdks(21, 17), ...idea('jbr-21') }
    expect((await choose(stale)).pick).toMatchObject({ version: 17, source: 'discovered' })
  })

  it('none compatible → no pick, jdk-incompatible with the Gradle version and found JDKs', async () => {
    const c = await choose({ ...wrapper('7.3.3'), ...withJdks(25, 21) })
    expect(c.pick).toBeNull()
    expect(c.issue).toEqual({ code: 'jdk-incompatible', detail: 'Gradle 7.3.3 runs on JDK ≤ 17; found 21 (jbr), 25 (eclipse_adoptium-25-amd64)' })
  })

  it('no wrapper version or no discovered JDK → no decision, no issue', async () => {
    expect(await choose(withJdks(17))).toMatchObject({ gradle: null, pick: null, minJdk: 17 })
    expect((await choose(wrapper('7.3.3'))).issue).toBeUndefined()
  })

  it('discovery is cached per deps until cleared', async () => {
    const files = { ...wrapper('7.3.3'), ...withJdks(17) }
    const deps = fakeFs(files)
    const opts = { ...mac, setting: null, env: {} }
    clearJdkCache()
    expect((await chooseJdk(ROOT, opts, deps)).pick?.version).toBe(17)
    Object.assign(files, jdk(`${HOME}/.jdks/corretto-17.0.99`, '17.0.99'))
    expect((await chooseJdk(ROOT, opts, deps)).pick?.label).toBe('corretto-17.0.15')
    clearJdkCache()
    expect((await chooseJdk(ROOT, opts, deps)).pick?.label).toBe('corretto-17.0.99')
  })

  it('Windows paths: Program Files vendors and Studio JBR', async () => {
    const w = path.win32
    const files: Record<string, string> = {
      'C:\\p\\gradle\\wrapper\\gradle-wrapper.properties': 'distributionUrl=https\\://services.gradle.org/distributions/gradle-7.5-bin.zip',
      'C:\\Program Files\\Android\\Android Studio\\jbr\\bin\\java.exe': '',
      'C:\\Program Files\\Android\\Android Studio\\jbr\\release': 'JAVA_VERSION="21.0.10"',
      'C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.9.9-hotspot\\bin\\java.exe': '',
      'C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.9.9-hotspot\\release': 'JAVA_VERSION="17.0.9"',
    }
    const deps: EnvDeps = {
      isFile: async (f) => f in files,
      readText: async (f) => files[f] ?? null,
      mode: async () => null,
      exec: async () => null,
      listDirs: async (dir) => [...new Set(Object.keys(files).filter((f) => f.startsWith(`${dir}\\`)).map((f) => f.slice(dir.length + 1).split('\\')[0]!))],
    }
    const c = await chooseJdk('C:\\p', { platform: 'win32', home: 'C:\\Users\\me', setting: null, env: { ProgramFiles: 'C:\\Program Files' } }, deps)
    expect(c.pick).toMatchObject({ home: w.join('C:\\Program Files\\Eclipse Adoptium', 'jdk-17.0.9.9-hotspot'), version: 17 })
  })
})

describe('androidEnv with the JDK pick', () => {
  const base = { '/opt/sdk/platform-tools/adb': '', [`${ROOT}/gradlew`]: '', ...wrapper('7.3.3') }
  const javaVersions = (map: Record<string, string>): EnvDeps['exec'] => async (file) => (map[file] ? { stdout: '', stderr: `openjdk version "${map[file]}"` } : null)

  it('uses the picked JDK as JAVA_HOME, allows 11 for Gradle 7 and notes it', async () => {
    const deps = { ...fakeFs({ ...base, ...withJdks(21, 11) }), exec: javaVersions({ [`${HOME}/.jdks/jdk-11/bin/java`]: '11.0.21' }) }
    const env = await androidEnv(ROOT, { ...mac, env: { ANDROID_HOME: '/opt/sdk' } }, deps)
    expect(env).toMatchObject({ jdk: `${HOME}/.jdks/jdk-11`, jdkVersion: 11, issues: [], jdkNote: 'JDK 11 (jdk-11) for Gradle 7.3.3' })
  })

  it('none compatible keeps the old lookup (Studio JBR) and adds a non-blocking jdk-incompatible', async () => {
    const deps = { ...fakeFs({ ...base, ...withJdks(21) }), exec: javaVersions({ [`${JBR}/bin/java`]: '21.0.10' }) }
    const env = await androidEnv(ROOT, { ...mac, env: { ANDROID_HOME: '/opt/sdk' } }, deps)
    expect(env).toMatchObject({ jdk: JBR, jdkVersion: 21, jdkNote: 'JDK 21 (jbr) for Gradle 7.3.3' })
    expect(env.issues).toEqual([{ code: 'jdk-incompatible', detail: 'Gradle 7.3.3 runs on JDK ≤ 17; found 21 (jbr)' }])
  })
})
