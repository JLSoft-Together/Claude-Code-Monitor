import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CtxSource, CtxSources } from '@ccm/shared'
import { claudeJsonFile, claudeRoot, readConfigured } from '../extensions/status'

const READ_MAX = 256 * 1024
const FILES_MAX = 300
const IMPORT_DEPTH = 5
const RULES_DEPTH = 4
// Names Claude Code 2.1.294 loads from each folder between the filesystem root and the session folder (docs §11y).
const PER_DIR = ['CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md', path.join('.claude', 'CLAUDE.md'), path.join('.claude', 'AGENTS.md')]

export interface CtxEnv {
  env: NodeJS.ProcessEnv
  home: string
  platform: NodeJS.Platform
}

export const cwdSlug = (cwd: string): string => cwd.replace(/[^a-zA-Z0-9]/g, '-')

export function managedClaudeMd(platform: NodeJS.Platform): string {
  if (platform === 'win32') return path.win32.join('C:\\Program Files', 'ClaudeCode', 'CLAUDE.md')
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode/CLAUDE.md'
  return '/etc/claude-code/CLAUDE.md'
}

/** Folders from the filesystem root down to `cwd`. */
export function ancestors(cwd: string): string[] {
  const out: string[] = []
  for (let d = path.resolve(cwd); ; d = path.dirname(d)) {
    out.unshift(d)
    if (path.dirname(d) === d) break
  }
  return out
}

/** `@path` imports outside code fences and inline code; `~/` is the home folder, relative paths start at the file's folder. */
export function importsOf(text: string, dir: string, home: string): string[] {
  const out: string[] = []
  let fence = false
  for (const raw of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fence = !fence
      continue
    }
    if (fence) continue
    const line = raw.replace(/`[^`]*`/g, ' ')
    for (const m of line.matchAll(/(?:^|\s)@([^\s`]+)/g)) {
      const p = m[1]!.replace(/[.,;:!?)\]]+$/, '')
      if (!/\.[A-Za-z0-9]{1,8}$/.test(p) && !/[\\/]/.test(p)) continue
      const abs = p.startsWith('~') ? path.join(home, p.slice(2)) : path.isAbsolute(p) ? p : path.resolve(dir, p)
      if (!out.includes(abs)) out.push(abs)
    }
  }
  return out.slice(0, 50)
}

/** `<config>/projects/<slug>`; on Windows the folder Claude made may differ in drive-letter case from the real path. */
async function projectDir(config: string, cwd: string, platform: NodeJS.Platform): Promise<string> {
  const slug = cwdSlug(path.resolve(cwd))
  const base = path.join(config, 'projects')
  if (platform !== 'win32') return path.join(base, slug)
  const names = await fs.readdir(base).catch(() => [] as string[])
  return path.join(base, names.find((n) => n === slug) ?? names.find((n) => n.toLowerCase() === slug.toLowerCase()) ?? slug)
}

async function statFile(file: string): Promise<number | null> {
  const st = await fs.stat(file).catch(() => null)
  return st?.isFile() ? st.size : null
}

const lineCount = (text: string): number => (text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0)

async function mdFiles(dir: string, depth: number, out: string[]): Promise<void> {
  if (depth < 0 || out.length >= FILES_MAX) return
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(dir, e.name)
    if (e.isDirectory() && !e.name.startsWith('.')) await mdFiles(p, depth - 1, out)
    else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(p)
  }
}

async function skillFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
  const out: string[] = []
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) if (e.isDirectory() && !e.name.startsWith('.')) out.push(path.join(dir, e.name, 'SKILL.md'))
  return out.slice(0, 200)
}

async function enabledPlugins(files: readonly string[]): Promise<string[]> {
  const out = new Set<string>()
  for (const f of files) {
    try {
      const v = JSON.parse(await fs.readFile(f, 'utf8')) as { enabledPlugins?: unknown }
      const map = v?.enabledPlugins
      if (map && typeof map === 'object' && !Array.isArray(map)) for (const [k, on] of Object.entries(map)) if (on === true && k.length <= 200) out.add(k)
    } catch {
      continue
    }
  }
  return [...out].sort()
}

