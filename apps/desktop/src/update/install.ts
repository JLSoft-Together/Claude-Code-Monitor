import { execFile, spawn } from 'node:child_process'
import { accessSync, constants, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { UpdateError } from '@ccm/shared'

export type Prepared = { ok: true; launch: () => void } | { ok: false; error: UpdateError }

/** Quote for a .cmd file; `%` would expand and `"` / newlines would break out of the quotes, so they are refused. */
export function cmdQuote(p: string): string | null {
  return /["%\r\n]/.test(p) ? null : `"${p}"`
}

export const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

/**
 * Portable: wait for this process, then move the new exe over the old one and start it. The portable launcher
 * still holds its exe for a moment after the app exits, hence the retry loop (`ping` as sleep: `timeout`
 * refuses to run without a console).
 */
export function portableScript(pid: number, src: string, dest: string): string | null {
  const s = cmdQuote(src)
  const d = cmdQuote(dest)
  if (!s || !d || !Number.isInteger(pid) || pid <= 0) return null
  return [
    '@echo off',
    `powershell -NoProfile -NonInteractive -Command "Wait-Process -Id ${pid} -ErrorAction SilentlyContinue"`,
    'set n=0',
    ':retry',
    `move /Y ${s} ${d} >NUL 2>&1`,
    'if not errorlevel 1 goto done',
    'set /a n+=1',
    'if %n% GEQ 60 goto done',
    'ping -n 2 127.0.0.1 >NUL',
    'goto retry',
    ':done',
    `start "" ${d}`,
    '(goto) 2>NUL & del "%~f0"',
    '',
  ].join('\r\n')
}

/** macOS: wait for this process, copy the mounted bundle next to the old one, swap, clear quarantine, reopen. */
export function macScript(pid: number, mount: string, srcApp: string, destApp: string): string | null {
  if (!Number.isInteger(pid) || pid <= 0) return null
  const next = `${destApp}.ccm-new`
  return [
    '#!/bin/sh',
    `while kill -0 ${pid} 2>/dev/null; do sleep 0.5; done`,
    `rm -rf ${shQuote(next)}`,
    `if ditto ${shQuote(srcApp)} ${shQuote(next)}; then`,
    `  rm -rf ${shQuote(destApp)} && mv ${shQuote(next)} ${shQuote(destApp)}`,
    'fi',
    `rm -rf ${shQuote(next)}`,
    `xattr -dr com.apple.quarantine ${shQuote(destApp)} 2>/dev/null`,
    `hdiutil detach ${shQuote(mount)} -quiet || hdiutil detach ${shQuote(mount)} -force -quiet`,
    `open ${shQuote(destApp)}`,
    'rm -f "$0"',
    '',
  ].join('\n')
}

/** `/Applications/Orrery.app/Contents/MacOS/Orrery` → `/Applications/Orrery.app`. */
export function macBundleOf(exe: string): string | null {
  const i = exe.indexOf('.app/Contents/MacOS/')
  return i > 0 ? exe.slice(0, i + 4) : null
}

const detached = (cmd: string, args: string[], extra: Parameters<typeof spawn>[2] = {}): void => {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true, ...extra })
  child.on('error', (err) => console.error('[update] launch failed:', err.message))
  child.unref()
}

/** electron-builder's own silent-update flags: same install folder, no UI, start the app when done. */
export function prepareNsis(file: string): Prepared {
  return { ok: true, launch: () => detached(file, ['--updated', '/S', '--force-run']) }
}

export function preparePortable(file: string, portableExe: string, pid: number): Prepared {
  const script = portableScript(pid, file, portableExe)
  if (!script) return { ok: false, error: 'install' }
  const cmdFile = path.join(os.tmpdir(), `orrery-update-${pid}-${Date.now()}.cmd`)
  try {
    writeFileSync(cmdFile, script)
  } catch {
    return { ok: false, error: 'install' }
  }
  // /s strips the outer quotes, so a temp path with spaces survives.
  return { ok: true, launch: () => detached('cmd.exe', ['/d', '/s', '/c', `"${cmdFile}"`], { windowsVerbatimArguments: true }) }
}

const run = (cmd: string, args: string[]): Promise<boolean> =>
  new Promise((resolve) => execFile(cmd, args, { timeout: 60_000 }, (err) => resolve(!err)))

function writable(p: string): boolean {
  try {
    accessSync(p, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/** Mounts the dmg now (a failure keeps the app running); a bundle this user cannot replace → `mac-readonly`. */
export async function prepareMac(file: string, exe: string, pid: number): Promise<Prepared> {
  const bundle = macBundleOf(exe)
  if (!bundle) return { ok: false, error: 'install' }
  if (!writable(bundle) || !writable(path.dirname(bundle))) return { ok: false, error: 'mac-readonly' }
  const mount = path.join(os.tmpdir(), `orrery-update-${pid}-${Date.now()}`)
  try {
    mkdirSync(mount, { recursive: true })
  } catch {
    return { ok: false, error: 'install' }
  }
  if (!(await run('hdiutil', ['attach', '-nobrowse', '-readonly', '-noautoopen', '-mountpoint', mount, file]))) return { ok: false, error: 'install' }
  let app: string | undefined
  try {
    app = readdirSync(mount).find((n) => n.endsWith('.app'))
  } catch {
    app = undefined
  }
  const script = app ? macScript(pid, mount, path.join(mount, app), bundle) : null
  const shFile = `${mount}.sh`
  try {
    if (!script) throw new Error('no app')
    writeFileSync(shFile, script, { mode: 0o700 })
  } catch {
    await run('hdiutil', ['detach', mount, '-force', '-quiet'])
    return { ok: false, error: 'install' }
  }
  return { ok: true, launch: () => detached('/bin/sh', [shFile]) }
}
