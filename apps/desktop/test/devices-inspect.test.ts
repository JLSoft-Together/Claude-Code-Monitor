import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createAdbCommands, UI_DUMP_PATH } from '../src/devices/adb'
import { decodeXml, findPngStart, parseBounds, parseUiDump, pngSize } from '../src/devices/uiDump'
import type { SpawnSpec, Spawner } from '../src/run/proc'

const ADB = '/sdk/platform-tools/adb'

function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'ascii')
  b.writeUInt32BE(width, 16)
  b.writeUInt32BE(height, 20)
  return b
}

/** Each spawn answers with the next scripted reply. */
function scripted(replies: { out: Buffer | string; code?: number | null; err?: string }[]): { spawn: Spawner; specs: SpawnSpec[] } {
  const specs: SpawnSpec[] = []
  const spawn: Spawner = (spec) => {
    specs.push(spec)
    const reply = replies[specs.length - 1] ?? { out: '' }
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), pid: undefined, kill: vi.fn() })
    process.nextTick(() => {
      child.stdout.emit('data', typeof reply.out === 'string' ? Buffer.from(reply.out) : reply.out)
      if (reply.err) child.stderr.emit('data', Buffer.from(reply.err))
      child.emit('close', reply.code === undefined ? 0 : reply.code)
    })
    return child as unknown as ChildProcess
  }
  return { spawn, specs }
}

const DUMP = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="1"><node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.app" content-desc="" clickable="false" password="false" bounds="[0,0][1080,2400]"><node index="0" text="Sign in &amp; go" resource-id="com.app:id/login" class="android.widget.Button" package="com.app" content-desc="Log &quot;in&quot;" clickable="true" password="false" bounds="[40,1800][1040,1950]" /><node index="1" text="hunter2" resource-id="com.app:id/pass" class="android.widget.EditText" package="com.app" content-desc="" clickable="true" password="true" bounds="[40,1600][1040,1750]" /></node></hierarchy>`

describe('uiautomator dump parser', () => {
  it('flattens nodes with parent and depth, decodes entities, hides password text', () => {
    const r = parseUiDump(DUMP)!
    expect(r.rotation).toBe(1)
    expect(r.nodes).toHaveLength(3)
    expect(r.nodes[0]).toMatchObject({ parent: -1, depth: 0, cls: 'android.widget.FrameLayout', bounds: [0, 0, 1080, 2400] })
    expect(r.nodes[1]).toMatchObject({ parent: 0, depth: 1, resId: 'com.app:id/login', text: 'Sign in & go', desc: 'Log "in"', clickable: true, bounds: [40, 1800, 1040, 1950] })
    expect(r.nodes[2]).toMatchObject({ parent: 0, depth: 1, text: '' })
  })

  it('rejects non-dumps and odd values', () => {
    expect(parseUiDump('ERROR: could not get idle state.')).toBeNull()
    expect(parseBounds('[1,2][3]')).toBeNull()
    expect(parseBounds('[1,2][3,4]')).toEqual([1, 2, 3, 4])
    expect(decodeXml('&#x41;&#66;&bogus;&#0;')).toBe('AB&bogus;&#0;')
  })

  it('reads the PNG size and skips a leading warning', () => {
    const buf = Buffer.concat([Buffer.from('WARNING: linker\n'), png(1080, 2400)])
    const start = findPngStart(buf)
    expect(start).toBe(16)
    expect(pngSize(buf.subarray(start))).toEqual({ width: 1080, height: 2400 })
    expect(pngSize(Buffer.from('not a png at all, nope nope'))).toBeNull()
  })
})

describe('adb screencap / uiDump', () => {
  const make = (s: ReturnType<typeof scripted>) => createAdbCommands({ spawn: s.spawn, cwd: '/home', adb: async () => ADB })

  it('captures a PNG as a data URL', async () => {
    const s = scripted([{ out: png(720, 1280) }])
    const r = await make(s).screencap('abc')
    expect(s.specs[0]!.args).toEqual(['-s', 'abc', 'exec-out', 'screencap', '-p'])
    expect(r).toMatchObject({ ok: true, width: 720, height: 1280 })
    expect(r.ok && r.png.startsWith('data:image/png;base64,')).toBe(true)
  })

  it('reports a secure window and other capture failures', async () => {
    expect(await make(scripted([{ out: '', err: 'Capturing a secure window is not supported', code: 1 }])).screencap('abc')).toMatchObject({ ok: false, error: 'secure' })
    expect(await make(scripted([{ out: 'error: device offline', code: 1 }])).screencap('abc')).toEqual({ ok: false, error: 'capture-failed', detail: 'error: device offline' })
  })

  it('dumps, reads back and removes the temp file', async () => {
    const s = scripted([{ out: `UI hierchary dumped to: ${UI_DUMP_PATH}\n` }, { out: DUMP }, { out: '' }])
    const r = await make(s).uiDump('abc')
    expect(s.specs.map((x) => x.args)).toEqual([
      ['-s', 'abc', 'shell', 'uiautomator', 'dump', UI_DUMP_PATH],
      ['-s', 'abc', 'exec-out', 'cat', UI_DUMP_PATH],
      ['-s', 'abc', 'shell', 'rm', '-f', UI_DUMP_PATH],
    ])
    expect(r.ok && r.nodes.length).toBe(3)
  })

  it('a failed dump skips the read and says why', async () => {
    const s = scripted([{ out: 'ERROR: could not get idle state.\n', code: 0 }])
    expect(await make(s).uiDump('abc')).toEqual({ ok: false, error: 'dump-failed', detail: 'ERROR: could not get idle state.' })
    expect(s.specs).toHaveLength(1)
  })

  it('removes the file even when the read is not a dump', async () => {
    const s = scripted([{ out: 'UI hierchary dumped to: x' }, { out: 'garbage' }, { out: '' }])
    expect(await make(s).uiDump('abc')).toMatchObject({ ok: false, error: 'dump-failed' })
    expect(s.specs).toHaveLength(3)
  })
})
