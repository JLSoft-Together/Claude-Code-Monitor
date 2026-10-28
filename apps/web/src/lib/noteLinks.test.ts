import { describe, expect, it } from 'vitest'
import { linkNoteTokens, notePathIn, noteTokens } from './noteLinks'

describe('noteLinks', () => {
  it('finds @path and @path:line tokens', () => {
    expect(noteTokens('see @src/a.ts:12 and @README.md.')).toEqual([
      { start: 4, end: 16, path: 'src/a.ts', line: 12 },
      { start: 21, end: 31, path: 'README.md', line: undefined },
    ])
    expect(noteTokens('@C:\\w\\x.kt:3:7')[0]).toMatchObject({ path: 'C:\\w\\x.kt', line: 3 })
  })

  it('skips mail addresses, mentions and bare dots', () => {
    expect(noteTokens('mail me@host.dev')).toEqual([])
    expect(noteTokens('ping @alice about it')).toEqual([])
    expect(noteTokens('@.. @/')).toEqual([])
  })

  it('resolves relative paths against the project root', () => {
    expect(notePathIn('C:\\p', 'src/a.ts')).toBe('C:\\p\\src\\a.ts')
    expect(notePathIn('/p', '/abs/x.ts')).toBe('/abs/x.ts')
  })

  it('links tokens in rendered text but not inside code', () => {
    const el = document.createElement('div')
    el.innerHTML = '<p>fix @src/a.ts:3 now</p><p><code>@src/b.ts</code></p>'
    linkNoteTokens(el)
    const links = el.querySelectorAll('a')
    expect(links).toHaveLength(1)
    expect(links[0]!.dataset).toMatchObject({ notePath: 'src/a.ts', noteLine: '3' })
    expect(el.querySelector('p')!.textContent).toBe('fix @src/a.ts:3 now')
  })
})
