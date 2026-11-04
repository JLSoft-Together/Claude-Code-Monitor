import { describe, expect, it } from 'vitest'
import { countdown, projectChoices, projectLabel, topicText } from './telegram'

describe('telegram helpers', () => {
  it('labels a project by its folder name', () => {
    expect(projectLabel('D:\\work\\app\\')).toBe('app')
    expect(projectLabel('/home/me/site')).toBe('site')
  })

  it('lists distinct project folders without routed ones', () => {
    const out = projectChoices(['D:\\w\\b', 'd:\\w\\B\\', undefined, '', 'D:\\w\\a', 'D:\\w\\c'], ['D:\\W\\C'])
    expect(out).toEqual(['D:\\w\\a', 'D:\\w\\b'])
  })

  it('shows General for a route without a thread', () => {
    expect(topicText({ chatId: '-1001234567', threadId: null }, 'General')).toBe('-1001234567 · General')
    expect(topicText({ chatId: '-1001234567', threadId: 42 }, 'General')).toBe('-1001234567 · #42')
  })

  it('counts the pair code down to zero', () => {
    expect(countdown(null, 0)).toBeNull()
    expect(countdown(125_000, 0)).toBe('2:05')
    expect(countdown(1_000, 5_000)).toBe('0:00')
  })
})
