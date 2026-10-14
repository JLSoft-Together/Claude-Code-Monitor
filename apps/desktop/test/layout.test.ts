import { EventEmitter } from 'node:events'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { deflateRawSync } from 'node:zlib'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { LayoutDaemon, LayoutError, daemonArgs, type DaemonChild, type DaemonDeps } from '../src/layout/daemon'
import { downloadArtifact, isAllowedUrl, artifactUrl, ARTIFACTS, DownloadError, type Artifact, type Fetcher } from '../src/layout/download'
import { cleanTree, isLayoutFile, registerLayoutIpc } from '../src/layout/ipc'
import { FrameParser, encodeMessage } from '../src/layout/rpc'
import { extractZip, safeEntryName } from '../src/layout/zip'

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ccm-layout-')))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

type Handler = (msg: { id?: number; method: string; params: Record<string, unknown> }, child: FakeChild) => void

class FakeChild extends EventEmitter implements DaemonChild {
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  exitCode: number | null = null
  pid = 4242
  received: { method: string; params: Record<string, unknown> }[] = []
  constructor(handler: Handler) {
    super()
    const parser = new FrameParser()
    this.stdin.on('data', (chunk: Buffer) => {
      for (const m of parser.push(chunk) as { id?: number; method: string; params: Record<string, unknown> }[]) {
        this.received.push(m)
        handler(m, this)
      }
    })
  }
  reply(id: number | undefined, result: unknown): void {
    this.stdout.write(encodeMessage({ jsonrpc: '2.0', id, result }))
  }
  fail(id: number | undefined, code: number, message: string): void {
    this.stdout.write(encodeMessage({ jsonrpc: '2.0', id, error: { code, message } }))
  }
  die(code = 1): void {
    if (this.exitCode !== null) return
    this.exitCode = code
    this.emit('exit', code)
  }
}

const okRender = (m: { id?: number; params: Record<string, unknown> }, c: FakeChild): void =>
  c.reply(m.id, { requestId: m.params.requestId, png: null, width: 100, height: 200, viewTree: null, diagnostics: [], renderMs: 5 })

function setup(handler: Handler, extra: Partial<DaemonDeps> = {}) {
  const children: FakeChild[] = []
  const kill = vi.fn((c: DaemonChild) => (c as FakeChild).die(137))
  const daemon = new LayoutDaemon({
    spawn: () => {
      const c = new FakeChild(handler)
      children.push(c)
      return c
    },
    kill,
    findJava: async () => ({ ok: true, home: '/jdk', version: 21, java: '/jdk/bin/java' }),
    daemonJar: '/app/layout-daemon.jar',
    layoutlibDir: () => '/data/layoutlib/16.2.3',
    cacheDir: '/data/layoutlib/cache',
    platform: 'linux',
    ...extra,
  })
  return { daemon, children, kill }
}

const params = { layoutPath: '/p/res/layout/a.xml', xmlContent: '<LinearLayout/>', device: { width: 1080, height: 2340, density: 440 }, theme: null, night: false, locale: null }

describe('framing', () => {
  it('parses frames split across chunks and several per chunk', () => {
    const p = new FrameParser()
    const a = encodeMessage({ id: 1, result: 'é' })
    const b = encodeMessage({ method: 'log', params: { message: 'x' } })
    const all = Buffer.concat([a, b])
    expect(p.push(all.subarray(0, 7))).toEqual([])
    expect(p.push(all.subarray(7, a.length + 3))).toEqual([{ id: 1, result: 'é' }])
    expect(p.push(all.subarray(a.length + 3))).toEqual([{ method: 'log', params: { message: 'x' } }])
  })
  it('daemon args put both jars on the classpath', () => {
    const args = daemonArgs('C:\\app\\d.jar', 'C:\\data\\ll', 'win32')
    expect(args).toContain('C:\\app\\d.jar;C:\\data\\ll\\layoutlib-16.2.3.jar')
    expect(args.slice(-3)).toEqual(['dev.ccm.layoutdaemon.MainKt', '--layoutlib', 'C:\\data\\ll'])
  })
})

