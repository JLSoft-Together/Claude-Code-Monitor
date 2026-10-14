import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { RunConfig } from '@ccm/shared'
import { quoteForDisplay } from './args'
import { createHash } from 'node:crypto'
import { cleanRunConfig, dropBlockedEnv, IMPORT_ID_PREFIX, MAX_ENV } from './configs'
import { isWithin } from '../preview/paths'

const MAX_FILE = 512 * 1024

function readSmall(file: string): string | null {
  try {
    const s = readFileSync(file, 'utf8')
    return s.length <= MAX_FILE ? s : null
  } catch {
    return null
  }
}

function listFiles(dir: string, suffix: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(suffix))
      .sort()
      .map((f) => path.join(dir, f))
  } catch {
    return []
  }
}

/** Nearest folder from `start` up to `root` holding pubspec.yaml; `root` when none. */
function pubspecDir(start: string, root: string): string {
  let dir = start
  while (isWithin(root, dir)) {
    if (existsSync(path.join(dir, 'pubspec.yaml'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return root
}

const relPosix = (from: string, to: string): string => path.relative(from, to).split(path.sep).join('/')

const decodeXml = (s: string): string =>
  s.replace(/&(lt|gt|quot|apos|amp|#(\d+)|#x([0-9a-fA-F]+));/g, (_m, name: string, dec?: string, hex?: string) => {
    if (dec) return String.fromCodePoint(Number(dec))
    if (hex) return String.fromCodePoint(parseInt(hex, 16))
    return ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' } as Record<string, string>)[name] ?? ''
  })

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of tag.matchAll(/([\w.:-]+)\s*=\s*"([^"]*)"/g)) out[m[1]!] = decodeXml(m[2]!)
  return out
}

/** IntelliJ module name (`MyApp.feature.login.main`) → Gradle path (`:feature:login`). */
function gradleModule(name: string): string | null {
  const parts = name.split('.').filter(Boolean)
  if (parts.length > 1 && ['main', 'test', 'androidTest', 'unitTest'].includes(parts[parts.length - 1]!)) parts.pop()
  if (parts.length > 1) parts.shift()
  return parts.length ? ':' + parts.join(':') : null
}

/** Same source entry → same id, so importing twice adds nothing new. */
function importId(root: string, file: string, name: string): string {
  const key = `${relPosix(root, file)}\u0000${name}`
  return IMPORT_ID_PREFIX + createHash('sha256').update(key).digest('hex').slice(0, 16)
}

function parseRunXml(xml: string, root: string, source: string): RunConfig[] {
  const out: RunConfig[] = []
  for (const m of xml.matchAll(/<configuration\b([^>]*?)(\/>|>([\s\S]*?)<\/configuration>)/g)) {
    const head = attrs(m[1]!)
    const body = m[3] ?? ''
    const opts: Record<string, string> = {}
    for (const o of body.matchAll(/<option\b([^>]*?)\/?>/g)) {
      const a = attrs(o[1]!)
      if (a.name && a.value !== undefined) opts[a.name] = a.value
    }
    const env: Record<string, string> = {}
    for (const e of body.matchAll(/<env\b([^>]*?)\/?>/g)) {
      const a = attrs(e[1]!)
      if (a.name && Object.keys(env).length < MAX_ENV) env[a.name] = a.value ?? ''
    }
    const name = (head.name ?? '').trim().slice(0, 80)
    const expand = (v: string): string => v.replace(/\$PROJECT_DIR\$/g, root)
    if (head.type === 'FlutterRunConfigurationType') {
      const file = opts.filePath ? path.resolve(root, expand(opts.filePath)) : path.join(root, 'lib', 'main.dart')
      const cwd = pubspecDir(path.dirname(file), root)
      out.push({
        id: importId(root, source, name || path.basename(file)),
        type: 'flutter',
        name: name || path.basename(file),
        cwd,
        shared: false,
        env,
        beforeLaunch: [],
        entrypoint: relPosix(cwd, file),
        device: 'selected',
        mode: 'debug',
        flavor: opts.buildFlavor ?? '',
        args: expand(opts.additionalArgs ?? ''),
        attachArgs: expand(opts.attachArgs ?? ''),
      })
    } else if (head.type === 'AndroidRunConfigurationType') {
      const mod = body.match(/<module\b([^>]*?)\/?>/)
      const module = mod ? gradleModule(attrs(mod[1]!).name ?? '') : null
      if (!module) continue
      out.push({ id: importId(root, source, name || module), type: 'android', name: name || module.slice(1), cwd: root, shared: false, env, beforeLaunch: [], module, variant: 'debug', device: 'selected', args: '' })
    }
  }
  return out
}

/** `.run/*.run.xml` + `.idea/runConfigurations/*.xml`. Read-only; stable `imp-` ids, personal side. */
export function importIntellij(root: string): RunConfig[] {
  const files = [...listFiles(path.join(root, '.run'), '.run.xml'), ...listFiles(path.join(root, '.idea', 'runConfigurations'), '.xml')]
  const out: RunConfig[] = []
  for (const f of files) {
    const xml = readSmall(f)
    if (xml) for (const c of parseRunXml(xml, root, f)) out.push(c)
  }
  return finish(out, root)
}

/** Drops `//` and `/* *\/` comments and trailing commas outside strings. */
export function stripJsonc(s: string): string {
  let out = ''
  let i = 0
  while (i < s.length) {
    const c = s[i]!
    if (c === '"') {
      let j = i + 1
      while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1
      out += s.slice(i, j + 1)
      i = j + 1
    } else if (c === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++
    } else if (c === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2)
      i = end < 0 ? s.length : end + 2
    } else if (c === ',') {
      let j = i + 1
      while (j < s.length && /\s/.test(s[j]!)) j++
      if (s[j] !== '}' && s[j] !== ']') out += c
      i++
    } else {
      out += c
      i++
    }
  }
  return out
}

const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

/** `.vscode/launch.json` entries with `type: "dart"`. Read-only; stable `imp-` ids, personal side. */
export function importVscode(root: string): RunConfig[] {
  const source = path.join(root, '.vscode', 'launch.json')
  const raw = readSmall(source)
  if (!raw) return []
  let json: unknown
  try {
    json = JSON.parse(stripJsonc(raw))
  } catch {
    return []
  }
  const list = (json as { configurations?: unknown })?.configurations
  const out: RunConfig[] = []
  const expand = (v: string): string => v.replace(/\$\{workspaceFolder\}|\$\{workspaceRoot\}/g, root)
  for (const item of Array.isArray(list) ? list : []) {
    if (!item || typeof item !== 'object') continue
    const e = item as Record<string, unknown>
    if (e.type !== 'dart' || (e.request !== undefined && e.request !== 'launch')) continue
    const base = typeof e.cwd === 'string' ? path.resolve(root, expand(e.cwd)) : root
    const file = path.resolve(base, typeof e.program === 'string' ? expand(e.program) : 'lib/main.dart')
    const cwd = existsSync(path.join(base, 'pubspec.yaml')) && isWithin(base, file) ? base : pubspecDir(path.dirname(file), root)
    const env: Record<string, string> = {}
    if (e.env && typeof e.env === 'object') for (const [k, v] of Object.entries(e.env)) if (typeof v === 'string' || typeof v === 'number') env[k] = String(v)
    const args = [...strArray(e.toolArgs), ...strArray(e.args)]
    const name = typeof e.name === 'string' && e.name.trim() ? e.name.trim().slice(0, 80) : path.basename(file)
    out.push({
      id: importId(root, source, name),
      type: 'flutter',
      name,
      cwd,
      shared: false,
      env,
      beforeLaunch: [],
      entrypoint: relPosix(cwd, file),
      device: typeof e.deviceId === 'string' && e.deviceId ? e.deviceId : 'selected',
      mode: e.flutterMode === 'profile' || e.flutterMode === 'release' ? e.flutterMode : 'debug',
      flavor: '',
      args: args.length ? quoteForDisplay(args.map(expand)) : '',
      attachArgs: '',
    })
  }
  return finish(out, root)
}

function finish(list: RunConfig[], root: string): RunConfig[] {
  const seen = new Set<string>()
  const out: RunConfig[] = []
  for (const raw of list) {
    const c = cleanRunConfig({ ...raw, env: dropBlockedEnv(raw.env) }, root)
    if (c && !seen.has(c.id)) {
      seen.add(c.id)
      out.push(c)
    }
  }
  return out
}
