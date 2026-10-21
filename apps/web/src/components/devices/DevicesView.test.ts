import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { AdbDevice, DevSnapshot } from '@ccm/shared'
import { i18n } from '../../i18n'

const api = vi.hoisted(() => ({
  devHold: vi.fn(),
  devSnapshot: vi.fn(),
  devConnect: vi.fn(),
  devPair: vi.fn(),
  devQrStart: vi.fn(),
  devQrCancel: vi.fn(),
}))

vi.mock('../../lib/devices', () => ({
  hasDevices: true,
  onDevEvent: () => () => {},
  devHold: (on: boolean) => api.devHold(on),
  devSnapshot: () => api.devSnapshot(),
  devConnect: (a: string) => api.devConnect(a),
  devPair: (a: string, c: string) => api.devPair(a, c),
  devQrStart: () => api.devQrStart(),
  devQrCancel: (id: string) => api.devQrCancel(id),
}))

import { useDevicesStore } from '../../stores/devices'
import DevicesView from './DevicesView.vue'

const dev = (id: string, over: Partial<AdbDevice> = {}): AdbDevice => ({
  id, state: 'ready', transport: 'usb', model: null, product: null, device: null, transportId: null,
  alias: null, name: id, online: true, lastSeen: null, ...over,
})

const t = (key: string): string => i18n.global.t(key)
let w: VueWrapper | null = null

async function mountWith(snap: DevSnapshot) {
  api.devSnapshot.mockResolvedValue(snap)
  const pinia = createPinia()
  setActivePinia(pinia)
  w = mount(DevicesView, { global: { plugins: [i18n, pinia] }, attachTo: document.body })
  await flushPromises()
  return w
}

const row = (id: string) => w!.get(`[data-dev-row="${id}"]`)
const actions = (id: string) => row(id).findAll('[data-dev-action]').map((b) => b.attributes('data-dev-action'))

beforeEach(() => {
  localStorage.clear()
  i18n.global.locale.value = 'en'
  for (const f of Object.values(api)) f.mockReset()
  api.devHold.mockResolvedValue(true)
  api.devQrCancel.mockResolvedValue({ ok: true })
})

afterEach(() => {
  w?.unmount()
  w = null
  document.body.innerHTML = ''
})

