import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import type { UsageBucket } from '@ccm/shared'
import { i18n } from '../../i18n'
import { compactNumber } from '../../lib/format'
import { dayKey, useUsageStore } from '../../stores/usage'
import { useExtrasStore } from '../../stores/extras'
import UsageView from './UsageView.vue'

const today = dayKey(new Date())
const yesterday = dayKey(new Date(Date.now() - 86_400_000))

const bucket = (day: string, model: string, project: string, output: number): UsageBucket => ({
  key: `${day}|${model}|${project}`,
  day,
  model,
  project,
  messages: 1,
  input: 10,
  output,
  cacheWrite5m: 1000,
  cacheWrite1h: 0,
  cacheRead: 10_000,
})

let w: VueWrapper | null = null

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  i18n.global.locale.value = 'en'
})

afterEach(() => {
  w?.unmount()
  w = null
  document.body.innerHTML = ''
})

async function mountWithData() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const usage = useUsageStore()
  usage.reset({
    buckets: [
      ...Array.from({ length: 8 }, (_, i) => bucket(today, 'claude-opus-5-5', `D:/work/p${i}`, (i + 1) * 1000)),
      bucket(yesterday, 'claude-haiku-4-5', 'D:/work/p0', 50_000),
    ],
    scan: { state: 'ready', filesDone: 1, filesTotal: 1 },
  })
  w = mount(UsageView, { global: { plugins: [i18n, pinia] }, attachTo: document.body })
  await flushPromises()
  await new Promise((r) => setTimeout(r, 400))
  return usage
}

describe('Usage view', () => {
  it('shows the hero total of the visible series, the legend, top projects and models', async () => {
    const usage = await mountWithData()
    const html = w!.html()
    expect(html).toContain(compactNumber(usage.heroTotal))
    expect(w!.findAll('[role="group"] button[aria-pressed]')).toHaveLength(4)
    expect(w!.find('#usage-projects-title').exists()).toBe(true)
    expect(w!.findAll('section[aria-labelledby="usage-projects-title"] li')).toHaveLength(6)
    expect(w!.findAll('section[aria-labelledby="usage-models-title"] li')).toHaveLength(2)
    expect(html).toContain('See all 8 projects')
    expect(html).toContain('excluding Cache read')
    expect(w!.find('#usage-limits-title').exists()).toBe(false)
  })

  it('picks a day from the chart and clears it with Esc', async () => {
    const usage = await mountWithData()
    const columns = w!.findAll('svg g.usage-col > rect')
    expect(columns.length).toBe(7)
    await columns.at(-2)!.trigger('click')
    expect(usage.selectedDay).toBe(yesterday)
    expect(usage.byModel.map((r) => r.id)).toEqual(['claude-haiku-4-5'])
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(usage.selectedDay).toBeNull()
  })

  it('filters by a project row and opens every project in a sheet', async () => {
    const usage = await mountWithData()
    const first = w!.find('section[aria-labelledby="usage-projects-title"] li button')
    await first.trigger('click')
    expect(usage.project).toBe(usage.topProjects[0]!.id)
    await w!.find('section[aria-labelledby="usage-projects-title"] button[aria-haspopup="dialog"]').trigger('click')
    await flushPromises()
    expect(document.body.querySelector('[role="dialog"] h2')?.textContent).toBe('All projects')
  })

  it('shows plan limits beside the chart when the bridge reports them', async () => {
    await mountWithData()
    useExtrasStore().setLimits({ fiveHour: { usedPct: 85 }, sevenDay: { usedPct: 20 }, updatedAt: new Date().toISOString() })
    await flushPromises()
    expect(w!.find('#usage-limits-title').exists()).toBe(true)
    expect(w!.text()).toContain('15%')
    expect(w!.text()).toContain('Getting close')
  })
})
