import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { existingDir, pickStartDir } from '../src/pick-start'

const base = mkdtempSync(path.join(tmpdir(), 'ccm-pick-'))
const project = path.join(base, 'Projects', 'app')
mkdirSync(project, { recursive: true })
afterAll(() => rmSync(base, { recursive: true, force: true }))

describe('pickStartDir', () => {
  it('opens in the parent of the last project', () => {
    expect(pickStartDir(project)).toBe(path.join(base, 'Projects'))
  })

  it('falls back to the nearest existing ancestor of a removed project', () => {
    expect(pickStartDir(path.join(project, 'gone', 'deeper'))).toBe(project)
  })

  it('ignores unusable hints', () => {
    for (const near of [undefined, null, 42, '', 'relative/dir', `${project}\n`, 'x'.repeat(2000)]) {
      expect(pickStartDir(near)).toBeUndefined()
      expect(existingDir(near)).toBeUndefined()
    }
  })
})

describe('existingDir', () => {
  it('keeps an existing folder (Open file… starts in the terminal folder)', () => {
    expect(existingDir(project)).toBe(project)
  })

  it('starts in the folder of a file (browser page)', () => {
    const page = path.join(project, 'index.html')
    writeFileSync(page, '<p>hi</p>')
    expect(existingDir(page)).toBe(project)
  })

  it('walks up from a folder that is gone', () => {
    expect(existingDir(path.join(project, 'gone', 'deeper'))).toBe(project)
  })
})
