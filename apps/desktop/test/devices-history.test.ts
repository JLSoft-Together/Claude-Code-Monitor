import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DeviceHistory } from '../src/devices/history'
import type { AdbDeviceRow } from '../src/devices/parse'

const row = (id: string, state: AdbDeviceRow['state'] = 'ready', model: string | null = null): AdbDeviceRow => ({
  id,
  state,
  model,
  product: null,
  device: null,
  transportId: null,
  usb: null,
})

let dir: string
let file: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-devhist-'))
  file = path.join(dir, 'adb-devices.json')
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('DeviceHistory', () => {
  it('remembers ready devices only', () => {
    const h = new DeviceHistory(file)
    h.seen([row('R5CT1234', 'ready', 'Pixel'), row('X1', 'unauthorized'), row('192.168.1.5:5555')], 10)
    expect(Object.keys(h.all()).sort()).toEqual(['192.168.1.5:5555', 'R5CT1234'])
    expect(h.all()['R5CT1234']).toEqual({ alias: null, model: 'Pixel', wifi: false, lastSeen: 10 })
    expect(h.wifiIds()).toEqual(['192.168.1.5:5555'])
  })

  it('skips writes when nothing changed', () => {
    const h = new DeviceHistory(file)
    h.seen([row('A', 'ready', 'M')], 1)
    expect(fs.existsSync(file)).toBe(true)
    fs.rmSync(file)
    h.seen([row('A', 'ready', 'M')], 2)
    expect(fs.existsSync(file)).toBe(false)
    expect(h.all()['A']!.lastSeen).toBe(2)
    h.seen([row('A', 'ready', 'N')], 3)
    expect(fs.existsSync(file)).toBe(true)
  })

  it('caps at 200 by oldest lastSeen', () => {
    const h = new DeviceHistory(file)
    for (let i = 0; i < 200; i++) h.seen([row(`d${i}`)], i + 1)
    h.seen([row('new')], 500)
    const ids = Object.keys(h.all())
    expect(ids).toHaveLength(200)
    expect(ids).not.toContain('d0')
    expect(ids).toContain('new')
  })

  it('alias trims, max 64, empty becomes null', () => {
    const h = new DeviceHistory(file)
    h.seen([row('A')], 1)
    h.setAlias('A', '  Kitchen  ')
    expect(h.all()['A']!.alias).toBe('Kitchen')
    h.setAlias('A', 'x'.repeat(100))
    expect(h.all()['A']!.alias).toHaveLength(64)
    h.setAlias('A', '   ')
    expect(h.all()['A']!.alias).toBeNull()
    h.setAlias('nope', 'x')
    expect(h.all()['nope']).toBeUndefined()
  })

  it('survives a corrupt file', () => {
    fs.writeFileSync(file, '{nope')
    const h = new DeviceHistory(file)
    expect(h.all()).toEqual({})
    expect(h.autoConnect).toBe(true)
  })

  it('drops malformed entries', () => {
    const devices = { ok: { alias: 'a', model: null, wifi: true, lastSeen: 3 }, bad: 5, worse: { lastSeen: 'x' } }
    fs.writeFileSync(file, JSON.stringify({ version: 1, autoConnect: false, devices }))
    const h = new DeviceHistory(file)
    expect(Object.keys(h.all())).toEqual(['ok'])
    expect(h.autoConnect).toBe(false)
  })

  it('ignores Object.prototype names as ids', () => {
    const h = new DeviceHistory(file)
    h.setAlias('constructor', 'x')
    h.setAlias('toString', 'x')
    expect(({}).constructor).toBe(Object)
    expect((Object as unknown as { alias?: unknown }).alias).toBeUndefined()
    expect(h.all()['constructor']).toBeUndefined()
    expect(fs.existsSync(file)).toBe(false)
  })

  it('loads a file with a __proto__ key safely', () => {
    const entry = { alias: 'evil', model: null, wifi: true, lastSeen: 9 }
    fs.writeFileSync(file, `{"version":1,"devices":{"__proto__":${JSON.stringify(entry)},"ok":${JSON.stringify(entry)}}}`)
    const h = new DeviceHistory(file)
    expect(Object.keys(h.all())).toEqual(['ok'])
    expect((h.all() as Record<string, unknown>).lastSeen).toBeUndefined()
    expect(Object.hasOwn(h.all(), '__proto__')).toBe(false)
    expect(h.wifiIds()).toEqual(['ok'])
  })

  it('does not remember emulators', () => {
    const h = new DeviceHistory(file)
    h.seen([row('emulator-5554', 'ready', 'sdk_gphone64'), row('R58M')], 1)
    expect(Object.keys(h.all())).toEqual(['R58M'])
  })

  it('round-trips through disk', () => {
    const h = new DeviceHistory(file)
    h.seen([row('A', 'ready', 'M'), row('1.2.3.4:5555')], 7)
    h.setAlias('A', 'Phone')
    h.setAutoConnect(false)
    const h2 = new DeviceHistory(file)
    expect(h2.all()).toEqual(h.all())
    expect(h2.autoConnect).toBe(false)
    h2.remove(['A'])
    expect(new DeviceHistory(file).wifiIds()).toEqual(['1.2.3.4:5555'])
  })
})
