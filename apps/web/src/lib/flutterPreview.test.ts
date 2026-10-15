import { describe, expect, it } from 'vitest'
import type { FwpEntry, RunConfig, RunDevice } from '@ccm/shared'
import { flavorsFrom, groupEntries, inFlutterProject, isDartFile, mobileDevices, relativeTo } from './flutterPreview'

const dev = (id: string, platform: string, state: RunDevice['state'] = 'ready'): RunDevice => ({ id, name: id, platform, emulator: false, state, source: 'flutter' })
const entry = (file: string, symbol: string): FwpEntry => ({ id: `${file}#${symbol}`, file, line: 1, symbol, label: symbol, call: `${symbol}()` })

describe('flutter preview helpers', () => {
  it('keeps ready Android / iOS devices only', () => {
    const list = [dev('a', 'android-arm64'), dev('i', 'ios'), dev('w', 'web-javascript'), dev('d', 'windows-x64'), dev('off', 'android-x64', 'offline')]
    expect(mobileDevices(list).map((d) => d.id)).toEqual(['a', 'i'])
  })

  it('relativeTo handles separators and Windows case', () => {
    expect(relativeTo('C:\\Proj', 'c:\\proj\\lib\\a.dart')).toBe('lib/a.dart')
    expect(relativeTo('/p/app', '/p/app/lib/x.dart')).toBe('lib/x.dart')
    expect(relativeTo('/p/app', '/p/application/lib/x.dart')).toBeNull()
    expect(relativeTo('/p/app', '/p/app')).toBeNull()
  })

  it('groups this file first', () => {
    const g = groupEntries([entry('lib/a.dart', 'x'), entry('lib/b.dart', 'y'), entry('lib/a.dart', 'z')], 'lib/a.dart')
    expect(g.here.map((e) => e.symbol)).toEqual(['x', 'z'])
    expect(g.other.map((e) => e.symbol)).toEqual(['y'])
    expect(groupEntries([entry('lib/a.dart', 'x')], null).other).toHaveLength(1)
  })

  it('collects flavors from Flutter run configs', () => {
    const cfg = (flavor: string, type: RunConfig['type'] = 'flutter') => ({ type, flavor }) as unknown as RunConfig
    expect(flavorsFrom([cfg('prod'), cfg('dev'), cfg(''), cfg('dev'), cfg('x', 'android')])).toEqual(['dev', 'prod'])
  })

  it('detects dart files', () => {
    expect(isDartFile('/a/b.dart')).toBe(true)
    expect(isDartFile('/a/b.dart.bak')).toBe(false)
  })
})

describe('inFlutterProject', () => {
  it('probes once per folder, does not cache failures', async () => {
    const calls: string[] = []
    const probe = async (f: string) => {
      calls.push(f)
      return f.includes('fail') ? null : { flutter: f.startsWith('/app') }
    }
    expect(await inFlutterProject('/app/lib/a.dart', probe)).toBe(true)
    expect(await inFlutterProject('/app/lib/b.dart', probe)).toBe(true)
    expect(await inFlutterProject('/other/x.dart', probe)).toBe(false)
    expect(await inFlutterProject('/fail/x.dart', probe)).toBe(false)
    expect(await inFlutterProject('/fail/y.dart', probe)).toBe(false)
    expect(calls).toEqual(['/app/lib/a.dart', '/other/x.dart', '/fail/x.dart', '/fail/y.dart'])
  })
})
