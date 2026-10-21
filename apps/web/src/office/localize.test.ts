import { beforeEach, describe, expect, it } from 'vitest'
import { describeTool, describeWaitingFor } from '@ccm/habblaud/shared/activity'
import { tr } from '@ccm/habblaud/shared/i18n'
import type { AgentInfo, OfficeSnapshot } from '@ccm/habblaud/shared/types'
import { applyOfficeLocale } from './i18n'
import { localizeSnapshot } from './localize'

const colors = { claude: '#111111', codex: '#222222' }

function agent(over: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'a1',
    kind: 'main',
    provider: 'claude',
    roomId: 'r',
    name: 'Ana',
    role: 'main',
    status: 'working',
    recent: [],
    tasks: [],
    shells: [],
    activity: { id: 'x', kind: 'edit', icon: '✏️', text: 'Editando arquivo', tool: 'Edit', at: 1 },
    ...over,
  } as unknown as AgentInfo
}

function snap(agents: AgentInfo[]): OfficeSnapshot {
  return {
    rev: 1,
    serverTime: 1,
    rooms: [],
    agents,
    accounts: [
      { id: '.claude', short: 'C', name: 'C', color: '#000000' },
      { id: '.codex', provider: 'codex', short: 'X', name: 'X', color: '#000000' },
    ],
    meta: { demo: false, sources: [], startedAt: 1, version: '1' },
  } as unknown as OfficeSnapshot
}

describe('localizeSnapshot', () => {
  beforeEach(async () => {
    await applyOfficeLocale('vi')
  })

  it('translates tool activity text', () => {
    const out = localizeSnapshot(snap([agent()]), colors)
    expect(out.agents[0]!.activity!.text).toBe(describeTool('Edit', undefined).text)
    expect(out.agents[0]!.activity!.text).not.toBe('Editando arquivo')
  })

  it('translates waitingFor', () => {
    const out = localizeSnapshot(snap([agent({ waitingFor: 'permission prompt' })]), colors)
    expect(out.agents[0]!.waitingFor).toBe(describeWaitingFor('permission prompt'))
  })

  it('relabels main role and background shells in both locales', async () => {
    const a = agent({ shells: [{ id: 's', label: '', startedAt: 1, background: true, kind: 'shell' }] })
    const vi = localizeSnapshot(snap([a]), colors).agents[0]!
    expect(vi.role).toBe(tr('Agente principal'))
    expect(vi.role).not.toBe('Agente principal')
    expect(vi.shells![0]!.label).toBe('Shell chạy nền')
    await applyOfficeLocale('en')
    const en = localizeSnapshot(snap([a]), colors).agents[0]!
    expect(en.role).toBe('Main agent')
    expect(en.shells![0]!.label).toBe('Background shell')
  })

  it('keeps a sub-agent role', () => {
    expect(localizeSnapshot(snap([agent({ role: 'Explore' })]), colors).agents[0]!.role).toBe('Explore')
  })

  it('applies account colours by provider', () => {
    const out = localizeSnapshot(snap([]), colors)
    expect(out.accounts.map((a) => a.color)).toEqual(['#111111', '#222222'])
  })

  it('does not mutate its input', () => {
    const input = snap([agent({ waitingFor: 'x' })])
    const copy = JSON.stringify(input)
    const out = localizeSnapshot(input, colors)
    expect(out).not.toBe(input)
    expect(JSON.stringify(input)).toBe(copy)
  })
})
