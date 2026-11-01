import { describe, expect, it } from 'vitest'
import { MAX_PROMPTS, type SavedPrompt } from './promptLibrary'
import { PROMPT_SAMPLES } from './promptSamples'
import { applyImport, exportText, parseImport, planImport } from './promptTransfer'

const mine: SavedPrompt[] = [
  { id: 'a', name: 'Review', text: 'Review {file}', scope: 'global' },
  { id: 'b', name: 'Ship', text: 'Ship it', scope: 'D:/work/app' },
]
let n = 0
const newId = (): string => `n${n++}`

describe('prompt import / export', () => {
  it('round-trips through the export format without ids', () => {
    const text = exportText(mine, new Date('2026-11-01T00:00:00Z'))
    const data = JSON.parse(text)
    expect(data.format).toBe('orrery-prompts')
    expect(data.prompts[0]).toEqual({ name: 'Review', text: 'Review {file}', scope: 'global' })
    expect(parseImport(data)?.map((p) => [p.name, p.scope])).toEqual([
      ['Review', 'global'],
      ['Ship', 'D:/work/app'],
    ])
  })

  it('accepts a bare array, defaults scope and drops bad entries', () => {
    const big = 'x'.repeat(9000)
    const list = parseImport([{ name: 'One', text: 'hi' }, { name: '', text: 'x' }, { name: 'Big', text: big }, 'junk', null])
    expect(list).toEqual([{ id: 'i0', name: 'One', text: 'hi', scope: 'global' }])
    expect(parseImport({ nope: 1 })).toBeNull()
    expect(parseImport('text')).toBeNull()
  })

  it('splits fresh prompts, clashes by name and scope, and identical ones', () => {
    const incoming = parseImport([
      { name: 'review', text: 'Other text' },
      { name: 'Ship', text: 'Ship it', scope: 'D:/work/app' },
      { name: 'Ship', text: 'Ship it', scope: 'global' },
      { name: 'Ship', text: 'again', scope: 'global' },
    ])!
    const plan = planImport(mine, incoming)
    expect(plan.clashes.map((c) => c.existing.id)).toEqual(['a'])
    expect(plan.fresh.map((p) => `${p.name}@${p.scope}`)).toEqual(['Ship@global'])
    expect(plan.same).toBe(2)
  })

  it('overwrites, keeps both with a numbered name, or skips', () => {
    const plan = planImport(mine, parseImport([{ name: 'Review', text: 'New text' }, { name: 'Fresh', text: 'f' }])!)
    const over = applyImport(mine, plan, 'overwrite', newId)
    expect(over.list.find((p) => p.id === 'a')?.text).toBe('New text')
    expect([over.added, over.replaced, over.skipped]).toEqual([1, 1, 0])
    const both = applyImport(mine, plan, 'both', newId)
    expect(both.list.map((p) => p.name)).toEqual(['Review', 'Ship', 'Review (2)', 'Fresh'])
    const skip = applyImport(mine, plan, 'skip', newId)
    expect([skip.added, skip.replaced, skip.skipped, skip.list.length]).toEqual([1, 0, 1, 3])
  })

  it('never goes over the library limit', () => {
    const full = Array.from({ length: MAX_PROMPTS - 1 }, (_, i) => ({ id: `x${i}`, name: `P${i}`, text: 't', scope: 'global' }))
    const out = applyImport(full, planImport(full, parseImport([{ name: 'A', text: '1' }, { name: 'B', text: '2' }])!), 'skip', newId)
    expect(out.list).toHaveLength(MAX_PROMPTS)
    expect([out.added, out.dropped]).toEqual([1, 1])
  })

  it('ships 12 samples in both languages using only known variables', () => {
    expect(PROMPT_SAMPLES).toHaveLength(12)
    expect(new Set(PROMPT_SAMPLES.map((s) => s.id)).size).toBe(12)
    for (const s of PROMPT_SAMPLES)
      for (const lang of ['en', 'vi'] as const) {
        expect(s.name[lang].trim()).not.toBe('')
        const vars = [...s.text[lang].matchAll(/\{(\w+)\}/g)].map((m) => m[1])
        expect(vars.every((v) => ['file', 'selection', 'branch', 'diffstat', 'checks', 'wt'].includes(v!))).toBe(true)
        expect(vars.length).toBeGreaterThan(0)
      }
  })
})
