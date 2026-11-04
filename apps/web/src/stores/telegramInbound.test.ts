import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { PtyPreset, TerminalSession } from '@ccm/shared'
import { keysReady, resumeItems } from '../composables/useTelegramInbound'
import { useWorkspaceStore } from './workspace'

describe('telegramInbound (v82 stage 2)', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    setActivePinia(createPinia())
  })

  function pane(ws: ReturnType<typeof useWorkspaceStore>, preset: PtyPreset, cwd: string, id: string) {
    const p = ws.open(preset, cwd)
    ws.update(p.key, { sessionId: `pty-${id}`, terminalId: `term-${id}`, state: 'running' })
    return ws.panes.find((x) => x.key === p.key)!
  }

  it('prefills and submits into the only agent pane of the project', () => {
    const ws = useWorkspaceStore()
    const a = pane(ws, 'claude', 'C:\\work\\A\\app', 'a')
    pane(ws, 'shell', 'C:\\work\\A', 's')
    pane(ws, 'claude', 'C:\\work\\B', 'b')
    expect(ws.telegramInbound('C:\\work\\A', 'chạy test')).toBe(a)
    expect(a).toMatchObject({ prefill: 'chạy test', prefillSubmit: true })
  })

  it('needs a reply target when the project has several agent panes', () => {
    const ws = useWorkspaceStore()
    pane(ws, 'claude', 'C:\\work\\A', 'a1')
    const second = pane(ws, 'codex', 'C:\\work\\A', 'a2')
    expect(ws.telegramInbound('C:\\work\\A', 'x')).toBe('many')
    expect(ws.telegramInbound('C:\\work\\A', 'x', { terminalId: 'term-a2' })).toBe(second)
    expect(ws.telegramInbound('C:\\work\\A', 'x', { sessionId: 'pty-zz' })).toBe('gone')
  })

  it('queues raw keys for the targeted pane only', () => {
    const ws = useWorkspaceStore()
    pane(ws, 'claude', 'C:\\work\\A', 'a1')
    const second = pane(ws, 'claude', 'C:\\work\\A', 'a2')
    expect(ws.telegramKeys('C:\\work\\A', '1')).toBe('many')
    expect(ws.telegramKeys('C:\\work\\A', '1', { terminalId: 'term-a2' })).toBe(second)
    expect(second.typeKeys).toBe('1')
    expect(ws.telegramKeys('C:\\work\\B', '1')).toBe('none')
  })

  it('leaves panes of a sub-project with its own topic to that topic', () => {
    const ws = useWorkspaceStore()
    pane(ws, 'claude', 'C:\\repo\\apps\\x', 'b')
    expect(ws.telegramInbound('C:\\repo', 'x', undefined, ['C:\\repo\\apps\\x'])).toBe('none')
    const a = pane(ws, 'claude', 'C:\\repo', 'a')
    expect(ws.telegramPanes('C:\\repo')).toHaveLength(2)
    expect(ws.telegramPanes('C:\\repo', ['C:\\repo\\apps\\x'])).toEqual([a])
    expect(ws.telegramInbound('C:\\repo', 'x', undefined, ['C:/repo/apps/x/'])).toBe(a)
    expect(ws.telegramKeys('C:\\repo', '1', { terminalId: 'term-b' }, ['C:\\repo\\apps\\x'])).toBe('gone')
  })

  it('reports typed keys only once the pane wrote them, and refuses a second key press meanwhile', async () => {
    vi.useFakeTimers()
    try {
      const ws = useWorkspaceStore()
      const a = pane(ws, 'claude', 'C:\\work\\A', 'a')
      expect(ws.telegramKeys('C:\\work\\A', '1')).toBe(a)
      expect(ws.telegramKeys('C:\\work\\A', '\x1b')).toBe('busy')
      const typed = ws.telegramTyped(a.key, 1500)
      ws.update(a.key, { typeKeys: undefined })
      await vi.advanceTimersByTimeAsync(0)
      await expect(typed).resolves.toBe(true)
      expect(ws.telegramKeys('C:\\work\\A', '1')).toBe(a)
      const lost = ws.telegramTyped(a.key, 1500)
      await vi.advanceTimersByTimeAsync(1600)
      await expect(lost).resolves.toBe(false)
      expect(a.typeKeys).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports no pane and does not overwrite a pending prefill', () => {
    const ws = useWorkspaceStore()
    expect(ws.telegramInbound('C:\\work\\A', 'x')).toBe('none')
    const a = pane(ws, 'claude', 'C:\\work\\A', 'a')
    expect(ws.telegramInbound('C:\\work\\A', 'first')).toBe(a)
    expect(ws.telegramInbound('C:\\work\\A', 'second')).toEqual({ busy: a })
    expect(a.prefill).toBe('first')
    ws.update(a.key, { state: 'exited' })
    expect(ws.telegramInbound('C:\\work\\A', 'x')).toBe('none')
  })
})

describe('Telegram keys and resume checks (WP-3a)', () => {
  const since = '2026-11-04T10:00:00.000Z'
  const waiting = { status: 'waiting' as const, statusSince: since, waitingFor: 'permission prompt' }

  it('presses Allow only on the permission prompt the message was about', () => {
    const at = Date.parse(since)
    expect(keysReady({ key: 'approve', since: at, tool: 'Bash' }, waiting, true, 'Bash')).toBe(true)
    expect(keysReady({ key: 'approve', since: at - 60_000, tool: 'Bash' }, waiting, true, 'Bash')).toBe(false)
    expect(keysReady({ key: 'approve', since: at, tool: 'Read' }, waiting, true, 'Bash')).toBe(false)
    expect(keysReady({ key: 'approve', since: at }, { ...waiting, statusSince: undefined }, true)).toBe(false)
    expect(keysReady({ key: 'approve', since: at }, waiting, false)).toBe(false)
    expect(keysReady({ key: 'stop', since: at, tool: 'Read' }, { status: 'working', statusSince: since }, true, 'Bash')).toBe(true)
    expect(keysReady({ key: 'stop', since: at }, { status: 'working', statusSince: '2026-11-04T10:05:00.000Z' }, true)).toBe(false)
    expect(keysReady({ key: 'deny' }, undefined, true)).toBe(false)
  })

  it('lists each ended session once, without those of a sub-project topic', () => {
    const t = (id: string, sid: string, cwd: string, endedAt: string): TerminalSession => ({ id, title: '', status: 'idle', cwd, claudeSessionId: sid, endedAt })
    const S1 = '0b7c1e1e-5f7a-4d55-9c6e-2a1b3c4d5e61'
    const S2 = '0b7c1e1e-5f7a-4d55-9c6e-2a1b3c4d5e62'
    const list = [t('a', S1, 'C:\\repo', '2026-11-04T09:00:00Z'), t('b', S1, 'C:\\repo', '2026-11-04T10:00:00Z'), t('c', S2, 'C:\\repo\\apps\\x', '2026-11-04T11:00:00Z')]
    expect(resumeItems(list, 'C:\\repo', ['C:\\repo\\apps\\x'], new Set())).toEqual([{ id: S1, name: 'repo', cwd: 'C:\\repo', endedAt: '2026-11-04T10:00:00Z' }])
    expect(resumeItems(list, 'C:\\repo', [], new Set([S1])).map((i) => i.id)).toEqual([S2])
  })
})
