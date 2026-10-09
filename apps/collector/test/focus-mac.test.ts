import { describe, expect, it, vi } from 'vitest'

vi.mock('../src/osascript', async (load) => {
  const actual = await load<typeof import('../src/osascript')>()
  return { ...actual, runCommand: vi.fn(actual.runCommand) }
})
import { focusMacWindow, hostOf, parsePsTree, TERMINAL_SCRIPT, ITERM_SCRIPT } from '../src/focus-mac'
import { focusTerminalWindow } from '../src/focus'
import { parseOsaError, runCommand, type RunResult, type Runner } from '../src/osascript'

const PS = [
  '    1     0 ??       /sbin/launchd',
  '  500     1 ??       /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal',
  '  510   500 ttys006  login',
  '  511   510 ttys006  -zsh',
  '  512   511 ttys006  claude',
  '  600     1 ??       /Applications/WebStorm.app/Contents/MacOS/webstorm',
  '  601   600 ttys003  /bin/zsh',
  '  602   601 ttys003  claude',
  '  700     1 ??       /Users/u/.bun/bin/bun',
  '  701   700 ??       claude',
  '  800     1 ??       /Applications/iTerm.app/Contents/MacOS/iTerm2',
  '  801   800 ttys009  -zsh',
  '  802   801 ttys009  claude',
  '  900     1 ??       /Applications/IntelliJ IDEA.app/Contents/MacOS/idea',
  '  901   900 ??       claude',
  '  950     1 ??       /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper (Plugin).app/Contents/MacOS/Code Helper (Plugin)',
  '  951   950 ttys011  claude',
  '  960     1 ??       /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal',
  '  961   960 ??       claude',
  '  970     1 ??       -Evil.app/Contents/MacOS/evil',
  '  971   970 ttys012  claude',
].join('\n')

const tree = parsePsTree(PS)

function fakeRunner(results: Record<string, Partial<RunResult>>) {
  const calls: [string, string[]][] = []
  const run: Runner = async (command, args) => {
    calls.push([command, args])
    return { code: 0, stdout: '', stderr: '', ...(command === 'ps' ? { stdout: PS } : {}), ...results[command] }
  }
  return { run, calls }
}

describe('parsePsTree', () => {
  it('keeps comm with spaces whole and parses ids', () => {
    expect(tree.get(900)).toEqual({ pid: 900, ppid: 1, tty: '??', comm: '/Applications/IntelliJ IDEA.app/Contents/MacOS/idea' })
    expect(tree.get(511)).toEqual({ pid: 511, ppid: 510, tty: 'ttys006', comm: '-zsh' })
  })

  it('skips malformed lines', () => {
    expect(parsePsTree('garbage\n\n  12 x ?? foo\n  3 1 ?? bar').size).toBe(1)
  })
})

describe('hostOf', () => {
  it('finds a JetBrains app as kind app', () => {
    expect(hostOf(tree, 602)).toEqual({ kind: 'app', bundle: '/Applications/WebStorm.app', tty: 'ttys003' })
  })

  it('recognises Terminal.app under /System/Applications', () => {
    expect(hostOf(tree, 512)).toEqual({ kind: 'terminal', bundle: '/System/Applications/Utilities/Terminal.app', tty: 'ttys006' })
  })

  it('recognises iTerm2', () => {
    expect(hostOf(tree, 802)).toEqual({ kind: 'iterm', bundle: '/Applications/iTerm.app', tty: 'ttys009' })
  })

  it('returns null without an .app ancestor', () => {
    expect(hostOf(tree, 701)).toBeNull()
    expect(hostOf(tree, 4242)).toBeNull()
  })

  it('leaves tty undefined for ??', () => {
    expect(hostOf(tree, 901)).toEqual({ kind: 'app', bundle: '/Applications/IntelliJ IDEA.app' })
  })

  it('ignores a bundle that is not an absolute path', () => {
    expect(hostOf(tree, 971)).toBeNull()
  })

  it('takes the outer bundle of a nested helper app', () => {
    expect(hostOf(tree, 951)?.bundle).toBe('/Applications/Visual Studio Code.app')
  })
})

