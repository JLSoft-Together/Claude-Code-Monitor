import { describe, expect, it } from 'vitest'
import { ntfySubscribeLink, randomTopic, validTopic } from './phoneSetup'

describe('phoneSetup', () => {
  it('random topic is orrery- + 16 lowercase letters / digits and passes topic validation', () => {
    for (let i = 0; i < 50; i++) {
      const t = randomTopic()
      expect(t).toMatch(/^orrery-[a-z0-9]{16}$/)
      expect(validTopic(t)).toBe(true)
    }
  })

  it('drops biased bytes', () => {
    let calls = 0
    const t = randomTopic((b) => b.fill(calls++ === 0 ? 255 : 37))
    expect(t).toBe('orrery-' + 'b'.repeat(16))
  })

  it('builds the ntfy deep link', () => {
    expect(ntfySubscribeLink('', 'orrery-abc')).toBe('ntfy://ntfy.sh/orrery-abc')
    expect(ntfySubscribeLink('https://ntfy.example.org/base/', 'x_1')).toBe('ntfy://ntfy.example.org/base/x_1')
    expect(ntfySubscribeLink('http://10.0.0.2:8080', 't')).toBe('ntfy://10.0.0.2:8080/t?secure=false')
    expect(ntfySubscribeLink('', 'bad topic')).toBeNull()
    expect(ntfySubscribeLink('ftp://x', 't')).toBeNull()
    expect(ntfySubscribeLink('not a url', 't')).toBeNull()
  })
})
