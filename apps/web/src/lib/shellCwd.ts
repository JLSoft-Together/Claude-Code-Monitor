/** Folder reports a shell prints after each prompt (wired up by the desktop PTY presets). */

const isAbsolute = (p: string): boolean => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/')

function decode(p: string): string {
  try {
    return decodeURIComponent(p)
  } catch {
    // zsh/bash hooks print $PWD raw: a literal % is not an escape
    return p
  }
}

/** OSC 7 payload `file://host/path` → absolute path (Windows `file:///C:/x` → `C:/x`); null when unusable. */
export function parseOsc7(data: string): string | null {
  const m = /^file:\/\/[^/]*(\/.*)$/i.exec(data)
  if (!m) return null
  let p = decode(m[1]!)
  if (/^\/[A-Za-z]:[\\/]/.test(p)) p = p.slice(1)
  return p && isAbsolute(p) && !p.includes('\0') ? p : null
}

/** OSC 9 payload; only Windows Terminal's `9;"<path>"` (ConEmu "current directory") — other 9;… are notifications. */
export function parseOsc9(data: string): string | null {
  const m = /^9;(.*)$/s.exec(data)
  if (!m) return null
  let p = m[1]!.trim()
  if (p.length >= 2 && p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1)
  return p && isAbsolute(p) && !p.includes('\0') && !/[\r\n]/.test(p) ? p : null
}
