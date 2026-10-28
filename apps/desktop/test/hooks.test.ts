import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { plannedHooks, readHooks, writeHooks } from '../src/hooks'

const CMD = 'node "C:/x/hook-bridge.mjs"'

describe('hook bridge settings', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'ccm-hooks-'))
  const file = path.join(dir, 'settings.json')
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('adds async hooks next to existing ones and removes only ours', () => {
    const mine = { hooks: [{ type: 'command', command: 'echo mine' }] }
    writeFileSync(file, JSON.stringify({ model: 'opus', hooks: { PreCompact: [mine], Stop: [mine] } }))
    expect(readHooks(file).state).toBe('none')
    expect(writeHooks(file, readHooks(file), CMD)).toBe('ok')
    const on = JSON.parse(readFileSync(file, 'utf8'))
    expect(on.model).toBe('opus')
    expect(on.hooks.PreCompact).toEqual([mine, { hooks: [{ type: 'command', command: CMD, async: true }] }])
    expect(on.hooks.PermissionDenied).toHaveLength(1)
    expect(readHooks(file).state).toBe('ours')

    expect(writeHooks(file, readHooks(file), null)).toBe('ok')
    const off = JSON.parse(readFileSync(file, 'utf8'))
    expect(off.hooks).toEqual({ PreCompact: [mine], Stop: [mine] })
    expect(readHooks(file).state).toBe('none')
  })

  it('drops an empty hooks block and refuses broken JSON', () => {
    expect(plannedHooks({}, null)).toEqual({})
    writeFileSync(file, '{ broken')
    expect(readHooks(file).state).toBe('unreadable')
    expect(writeHooks(file, readHooks(file), CMD)).toBe('unreadable')
  })
})