describe('Devices view', () => {
  it('shows adb missing state', async () => {
    await mountWith({ adb: null, devices: [], autoConnect: true })
    const empty = w!.get('[data-dev-noadb]')
    expect(empty.text()).toContain(t('devices.empty.noAdb'))
    expect(empty.text()).toContain(t('devices.empty.openSettings'))
    expect(w!.find('[data-dev-row]').exists()).toBe(false)
  })

  it('connect button calls pair when a code is filled', async () => {
    api.devPair.mockResolvedValue({ ok: true, detail: 'paired' })
    await mountWith({ adb: '/adb', devices: [], autoConnect: true })
    await w!.get('[data-dev-address]').setValue('192.168.1.5:37000')
    await w!.get('[data-dev-pair-toggle]').trigger('click')
    await w!.get('[data-dev-code]').setValue('123456')
    await w!.get('[data-dev-connect]').trigger('click')
    await flushPromises()
    expect(api.devPair).toHaveBeenCalledWith('192.168.1.5:37000', '123456')
    expect(api.devConnect).not.toHaveBeenCalled()
    expect((w!.get('[data-dev-code]').element as HTMLInputElement).value).toBe('')
    expect(w!.text()).toContain(t('devices.connect.pairedHint'))
  })

  it('connect button calls connect without a code', async () => {
    api.devConnect.mockResolvedValue({ ok: true })
    await mountWith({ adb: '/adb', devices: [], autoConnect: true })
    await w!.get('[data-dev-address]').setValue('192.168.1.5:5555')
    await w!.get('[data-dev-connect]').trigger('click')
    await flushPromises()
    expect(api.devConnect).toHaveBeenCalledWith('192.168.1.5:5555')
    expect(api.devPair).not.toHaveBeenCalled()
  })

  it('row actions follow state', async () => {
    await mountWith({
      adb: '/adb',
      autoConnect: true,
      devices: [
        dev('R58M'),
        dev('192.168.1.7:5555', { transport: 'wifi' }),
        dev('192.168.1.9:5555', { transport: 'wifi', state: 'offline', online: false }),
      ],
    })
    expect(actions('R58M')).toContain('toWifi')
    expect(actions('R58M')).not.toContain('disconnect')
    expect(actions('192.168.1.7:5555')).toEqual(['disconnect'])
    expect(actions('192.168.1.9:5555')).toEqual(expect.arrayContaining(['reconnect', 'forget']))
    expect(actions('192.168.1.9:5555')).not.toContain('disconnect')
  })

  it('status shows icon and text', async () => {
    await mountWith({ adb: '/adb', autoConnect: true, devices: [dev('R58M', { state: 'unauthorized' })] })
    const status = row('R58M').get('[data-dev-status]')
    expect(status.text()).toContain(t('devices.state.unauthorized'))
    expect(status.find('svg').exists()).toBe(true)
    expect(row('R58M').text()).toContain(t('devices.state.unauthorizedHint'))
  })

  it('batch bar appears with selection', async () => {
    await mountWith({
      adb: '/adb',
      autoConnect: true,
      devices: [dev('192.168.1.7:5555', { transport: 'wifi' }), dev('192.168.1.9:5555', { transport: 'wifi', state: 'offline', online: false })],
    })
    expect(w!.find('[data-dev-batch]').exists()).toBe(false)
    await row('192.168.1.7:5555').trigger('click')
    const bar = w!.get('[data-dev-batch]')
    expect(useDevicesStore().selected.has('192.168.1.7:5555')).toBe(true)
    expect(bar.get('[data-dev-batch-action="disconnect"]').attributes('disabled')).toBeUndefined()
    expect(bar.get('[data-dev-batch-action="connect"]').attributes('disabled')).toBeDefined()
    expect(bar.get('[data-dev-batch-action="forget"]').attributes('disabled')).toBeDefined()
  })

  it('shows the error under the bar', async () => {
    api.devConnect.mockResolvedValue({ ok: false, error: 'connect-failed', detail: 'failed to connect' })
    await mountWith({ adb: '/adb', devices: [], autoConnect: true })
    await w!.get('[data-dev-address]').setValue('192.168.1.5:5555')
    await w!.get('[data-dev-connect]').trigger('click')
    await flushPromises()
    const err = w!.get('[data-dev-error]')
    expect(err.text()).toContain(t('devices.error.connect-failed'))
    expect(err.text()).toContain('failed to connect')
  })

  it('shows the empty hint without devices', async () => {
    await mountWith({ adb: '/adb', devices: [], autoConnect: true })
    expect(w!.get('[data-dev-empty]').text()).toContain(t('devices.empty.none'))
  })

  it('qr popover renders the code and cancels on close', async () => {
    api.devQrStart.mockResolvedValue({ id: 'q1', payload: 'WIFI:T:ADB;S:orrery-0a1b2c3d;P:123456;;' })
    await mountWith({ adb: '/adb', devices: [], autoConnect: true })
    await w!.get('[data-dev-qr]').trigger('click')
    await flushPromises()
    await new Promise((r) => setTimeout(r, 0))
    await flushPromises()
    expect(w!.find('[data-dev-qr-tile] svg').exists()).toBe(true)
    expect(w!.get('[data-dev-qr-status]').text()).toContain(t('devices.qr.waiting'))
    await w!.get('[data-dev-qr-cancel]').trigger('click')
    await flushPromises()
    expect(api.devQrCancel).toHaveBeenCalledWith('q1')
    expect(w!.find('[data-dev-qr-popover]').exists()).toBe(false)
  })

  it('closing the popover with Esc while start is pending cancels the session', async () => {
    let resolve!: (v: unknown) => void
    api.devQrStart.mockReturnValue(new Promise((r) => (resolve = r)))
    await mountWith({ adb: '/adb', devices: [], autoConnect: true })
    await w!.get('[data-dev-qr]').trigger('click')
    await w!.get('[data-dev-qr-popover]').trigger('keydown', { key: 'Escape' })
    expect(w!.find('[data-dev-qr-popover]').exists()).toBe(false)
    resolve({ id: 'q9', payload: 'WIFI:T:ADB;S:orrery-0a1b2c3d;P:123456;;' })
    await flushPromises()
    expect(api.devQrCancel).toHaveBeenCalledWith('q9')
    expect(useDevicesStore().qr).toBeNull()
  })

  it('holds the tracker while mounted', async () => {
    await mountWith({ adb: '/adb', devices: [], autoConnect: true })
    expect(api.devHold).toHaveBeenCalledWith(true)
    w!.unmount()
    w = null
    await flushPromises()
    expect(api.devHold).toHaveBeenCalledWith(false)
  })
})
