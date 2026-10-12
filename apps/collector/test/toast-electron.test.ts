import { describe, expect, it } from 'vitest'
import { badgeCount, parseToastMessage, type ToastMessage } from '@ccm/shared'
import { electronToastDeps } from '../src/toast-electron'

describe('parseToastMessage', () => {
  it('accepts valid messages', () => {
    expect(parseToastMessage({ type: 'toast.show', tag: 'a', title: 'T', persistent: true })).toEqual({ type: 'toast.show', tag: 'a', title: 'T', persistent: true })
    expect(parseToastMessage({ type: 'toast.hide', tag: 'a' })).toEqual({ type: 'toast.hide', tag: 'a' })
  })
  it('rejects malformed messages', () => {
    expect(parseToastMessage(null)).toBeNull()
    expect(parseToastMessage({ type: 'toast.show', tag: 'a', title: 'T' })).toBeNull()
    expect(parseToastMessage({ type: 'toast.show', tag: 'a', title: 1, persistent: true })).toBeNull()
    expect(parseToastMessage({ type: 'toast.show', tag: '', title: 'T', persistent: true })).toBeNull()
    expect(parseToastMessage({ type: 'toast.hide', tag: 'x'.repeat(201) })).toBeNull()
    expect(parseToastMessage({ type: 'other', tag: 'a' })).toBeNull()
  })
})

describe('badgeCount', () => {
  it('counts persistent entries only', () => {
    expect(badgeCount([{ persistent: true }, { persistent: false }, { persistent: true }])).toBe(2)
  })
})

describe('electronToastDeps', () => {
  it('posts only the minimum', async () => {
    const sent: ToastMessage[] = []
    const deps = electronToastDeps((m) => sent.push(m), () => 42)
    expect(await deps.show({ tag: 't', title: 'Title', body: 'secret', url: 'http://x', open: 'o', dismiss: 'd', persistent: true })).toBe(true)
    expect(await deps.hide('t')).toBe(true)
    expect(sent).toEqual([
      { type: 'toast.show', tag: 't', title: 'Title', persistent: true },
      { type: 'toast.hide', tag: 't' },
    ])
    expect(deps.now()).toBe(42)
    expect(await deps.health?.()).toBe('ok')
  })
})
