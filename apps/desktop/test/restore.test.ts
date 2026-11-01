import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_PROMPTS_FILE, promptsFileText } from '../src/restore/ipc'
import { dirsExist, markClean, markRunning, readPreviousRun } from '../src/restore/runState'

const tmp = (): string => mkdtempSync(path.join(os.tmpdir(), 'ccm-restore-'))

describe('run state', () => {
  it('reports an unclean exit only when the last run never quit cleanly', () => {
    const file = path.join(tmp(), 'run-state.json')
    expect(readPreviousRun(file)).toEqual({ unclean: false })
    markRunning(file)
    expect(readPreviousRun(file)).toEqual({ unclean: true })
    markClean(file)
    expect(readPreviousRun(file)).toEqual({ unclean: false })
    expect(JSON.parse(readFileSync(file, 'utf8')).running).toBe(false)
    writeFileSync(file, '{oops')
    expect(readPreviousRun(file)).toEqual({ unclean: false })
  })

  it('checks folders without trusting the page', () => {
    const root = tmp()
    mkdirSync(path.join(root, 'a'))
    writeFileSync(path.join(root, 'f.txt'), 'x')
    expect(dirsExist([path.join(root, 'a'), path.join(root, 'missing'), path.join(root, 'f.txt'), 'relative', '\\\\server\\share', 42])).toEqual([true, false, false, false, false, false])
    expect(dirsExist('nope')).toBeNull()
    expect(dirsExist(Array.from({ length: 201 }, () => root))).toBeNull()
  })
})

describe('prompt library file', () => {
  it('accepts a prompt list, redacts token-shaped text and rejects anything else', () => {
    const out = promptsFileText(JSON.stringify({ format: 'orrery-prompts', prompts: [{ name: 'k', text: 'use sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789', scope: 'global' }] }))
    expect(out?.count).toBe(1)
    expect(out?.text).not.toContain('sk-ant-api03-abcdefghij')
    expect(promptsFileText('{"prompts": 1}')).toBeNull()
    expect(promptsFileText('not json')).toBeNull()
    expect(promptsFileText(42)).toBeNull()
    expect(promptsFileText(`{"prompts":[],"pad":"${'x'.repeat(MAX_PROMPTS_FILE)}"}`)).toBeNull()
  })
})
