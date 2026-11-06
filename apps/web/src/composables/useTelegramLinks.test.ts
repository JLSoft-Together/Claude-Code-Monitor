import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Pane } from '../stores/workspace'
import { useTelegramStore } from '../stores/telegram'
import { useUiStore } from '../stores/ui'

const openExternal = vi.hoisted(() => vi.fn(() => Promise.resolve(true)))
vi.mock('../lib/preview', async (orig) => ({ ...(await orig<typeof import('../lib/preview')>()), openExternal }))

import { openTelegramGlyph } from './useTelegramLinks'

const SESSION = '0f8fad5b-d9cb-469f-a165-70867728950e'
const pane = { key: 'p1', kind: 'term', preset: 'claude', cwd: 'C:\work\A', terminalId: 't1', agentSessionId: SESSION } as unknown as Pane

function route(chatId: string, threadId: number | null) {
  useTelegramStore().state = { sessionRoutes: [{ session: SESSION, name: 'A', project: 'C:\work\A', chatId, threadId }] } as never
}

describe('openTelegramGlyph', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    openExternal.mockClear()
  })

  it('opens the topic link in Telegram', () => {
    route('-1001234567', 9)
    openTelegramGlyph(pane, 'A')
    expect(openExternal).toHaveBeenCalledWith('https://t.me/c/1234567/9')
    expect(useUiStore().telegramLink).toBeNull()
  })

  it('falls back to the link dialog when the group has no topic link', () => {
    route('-4242', null)
    openTelegramGlyph(pane, 'A')
    expect(openExternal).not.toHaveBeenCalled()
    expect(useUiStore().telegramLink).toEqual({ cwd: 'C:\work\A', session: SESSION, name: 'A' })
  })

  it('opens the dialog for a pane that is not connected yet', () => {
    useTelegramStore().state = { sessionRoutes: [] } as never
    openTelegramGlyph(pane, 'A')
    expect(openExternal).not.toHaveBeenCalled()
    expect(useUiStore().telegramLink).not.toBeNull()
  })

  it('opens the project topic for a pane whose folder is connected (session without its own topic)', () => {
    useTelegramStore().state = { sessionRoutes: [], routes: [{ project: 'C:/proj', label: 'P', chatId: '-1001234567', threadId: 8, where: 'G › P' }] } as never
    const inProj = { ...pane, cwd: 'C:/proj/sub' } as Pane
    openTelegramGlyph(inProj, 'A')
    expect(openExternal).toHaveBeenCalledWith('https://t.me/c/1234567/8')
  })
})
