import { describe, expect, it } from 'vitest'
import { firesOn, isAutoSaveMode } from './autoSave'

describe('autoSave', () => {
  it('knows the four VS Code modes', () => {
    expect(['off', 'afterDelay', 'onFocusChange', 'onWindowChange'].every(isAutoSaveMode)).toBe(true)
    expect(isAutoSaveMode('always')).toBe(false)
    expect(isAutoSaveMode(null)).toBe(false)
  })

  it('maps triggers to modes', () => {
    expect(firesOn('off', 'edit')).toBe(false)
    expect(firesOn('off', 'windowBlur')).toBe(false)
    expect(firesOn('afterDelay', 'edit')).toBe(true)
    expect(firesOn('afterDelay', 'focusOut')).toBe(false)
    expect(firesOn('onFocusChange', 'focusOut')).toBe(true)
    expect(firesOn('onFocusChange', 'windowBlur')).toBe(true)
    expect(firesOn('onFocusChange', 'edit')).toBe(false)
    expect(firesOn('onWindowChange', 'windowBlur')).toBe(true)
    expect(firesOn('onWindowChange', 'focusOut')).toBe(false)
  })
})
