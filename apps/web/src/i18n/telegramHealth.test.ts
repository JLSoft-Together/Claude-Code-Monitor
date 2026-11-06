import { describe, expect, it } from 'vitest'
import { i18n } from '.'

const CODES = ['network', 'status', 'timeout', 'rate', 'keychain', 'config', 'token', 'chat', 'too-large', 'conflict']

describe('Telegram topic health strings', () => {
  it.each(['en', 'vi'] as const)('has a short label for every send error code in %s', (locale) => {
    const t = (k: string, p?: Record<string, unknown>) => i18n.global.t(k, p ?? {}, { locale })
    for (const code of CODES) {
      const text = t(`telegram.topicMap.errors.${code}`)
      expect(text, code).not.toBe(`telegram.topicMap.errors.${code}`)
      expect(text.length).toBeLessThan(60)
    }
    expect(t('telegram.topicMap.lastError', { error: 'X' })).toContain('X')
    expect(t('telegram.topicMap.sentAgo', { when: 'W' })).toContain('W')
  })
})
