import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdbCommands } from '../src/devices/adb'
import { mp4Complete, pickEven, recordArgs, remotePath, ScreenRecorder, stopArgs, thinFrames } from '../src/devices/recorder'

const MP4 = Buffer.concat([Buffer.from('00000010667479706973766d00000200', 'hex'), Buffer.from('000000086d6f6f76', 'hex'), Buffer.from('0000000c6d64617400000000', 'hex')])
const reader = (b: Buffer) => (pos: number, len: number) => b.subarray(pos, pos + len)

describe('recording helpers', () => {
  it('picks evenly spaced frames, first and last included', () => {
    expect(pickEven([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 6)).toEqual([0, 2, 4, 6, 8, 10])
    expect(pickEven([1, 2], 6)).toEqual([1, 2])
  })

  it('halves frames past the cap', () => {
    expect(thinFrames([1, 2, 3], 2)).toEqual({ frames: [1, 3], thinned: true })
    expect(thinFrames([1, 2], 2)).toEqual({ frames: [1, 2], thinned: false })
  })

  it('accepts a finished MP4 only (ftyp first, moov present, boxes span the file)', () => {
    expect(mp4Complete(reader(MP4), MP4.length)).toBe(true)
    const noMoov = Buffer.concat([MP4.subarray(0, 16), MP4.subarray(24)])
    expect(mp4Complete(reader(noMoov), noMoov.length)).toBe(false)
    expect(mp4Complete(reader(MP4), MP4.length + 4)).toBe(false)
    expect(mp4Complete(reader(Buffer.from('garbage!garbage!')), 16)).toBe(false)
  })

  it('builds shell-safe commands', () => {
    expect(recordArgs(42)).toEqual(['screenrecord', '--time-limit', '30', '--bit-rate', '8000000', '/sdcard/orrery-rec-42.mp4'])
    expect(stopArgs(42)).toEqual(['pkill', '-INT', '-f', "'orrery-rec-42'"])
  })
})

function fakeDevice(opts: { exitEarly?: boolean; noMoov?: boolean; secure?: boolean } = {}) {
  const log: string[] = []
  const remote = new Set<string>()
  let child: (EventEmitter & { stdout: EventEmitter; stderr: EventEmitter }) | null = null
  const cmds = {
    spawnShell: vi.fn(async (_id: string, args: string[]) => {
      log.push(args.join(' '))
      remote.add(args.at(-1)!)
      child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() })
      if (opts.exitEarly)
        setTimeout(() => {
          child!.stderr.emit('data', 'ERROR: unable to configure video encoder')
          child!.emit('close', 1)
        }, 5)
      return child as unknown as ChildProcess
    }),
    screencap: vi.fn(async () => (opts.secure ? { ok: false as const, error: 'secure' as const } : { ok: true as const, png: `data:image/png;base64,${log.length}`, width: 1, height: 1 })),
    shell: vi.fn(async (_id: string, args: string[]) => {
      log.push(args.join(' '))
      if (args[0] === 'pkill') setTimeout(() => child?.emit('close', 0), 5)
      if (args[0] === 'rm') remote.delete(args.at(-1)!.replace(/'/g, ''))
      return { code: 0, out: '', timedOut: false }
    }),
    pull: vi.fn(async (_id: string, from: string, to: string) => {
      log.push(`pull ${from}`)
      writeFileSync(to, opts.noMoov ? MP4.subarray(0, 16) : MP4)
      return { code: 0, out: '1 file pulled', timedOut: false }
    }),
  } as unknown as AdbCommands
  return { cmds, log, remote }
}

const timing = { frameMs: 10, startCheckMs: 30, stopWaitMs: 200, orphanMs: 60_000 }
let recorders: ScreenRecorder[] = []
afterEach(() => {
  for (const r of recorders) r.dispose()
  recorders = []
})

function make(dev: ReturnType<typeof fakeDevice>, ready = true) {
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'ccm-rec-'))
  const kill = vi.fn()
  const r = new ScreenRecorder({
    withDevice: async (_id, fn) => (ready ? fn(dev.cmds) : { ok: false, error: 'not-connected' }),
    tmpDir,
    kill,
    now: () => 1000,
    timing,
  })
  recorders.push(r)
  return { r, tmpDir, kill }
}

describe('ScreenRecorder', () => {
  it('records, stops with SIGINT, pulls a finished MP4, keeps frames and removes the device file', async () => {
    const dev = fakeDevice()
    const { r } = make(dev)
    expect(await r.start('abc')).toEqual({ ok: true, startedAt: 1000, limitMs: 30_000 })
    expect(await r.start('abc')).toEqual({ ok: false, error: 'busy' })
    await new Promise((res) => setTimeout(res, 60))
    const res = await r.stop('abc')
    if (!res.ok) throw new Error(res.error)
    expect(res.bytes).toBe(MP4.length)
    expect(res.frames.length).toBeGreaterThan(0)
    expect(res.frames.length).toBeLessThanOrEqual(6)
    expect(dev.log).toContain("pkill -INT -f 'orrery-rec-1000'")
    expect(dev.log).toContain(`pull ${remotePath(1000)}`)
    expect(dev.remote.size).toBe(0)
    expect(r.isRecording('abc')).toBe(false)
    const dest = path.join(os.tmpdir(), `ccm-rec-out-${process.pid}.mp4`)
    expect(await r.save(res.token, dest)).toEqual({ ok: true, name: path.basename(dest) })
    expect(readFileSync(dest)).toEqual(MP4)
    expect(await r.save(res.token, null)).toEqual({ ok: false, error: 'cancelled' })
    expect(r.discard(res.token)).toBe(true)
    expect(await r.save(res.token, dest)).toEqual({ ok: false, error: 'invalid' })
  })

  it('reports a recorder that exits at once and frees the device', async () => {
    const dev = fakeDevice({ exitEarly: true })
    const { r } = make(dev)
    expect(await r.start('abc')).toEqual({ ok: false, error: 'record-failed', detail: 'ERROR: unable to configure video encoder' })
    expect(r.isRecording('abc')).toBe(false)
    expect(dev.remote.size).toBe(0)
  })

  it('refuses an unfinished file and still cleans up', async () => {
    const dev = fakeDevice({ noMoov: true })
    const { r, tmpDir } = make(dev)
    await r.start('abc')
    const res = await r.stop('abc')
    expect(res).toMatchObject({ ok: false, error: 'record-failed' })
    expect(dev.remote.size).toBe(0)
    expect(existsSync(path.join(tmpDir, 'orrery-rec-1000.mp4'))).toBe(false)
  })

  it('cancel stops the recorder and removes the device file; secure frames are counted', async () => {
    const dev = fakeDevice({ secure: true })
    const { r } = make(dev)
    await r.start('abc')
    await new Promise((res) => setTimeout(res, 40))
    expect(await r.cancel('abc')).toEqual({ ok: true })
    expect(dev.remote.size).toBe(0)
    expect(r.isRecording('abc')).toBe(false)
    expect(await r.stop('abc')).toEqual({ ok: false, error: 'invalid' })
  })

  it('needs a ready device', async () => {
    const { r } = make(fakeDevice(), false)
    expect(await r.start('abc')).toEqual({ ok: false, error: 'not-connected' })
    expect(r.isRecording('abc')).toBe(false)
  })
})
