import { CUSTOM_PREFIX, OUTSIDE_RULE, SECRET_FILE_GLOBS, ruleGroup, type CommandRule, type SensitiveSettings } from '@ccm/shared'

/** What a tool call touches. Lives only while the transcript line is handled: never stored, never sent. */
export interface ToolTouch {
  file?: string
  cmds?: CmdHit[]
}

export interface CmdHit {
  rule: CommandRule
  /** Delete commands only: the paths they remove, resolved later against the project. */
  targets?: string[]
}

export interface SensitiveHit {
  rule: string
  /** Project-relative, `~/…` or `…/last/segments`; empty for commands without a path. */
  path?: string
  file?: string
}

export interface ClassifyContext {
  project?: string
  home: string
  win: boolean
  /** Folders that never count as outside the project (the session's own plans / memory, scratch dirs). */
  safeDirs: string[]
  settings: SensitiveSettings
  /** Key of `settings.ignore`; the project folder. */
  projectKey?: string
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)

const FILE_TOOLS: Record<string, string> = { Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' }
const SHELL_TOOLS = new Set(['Bash', 'PowerShell'])
const MAX_COMMAND = 20_000

export function touchOf(name: string, input: unknown): ToolTouch | null {
  if (!isObj(input)) return null
  const key = FILE_TOOLS[name]
  if (key) {
    const file = input[key]
    return typeof file === 'string' && file.length > 0 && file.length < 1024 ? { file } : null
  }
  if (SHELL_TOOLS.has(name) && typeof input.command === 'string' && input.command.length <= MAX_COMMAND) {
    const cmds = commandHits(input.command)
    return cmds.length ? { cmds } : null
  }
  return null
}

function splitSegments(cmd: string): string[][] {
  const segments: string[][] = []
  let tokens: string[] = []
  let cur = ''
  let has = false
  let quote: string | null = null
  const endToken = () => {
    if (has) tokens.push(cur)
    cur = ''
    has = false
  }
  const endSegment = () => {
    endToken()
    if (tokens.length) segments.push(tokens)
    tokens = []
  }
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]!
    if (quote) {
      if (c === quote) quote = null
      else cur += c
      continue
    }
    if (c === '"' || c === "'") {
      quote = c
      has = true
    } else if (c === ' ' || c === '\t') endToken()
    else if (c === '\n' || c === '\r' || c === ';' || c === '|' || (c === '&' && cmd[i + 1] === '&')) {
      if (c === '&') i++
      endSegment()
    } else {
      cur += c
      has = true
    }
  }
  endSegment()
  return segments
}