describe('LayoutDaemon', () => {
  it('initializes once, renders, forwards log notifications', async () => {
    const log = vi.fn()
    const { daemon, children } = setup(
      (m, c) => {
        if (m.method === 'initialize') {
          c.stdout.write(encodeMessage({ jsonrpc: '2.0', method: 'log', params: { level: 'info', message: 'hello' } }))
          c.reply(m.id, { protocolVersion: 1, initMs: 10 })
        } else if (m.method === 'render') okRender(m, c)
      },
      { log },
    )
    const r1 = await daemon.render(params, 's')
    const r2 = await daemon.render(params, 's')
    expect(r1.width).toBe(100)
    expect(r2.requestId).not.toBe(r1.requestId)
    expect(children).toHaveLength(1)
    expect(children[0]!.received.filter((m) => m.method === 'initialize')).toHaveLength(1)
    expect(children[0]!.received[0]!.params.cacheDir).toBe('/data/layoutlib/cache')
    expect(log).toHaveBeenCalledWith('info', 'hello')
    expect(daemon.state).toBe('ready')
  })

  it('watchdog kills a hung render and restarts the daemon', async () => {
    const { daemon, children, kill } = setup(
      (m, c) => {
        if (m.method === 'initialize') c.reply(m.id, {})
        else if (m.method === 'render' && children.length > 1) okRender(m, c)
      },
      { renderTimeoutMs: 30 },
    )
    await expect(daemon.render(params, 's')).rejects.toMatchObject({ code: 'timeout' })
    expect(kill).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(children).toHaveLength(2))
    const r = await daemon.render(params, 's')
    expect(r.width).toBe(100)
  })

  it('stops restarting after 3 crashes in the window', async () => {
    const { daemon, children } = setup((m, c) => {
      if (m.method === 'initialize') c.reply(m.id, {})
    })
    await daemon.ensure()
    for (let i = 0; i < 3; i++) {
      await vi.waitFor(() => expect(children.length).toBe(i + 1))
      await vi.waitFor(() => expect(daemon.state).toBe('ready'))
      children[i]!.die(1)
    }
    expect(daemon.state).toBe('failed')
    await expect(daemon.ensure()).rejects.toBeInstanceOf(LayoutError)
    expect(children).toHaveLength(3)
  })

  it('cancels the superseded queued render of the same slot', async () => {
    const held: { id?: number; params: Record<string, unknown> }[] = []
    const { daemon, children } = setup((m, c) => {
      if (m.method === 'initialize') c.reply(m.id, {})
      else if (m.method === 'render') {
        if (held.length) okRender(m, c)
        held.push(m)
      } else if (m.method === 'cancel') {
        const old = held.find((h) => h.params.requestId === m.params.requestId)
        if (old) c.fail(old.id, -32800, 'cancelled')
        c.reply(m.id, { cancelled: !!old })
      }
    })
    const first = daemon.render(params, 'same')
    await vi.waitFor(() => expect(held).toHaveLength(1))
    const second = daemon.render(params, 'same')
    await expect(first).rejects.toMatchObject({ code: 'cancelled' })
    expect((await second).width).toBe(100)
    expect(children[0]!.received.some((m) => m.method === 'cancel')).toBe(true)
  })

  it('request() forwards a method; requestRestart waits for in-flight work, then restarts warm', async () => {
    let release: (() => void) | null = null
    const { daemon, children } = setup((m, c) => {
      if (m.method === 'initialize') c.reply(m.id, {})
      else if (m.method === 'project/load') release = () => c.reply(m.id, { ok: true, restartSuggested: true })
      else if (m.method === 'shutdown') {
        c.reply(m.id, null)
        c.die(0)
      }
    })
    const load = daemon.request('project/load', { resDirs: [] })
    await vi.waitFor(() => expect(release).not.toBeNull())
    daemon.requestRestart()
    expect(children[0]!.received.some((m) => m.method === 'shutdown')).toBe(false)
    release!()
    expect(await load).toEqual({ ok: true, restartSuggested: true })
    await vi.waitFor(() => expect(children).toHaveLength(2))
    await vi.waitFor(() => expect(daemon.state).toBe('ready'))
    expect(children[0]!.received.map((m) => m.method)).toEqual(['initialize', 'project/load', 'shutdown'])
  })

  it('reports a missing JDK without spawning', async () => {
    const { daemon, children } = setup(() => undefined, { findJava: async () => ({ ok: false, code: 'jdk-old', detail: '11' }) })
    await expect(daemon.render(params, 's')).rejects.toMatchObject({ code: 'jdk-old', detail: '11' })
    expect(children).toHaveLength(0)
  })
})

function fetcherOf(body: Buffer, status = 200, length: number | null = body.length): Fetcher & { calls: string[] } {
  const calls: string[] = []
  const f = (async (url: string) => {
    calls.push(url)
    return {
      status,
      length,
      abort: () => undefined,
      body: (async function* () {
        for (let i = 0; i < body.length; i += 1000) yield body.subarray(i, i + 1000)
      })(),
    }
  }) as Fetcher & { calls: string[] }
  f.calls = calls
  return f
}

