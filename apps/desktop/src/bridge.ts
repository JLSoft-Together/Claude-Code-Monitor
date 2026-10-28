import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface BridgeInstall {
  script: string
  command: string
}

const slashes = (p: string): string => p.replaceAll('\\', '/')
const shQuote = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`

const hasNode = (): boolean => {
  const exe = process.platform === 'win32' ? 'node.exe' : 'node'
  return (process.env.PATH ?? '').split(path.delimiter).some((dir) => dir !== '' && existsSync(path.join(dir, exe)))
}

function writeIfChanged(file: string, content: string | Buffer): void {
  if (existsSync(file) && readFileSync(file).equals(Buffer.from(content))) return
  writeFileSync(file, content)
}

/**
 * Copies the status line bridge to a path that survives app updates and portable re-extraction,
 * and picks the command Claude Code should run: system node first, else this exe as node.
 */
export function installBridge(source: string, dataDir: string, exe: string, portable: boolean, name = 'statusline-bridge'): BridgeInstall {
  const dir = path.join(dataDir, 'bin')
  mkdirSync(dir, { recursive: true })
  const script = path.join(dir, `${name}.mjs`)
  writeIfChanged(script, readFileSync(source))
  const nodeCommand = `node "${slashes(script)}"`
  // A portable exe extracts to a fresh temp dir per run, so its path cannot go into settings.json.
  if (portable || hasNode()) return { script, command: nodeCommand }
  if (process.platform !== 'win32') {
    const sh = path.join(dir, `${name}.sh`)
    writeIfChanged(sh, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${shQuote(exe)} "$(dirname "$0")/${name}.mjs" "$@"\n`)
    chmodSync(sh, 0o755)
    return { script, command: `"${sh}"` }
  }
  const cmd = path.join(dir, `${name}.cmd`)
  writeIfChanged(cmd, `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${exe.replaceAll('%', '%%')}" "%~dp0${name}.mjs" %*\r\n`)
  return { script, command: `"${slashes(cmd)}"` }
}
