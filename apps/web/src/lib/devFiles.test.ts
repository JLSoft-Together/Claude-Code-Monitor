import { describe, expect, it } from 'vitest'
import { crumbs, fmtBytes, joinPath, parentOf, progressPct, transferId, validName } from './devFiles'

describe('devFiles', () => {
  it('builds breadcrumbs and parents inside the scope root', () => {
    expect(crumbs('/sdcard', '/sdcard/Download/a b')).toEqual([
      { label: '/sdcard', path: '/sdcard' },
      { label: 'Download', path: '/sdcard/Download' },
      { label: 'a b', path: '/sdcard/Download/a b' },
    ])
    expect(crumbs('/', '/files/x').map((c) => c.path)).toEqual(['/', '/files', '/files/x'])
    expect(crumbs('/sdcard', '/data/local/tmp')).toEqual([{ label: '/sdcard', path: '/sdcard' }])
    expect(parentOf('/sdcard', '/sdcard/Download')).toBe('/sdcard')
    expect(parentOf('/sdcard', '/sdcard')).toBeNull()
    expect(parentOf('/', '/files')).toBe('/')
    expect(joinPath('/', 'a')).toBe('/a')
  })

  it('validates names, formats sizes and progress, makes transfer ids', () => {
    expect(validName('new folder')).toBe(true)
    expect(validName('a/b')).toBe(false)
    expect(validName('..')).toBe(false)
    expect(fmtBytes(1536)).toBe('1.5 KB')
    expect(fmtBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(progressPct({ done: 50, total: 200 })).toBe(25)
    expect(progressPct({ done: 50, total: null })).toBeNull()
    expect(transferId()).toMatch(/^[0-9a-f]{16}$/)
  })
})
