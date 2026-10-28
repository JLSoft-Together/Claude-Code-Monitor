import path from 'node:path'
import { defaultSpawner, killTree, type Spawner } from '../run/proc'
import { resolveCommand, withArgs, type ResolvedCommand } from '../run/resolve'

export type FormatterKind = 'prettier' | 'dart' | 'ktlint'
export type FormatResult =
  | { ok: true; text: string; tool: FormatterKind; local: boolean }
  | { ok: false; error: 'denied' | 'unsupported' | 'not-found' | 'failed' | 'timeout' | 'too-large' | 'busy'; tool?: FormatterKind; detail?: string }

export const FORMAT_TIMEOUT_MS = 20_000
export const FORMAT_MAX_OUT = 8 * 1024 * 1024
const TAIL = 4 * 1024
const MAX_RUNNING = 2

const PRETTIER_EXT = new Set(['js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'vue', 'json', 'jsonc', 'json5', 'css', 'scss', 'less', 'md', 'markdown', 'html', 'htm', 'yaml', 'yml'])

export function formatterFor(file: string): FormatterKind | null {
  const ext = path.extname(file).slice(1).toLowerCase()
  if (PRETTIER_EXT.has(ext)) return 'prettier'
  if (ext === 'dart') return 'dart'
  if (ext === 'kt' || ext === 'kts') return 'ktlint'
  return null
}

const LOCAL: Record<FormatterKind, string[]> = {
  prettier: ['node_modules/.bin/prettier'],
  dart: ['.fvm/flutter_sdk/bin/dart'],
  ktlint: ['ktlint'],
}

/** Folders from the file's own up to `stop` (inclusive); just the file's folder when it is not under `stop`. */
export function dirsUp(file: string, stop: string, platform: NodeJS.Platform = process.platform): string[] {
  const p = platform === 'win32' ? path.win32 : path.posix
  const fold = (s: string) => (platform === 'win32' ? s.toLowerCase() : s)
  const end = fold(p.resolve(stop))
  const out: string[] = []
  let dir = p.dirname(p.resolve(file))
  for (let i = 0; i < 64; i++) {
    out.push(dir)
    if (fold(dir) === end) return out
    const up = p.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return [p.dirname(p.resolve(file))]
}

/** Project copy first (node_modules/.bin, .fvm, a ktlint script), walking up to the project root; then PATH. */
export function resolveFormatter(
  kind: FormatterKind,
  file: string,
  stop: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  exists?: (p: string) => boolean,
): { cmd: ResolvedCommand; local: boolean } | null {
  const p = platform === 'win32' ? path.win32 : path.posix
  for (const dir of dirsUp(file, stop, platform)) {
    for (const rel of LOCAL[kind]) {
      const cmd = resolveCommand(p.join(dir, rel), dir, env, platform, exists)
      if (cmd) return { cmd, local: true }
    }
  }
  const cmd = resolveCommand(kind, p.dirname(file), env, platform, exists)
  return cmd ? { cmd, local: false } : null
}

export function formatArgs(kind: FormatterKind, file: string): string[] {
  if (kind === 'prettier') return ['--stdin-filepath', file]
  if (kind === 'dart') return ['format', '--stdin-name', file]
  return ['--format', '--stdin']
}

const tail = (s: string): string => (s.length > TAIL ? s.slice(-TAIL) : s).trim()

/** Runs one formatter with `input` on stdin; stdout is the formatted text. */
export function runFormatter(
  kind: FormatterKind,
  cmd: ResolvedCommand,
  input: string,
  cwd: string,
  opts: { spawner?: Spawner; timeoutMs?: number } = {},
): Promise<Exclude<FormatResult, { ok: true }> | { ok: true; text: string }> {
  return new Promise((resolve) => {
    let done = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (r: Exclude<FormatResult, { ok: true }> | { ok: true; text: string }): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(r)
    }
    let child: ReturnType<Spawner>
    try {
      child = (opts.spawner ?? defaultSpawner)({ file: cmd.file, args: cmd.args, cwd, verbatim: cmd.verbatim, stdin: 'pipe' })
    } catch {
      finish({ ok: false, error: 'failed', tool: kind })
      return
    }
    const out: Buffer[] = []
    let outBytes = 0
    let err = ''
    timer = setTimeout(() => {
      killTree(child)
      finish({ ok: false, error: 'timeout', tool: kind })
    }, opts.timeoutMs ?? FORMAT_TIMEOUT_MS)
    child.stdout?.on('data', (b: Buffer) => {
      outBytes += b.length
      if (outBytes > FORMAT_MAX_OUT) {
        killTree(child)
        finish({ ok: false, error: 'too-large', tool: kind })
      } else out.push(b)
    })
    child.stderr?.on('data', (b: Buffer) => {
      err = (err + b.toString('utf8')).slice(-TAIL * 2)
    })
    child.on('error', (e: NodeJS.ErrnoException) => finish({ ok: false, error: e.code === 'ENOENT' ? 'not-found' : 'failed', tool: kind }))
    child.on('close', (code) => {
      const text = Buffer.concat(out).toString('utf8')
      // ktlint exits 1 when some violations cannot be fixed, yet still prints the formatted code.
      if (code === 0 || (kind === 'ktlint' && code === 1 && text.trim())) finish({ ok: true, text })
      else finish({ ok: false, error: 'failed', tool: kind, detail: tail(err) || tail(text) })
    })
    child.stdin?.on('error', () => undefined)
    child.stdin?.end(input, 'utf8')
  })
}

export class Formatter {
  private running = 0

  constructor(private readonly deps: { spawner?: Spawner; env?: () => NodeJS.ProcessEnv; timeoutMs?: number } = {}) {}

  /** `file` is a real path inside `stop` (the project root the IPC gate found). */
  async format(file: string, stop: string, input: string): Promise<FormatResult> {
    const kind = formatterFor(file)
    if (!kind) return { ok: false, error: 'unsupported' }
    const found = resolveFormatter(kind, file, stop, this.deps.env?.() ?? process.env)
    if (!found) return { ok: false, error: 'not-found', tool: kind }
    let cmd: ResolvedCommand
    try {
      cmd = withArgs(found.cmd, formatArgs(kind, file))
    } catch {
      return { ok: false, error: 'failed', tool: kind }
    }
    if (this.running >= MAX_RUNNING) return { ok: false, error: 'busy', tool: kind }
    this.running++
    try {
      const res = await runFormatter(kind, cmd, input, path.dirname(file), { spawner: this.deps.spawner, timeoutMs: this.deps.timeoutMs })
      if (!res.ok) return res
      // The editor buffer is LF; a CRLF config would mark every line changed (Save writes the file's own EOL anyway).
      const text = input.includes('\r') ? res.text : res.text.replace(/\r\n?/g, '\n')
      return { ok: true, text, tool: kind, local: found.local }
    } finally {
      this.running--
    }
  }
}
