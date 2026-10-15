import { describe, expect, it } from 'vitest'
import type { Agent, TerminalSession } from '@ccm/shared'
import { canvasMenu, nodeMenu, type NodeMenuState } from './mapMenu'
import { findAction, isSeparator } from './menu'
import { agentDuration, agentName, agentSummary, mapTree, searchText, sessionIdOf, type MapTextLabels } from './mapText'

const labels: MapTextLabels = {
  status: (s) => s.toUpperCase(),
  field: (f) => f,
  main: 'Main agent',
  subagent: 'Subagent',
  codexRun: 'Codex run',
}
const term: TerminalSession = { id: 't1', title: 'repo', alias: 'My session', status: 'working', cwd: 'F:\\work\\repo', gitBranch: 'main', claudeSessionId: 'abc-123' }
const main: Agent = { id: 'm1', terminalId: 't1', role: 'main', status: 'working', model: 'claude-opus', currentTool: 'Bash', startedAt: '2026-10-15T10:00:00Z' }
const sub: Agent = { id: 's1', terminalId: 't1', parentId: 'm1', role: 'subagent', type: 'Explore', description: 'Find the files', status: 'completed', startedAt: '2026-10-15T10:01:00Z', completedAt: '2026-10-15T10:03:05Z' }
const deep: Agent = { id: 's2', terminalId: 't1', parentId: 's1', role: 'subagent', status: 'working' }
const NOW = Date.parse('2026-10-15T10:05:00Z')

describe('names and ids', () => {
  it('names like the node does', () => {
    expect(agentName(main, term, labels)).toBe('My session')
    expect(agentName(sub, term, labels)).toBe('Explore')
    expect(agentName(deep, term, labels)).toBe('Subagent')
    expect(agentName({ ...sub, provider: 'codex', type: undefined, name: undefined }, term, labels)).toBe('Codex run')
  })
  it('session id follows the provider', () => {
    expect(sessionIdOf(term)).toBe('abc-123')
    expect(sessionIdOf({ ...term, provider: 'codex', codexSessionId: 'rollout-1' })).toBe('rollout-1')
    expect(sessionIdOf(undefined)).toBeUndefined()
  })
  it('duration runs to now, or stops at the end', () => {
    expect(agentDuration(main, NOW)).toBe('5m 00s')
    expect(agentDuration(sub, NOW)).toBe('2m 05s')
    expect(agentDuration(deep, NOW)).toBeNull()
  })
})

describe('agentSummary', () => {
  it('lists the known fields, skips missing ones', () => {
    expect(agentSummary(main, term, labels, NOW).split('\n')).toEqual([
      'name: My session',
      'kind: Main agent',
      'status: WORKING',
      'model: claude-opus',
      'tool: Bash',
      'sessionId: abc-123',
      'agentId: m1',
      'cwd: F:\\work\\repo',
      'branch: main',
      'started: 2026-10-15T10:00:00Z',
      'duration: 5m 00s',
    ])
  })
  it('subagent: task and session title', () => {
    const text = agentSummary(sub, term, labels, NOW)
    expect(text).toContain('kind: Subagent · Explore')
    expect(text).toContain('task: Find the files')
    expect(text).toContain('session: My session')
    expect(text).not.toContain('tool:')
  })
})

describe('mapTree', () => {
  it('indents by depth under a session header', () => {
    expect(mapTree([{ terminal: term, agents: [deep, sub, main] }], labels)).toBe(
      ['My session — F:\\work\\repo — (main)', '- Main agent [WORKING] · claude-opus · Bash', '  - Explore [COMPLETED] · Find the files', '    - Subagent [WORKING]'].join('\n'),
    )
  })
  it('separates sessions and skips empty ones', () => {
    const other: TerminalSession = { id: 't2', title: 'other', status: 'idle' }
    const m2: Agent = { id: 'm2', terminalId: 't2', role: 'main', status: 'idle' }
    const text = mapTree([{ terminal: term, agents: [main] }, { terminal: undefined, agents: [] }, { terminal: other, agents: [m2] }], labels)
    expect(text.split('\n\n')).toHaveLength(2)
    expect(text.endsWith('other\n- Main agent [IDLE]')).toBe(true)
  })
  it('search text covers name, task and id', () => {
    const s = searchText(sub, term, labels)
    expect(s).toContain('explore')
    expect(s).toContain('find the files')
    expect(s).toContain('s1')
  })
})

