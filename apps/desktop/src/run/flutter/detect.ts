import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { FlutterPlatform, FlutterProject } from '@ccm/shared'

export interface DetectStat {
  isFile: boolean
  isDir: boolean
  mtimeMs: number
  size: number
}

export interface DetectDeps {
  stat(file: string): Promise<DetectStat | null>
  readdir(dir: string): Promise<{ name: string; isDir: boolean }[]>
  readFile(file: string): Promise<string>
}

const MAX_FILE = 256 * 1024
const MAX_ENTRIES = 400
const MAX_DIRS = 1500
const MAX_PROJECTS = 50
const MAX_FLAVORS = 50
const MAX_DEPTH = 2

const SKIP_DIRS = new Set(['build', 'node_modules', 'Pods', 'DerivedData'])
// Inside a pubspec dir these hold platform code / sources, never another project worth listing.
const PROJECT_OWNED = new Set(['lib', 'test', 'integration_test', 'assets', 'android', 'ios', 'web', 'windows', 'macos', 'linux', 'bin', 'tool'])
const PLATFORMS: FlutterPlatform[] = ['android', 'ios', 'web', 'windows', 'macos', 'linux']

export const nodeDetectDeps: DetectDeps = {
  async stat(file) {
    try {
      const s = await fs.stat(file)
      return { isFile: s.isFile(), isDir: s.isDirectory(), mtimeMs: s.mtimeMs, size: s.size }
    } catch {
      return null
    }
  },
  async readdir(dir) {
    try {
      return (await fs.readdir(dir, { withFileTypes: true })).map((d) => ({ name: d.name, isDir: d.isDirectory() }))
    } catch {
      return []
    }
  },
  readFile: (file) => fs.readFile(file, 'utf8'),
}

async function readSmall(deps: DetectDeps, file: string): Promise<string | null> {
  const s = await deps.stat(file)
  if (!s?.isFile || s.size > MAX_FILE) return null
  try {
    return await deps.readFile(file)
  } catch {
    return null
  }
}

