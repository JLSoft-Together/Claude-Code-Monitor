import { beforeEach, describe, expect, it } from 'vitest'
import { DIFF_OPTS_KEY, readDiffOpts } from './diffOpts'

describe('readDiffOpts highlight', () => {
  beforeEach(() => localStorage.clear())
  it('defaults to words', () => expect(readDiffOpts().highlight).toBe('words'))
  it('migrates the old words:false to lines', () => {
    localStorage.setItem(DIFF_OPTS_KEY, JSON.stringify({ words: false }))
    expect(readDiffOpts().highlight).toBe('lines')
  })
  it('keeps a stored level and rejects junk', () => {
    localStorage.setItem(DIFF_OPTS_KEY, JSON.stringify({ highlight: 'chars' }))
    expect(readDiffOpts().highlight).toBe('chars')
    localStorage.setItem(DIFF_OPTS_KEY, JSON.stringify({ highlight: 'bytes' }))
    expect(readDiffOpts().highlight).toBe('words')
  })
})