const baseCmd = (t: string): string => t.replace(/^.*[\\/]/, '').replace(/\.exe$/i, '').toLowerCase()
const isAssign = (t: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*=/.test(t)
const NESTED = new Set(['bash', 'sh', 'zsh', 'cmd', 'pwsh', 'powershell'])
const NESTED_FLAG = /^(-c|\/c|\/k|-command|-c(o(m(m(a(n(d)?)?)?)?)?)?)$/i
const PS_RECURSE = /^-r(e(c(u(r(s(e)?)?)?)?)?)?$/i
const PS_VALUE_PARAMS = /^-(path|literalpath|include|exclude|filter|credential|stream)$/i
const PS_PATH_PARAMS = /^-(path|literalpath)$/i

function shortFlags(tokens: string[]): string {
  return tokens.filter((t) => /^-[A-Za-z]+$/.test(t)).map((t) => t.slice(1)).join('')
}

function gitHit(args: string[]): CommandRule | null {
  let i = 0
  while (i < args.length && args[i]!.startsWith('-')) i += args[i] === '-C' || args[i] === '-c' ? 2 : 1
  const sub = args[i]
  const rest = args.slice(i + 1)
  if (sub === 'push' && rest.some((t) => t === '--force' || /^-[A-Za-z]*f[A-Za-z]*$/.test(t))) return 'git-force-push'
  if (sub === 'reset' && rest.includes('--hard')) return 'git-reset-hard'
  if (sub === 'clean') {
    const flags = shortFlags(rest)
    if ((flags.includes('f') || rest.includes('--force')) && flags.includes('d')) return 'git-clean'
  }
  return null
}

function segmentHits(tokens: string[], depth: number): CmdHit[] {
  let i = 0
  while (i < tokens.length && (tokens[i] === 'sudo' || isAssign(tokens[i]!))) i++
  const head = tokens[i]
  if (!head) return []
  const name = baseCmd(head)
  const args = tokens.slice(i + 1)
  if (NESTED.has(name) && depth < 2) {
    const at = args.findIndex((t) => NESTED_FLAG.test(t))
    if (at !== -1 && args[at + 1]) return commandHits(args.slice(at + 1).join(' '), depth + 1)
  }
  if (name === 'git') {
    const rule = gitHit(args)
    return rule ? [{ rule }] : []
  }
  if (name === 'adb' && (args.includes('uninstall') || (args.includes('pm') && args.includes('uninstall')))) return [{ rule: 'adb-uninstall' }]
  if (name === 'remove-item' || name === 'ri' || name === 'rm' || name === 'rmdir' || name === 'del' || name === 'erase' || name === 'rd') {
    if (args.some((t) => PS_RECURSE.test(t) && t.length > 2) || (name === 'remove-item' && args.some((t) => PS_RECURSE.test(t)))) {
      return [{ rule: 'remove-item-recurse', targets: psTargets(args) }]
    }
  }
  if (name === 'rm') {
    const flags = shortFlags(args.filter((t) => !t.startsWith('--')))
    const recursive = /[rR]/.test(flags) || args.includes('--recursive')
    const force = flags.includes('f') || args.includes('--force')
    if (recursive && force) return [{ rule: 'rm-rf', targets: positional(args) }]
  }
  if ((name === 'del' || name === 'erase' || name === 'rd' || name === 'rmdir') && args.some((t) => /^\/s$/i.test(t))) {
    return [{ rule: 'del-s', targets: args.filter((t) => !t.startsWith('/') || !/^\/[A-Za-z]$/.test(t)) }]
  }
  return []
}

function positional(args: string[]): string[] {
  const out: string[] = []
  let rest = false
  for (const a of args) {
    if (rest || !a.startsWith('-')) out.push(a)
    else if (a === '--') rest = true
  }
  return out
}

function psTargets(args: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!
    if (PS_VALUE_PARAMS.test(a)) {
      if (PS_PATH_PARAMS.test(a) && args[i + 1]) out.push(...args[i + 1]!.split(','))
      i++
    } else if (!a.startsWith('-')) out.push(...a.split(','))
  }
  return out.filter(Boolean)
}

const DROP_RE = /\bdrop\s+(table|database)\b/i

/** Rules a shell command matches; the command text itself never leaves this function. */
export function commandHits(cmd: string, depth = 0): CmdHit[] {
  const out: CmdHit[] = []
  for (const seg of splitSegments(cmd)) out.push(...segmentHits(seg, depth))
  if (depth === 0 && DROP_RE.test(cmd)) out.push({ rule: 'drop-table' })
  return out
}

export function normPath(p: string, win: boolean): string {
  let s = p.replace(/\\/g, '/')
  if (win) {
    const mount = /^\/([A-Za-z])(\/|$)/.exec(s)
    if (mount) s = `${mount[1]}:/${s.slice(mount[0].length)}`
    if (/^[A-Za-z]:$/.test(s)) s += '/'
  }
  const drive = win ? (/^[A-Za-z]:\//.exec(s)?.[0] ?? '') : ''
  const absolute = drive !== '' || s.startsWith('/')
  const parts: string[] = []
  for (const part of s.slice(drive ? drive.length : absolute ? 1 : 0).split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop()
      else if (!absolute) parts.push('..')
    } else parts.push(part)
  }
  const prefix = drive ? drive.slice(0, 2).toLowerCase() + '/' : absolute ? '/' : ''
  return prefix + parts.join('/')
}

const isAbs = (p: string, win: boolean): boolean => p.startsWith('/') || (win && /^[A-Za-z]:[\\/]?/.test(p)) || (win && p.startsWith('\\'))
const HOME_RE = /^(~|\$HOME|\$\{HOME\}|%USERPROFILE%|\$env:USERPROFILE|\$env:HOME)(?=$|[\\/])/i

