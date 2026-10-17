import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { paneOpenResult, parseOpenLink, realDir, takeLinkSlot } from '../src/openLink'

const WIN = 'C:\\Users\\me\\proj'
const POSIX = '/Users/me/proj'
const link = (query: string): string => `agent-monitor://open?${query}`
const enc = encodeURIComponent

describe('parseOpenLink', () => {
  it('defaults to claude', () => {
    expect(parseOpenLink(link(`cwd=${enc(POSIX)}`), 'darwin')).toEqual({ preset: 'claude', cwd: POSIX })
  })

  it('accepts every preset', () => {
    for (const agent of ['claude', 'codex', 'shell'] as const) {
      expect(parseOpenLink(link(`agent=${agent}&cwd=${enc(WIN)}`), 'win32')).toEqual({ preset: agent, cwd: WIN })
    }
  })

  it('refuses an unknown agent', () => {
    for (const agent of ['bash', 'Claude', '', 'claude --dangerously-skip-permissions']) {
      expect(parseOpenLink(link(`agent=${enc(agent)}&cwd=${enc(POSIX)}`), 'linux')).toBeNull()
    }
  })

  it('needs a cwd', () => {
    expect(parseOpenLink(link('agent=claude'), 'win32')).toBeNull()
    expect(parseOpenLink(link('agent=claude&cwd='), 'win32')).toBeNull()
  })

  it('refuses a relative cwd', () => {
    for (const cwd of ['proj', './proj', '..\\proj', '~/proj']) {
      expect(parseOpenLink(link(`cwd=${enc(cwd)}`), 'win32')).toBeNull()
      expect(parseOpenLink(link(`cwd=${enc(cwd)}`), 'darwin')).toBeNull()
    }
  })

  it('refuses UNC and device paths', () => {
    for (const cwd of ['\\\\server\\share\\proj', '//server/share/proj', '\\\\?\\C:\\proj', '//?/C:/proj']) {
      expect(parseOpenLink(link(`cwd=${enc(cwd)}`), 'win32')).toBeNull()
    }
    expect(parseOpenLink(link(`cwd=${enc('//server/share')}`), 'darwin')).toBeNull()
  })

  it('refuses control characters', () => {
    expect(parseOpenLink(link(`cwd=${enc(`${POSIX}\n`)}`), 'darwin')).toBeNull()
    expect(parseOpenLink(link(`cwd=${enc(`C:\\a\0b`)}`), 'win32')).toBeNull()
  })

  it('refuses another scheme or host', () => {
    expect(parseOpenLink(`agent-monitor://focus?cwd=${enc(POSIX)}`, 'darwin')).toBeNull()
    expect(parseOpenLink(`agent-monitor://snooze?cwd=${enc(POSIX)}`, 'darwin')).toBeNull()
    expect(parseOpenLink(`orrery://open?cwd=${enc(POSIX)}`, 'darwin')).toBeNull()
    expect(parseOpenLink(`https://open/?cwd=${enc(POSIX)}`, 'darwin')).toBeNull()
    expect(parseOpenLink('not a url', 'darwin')).toBeNull()
  })

  it('reads a resume id and ignores every other parameter', () => {
    const id = '0d6f6a52-1b2c-4d3e-8f90-123456789abc'
    const parsed = parseOpenLink(link(`agent=codex&cwd=${enc(POSIX)}&prompt=rm%20-rf&resume=${id}&name=x&k=key`), 'darwin')
    expect(parsed).toEqual({ preset: 'codex', cwd: POSIX, resume: id })
    expect(Object.keys(parsed ?? {})).toEqual(['preset', 'cwd', 'resume'])
    expect(parseOpenLink(link(`cwd=${enc(POSIX)}&prompt=x`), 'darwin')).toEqual({ preset: 'claude', cwd: POSIX })
  })

  it('refuses a resume id that is not a session uuid or targets a shell', () => {
    expect(parseOpenLink(link(`cwd=${enc(POSIX)}&resume=--dangerously-skip-permissions`), 'darwin')).toBeNull()
    expect(parseOpenLink(link(`cwd=${enc(POSIX)}&resume=`), 'darwin')).toBeNull()
    expect(parseOpenLink(link(`agent=shell&cwd=${enc(POSIX)}&resume=0d6f6a52-1b2c-4d3e-8f90-123456789abc`), 'darwin')).toBeNull()
  })

  it('applies the absolute rules of the given platform', () => {
    expect(parseOpenLink(link(`cwd=${enc(WIN)}`), 'darwin')).toBeNull()
    expect(parseOpenLink(link(`cwd=${enc(POSIX)}`), 'win32')).toBeNull()
    expect(parseOpenLink(link(`cwd=${enc('\\Users\\me')}`), 'win32')).toBeNull()
    expect(parseOpenLink(link(`cwd=${enc('C:proj')}`), 'win32')).toBeNull()
    expect(parseOpenLink(link(`cwd=${enc('D:/work/app')}`), 'win32')).toEqual({ preset: 'claude', cwd: 'D:/work/app' })
  })

  it('decodes a percent-encoded path with spaces', () => {
    expect(parseOpenLink(link('agent=shell&cwd=C%3A%5CMy%20Projects%5Capp'), 'win32')).toEqual({ preset: 'shell', cwd: 'C:\\My Projects\\app' })
    expect(parseOpenLink(link('cwd=%2FUsers%2Fme%2FMy%20Projects'), 'darwin')).toEqual({ preset: 'claude', cwd: '/Users/me/My Projects' })
  })

  it('refuses an overlong cwd', () => {
    expect(parseOpenLink(link(`cwd=${enc(`/${'a'.repeat(1100)}`)}`), 'linux')).toBeNull()
  })
})

