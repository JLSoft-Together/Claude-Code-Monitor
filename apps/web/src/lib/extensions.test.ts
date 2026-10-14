import { describe, expect, it } from 'vitest'
import { catalogEntry, CATALOG, type ExtStatus } from '@ccm/shared'
import { defaultScope, entryState, others, removeScope } from './extensions'
import en from '../i18n/en'

const status = (over: Partial<ExtStatus> = {}): ExtStatus => ({
  cli: true,
  dir: null,
  prereqs: { node: true, uv: false, docker: true },
  plugins: [],
  marketplaces: [],
  configured: [],
  skills: { user: [], project: [] },
  ...over,
})

describe('entryState', () => {
  it('not installed / guide', () => {
    expect(entryState(catalogEntry('github')!, status(), []).state).toBe('notInstalled')
    expect(entryState(catalogEntry('unity')!, status(), []).state).toBe('guide')
  })

  it('configured server takes its live state and scopes', () => {
    const s = entryState(catalogEntry('gitlab')!, status({ configured: [{ name: 'gitlab', scopes: ['user', 'local'] }] }), [{ name: 'gitlab', state: 'needsAuth', scopes: [] }])
    expect(s).toMatchObject({ state: 'needsAuth', scopes: ['user', 'local'], server: 'gitlab' })
    expect(s.viaPlugin).toBeUndefined()
  })

  it('a plugin-provided server shows as via plugin', () => {
    const s = entryState(catalogEntry('figma')!, status(), [{ name: 'plugin:figma:figma', state: 'connected', scopes: [], plugin: 'figma' }])
    expect(s).toMatchObject({ state: 'connected', viaPlugin: 'figma', server: 'plugin:figma:figma' })
  })

  it('configured but not checked yet = unknown', () => {
    expect(entryState(catalogEntry('meshy')!, status({ configured: [{ name: 'meshy', scopes: ['project'] }] }), null).state).toBe('unknown')
  })

  it('plugin groups count installed plugins', () => {
    const s = entryState(catalogEntry('pm-skills')!, status({ plugins: [{ id: 'pm-toolkit@pm-skills', scope: 'user', enabled: true }] }), null)
    expect(s).toMatchObject({ state: 'installed', installed: ['pm-toolkit@pm-skills'], total: 9, scopes: ['user'] })
  })
})

describe('others / scopes', () => {
  it('lists only what no catalog entry claims', () => {
    const o = others(
      status({ configured: [{ name: 'codegraph', scopes: ['user'] }, { name: 'github', scopes: ['user'] }], plugins: [{ id: 'superpowers@x', scope: 'user', enabled: true }, { id: 'frontend-design@claude-plugins-official', scope: 'user', enabled: true }] }),
      [{ name: 'codegraph', state: 'connected', scopes: [] }, { name: 'plugin:figma:figma', state: 'connected', scopes: [], plugin: 'figma' }],
    )
    expect(o.servers).toEqual([{ name: 'codegraph', state: 'connected', scopes: ['user'] }])
    expect(o.plugins.map((p) => p.id)).toEqual(['superpowers@x'])
  })

  it('defaults and remove scope follow the view', () => {
    expect(defaultScope(catalogEntry('github')!, false)).toBe('user')
    expect(defaultScope(catalogEntry('github')!, true)).toBe('local')
    expect(defaultScope(catalogEntry('figma')!, true)).toBe('project')
    expect(removeScope(['user', 'local'], false)).toBe('user')
    expect(removeScope(['user'], true)).toBeNull()
    expect(removeScope(['project', 'local'], true)).toBe('local')
  })
})

describe('i18n', () => {
  it('every catalog entry has a description, fields and steps', () => {
    for (const e of CATALOG) {
      expect(en.ext.desc[e.id as keyof typeof en.ext.desc], e.id).toBeTruthy()
      for (const f of e.fields) expect(en.ext.field[f.key as keyof typeof en.ext.field], f.key).toBeTruthy()
      const guide = en.ext.guide[e.id as keyof typeof en.ext.guide] as Record<number, string> | undefined
      for (let n = 1; n <= (e.steps ?? 0); n++) expect(guide?.[n], `${e.id}.${n}`).toBeTruthy()
    }
  })
})
