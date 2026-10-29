import { describe, expect, it } from 'vitest'
import type { PermAsk } from '@ccm/shared'
import { adviseRules, deniedTools, editedRule, suggestFor, tickable } from './permAdvisor'

const ask = (tool: string, rules: string[] = [], prefix?: string, at = '2026-10-29T09:00:00.000Z'): PermAsk => ({ at, tool, rules, ...(prefix ? { prefix } : {}) })
const none = { allow: [], deny: [] }

describe('suggestFor', () => {
  it('prefers Claude Code suggestions, then a shell prefix, then a narrow bare tool', () => {
    expect(suggestFor(ask('Bash', ['Bash(npm run test:*)'], 'npm run'))).toBe('Bash(npm run test:*)')
    expect(suggestFor(ask('Bash', [], 'flutter analyze'))).toBe('Bash(flutter analyze:*)')
    expect(suggestFor(ask('Bash'))).toBeNull()
    expect(suggestFor(ask('WebFetch'))).toBeNull()
    expect(suggestFor(ask('Edit'))).toBe('Edit')
    expect(suggestFor(ask('mcp__github__get_me'))).toBe('mcp__github__get_me')
  })
})

describe('adviseRules', () => {
  it('groups repeats, marks covered / denied / risky rows and sorts by count', () => {
    const asks = [
      ask('Bash', ['Bash(npm run test:*)'], 'npm run', '2026-10-29T08:00:00.000Z'),
      ask('Bash', ['Bash(npm run test:*)'], 'npm run', '2026-10-29T09:30:00.000Z'),
      ask('Bash', [], 'rm -rf'),
      ask('Bash', [], 'git status'),
      ask('Edit'),
      ask('WebFetch', ['WebFetch(domain:pub.dev)']),
      ask('Bash'),
    ]
    const rows = adviseRules(asks, { allow: ['Bash(git:*)'], deny: [] }, { allow: [], deny: ['WebFetch(domain:pub.dev)'] })
    expect(rows[0]).toMatchObject({ rule: 'Bash(npm run test:*)', count: 2, lastAt: '2026-10-29T09:30:00.000Z', risky: false, covered: null })
    const by = Object.fromEntries(rows.map((r) => [r.key, r]))
    expect(by['Bash(rm -rf:*)']).toMatchObject({ risky: true })
    expect(by['Bash(git status:*)']).toMatchObject({ covered: 'shared' })
    expect(by['WebFetch(domain:pub.dev)']).toMatchObject({ covered: 'denied' })
    expect(by['tool:Bash']).toMatchObject({ rule: null })
    expect(rows.filter(tickable).map((r) => r.rule)).toEqual(['Bash(npm run test:*)', 'Edit'])
  })

  it('covers a longer command with an existing shorter prefix only on a word boundary', () => {
    expect(adviseRules([ask('Bash', [], 'npm test')], { allow: ['Bash(npm:*)'], deny: [] }, none)[0]!.covered).toBe('shared')
    expect(adviseRules([ask('Bash', [], 'npmx test')], { allow: ['Bash(npm:*)'], deny: [] }, none)[0]!.covered).toBeNull()
  })
})

describe('editedRule / deniedTools', () => {
  it('validates an edited rule', () => {
    expect(editedRule(' Bash(npm run lint:*) ')).toEqual({ rule: 'Bash(npm run lint:*)' })
    expect(editedRule('Bash(*)')).toEqual({ error: 'risky' })
    expect(editedRule('Bash(npm')).toEqual({ error: 'invalid' })
  })

  it('sums auto-mode denials of sessions in the project', () => {
    const sessions = [
      { cwd: 'C:\\p\\app', deniedCount: 3, deniedTools: ['Bash', 'WebFetch'] },
      { cwd: 'C:\\p', deniedCount: 1, deniedTools: ['Bash'] },
      { cwd: 'C:\\other', deniedCount: 5, deniedTools: ['Edit'] },
      { cwd: 'C:\\p' },
    ]
    expect(deniedTools(sessions, (c) => c.startsWith('C:\\p'))).toEqual({ total: 4, tools: [{ tool: 'Bash', sessions: 2 }, { tool: 'WebFetch', sessions: 1 }] })
  })
})
