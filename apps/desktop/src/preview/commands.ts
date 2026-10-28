import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export type CommandScope = 'project' | 'user'
export interface CommandEntry {
  name: string
  description: string
  scope: CommandScope
}

const MAX_FILES = 200
const HEAD_BYTES = 4096
const MAX_DESCRIPTION = 200
const NAME = /^[\w.-]{1,80}$/

/** Claude Code user commands: `$CLAUDE_CONFIG_DIR/commands`, else `~/.claude/commands`. */
export function userCommandsDir(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'commands')
}

/** Top-level `.md` files only; symlinks are skipped (Dirent.isFile is false for them). */
export async function listCommands(dirs: readonly { dir: string; scope: CommandScope }[]): Promise<CommandEntry[]> {
  const out: CommandEntry[] = []
  for (const { dir, scope } of dirs) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const e of entries) {
      if (out.length >= MAX_FILES) return out
      if (!e.isFile() || !e.name.toLowerCase().endsWith('.md')) continue
      const name = e.name.slice(0, -3)
      if (!NAME.test(name)) continue
      out.push({ name, description: describe(await readHead(path.join(dir, e.name))), scope })
    }
  }
  return out
}

async function readHead(file: string): Promise<string> {
  const handle = await fs.open(file, 'r').catch(() => null)
  if (!handle) return ''
  try {
    const buf = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await handle.read(buf, 0, HEAD_BYTES, 0)
    return buf.subarray(0, bytesRead).toString('utf8')
  } catch {
    return ''
  } finally {
    await handle.close()
  }
}

/** `description:` from YAML front matter, else the first non-empty line without heading marks. */
export function describe(head: string): string {
  const lines = head.replace(/^﻿/, '').split(/\r?\n/)
  let i = 0
  if (lines[0]?.trim() === '---') {
    for (i = 1; i < lines.length && lines[i]!.trim() !== '---'; i++) {
      const m = /^description:\s*(.*)$/.exec(lines[i]!)
      if (m) return clip(unquote(m[1]!.trim()))
    }
    i++
  }
  for (; i < lines.length; i++) {
    const l = lines[i]!.replace(/^#+\s*/, '').trim()
    if (l) return clip(l)
  }
  return ''
}

const unquote = (s: string): string => (/^(['"]).*\1$/.test(s) ? s.slice(1, -1) : s)
const clip = (s: string): string => (s.length > MAX_DESCRIPTION ? `${s.slice(0, MAX_DESCRIPTION - 1)}…` : s)
