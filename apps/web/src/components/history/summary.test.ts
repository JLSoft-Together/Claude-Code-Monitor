import { describe, expect, it } from 'vitest'
import { summaryLine } from './summary'

const label = { working: (d: string) => `làm ${d}`, waiting: (d: string) => `chờ ${d}`, idle: (d: string) => `rảnh ${d}` }
const fmt = (ms: number) => `${Math.round(ms / 1000)}s`

describe('summaryLine', () => {
  it('joins the three states in fixed order', () => {
    expect(summaryLine({ working: 86_000, waiting: 161_000, idle: 20_000 }, fmt, label)).toBe('làm 86s · chờ 161s · rảnh 20s')
  })

  it('leaves out states with no time', () => {
    expect(summaryLine({ working: 5_000, waiting: 0, idle: 0 }, fmt, label)).toBe('làm 5s')
  })

  it('is empty when nothing was recorded', () => {
    expect(summaryLine({ working: 0, waiting: 0, idle: 0 }, fmt, label)).toBe('')
  })

  it('skips a label that renders nothing', () => {
    expect(summaryLine({ working: 1_000, waiting: 2_000, idle: 0 }, fmt, { ...label, waiting: () => '' })).toBe('làm 1s')
  })
})
