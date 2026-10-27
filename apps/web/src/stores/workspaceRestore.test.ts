import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { leaves } from '../lib/splitLayout'
import { tabMenu } from '../lib/tabMenu'
import { useWorkspaceStore } from './workspace'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

function seedLast(): void {
  localStorage.setItem(
    'ccm.workspace.last',
    JSON.stringify({
      at: '2026-10-27T10:00:00.000Z',
      panes: [
        { key: 'a1', preset: 'claude', cwd: 'D:\\work\\orrery', resume: A },
        { key: 'a2', preset: 'shell', cwd: 'D:\\work\\orrery' },
        { key: 'b1', preset: 'claude', cwd: 'D:\\work\\dumpling', resume: B },
        { key: 'b2', preset: 'claude', cwd: 'D:\\work\\dumpling', resume: C },
        { key: 'b3', kind: 'browser', preset: 'shell', cwd: 'D:\\work\\dumpling', url: 'http://localhost:3000' },
      ],
      tabs: [
        { key: 'ta', root: { dir: 'row', ratio: 0.5, a: { pane: 'a1' }, b: { pane: 'a2' } }, focus: 'a1', project: 'D:\\work\\orrery' },
        { key: 'tb', root: { dir: 'row', ratio: 0.5, a: { pane: 'b1' }, b: { pane: 'b2' } }, focus: 'b1', project: 'D:\\work\\dumpling' },
        { key: 'tc', root: { pane: 'b3' }, focus: 'b3', project: 'D:\\work\\dumpling' },
      ],
    }),
  )
}

describe('restore with picked projects', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    seedLast()
    setActivePinia(createPinia())
  })

  it('lists projects with their terminal session counts', () => {
    const ws = useWorkspaceStore()
    expect(ws.lastProjects).toEqual([
      { key: 'D:\\work\\orrery', cwd: 'D:\\work\\orrery', sessions: 2 },
      { key: 'D:\\work\\dumpling', cwd: 'D:\\work\\dumpling', sessions: 2 },
    ])
  })

  it('starts picked projects and keeps the rest asleep with their layout', () => {
    const ws = useWorkspaceStore()
    ws.restoreLast(new Set(['D:\\work\\orrery']))
    expect(ws.tabs).toHaveLength(3)
    const states = ws.tabs.map((t) => leaves(t.root).map((k) => ws.panes.find((p) => p.key === k)!.state))
    expect(states).toEqual([['starting', 'starting'], ['parked', 'parked'], ['running']])
    const sleeping = ws.panes.filter((p) => p.state === 'parked')
    expect(sleeping.map((p) => p.resume)).toEqual([B, C])
  })

  it('restores everything running when no pick is given', () => {
    const ws = useWorkspaceStore()
    ws.restoreLast()
    expect(ws.panes.some((p) => p.state === 'parked')).toBe(false)
  })

  it('wakes only asleep panes', () => {
    const ws = useWorkspaceStore()
    ws.restoreLast(new Set())
    const keys = ws.panes.map((p) => p.key)
    ws.wake(keys)
    expect(ws.panes.map((p) => p.state)).toEqual(['starting', 'starting', 'starting', 'starting', 'running'])
  })

  it('keeps asleep panes across a window reload', async () => {
    const ws = useWorkspaceStore()
    ws.restoreLast(new Set(['D:\\work\\orrery']))
    await nextTick()
    setActivePinia(createPinia())
    const next = useWorkspaceStore()
    expect(next.panes.filter((p) => p.state === 'parked').map((p) => p.resume)).toEqual([B, C])
    expect(next.tabs).toHaveLength(2)
  })

  it('offers starting a tab that has asleep panes', () => {
    const t = (key: string, p?: Record<string, unknown>): string => (p ? `${key}:${p.n}` : key)
    const entries = tabMenu({ active: true, panes: 2, targets: [], others: 0, parked: 2 }, t)
    expect(entries[0]).toMatchObject({ id: 'wake', label: 'workspace.parked.wakeTab:2' })
    expect(tabMenu({ active: true, panes: 2, targets: [], others: 0 }, t).some((e) => 'id' in e && e.id === 'wake')).toBe(false)
  })
})
