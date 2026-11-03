import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { DeepSeekStatus } from '../lib/desktop'

const bridge = vi.hoisted(() => ({ status: vi.fn() }))

vi.mock('../lib/desktop', async (original) => ({
  ...(await original<typeof import('../lib/desktop')>()),
  desktop: { platform: 'win32', deepseekStatus: (fresh?: boolean) => bridge.status(fresh) },
  hasDeepSeek: true,
}))

import { autoSyncAfterLogin, deepseekBlocker, setupSteps } from '../lib/deepseekGate'
import { STATUS_TTL_MS, useDeepSeekStore } from './deepseek'
import { useToastsStore } from './toasts'
import { useUiStore } from './ui'
import { useWorkspaceStore } from './workspace'

const status = (over: Partial<DeepSeekStatus> = {}): DeepSeekStatus => ({
  installed: true,
  needsDownload: false,
  version: '0.10.2',
  loggedIn: true,
  telemetry: false,
  installRoute: 'winget',
  origin: 'npm',
  sync: 'current',
  syncedAt: 1,
  busy: null,
  ...over,
})

describe('deepseekGate', () => {
  it('names what blocks a DeepSeek pane', () => {
    expect(deepseekBlocker(null)).toBeNull()
    expect(deepseekBlocker(status())).toBeNull()
    expect(deepseekBlocker(status({ installed: false }))).toBe('install')
    expect(deepseekBlocker(status({ installed: false, needsDownload: true }))).toBe('download')
    expect(deepseekBlocker(status({ loggedIn: false }))).toBe('login')
    expect(deepseekBlocker(status({ loggedIn: null }))).toBeNull()
  })

  it('walks the first-run checklist', () => {
    expect(setupSteps(status({ installed: false, loggedIn: null, sync: 'never' })).map((s) => s.state)).toEqual(['next', 'todo', 'todo'])
    expect(setupSteps(status({ loggedIn: false, sync: 'never' })).map((s) => s.state)).toEqual(['done', 'next', 'todo'])
    expect(setupSteps(status({ sync: 'never' })).map((s) => s.state)).toEqual(['done', 'done', 'next'])
    expect(setupSteps(status({ sync: 'stale' })).map((s) => s.state)).toEqual(['done', 'done', 'next'])
    expect(setupSteps(status()).every((s) => s.state === 'done')).toBe(true)
    expect(autoSyncAfterLogin(status({ sync: 'never' }))).toBe(true)
    expect(autoSyncAfterLogin(status({ sync: 'stale' }))).toBe(false)
  })
})

describe('useDeepSeekStore', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    setActivePinia(createPinia())
    bridge.status.mockReset()
  })

  it('asks main at most once a minute unless a level is given', async () => {
    bridge.status.mockResolvedValue(status())
    const ds = useDeepSeekStore()
    await ds.refresh('cache', 1_000)
    await ds.refresh('cache', 1_000 + STATUS_TTL_MS - 1)
    expect(bridge.status).toHaveBeenCalledTimes(1)
    await ds.refresh('cache', 1_000 + STATUS_TTL_MS + 1)
    expect(bridge.status).toHaveBeenCalledTimes(2)
    await ds.refresh('cli')
    expect(bridge.status).toHaveBeenLastCalledWith(true)
    await ds.refresh('page')
    expect(bridge.status).toHaveBeenLastCalledWith(false)
  })

  it('owner launch of DeepSeek opens Settings instead when not set up', async () => {
    bridge.status.mockResolvedValue(status({ loggedIn: false }))
    const ds = useDeepSeekStore()
    await ds.refresh()
    const ws = useWorkspaceStore()
    const ui = useUiStore()
    expect(ws.launch('deepseek', 'C:\\repo')).toBeNull()
    expect(ws.panes).toHaveLength(0)
    expect(ui.settingsOpen).toBe(true)
    expect(ui.settingsPage).toBe('deepseek')
    expect(ds.notice).toBe('login')
    expect(ws.launch('claude', 'C:\\repo')).not.toBeNull()
    const claude = ws.panes[0]!
    expect(ws.split(claude.key, 'row', { kind: 'term', preset: 'deepseek' })).toBeNull()
    expect(ws.panes).toHaveLength(1)
  })

  it('lets DeepSeek through when ready or still unknown', async () => {
    const ws = useWorkspaceStore()
    bridge.status.mockReturnValue(new Promise(() => {}))
    expect(ws.launch('deepseek', 'C:\\repo')).not.toBeNull()
    bridge.status.mockResolvedValue(status())
    await useDeepSeekStore().refresh('cli')
    expect(ws.launch('deepseek', 'C:\\repo')).not.toBeNull()
  })

  it('open_session from an agent: setup error and a toast, no Settings popping up', async () => {
    bridge.status.mockResolvedValue(status({ installed: false }))
    const ds = useDeepSeekStore()
    const blocked = await ds.gateAgent()
    expect(blocked).toBe(true)
    expect(useUiStore().settingsOpen).toBe(false)
    const toast = useToastsStore().list.find((t) => t.id === 'deepseek-setup')
    expect(toast?.actions?.length).toBe(1)
    toast!.actions![0]!.run()
    expect(useUiStore().settingsPage).toBe('deepseek')
    expect(ds.notice).toBe('agent')
    const ws = useWorkspaceStore()
    expect(ws.openFromAgent({ id: 't', preset: 'deepseek', cwd: 'C:\\repo' }, { setupBlocked: blocked })).toEqual({ ok: false, error: 'setup' })
    expect(ws.openFromAgent({ id: 't2', preset: 'claude', cwd: 'C:\\repo' }, { setupBlocked: blocked }).ok).toBe(true)
  })
})