describe('parseOsaError', () => {
  it('maps AppleScript error codes', () => {
    expect(parseOsaError('execution error: Not authorized to send Apple events to Terminal. (-1743)')).toBe('denied')
    expect(parseOsaError('execution error: User canceled. (-128)')).toBe('cancelled')
    expect(parseOsaError('execution error: Terminal got an error: Can’t get window 1. (-1728)')).toBe('notInstalled')
    expect(parseOsaError('Can\'t get application "iTerm"')).toBe('notInstalled')
    expect(parseOsaError('syntax error: Expected end of line. (-2700)')).toBe('failed')
    expect(parseOsaError('something else')).toBe('failed')
  })
})

describe('focusMacWindow', () => {
  it('selects the Terminal tab by tty through argv', async () => {
    const { run, calls } = fakeRunner({ osascript: { stdout: 'ok\n' } })
    expect(await focusMacWindow(512, run)).toBe('ok')
    expect(calls[0]?.[0]).toBe('ps')
    expect(calls[1]).toEqual(['osascript', ['-e', TERMINAL_SCRIPT, '/dev/ttys006']])
    expect(calls).toHaveLength(2)
  })

  it('uses the iTerm script for iTerm2', async () => {
    const { run, calls } = fakeRunner({ osascript: { stdout: 'ok' } })
    expect(await focusMacWindow(802, run)).toBe('ok')
    expect(calls[1]).toEqual(['osascript', ['-e', ITERM_SCRIPT, '/dev/ttys009']])
  })

  it('reports notFound when no tab has the tty', async () => {
    const { run } = fakeRunner({ osascript: { stdout: 'notFound\n' } })
    expect(await focusMacWindow(512, run)).toBe('notFound')
  })

  it('opens other apps and reports appOnly', async () => {
    const { run, calls } = fakeRunner({})
    expect(await focusMacWindow(602, run)).toBe('appOnly')
    expect(calls[1]).toEqual(['open', ['-a', '/Applications/WebStorm.app']])
  })

  it('opens Terminal without a tty and reports appOnly', async () => {
    const { run, calls } = fakeRunner({})
    expect(await focusMacWindow(961, run)).toBe('appOnly')
    expect(calls[1]).toEqual(['open', ['-a', '/System/Applications/Utilities/Terminal.app']])
  })

  it('maps -1743 to denied', async () => {
    const { run } = fakeRunner({ osascript: { code: 1, stderr: '0:10: execution error: Not authorized to send Apple events to Terminal. (-1743)' } })
    expect(await focusMacWindow(512, run)).toBe('denied')
  })

  it('maps other osascript errors to failed', async () => {
    const { run } = fakeRunner({ osascript: { code: 1, stderr: 'execution error: boom (-1)' } })
    expect(await focusMacWindow(512, run)).toBe('failed')
  })

  it('maps a failed open to failed', async () => {
    const { run } = fakeRunner({ open: { code: 1, stderr: 'Unable to find application' } })
    expect(await focusMacWindow(602, run)).toBe('failed')
  })

  it('returns notFound without a host and does not run anything else', async () => {
    const { run, calls } = fakeRunner({})
    expect(await focusMacWindow(701, run)).toBe('notFound')
    expect(calls).toHaveLength(1)
  })

  it('returns failed when ps fails', async () => {
    const { run } = fakeRunner({ ps: { code: 1, stdout: '' } })
    expect(await focusMacWindow(512, run)).toBe('failed')
  })

  it('rejects invalid pids without running', async () => {
    const { run, calls } = fakeRunner({})
    expect(await focusMacWindow(0, run)).toBe('notFound')
    expect(await focusMacWindow(1.5, run)).toBe('notFound')
    expect(calls).toHaveLength(0)
  })
})

describe('focusTerminalWindow', () => {
  it('is unsupported off win32 and darwin', async () => {
    expect(await focusTerminalWindow(123, 'linux')).toBe('unsupported')
  })

  it('routes darwin to the mac path and rejects an invalid pid without running anything', async () => {
    expect(await focusTerminalWindow(0, 'darwin')).toBe('notFound')
    expect(runCommand).not.toHaveBeenCalled()
  })
})
