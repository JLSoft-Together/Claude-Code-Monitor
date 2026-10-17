import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { removeDeadShortcuts, type ShortcutDeps, type ShortcutInfo } from '../src/shortcuts'

const DIR = path.join('C:', 'Start Menu', 'Programs')
const APP_ID = 'dev.ccm.monitor'

function deps(links: Record<string, ShortcutInfo | null>, existing: string[]): ShortcutDeps & { removed: string[] } {
  const removed: string[] = []
  return {
    removed,
    list: () => Object.keys(links),
    read: (file) => links[path.basename(file)] ?? null,
    exists: (file) => existing.includes(file),
    remove: (file) => removed.push(file),
  }
}

describe('removeDeadShortcuts', () => {
  it('removes a shortcut with the app id whose exe is gone', () => {
    const d = deps({ 'Claude Code Monitor.lnk': { target: 'C:/Temp/x/Claude Code Monitor.exe', appUserModelId: APP_ID } }, [])
    expect(removeDeadShortcuts(DIR, APP_ID, d)).toEqual([path.join(DIR, 'Claude Code Monitor.lnk')])
    expect(d.removed).toEqual([path.join(DIR, 'Claude Code Monitor.lnk')])
  })

  it('keeps live shortcuts, other apps and files that are not shortcuts', () => {
    const d = deps(
      {
        'Orrery.lnk': { target: 'C:/Apps/Orrery.exe', appUserModelId: APP_ID },
        'Other.lnk': { target: 'C:/gone.exe', appUserModelId: 'com.other' },
        'NoId.lnk': { target: 'C:/gone.exe' },
        'Empty.lnk': { target: '', appUserModelId: APP_ID },
        'Broken.lnk': null,
        'readme.txt': { target: 'C:/gone.exe', appUserModelId: APP_ID },
      },
      ['C:/Apps/Orrery.exe'],
    )
    expect(removeDeadShortcuts(DIR, APP_ID, d)).toEqual([])
    expect(d.removed).toEqual([])
  })

  it('skips shortcuts it cannot read or delete and a missing folder', () => {
    const d = deps({ 'A.lnk': { target: 'C:/gone.exe', appUserModelId: APP_ID }, 'B.LNK': { target: 'C:/gone2.exe', appUserModelId: APP_ID } }, [])
    d.remove = (file) => {
      if (file.endsWith('A.lnk')) throw new Error('EPERM')
    }
    expect(removeDeadShortcuts(DIR, APP_ID, d)).toEqual([path.join(DIR, 'B.LNK')])
    d.list = () => {
      throw new Error('ENOENT')
    }
    expect(removeDeadShortcuts(DIR, APP_ID, d)).toEqual([])
  })
})
