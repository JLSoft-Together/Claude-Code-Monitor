import { describe, expect, it } from 'vitest'
import type { ExtStatus, ToolStats } from '@ccm/shared'
import { barScale, errorRate, mcpToolName, totalCalls, unusedItems } from './toolStats'

const stats = (skills: string[], mcp: string[]): ToolStats => ({
  days: 30,
  project: null,
  projects: [],
  tools: [],
  skills: [],
  agents: [],
  mcp: [],
  used30: { skills, mcp },
})

const status = (user: string[], project: string[], configured: ExtStatus['configured']): ExtStatus => ({
  cli: true,
  dir: null,
  prereqs: { node: true, uv: true, docker: true },
  plugins: [],
  marketplaces: [],
  configured,
  skills: { user, project },
  skillDirs: { user: '/u', project: null },
})

describe('toolStats', () => {
  it('lists installed skills and MCP servers without calls in 30 days', () => {
    const items = unusedItems(
      status(['pdf', 'Docx', 'xlsx'], ['xlsx', 'local-one'], [
        { name: 'github', scopes: ['user'] },
        { name: 'my.server', scopes: ['project'] },
        { name: 'figma', scopes: ['local'] },
      ]),
      stats(['pdf', 'docx'], ['github', 'my_server']),
    )
    expect(items).toEqual([
      { kind: 'mcp', name: 'figma', scope: 'project' },
      { kind: 'skill', name: 'local-one', scope: 'project' },
      { kind: 'skill', name: 'xlsx', scope: 'project' },
    ])
    expect(unusedItems(null, stats([], []))).toEqual([])
  })

  it('normalises MCP names, error rates and bars', () => {
    expect(mcpToolName('My Server.x')).toBe('my_server_x')
    expect(errorRate({ name: 'Bash', n: 4, errors: 1 })).toBe(0.25)
    expect(errorRate({ name: 'pdf', n: 4 })).toBeNull()
    expect(barScale(0, 0)).toBe(0)
    expect(barScale(1, 1000)).toBe(0.02)
    expect(totalCalls([{ name: 'a', n: 2 }, { name: 'b', n: 3 }])).toBe(5)
  })
})