describe('download', () => {
  const body = Buffer.from('x'.repeat(5000))
  const pinned: Artifact = { artifact: 'layoutlib', size: body.length, sha256: createHash('sha256').update(body).digest('hex') }

  it('only allows https from dl.google.com', () => {
    expect(isAllowedUrl(artifactUrl(ARTIFACTS.win))).toBe(true)
    expect(artifactUrl(ARTIFACTS.macArm)).toBe('https://dl.google.com/android/maven2/com/android/tools/layoutlib/layoutlib-runtime/16.2.3/layoutlib-runtime-16.2.3-mac-arm.jar')
    expect(isAllowedUrl('http://dl.google.com/x.jar')).toBe(false)
    expect(isAllowedUrl('https://dl.google.com.evil.io/x.jar')).toBe(false)
    expect(isAllowedUrl('https://user@dl.google.com/x.jar')).toBe(false)
    expect(isAllowedUrl('https://repo1.maven.org/x.jar')).toBe(false)
  })

  it('refuses a disallowed host before fetching', async () => {
    const f = fetcherOf(body)
    await expect(downloadArtifact(pinned, path.join(tmp, 'h.jar'), f, () => undefined, 'https://evil.example/x.jar')).rejects.toMatchObject({ code: 'host-not-allowed' })
    expect(f.calls).toHaveLength(0)
  })

  it('writes a file whose size + sha256 match', async () => {
    const file = path.join(tmp, 'ok.jar')
    let seen = 0
    await downloadArtifact(pinned, file, fetcherOf(body), (n) => (seen += n))
    expect(readFileSync(file).equals(body)).toBe(true)
    expect(seen).toBe(body.length)
  })

  it('rejects and deletes on sha256 mismatch', async () => {
    const file = path.join(tmp, 'bad.jar')
    const evil = Buffer.from('y'.repeat(5000))
    await expect(downloadArtifact(pinned, file, fetcherOf(evil), () => undefined)).rejects.toMatchObject({ code: 'sha256-mismatch' })
    expect(existsSync(file)).toBe(false)
  })

  it('rejects a wrong size and http errors', async () => {
    await expect(downloadArtifact(pinned, path.join(tmp, 's.jar'), fetcherOf(Buffer.concat([body, body]), 200, null), () => undefined)).rejects.toBeInstanceOf(DownloadError)
    await expect(downloadArtifact(pinned, path.join(tmp, 's2.jar'), fetcherOf(body, 200, 99), () => undefined)).rejects.toMatchObject({ code: 'size-mismatch' })
    await expect(downloadArtifact(pinned, path.join(tmp, 'e.jar'), fetcherOf(body, 404), () => undefined)).rejects.toMatchObject({ code: 'http-404' })
  })
})

function makeZip(files: { name: string; data: Buffer; store?: boolean }[]): Buffer {
  const locals: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const name = Buffer.from(f.name)
    const comp = f.store ? f.data : deflateRawSync(f.data)
    const lh = Buffer.alloc(30)
    lh.writeUInt32LE(0x04034b50, 0)
    lh.writeUInt16LE(f.store ? 0 : 8, 8)
    lh.writeUInt32LE(comp.length, 18)
    lh.writeUInt32LE(f.data.length, 22)
    lh.writeUInt16LE(name.length, 26)
    const ch = Buffer.alloc(46)
    ch.writeUInt32LE(0x02014b50, 0)
    ch.writeUInt16LE(f.store ? 0 : 8, 10)
    ch.writeUInt32LE(comp.length, 20)
    ch.writeUInt32LE(f.data.length, 24)
    ch.writeUInt16LE(name.length, 28)
    ch.writeUInt32LE(offset, 42)
    locals.push(lh, name, comp)
    central.push(ch, name)
    offset += 30 + name.length + comp.length
  }
  const cd = Buffer.concat(central)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(cd.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, cd, eocd])
}

describe('zip', () => {
  it('extracts stored + deflated entries and folders', async () => {
    const zip = path.join(tmp, 'a.zip')
    writeFileSync(zip, makeZip([{ name: 'data/', data: Buffer.alloc(0), store: true }, { name: 'data/fonts/a.ttf', data: Buffer.from('font'.repeat(100)) }, { name: 'build.prop', data: Buffer.from('k=v'), store: true }]))
    const out = path.join(tmp, 'out')
    const r = await extractZip(zip, out, { maxTotal: 1e6 })
    expect(r.files).toBe(2)
    expect(readFileSync(path.join(out, 'data', 'fonts', 'a.ttf'), 'utf8')).toBe('font'.repeat(100))
    expect(readFileSync(path.join(out, 'build.prop'), 'utf8')).toBe('k=v')
  })
  it('refuses zip slip and oversize archives', async () => {
    expect(safeEntryName('../evil')).toBeNull()
    expect(safeEntryName('a/../../evil')).toBeNull()
    expect(safeEntryName('C:/x')).toBeNull()
    expect(safeEntryName('a\\b')).toBeNull()
    const zip = path.join(tmp, 'slip.zip')
    writeFileSync(zip, makeZip([{ name: '../slip.txt', data: Buffer.from('x') }]))
    await expect(extractZip(zip, path.join(tmp, 'slip'), { maxTotal: 1e6 })).rejects.toMatchObject({ code: 'zip-unsafe-path' })
    expect(existsSync(path.join(tmp, 'slip.txt'))).toBe(false)
    const big = path.join(tmp, 'big.zip')
    writeFileSync(big, makeZip([{ name: 'a', data: Buffer.alloc(2000) }]))
    await expect(extractZip(big, path.join(tmp, 'big'), { maxTotal: 1000 })).rejects.toMatchObject({ code: 'zip-too-large' })
  })
})

