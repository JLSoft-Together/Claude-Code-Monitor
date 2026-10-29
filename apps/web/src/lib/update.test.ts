import { describe, expect, it } from 'vitest'
import type { UpdateState } from '@ccm/shared'
import { megabytes, progressPercent, updateAvailable } from './update'

const base: UpdateState = {
  current: '2.5.0',
  kind: 'nsis',
  canDownload: true,
  phase: 'available',
  release: { version: '2.6.0', name: '2.6.0', date: null, notes: '', url: 'https://github.com/x', asset: { name: 'a.exe', size: 10 } },
  checkedAt: 1,
  progress: null,
  error: null,
  autoCheck: true,
  skipped: null,
}

describe('update helpers', () => {
  it('shows the pill for an unskipped release or a running download', () => {
    expect(updateAvailable(base)).toBe(true)
    expect(updateAvailable({ ...base, skipped: '2.6.0' })).toBe(false)
    expect(updateAvailable({ ...base, skipped: '2.6.0', phase: 'ready' })).toBe(true)
    expect(updateAvailable({ ...base, phase: 'none', release: null })).toBe(false)
    expect(updateAvailable({ ...base, phase: 'error', error: 'offline' })).toBe(false)
    expect(updateAvailable({ ...base, phase: 'error', error: 'digest' })).toBe(true)
    expect(updateAvailable(null)).toBe(false)
  })

  it('formats progress', () => {
    expect(progressPercent({ ...base, progress: { received: 50, total: 200, bps: 0 } })).toBe(25)
    expect(progressPercent({ ...base, progress: { received: 5, total: 0, bps: 0 } })).toBe(0)
    expect(megabytes(1.5 * 1024 * 1024)).toBe('1.5')
    expect(megabytes(150 * 1024 * 1024)).toBe('150')
  })
})
