import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultDataDir } from '../src/datadir'

type DataDirFn = typeof defaultDataDir

// The bridge runs standalone (copied next to the user's data), so it cannot import datadir.ts; compare the copies instead.
function bridgeDataDir(): DataDirFn {
  const source = readFileSync(path.resolve(__dirname, '../../../scripts/statusline-bridge.mjs'), 'utf8')
  const fn = /^function defaultDataDir\(env, platform, home\) \{[\s\S]*?^\}/m.exec(source)?.[0]
  if (!fn) throw new Error('defaultDataDir not found in statusline-bridge.mjs')
  return new Function('path', `${fn}\nreturn defaultDataDir`)(path) as DataDirFn
}

const cases: [string, NodeJS.ProcessEnv, NodeJS.Platform, string, string][] = [
  ['win LOCALAPPDATA', { LOCALAPPDATA: 'C:\\Users\\a\\AppData\\Local' }, 'win32', 'C:\\Users\\a', 'C:\\Users\\a\\AppData\\Local\\ccm'],
  ['win fallback', {}, 'win32', 'C:\\Users\\a', 'C:\\Users\\a\\AppData\\Local\\ccm'],
  ['mac', { XDG_DATA_HOME: '/x' }, 'darwin', '/Users/a', '/Users/a/Library/Application Support/ccm'],
  ['linux XDG', { XDG_DATA_HOME: '/data' }, 'linux', '/home/a', '/data/ccm'],
  ['linux fallback', {}, 'linux', '/home/a', '/home/a/.local/share/ccm'],
]

describe('defaultDataDir', () => {
  const bridge = bridgeDataDir()

  it.each(cases)('%s', (_name, env, platform, home, expected) => {
    expect(defaultDataDir(env, platform, home)).toBe(expected)
    expect(bridge(env, platform, home)).toBe(expected)
  })
})