describe('render gate', () => {
  it('accepts only res/layout*/ xml files', () => {
    expect(isLayoutFile('/p/app/src/main/res/layout/activity_main.xml', 'linux')).toBe(true)
    expect(isLayoutFile('/p/res/layout-land/a.xml', 'linux')).toBe(true)
    expect(isLayoutFile('/p/res/layout-sw600dp-v21/a.xml', 'linux')).toBe(true)
    expect(isLayoutFile('C:\\p\\RES\\Layout\\a.XML', 'win32')).toBe(true)
    expect(isLayoutFile('/p/res/values/strings.xml', 'linux')).toBe(false)
    expect(isLayoutFile('/p/res/layoutx/a.xml', 'linux')).toBe(false)
    expect(isLayoutFile('/p/src/layout/a.xml', 'linux')).toBe(false)
    expect(isLayoutFile('/p/res/layout/a.txt', 'linux')).toBe(false)
    expect(isLayoutFile('/p/res/layout/nested/a.xml', 'linux')).toBe(false)
  })

  it('ccm:layout-render refuses files outside res/layout and denied frames', async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>()
    const ipcMain = { handle: (ch: string, fn: (event: unknown, ...args: unknown[]) => unknown) => handlers.set(ch, fn), removeHandler: (ch: string) => handlers.delete(ch) }
    const values = path.join(tmp, 'proj', 'res', 'values')
    const layout = path.join(tmp, 'proj', 'res', 'layout')
    mkdirSync(values, { recursive: true })
    mkdirSync(layout, { recursive: true })
    writeFileSync(path.join(values, 'strings.xml'), '<resources/>')
    writeFileSync(path.join(layout, 'big.xml'), 'x'.repeat(1024 * 1024 + 1))
    const render = vi.fn()
    let appFrame = true
    const ipc = registerLayoutIpc({
      ipcMain: ipcMain as never,
      isAppFrame: () => appFrame,
      resolveDir: async (p) => (typeof p === 'string' ? p : null),
      dataDir: path.join(tmp, 'data'),
      getJdk: () => null,
      confirm: async () => false,
      server: { urlFor: async () => null },
      daemonJar: __filename,
      spawn: () => {
        throw new Error('no spawn')
      },
      kill: () => undefined,
      bundle: { isReady: () => true, status: () => ({ state: 'ready', dir: '/x' }), dir: '/x', downloadBytes: 1, download: async () => ({ state: 'ready', dir: '/x' }) } as never,
      daemon: { render, state: 'stopped', stop: async () => undefined, killNow: () => undefined } as never,
    })
    const call = (req: unknown) => handlers.get('ccm:layout-render')!({ sender: { id: 1 } }, req)
    const device = { width: 1080, height: 2340, density: 440 }
    expect(await call({ file: path.join(values, 'strings.xml'), device })).toEqual({ ok: false, code: 'denied' })
    expect(await call({ file: path.join(layout, 'big.xml'), device: { width: 1, height: 2, density: 3 } })).toEqual({ ok: false, code: 'bad-params' })
    expect(await call({ file: path.join(layout, 'big.xml'), device })).toEqual({ ok: false, code: 'too-large' })
    appFrame = false
    expect(await call({ file: path.join(layout, 'big.xml'), device })).toEqual({ ok: false, code: 'denied' })
    expect(render).not.toHaveBeenCalled()
    expect(await handlers.get('ccm:layout-download')!({ sender: { id: 1 } })).toBeNull()
    ipc.dispose()
    expect(handlers.size).toBe(0)
  })

  it('cleanTree keeps known fields and drops broken nodes', () => {
    const tree = cleanTree({ class: 'LinearLayout', xmlId: null, line: 2, column: 1, bounds: [0, 0, 10, 10], extra: 'x', children: [{ class: 'TextView', line: 3, bounds: [0, 0, 5] }, { class: 'Button', xmlId: '@+id/b', line: 9, column: 5, bounds: [1, 2, 3, 4] }] })
    expect(tree).toEqual({ class: 'LinearLayout', xmlId: null, line: 2, column: 1, bounds: [0, 0, 10, 10], children: [{ class: 'Button', xmlId: '@+id/b', line: 9, column: 5, bounds: [1, 2, 3, 4], children: [] }] })
  })
})
