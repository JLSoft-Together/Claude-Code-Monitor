import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '@ccm/shared'
import { downloadAsset, localName } from '../src/update/download'
import { fetchLatest, isAllowedDownload, isAllowedFeed, parseDigest, parseRelease, RELEASES_PAGE } from '../src/update/github'
import { cmdQuote, macBundleOf, macScript, portableScript, shQuote } from '../src/update/install'
import { FIRST_CHECK_MS, UpdateManager, type UpdateDeps } from '../src/update/manager'
import { installKind, pickAsset, platformKind, type FeedAsset } from '../src/update/pick'
import { cleanVersion, compareVersions, isNewer, parseVersion } from '../src/update/semver'

const root = mkdtempSync(path.join(os.tmpdir(), 'ccm-update-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex')

describe('semver', () => {
  it('compares numerically and ignores prerelease / build', () => {
    expect(isNewer('2.10.0', '2.9.0')).toBe(true)
    expect(isNewer('2.5.0', '2.5.0')).toBe(false)
    expect(isNewer('v2.5.0', '2.4.0')).toBe(true)
    expect(isNewer('2.5.0-beta.1', '2.5.0')).toBe(false)
    expect(compareVersions('2.4.10', '2.4.9')).toBe(1)
    expect(compareVersions('1.0', '1.0.0')).toBe(0)
    expect(parseVersion('2.5.0+abc')).toEqual([2, 5, 0])
    expect(parseVersion('latest')).toBeNull()
    expect(isNewer('garbage', '2.4.0')).toBe(false)
    expect(cleanVersion('v3.1')).toBe('3.1.0')
  })
})

const assets: FeedAsset[] = [
  { name: 'Orrery-Setup-2.5.0.exe', size: 10, url: 'https://github.com/a/b/releases/download/v2.5.0/Orrery-Setup-2.5.0.exe', sha256: 'a'.repeat(64) },
  { name: 'Orrery-Portable-2.5.0.exe', size: 10, url: 'https://github.com/x', sha256: 'b'.repeat(64) },
  { name: 'Orrery-2.5.0-arm64.dmg', size: 10, url: 'https://github.com/y', sha256: 'c'.repeat(64) },
  { name: 'Orrery-2.5.0-x64.dmg', size: 10, url: 'https://github.com/z', sha256: 'd'.repeat(64) },
]

describe('pick', () => {
  it('maps the running build to an install kind', () => {
    expect(installKind({ platform: 'win32', packaged: true, portable: undefined })).toBe('nsis')
    expect(installKind({ platform: 'win32', packaged: true, portable: 'D:\\Orrery.exe' })).toBe('portable')
    expect(installKind({ platform: 'darwin', packaged: true, portable: undefined })).toBe('mac')
    expect(installKind({ platform: 'win32', packaged: false, portable: undefined })).toBe('dev')
    expect(installKind({ platform: 'linux', packaged: true, portable: undefined })).toBe('unsupported')
    expect(platformKind('win32', undefined)).toBe('nsis')
  })

  it('picks the asset of each kind and arch', () => {
    expect(pickAsset(assets, '2.5.0', 'nsis', 'x64')?.name).toBe('Orrery-Setup-2.5.0.exe')
    expect(pickAsset(assets, '2.5.0', 'portable', 'x64')?.name).toBe('Orrery-Portable-2.5.0.exe')
    expect(pickAsset(assets, '2.5.0', 'mac', 'arm64')?.name).toBe('Orrery-2.5.0-arm64.dmg')
    expect(pickAsset(assets, '2.5.0', 'mac', 'x64')?.name).toBe('Orrery-2.5.0-x64.dmg')
    expect(pickAsset(assets, '2.5.1', 'nsis', 'x64')?.name).toBe('Orrery-Setup-2.5.0.exe')
  })

  it('returns null when the asset is missing', () => {
    expect(pickAsset(assets.slice(1), '2.5.0', 'nsis', 'x64')).toBeNull()
    expect(pickAsset(assets, '2.5.0', 'mac', 'ia32')).toBeNull()
    expect(pickAsset(assets, '2.5.0', 'dev', 'x64')).toBeNull()
  })
})

describe('github feed', () => {
  it('parses digests', () => {
    expect(parseDigest(`sha256:${'AB'.repeat(32)}`)).toBe('ab'.repeat(32))
    expect(parseDigest('sha1:abc')).toBeNull()
    expect(parseDigest(undefined)).toBeNull()
  })

  it('allows only GitHub hosts (loopback only for a test feed)', () => {
    expect(isAllowedFeed('https://api.github.com/repos/a/b/releases/latest', false)).toBe(true)
    expect(isAllowedFeed('http://api.github.com/x', false)).toBe(false)
    expect(isAllowedFeed('http://127.0.0.1:9/feed.json', false)).toBe(false)
    expect(isAllowedFeed('http://127.0.0.1:9/feed.json', true)).toBe(true)
    expect(isAllowedDownload('https://github.com/a/b/releases/download/v1/x.exe', false)).toBe(true)
    expect(isAllowedDownload('https://release-assets.githubusercontent.com/x', false)).toBe(true)
    expect(isAllowedDownload('https://evil.com/github.com', false)).toBe(false)
    expect(isAllowedDownload('https://githubusercontent.com.evil.io/x', false)).toBe(false)
    expect(isAllowedDownload('https://user:pw@github.com/x', false)).toBe(false)
    expect(isAllowedDownload('http://github.com/x', false)).toBe(false)
    expect(isAllowedDownload('http://localhost:8/x', true)).toBe(true)
  })

  it('drops drafts, prereleases and foreign asset hosts', () => {
    const base = { tag_name: 'v2.5.0', html_url: 'https://github.com/a/b/releases/tag/v2.5.0', body: '# Notes', published_at: '2026-10-29T00:00:00Z' }
    expect(parseRelease({ ...base, draft: true })).toBeNull()
    expect(parseRelease({ ...base, prerelease: true })).toBeNull()
    const rel = parseRelease({
      ...base,
      assets: [
        { name: 'Orrery-Setup-2.5.0.exe', size: 5, browser_download_url: 'https://github.com/a/b/x.exe', digest: `sha256:${'e'.repeat(64)}` },
        { name: 'bad.exe', size: 5, browser_download_url: 'https://evil.com/x.exe' },
      ],
    })
    expect(rel?.version).toBe('2.5.0')
    expect(rel?.assets.map((a) => a.name)).toEqual(['Orrery-Setup-2.5.0.exe'])
    expect(rel?.assets[0]?.sha256).toBe('e'.repeat(64))
    expect(parseRelease({ ...base, html_url: 'https://evil.com/' })?.url).toBe(RELEASES_PAGE)
  })

  it('reports offline / 404 / bad JSON', async () => {
    const feed = 'https://api.github.com/repos/a/b/releases/latest'
    expect(await fetchLatest(feed, () => Promise.reject(new Error('x')), false)).toEqual({ ok: false, error: 'offline' })
    expect(await fetchLatest(feed, async () => new Response('', { status: 404 }), false)).toEqual({ ok: true, release: null })
    expect(await fetchLatest(feed, async () => new Response('nope', { status: 200 }), false)).toEqual({ ok: false, error: 'feed' })
    expect(await fetchLatest('https://evil.com/feed', async () => new Response('{}'), false)).toEqual({ ok: false, error: 'feed' })
  })
})

function streamResponse(data: Buffer, url = 'https://objects.githubusercontent.com/x'): Response {
  const res = new Response(
    new ReadableStream({
      start(c) {
        for (let i = 0; i < data.length; i += 4) c.enqueue(new Uint8Array(data.subarray(i, i + 4)))
        c.close()
      },
    }),
  )
  Object.defineProperty(res, 'url', { value: url })
  return res
}

describe('download', () => {
  const data = Buffer.from('orrery update payload 0123456789')
  const asset = (over: Partial<FeedAsset> = {}): FeedAsset => ({ name: 'Orrery-Setup-2.5.0.exe', size: data.length, url: 'https://github.com/a/b/x.exe', sha256: sha(data), ...over })

  it('rejects names with folders', () => {
    expect(localName('../x.exe')).toBe('x.exe')
    expect(localName('.hidden')).toBeNull()
    expect(localName('a b.exe')).toBeNull()
  })

  it('writes the file when size and SHA-256 match', async () => {
    const dir = path.join(root, 'ok')
    const progress = vi.fn()
    const res = await downloadAsset({ asset: asset(), dir, fetch: async () => streamResponse(data), allowLocal: false, signal: new AbortController().signal, onProgress: progress })
    expect(res).toEqual({ ok: true, file: path.join(dir, 'Orrery-Setup-2.5.0.exe') })
    expect(readFileSync(path.join(dir, 'Orrery-Setup-2.5.0.exe'))).toEqual(data)
    expect(existsSync(path.join(dir, 'Orrery-Setup-2.5.0.exe.part'))).toBe(false)
    expect(progress).toHaveBeenLastCalledWith({ received: data.length, total: data.length, bps: 0 })
  })

  it('deletes the file on a digest mismatch', async () => {
    const dir = path.join(root, 'bad')
    const res = await downloadAsset({ asset: asset({ sha256: '0'.repeat(64) }), dir, fetch: async () => streamResponse(data), allowLocal: false, signal: new AbortController().signal, onProgress: () => undefined })
    expect(res).toEqual({ ok: false, error: 'digest' })
    expect(existsSync(path.join(dir, 'Orrery-Setup-2.5.0.exe'))).toBe(false)
    expect(existsSync(path.join(dir, 'Orrery-Setup-2.5.0.exe.part'))).toBe(false)
  })

  it('refuses a missing digest, a foreign redirect and a short body', async () => {
    const dir = path.join(root, 'refuse')
    const base = { dir, allowLocal: false, signal: new AbortController().signal, onProgress: () => undefined }
    expect(await downloadAsset({ ...base, asset: asset({ sha256: null }), fetch: async () => streamResponse(data) })).toEqual({ ok: false, error: 'no-digest' })
    expect(await downloadAsset({ ...base, asset: asset(), fetch: async () => streamResponse(data, 'https://evil.com/x') })).toEqual({ ok: false, error: 'download' })
    expect(await downloadAsset({ ...base, asset: asset({ size: data.length + 5 }), fetch: async () => streamResponse(data) })).toEqual({ ok: false, error: 'download' })
  })

  it('cancels', async () => {
    const abort = new AbortController()
    abort.abort()
    const res = await downloadAsset({ asset: asset(), dir: path.join(root, 'cancel'), fetch: () => Promise.reject(new Error('aborted')), allowLocal: false, signal: abort.signal, onProgress: () => undefined })
    expect(res).toEqual({ ok: false, error: 'cancelled' })
  })
})

describe('install scripts', () => {
  it('quotes paths safely', () => {
    expect(cmdQuote('C:\\Users\\A B\\Orrery.exe')).toBe('"C:\\Users\\A B\\Orrery.exe"')
    expect(cmdQuote('C:\\100%\\x.exe')).toBeNull()
    expect(cmdQuote('C:\\a"b')).toBeNull()
    expect(shQuote("/Users/o'neil/Orrery.app")).toBe(`'/Users/o'\\''neil/Orrery.app'`)
  })

  it('portable script waits for the PID, replaces the exe and starts it', () => {
    const s = portableScript(4242, 'C:\\data\\updates\\Orrery-Portable-2.5.0.exe', 'D:\\Apps\\Orrery.exe')!
    expect(s).toContain('Wait-Process -Id 4242')
    expect(s).toContain('move /Y "C:\\data\\updates\\Orrery-Portable-2.5.0.exe" "D:\\Apps\\Orrery.exe"')
    expect(s).toContain('start "" "D:\\Apps\\Orrery.exe"')
    expect(portableScript(0, 'a', 'b')).toBeNull()
    expect(portableScript(1, 'a%', 'b')).toBeNull()
  })

  it('mac script swaps the bundle, clears quarantine and reopens', () => {
    expect(macBundleOf('/Applications/Orrery.app/Contents/MacOS/Orrery')).toBe('/Applications/Orrery.app')
    expect(macBundleOf('/usr/bin/electron')).toBeNull()
    const s = macScript(77, '/tmp/m', '/tmp/m/Orrery.app', '/Applications/Orrery.app')!
    expect(s).toContain('kill -0 77')
    expect(s).toContain("ditto '/tmp/m/Orrery.app' '/Applications/Orrery.app.ccm-new'")
    expect(s).toContain("xattr -dr com.apple.quarantine '/Applications/Orrery.app'")
    expect(s).toContain("hdiutil detach '/tmp/m'")
    expect(s).toContain("open '/Applications/Orrery.app'")
  })
})

describe('UpdateManager', () => {
  const data = Buffer.from('new build')
  const feedJson = (version = 'v2.5.0', digest = `sha256:${sha(data)}`) => ({
    tag_name: version,
    html_url: `https://github.com/a/b/releases/tag/${version}`,
    body: 'notes',
    published_at: '2026-10-29T00:00:00Z',
    assets: [{ name: `Orrery-Setup-${version.slice(1)}.exe`, size: data.length, browser_download_url: 'https://github.com/a/b/s.exe', digest }],
  })

  function make(over: Partial<UpdateDeps> = {}, json: unknown = feedJson()) {
    const dataDir = mkdtempSync(path.join(root, 'mgr-'))
    const timers: { fn: () => void; ms: number }[] = []
    const states: UpdateState[] = []
    const deps: UpdateDeps = {
      current: '2.4.0',
      kind: 'nsis',
      assetKind: 'nsis',
      canDownload: true,
      arch: 'x64',
      dataDir,
      feed: 'https://api.github.com/repos/a/b/releases/latest',
      allowLocal: false,
      fetch: async (url) => (url.includes('api.github.com') ? new Response(JSON.stringify(json)) : streamResponse(data)),
      broadcast: (s) => states.push(s),
      prepare: async () => ({ ok: true, launch: vi.fn() }),
      restart: vi.fn(async () => true),
      openUrl: vi.fn(),
      reveal: vi.fn(),
      setTimer: (fn, ms) => timers.push({ fn, ms }),
      clearTimer: () => undefined,
      ...over,
    }
    return { mgr: new UpdateManager(deps), deps, timers, states, dataDir }
  }

  it('schedules the first check 30 s after start and finds a newer release', async () => {
    const { mgr, timers } = make()
    mgr.start()
    expect(timers[0]?.ms).toBe(FIRST_CHECK_MS)
    const s = await mgr.check()
    expect(s.phase).toBe('available')
    expect(s.release?.version).toBe('2.5.0')
    expect(s.release?.asset?.name).toBe('Orrery-Setup-2.5.0.exe')
    expect(timers.at(-1)?.ms).toBe(12 * 60 * 60 * 1000)
  })

  it('reports none when the feed is not newer', async () => {
    const { mgr } = make({}, feedJson('v2.4.0'))
    expect((await mgr.check()).phase).toBe('none')
  })

  it('downloads, verifies and installs through restart', async () => {
    const launch = vi.fn()
    const { mgr, deps, dataDir } = make({ prepare: async () => ({ ok: true, launch }) })
    await mgr.check()
    expect((await mgr.download()).phase).toBe('ready')
    await mgr.install()
    expect(deps.restart).toHaveBeenCalledTimes(1)
    const run = (deps.restart as ReturnType<typeof vi.fn>).mock.calls[0]![0] as () => void
    run()
    expect(launch).toHaveBeenCalled()
    expect(JSON.parse(readFileSync(path.join(dataDir, 'updates', 'pending.json'), 'utf8'))).toEqual({ version: '2.5.0' })
  })

  it('stays ready when the restart is cancelled and never installs an unverified file', async () => {
    const { mgr, deps } = make({ restart: vi.fn(async () => false) }, feedJson('v2.5.0', `sha256:${'0'.repeat(64)}`))
    await mgr.check()
    const s = await mgr.download()
    expect(s).toMatchObject({ phase: 'error', error: 'digest' })
    await mgr.install()
    expect(deps.restart).not.toHaveBeenCalled()
  })

  it('flags a release without digest and does not download it', async () => {
    const json = feedJson()
    delete (json.assets[0] as { digest?: string }).digest
    const { mgr } = make({}, json)
    expect((await mgr.check()).error).toBe('no-digest')
    expect((await mgr.download()).phase).toBe('error')
  })

  it('dev build without a test feed only checks', async () => {
    const { mgr } = make({ kind: 'dev', canDownload: false })
    const s = await mgr.check()
    expect(s).toMatchObject({ phase: 'available', canDownload: false, error: null })
    expect((await mgr.download()).phase).toBe('available')
  })

  it('persists skip and auto-check', async () => {
    const { mgr, dataDir, deps } = make()
    await mgr.check()
    mgr.skip('2.5.0')
    mgr.setAutoCheck(false)
    expect(JSON.parse(readFileSync(path.join(dataDir, 'update.json'), 'utf8'))).toEqual({ autoCheck: false, skipped: '2.5.0' })
    const again = new UpdateManager({ ...deps, dataDir })
    expect(again.state()).toMatchObject({ autoCheck: false, skipped: '2.5.0' })
  })

  it('a newer release clears an older skip', async () => {
    const { mgr, dataDir } = make({}, feedJson('v2.6.0'))
    writeFileSync(path.join(dataDir, 'update.json'), JSON.stringify({ autoCheck: true, skipped: '2.5.0' }))
    const fresh = new UpdateManager({ ...make().deps, dataDir, fetch: async () => new Response(JSON.stringify(feedJson('v2.6.0'))) })
    expect((await fresh.check()).skipped).toBeNull()
    void mgr
  })

  it('reports an install that did not finish and keeps the file', () => {
    const { deps, dataDir } = make()
    mkdirSync(path.join(dataDir, 'updates'), { recursive: true })
    writeFileSync(path.join(dataDir, 'updates', 'pending.json'), JSON.stringify({ version: '2.5.0' }))
    writeFileSync(path.join(dataDir, 'updates', 'Orrery-Setup-2.5.0.exe'), 'x')
    const mgr = new UpdateManager({ ...deps, dataDir })
    mgr.start()
    expect(mgr.state()).toMatchObject({ phase: 'error', error: 'incomplete' })
    mgr.revealFile()
    expect(deps.reveal).toHaveBeenCalledWith(path.join(dataDir, 'updates', 'Orrery-Setup-2.5.0.exe'))
  })

  it('cleans the updates folder after a finished update', () => {
    const { deps, dataDir } = make({ current: '2.5.0' })
    mkdirSync(path.join(dataDir, 'updates'), { recursive: true })
    writeFileSync(path.join(dataDir, 'updates', 'pending.json'), JSON.stringify({ version: '2.5.0' }))
    new UpdateManager({ ...deps, dataDir }).start()
    expect(existsSync(path.join(dataDir, 'updates'))).toBe(false)
  })
})
