import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { PromptSearchHit } from '@ccm/shared'
import { i18n } from '../../i18n'
import { usePromptSearchStore } from '../../stores/promptSearch'
import PromptSearchCard from './PromptSearchCard.vue'

const hit = (n: number, extra: Partial<PromptSearchHit> = {}): PromptSearchHit => ({
  sessionId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  cwd: 'D:\\work\\shop',
  cwdExists: true,
  lastAt: '2026-10-20T09:00:00.000Z',
  startedAt: '2026-10-20T08:00:00.000Z',
  matches: 2,
  snippets: ['add the <b>PayWall</b> screen'],
  ...extra,
})

describe('prompt search store', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('ignores events of an older search and appends hits', () => {
    const s = usePromptSearchStore()
    s.query = 'Paywall screen'
    s.begin('b')
    expect(s.terms).toEqual(['paywall', 'screen'])
    s.applyProgress({ searchId: 'a', filesDone: 1, filesTotal: 2, hits: [hit(9)] })
    s.applyProgress({ searchId: 'b', filesDone: 1, filesTotal: 3, hits: [hit(1)] })
    s.applyProgress({ searchId: 'b', filesDone: 3, filesTotal: 3, hits: [hit(2)] })
    s.applyDone({ searchId: 'a', state: 'cancelled', filesDone: 1, filesTotal: 2, sessions: 1 })
    expect(s.running).toBe(true)
    s.applyDone({ searchId: 'b', state: 'capped', filesDone: 3, filesTotal: 3, sessions: 2 })
    expect(s.hits.map((h) => h.sessionId.slice(-1))).toEqual(['1', '2'])
    expect(s.phase).toBe('capped')
    s.applyOpen({ searchId: 'b', sessionId: hit(1).sessionId, result: 'notFound' })
    expect(s.openResults[hit(1).sessionId]).toBe('notFound')
  })
})

describe('PromptSearchCard', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('renders snippets as text with the match highlighted, never as HTML', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const s = usePromptSearchStore()
    s.query = 'paywall'
    s.begin('x')
    s.applyProgress({ searchId: 'x', filesDone: 1, filesTotal: 1, hits: [hit(1), hit(2, { cwdExists: false, title: 'Shop paywall' })] })
    s.applyDone({ searchId: 'x', state: 'done', filesDone: 1, filesTotal: 1, sessions: 2 })
    const w = mount(PromptSearchCard, { global: { plugins: [pinia, i18n] } })
    const rows = w.findAll('[data-prompt-search-hit]')
    expect(rows).toHaveLength(2)
    const snippet = rows[0]!.find('[data-prompt-search-snippet]')
    expect(snippet.find('b').exists()).toBe(false)
    expect(snippet.text()).toContain('<b>PayWall</b>')
    expect(snippet.find('mark').text()).toBe('PayWall')
    expect(rows[1]!.text()).toContain('Shop paywall')
    expect(rows[1]!.find('[data-prompt-search-open]').attributes('disabled')).toBeDefined()
    expect(rows[1]!.find('[data-prompt-search-resume]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-prompt-search-status]').attributes('data-state')).toBe('done')
    w.unmount()
  })
})
