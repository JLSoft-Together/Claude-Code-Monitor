import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bumpKind, compareLibVersions, isLibName, isPrereleaseVersion, pickLatest } from '@ccm/shared'
import { LIBS_CACHE_FILE, LIBS_TTL_MS, LibChecker } from '../src/libs/checker'
import { registerLibsIpc } from '../src/libs/ipc'
import { osvBatchUrl, parseOsvBatch, parseOsvVuln } from '../src/libs/osv'
import { isAllowedOverride, lookupUrl, parseMavenMetadata, parseNpmVersions, parsePubVersions, registriesFor } from '../src/libs/registry'

describe('library versions (shared)', () => {
  it('validates names before they reach a URL', () => {
    expect(isLibName('maven', 'androidx.core:core-ktx')).toBe(true)
    expect(isLibName('maven', 'a:b:c')).toBe(false)
    expect(isLibName('maven', '../x:y')).toBe(false)
    expect(isLibName('maven', 'a/b:c')).toBe(false)
    expect(isLibName('pub', 'http')).toBe(true)
    expect(isLibName('pub', 'Http')).toBe(false)
    expect(isLibName('npm', '@vue/compiler-sfc')).toBe(true)
    expect(isLibName('npm', 'vue')).toBe(true)
    expect(isLibName('npm', '../evil')).toBe(false)
    expect(isLibName('npm', '@a/b/c')).toBe(false)
    expect(isLibName('cargo', 'x')).toBe(false)
  })

  it('orders versions with prereleases before their release', () => {
    const sorted = ['1.10.0', '1.2.0', '1.10.0-alpha02', '1.10.0-alpha10', '1.10.0-beta01', '1.10.0-rc01', '1.9.9', '2.0.0-SNAPSHOT'].sort(compareLibVersions)
    expect(sorted).toEqual(['1.2.0', '1.9.9', '1.10.0-alpha02', '1.10.0-alpha10', '1.10.0-beta01', '1.10.0-rc01', '1.10.0', '2.0.0-SNAPSHOT'])
    expect(compareLibVersions('1.0', '1.0.0')).toBe(0)
    expect(isPrereleaseVersion('33.0.0-jre')).toBe(false)
    expect(isPrereleaseVersion('2.0.0.Final')).toBe(false)
    expect(isPrereleaseVersion('1.0.0-M1')).toBe(true)
    expect(isPrereleaseVersion('3.0.0-dev.1')).toBe(true)
    expect(isPrereleaseVersion('8.7.0-alpha05')).toBe(true)
  })

  it('picks the newest stable and a newer prerelease', () => {
    expect(pickLatest(['1.0.0', '1.1.0', '1.2.0-beta1', 'junk'])).toEqual({ stable: '1.1.0', pre: '1.2.0-beta1' })
    expect(pickLatest(['1.0.0-rc1', '1.0.0'])).toEqual({ stable: '1.0.0', pre: null })
    expect(pickLatest([])).toEqual({ stable: null, pre: null })
  })

  it('names the bump', () => {
    expect(bumpKind('1.2.3', '1.2.4')).toBe('patch')
    expect(bumpKind('1.2.3', '1.3.0')).toBe('minor')
    expect(bumpKind('1.2.3', '2.0.0')).toBe('major')
    expect(bumpKind('1.2.3', '1.2.3')).toBe('none')
    expect(bumpKind('1.3.0', '1.2.0')).toBe('none')
    expect(bumpKind('1.3.0-alpha01', '1.3.0')).toBe('patch')
  })
})

describe('registry urls and parsers', () => {
  it('routes Google groups to dl.google.com, then Central', () => {
    expect(registriesFor('maven', 'androidx.core:core-ktx')).toEqual(['google', 'central'])
    expect(registriesFor('maven', 'com.google.firebase:firebase-bom')).toEqual(['google', 'central'])
    expect(registriesFor('maven', 'com.squareup.okhttp3:okhttp')).toEqual(['central'])
    expect(lookupUrl('google', 'maven', 'androidx.core:core-ktx')).toBe('https://dl.google.com/android/maven2/androidx/core/core-ktx/maven-metadata.xml')
    expect(lookupUrl('central', 'maven', 'com.squareup.okhttp3:okhttp')).toBe('https://repo1.maven.org/maven2/com/squareup/okhttp3/okhttp/maven-metadata.xml')
    expect(lookupUrl('pub', 'pub', 'http')).toBe('https://pub.dev/api/packages/http')
    expect(lookupUrl('npm', 'npm', '@vue/core')).toBe('https://registry.npmjs.org/@vue%2Fcore')
    expect(lookupUrl('npm', 'npm', '../x')).toBeNull()
    expect(lookupUrl('npm', 'npm', 'vue', 'http://127.0.0.1:9/')).toBe('http://127.0.0.1:9/npm/vue')
  })

  it('accepts only a loopback http override', () => {
    expect(isAllowedOverride('http://127.0.0.1:4000')).toBe(true)
    expect(isAllowedOverride('https://evil.example')).toBe(false)
    expect(isAllowedOverride('http://10.0.0.1')).toBe(false)
    expect(isAllowedOverride(undefined)).toBe(false)
  })

  it('reads maven-metadata.xml, pub.dev and npm metadata', () => {
    const xml = '<metadata><versioning><release>1.2.0</release><versions><version>1.0.0</version><version>1.2.0</version><version>1.3.0-alpha01</version></versions></versioning></metadata>'
    expect(parseMavenMetadata(xml)).toEqual(['1.0.0', '1.2.0', '1.3.0-alpha01'])
    expect(parseMavenMetadata('<html>')).toBeNull()
    expect(parsePubVersions(JSON.stringify({ versions: [{ version: '1.0.0' }, { version: '1.1.0', retracted: true }] }))).toEqual(['1.0.0'])
    expect(parsePubVersions('nope')).toBeNull()
    expect(parseNpmVersions(JSON.stringify({ versions: { '1.0.0': {}, '1.0.1': { deprecated: 'bad' } } }))).toEqual(['1.0.0'])
  })
})

