import { describe, expect, it } from 'vitest'
import { cellText, prefFromInput, prefInput, prefValid, samePref, schemaPrompt } from './appData'

describe('app data helpers', () => {
  it('builds a schema prompt without rows', () => {
    const text = schemaPrompt('com.app', 'app.db', { name: 'user', type: 'table', sql: 'CREATE TABLE user (id INTEGER)\n', rows: 12 })
    expect(text).toBe('SQLite table `user` in `app.db` of com.app:\n\n```sql\nCREATE TABLE user (id INTEGER)\n```\n')
  })

  it('shows cells', () => {
    expect(cellText(null)).toBe('NULL')
    expect(cellText({ blob: 4 })).toBe('BLOB · 4 B')
    expect(cellText(3.5)).toBe('3.5')
  })

  it('maps edit text to values and validates per type', () => {
    const set = { key: 's', type: 'set' as const, value: ['a', 'b'] }
    expect(prefInput(set)).toBe('a\nb')
    expect(prefFromInput(set, 'x\ny\n\n')).toEqual(['x', 'y'])
    expect(prefFromInput({ key: 'i', type: 'int', value: '1' }, ' 7 ')).toBe('7')
    expect(prefFromInput({ key: 't', type: 'string', value: '' }, ' keep ')).toBe(' keep ')
    expect(prefValid('int', '2147483647')).toBe(true)
    expect(prefValid('int', '2147483648')).toBe(false)
    expect(prefValid('long', '-9223372036854775808')).toBe(true)
    expect(prefValid('float', '1.')).toBe(true)
    expect(prefValid('float', 'abc')).toBe(false)
    expect(prefValid('boolean', 'True')).toBe(false)
    expect(prefValid('set', ['a'])).toBe(true)
    expect(samePref(['a'], ['a'])).toBe(true)
    expect(samePref('a', ['a'])).toBe(false)
  })
})
