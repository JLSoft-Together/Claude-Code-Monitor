import { describe, expect, it } from 'vitest'
import { countdown, projectChoices, projectLabel, suggestTopic, suggestTopics, topicText, topicUrl } from './telegram'

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

describe('suggestTopic', () => {
  const topics = [
    { threadId: 1, name: 'General chat' },
    { threadId: 2, name: 'Claude Code Monitor' },
    { threadId: 3, name: '🐞 shot-to-die bugs' },
  ]
  it('matches the project name loosely, exact first', () => {
    expect(suggestTopic(topics, 'Claude-Code-Monitor')?.threadId).toBe(2)
    expect(suggestTopic(topics, 'shot-to-die')?.threadId).toBe(3)
    expect(suggestTopic(topics, 'Đổi Tên')).toBeNull()
    expect(suggestTopic([{ threadId: 4, name: 'Đổi tên' }], 'doi-ten')?.threadId).toBe(4)
  })
  it('does not guess from very short names', () => {
    expect(suggestTopic(topics, 'ge')).toBeNull()
  })
})

describe('topicUrl', () => {
  it('links a supergroup topic and General', () => {
    expect(topicUrl('-1001234567', 42)).toBe('https://t.me/c/1234567/42')
    expect(topicUrl('-1001234567', null)).toBe('https://t.me/c/1234567/1')
  })
  it('has no link for a basic group', () => {
    expect(topicUrl('-4567', 2)).toBeNull()
  })
})

describe('suggestTopics', () => {
  it('gives each topic to one project only', () => {
    const topics = [
      { threadId: 2, name: 'app' },
      { threadId: 3, name: 'site' },
    ]
    const out = suggestTopics(['D:/a/app', 'E:/b/app', 'D:/site', 'D:/none'], topics, (p) => p.split('/').pop()!)
    expect(out.map((x) => [x.project, x.topic.threadId])).toEqual([
      ['D:/a/app', 2],
      ['D:/site', 3],
    ])
  })
})
