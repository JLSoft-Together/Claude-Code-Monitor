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
  it('keeps the split / none levels, Ignore imports and the split view toggles', () => {
    expect(readDiffOpts()).toMatchObject({ align: false, sync: true })
    localStorage.setItem(DIFF_OPTS_KEY, JSON.stringify({ highlight: 'none', whitespace: 'imports', align: true, sync: false }))
    expect(readDiffOpts()).toMatchObject({ highlight: 'none', whitespace: 'imports', align: true, sync: false })
    localStorage.setItem(DIFF_OPTS_KEY, JSON.stringify({ highlight: 'split', align: 'yes' }))
    expect(readDiffOpts()).toMatchObject({ highlight: 'split', align: false })
  })
})
