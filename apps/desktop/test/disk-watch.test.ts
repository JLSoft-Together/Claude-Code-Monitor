import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { diskLevel, diskRearmed, parseDiskAlert, type DiskAlertMessage, type DiskDrive, type DiskState } from '@ccm/shared'
import { DiskAlerts, DiskWatch, defaultMountOf, driveLabel } from '../src/disk/watch'

const GB = 1024 ** 3
let tmp: string
beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), 'ccm-disk-'))
})
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

const drive = (free: number, level = diskLevel(free * GB, 500 * GB, 10)): DiskDrive => ({ mount: 'C:\\', label: 'C:', freeBytes: free * GB, totalBytes: 500 * GB, level, places: ['claude'] })

describe('levels', () => {
  it('warns under the GB threshold or 5 %, danger under 2 GB, off at 0', () => {
    expect(diskLevel(50 * GB, 500 * GB, 10)).toBe('ok')
    expect(diskLevel(9 * GB, 500 * GB, 10)).toBe('warn')
    expect(diskLevel(40 * GB, 1000 * GB, 10)).toBe('warn')
    expect(diskLevel(1 * GB, 500 * GB, 10)).toBe('danger')
    expect(diskLevel(1 * GB, 500 * GB, 0)).toBe('ok')
    expect(diskRearmed(10.5 * GB, 100 * GB, 10)).toBe(false)
    expect(diskRearmed(11 * GB, 100 * GB, 10)).toBe(true)
  })
  it('parses alerts strictly', () => {
    expect(parseDiskAlert({ type: 'disk.alert', label: 'C:', level: 'warn', freeBytes: 1, totalBytes: 2 })).not.toBeNull()
    expect(parseDiskAlert({ type: 'disk.alert', label: 'C:', level: 'ok', freeBytes: 1, totalBytes: 2 })).toBeNull()
    expect(parseDiskAlert({ type: 'disk.alert', label: 'C:\n', level: 'warn', freeBytes: 1, totalBytes: 2 })).toBeNull()
  })
  it('labels Windows drives by letter', () => {
    expect(driveLabel('c:\\', 'win32')).toBe('C:')
    expect(driveLabel('/Volumes/X', 'darwin')).toBe('/Volumes/X')
  })
})

describe('DiskAlerts', () => {
  it('alerts once per crossing, again on danger, re-arms only above threshold + 1 GB', () => {
    const a = new DiskAlerts()
    expect(a.step([drive(9)], 10).map((m) => m.level)).toEqual(['warn'])
    expect(a.step([drive(8)], 10)).toEqual([])
    expect(a.step([drive(10.5)], 10)).toEqual([])
    expect(a.step([drive(9.5)], 10)).toEqual([])
    expect(a.step([drive(1.5)], 10).map((m) => m.level)).toEqual(['danger'])
    expect(a.step([drive(5)], 10)).toEqual([])
    expect(a.step([drive(30)], 10)).toEqual([])
    expect(a.step([drive(9)], 10).map((m) => m.level)).toEqual(['warn'])
  })
})

describe('DiskWatch', () => {
  it('groups places by mount, measures once per drive, saves the threshold', async () => {
    const states: DiskState[] = []
    const alerts: DiskAlertMessage[] = []
    let calls = 0
    const watch = new DiskWatch({
      file: path.join(tmp, 'disk.json'),
      places: () => [
        { place: 'claude', dir: 'C:\\Users\\x\\.claude' },
        { place: 'data', dir: 'C:\\data' },
        { place: 'project', dir: 'D:\\p' },
      ],
      mountOf: async (dir) => `${dir.slice(0, 2).toLowerCase()}\\`,
      statfs: async (m) => {
        calls++
        return m.startsWith('c') ? { free: 5 * GB, total: 500 * GB } : { free: 300 * GB, total: 500 * GB }
      },
      platform: 'win32',
      onState: (s) => states.push(s),
      onAlert: (m) => alerts.push(m),
    })
    const s = await watch.measure()
    expect(calls).toBe(2)
    expect(s.drives.map((d) => [d.label, d.level, d.places.join(',')])).toEqual([
      ['C:', 'warn', 'claude,data'],
      ['D:', 'ok', 'project'],
    ])
    expect(alerts.map((a) => a.label)).toEqual(['C:'])
    const off = await watch.setWarnGb(0)
    expect(off.drives.every((d) => d.level === 'ok')).toBe(true)
    expect(JSON.parse(readFileSync(path.join(tmp, 'disk.json'), 'utf8'))).toEqual({ warnGb: 0 })
    await watch.setWarnGb(20)
    expect(alerts.length).toBe(2)
    watch.stop()
  })

  it('finds the mount of a real folder', async () => {
    const m = await defaultMountOf(tmp)
    expect(m && tmp.toLowerCase().startsWith(m.toLowerCase().replace(/[\\/]+$/, ''))).toBe(true)
    expect(await defaultMountOf(path.join(tmp, 'missing'))).toBeNull()
  })
})
