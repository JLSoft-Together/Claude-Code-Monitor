import { describe, expect, it } from 'vitest'
import { defaultSensitiveSettings, type TerminalSession } from '@ccm/shared'
import { classifyTouch, commandHits, normPath, resolveTarget, shortPath, touchOf, type ClassifyContext } from '../src/sensitive/rules'
import { SensitiveWatch } from '../src/sensitive/watch'
import { extractSignals } from '../src/transcript'
import { Toaster, phoneName } from '../src/toast'

const WIN: ClassifyContext = { project: 'F:\\work\\app', home: 'C:\\Users\\me', win: true, safeDirs: ['C:\\Users\\me\\.claude\\plans'], settings: defaultSensitiveSettings(), projectKey: 'F:\\work\\app' }
const POSIX: ClassifyContext = { project: '/home/me/app', home: '/home/me', win: false, safeDirs: [], settings: defaultSensitiveSettings(), projectKey: '/home/me/app' }

const rules = (cmd: string, ctx = POSIX) => classifyTouch({ cmds: commandHits(cmd) }, ctx).map((h) => h.rule)
const fileRules = (file: string, ctx = WIN) => classifyTouch({ file }, ctx)

describe('sensitive file rules', () => {
  it('flags secret files by name, case-insensitive', () => {
    expect(fileRules('F:\\work\\app\\.env.local').map((h) => h.rule)).toEqual(['.env*'])
    expect(fileRules('F:/work/app/android/app/upload.JKS')[0]).toMatchObject({ rule: '*.jks', path: 'android/app/upload.JKS' })
    expect(fileRules('F:\\work\\app\\android\\key.properties')[0]?.rule).toBe('key.properties')
    expect(fileRules('F:\\work\\app\\src\\main.ts')).toEqual([])
  })

  it('flags files outside the project but not the session plan / memory folders', () => {
    expect(fileRules('C:\\Users\\me\\.ssh\\config')).toEqual([{ rule: 'outside-project', path: '~/.ssh/config', file: 'c:/Users/me/.ssh/config' }])
    expect(fileRules('C:\\Users\\me\\.claude\\plans\\p.md')).toEqual([])
    expect(fileRules('/f/work/app/README.md')).toEqual([])
    expect(fileRules('f:/WORK/App/x.ts')).toEqual([])
  })

  it('custom globs and ignore list per project', () => {
    const ctx = { ...WIN, settings: { ...defaultSensitiveSettings(), globs: ['*.secret', 'config/prod/**'] } }
    expect(fileRules('F:\\work\\app\\a.secret', ctx).map((h) => h.rule)).toEqual(['custom:*.secret'])
    expect(fileRules('F:\\work\\app\\config\\prod\\db.yml', ctx).map((h) => h.rule)).toEqual(['custom:config/prod/**'])
    const ignored = { ...WIN, settings: { ...defaultSensitiveSettings(), ignore: { 'F:\\work\\app': ['.env*'] } } }
    expect(fileRules('F:\\work\\app\\.env', ignored)).toEqual([])
    const off = { ...WIN, settings: { ...defaultSensitiveSettings(), groups: { ...defaultSensitiveSettings().groups, outside: false } } }
    expect(fileRules('D:\\other\\x.ts', off)).toEqual([])
  })
})

describe('sensitive command rules', () => {
  it('git force push / reset --hard / clean -fd', () => {
    expect(rules('git push --force origin main')).toEqual(['git-force-push'])
    expect(rules('git push -f')).toEqual(['git-force-push'])
    expect(rules('git push --force-with-lease')).toEqual([])
    expect(rules('git status && git reset --hard HEAD~1')).toEqual(['git-reset-hard'])
    expect(rules('git clean -fdx')).toEqual(['git-clean'])
    expect(rules('git clean -n')).toEqual([])
    expect(rules('git -C ../x push -f')).toEqual(['git-force-push'])
  })

  it('rm -rf only outside the project, home or a root', () => {
    expect(rules('rm -rf build node_modules')).toEqual([])
    expect(rules('rm -rf ../other')).toEqual(['rm-rf'])
    expect(rules('rm -rf ~')).toEqual(['rm-rf'])
    expect(rules('sudo rm -fr /')).toEqual(['rm-rf'])
    expect(rules('rm -rf /*')).toEqual(['rm-rf'])
    expect(rules('rm -r -f $HOME/x')).toEqual(['rm-rf'])
    expect(rules('rm -rf "$OUT"')).toEqual([])
    expect(rules('rm -f a.txt')).toEqual([])
    expect(classifyTouch({ cmds: commandHits('rm -rf /tmp/cache') }, POSIX)).toEqual([{ rule: 'rm-rf', path: '/tmp/cache' }])
  })

  it('Windows deletes: del /s, Remove-Item -Recurse, drive roots', () => {
    expect(rules('del /s /q C:\\', WIN)).toEqual(['del-s'])
    expect(rules('rd /s /q build', WIN)).toEqual([])
    expect(rules('Remove-Item -Recurse -Force D:\\data', WIN)).toEqual(['remove-item-recurse'])
    expect(rules('Remove-Item -Path .\\dist -Recurse', WIN)).toEqual([])
    expect(rules('rm -Recurse -Force $env:USERPROFILE\\Downloads', WIN)).toEqual(['remove-item-recurse'])
    expect(rules('cmd /c "rd /s /q E:\\"', WIN)).toEqual(['del-s'])
    expect(rules('rm -rf /c/Users', WIN)).toEqual(['rm-rf'])
  })

  it('adb uninstall and DROP TABLE', () => {
    expect(rules('adb -s emulator-5554 uninstall com.x')).toEqual(['adb-uninstall'])
    expect(rules('adb shell pm uninstall com.x')).toEqual(['adb-uninstall'])
    expect(rules('sqlite3 app.db "drop table users"')).toEqual(['drop-table'])
    expect(rules('echo hello')).toEqual([])
  })
})

