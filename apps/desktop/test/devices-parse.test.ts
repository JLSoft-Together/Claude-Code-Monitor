import { describe, expect, it } from 'vitest'
import {
  addressKey,
  isWifiId,
  parseAddress,
  parseAdbDeviceRows,
  parseConnect,
  parseDisconnect,
  parseMdnsServices,
  parsePair,
  parseWlanIp,
  transportOf,
} from '../src/devices/parse'

const DEVICES = [
  'List of devices attached',
  'R58M123ABC             device usb:1-1 product:beyond1qltexx model:SM_G973F device:beyond1q transport_id:3',
  '192.168.1.5:5555       device product:sunfish model:Pixel_4a device:sunfish transport_id:4',
  'adb-R58M123ABC-AbCdEf._adb-tls-connect._tcp device product:panther model:Pixel_7 device:panther transport_id:5',
  'emulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:1',
  '0123456789ABCDEF       unauthorized usb:1-2 transport_id:6',
  '192.168.1.9:5555       offline transport_id:7',
  'ZY22ABC                no permissions (missing udev rules? user is in the plugdev group); see [http://developer.android.com/tools/device.html] usb:1-3 transport_id:8',
  'XYZ                    recovery usb:1-4 transport_id:9',
  'QWE                    weird-state transport_id:10',
  '',
].join('\n')

describe('parseAdbDeviceRows', () => {
  it('parses every state with key:value fields', () => {
    const rows = parseAdbDeviceRows(DEVICES)
    expect(rows).toHaveLength(9)
    expect(rows[0]).toEqual({
      id: 'R58M123ABC',
      state: 'ready',
      model: 'SM G973F',
      product: 'beyond1qltexx',
      device: 'beyond1q',
      transportId: '3',
      usb: '1-1',
    })
    expect(rows[1]!.usb).toBeNull()
    expect(rows[1]!.model).toBe('Pixel 4a')
    expect(rows[6]!.state).toBe('no-permissions')
    expect(rows[6]!.usb).toBe('1-3')
    expect(rows[7]!.state).toBe('recovery')
    expect(rows[8]!.state).toBe('unknown')
  })

  it('detects transport', () => {
    const rows = parseAdbDeviceRows(DEVICES)
    expect(rows.slice(0, 5).map(transportOf)).toEqual(['usb', 'wifi', 'wifi', 'emulator', 'usb'])
    expect(isWifiId('192.168.1.9:5555')).toBe(true)
    expect(isWifiId('adb-X._adb-tls-connect._tcp')).toBe(true)
    expect(isWifiId('R58M123ABC')).toBe(false)
  })
})

describe('parseMdnsServices', () => {
  it('parses mdns services', () => {
    const out = [
      'List of discovered mdns services',
      'adb-R58M123ABC-AbCdEf\t_adb-tls-connect._tcp\t192.168.1.5:37123',
      'orrery-1a2b3c4d\t_adb-tls-pairing._tcp.\t192.168.1.5:40211',
      'garbage line',
      'adb-ZZZ\t_adb._tcp\t192.168.1.20:5555',
    ].join('\n')
    expect(parseMdnsServices(out)).toEqual([
      { name: 'adb-R58M123ABC-AbCdEf', kind: 'connect', host: '192.168.1.5', port: 37123 },
      { name: 'orrery-1a2b3c4d', kind: 'pairing', host: '192.168.1.5', port: 40211 },
      { name: 'adb-ZZZ', kind: 'legacy', host: '192.168.1.20', port: 5555 },
    ])
  })
})

describe('adb command output', () => {
  it('parses connect output', () => {
    expect(parseConnect('connected to 192.168.1.5:5555')).toEqual({ ok: true })
    expect(parseConnect('already connected to 192.168.1.5:5555')).toEqual({ ok: true })
    for (const line of [
      "failed to connect to '192.168.1.5:5555': Connection refused",
      'cannot connect to 192.168.1.5:5555: No connection could be made because the target machine actively refused it. (10061)',
      'failed to authenticate to 192.168.1.5:5555',
    ]) {
      expect(parseConnect(line + '\n')).toEqual({ ok: false, error: 'connect-failed', detail: line })
    }
    expect(parseConnect('')).toMatchObject({ ok: false, error: 'connect-failed' })
  })

  it('parses pair output', () => {
    expect(parsePair('Successfully paired to 192.168.1.5:40211 [guid=adb-R58M123ABC-AbCdEf]')).toEqual({ ok: true })
    expect(parsePair('Failed: Wrong password or connection was dropped.')).toEqual({
      ok: false,
      error: 'pair-failed',
      detail: 'Failed: Wrong password or connection was dropped.',
    })
  })

  it('parses disconnect output', () => {
    expect(parseDisconnect('disconnected 192.168.1.5:5555')).toEqual({ ok: true })
    expect(parseDisconnect("error: no such device '192.168.1.5:5555'")).toMatchObject({ ok: false, error: 'not-connected' })
  })

  it('parses wlan ip', () => {
    expect(parseWlanIp('    inet 192.168.1.5/24 brd 192.168.1.255 scope global wlan0')).toBe('192.168.1.5')
    expect(parseWlanIp('')).toBeNull()
  })
})

describe('parseAddress', () => {
  it('parses addresses', () => {
    expect(parseAddress('192.168.1.5')).toEqual({ target: '192.168.1.5:5555', host: '192.168.1.5', port: 5555 })
    expect(parseAddress('192.168.1.5:37123')).toMatchObject({ target: '192.168.1.5:37123', port: 37123 })
    expect(parseAddress('[fe80::1]:5555')).toMatchObject({ target: '[fe80::1]:5555' })
    const id = 'adb-R58M123ABC-AbCdEf._adb-tls-connect._tcp'
    expect(parseAddress(id)).toEqual({ target: id, host: null, port: null })
    expect(parseAddress('phone.local:5555')).not.toBeNull()
    for (const bad of ['', '-s x', '1.2.3.4:0', '1.2.3.4:65536', 'a b', '1.2.3.4;calc']) expect(parseAddress(bad)).toBeNull()
  })

  it('builds a case-insensitive address key', () => {
    expect(addressKey('[FE80::1]', 5555)).toBe('fe80::1:5555')
  })
})
