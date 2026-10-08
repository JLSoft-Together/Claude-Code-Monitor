import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface BridgeInstall {
  script: string
  command: string
}

const slashes = (p: string): string => p.replaceAll('\\', '/')

const hasNode = (): boolean => spawnSync('where.exe', ['node'], { windowsHide: true, stdio: 'ignore' }).status === 0

function writeIfChanged(file: string, content: string | Buffer): void {
  if (existsSync(file) && readFileSync(file).equals(Buffer.from(content))) return
  writeFileSync(file, content)
}

/**
 * Copies the status line bridge to a path that survives app updates and portable re-extraction,
 * and picks the command Claude Code should run: system node first, else this exe as node.
 */
export function installBridge(source: string, dataDir: string, exe: string, portable: boolean): BridgeInstall {
  const dir = path.join(dataDir, 'bin')
  mkdirSync(dir, { recursive: true })
  const script = path.join(dir, 'statusline-bridge.mjs')
  writeIfChanged(script, readFileSync(source))
  const nodeCommand = `node "${slashes(script)}"`
  // A portable exe extracts to a fresh temp dir per run, so its path cannot go into settings.json.
  if (portable || hasNode()) return { script, command: nodeCommand }
  const cmd = path.join(dir, 'statusline-bridge.cmd')
  writeIfChanged(cmd, `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${exe.replaceAll('%', '%%')}" "%~dp0statusline-bridge.mjs" %*\r\n`)
  return { script, command: `"${slashes(cmd)}"` }
}
