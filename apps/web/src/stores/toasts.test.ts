import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useToastsStore } from './toasts'

describe('toasts store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
  })
  afterEach(() => vi.useRealTimers())

  it('dedupes by id, keeping the slot and restarting the timer', () => {
    const s = useToastsStore()
    s.push({ id: 'a', kind: 'info', text: 'one', timeoutMs: 1000 })
    s.push({ id: 'b', kind: 'info', text: 'x', timeoutMs: 0 })
    vi.advanceTimersByTime(900)
    s.push({ id: 'a', kind: 'info', text: 'two', timeoutMs: 1000 })
    vi.advanceTimersByTime(900)
    expect(s.list.map((t) => t.text)).toEqual(['two', 'x'])
    vi.advanceTimersByTime(200)
    expect(s.list.map((t) => t.id)).toEqual(['b'])
  })

  it('shows at most three and lets the overflow wait', () => {
    const s = useToastsStore()
    for (const id of ['a', 'b', 'c', 'd']) s.push({ id, kind: 'info', text: id, timeoutMs: 1000 })
    expect(s.visible.map((t) => t.id)).toEqual(['b', 'c', 'd'])
    s.dismiss('d')
    expect(s.visible.map((t) => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('pauses the countdown while held and restarts it on release', () => {
    const s = useToastsStore()
    s.push({ id: 'a', kind: 'info', text: 'a', timeoutMs: 1000 })
    s.hold('a', true)
    vi.advanceTimersByTime(5000)
    expect(s.list).toHaveLength(1)
    s.hold('a', false)
    vi.advanceTimersByTime(1000)
    expect(s.list).toHaveLength(0)
  })

  it('reports why a toast went away, and stays silent on remove', () => {
    const s = useToastsStore()
    const seen: string[] = []
    s.push({ id: 'a', kind: 'undo', text: 'a', timeoutMs: 500, onDismiss: (r) => seen.push(r) })
    s.push({ id: 'b', kind: 'undo', text: 'b', timeoutMs: 0, onDismiss: (r) => seen.push(`b:${r}`) })
    vi.advanceTimersByTime(500)
    expect(s.dismissTop()).toBe(true)
    s.push({ id: 'c', kind: 'info', text: 'c', timeoutMs: 0, onDismiss: () => seen.push('c') })
    s.remove('c')
    expect(seen).toEqual(['timeout', 'b:esc'])
    expect(s.dismissTop()).toBe(false)
  })

  it('never lets a toast waiting behind the cap expire unseen', () => {
    const s = useToastsStore()
    s.push({ id: 'a', kind: 'undo', text: 'a', timeoutMs: 1000 })
    for (const id of ['b', 'c', 'd']) s.push({ id, kind: 'break', text: id, timeoutMs: 0 })
    vi.advanceTimersByTime(5000)
    expect(s.list.map((t) => t.id)).toContain('a')
    s.dismiss('d')
    vi.advanceTimersByTime(1000)
    expect(s.list.map((t) => t.id)).not.toContain('a')
  })
})
