import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { i18n } from '../i18n'
import { useActivityStore } from '../stores/activity'
import { useTerminalsStore } from '../stores/terminals'
import ActivityFeed from './ActivityFeed.vue'

let w: VueWrapper | null = null

afterEach(() => {
  w?.unmount()
  w = null
  document.body.innerHTML = ''
  i18n.global.locale.value = 'en'
})

describe('activity feed peer messages', () => {
  it('shows a peer message with the mail glyph and both names', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    i18n.global.locale.value = 'en'
    useTerminalsStore().replaceAll([])
    useActivityStore().replaceAll([
      { id: 'p1', at: new Date().toISOString(), kind: 'peer.message', terminalId: 't1', data: { title: 'coordinator', to: 'api' } },
      { id: 'p2', at: new Date().toISOString(), kind: 'agent.started', terminalId: 't1', data: { agentType: 'Explore' } },
    ])
    w = mount(ActivityFeed, { global: { plugins: [i18n, pinia] }, attachTo: document.body })
    await flushPromises()
    const rows = w.findAll('li')
    const peer = rows.find((r) => r.text().includes('coordinator sent a message to api'))
    expect(peer).toBeDefined()
    expect(peer!.find('[data-activity-peer]').exists()).toBe(true)
    expect(peer!.text()).not.toContain('peer.message')
    const other = rows.find((r) => !r.text().includes('coordinator sent'))
    expect(other!.find('[data-activity-peer]').exists()).toBe(false)
  })

  it('reads the receiver in Vietnamese', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useActivityStore().replaceAll([{ id: 'p1', at: new Date().toISOString(), kind: 'peer.message', terminalId: 't1', data: { title: 'A', to: 'B' } }])
    w = mount(ActivityFeed, { global: { plugins: [i18n, pinia] }, attachTo: document.body })
    i18n.global.locale.value = 'vi'
    await flushPromises()
    expect(w.text()).toContain('A gửi tin cho B')
  })
})