describe('LibChecker', () => {
  let dir = ''
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  const res = (status: number, body = '') => ({ ok: status === 200, status, text: async () => body })
  const meta = (...v: string[]) => `<metadata><versioning><versions>${v.map((x) => `<version>${x}</version>`).join('')}</versions></versioning></metadata>`

  it('falls back from Google to Central, caches an hour, refetches when fresh', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'ccm-libs-'))
    let now = 1_000_000
    const fetch = vi.fn(async (url: string) => {
      if (url.includes('dl.google.com')) return res(404)
      if (url.includes('repo1.maven.org')) return res(200, meta('2.10.0', '2.11.0', '2.12.0-rc1'))
      if (url.includes('pub.dev')) return res(200, JSON.stringify({ versions: [{ version: '1.1.0' }] }))
      throw new Error('offline')
    })
    const checker = new LibChecker({ fetch, dataDir: dir, now: () => now })
    const r = await checker.check([
      { eco: 'maven', name: 'com.google.code.gson:gson' },
      { eco: 'pub', name: 'http' },
      { eco: 'npm', name: 'vue' },
      { eco: 'pub', name: 'http' },
    ])
    expect(r.ok && r.results).toEqual([
      { eco: 'maven', name: 'com.google.code.gson:gson', ok: true, registry: 'central', stable: '2.11.0', pre: '2.12.0-rc1', checkedAt: now },
      { eco: 'pub', name: 'http', ok: true, registry: 'pub', stable: '1.1.0', pre: null, checkedAt: now },
      { eco: 'npm', name: 'vue', ok: false, error: 'network' },
    ])
    expect(fetch).toHaveBeenCalledTimes(4)
    expect(JSON.parse(readFileSync(path.join(dir, LIBS_CACHE_FILE), 'utf8')).entries['pub:http'].stable).toBe('1.1.0')

    const again = new LibChecker({ fetch, dataDir: dir, now: () => now + 1000 })
    await again.check([{ eco: 'pub', name: 'http' }])
    expect(fetch).toHaveBeenCalledTimes(4)
    await again.check([{ eco: 'pub', name: 'http' }], true)
    expect(fetch).toHaveBeenCalledTimes(5)
    now += LIBS_TTL_MS + 1
    await checker.check([{ eco: 'pub', name: 'http' }])
    expect(fetch).toHaveBeenCalledTimes(6)
  })

  it('times out slow registries and rejects bad input', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'ccm-libs-'))
    const fetch = (_url: string, init: { signal: AbortSignal }) =>
      new Promise<never>((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
    const checker = new LibChecker({ fetch, dataDir: dir, timeoutMs: 20 })
    const r = await checker.check([{ eco: 'npm', name: 'slow' }])
    expect(r.ok && r.results[0]).toEqual({ eco: 'npm', name: 'slow', ok: false, error: 'timeout' })
    expect(await checker.check([{ eco: 'npm', name: '../x' }])).toEqual({ ok: false, error: 'invalid' })
    expect(await checker.check('x')).toEqual({ ok: false, error: 'invalid' })
    expect(await checker.check(Array.from({ length: 400 }, (_, i) => ({ eco: 'npm', name: `p${i}` })))).toEqual({ ok: false, error: 'too-many' })
  })

  it('asks OSV with name + version only, fetches each record once, caches an hour', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'ccm-libs-'))
    const bodies: string[] = []
    const record = {
      id: 'GHSA-aaaa-bbbb-cccc',
      summary: 'Deserialization  of untrusted\n data',
      aliases: ['CVE-2020-1234', 'bad id!'],
      database_specific: { severity: 'HIGH' },
      affected: [
        { package: { ecosystem: 'Maven', name: 'com.fasterxml.jackson.core:jackson-databind' }, ranges: [{ type: 'ECOSYSTEM', events: [{ introduced: '2.9.0' }, { fixed: '2.9.10.8' }, { introduced: '2.10.0' }, { fixed: '2.10.5.1' }] }] },
        { package: { ecosystem: 'npm', name: 'other' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '9.0.0' }] }] },
      ],
    }
    const fetch = vi.fn(async (url: string, init: { body?: string; method?: string }) => {
      if (url === 'http://127.0.0.1:9/v1/querybatch') {
        bodies.push(init.body ?? '')
        return res(200, JSON.stringify({ results: [{ vulns: [{ id: 'GHSA-aaaa-bbbb-cccc' }, { id: 'GHSA-gone' }] }, {}] }))
      }
      if (url.endsWith('/v1/vulns/GHSA-aaaa-bbbb-cccc')) return res(200, JSON.stringify(record))
      if (url.endsWith('/v1/vulns/GHSA-gone')) return res(200, JSON.stringify({ id: 'GHSA-gone', withdrawn: '2024-01-01T00:00:00Z' }))
      throw new Error(`unexpected ${url}`)
    })
    const checker = new LibChecker({ fetch, dataDir: dir, osvOverride: 'http://127.0.0.1:9', now: () => 5000 })
    const q = [
      { eco: 'maven', name: 'com.fasterxml.jackson.core:jackson-databind', version: '2.10.1' },
      { eco: 'pub', name: 'http', version: '1.1.0' },
    ]
    const r = await checker.vulns(q)
    expect(JSON.parse(bodies[0]!)).toEqual({
      queries: [
        { package: { ecosystem: 'Maven', name: 'com.fasterxml.jackson.core:jackson-databind' }, version: '2.10.1' },
        { package: { ecosystem: 'Pub', name: 'http' }, version: '1.1.0' },
      ],
    })
    expect(r.ok && r.results).toEqual([
      { ...q[0], ok: true, checkedAt: 5000, vulns: [{ id: 'GHSA-aaaa-bbbb-cccc', aliases: ['CVE-2020-1234'], summary: 'Deserialization of untrusted data', severity: 'high', fixed: '2.10.5.1' }] },
      { ...q[1], ok: true, checkedAt: 5000, vulns: [] },
    ])
    expect(fetch).toHaveBeenCalledTimes(3)
    await checker.vulns(q)
    expect(fetch).toHaveBeenCalledTimes(3)
    await checker.vulns(q, true)
    expect(fetch).toHaveBeenCalledTimes(6)
    expect(JSON.parse(readFileSync(path.join(dir, LIBS_CACHE_FILE), 'utf8')).vulns['pub:http@1.1.0'].vulns).toEqual([])
  })

  it('reports an OSV outage as one error and rejects unsafe versions', async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'ccm-libs-'))
    const checker = new LibChecker({ fetch: async () => { throw new Error('offline') }, dataDir: dir })
    expect(await checker.vulns([{ eco: 'npm', name: 'vue', version: '3.0.0' }])).toEqual({ ok: false, error: 'network' })
    expect(await checker.vulns([{ eco: 'npm', name: 'vue', version: '../x' }])).toEqual({ ok: false, error: 'invalid' })
    const bad = new LibChecker({ fetch: async () => res(200, '{"results":[]}'), dataDir: dir })
    expect(await bad.vulns([{ eco: 'npm', name: 'vue', version: '3.0.0' }])).toEqual({ ok: false, error: 'bad-response' })
  })

  it('reads OSV records', () => {
    expect(osvBatchUrl()).toBe('https://api.osv.dev/v1/querybatch')
    expect(parseOsvBatch('{"results":[{"vulns":[{"id":"GHSA-1"},{"id":"../x"}]}]}', 1)).toEqual([['GHSA-1']])
    expect(parseOsvBatch('nope', 1)).toBeNull()
    const doc = { id: 'PYSEC-1', details: 'x', affected: [{ package: { ecosystem: 'npm', name: 'a' }, ecosystem_specific: { severity: 'MODERATE' }, ranges: [{ type: 'SEMVER', events: [{ introduced: '0' }, { fixed: '1.2.0' }] }] }] }
    expect(parseOsvVuln(JSON.stringify(doc), 'npm', 'a', '1.0.0')).toEqual({ id: 'PYSEC-1', aliases: [], summary: 'x', severity: 'moderate', fixed: '1.2.0' })
    expect(parseOsvVuln(JSON.stringify(doc), 'npm', 'a', '1.3.0')?.fixed).toBeNull()
  })

  it('answers only the app frame over IPC', async () => {
    const handlers = new Map<string, (e: unknown, req: unknown) => Promise<unknown>>()
    const ipcMain = { handle: (c: string, h: (e: unknown, req: unknown) => Promise<unknown>) => handlers.set(c, h), removeHandler: (c: string) => handlers.delete(c) }
    const check = vi.fn(async () => ({ ok: true, results: [] }))
    const dispose = registerLibsIpc({ ipcMain: ipcMain as never, isAppFrame: (e) => e === 'app', checker: { check } as never })
    expect(await handlers.get('ccm:libs-check')!('guest', {})).toEqual({ ok: false, error: 'unavailable' })
    await handlers.get('ccm:libs-check')!('app', { queries: [{ eco: 'pub', name: 'x' }], fresh: true })
    expect(check).toHaveBeenCalledWith([{ eco: 'pub', name: 'x' }], true)
    dispose()
    expect(handlers.size).toBe(0)
  })
})