/** Absolute normalized path, or null when it depends on a variable we cannot know. */
export function resolveTarget(target: string, base: string | undefined, home: string, win: boolean): string | null {
  let t = target.replace(HOME_RE, home)
  if (/[$%`]/.test(t)) return null
  if (!isAbs(t, win)) {
    if (!base) return null
    t = `${base}/${t}`
  }
  return normPath(t, win)
}

const same = (a: string, b: string, win: boolean): boolean => (win ? a.toLowerCase() === b.toLowerCase() : a === b)

export function isInside(child: string, parent: string, win: boolean): boolean {
  const c = win ? child.toLowerCase() : child
  const p = (win ? parent.toLowerCase() : parent).replace(/\/$/, '')
  return c === p || c.startsWith(`${p}/`)
}

const isRoot = (p: string): boolean => p === '/' || /^[a-z]:\/?$/i.test(p)

export function shortPath(file: string, project: string | undefined, home: string, win: boolean): string {
  const f = normPath(file, win)
  let out: string
  if (project && isInside(f, normPath(project, win), win)) out = f.slice(normPath(project, win).length).replace(/^\//, '') || '.'
  else if (home && isInside(f, normPath(home, win), win)) out = `~${f.slice(normPath(home, win).length)}` || '~'
  else {
    const parts = f.split('/').filter(Boolean)
    out = parts.length > 3 ? `…/${parts.slice(-3).join('/')}` : f
  }
  return out.length > 160 ? `…${out.slice(-159)}` : out
}

export function globToRegExp(glob: string, win: boolean): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (c === '*' && glob[i + 1] === '*') {
      re += '.*'
      i++
      if (glob[i + 1] === '/') i++
    } else if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${re}$`, win ? 'i' : '')
}

function fileHits(file: string, ctx: ClassifyContext): SensitiveHit[] {
  const f = normPath(file, ctx.win)
  const name = f.slice(f.lastIndexOf('/') + 1)
  const project = ctx.project ? normPath(ctx.project, ctx.win) : undefined
  const inProject = project ? isInside(f, project, ctx.win) : undefined
  const rel = project && inProject ? f.slice(project.length).replace(/^\//, '') : f
  const out: string[] = []
  for (const glob of SECRET_FILE_GLOBS) if (globToRegExp(glob, true).test(name)) out.push(glob)
  for (const glob of ctx.settings.globs) {
    const target = glob.includes('/') ? rel : name
    if (globToRegExp(glob, ctx.win).test(target)) out.push(`${CUSTOM_PREFIX}${glob}`)
  }
  const safe = ctx.safeDirs.some((d) => isInside(f, normPath(d, ctx.win), ctx.win))
  if (inProject === false && !safe) out.push(OUTSIDE_RULE)
  const path = shortPath(f, project, ctx.home, ctx.win)
  return out.map((rule) => ({ rule, path, file: f }))
}

function cmdHits(hit: CmdHit, ctx: ClassifyContext): SensitiveHit[] {
  if (!hit.targets) return [{ rule: hit.rule }]
  const project = ctx.project ? normPath(ctx.project, ctx.win) : undefined
  const home = ctx.home ? normPath(ctx.home, ctx.win) : ''
  for (const target of hit.targets) {
    const abs = resolveTarget(target, project, ctx.home, ctx.win)
    if (!abs) continue
    const dir = abs.replace(/\/[^/]*[*?][^/]*$/, '') || '/'
    const danger =
      isRoot(dir) ||
      (home !== '' && (same(dir, home, ctx.win) || isInside(home, dir, ctx.win))) ||
      (project !== undefined && !isInside(abs, project, ctx.win) && !ctx.safeDirs.some((d) => isInside(abs, normPath(d, ctx.win), ctx.win)))
    if (danger) return [{ rule: hit.rule, path: shortPath(abs, project, ctx.home, ctx.win) }]
  }
  return []
}

/** Applies groups, custom globs and the project's ignore list; at most one hit per rule. */
export function classifyTouch(touch: ToolTouch, ctx: ClassifyContext): SensitiveHit[] {
  const raw = touch.file ? fileHits(touch.file, ctx) : (touch.cmds ?? []).flatMap((h) => cmdHits(h, ctx))
  const ignored = new Set(ctx.projectKey ? (ctx.settings.ignore[ctx.projectKey] ?? []) : [])
  const seen = new Set<string>()
  return raw.filter((h) => {
    const group = ruleGroup(h.rule)
    if (!group || !ctx.settings.groups[group] || ignored.has(h.rule) || seen.has(h.rule)) return false
    seen.add(h.rule)
    return true
  })
}
