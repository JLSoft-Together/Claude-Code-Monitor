import { spawn } from 'node:child_process'
import { findGit } from '../pty/git'
import { killTree } from '../run/proc'

export interface GitExecResult {
  code: number | null
  stdout: string
  stderr: string
  /** stdout went past `maxBytes`; the process was killed and `stdout` holds the first part. */
  truncated: boolean
  /** Killed after `timeoutMs` (code is null then; a spawn error also gives null without this flag). */
  timedOut?: boolean
  /** Raw stdout when `binary` was asked (then `stdout` is ''). */
  bytes?: Buffer
}

export interface GitExecOptions {
  input?: string
  maxBytes?: number
  timeoutMs?: number
  /** Kill the whole process tree on timeout: network commands leave `git-remote-https` behind on Windows otherwise. */
  killTree?: boolean
  /** Extra env on top of ours, e.g. `gitAuthEnv` for a GitHub account. */
  env?: Record<string, string>
  /** Kills the process when aborted (a newer search replaced this one); resolves with code null. */
  signal?: AbortSignal
  /** Keep stdout as bytes (`bytes`), e.g. a `cat-file blob` of an image. */
  binary?: boolean
}

let gitPath: string | null | undefined

// Pathspec magic (":(top)", "*") must never come from a file name the page passes in.
const GIT_ENV = { GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', LC_ALL: 'C', GIT_LITERAL_PATHSPECS: '1' }
const GIT_CONFIG = ['-c', 'core.quotePath=false', '-c', 'diff.noprefix=false', '-c', 'diff.mnemonicPrefix=false', '-c', 'color.ui=false', '-c', 'log.showSignature=false']

/** `git -C cwd …` with the absolute git from our own PATH walk; stdin optional, stdout capped. Never throws. */
export function execGit(cwd: string, args: string[], opts: GitExecOptions = {}): Promise<GitExecResult> {
  gitPath ??= findGit()
  const file = gitPath
  if (!file) return Promise.resolve({ code: null, stdout: '', stderr: 'git not found', truncated: false })
  const maxBytes = opts.maxBytes ?? 8 * 1024 * 1024
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(file, [...GIT_CONFIG, '-C', cwd, ...args], {
        windowsHide: true,
        env: { ...process.env, ...GIT_ENV, ...opts.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        // POSIX killTree signals the process group (-pid); only a group leader has one. Pipes stay attached, no unref.
        detached: opts.killTree === true && process.platform !== 'win32',
      })
    } catch (err) {
      resolve({ code: null, stdout: '', stderr: String(err), truncated: false })
      return
    }
    const out: Buffer[] = []
    let size = 0
    let truncated = false
    let stderr = ''
    let done = false
    let timedOut = false
    const onAbort = (): void => {
      child.kill()
      finish(null)
    }
    const finish = (code: number | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      const buf = Buffer.concat(out)
      const body = opts.binary ? { stdout: '', bytes: buf } : { stdout: buf.toString('utf8') }
      resolve({ code, ...body, stderr, truncated, ...(timedOut ? { timedOut } : {}) })
    }
    const timer = setTimeout(() => {
      timedOut = true
      if (opts.killTree) killTree(child)
      else child.kill()
      finish(null)
    }, opts.timeoutMs ?? 30_000)
    if (opts.signal?.aborted) onAbort()
    else opts.signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout!.on('data', (chunk: Buffer) => {
      if (truncated) return
      if (size + chunk.length > maxBytes) {
        out.push(chunk.subarray(0, maxBytes - size))
        size = maxBytes
        truncated = true
        child.kill()
        return
      }
      out.push(chunk)
      size += chunk.length
    })
    child.stderr!.on('data', (chunk: Buffer) => {
      if (stderr.length < 16_384) stderr += chunk.toString('utf8')
    })
    child.on('error', (err) => {
      stderr += String(err)
      finish(null)
    })
    child.on('close', (code) => finish(truncated ? 0 : code))
    child.stdin!.on('error', () => undefined)
    child.stdin!.end(opts.input ?? '')
  })
}

export const hasGitBinary = (): boolean => (gitPath ??= findGit()) !== null