/**
 * Files Claude Code reads into a new session for `cwd`, with sizes on disk. Text is read here only to count lines and
 * follow `@imports`; only paths, sizes and line counts are returned.
 */
export async function contextSources(cwd: string, ctx: CtxEnv): Promise<CtxSources> {
  const config = claudeRoot(ctx.env, ctx.home)
  const files: CtxSource[] = []
  const seen = new Set<string>()
  const key = (p: string): string => (ctx.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p))
  let truncated = false

  const add = async (file: string, src: Omit<CtxSource, 'path' | 'bytes' | 'lines'>, depth = 0): Promise<void> => {
    if (seen.has(key(file))) return
    if (files.length >= FILES_MAX) {
      truncated = true
      return
    }
    const bytes = await statFile(file)
    if (bytes === null) return
    seen.add(key(file))
    const entry: CtxSource = { ...src, path: file, bytes }
    files.push(entry)
    const md = file.toLowerCase().endsWith('.md')
    if (!md || bytes > READ_MAX || src.kind === 'skill' || src.load === 'on-demand') return
    const text = await fs.readFile(file, 'utf8').catch(() => '')
    entry.lines = lineCount(text)
    if (depth >= IMPORT_DEPTH) return
    for (const imp of importsOf(text, path.dirname(file), ctx.home)) await add(imp, { kind: 'import', load: src.load, from: file }, depth + 1)
  }

  await add(managedClaudeMd(ctx.platform), { kind: 'managed', load: 'start' })
  await add(path.join(config, 'CLAUDE.md'), { kind: 'user', load: 'start' })
  const userRules: string[] = []
  await mdFiles(path.join(config, 'rules'), RULES_DEPTH, userRules)
  for (const f of userRules) await add(f, { kind: 'rules', load: 'start' })
  // With CLAUDE_CONFIG_DIR elsewhere, the walk still reaches ~/.claude/CLAUDE.md: it is the user's file, not the project's.
  const homeKey = key(ctx.home)
  const kindOf = (dir: string, name: string): CtxSource['kind'] =>
    name.includes('local') ? 'local' : key(dir) === homeKey && name.startsWith('.claude') ? 'user' : 'project'
  for (const dir of ancestors(cwd)) for (const name of PER_DIR) await add(path.join(dir, name), { kind: kindOf(dir, name), load: 'start' })
  const rules: string[] = []
  await mdFiles(path.join(cwd, '.claude', 'rules'), RULES_DEPTH, rules)
  for (const f of rules) await add(f, { kind: 'rules', load: 'start' })

  const memDir = path.join(await projectDir(config, cwd, ctx.platform), 'memory')
  await add(path.join(memDir, 'MEMORY.md'), { kind: 'memory-index', load: 'start' })
  const mem: string[] = []
  await mdFiles(memDir, 1, mem)
  for (const f of mem) await add(f, { kind: 'memory', load: 'on-demand' })

  for (const f of [...(await skillFiles(path.join(config, 'skills'))), ...(await skillFiles(path.join(cwd, '.claude', 'skills')))]) await add(f, { kind: 'skill', load: 'listed' })
  await add(path.join(cwd, '.mcp.json'), { kind: 'mcp-config', load: 'start' })

  const mcp = readConfigured(claudeJsonFile(ctx.env, ctx.home), cwd, ctx.platform)
  const plugins = await enabledPlugins([path.join(config, 'settings.json'), path.join(cwd, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.local.json')])
  return { ok: true, cwd, home: ctx.home, files, mcp, plugins, truncated }
}

export const defaultCtxEnv = (): CtxEnv => ({ env: process.env, home: os.homedir(), platform: process.platform })
