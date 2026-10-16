import { describe, expect, it } from 'vitest'
import type { MenuEntry } from './menu'
import { isHeadBlank, isShownIn, moreKey, overflowEntries, processChip, STATE_BADGE, suggestCompact, zoomKeys } from './paneHead'

describe('STATE_BADGE', () => {
  it('draws the rail words with the rail glyphs', () => {
    expect(STATE_BADGE.idle).toBe('idle')
    expect(STATE_BADGE.failed).toBe('error')
    expect(STATE_BADGE.asked).toBe('waiting')
    expect(STATE_BADGE.working).toBe('working')
    expect(STATE_BADGE.subagents).toBe('working')
    expect(STATE_BADGE.done).toBe('completed')
    expect(STATE_BADGE.ended).toBe('completed')
  })
})

describe('processChip', () => {
  it('stays quiet while the process runs', () => {
    expect(processChip('running')).toBeNull()
  })
  it('names starting, exited and broken processes', () => {
    expect(processChip('starting')).toBe('starting')
    expect(processChip('exited')).toBe('exited')
    expect(processChip('error')).toBe('error')
    expect(processChip('gone')).toBe('error')
  })
})

describe('suggestCompact', () => {
  it('needs a nearly full context and an idle agent', () => {
    expect(suggestCompact(85, 'ready')).toBe(true)
    expect(suggestCompact(80, 'ready')).toBe(true)
    expect(suggestCompact(79.9, 'ready')).toBe(false)
    expect(suggestCompact(95, 'busy')).toBe(false)
    expect(suggestCompact(95, 'running')).toBe(false)
    expect(suggestCompact(null, 'ready')).toBe(false)
    expect(suggestCompact(undefined, null)).toBe(false)
  })
})

describe('zoomKeys', () => {
  it('uses the platform chord', () => {
    expect(zoomKeys(true)).toBe('⌘⇧↩')
    expect(zoomKeys(false)).toBe('Ctrl+Shift+Enter')
  })
})

describe('overflowEntries', () => {
  const entries: MenuEntry[] = [
    { id: 'dev', label: 'Dev' },
    { id: 'compact', label: 'Compact' },
    { separator: true },
    { id: 'attach', label: 'Attach' },
    { id: 'restart', label: 'Restart' },
    { separator: true },
    { id: 'layout:code', label: 'Code' },
    { id: 'layout:design', label: 'Design' },
  ]
  const ids = (list: MenuEntry[]): string[] => list.map((e) => ('separator' in e ? '|' : e.id))

  it('lists only what the bar is not showing', () => {
    const shown = new Set(['dev', 'compact', 'layout'])
    expect(ids(overflowEntries(entries, (k) => shown.has(k)))).toEqual(['attach', 'restart'])
  })
  it('keeps one separator between groups and none at the ends', () => {
    expect(ids(overflowEntries(entries, (k) => k === 'attach' || k === 'restart'))).toEqual(['dev', 'compact', '|', 'layout:code', 'layout:design'])
    expect(ids(overflowEntries(entries, () => false))).toEqual(['dev', 'compact', '|', 'attach', 'restart', '|', 'layout:code', 'layout:design'])
    expect(overflowEntries(entries, () => true)).toEqual([])
  })
  it('matches grouped ids by their prefix', () => {
    expect(moreKey('layout:split')).toBe('layout')
    expect(moreKey('wrap')).toBe('wrap')
  })
})

describe('isShownIn', () => {
  it('treats a missing or unrendered element as hidden', () => {
    const scope = document.createElement('div')
    scope.innerHTML = '<button data-more="attach"></button>'
    const button = scope.querySelector('button')!
    button.getClientRects = () => [{}] as unknown as DOMRectList
    expect(isShownIn(scope, 'attach')).toBe(true)
    button.getClientRects = () => [] as unknown as DOMRectList
    expect(isShownIn(scope, 'attach')).toBe(false)
    expect(isShownIn(scope, 'scripts')).toBe(false)
  })
})

describe('isHeadBlank', () => {
  function head(): HTMLElement {
    const el = document.createElement('header')
    el.innerHTML =
      '<span data-name>Shell</span><span data-chip data-pane-chip><span data-inner>Ready</span></span><button type="button"><svg data-icon></svg></button><a href="#" data-link>x</a><input data-input />'
    document.body.append(el)
    return el
  }

  it('accepts the bar itself and plain text', () => {
    const h = head()
    expect(isHeadBlank(h, h)).toBe(true)
    expect(isHeadBlank(h.querySelector('[data-name]'), h)).toBe(true)
    expect(isHeadBlank(h.querySelector('[data-name]')!.firstChild, h)).toBe(true)
    h.remove()
  })
  it('ignores buttons, links, fields and chips', () => {
    const h = head()
    expect(isHeadBlank(h.querySelector('button'), h)).toBe(false)
    expect(isHeadBlank(h.querySelector('[data-icon]'), h)).toBe(false)
    expect(isHeadBlank(h.querySelector('[data-link]'), h)).toBe(false)
    expect(isHeadBlank(h.querySelector('[data-input]'), h)).toBe(false)
    expect(isHeadBlank(h.querySelector('[data-inner]'), h)).toBe(false)
    h.remove()
  })
  it('ignores targets outside the bar', () => {
    const h = head()
    const other = document.createElement('div')
    document.body.append(other)
    expect(isHeadBlank(other, h)).toBe(false)
    expect(isHeadBlank(null, h)).toBe(false)
    other.remove()
    h.remove()
  })
  it('does not count an interactive ancestor of the bar', () => {
    const wrap = document.createElement('div')
    wrap.setAttribute('role', 'group')
    const h = document.createElement('div')
    h.innerHTML = '<span data-name>File</span>'
    wrap.append(h)
    document.body.append(wrap)
    expect(isHeadBlank(h.querySelector('[data-name]'), h)).toBe(true)
    wrap.remove()
  })
})
