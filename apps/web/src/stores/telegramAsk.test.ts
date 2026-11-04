import { describe, expect, it } from 'vitest'
import { keyOf, keysReady } from '../composables/useTelegramInbound'

describe('Telegram option keys (WP-C)', () => {
  const since = '2026-11-05T10:00:00.000Z'
  const at = Date.parse(since)
  const asking = { status: 'waiting' as const, statusSince: since, waitingFor: 'input needed' }
  const permission = { status: 'waiting' as const, statusSince: since, waitingFor: 'permission prompt' }

  it('types the option number', () => {
    expect(keyOf({ key: 'option', option: 2 })).toBe('2')
    expect(keyOf({ key: 'approve' })).toBe('1')
    expect(keyOf({ key: 'deny' })).toBe('\x1b')
  })

  it('presses an option only while the pane waits on the question of that episode', () => {
    expect(keysReady({ key: 'option', option: 2, since: at }, asking, true)).toBe(true)
    expect(keysReady({ key: 'option', option: 2, since: at, tool: 'x' }, asking, true, 'AskUserQuestion')).toBe(true)
    expect(keysReady({ key: 'option', option: 2, since: at }, permission, true)).toBe(false)
    expect(keysReady({ key: 'option', option: 2, since: at }, { status: 'working', statusSince: since }, true)).toBe(false)
    expect(keysReady({ key: 'option', option: 2, since: at - 60_000 }, asking, true)).toBe(false)
    expect(keysReady({ key: 'option', option: 2, since: at }, asking, false)).toBe(false)
    expect(keysReady({ key: 'option', option: 2 }, undefined, true)).toBe(false)
  })

  it('does not let approve press a question', () => {
    expect(keysReady({ key: 'approve', since: at }, asking, true)).toBe(false)
  })
})
