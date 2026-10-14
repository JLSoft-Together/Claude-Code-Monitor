import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { clampCodeSize, CODE_FONTS, CODE_SIZE_DEFAULT, CODE_SIZE_MAX, CODE_SIZE_MIN, fontEntry, fontStack, isFontId, SYSTEM_MONO, SYSTEM_SANS, UI_FONTS, visibleFonts } from './fonts'
import { codeSizeKey, createWheelStepper, wheelZone } from '../composables/useWheelZoom'

// Read from disk: vitest turns CSS imports into empty modules.
// happy-dom (Element for wheelZone) gives import.meta.url a non-file scheme; vitest runs from apps/web.
const fontsCss = readFileSync(path.join(process.cwd(), 'src/fonts.css'), 'utf8')
const families = (css: string): Map<string, string[]> => {
  const out = new Map<string, string[]>()
  for (const m of css.matchAll(/\/\* ([a-z0-9-]+) \*\/\s*@font-face \{[^}]*font-family: '([^']+)'/g)) out.set(m[2]!, [...(out.get(m[2]!) ?? []), m[1]!])
  return out
}

describe('font catalogue', () => {
  it('ids are unique per kind and the first entry is the system default', () => {
    for (const list of [CODE_FONTS, UI_FONTS]) {
      expect(new Set(list.map((f) => f.id)).size).toBe(list.length)
      expect(list[0]).toMatchObject({ id: 'system', family: '', source: 'system' })
    }
  })

  it('fonts.css has every bundled family, and nothing else', () => {
    const css = families(fontsCss)
    const bundled = [...CODE_FONTS, ...UI_FONTS].filter((f) => f.source === 'bundled').map((f) => f.family)
    expect([...css.keys()].sort()).toEqual([...bundled].sort())
  })

  it('every bundled face is upright latin / latin-ext / vietnamese, and every UI font covers Vietnamese', () => {
    for (const [family, names] of families(fontsCss)) {
      for (const n of names) expect(n, family).toMatch(/-(latin|latin-ext|vietnamese)-(wght|\d{3})-normal$/)
      const ui = UI_FONTS.some((f) => f.family === family)
      if (ui) expect(names.some((n) => n.includes('-vietnamese-')), family).toBe(true)
    }
    expect(fontsCss).not.toMatch(/https?:/)
  })

  it('stacks put the chosen family first and end with the system stack', () => {
    expect(fontStack(fontEntry('code', 'jetbrains-mono'))).toBe(`'JetBrains Mono Variable', ${SYSTEM_MONO}`)
    expect(fontStack(fontEntry('ui', 'inter'))).toBe(`'Inter Variable', ${SYSTEM_SANS}`)
    expect(fontStack(fontEntry('code', 'system'))).toBe(SYSTEM_MONO)
    expect(fontEntry('code', 'nope').id).toBe('system')
    expect(isFontId('code', 'consolas')).toBe(true)
    expect(isFontId('ui', 'consolas')).toBe(false)
  })

  it('hides the other platform’s system fonts', () => {
    const win = visibleFonts('code', 'win32').map((f) => f.id)
    const mac = visibleFonts('code', 'darwin').map((f) => f.id)
    expect(win).toContain('consolas')
    expect(win).not.toContain('menlo')
    expect(mac).toContain('menlo')
    expect(mac).not.toContain('consolas')
  })

  it('code size clamps and falls back to the default', () => {
    expect(clampCodeSize(5)).toBe(CODE_SIZE_MIN)
    expect(clampCodeSize(99)).toBe(CODE_SIZE_MAX)
    expect(clampCodeSize(14.4)).toBe(14)
    expect(clampCodeSize(Number.NaN)).toBe(CODE_SIZE_DEFAULT)
  })
})

describe('ctrl + wheel', () => {
  const el = (closest: Record<string, boolean>) => Object.assign(Object.create(Element.prototype), { closest: (sel: string) => (closest[sel] ? {} : null) })

  it('code areas size the code font, the map keeps its zoom, the rest zooms the app', () => {
    expect(wheelZone(el({ '[data-code-zoom]': true }))).toBe('code')
    expect(wheelZone(el({ '.vue-flow': true }))).toBe('map')
    expect(wheelZone(el({}))).toBe('app')
    expect(wheelZone(null)).toBe('app')
  })

  it('one step per notch, trackpad deltas build up, a direction change starts over', () => {
    const step = createWheelStepper(50)
    expect(step(-100)).toBe(1)
    expect(step(100)).toBe(-1)
    expect([step(-20), step(-20), step(-20)]).toEqual([0, 0, 1])
    expect([step(-30), step(30), step(30)]).toEqual([0, 0, -1])
  })

  it('Ctrl/⌘ + Alt + = - 0 change the code size, by physical key', () => {
    const k = (code: string, mods: Partial<KeyboardEvent> = {}) => ({ code, ctrlKey: true, metaKey: false, altKey: true, shiftKey: false, ...mods })
    expect(codeSizeKey(k('Equal'))).toBe(1)
    expect(codeSizeKey(k('NumpadSubtract'))).toBe(-1)
    expect(codeSizeKey(k('Digit0'))).toBe(0)
    expect(codeSizeKey(k('Equal', { altKey: false }))).toBeNull()
    expect(codeSizeKey(k('Equal', { ctrlKey: false, metaKey: true }))).toBe(1)
    expect(codeSizeKey(k('KeyA'))).toBeNull()
  })
})

describe('v27 messages', () => {
  // vue-i18n compiles messages: a bare { or | in sample text breaks the whole component at runtime.
  it('use only {name} placeholders', async () => {
    const { default: v27 } = await import('../i18n/workspace-v27')
    const leaves = (o: unknown): string[] => (typeof o === 'string' ? [o] : Object.values(o as object).flatMap(leaves))
    for (const msg of [...leaves(v27.en), ...leaves(v27.vi)]) expect(msg.replace(/\{[a-z]\w*\}/gi, ''), msg).not.toMatch(/[{}|@]/)
  })
})
