import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PhoneEpisodeMessage } from '@ccm/shared'
import { PhoneNotifier, PHONE_MAX_PER_HOUR, type PhoneFetch } from '../src/phone/notifier'
import { buildRequest, cleanDiscordUrl, cleanNtfyServer, cleanTopic, e2eOverride, phoneText, RateLimiter } from '../src/phone/send'

const crypt = {
  available: () => true,
  encrypt: (s: string) => Buffer.from(`sealed:${s}`),
  decrypt: (b: Buffer) => b.toString().replace(/^sealed:/, ''),
}

const episode = (patch: Partial<PhoneEpisodeMessage> = {}): PhoneEpisodeMessage => ({ type: 'phone', episode: 'w:t1|a', reason: 'permission', name: 'shop', tool: 'Bash', since: 0, ...patch })

describe('payload', () => {
  it('carries only name, reason, tool and minutes, masked', () => {
    const msg = phoneText(episode({ name: 'C:\\Users\\me\\proj token=abcdef123456' }), 'en', 5 * 60_000, 'C:\\Users\\me', 'win32')
    expect(msg.title).toBe('Orrery · ~\\proj token=[masked]')
    expect(msg.body).toBe('Needs approval: Bash (5 min)')
    expect(phoneText(episode({ reason: 'done', since: 0 }), 'vi', 12 * 60_000, '', 'linux').body).toBe('Đã xong sau 12 phút làm việc')
  })

  it('builds ntfy JSON and Discord requests', () => {
    const text = { title: 'T', body: 'B' }
    const ntfy = buildRequest({ channel: 'ntfy', url: 'https://ntfy.sh', topic: 'abc' }, text)
    expect(ntfy.url).toBe('https://ntfy.sh')
    expect(JSON.parse(ntfy.init.body)).toEqual({ topic: 'abc', title: 'T', message: 'B', tags: ['robot'] })
    const discord = buildRequest({ channel: 'discord', url: 'https://discord.com/api/webhooks/1/x' }, text, 'http://127.0.0.1:9/hook')
    expect(discord.url).toBe('http://127.0.0.1:9/hook')
    expect(JSON.parse(discord.init.body).allowed_mentions).toEqual({ parse: [] })
  })

  it('validates destinations', () => {
    expect(cleanNtfyServer('https://ntfy.sh/')).toBe('https://ntfy.sh')
    expect(cleanNtfyServer('https://u:p@ntfy.sh')).toBeNull()
    expect(cleanNtfyServer('file:///x')).toBeNull()
    expect(cleanTopic('my_topic-1')).toBe('my_topic-1')
    expect(cleanTopic('a/b')).toBeNull()
    expect(cleanDiscordUrl('https://discord.com/api/webhooks/123/abc_DEF')).toBe('https://discord.com/api/webhooks/123/abc_DEF')
    expect(cleanDiscordUrl('https://evil.com/api/webhooks/123/abc')).toBeNull()
    expect(e2eOverride('http://127.0.0.1:5000/x')).toBe('http://127.0.0.1:5000/x')
    expect(e2eOverride('https://example.com')).toBeNull()
    expect(e2eOverride(undefined)).toBeNull()
  })

  it('rate limiter keeps a sliding hour', () => {
    let now = 0
    const lim = new RateLimiter(2, 60_000, () => now)
    expect([lim.take(), lim.take(), lim.take()]).toEqual([true, true, false])
    now = 60_000
    expect(lim.take()).toBe(true)
  })
})

describe('PhoneNotifier', () => {
  const make = (idle = 600, fetch?: PhoneFetch) => {
    const calls: { url: string; body: string }[] = []
    const failures: string[] = []
    const file = path.join(mkdtempSync(path.join(os.tmpdir(), 'phone-')), 'phone.json')
    const n = new PhoneNotifier({
      file,
      crypt,
      fetch:
        fetch ??
        (async (url, init) => {
          calls.push({ url, body: init.body })
          return { ok: true }
        }),
      idleSeconds: () => idle,
      locale: () => 'en',
      home: '',
      platform: 'linux',
      now: () => 0,
      onFailure: (e) => failures.push(e),
    })
    return { n, calls, failures, file }
  }

  it('is off by default and keeps secrets sealed and away from the page', async () => {
    const { n, calls, file } = make()
    expect(n.state()).toMatchObject({ enabled: false, configured: false })
    expect(await n.handle(episode())).toBe(false)
    const res = n.set({ enabled: true, ntfyServer: 'https://ntfy.example.org', ntfyTopic: 'secret-topic' })
    expect(res).toMatchObject({ ok: true, state: { configured: true, host: 'ntfy.example.org' } })
    expect(JSON.stringify(res)).not.toContain('secret-topic')
    expect(readFileSync(file, 'utf8')).not.toContain('secret-topic')
    expect(await n.handle(episode())).toBe(true)
    expect(await n.handle(episode())).toBe(false)
    expect(calls).toHaveLength(1)
    expect(n.set({ ntfyTopic: 'bad/topic' })).toEqual({ ok: false, error: 'invalid-topic' })
  })

  it('waits for system idle and caps sends per hour', async () => {
    const { n, calls } = make(60)
    n.set({ enabled: true, channel: 'discord', discordUrl: 'https://discord.com/api/webhooks/1/x', idleMinutes: 5 })
    expect(await n.handle(episode())).toBe(false)
    n.set({ idleMinutes: 0 })
    for (let i = 0; i < PHONE_MAX_PER_HOUR + 3; i++) await n.handle(episode({ episode: `e${i}` }))
    expect(calls).toHaveLength(PHONE_MAX_PER_HOUR)
    expect(n.state().lastError).toBe('rate')
  })

  it('reports a failure once until a send works again', async () => {
    let ok = false
    const { n, failures } = make(600, async () => {
      if (!ok) throw new Error('down')
      return { ok: true }
    })
    n.set({ enabled: true, ntfyServer: 'https://ntfy.sh', ntfyTopic: 't' })
    await n.handle(episode({ episode: 'a' }))
    await n.handle(episode({ episode: 'b' }))
    expect(failures).toEqual(['network'])
    ok = true
    expect(await n.test()).toEqual({ ok: true })
    expect(n.state().lastError).toBeNull()
  })
})
