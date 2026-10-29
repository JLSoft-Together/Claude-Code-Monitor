import { describe, expect, it } from 'vitest'
import type { ReleaseApp, ReleaseFinding } from '@ccm/shared'
import { countStatus, fixPrompt, groupFindings, withCert } from './releaseCheck'

const f = (rule: ReleaseFinding['rule'], section: ReleaseFinding['section'], status: ReleaseFinding['status'], line: number | null = 1): ReleaseFinding => ({
  rule,
  section,
  status,
  detail: 'x',
  file: line === null ? null : 'C:/p/app/build.gradle',
  line,
})

const findings = [f('minify', 'build', 'warn', 20), f('version-code', 'version', 'ok', 5), f('debuggable', 'build', 'fail', 21), f('cert', 'signing', 'unknown', null)]
const app: ReleaseApp = { kind: 'android', dir: 'C:/p/app', name: ':app', version: { code: 5, name: '1.0' }, released: null, cert: null, findings }

describe('release check view model', () => {
  it('groups by section in a fixed order, worst first', () => {
    const g = groupFindings(findings)
    expect(g.map((x) => x.section)).toEqual(['version', 'build', 'signing'])
    expect(g[1]!.findings.map((x) => x.rule)).toEqual(['debuggable', 'minify'])
    expect(g[1]!.worst).toBe('fail')
    expect(countStatus(findings)).toEqual({ fail: 1, warn: 1, unknown: 1, ok: 1 })
  })

  it('swaps in a verified certificate row', () => {
    const cert = { ...f('cert', 'signing', 'ok', null), detail: 'match' }
    expect(withCert(app, cert).find((x) => x.rule === 'cert')).toBe(cert)
    expect(withCert(app, null)).toBe(findings)
  })

  it('builds a prefill with failures first and relative file:line', () => {
    const text = fixPrompt(app, findings, 'C:/p', (x) => `${x.rule} msg`)!
    const lines = text.split('\n').slice(1)
    expect(lines).toEqual(['- [FAIL] debuggable msg (app/build.gradle:21)', '- [WARN] minify msg (app/build.gradle:20)'])
    expect(text).toContain(':app (Android)')
    expect(fixPrompt(app, [f('version-code', 'version', 'ok')], 'C:/p', () => '')).toBeNull()
  })
})