describe('realDir', () => {
  const base = mkdtempSync(path.join(tmpdir(), 'ccm-link-'))
  const dir = path.join(base, 'My Projects')
  mkdirSync(dir)
  const file = path.join(base, 'file.txt')
  writeFileSync(file, 'x')
  afterAll(() => rmSync(base, { recursive: true, force: true }))

  it('returns the real folder', () => {
    expect(realDir(dir)).toBe(realDir(path.join(dir, '.')))
    expect(realDir(dir)).not.toBeNull()
  })

  it('refuses files, missing folders and UNC paths', () => {
    expect(realDir(file)).toBeNull()
    expect(realDir(path.join(base, 'gone'))).toBeNull()
    expect(realDir('\\\\server\\share')).toBeNull()
    expect(realDir('//server/share')).toBeNull()
  })
})

describe('paneOpenResult', () => {
  it('keeps a well-formed answer', () => {
    expect(paneOpenResult({ ok: true, paneKey: 'p1' })).toEqual({ ok: true, paneKey: 'p1' })
    expect(paneOpenResult({ ok: false, error: 'limit' })).toEqual({ ok: false, error: 'limit' })
  })

  it('maps anything else to failed', () => {
    for (const raw of [null, undefined, 'ok', 1, {}, { ok: true }, { ok: true, paneKey: 3 }, { ok: false, error: 'boom' }, { ok: 'true', paneKey: 'p' }]) {
      expect(paneOpenResult(raw)).toEqual({ ok: false, error: 'failed' })
    }
  })
})

describe('takeLinkSlot', () => {
  it('allows three links a minute, then frees a slot as the oldest ages out', () => {
    const times: number[] = []
    expect([0, 1000, 2000, 3000].map((t) => takeLinkSlot(times, t, 3))).toEqual([true, true, true, false])
    expect(takeLinkSlot(times, 59_999, 3)).toBe(false)
    expect(takeLinkSlot(times, 60_000, 3)).toBe(true)
    expect(times).toEqual([1000, 2000, 60_000])
  })

  it('defaults to ten links a minute', () => {
    const times: number[] = []
    expect(Array.from({ length: 11 }, (_, i) => takeLinkSlot(times, i * 100)).filter(Boolean)).toHaveLength(10)
  })
})
