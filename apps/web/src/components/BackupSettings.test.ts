import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { i18n } from '../i18n'

const bridge = vi.hoisted(() => ({ export: vi.fn(), pick: vi.fn(), apply: vi.fn(), relaunch: vi.fn() }))
vi.mock('../lib/backup', async (orig) => ({ ...(await orig<typeof import('../lib/backup')>()), backupBridge: bridge, hasBackup: true }))

import BackupSettings from './BackupSettings.vue'

let w: VueWrapper | null = null
const t = (k: string, p?: Record<string, unknown>): string => i18n.global.t(k, p ?? {})

beforeEach(() => {
  localStorage.clear()
  i18n.global.locale.value = 'en'
  for (const f of Object.values(bridge)) f.mockReset()
  bridge.relaunch.mockResolvedValue(true)
})
afterEach(() => {
  w?.unmount()
  w = null
})

const PREVIEW = {
  ok: true, token: 'tok', file: 'orrery-backup-2026-10-29.json', app: '2.5.0', platform: 'darwin', createdAt: '2026-10-29T10:00:00Z',
  sections: [
    { id: 'appearance', count: 3, missingPaths: [] },
    { id: 'workspace', count: 2, missingPaths: ['/Users/a/proj'] },
    { id: 'github', count: 1, missingPaths: [] },
  ],
  github: ['octo'],
}

describe('BackupSettings', () => {
  it('previews sections, flags missing paths and imports the checked ones', async () => {
    bridge.pick.mockResolvedValue(PREVIEW)
    bridge.apply.mockResolvedValue({ ok: true, local: { 'ccm.theme': 'light' }, github: ['octo'] })
    w = mount(BackupSettings, { global: { plugins: [i18n] } })
    await w.get('[data-backup-import]').trigger('click')
    await flushPromises()
    expect(w.findAll('[data-backup-section]').length).toBe(3)
    expect(w.get('[data-backup-section="workspace"] [data-backup-missing]').text()).toContain('/Users/a/proj')
    expect(w.get('[data-backup-github]').text()).toContain('octo')
    await w.get('[data-backup-section="workspace"] input').setValue(false)
    await w.get('[data-backup-apply]').trigger('click')
    await flushPromises()
    expect(bridge.apply).toHaveBeenCalledWith('tok', ['appearance', 'github'])
    expect(localStorage.getItem('ccm.theme')).toBe('light')
    expect(bridge.relaunch).toHaveBeenCalled()
    expect(w.get('[data-backup-restart]').text()).toBe(t('backup.restartPending'))
    expect(w.get('[data-backup-reminder]').text()).toContain('octo')
  })

  it('shows the export result and errors, ignores cancel', async () => {
    bridge.export.mockResolvedValueOnce({ ok: false, error: 'cancelled' }).mockResolvedValueOnce({ ok: true, file: 'C:/x/orrery-backup.json', sections: [] })
    bridge.pick.mockResolvedValue({ ok: false, error: 'invalid' })
    w = mount(BackupSettings, { global: { plugins: [i18n] } })
    await w.get('[data-backup-export]').trigger('click')
    await flushPromises()
    expect(w.find('[data-backup-error]').exists()).toBe(false)
    await w.get('[data-backup-export]').trigger('click')
    await flushPromises()
    expect(w.get('[data-backup-exported]').text()).toContain('C:/x/orrery-backup.json')
    await w.get('[data-backup-import]').trigger('click')
    await flushPromises()
    expect(w.get('[data-backup-error]').text()).toBe(t('backup.error.invalid'))
  })
})
