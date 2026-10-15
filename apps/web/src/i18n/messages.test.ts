import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import en from './en'
import vi from './vi'

type Tree = { [key: string]: Tree | string }

function leaves(tree: Tree, prefix = ''): string[] {
  return Object.entries(tree).flatMap(([k, v]) => (typeof v === 'string' ? [`${prefix}${k}`] : leaves(v, `${prefix}${k}.`)))
}

// A bare `@` (linked message), `|` or unbalanced `{` only fails when the string is first rendered, and a throw
// inside a component render leaves its old DOM on screen. Literal characters go through `{'@'}`.
describe('i18n messages', () => {
  for (const [locale, messages] of [['en', en], ['vi', vi]] as const) {
    it(`every ${locale} message compiles`, () => {
      const i18n = createI18n({ legacy: false, locale, messages: { [locale]: messages }, missingWarn: false, fallbackWarn: false })
      const bad: string[] = []
      for (const key of leaves(messages as unknown as Tree)) {
        try {
          i18n.global.t(key, {}, { plural: 1 })
        } catch (e) {
          bad.push(`${key}: ${String(e)}`)
        }
      }
      expect(bad).toEqual([])
    })
  }
})
