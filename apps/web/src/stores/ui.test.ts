import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

vi.mock('../lib/desktop', async (original) => ({ ...(await original<typeof import('../lib/desktop')>()), hasTerminals: true }))

const { useUiStore } = await import('./ui')

describe('start view', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    setActivePinia(createPinia())
  })

  it('opens on the Workspace, even when the last run ended on Monitor', () => {
    localStorage.setItem('ccm.view', 'monitor')
    expect(useUiStore().view).toBe('workspace')
  })

  it('keeps the current view across a reload in the same window', () => {
    sessionStorage.setItem('ccm.view', 'usage')
    expect(useUiStore().view).toBe('usage')
  })

  it('remembers a switch only for this window', async () => {
    useUiStore().setView('history')
    await nextTick()
    expect(sessionStorage.getItem('ccm.view')).toBe('history')
    expect(localStorage.getItem('ccm.view')).toBeNull()
  })
})
