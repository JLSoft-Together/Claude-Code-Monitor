import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { TerminalStatus } from '@ccm/shared'

const info = reactive({ status: 'idle' as TerminalStatus | undefined, compactions: 0 })
const readFile = vi.fn(async (_p: string) => ({ kind: 'text' }) as { kind: string })

describe('Compact flow auto mode', () => {
  let compact: ReturnType<typeof import('./useCompact').useCompact>
  let ws: ReturnType<typeof import('../stores/workspace').useWorkspaceStore>
  let settings: ReturnType<typeof import('../stores/settings').useSettingsStore>
  let key: string

  const paneOf = () => ws.panes.find((p) => p.key === key)!
  const settle = async (): Promise<void> => {
    await nextTick()
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()
  }

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.resetModules()
    localStorage.clear()
    sessionStorage.clear()
    setActivePinia(createPinia())
    Object.assign(info, { status: 'idle', compactions: 0 })
    readFile.mockClear().mockResolvedValue({ kind: 'text' })
    vi.doMock('vue-i18n', async (orig) => ({ ...(await orig<typeof import('vue-i18n')>()), useI18n: () => ({ t: (k: string) => k }) }))
    vi.doMock('../lib/desktop', async (orig) => ({ ...(await orig<typeof import('../lib/desktop')>()), desktop: { readFile } }))
    vi.doMock('./usePaneInfo', () => ({
      usePaneInfo: () => ({ statusOf: () => info.status, titleOf: () => 'A', sessionOf: () => ({ cwd: 'C:\work\A', compactions: info.compactions }) }),
    }))
    ;(window as unknown as { ccmDesktop: unknown }).ccmDesktop = { platform: 'win32' }
    ws = (await import('../stores/workspace')).useWorkspaceStore()
    settings = (await import('../stores/settings')).useSettingsStore()
    compact = (await import('./useCompact')).useCompact()
    const p = ws.open('claude', 'C:\work\A')
    key = p.key
    ws.update(key, { sessionId: 'pty-a', terminalId: 'term-a', state: 'running' })
  })

  async function toCompactStep(): Promise<void> {
    expect(compact.start(key)).toBe(true)
    info.status = 'working'
    await settle()
    info.status = 'idle'
    await settle()
  }

  it('auto: arms Enter for /compact, then for the resume line after a compaction, each once', async () => {
    expect(settings.compactAuto).toBe(true)
    await toCompactStep()
    expect(paneOf()).toMatchObject({ prefill: '/compact', prefillSubmit: true, compact: { step: 'compact', auto: true } })
    expect(paneOf().prefillAuto).toBeGreaterThan(0)
    ws.update(key, { prefill: undefined, prefillSubmit: undefined, prefillAuto: undefined })
    info.compactions = 1
    await settle()
    expect(paneOf()).toMatchObject({ prefill: 'workspace.compact.resume', prefillSubmit: true, compact: undefined })
    ws.update(key, { prefill: undefined, prefillSubmit: undefined, prefillAuto: undefined })
    info.status = 'working'
    await settle()
    info.status = 'idle'
    await settle()
    expect(paneOf().prefill).toBeUndefined()
  })

  it('off: only fills in, never arms Enter', async () => {
    settings.compactAuto = false
    await toCompactStep()
    expect(paneOf()).toMatchObject({ prefill: '/compact', prefillSubmit: undefined, prefillAuto: undefined })
    info.compactions = 1
    await settle()
    expect(paneOf()).toMatchObject({ prefill: 'workspace.compact.resume', prefillSubmit: undefined })
  })

  it('manual typing disarms the pending /compact and the flow', async () => {
    await toCompactStep()
    compact.stopAuto(key)
    expect(paneOf()).toMatchObject({ prefill: '/compact', prefillSubmit: undefined, prefillAuto: undefined, compact: { auto: false } })
    info.compactions = 1
    await settle()
    expect(paneOf()).toMatchObject({ prefill: 'workspace.compact.resume', prefillSubmit: undefined })
  })

  it('typing while the agent still writes the handoff keeps the writing prompt but stops auto', async () => {
    compact.start(key)
    compact.stopAuto(key)
    expect(paneOf()).toMatchObject({ prefillSubmit: true, compact: { auto: false } })
  })

  it('cancel drops the armed /compact', async () => {
    await toCompactStep()
    compact.cancel(key)
    expect(paneOf()).toMatchObject({ prefill: undefined, prefillSubmit: undefined, prefillAuto: undefined, compact: undefined })
  })

  it('a step that waits over 10 minutes falls back to fill-in', async () => {
    await toCompactStep()
    await vi.advanceTimersByTimeAsync(11 * 60_000)
    expect(paneOf()).toMatchObject({ prefill: '/compact', prefillSubmit: undefined, prefillAuto: undefined, compact: { auto: false } })
  })

  it('a missing handoff file keeps waiting instead of sending /compact', async () => {
    readFile.mockResolvedValue({ kind: 'missing' })
    await toCompactStep()
    expect(paneOf()).toMatchObject({ prefill: expect.stringContaining('workspace.compact.prompt'), compact: { step: 'writing', missing: true } })
  })
})