const base: NodeMenuState = { scope: 'map', agent: true, workspace: 'show', canJump: false, sessionId: true, cwd: true, branch: false, description: false, children: 0, collapsed: false, picked: 0, detailsOpen: false }
const t = (k: string, a?: Record<string, unknown>) => (a ? `${k}:${JSON.stringify(a)}` : k)

describe('map menus', () => {
  it('node menu: workspace entry by state, copy submenu, fold only with children', () => {
    const show = nodeMenu(base, t, false)
    expect(findAction(show, 'show-in-workspace')).not.toBeNull()
    expect(findAction(show, 'copy-session-id')?.disabled).toBe(false)
    expect(findAction(show, 'copy-branch')?.disabled).toBe(true)
    expect(findAction(show, 'copy-description')).toBeNull()
    expect(findAction(show, 'toggle-subtree')).toBeNull()
    expect(findAction(show, 'copy-summary')?.shortcut).toBe('Ctrl+C')
    expect(findAction(show, 'show-in-workspace')?.shortcut).toBe('Shift+Enter')

    const live = nodeMenu({ ...base, workspace: 'reopen-live', children: 2 }, t, true)
    expect(findAction(live, 'copy-summary')?.shortcut).toBe('⌘C')
    expect(findAction(live, 'details')?.shortcut).toBe('↩')
    expect(findAction(live, 'reopen')?.children?.some((c) => !isSeparator(c) && c.id === 'reopen-confirm')).toBe(true)
    expect(findAction(live, 'toggle-subtree')?.label).toBe('map.menu.collapse')

    const off = nodeMenu({ ...base, workspace: 'off', picked: 3 }, t, false)
    expect(isSeparator(off[0]!)).toBe(false)
    expect(findAction(off, 'copy-picked')).not.toBeNull()
  })
  it('card menu: same copies and details, none of the map-only entries', () => {
    const card = nodeMenu({ ...base, scope: 'card', children: 3, collapsed: true, picked: 4 }, t, false)
    const ids = card.filter((e) => !isSeparator(e)).map((e) => (e as { id: string }).id)
    expect(ids).toEqual(['show-in-workspace', 'copy-summary', 'copy', 'details'])
    expect(findAction(card, 'copy')?.children?.map((c) => (isSeparator(c) ? '-' : c.id))).toEqual([
      'copy-name',
      'copy-agent-id',
      'copy-session-id',
      'copy-cwd',
      'copy-branch',
      '-',
      'copy-session-tree',
    ])
    expect(findAction(card, 'show-in-workspace')?.shortcut).toBeUndefined()
    expect(findAction(card, 'copy-summary')?.shortcut).toBe('Ctrl+C')
    expect(isSeparator(card.at(-1)!)).toBe(false)

    const noAgent = nodeMenu({ ...base, scope: 'card', agent: false, workspace: 'off' }, t, true)
    expect(findAction(noAgent, 'copy-summary')?.disabled).toBe(true)
    expect(findAction(noAgent, 'copy-session-id')?.disabled).toBe(false)
    expect(findAction(noAgent, 'details')).toBeNull()
    expect(isSeparator(noAgent.at(-1)!)).toBe(false)
  })
  it('canvas menu disables what does not apply', () => {
    const m = canvasMenu({ hasNodes: true, anyCollapsed: false, anyParent: true, hideFinished: true }, t, true)
    expect(findAction(m, 'find')?.shortcut).toBe('⌘F')
    expect(findAction(m, 'expand-all')?.disabled).toBe(true)
    expect(findAction(m, 'collapse-all')?.disabled).toBe(false)
    expect(findAction(m, 'toggle-finished')?.label).toBe('map.showFinished')
  })
})
