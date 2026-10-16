import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ContextMenu from './ContextMenu.vue'
import type { MenuEntry } from '../../lib/menu'

const entries: MenuEntry[] = [
  { id: 'a', label: 'A' },
  { id: 'p', label: 'P', children: [{ id: 'c1', label: 'C1' }, { id: 'c2', label: 'C2' }] },
  { separator: true },
  { id: 'z', label: 'Z' },
]

let w: VueWrapper | null = null
afterEach(() => {
  w?.unmount()
  w = null
})

async function open() {
  w = mount(ContextMenu, { props: { at: { left: 10, right: 10, top: 10, bottom: 10 }, entries, label: 'menu' }, attachTo: document.body })
  await flushPromises()
  return w
}

const active = () => (document.activeElement as HTMLElement | null)?.dataset.menuId
const key = (k: string) => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }))
const byKey = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }))
const byMouse = () => document.body.dispatchEvent(new PointerEvent('pointerdown', { button: 2, bubbles: true }))
const panel = () => document.querySelector<HTMLElement>('[data-context-menu]')!

describe('ContextMenu opened with the mouse', () => {
  it('focuses the panel and highlights no item', async () => {
    byMouse()
    await open()
    expect(document.activeElement).toBe(panel())
    expect(panel().hasAttribute('data-menu-panel')).toBe(true)
    expect(panel().getAttribute('tabindex')).toBe('-1')
    expect(active()).toBeUndefined()
  })

  it('↓ from the panel highlights the first item, ↑ the last', async () => {
    byMouse()
    await open()
    key('ArrowDown')
    expect(active()).toBe('a')
    panel().focus()
    key('ArrowUp')
    expect(active()).toBe('z')
  })

  it('hover highlights an item, leaving the menu clears it', async () => {
    byMouse()
    await open()
    panel().querySelector<HTMLElement>('[data-menu-id="z"]')!.dispatchEvent(new PointerEvent('pointerenter'))
    expect(active()).toBe('z')
    panel().dispatchEvent(new PointerEvent('pointerleave'))
    expect(document.activeElement).toBe(panel())
  })

  it('keeps the parent of an open submenu highlighted when the pointer heads into the submenu', async () => {
    byMouse()
    await open()
    panel().querySelector<HTMLElement>('[data-menu-id="p"]')!.dispatchEvent(new PointerEvent('pointerenter'))
    await flushPromises()
    expect(document.querySelector('[data-context-submenu]')).not.toBeNull()
    panel().dispatchEvent(new PointerEvent('pointerleave'))
    expect(active()).toBe('p')
  })
})

describe('ContextMenu keyboard', () => {
  it('focuses the first item, opens a submenu with → and focuses its first item', async () => {
    byKey()
    await open()
    expect(active()).toBe('a')
    key('ArrowDown')
    expect(active()).toBe('p')
    key('ArrowRight')
    await flushPromises()
    expect(document.querySelector('[data-context-submenu]')).not.toBeNull()
    expect(active()).toBe('c1')
    key('ArrowLeft')
    await flushPromises()
    expect(active()).toBe('p')
  })

  it('↑ with nothing focused goes to the last item', async () => {
    byKey()
    await open()
    ;(document.activeElement as HTMLElement).blur()
    document.querySelector<HTMLElement>('[data-context-menu]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
    expect(active()).toBe('z')
  })

  it('closes on a pointerdown or a scroll outside, not on its own scroll', async () => {
    const m = await open()
    document.querySelector('[data-context-menu]')!.dispatchEvent(new Event('scroll'))
    expect(m.emitted('close')).toBeUndefined()
    document.dispatchEvent(new Event('scroll'))
    expect(m.emitted('close')).toHaveLength(1)
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    expect(m.emitted('close')).toHaveLength(2)
  })
})
