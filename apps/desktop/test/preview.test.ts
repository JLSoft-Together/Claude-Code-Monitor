import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileForView } from '../src/preview/files'
import { isExecutablePath, isLoopbackUrl, isWebUrl } from '../src/preview/ipc'
import { isWithin } from '../src/preview/paths'
import { mimeOf, PreviewServer } from '../src/preview/server'
import { RootWatcher } from '../src/preview/watch'

const tmp = mkdtempSync(path.join(os.tmpdir(), 'ccm-preview-'))
const site = path.join(tmp, 'site')
const other = path.join(tmp, 'other')
const server = new PreviewServer()
let base = ''
let otherBase = ''
let linkOk = false

/** Raw request so encoded dot segments reach the server exactly as written. */
function raw(pathname: string, opts: { method?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  const { port } = new URL(server.origin)
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: pathname, method: opts.method ?? 'GET', headers: opts.headers }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (c: string) => (body += c))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

beforeAll(async () => {
  mkdirSync(path.join(site, 'sub'), { recursive: true })
  mkdirSync(other, { recursive: true })
  writeFileSync(path.join(site, 'index.html'), '<h1>home</h1>')
  writeFileSync(path.join(site, 'app.js'), 'export const x = 1')
  writeFileSync(path.join(site, 'pic.png'), 'png')
  writeFileSync(path.join(site, 'sub', 'index.html'), '<p>sub</p>')
  writeFileSync(path.join(site, 'a b.css'), 'body{}')
  writeFileSync(path.join(tmp, 'secret.txt'), 'top secret')
  writeFileSync(path.join(other, 'other.txt'), 'other root')
  try {
    // Junctions need no admin rights on Windows.
    symlinkSync(tmp, path.join(site, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    linkOk = true
  } catch {
    linkOk = false
  }
  await server.start()
  const target = await server.urlFor(path.join(site, 'index.html'))
  base = target!.url.replace(/index\.html$/, '')
  otherBase = (await server.urlFor(path.join(other, 'other.txt')))!.url.replace(/other\.txt$/, '')
})

afterAll(async () => {
  await server.close()
  rmSync(tmp, { recursive: true, force: true })
})

describe('PreviewServer', () => {
  it('serves files with MIME and no-store headers', async () => {
    const res = await fetch(`${base}app.js`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    expect(await res.text()).toBe('export const x = 1')
    expect((await fetch(`${base}a%20b.css`)).headers.get('content-type')).toBe('text/css; charset=utf-8')
  })

  it('lets the app page (another loopback port) embed images, nothing else', async () => {
    const img = await fetch(`${base}pic.png`)
    expect(img.headers.get('content-type')).toBe('image/png')
    expect(img.headers.get('cross-origin-resource-policy')).toBe('cross-origin')
    expect((await fetch(`${base}index.html`)).headers.get('cross-origin-resource-policy')).toBe('same-origin')
  })

  it('maps directories to index.html, redirects missing slash, no listing', async () => {
    expect(await (await fetch(base)).text()).toBe('<h1>home</h1>')
    const noSlash = await fetch(`${base}sub`, { redirect: 'manual' })
    expect(noSlash.status).toBe(301)
    expect(await (await fetch(`${base}sub/`)).text()).toBe('<p>sub</p>')
    const listing = await server.urlFor(other)
    expect((await fetch(listing!.url)).status).toBe(404)
  })

  it('supports HEAD and 404 for unknown files and tokens', async () => {
    const head = await fetch(`${base}app.js`, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-length')).toBe('18')
    expect(await head.text()).toBe('')
    expect((await fetch(`${base}nope.js`)).status).toBe(404)
    expect((await fetch(`${server.origin}/${'0'.repeat(32)}/index.html`)).status).toBe(404)
    expect((await fetch(`${base}app.js`, { method: 'POST' })).status).toBe(405)
  })

  it('refuses traversal: plain, encoded, backslash, and absolute', async () => {
    const token = new URL(base).pathname.split('/')[1]
    for (const p of [
      `/${token}/../secret.txt`,
      `/${token}/%2e%2e/secret.txt`,
      `/${token}/%2E%2E%2Fsecret.txt`,
      `/${token}/..%5Csecret.txt`,
      `/${token}/sub/..%2F..%2Fsecret.txt`,
      `/${token}/${encodeURIComponent(path.join(tmp, 'secret.txt'))}`,
    ]) {
      const res = await raw(p)
      expect(res.status, p).not.toBe(200)
      expect(res.body).not.toContain('top secret')
    }
  })

  it('refuses symlinks that leave the root', async () => {
    if (!linkOk) return
    const res = await fetch(`${base}escape/secret.txt`)
    expect(res.status).toBe(404)
  })

  it('keeps tokens apart and rejects foreign Host headers', async () => {
    expect(base).not.toBe(otherBase)
    const token = new URL(base).pathname.split('/')[1]
    expect((await fetch(`${server.origin}/${token}/other.txt`)).status).toBe(404)
    expect((await fetch(`${otherBase}other.txt`)).status).toBe(200)
    const rebound = await raw(`/${token}/index.html`, { headers: { Host: 'evil.example:80' } })
    expect(rebound.status).toBe(403)
  })

  it('redirects root-relative assets through the referring page token', async () => {
    const res = await raw('/app.js', { headers: { Referer: `${base}index.html` } })
    expect(res.status).toBe(307)
    expect(res.headers.location).toBe(`${new URL(base).pathname}app.js`)
    expect((await raw('/app.js', { headers: { Referer: 'http://evil.example/x' } })).status).toBe(404)
  })

  it('answers byte ranges', async () => {
    const res = await fetch(`${base}app.js`, { headers: { Range: 'bytes=7-11' } })
    expect(res.status).toBe(206)
    expect(await res.text()).toBe('const')
  })

  it('reuses the token of a folder and picks the deepest given root', async () => {
    const again = await server.urlFor(path.join(site, 'app.js'))
    expect(again!.token).toBe(new URL(base).pathname.split('/')[1])
    const nested = await server.urlFor(path.join(site, 'sub', 'index.html'), [tmp, site])
    expect(nested!.url.endsWith('/sub/index.html')).toBe(true)
  })

  it('has a MIME table with a binary default', () => {
    expect(mimeOf('a.WOFF2')).toBe('font/woff2')
    expect(mimeOf('a.wasm')).toBe('application/wasm')
    expect(mimeOf('a.mp4')).toBe('video/mp4')
    expect(mimeOf('a.unknown')).toBe('application/octet-stream')
  })
})

describe('readFileForView', () => {
  it('reads text inside a root and rejects outside / symlink-out', async () => {
    const view = await readFileForView(path.join(site, 'app.js'), [site])
    expect(view.kind).toBe('text')
    expect(view.text).toBe('export const x = 1')
    expect(view.lang).toBe('js')
    expect((await readFileForView(path.join(tmp, 'secret.txt'), [site])).kind).toBe('denied')
    expect((await readFileForView('relative.txt', [site])).kind).toBe('denied')
    if (linkOk) expect((await readFileForView(path.join(site, 'escape', 'secret.txt'), [site])).kind).toBe('denied')
  })

  it('flags binary, too-large, image, missing', async () => {
    writeFileSync(path.join(site, 'blob.dat'), Buffer.from([1, 2, 0, 3]))
    writeFileSync(path.join(site, 'big.txt'), 'x'.repeat(64))
    writeFileSync(path.join(site, 'pic.png'), Buffer.from([0x89, 0x50]))
    expect((await readFileForView(path.join(site, 'blob.dat'), [site])).kind).toBe('binary')
    expect((await readFileForView(path.join(site, 'big.txt'), [site], 16)).kind).toBe('too-large')
    const img = await readFileForView(path.join(site, 'pic.png'), [site])
    expect(img.kind).toBe('image')
    expect(img.text).toBeUndefined()
    expect((await readFileForView(path.join(site, 'gone.txt'), [site])).kind).toBe('missing')
    expect((await readFileForView(site, [site])).kind).toBe('missing')
  })
})

describe('preview helpers', () => {
  it('compares paths case-insensitively on win32 only', () => {
    if (process.platform === 'win32') expect(isWithin('C:\\Work\\App', 'c:\\work\\app\\x.html', 'win32')).toBe(true)
    expect(isWithin('/a/b', '/a/bc', 'linux')).toBe(false)
    expect(isWithin('/a/b', '/a/b/c', 'linux')).toBe(true)
  })

  it('classifies urls and executables', () => {
    expect(isWebUrl('https://x.dev')).toBe(true)
    expect(isWebUrl('file:///etc/passwd')).toBe(false)
    expect(isWebUrl('javascript:alert(1)')).toBe(false)
    expect(isLoopbackUrl('http://localhost:5173/')).toBe(true)
    expect(isLoopbackUrl('http://127.0.0.1.evil.dev/')).toBe(false)
    expect(isExecutablePath('C:\\x\\run.BAT')).toBe(true)
    expect(isExecutablePath('/x/readme.md')).toBe(false)
  })
})

describe('RootWatcher', () => {
  it('refcounts, ignores node_modules/.git/build output and debounces', async () => {
    const listeners: Array<(e: string, f: string | null) => void> = []
    let closed = 0
    const fake = ((_root: string, _o: unknown, cb: (e: string, f: string | null) => void) => {
      listeners.push(cb)
      return { on: () => undefined, close: () => closed++ }
    }) as never
    const seen: string[][] = []
    const w = new RootWatcher((_root, changed) => seen.push(changed), { debounceMs: 10, watch: fake, platform: 'linux' })
    expect(w.add('/p')).toBe(true)
    expect(w.add('/p')).toBe(true)
    expect(listeners).toHaveLength(1)
    listeners[0]!('change', 'node_modules/x.js')
    listeners[0]!('change', '.git/HEAD')
    for (const f of ['build/x.class', 'app/build/y.dex', '.gradle/a.lock', '.dart_tool/p.json', 'dist/i.js', '.vitest/r.json', 'out/m.js', '.idea/w.xml']) listeners[0]!('change', f)
    listeners[0]!('change', 'src/a.html')
    listeners[0]!('change', 'src/a.html')
    await new Promise((r) => setTimeout(r, 30))
    expect(seen).toEqual([[path.join('/p', 'src/a.html')]])
    w.remove('/p')
    expect(closed).toBe(0)
    w.remove('/p')
    expect(closed).toBe(1)
    expect(w.has('/p')).toBe(false)
  })
})
