import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { firstStartToday } from '../src/daystart'

let dir = ''
afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

describe('firstStartToday', () => {
  it('keeps the first start of the day across restarts and resets on a new day', async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'ccm-day-'))
    const file = path.join(dir, 'day-start.json')
    const morning = new Date(2026, 9, 8, 8, 12).getTime()
    const first = await firstStartToday(file, morning)
    expect(first).toBe(new Date(morning).toISOString())
    expect(await firstStartToday(file, morning + 3 * 3600_000)).toBe(first)
    const tomorrow = new Date(2026, 9, 9, 9, 0).getTime()
    expect(await firstStartToday(file, tomorrow)).toBe(new Date(tomorrow).toISOString())
    expect(JSON.parse(await readFile(file, 'utf8')).date).toBe('2026-10-09')
  })
})
