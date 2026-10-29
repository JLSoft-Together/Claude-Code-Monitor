import { describe, expect, it } from 'vitest'
import { readReminder, toggleSection, TOKEN_REMINDER_KEY, writeLocal } from './backup'

const store = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init))
  return { setItem: (k: string, v: string) => void m.set(k, v), getItem: (k: string) => m.get(k) ?? null, m }
}

describe('backup page helpers', () => {
  it('writes ccm.* keys only, never the backup reminder', () => {
    const s = store()
    expect(writeLocal({ 'ccm.theme': 'dark', 'other': 'x', 'ccm.backup.tokenReminder': '["a"]' }, s)).toBe(1)
    expect([...s.m.keys()]).toEqual(['ccm.theme'])
  })

  it('reads the token reminder defensively', () => {
    expect(readReminder(store({ [TOKEN_REMINDER_KEY]: '["octo",5]' }))).toEqual(['octo'])
    expect(readReminder(store({ [TOKEN_REMINDER_KEY]: '{bad' }))).toEqual([])
    expect(readReminder(store())).toEqual([])
  })

  it('toggles a section', () => {
    expect(toggleSection(new Set(['notes']), 'notes')).toEqual(new Set())
    expect(toggleSection(new Set(['notes']), 'run')).toEqual(new Set(['notes', 'run']))
  })
})
