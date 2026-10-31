import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { busyCounts, parseBusy } from '@ccm/shared'
import { AWAKE_GRACE_MS, decideAwake, KeepAwake } from '../src/power/awake'
import { cleanDir, decodePng, isInside, isOrreryFile, parsePatch, parseShotRequest, pickExpired, sanitizeDevice, shotName } from '../src/capture/files'
import { CaptureFolder } from '../src/capture/folder'

const PNG = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]).toString('base64')

describe('keep awake decision', () => {
  const base = { mode: 'running' as const, agents: 0, jobs: 0, onBattery: false, lastBusyAt: null, now: 1_000_000 }

  it('holds while working, keeps 2 minutes of grace, then releases', () => {
    expect(decideAwake({ ...base, agents: 2 })).toMatchObject({ hold: true, reason: 'working' })
    expect(decideAwake({ ...base, lastBusyAt: base.now - 60_000 })).toEqual({ hold: true, reason: 'grace', releaseAt: base.now + 60_000 })
    expect(decideAwake({ ...base, lastBusyAt: base.now - AWAKE_GRACE_MS })).toMatchObject({ hold: false, reason: 'idle' })
    expect(decideAwake({ ...base, jobs: 1, mode: 'off' })).toMatchObject({ hold: false, reason: 'off' })
  })

  it('plugged mode never holds on battery', () => {
    expect(decideAwake({ ...base, mode: 'plugged', agents: 1, onBattery: true })).toMatchObject({ hold: false, reason: 'battery' })
    expect(decideAwake({ ...base, mode: 'plugged', agents: 1 })).toMatchObject({ hold: true })
    expect(decideAwake({ ...base, mode: 'running', agents: 1, onBattery: true })).toMatchObject({ hold: true })
  })

  it('controller starts one blocker and releases it after the grace on a fake clock', () => {
    let now = 0
    let battery = false
    const timers: { at: number; fn: () => void }[] = []
    const calls: string[] = []
    const k = new KeepAwake(
      {
        start: () => (calls.push('start'), 7),
        stop: (id) => void calls.push(`stop:${id}`),
        onBattery: () => battery,
        now: () => now,
        setTimer: (fn, ms) => (timers.push({ at: now + ms, fn }), timers.length),
        clearTimer: () => void timers.splice(0),
      },
      'plugged',
    )
    k.setBusy(1, 0)
    k.setBusy(2, 1)
    expect(calls).toEqual(['start'])
    expect(k.state()).toMatchObject({ holding: true, agents: 2, jobs: 1 })
    now = 10_000
    k.setBusy(0, 0)
    expect(k.state()).toMatchObject({ holding: true, reason: 'grace', releaseAt: 10_000 + AWAKE_GRACE_MS })
    now = 10_000 + 60_000
    k.setBusy(1, 0)
    k.setBusy(0, 0)
    now = 70_000 + AWAKE_GRACE_MS
    timers.at(-1)!.fn()
    expect(calls).toEqual(['start', 'stop:7'])
    expect(k.state().reason).toBe('idle')
    battery = true
    k.setBusy(1, 0)
    expect(k.state()).toMatchObject({ holding: false, reason: 'battery' })
    battery = false
    k.powerChanged()
    expect(calls).toEqual(['start', 'stop:7', 'start'])
    k.setMode('off')
    expect(calls.at(-1)).toBe('stop:7')
  })

  it('counts working sessions, subagents and jobs; parses the port message', () => {
    expect(
      busyCounts(
        [{ status: 'working' }, { status: 'idle' }],
        [{ role: 'main', status: 'working' }, { role: 'subagent', status: 'working' }, { role: 'subagent', status: 'completed' }],
        [{ state: 'working' }, { state: 'done' }],
      ),
    ).toEqual({ agents: 2, jobs: 1 })
    expect(parseBusy({ type: 'busy', agents: 1, jobs: 0 })).toEqual({ type: 'busy', agents: 1, jobs: 0 })
    expect(parseBusy({ type: 'busy', agents: -1, jobs: 0 })).toBeNull()
    expect(parseBusy({ type: 'resources' })).toBeNull()
  })
})