const unquote = (s: string): string => s.trim().replace(/^(['"])(.*)\1$/, '$2')

/** Flat `a.b.c → value` map of a YAML mapping; lists and block scalar bodies are skipped. First key wins. */
export function yamlKeys(text: string): Map<string, string> {
  const out = new Map<string, string>()
  const stack: { indent: number; key: string }[] = []
  let blockIndent = -1
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue
    const indent = raw.length - raw.trimStart().length
    if (blockIndent >= 0) {
      if (indent > blockIndent) continue
      blockIndent = -1
    }
    const m = /^(\s*)(["']?[\w.-]+["']?)\s*:(?:\s+(.*))?$/.exec(raw.replace(/\s+#.*$/, ''))
    if (!m?.[2]) continue
    while ((stack.at(-1)?.indent ?? -1) >= indent) stack.pop()
    const key = unquote(m[2])
    const value = (m[3] ?? '').trim()
    stack.push({ indent, key })
    const full = stack.map((s) => s.key).join('.')
    if (!out.has(full)) out.set(full, unquote(value))
    if (/^[|>][-+0-9]*$/.test(value)) blockIndent = indent
  }
  return out
}

export interface PubspecInfo {
  name: string
  flutter: boolean
  plugin: boolean
}

export function parsePubspec(text: string): PubspecInfo {
  const keys = yamlKeys(text)
  const dep = keys.get('dependencies.flutter') ?? ''
  const flutter = keys.get('dependencies.flutter.sdk') === 'flutter' || /^\{\s*sdk\s*:\s*['"]?flutter['"]?\s*\}$/.test(dep)
  return { name: keys.get('name') ?? '', flutter, plugin: keys.has('flutter.plugin') }
}

export function metadataType(text: string): FlutterProject['type'] | null {
  const m = /^project_type:\s*["']?([\w-]+)/m.exec(text)
  if (!m) return null
  if (m[1] === 'plugin' || m[1] === 'plugin_ffi') return 'plugin'
  if (m[1] === 'app' || m[1] === 'skeleton' || m[1] === 'module') return 'app'
  return 'package'
}

const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')

/** Flavor names declared directly inside `productFlavors { }` (Groovy `name {`, KTS `create("name")` / `register("name")`). */
export function gradleFlavors(text: string): string[] {
  const src = stripComments(text)
  const start = /\bproductFlavors\s*\{/.exec(src)
  if (!start) return []
  let depth = 0
  let flat = ''
  for (let i = start.index + start[0].length; i < src.length; i++) {
    const c = src[i]
    if (c === '{') {
      if (depth === 0) flat += '{'
      depth++
    } else if (c === '}') {
      if (depth === 0) break
      depth--
      if (depth === 0) flat += ';'
    } else if (depth === 0) flat += c
  }
  const names: string[] = []
  for (const m of flat.matchAll(/\b(?:create|register|maybeCreate)\s*\(\s*["']([\w.-]+)["']\s*\)/g)) if (m[1]) names.push(m[1])
  for (const m of flat.matchAll(/(?:^|[\s;])([A-Za-z_]\w*)\s*\{/g)) if (m[1] && !['all', 'configureEach', 'forEach', 'each'].includes(m[1])) names.push(m[1])
  return names
}

export function parseFvmConfig(text: string): string | null {
  try {
    const json = JSON.parse(text) as { flutter?: unknown; flutterSdkVersion?: unknown }
    const v = json.flutter ?? json.flutterSdkVersion
    return typeof v === 'string' && v.trim() ? v.trim() : null
  } catch {
    return null
  }
}

/** FVM pinned version: `.fvmrc` (FVM 3) then `.fvm/fvm_config.json` (FVM 2). */
export async function readFvmVersion(dir: string, deps: DetectDeps = nodeDetectDeps): Promise<string | null> {
  for (const file of [path.join(dir, '.fvmrc'), path.join(dir, '.fvm', 'fvm_config.json')]) {
    const text = await readSmall(deps, file)
    const v = text === null ? null : parseFvmConfig(text)
    if (v) return v
  }
  return null
}

async function entrypoints(dir: string, deps: DetectDeps): Promise<string[]> {
  const files = (await deps.readdir(path.join(dir, 'lib')))
    .filter((e) => !e.isDir && /^main[\w.-]*\.dart$/.test(e.name))
    .map((e) => e.name)
    .sort((a, b) => (a === 'main.dart' ? -1 : b === 'main.dart' ? 1 : a.localeCompare(b)))
  return files.slice(0, MAX_ENTRIES).map((f) => `lib/${f}`)
}

async function flavors(dir: string, deps: DetectDeps): Promise<string[]> {
  const out = new Set<string>()
  for (const file of ['build.gradle', 'build.gradle.kts']) {
    const text = await readSmall(deps, path.join(dir, 'android', 'app', file))
    if (text) for (const f of gradleFlavors(text)) out.add(f)
  }
  const schemes = await deps.readdir(path.join(dir, 'ios', 'Runner.xcodeproj', 'xcshareddata', 'xcschemes'))
  for (const e of schemes) {
    const m = /^(.+)\.xcscheme$/.exec(e.name)
    if (!e.isDir && m?.[1] && m[1] !== 'Runner') out.add(m[1])
  }
  return [...out].slice(0, MAX_FLAVORS)
}

async function needsPubGet(dir: string, deps: DetectDeps): Promise<boolean> {
  if (!(await deps.stat(path.join(dir, '.dart_tool', 'package_config.json')))?.isFile) return true
  const [yaml, lock] = await Promise.all([deps.stat(path.join(dir, 'pubspec.yaml')), deps.stat(path.join(dir, 'pubspec.lock'))])
  if (!lock?.isFile) return true
  return !!yaml && yaml.mtimeMs > lock.mtimeMs
}

async function inspect(dir: string, deps: DetectDeps): Promise<FlutterProject | null> {
  const text = await readSmall(deps, path.join(dir, 'pubspec.yaml'))
  if (text === null) return null
  const pub = parsePubspec(text)
  const [mains, pubGet, fvm] = await Promise.all([entrypoints(dir, deps), needsPubGet(dir, deps), readFvmVersion(dir, deps)])
  const base = { kind: 'flutter' as const, dir, name: pub.name || path.basename(dir), entrypoints: mains, needsPubGet: pubGet, fvm }
  if (!pub.flutter) return { ...base, type: 'dart', platforms: [], flavors: [] }
  const platforms: FlutterPlatform[] = []
  for (const p of PLATFORMS) if ((await deps.stat(path.join(dir, p)))?.isDir) platforms.push(p)
  const meta = await readSmall(deps, path.join(dir, '.metadata'))
  const type = (meta && metadataType(meta)) || (pub.plugin ? 'plugin' : mains.length && platforms.length ? 'app' : 'package')
  const project: FlutterProject = { ...base, type, platforms, flavors: await flavors(dir, deps) }
  if (type === 'plugin' && (await deps.stat(path.join(dir, 'example', 'pubspec.yaml')))?.isFile) project.example = path.join(dir, 'example')
  return project
}

/** pubspec.yaml dirs at `root` and up to two levels below, breadth first. */
async function pubspecDirs(root: string, deps: DetectDeps): Promise<string[]> {
  const found: string[] = []
  let level = [root]
  let visited = 0
  for (let depth = 0; depth <= MAX_DEPTH && level.length; depth++) {
    const next: string[] = []
    for (const dir of level) {
      if (++visited > MAX_DIRS) return found
      const entries = (await deps.readdir(dir)).slice(0, MAX_ENTRIES)
      const isProject = entries.some((e) => !e.isDir && e.name === 'pubspec.yaml')
      if (isProject) found.push(dir)
      if (depth === MAX_DEPTH) continue
      for (const e of entries) {
        if (!e.isDir || e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue
        if (isProject && PROJECT_OWNED.has(e.name)) continue
        next.push(path.join(dir, e.name))
      }
    }
    level = next
  }
  return found
}

/** Flutter (and pure Dart, `type: 'dart'`) projects under `root`; a plugin's `example/` is listed right after it. */
export async function detectFlutter(root: string, deps: DetectDeps = nodeDetectDeps): Promise<FlutterProject[]> {
  const out: FlutterProject[] = []
  const seen = new Set<string>()
  const add = async (dir: string): Promise<void> => {
    if (seen.has(dir) || out.length >= MAX_PROJECTS) return
    seen.add(dir)
    const project = await inspect(dir, deps)
    if (!project) return
    out.push(project)
    if (project.example) await add(project.example)
  }
  for (const dir of await pubspecDirs(path.resolve(root), deps)) await add(dir)
  return out
}
