import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MODEL_CAPS, parseProjectModel, projectModelArgs } from '../src/layout/projectModel'

const root = path.resolve('/proj')
const p = (...parts: string[]) => path.join(root, ...parts)

function model(over: Record<string, unknown> = {}) {
  return {
    version: 1,
    module: ':app',
    variant: 'debug',
    namespace: 'com.example.app',
    applicationId: 'com.example.app.dev',
    minSdk: 26,
    targetSdk: 36,
    resDirs: [p('app/src/main/res'), p('app/src/debug/res')],
    generatedResDirs: [p('app/build/generated/res/resValues/debug')],
    aarRes: [
      { dir: p('caches/transformed/material-1.12.0/res'), package: 'com.google.android.material', name: 'com.google.android.material:material:1.12.0' },
      { dir: p('lib/build/packaged_res/debug') },
    ],
    classpath: [p('caches/material-runtime.jar'), p('caches/constraintlayout.jar')],
    classDirs: [p('app/build/tmp/kotlin-classes/debug')],
    rJar: p('app/build/R.jar'),
    appTheme: '@style/Theme.App',
    activityThemes: { 'com.example.app.MainActivity': '@style/Theme.App.Main', 'bad name': '@style/X', 'com.example.app.Evil': '"><script>' },
    warnings: ['gradle said hi'],
    ...over,
  }
}

describe('projectModelArgs', () => {
  it('builds the init-script invocation', () => {
    const out = p('out.json')
    const init = p('init.gradle')
    expect(projectModelArgs('app', out, init)).toEqual(['-q', '--init-script', init, ':app:ccmProjectModel', `-Pccm.out=${out}`, '-Pccm.variant=debug'])
    expect(projectModelArgs(':feature:home', out, init, 'freeDebug')[3]).toBe(':feature:home:ccmProjectModel')
  })

  it('rejects unsafe module, variant and relative paths', () => {
    expect(() => projectModelArgs('app; rm', p('o'), p('i'))).toThrow()
    expect(() => projectModelArgs(':app', p('o'), p('i'), 'debug --x')).toThrow()
    expect(() => projectModelArgs(':app', 'out.json', p('i'))).toThrow()
  })
})

describe('parseProjectModel', () => {
  it('maps the gradle model to the project/load payload', () => {
    const r = parseProjectModel(JSON.stringify(model()), { exists: () => true })
    expect(r.module).toBe(':app')
    expect(r.payload.packageName).toBe('com.example.app.dev')
    expect(r.payload.namespace).toBe('com.example.app')
    expect(r.payload.resDirs).toEqual([p('app/src/main/res'), p('app/src/debug/res'), p('app/build/generated/res/resValues/debug')])
    expect(r.payload.aarResDirs).toEqual([
      { dir: p('caches/transformed/material-1.12.0/res'), name: 'com.google.android.material:material:1.12.0' },
      { dir: p('lib/build/packaged_res/debug'), name: 'packaged_res' },
    ])
    expect(r.payload.classpath[0]).toBe(p('app/build/tmp/kotlin-classes/debug'))
    expect(r.payload.classpath).toHaveLength(3)
    expect(r.payload.rJar).toBe(p('app/build/R.jar'))
    expect(r.payload.appTheme).toBe('@style/Theme.App')
    expect(r.payload.activityThemes).toEqual({ 'com.example.app.MainActivity': '@style/Theme.App.Main' })
    expect(r.payload.minSdk).toBe(26)
    expect(r.warnings).toEqual(['gradle said hi'])
  })

  it('filters missing and relative paths with warnings', () => {
    const missing = new Set([p('app/src/debug/res'), p('caches/constraintlayout.jar'), p('app/build/R.jar')])
    const r = parseProjectModel(model({ resDirs: [p('app/src/main/res'), 'relative/res', p('app/src/debug/res')] }), {
      exists: (f) => !missing.has(f),
    })
    expect(r.payload.resDirs).toEqual([p('app/src/main/res'), p('app/build/generated/res/resValues/debug')])
    expect(r.payload.classpath).not.toContain(p('caches/constraintlayout.jar'))
    expect(r.payload.rJar).toBeUndefined()
    expect(r.warnings.some((w) => w.includes('non-absolute'))).toBe(true)
    expect(r.warnings.some((w) => w.includes('R.jar missing'))).toBe(true)
  })

  it('caps and dedupes the classpath', () => {
    const many = Array.from({ length: MODEL_CAPS.classpath + 10 }, (_, i) => p(`jars/${i}.jar`))
    const r = parseProjectModel(model({ classpath: [...many, many[0]], classDirs: [] }), { exists: () => true })
    expect(r.payload.classpath).toHaveLength(MODEL_CAPS.classpath)
    expect(r.warnings.some((w) => w.includes('capped'))).toBe(true)
  })

  it('falls back to namespace and rejects junk', () => {
    const r = parseProjectModel(model({ applicationId: null, minSdk: 'x', appTheme: 'not a theme!' }), { exists: () => true })
    expect(r.payload.packageName).toBe('com.example.app')
    expect(r.payload.minSdk).toBeUndefined()
    expect(r.payload.appTheme).toBeUndefined()
    expect(() => parseProjectModel(model({ namespace: '' }))).toThrow()
    expect(() => parseProjectModel('null')).toThrow()
  })
})
