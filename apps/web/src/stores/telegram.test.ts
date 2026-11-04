import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const telegramSet = vi.fn()

vi.mock('../lib/telegram', () => ({
  hasTelegram: true,
  onTelegram: vi.fn(() => () => undefined),
  telegramCreateTopic: vi.fn(),
  telegramDiscover: vi.fn(),
  telegramInstallCommand: vi.fn(),
  telegramInstallReceive: vi.fn(),
  telegramPair: vi.fn(),
  telegramRouteRemove: vi.fn(),
  telegramRouteSet: vi.fn(),
  telegramSet: (...a: unknown[]) => telegramSet(...a),
  telegramState: vi.fn(async () => null),
  telegramTest: vi.fn(),
  telegramUnpair: vi.fn(),
}))

import { useTelegramStore } from './telegram'

describe('telegram store toggle', () => {
  beforeEach(() => {
    telegramSet.mockReset()
    setActivePinia(createPinia())
  })

  it('returns the failure, keeps state and clears busy', async () => {
    const tg = useTelegramStore()
    const before = { configured: true, enabled: false }
    tg.state = before as never
    telegramSet.mockResolvedValue({ ok: false, error: 'keychain' })
    const res = await tg.toggle()
    expect(res).toEqual({ ok: false, error: 'keychain' })
    expect(telegramSet).toHaveBeenCalledWith({ enabled: true })
    expect(tg.state).toBe(before)
    expect(tg.busy).toBe(false)
  })

  it('applies the new state on success', async () => {
    const tg = useTelegramStore()
    tg.state = { configured: true, enabled: false } as never
    telegramSet.mockResolvedValue({ ok: true, state: { configured: true, enabled: true } })
    const res = await tg.toggle()
    expect(res.ok).toBe(true)
    expect(tg.enabled).toBe(true)
    expect(tg.busy).toBe(false)
  })
})
