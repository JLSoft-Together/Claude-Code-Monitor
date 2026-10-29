import { describe, expect, it } from 'vitest'
import type { HookRow } from '@ccm/shared'
import { filterRows, groupByEvent } from './claudeHooks'

const row = (event: string, extra: Partial<HookRow> = {}): HookRow => ({
  id: `${event}${extra.text ?? ''}`,
  event,
  matcher: null,
  type: 'command',
  text: 'node x.js',
  timeout: null,
  async: false,
  source: 'user',
  orrery: false,
  enabled: true,
  toggleable: true,
  testable: true,
  ...extra,
})

describe('claudeHooks helpers', () => {
  it('groups consecutive rows by event and counts active ones', () => {
    const groups = groupByEvent([row('SessionStart'), row('SessionStart', { enabled: false, text: 'b' }), row('Stop', { source: 'plugin', pluginEnabled: false })])
    expect(groups.map((g) => [g.event, g.rows.length, g.active])).toEqual([
      ['SessionStart', 2, 1],
      ['Stop', 1, 0],
    ])
  })
  it('filters by event, matcher, command and plugin', () => {
    const rows = [row('PreToolUse', { matcher: 'Bash' }), row('Stop', { plugin: 'caveman@caveman', text: 'say' })]
    expect(filterRows(rows, 'bash').map((r) => r.event)).toEqual(['PreToolUse'])
    expect(filterRows(rows, 'CAVEMAN').map((r) => r.event)).toEqual(['Stop'])
    expect(filterRows(rows, ' ')).toHaveLength(2)
  })
})
