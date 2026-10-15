import { beforeEach, describe, expect, it } from 'vitest'
import { FAVORITES_KEY, readFavorites, readRefsView, writeFavorites, writeRefsView } from './refPrefs'

const refs = { local: [{ ref: 'refs/heads/main' }, { ref: 'refs/heads/dev' }] } as never

describe('refPrefs', () => {
  beforeEach(() => localStorage.clear())
  it('defaults favorites to main / master that exist', () => {
    expect([...readFavorites('/r', refs)]).toEqual(['refs/heads/main'])
  })
  it('stores favorites per repo, an empty set included', () => {
    writeFavorites('/r', new Set())
    expect([...readFavorites('/r', refs)]).toEqual([])
    writeFavorites('/r', new Set(['refs/heads/dev']))
    expect([...readFavorites('/r', refs)]).toEqual(['refs/heads/dev'])
    expect(JSON.parse(localStorage.getItem(FAVORITES_KEY)!)).toHaveProperty(['/r'])
  })
  it('remembers the view options', () => {
    expect(readRefsView()).toEqual({ group: true, tags: true })
    writeRefsView({ group: false, tags: false })
    expect(readRefsView()).toEqual({ group: false, tags: false })
  })
})
