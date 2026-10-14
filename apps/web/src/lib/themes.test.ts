// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { THEMES, isThemeId, modeOf, toggleTarget } from './themes'

// Read from disk: vitest turns CSS imports (even ?raw) into empty modules.
const themesCss = readFileSync(new URL('../themes.css', import.meta.url), 'utf8')
const indexHtml = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')

/** Every colour a theme block must name; the rest is derived in themes.css or comes from the mode block. */
const REQUIRED = [
  'canvas', 'surface', 'raised', 'control', 'ink', 'ink-muted', 'ink-faint', 'accent', 'accent-ink', 'on-accent', 'focus', 'selection',
  'well', 'well-ink', 'well-selection', 'working', 'waiting', 'idle', 'done', 'error', 'stale', 'warning', 'favorite', 'diff-add', 'diff-del', 'diff-mod',
  'agent-claude', 'agent-claude-ink', 'agent-codex', 'agent-browser', 'agent-file',
  ...Array.from({ length: 16 }, (_, i) => `ansi-${i}`),
  'syn-keyword', 'syn-string', 'syn-number', 'syn-comment', 'syn-type', 'syn-func',
  ...Array.from({ length: 8 }, (_, i) => `cat-${i + 1}`),
]
// Read as #RRGGBB at runtime (LottieArt tokenRgb, TermFind hexVar).
const HEX_ONLY = ['agent-claude', 'ink', 'success', 'well-selection', 'ansi-3', 'done']

function block(id: string): Record<string, string> {
  const m = new RegExp(`:root\\[data-theme='${id}'\\] \\{([^}]*)\\}`).exec(themesCss)
  if (!m) return {}
  return Object.fromEntries([...m[1]!.matchAll(/--ccm-([\w-]+):\s*([^;]+);/g)].map((x) => [x[1]!, x[2]!.trim()]))
}

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
const lum = (c: number[]) => {
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}
const ratio = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x! + 0.05) / (y! + 0.05)
}
const over = (fg: number[], bg: number[], p: number) => fg.map((v, i) => v * p + bg[i]! * (1 - p))

const extra = THEMES.filter((th) => th.id !== 'light' && th.id !== 'dark')

describe('themes', () => {
  it('every extra theme names every colour token as #RRGGBB', () => {
    for (const th of extra) {
      const b = block(th.id)
      expect(REQUIRED.filter((k) => !b[k]), th.id).toEqual([])
      for (const k of HEX_ONLY.filter((k) => b[k])) expect(b[k], `${th.id} ${k}`).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('swatches mirror the CSS', () => {
    for (const th of extra) {
      const b = block(th.id)
      expect(th.swatch, th.id).toEqual([b.canvas, b.surface, b.accent, b.well])
    }
  })

  it('pre-paint script lists the same light / dark ids', () => {
    const list = (name: string) => JSON.parse(new RegExp(`var ${name} = (\\[[^\\]]*\\])`).exec(indexHtml)![1]!.replace(/'/g, '"')) as string[]
    expect(list('L').sort()).toEqual(THEMES.filter((th) => th.mode === 'light').map((th) => th.id).sort())
    expect(list('D').sort()).toEqual(THEMES.filter((th) => th.mode === 'dark').map((th) => th.id).sort())
  })

  it('toggle flips the mode, families round-trip', () => {
    for (const th of THEMES) {
      expect(modeOf(toggleTarget(th.id)), th.id).not.toBe(th.mode)
      if (th.pair) expect(toggleTarget(toggleTarget(th.id))).toBe(th.id)
    }
    expect(isThemeId('dracula')).toBe(true)
    expect(isThemeId('nope')).toBe(false)
  })

  it('text clears 4.5:1, glyphs 3:1 (COLOR-SYSTEM rule 9)', () => {
    const fails: string[] = []
    const need = (name: string, value: number, min: number) => value < min && fails.push(`${name} ${value.toFixed(2)} < ${min}`)
    for (const th of extra) {
      const b = block(th.id)
      const c = (k: string) => rgb(b[k]!)
      for (const bg of ['surface', 'raised']) {
        for (const k of ['ink', 'ink-muted', 'ink-faint', 'accent-ink', 'working', 'waiting', 'idle', 'done', 'error', 'stale', 'warning', 'diff-add', 'diff-del', 'diff-mod', 'agent-claude-ink'])
          need(`${th.id} ${k}/${bg}`, ratio(c(k), c(bg)), 4.5)
        for (const k of ['favorite', 'agent-claude', 'agent-codex', 'agent-browser', 'agent-file', 'focus']) need(`${th.id} ${k}/${bg}`, ratio(c(k), c(bg)), 3)
      }
      need(`${th.id} on-accent`, ratio(c('on-accent'), c('accent')), 4.5)
      // Soft tints as themes.css derives them (10 % light, 14–16 % dark).
      const soft: Record<string, number> = th.mode === 'light' ? { accent: 0.1, working: 0.1, waiting: 0.1, error: 0.1, done: 0.1 } : { accent: 0.16, working: 0.16, waiting: 0.16, error: 0.14, done: 0.14 }
      for (const [k, p] of Object.entries(soft)) need(`${th.id} ${k} on soft`, ratio(c(k === 'accent' ? 'accent-ink' : k), over(c(k), c('surface'), p)), 4.5)
      need(`${th.id} well-ink`, ratio(c('well-ink'), c('well')), 4.5)
      for (const k of ['keyword', 'string', 'number', 'type', 'func']) need(`${th.id} syn-${k}`, ratio(c(`syn-${k}`), c('well')), 4.5)
      need(`${th.id} syn-comment`, ratio(c('syn-comment'), c('well')), 3)
    }
    expect(fails).toEqual([])
  })
})