describe('capture file naming and validation', () => {
  it('names shots after a sanitized device and local time', () => {
    const d = new Date(2026, 10, 1, 9, 5, 7)
    expect(shotName('Pixel 8 Pro', d)).toBe('Pixel-8-Pro-20261101-090507.png')
    expect(shotName('../..\\evil:name', d, 3)).toBe('evil-name-20261101-090507-f3.png')
    expect(shotName('Pixel', d, 2, 2)).toBe('Pixel-20261101-090507-2-f2.png')
    expect(sanitizeDevice('…')).toBe('device')
    expect(isOrreryFile('shots', 'Pixel-20261101-090507-f2.png')).toBe(true)
    expect(isOrreryFile('shots', 'notes.png')).toBe(false)
    expect(isOrreryFile('recordings', 'orrery-rec-1790000000000.mp4')).toBe(true)
    expect(isOrreryFile('recordings', 'screen.mp4')).toBe(false)
    expect(isOrreryFile('other', 'orrery-rec-1790000000000.mp4')).toBe(false)
  })

  it('selects expired files by age, then oldest past the size cap', () => {
    const day = 86_400_000
    const now = 100 * day
    const f = (name: string, ageDays: number, size: number) => ({ path: name, size, mtimeMs: now - ageDays * day })
    const files = [f('old', 8, 1), f('a', 1, 600), f('b', 2, 600), f('c', 3, 600)]
    expect(pickExpired(files, { now, keepDays: 7, maxBytes: 1300 }).map((x) => x.path).sort()).toEqual(['c', 'old'])
    expect(pickExpired(files, { now, keepDays: 30, maxBytes: 10_000 })).toEqual([])
  })

  it('accepts only absolute folders and paths inside the folder', () => {
    expect(cleanDir('L:\\AI\\cache', true)).toBe('L:\\AI\\cache')
    expect(cleanDir('\\AI\\cache', true)).toBeNull()
    expect(cleanDir('relative', true)).toBeNull()
    expect(cleanDir('C:\\a\0b', true)).toBeNull()
    expect(cleanDir('/home/u/cache', false)).toBe('/home/u/cache')
    expect(isInside('L:\\AI\\cache\\shots', 'L:\\ai\\cache\\shots\\x.png', true)).toBe(true)
    expect(isInside('L:\\AI\\cache\\shots', 'L:\\AI\\cache\\shots\\..\\x.png', true)).toBe(false)
    expect(isInside('/c/shots', '/c/shots', false)).toBe(false)
  })

  it('page patches never carry a folder path; shot requests need a real PNG', () => {
    expect(parsePatch({ dir: 'C:\\x' })).toBeNull()
    expect(parsePatch({ dir: null, keepDays: 7 })).toEqual({ dir: null, keepDays: 7 })
    expect(parsePatch({ maxGb: 3 })).toBeNull()
    expect(decodePng('data:image/jpeg;base64,AAAA')).toBeNull()
    expect(decodePng('data:image/png;base64,' + Buffer.from('hello world').toString('base64'))).toBeNull()
    expect(parseShotRequest({ png: PNG, device: 'Pixel', frame: 2 })?.frame).toBe(2)
    expect(parseShotRequest({ png: PNG, device: 'Pixel', frame: 0 })).toBeNull()
  })
})

describe('capture folder', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })
  const temp = (): string => {
    const d = mkdtempSync(path.join(os.tmpdir(), 'ccm-cap-'))
    dirs.push(d)
    return d
  }

  it('falls back to temp when unset or missing, writes shots and sweeps only Orrery files', async () => {
    const data = temp()
    const tmpRoot = temp()
    const cap = temp()
    const missing: string[] = []
    const now = Date.now()
    const folder = new CaptureFolder({ file: path.join(data, 'capture.json'), tmpRoot, videos: () => 'V', onMissing: (d) => missing.push(d), now: () => now })
    expect(folder.recordingsDir()).toBe(path.join(tmpRoot, 'orrery-rec'))
    expect(folder.saveDir()).toBe('V')
    folder.set({ dir: cap })
    expect(folder.recordingsDir()).toBe(path.join(cap, 'recordings'))
    expect(folder.wantsFiles()).toBe(true)
    const shot = await folder.writeShot(decodePng(PNG)!, 'Pixel 8', 2)
    const again = await folder.writeShot(decodePng(PNG)!, 'Pixel 8', 2)
    expect(path.dirname(shot!)).toBe(path.join(cap, 'shots'))
    expect(again).not.toBe(shot)
    mkdirSync(path.join(cap, 'recordings'), { recursive: true })
    const old = path.join(cap, 'recordings', 'orrery-rec-1700000000000.mp4')
    const mine = path.join(cap, 'recordings', 'screen.mp4')
    for (const f of [old, mine]) writeFileSync(f, 'x')
    const past = new Date(now - 30 * 86_400_000)
    utimesSync(old, past, past)
    utimesSync(mine, past, past)
    expect(await folder.sweep()).toBe(1)
    expect(readdirSync(path.join(cap, 'recordings'))).toEqual(['screen.mp4'])
    expect(new CaptureFolder({ file: path.join(data, 'capture.json'), tmpRoot, videos: () => 'V' }).config().dir).toBe(cap)
    rmSync(cap, { recursive: true, force: true })
    expect(folder.status()).toMatchObject({ active: null, problem: 'missing' })
    folder.status()
    expect(missing).toEqual([cap])
    expect(folder.recordingsDir()).toBe(path.join(tmpRoot, 'orrery-rec'))
  })

  it('startup removes leftover temp recordings and unfinished ones in the folder', async () => {
    const data = temp()
    const tmpRoot = temp()
    const cap = temp()
    mkdirSync(path.join(tmpRoot, 'orrery-rec'))
    writeFileSync(path.join(tmpRoot, 'orrery-rec', 'orrery-rec-1700000000000.mp4'), 'x')
    writeFileSync(path.join(tmpRoot, 'orrery-rec', 'keep.txt'), 'x')
    mkdirSync(path.join(cap, 'recordings'))
    writeFileSync(path.join(cap, 'recordings', 'orrery-rec-1700000000001.mp4'), 'broken')
    const folder = new CaptureFolder({ file: path.join(data, 'capture.json'), tmpRoot, videos: () => 'V' })
    folder.set({ dir: cap })
    expect(await folder.sweepOrphans()).toBe(2)
    expect(readdirSync(path.join(tmpRoot, 'orrery-rec'))).toEqual(['keep.txt'])
    expect(readdirSync(path.join(cap, 'recordings'))).toEqual([])
  })
})
