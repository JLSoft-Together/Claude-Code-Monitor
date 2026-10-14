import { promises as fs } from 'node:fs'
import path from 'node:path'

export type ScriptSource = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'make' | 'just' | 'cargo' | 'python'

export interface ScriptItem {
  name: string
  /** What the script does (package.json body, recipe line); display only. */
  detail?: string
  /** Line typed into a new shell when the user runs it. */
  run: string
}

export interface ScriptGroup {
  source: ScriptSource
  file: string
  items: ScriptItem[]
}

export interface ScriptsResult {
  dir: string
  groups: ScriptGroup[]
}

const MAX_FILE = 256 * 1024
const MAX_ITEMS = 200
const MAX_DETAIL = 200
// The name is typed into a shell: anything that could be read as more than one word or an operator is skipped.
const SAFE_NAME = /^[A-Za-z0-9_][\w:.@/+-]*$/

async function readSmall(file: string): Promise<string | null> {
  try {
    const stat = await fs.stat(file)
    if (!stat.isFile() || stat.size > MAX_FILE) return null
    return await fs.readFile(file, 'utf8')
  } catch {
    return null
  }
}

const exists = async (file: string): Promise<boolean> => !!(await fs.stat(file).catch(() => null))?.isFile()
const clip = (s: string): string => (s.length > MAX_DETAIL ? `${s.slice(0, MAX_DETAIL - 1)}…` : s)

export function packageScripts(text: string, runner: 'npm' | 'pnpm' | 'yarn' | 'bun'): ScriptItem[] {
  let scripts: unknown
  try {
    scripts = (JSON.parse(text) as { scripts?: unknown }).scripts
  } catch {
    return []
  }
  if (!scripts || typeof scripts !== 'object') return []
  const prefix = runner === 'yarn' ? 'yarn' : `${runner} run`
  return Object.entries(scripts as Record<string, unknown>)
    .filter(([name, body]) => SAFE_NAME.test(name) && typeof body === 'string')
    .slice(0, MAX_ITEMS)
    .map(([name, body]) => ({ name, detail: clip(String(body)), run: `${prefix} ${name}` }))
}

/** Plain `name:` targets; skips `.PHONY`-style specials, pattern rules, variables (`:=`) and indented recipe lines. */
export function makeTargets(text: string): ScriptItem[] {
  const seen = new Set<string>()
  const out: ScriptItem[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_][\w.\-/]*)\s*:(?![:=])/.exec(line)
    if (!m || seen.has(m[1]!) || !SAFE_NAME.test(m[1]!)) continue
    seen.add(m[1]!)
    out.push({ name: m[1]!, run: `make ${m[1]}` })
    if (out.length >= MAX_ITEMS) break
  }
  return out
}

const JUST_KEYWORDS = new Set(['set', 'alias', 'export', 'import', 'mod'])

export function justRecipes(text: string): ScriptItem[] {
  const out: ScriptItem[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^@?([A-Za-z_][\w-]*)\b([^:=]*):(?!=)/.exec(line)
    if (!m || JUST_KEYWORDS.has(m[1]!) || out.some((r) => r.name === m[1])) continue
    // Recipes with parameters need arguments the menu cannot ask for.
    if (m[2]!.trim()) continue
    out.push({ name: m[1]!, run: `just ${m[1]}` })
    if (out.length >= MAX_ITEMS) break
  }
  return out
}

function tomlSections(text: string): Map<string, string[]> {
  const sections = new Map<string, string[]>()
  let current = ''
  sections.set(current, [])
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const head = /^\[([^\[\]]+)\]$/.exec(line)
    if (head) {
      current = head[1]!.trim()
      if (!sections.has(current)) sections.set(current, [])
    } else if (line && !line.startsWith('#')) sections.get(current)!.push(line)
  }
  return sections
}

export function cargoCommands(text: string): ScriptItem[] {
  const sections = tomlSections(text)
  if (!sections.has('package') && !sections.has('workspace')) return []
  const items: ScriptItem[] = [
    { name: 'build', run: 'cargo build' },
    { name: 'test', run: 'cargo test' },
  ]
  if (sections.has('package')) items.push({ name: 'run', run: 'cargo run' })
  return items
}

/** `[project.scripts]` / `[tool.poetry.scripts]` entry points with plain `name = "module:func"` lines. */
export function pythonScripts(text: string, runner: 'uv' | 'poetry' | null): ScriptItem[] {
  const sections = tomlSections(text)
  const lines = [...(sections.get('project.scripts') ?? []), ...(sections.get('tool.poetry.scripts') ?? [])]
  const out: ScriptItem[] = []
  for (const line of lines) {
    const m = /^"?([A-Za-z0-9_][\w.-]*)"?\s*=\s*"([^"]+)"$/.exec(line)
    if (!m || !SAFE_NAME.test(m[1]!) || out.some((r) => r.name === m[1])) continue
    out.push({ name: m[1]!, detail: clip(m[2]!), run: runner ? `${runner} run ${m[1]}` : m[1]! })
    if (out.length >= MAX_ITEMS) break
  }
  return out
}

/** Reads the build files in `dir` (no subfolders); never runs anything. */
export async function detectScripts(dir: string): Promise<ScriptsResult> {
  const at = (name: string): string => path.join(dir, name)
  const groups: ScriptGroup[] = []

  const pkg = await readSmall(at('package.json'))
  if (pkg) {
    const runner = (await exists(at('pnpm-lock.yaml')))
      ? 'pnpm'
      : (await exists(at('yarn.lock')))
        ? 'yarn'
        : (await exists(at('bun.lockb'))) || (await exists(at('bun.lock')))
          ? 'bun'
          : 'npm'
    const items = packageScripts(pkg, runner)
    if (items.length) groups.push({ source: runner, file: 'package.json', items })
  }

  for (const name of ['Makefile', 'makefile', 'GNUmakefile']) {
    const text = await readSmall(at(name))
    if (text === null) continue
    const items = makeTargets(text)
    if (items.length) groups.push({ source: 'make', file: name, items })
    break
  }

  for (const name of ['justfile', 'Justfile', '.justfile']) {
    const text = await readSmall(at(name))
    if (text === null) continue
    const items = justRecipes(text)
    if (items.length) groups.push({ source: 'just', file: name, items })
    break
  }

  const cargo = await readSmall(at('Cargo.toml'))
  if (cargo) {
    const items = cargoCommands(cargo)
    if (items.length) groups.push({ source: 'cargo', file: 'Cargo.toml', items })
  }

  const py = await readSmall(at('pyproject.toml'))
  if (py) {
    const runner = (await exists(at('uv.lock'))) ? 'uv' : (await exists(at('poetry.lock'))) ? 'poetry' : null
    const items = pythonScripts(py, runner)
    if (items.length) groups.push({ source: 'python', file: 'pyproject.toml', items })
  }

  return { dir, groups }
}
