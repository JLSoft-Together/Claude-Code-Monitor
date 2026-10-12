import type { FocusWindowResult } from '@ccm/shared'
import { parseOsaError, runCommand, type Runner } from './osascript'

export const TERMINAL_SCRIPT = `on run argv
  set target to item 1 of argv
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is target then
          set selected of t to true
          set index of w to 1
          activate
          return "ok"
        end if
      end repeat
    end repeat
  end tell
  return "notFound"
end run`

export const ITERM_SCRIPT = `on run argv
  set target to item 1 of argv
  tell application "iTerm"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if tty of s is target then
            tell w to select
            tell t to select
            tell s to select
            activate
            return "ok"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return "notFound"
end run`

export interface PsRow {
  pid: number
  ppid: number
  tty: string
  comm: string
}

export function parsePsTree(stdout: string): Map<number, PsRow> {
  const tree = new Map<number, PsRow>()
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+?)\s*$/.exec(line)
    if (m) tree.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), tty: m[3]!, comm: m[4]! })
  }
  return tree
}

export interface MacHost {
  kind: 'terminal' | 'iterm' | 'app'
  bundle: string
  tty?: string
}

const APP_MARK = '.app/Contents/MacOS/'

export function hostOf(tree: Map<number, PsRow>, pid: number): MacHost | null {
  const self = tree.get(pid)
  let row = self
  for (let i = 0; row && i <= 8; i++) {
    if (row.comm.startsWith('/') && row.comm.includes(APP_MARK)) {
      const bundle = row.comm.slice(0, row.comm.indexOf('.app/') + 4)
      const kind = bundle.endsWith('/Terminal.app') ? 'terminal' : bundle.endsWith('/iTerm.app') ? 'iterm' : 'app'
      return self && /^ttys\d+$/.test(self.tty) ? { kind, bundle, tty: self.tty } : { kind, bundle }
    }
    row = row.ppid > 0 && row.ppid !== row.pid ? tree.get(row.ppid) : undefined
  }
  return null
}

export async function focusMacWindow(pid: number, run: Runner = runCommand): Promise<FocusWindowResult> {
  if (!Number.isInteger(pid) || pid <= 1) return 'notFound'
  const ps = await run('ps', ['-A', '-o', 'pid=,ppid=,tty=,comm='])
  if (ps.code !== 0) return 'failed'
  const host = hostOf(parsePsTree(ps.stdout), pid)
  if (!host) return 'notFound'
  if (host.kind !== 'app' && host.tty) {
    const r = await run('osascript', ['-e', host.kind === 'terminal' ? TERMINAL_SCRIPT : ITERM_SCRIPT, `/dev/${host.tty}`])
    if (r.code !== 0) return parseOsaError(r.stderr) === 'denied' ? 'denied' : 'failed'
    const out = r.stdout.trim()
    return out === 'ok' || out === 'notFound' ? out : 'failed'
  }
  const r = await run('open', ['-a', host.bundle])
  return r.code === 0 ? 'appOnly' : 'failed'
}
