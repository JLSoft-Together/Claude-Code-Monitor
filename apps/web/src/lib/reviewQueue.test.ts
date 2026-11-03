import { beforeEach, describe, expect, it } from 'vitest'
import { changeSignature, markAllSeen, markSeen, readSeen, setUnseenCount, splitUnseen, unseenCountOf } from './reviewQueue'
import type { ChangeEntry } from './preview'

const entry = (path: string, over: Partial<ChangeEntry> = {}): ChangeEntry => ({ path, x: '.', y: 'M', kind: 'modified', staged: false, added: 1, removed: 0, ...over })

function memoryStorage(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  }
}

describe('reviewQueue', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', { value: memoryStorage(), configurable: true })
  })

  it('treats every file as unseen before the first mark', () => {
    const { unseen, rest } = splitUnseen([entry('a.ts'), entry('b.ts')], readSeen('C:/app'))
    expect(unseen).toHaveLength(2)
    expect(rest).toHaveLength(0)
  })

  it('marks all seen, then flags only files whose signature moved', () => {
    const files = [entry('a.ts'), entry('b.ts')]
    markAllSeen('C:/app', files)
    const next = [entry('a.ts'), entry('b.ts', { added: 5 }), entry('c.ts', { kind: 'untracked', x: '?', y: '?' })]
    const { unseen } = splitUnseen(next, readSeen('C:\\app\\'))
    expect(unseen.map((e) => e.path)).toEqual(['b.ts', 'c.ts'])
  })

  it('marks one file seen without touching the others and forgets files that left the list', () => {
    markAllSeen('C:/app', [entry('a.ts'), entry('gone.ts')])
    markSeen('C:/app', entry('b.ts'))
    expect(Object.keys(readSeen('C:/app')).sort()).toEqual(['a.ts', 'b.ts', 'gone.ts'])
    markAllSeen('C:/app', [entry('a.ts')])
    expect(Object.keys(readSeen('C:/app'))).toEqual(['a.ts'])
  })

  it('never counts conflicts as unseen', () => {
    const { unseen, rest } = splitUnseen([entry('x.ts', { kind: 'conflict' })], {})
    expect(unseen).toHaveLength(0)
    expect(rest).toHaveLength(1)
  })

  it('keeps projects apart and survives broken storage', () => {
    markAllSeen('C:/one', [entry('a.ts')])
    expect(readSeen('C:/two')).toEqual({})
    localStorage.setItem('ccm.review.seen.v1', '{not json')
    expect(readSeen('C:/one')).toEqual({})
  })

  it('works when storage throws', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => {
          throw new Error('blocked')
        },
        setItem: () => {
          throw new Error('blocked')
        },
      },
      configurable: true,
    })
    expect(() => markAllSeen('C:/app', [entry('a.ts')])).not.toThrow()
    expect(readSeen('C:/app')).toEqual({})
  })

  it('reports unseen counts per root', () => {
    setUnseenCount('C:/app', 3)
    expect(unseenCountOf('c:\\app')).toBe(3)
    expect(changeSignature(entry('a.ts'))).toBe('modified:.M:1:0')
  })
})
