import { describe, expect, it } from 'vitest'
import type { AdbDevice, AvdInfo } from '@ccm/shared'
import { avdDetails, avdState, emulatorKey } from './emulators'

const dev = (id: string, over: Partial<AdbDevice> = {}): AdbDevice => ({
  id, state: 'ready', transport: 'emulator', model: null, product: null, device: null, transportId: null,
  alias: null, name: id, online: true, lastSeen: null, ...over,
})
const avd = (over: Partial<AvdInfo> = {}): AvdInfo => ({ name: 'P', displayName: 'P', api: 34, abi: 'x86_64', device: 'pixel_7', tag: null, serial: null, ...over })

describe('emulators', () => {
  it('keys only online emulators, order independent', () => {
    expect(emulatorKey([dev('emulator-5556'), dev('R5CT', { transport: 'usb' }), dev('emulator-5554'), dev('emulator-5558', { online: false })])).toBe('emulator-5554,emulator-5556')
    expect(emulatorKey([])).toBe('')
  })

  it('joins the known details', () => {
    expect(avdDetails(avd(), (n) => `API ${n}`)).toBe('API 34 · x86_64 · pixel_7')
    expect(avdDetails(avd({ api: null, device: null }), (n) => `API ${n}`)).toBe('x86_64')
  })

  it('derives the row state', () => {
    expect(avdState(avd({ serial: 'emulator-5554' }), new Set(['P']))).toBe('running')
    expect(avdState(avd(), new Set(['P']))).toBe('starting')
    expect(avdState(avd(), new Set())).toBe('stopped')
  })
})
