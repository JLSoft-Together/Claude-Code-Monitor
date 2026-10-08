import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import path from 'node:path'
import type { JobStopResult } from '@ccm/shared'

export const STOPPABLE_JOB_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{3,63}$/

export interface CliRun {
  code: number | null
  stdout: string
  stderr: string
}

export type CliRunner = (file: string, args: string[]) => Promise<CliRun>

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  )

export function claudeCliCandidates(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string[] {
  const win = platform === 'win32'
  const exe = win ? 'claude.exe' : 'claude'
  const out: string[] = []
  for (const dir of (env.PATH ?? env.Path ?? '').split(path.delimiter)) {
    if (!dir) continue
    out.push(path.join(dir, exe))
    out.push(path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', exe))
  }
  const home = env.USERPROFILE ?? env.HOME
  if (home) out.push(path.join(home, '.local', 'bin', exe))
  return out
}

export async function findClaudeCli(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): Promise<string | null> {
  for (const file of claudeCliCandidates(env, platform)) if (await exists(file)) return path.normalize(file)
  return null
}

const defaultRunner: CliRunner = (file, args) =>
  new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 20_000, maxBuffer: 64 * 1024, shell: false }, (err, stdout, stderr) => {
      const code = !err ? 0 : typeof err.code === 'number' ? err.code : null
      resolve({ code, stdout: String(stdout), stderr: String(stderr) })
    })
  })

export interface StopJobDeps {
  findCli?: () => Promise<string | null>
  run?: CliRunner
}

export async function stopBackgroundJob(jobId: string, deps: StopJobDeps = {}): Promise<JobStopResult> {
  if (!STOPPABLE_JOB_ID.test(jobId)) return 'failed'
  const cli = await (deps.findCli ?? findClaudeCli)()
  if (!cli) return 'noCli'
  try {
    const res = await (deps.run ?? defaultRunner)(cli, ['stop', jobId])
    if (res.code === 0) return 'ok'
    const output = `${res.stdout}\n${res.stderr}`
    if (/no job matching/i.test(output)) return 'notFound'
    return /could(?:n't| not) confirm/i.test(output) ? 'unconfirmed' : 'failed'
  } catch {
    return 'failed'
  }
}
