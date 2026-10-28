/** IntelliJ / VS Code REST Client `.http` files: requests split by `###`, `@name = value` file variables, `{{name}}` placeholders. */

export interface HttpFileRequest {
  /** `### name` or `# @name name`; null = unnamed. */
  name: string | null
  /** 1-based line of the request line; `startLine`..`endLine` = the whole block. */
  line: number
  startLine: number
  endLine: number
  method: string
  url: string
  headers: Array<[string, string]>
  body: string
}

export interface HttpFile {
  requests: HttpFileRequest[]
  vars: Record<string, string>
}

export type HttpEnvs = Record<string, Record<string, string>>

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT'])
const REQUEST_LINE = /^([A-Z]+)\s+(\S.*?)(?:\s+HTTP\/\d(?:\.\d)?)?\s*$/
const BARE_URL = /^(?:https?:\/\/|\{\{)\S*/
const FILE_VAR = /^@([A-Za-z_$][\w.$-]*)\s*=\s*(.*?)\s*$/
const NAME_TAG = /^(?:#|\/\/)\s*@name\s*[=\s]\s*(\S.*?)\s*$/
const HEADER = /^([!#$%&'*+.^_`|~0-9A-Za-z-]+)\s*:\s*(.*?)\s*$/
const isComment = (l: string): boolean => /^\s*(?:#|\/\/)/.test(l)
const SECRET = /token|secret|key|password|passwd|auth/i
export const MASK = '•••'

export function parseHttpFile(text: string): HttpFile {
  const lines = text.split(/\r?\n/)
  const requests: HttpFileRequest[] = []
  const vars: Record<string, string> = {}
  let i = 0
  while (i < lines.length) {
    let name: string | null = null
    const startLine = i + 1
    if (/^###/.test(lines[i]!)) {
      name = lines[i]!.replace(/^#+/, '').trim() || null
      i++
    }
    let end = i
    while (end < lines.length && !/^###/.test(lines[end]!)) end++
    const req = parseBlock(lines, i, end, vars)
    if (req) requests.push({ ...req, name: req.name ?? name, startLine, endLine: end })
    i = end
  }
  return { requests, vars }
}

function parseBlock(lines: string[], from: number, to: number, vars: Record<string, string>): Omit<HttpFileRequest, 'startLine' | 'endLine'> | null {
  let name: string | null = null
  let i = from
  let reqLine = -1
  let method = 'GET'
  let url = ''
  for (; i < to; i++) {
    const l = lines[i]!.trim()
    if (!l) continue
    const tag = NAME_TAG.exec(l)
    if (tag) {
      name = tag[1]!
      continue
    }
    if (isComment(l)) continue
    const v = FILE_VAR.exec(l)
    if (v) {
      vars[v[1]!] = v[2]!
      continue
    }
    const m = REQUEST_LINE.exec(l)
    if (m && METHODS.has(m[1]!)) {
      method = m[1]!
      url = m[2]!
    } else if (BARE_URL.test(l)) url = l.replace(/\s+HTTP\/\d(?:\.\d)?\s*$/, '')
    else return null
    reqLine = i
    i++
    break
  }
  if (reqLine < 0) return null
  // Continuation lines of a long URL (`  ?a=1`, `  &b=2`).
  while (i < to && /^\s+[?&/]/.test(lines[i]!)) url += lines[i++]!.trim()
  const headers: Array<[string, string]> = []
  for (; i < to; i++) {
    const raw = lines[i]!
    if (!raw.trim()) {
      i++
      break
    }
    if (isComment(raw)) continue
    const h = HEADER.exec(raw.trim())
    if (h) headers.push([h[1]!, h[2]!])
    else break
  }
  const bodyLines = lines.slice(i, to)
  // Response handlers / redirects (`> {% … %}`, `<> file`) are not sent.
  const handler = bodyLines.findIndex((l) => /^>\s*(?:\{%|\S)/.test(l) || /^<>\s/.test(l))
  const kept = handler >= 0 ? bodyLines.slice(0, handler) : bodyLines
  while (kept.length && !kept[kept.length - 1]!.trim()) kept.pop()
  return { name, line: reqLine + 1, method, url, headers, body: kept.join('\n') }
}

/** Variables of one environment: `$shared` first, then the named env; private file values win over the public ones. */
export function envVars(publicEnvs: HttpEnvs | null, privateEnvs: HttpEnvs | null, env: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  for (const src of [publicEnvs, privateEnvs]) Object.assign(out, src?.$shared ?? {})
  if (env) for (const src of [publicEnvs, privateEnvs]) Object.assign(out, src?.[env] ?? {})
  return out
}

/** `http-client.env.json` content → envs of string values; null when it is not an object of objects. */
export function parseEnvFile(text: string): HttpEnvs | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const out: HttpEnvs = {}
  for (const [env, values] of Object.entries(raw as Record<string, unknown>)) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) continue
    const vars: Record<string, string> = {}
    for (const [k, v] of Object.entries(values as Record<string, unknown>)) vars[k] = typeof v === 'string' ? v : JSON.stringify(v)
    out[env] = vars
  }
  return out
}

export const envNames = (...sources: Array<HttpEnvs | null>): string[] =>
  [...new Set(sources.flatMap((s) => Object.keys(s ?? {})))].filter((n) => n !== '$shared').sort((a, b) => a.localeCompare(b))

export const isSecretName = (name: string): boolean => SECRET.test(name)

const PLACEHOLDER = /\{\{\s*([^{}\s]+)\s*\}\}/g

function dynamic(name: string): string | null {
  if (name === '$uuid' || name === '$random.uuid') return crypto.randomUUID()
  if (name === '$timestamp') return String(Math.floor(Date.now() / 1000))
  if (name === '$isoTimestamp') return new Date().toISOString()
  if (name === '$randomInt' || name === '$random.integer') return String(Math.floor(Math.random() * 1000))
  return null
}

export interface Resolved {
  text: string
  /** Same text with secret-named values as `•••`, for the UI. */
  shown: string
  missing: string[]
}

/** Fills `{{name}}`; values may hold placeholders themselves (resolved up to a few levels, so a cycle stops). */
export function resolve(template: string, vars: Record<string, string>, depth = 0, drawn: Map<string, string> = new Map()): Resolved {
  const missing: string[] = []
  const fill = (masking: boolean) =>
    template.replace(PLACEHOLDER, (whole, name: string) => {
      if (name.startsWith('$')) {
        const dyn = drawn.get(name) ?? dynamic(name)
        if (dyn !== null) {
          drawn.set(name, dyn)
          return dyn
        }
      }
      if (!(name in vars)) {
        if (!masking && !missing.includes(name)) missing.push(name)
        return whole
      }
      const inner = depth < 4 ? resolve(vars[name]!, vars, depth + 1, drawn) : { text: vars[name]!, shown: vars[name]!, missing: [] }
      if (!masking) for (const m of inner.missing) if (!missing.includes(m)) missing.push(m)
      return masking ? (isSecretName(name) ? MASK : inner.shown) : inner.text
    })
  return { text: fill(false), shown: fill(true), missing }
}

export interface BuiltRequest {
  method: string
  url: string
  headers: Array<[string, string]>
  body: string
  shown: { url: string; headers: Array<[string, string]>; body: string }
  missing: string[]
}

/** Request with every placeholder filled; a dynamic value (`$uuid`) is drawn once per request. File variables win over env ones. */
export function buildRequest(req: HttpFileRequest, fileVars: Record<string, string>, env: Record<string, string>): BuiltRequest {
  const vars = { ...env, ...fileVars }
  const missing = new Set<string>()
  const drawn = new Map<string, string>()
  const r = (s: string) => {
    const out = resolve(s, vars, 0, drawn)
    out.missing.forEach((m) => missing.add(m))
    return out
  }
  const url = r(req.url)
  const headers = req.headers.map(([k, v]) => [k, r(v)] as const)
  const body = r(req.body)
  return {
    method: req.method,
    url: url.text,
    headers: headers.map(([k, v]) => [k, v.text]),
    body: body.text,
    shown: { url: url.shown, headers: headers.map(([k, v]) => [k, v.shown]), body: body.shown },
    missing: [...missing],
  }
}

/** Request whose block holds 1-based `line`, else null. */
export const requestAt = (file: HttpFile, line: number): HttpFileRequest | null => file.requests.find((r) => line >= r.startLine && line <= r.endLine) ?? null

export const isHttpFile = (path: string): boolean => /\.(?:http|rest)$/i.test(path)

/** JSON body pretty printed, else null (the raw text shows). */
export function prettyJson(body: string, contentType: string | undefined): string | null {
  const t = body.trim()
  if (!t || (!/json/i.test(contentType ?? '') && !/^[[{]/.test(t))) return null
  try {
    return JSON.stringify(JSON.parse(t), null, 2)
  } catch {
    return null
  }
}

export const statusTone = (status: number): 'success' | 'redirect' | 'warning' | 'error' =>
  status >= 500 ? 'error' : status >= 400 ? 'warning' : status >= 300 ? 'redirect' : 'success'
