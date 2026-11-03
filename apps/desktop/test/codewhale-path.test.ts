import { describe, expect, it } from 'vitest'
import { codewhalePath } from '../src/pty/presets'

describe('codewhalePath', () => {
  const win = { Path: 'C:\\Windows\\System32;C:\\Users\\a\\AppData\\Roaming\\npm\\', APPDATA: 'C:\\Users\\a\\AppData\\Roaming', LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }

  it('appends existing install dirs missing from PATH, keeping the inherited key', () => {
    const out = codewhalePath(win, 'win32', 'C:\\Users\\a', () => true)
    expect(out).toEqual({ Path: `${win.Path};C:\\Users\\a\\AppData\\Local\\Microsoft\\WinGet\\Links` })
  })

  it('adds nothing when the dirs are already there or do not exist', () => {
    expect(codewhalePath(win, 'win32', 'C:\\Users\\a', () => false)).toEqual({})
    expect(codewhalePath({ PATH: '/usr/bin:/home/a/.local/bin' }, 'darwin', '/home/a', (d) => d === '/home/a/.local/bin')).toEqual({})
  })

  it('looks in the posix install locations', () => {
    expect(codewhalePath({ PATH: '/usr/bin' }, 'darwin', '/home/a', (d) => d === '/opt/homebrew/bin')).toEqual({ PATH: '/usr/bin:/opt/homebrew/bin' })
  })
})
