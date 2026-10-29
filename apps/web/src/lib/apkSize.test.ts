import { describe, expect, it } from 'vitest'
import type { ApkGroup } from '@ccm/shared'
import { barSegments, deltaClass, deltaOf, fmtDelta, fmtSize, isApkPath } from './apkSize'
import { explorerMenu } from './explorer/contextMenu'
import type { TreeRow } from './explorer/tree'

const g = (id: string, compressed: number, size: number): ApkGroup => ({ id, kind: id as ApkGroup['kind'], sub: null, compressed, size, files: 1 })

describe('apk size helpers', () => {
  it('builds bar segments by the chosen size and drops empty groups', () => {
    const s = barSegments([g('dex', 30, 60), g('res', 10, 0), g('assets', 0, 40)], 'compressed')
    expect(s.map((x) => [x.id, x.pct])).toEqual([['dex', 75], ['res', 25]])
    expect(barSegments([g('dex', 30, 60), g('assets', 0, 40)], 'size').map((x) => x.id)).toEqual(['dex', 'assets'])
    expect(barSegments([], 'size')).toEqual([])
  })

  it('formats sizes and signed deltas', () => {
    expect(fmtSize(512, 'en')).toBe('512 B')
    expect(fmtSize(1536, 'en')).toBe('1.5 KB')
    expect(fmtSize(3 * 1024 * 1024, 'en')).toBe('3 MB')
    expect(fmtDelta(2048, 'en')).toBe('+2 KB')
    expect(fmtDelta(-100, 'en')).toBe('−100 B')
    expect(fmtDelta(0, 'en')).toBe('0 B')
  })

  it('computes deltas with missing sides and tones growth', () => {
    expect(deltaOf({ before: null, after: { compressed: 5, size: 9 } }, 'size')).toBe(9)
    expect(deltaOf({ before: { compressed: 5, size: 9 }, after: null }, 'compressed')).toBe(-5)
    expect(deltaClass(1)).toBe('text-diff-del')
    expect(deltaClass(-1)).toBe('text-diff-add')
    expect(deltaClass(0)).toBe('text-ink-faint')
    expect(isApkPath('/a/app-release.APK')).toBe(true)
    expect(isApkPath('/a/app.zip')).toBe(false)
  })

  it('offers Analyze size on .apk / .aab rows only', () => {
    const row = (name: string, directory = false): TreeRow => ({ name, path: `/p/${name}`, directory, depth: 1, outOfRoot: false }) as TreeRow
    const ids = (r: TreeRow, apk: boolean) => explorerMenu(r, { mac: false, repo: false, changed: false, apk }, (k) => k).flatMap((e) => ('id' in e ? [e.id] : []))
    expect(ids(row('app.aab'), true)).toContain('apk-size')
    expect(ids(row('app.apk'), false)).not.toContain('apk-size')
    expect(ids(row('notes.txt'), true)).not.toContain('apk-size')
    expect(ids(row('out.apk', true), true)).not.toContain('apk-size')
  })
})
