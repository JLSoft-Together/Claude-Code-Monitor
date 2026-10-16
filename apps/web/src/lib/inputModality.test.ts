import { describe, expect, it } from 'vitest'
import { lastInput, openedByKey } from './inputModality'

describe('input modality', () => {
  it('follows the last pointer press or key press anywhere in the window', () => {
    const el = document.createElement('button')
    document.body.appendChild(el)
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }))
    expect(lastInput()).toBe('key')
    expect(openedByKey()).toBe(true)
    el.dispatchEvent(new PointerEvent('pointerdown', { button: 2, bubbles: true }))
    expect(lastInput()).toBe('pointer')
    expect(openedByKey()).toBe(false)
    el.remove()
  })

  it('still sees events whose handlers stop propagation', () => {
    const el = document.createElement('div')
    document.body.appendChild(el)
    el.addEventListener('keydown', (e) => e.stopPropagation())
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true }))
    expect(lastInput()).toBe('key')
    el.remove()
  })
})