describe('paths', () => {
  it('normalizes Windows and git-bash paths', () => {
    expect(normPath('C:\\a\\..\\b\\.\\c\\', true)).toBe('c:/b/c')
    expect(normPath('/d/x/y', true)).toBe('d:/x/y')
    expect(resolveTarget('..\\x', 'F:/work/app', 'C:/Users/me', true)).toBe('f:/work/x')
    expect(resolveTarget('$TMP', 'F:/work/app', 'C:/Users/me', true)).toBeNull()
    expect(shortPath('/var/lib/a/b/c/d', undefined, '/home/me', false)).toBe('…/b/c/d')
  })
})

describe('extraction', () => {
  it('only Edit / Write / MultiEdit / NotebookEdit paths and classified shell commands', () => {
    expect(touchOf('Edit', { file_path: 'F:/a/.env', old_string: 'x' })).toEqual({ file: 'F:/a/.env' })
    expect(touchOf('NotebookEdit', { notebook_path: 'n.ipynb' })).toEqual({ file: 'n.ipynb' })
    expect(touchOf('Read', { file_path: 'F:/a/.env' })).toBeNull()
    expect(touchOf('Bash', { command: 'ls -la' })).toBeNull()
    const sig = extractSignals({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'git push -f' } }] } })
    expect(sig.find((s) => s.k === 'tool_use')).toMatchObject({ touch: { cmds: [{ rule: 'git-force-push' }] } })
    expect(JSON.stringify(sig)).not.toContain('git push')
  })

  it('watch drops repeats within 10 minutes and keeps the project', () => {
    let now = 0
    const w = new SensitiveWatch({ claudeRoot: '/home/me/.claude', home: '/home/me', tmp: '/tmp', win: false, now: () => now })
    const touch = { file: '/home/me/app/.env' }
    expect(w.check('t1', touch, '/home/me/app')).toEqual([{ rule: '.env*', path: '.env', file: '/home/me/app/.env', project: '/home/me/app' }])
    expect(w.check('t1', touch, '/home/me/app')).toEqual([])
    now = 11 * 60_000
    expect(w.check('t1', touch, '/home/me/app')).toHaveLength(1)
    expect(w.ignore('/home/me/app', '.env*', true)).toBe(true)
    now = 30 * 60_000
    expect(w.check('t1', touch, '/home/me/app')).toEqual([])
    expect(w.ignore('/home/me/app', 'bogus', true)).toBe(false)
  })
})

describe('phone episodes', () => {
  const term = (patch: Partial<TerminalSession>): TerminalSession => ({ id: 't1', title: 'Fix the login bug', cwd: 'F:\\work\\shop', status: 'idle', ...patch }) as TerminalSession

  it('names a session by alias or folder, never the auto title', () => {
    expect(phoneName(term({}))).toBe('shop')
    expect(phoneName(term({ alias: 'Backend' }))).toBe('Backend')
  })

  it('reports waiting even while the window has focus, and a long job done', () => {
    let now = 1_000_000
    const sent: unknown[] = []
    const toaster = new Toaster({ supported: false, port: 1 }, { show: async () => true, hide: async () => true, now: () => now })
    toaster.onPhone = (m) => sent.push(m)
    toaster.setPresence(1, true)
    toaster.observe({ terminals: [term({ status: 'idle' })] })
    toaster.observe({ terminals: [term({ status: 'working', statusSince: new Date(now).toISOString() })] })
    now += 6 * 60_000
    toaster.observe({ terminals: [term({ status: 'idle', statusSince: new Date(now).toISOString() })] })
    expect(sent).toEqual([expect.objectContaining({ type: 'phone', reason: 'done', name: 'shop' })])
    toaster.observe({ terminals: [term({ status: 'waiting', waitingFor: 'permission prompt', statusSince: new Date(now).toISOString() })], toolOf: () => 'Bash' })
    expect(sent[1]).toMatchObject({ reason: 'permission', tool: 'Bash', name: 'shop' })
    expect(JSON.stringify(sent)).not.toContain('login')
  })

  it('a short turn sends nothing', () => {
    let now = 0
    const sent: unknown[] = []
    const toaster = new Toaster({ supported: false, port: 1 }, { show: async () => true, hide: async () => true, now: () => now })
    toaster.onPhone = (m) => sent.push(m)
    toaster.observe({ terminals: [term({ status: 'idle' })] })
    toaster.observe({ terminals: [term({ status: 'working' })] })
    now += 60_000
    toaster.observe({ terminals: [term({ status: 'idle' })] })
    expect(sent).toEqual([])
  })
})
