import { execFile } from 'node:child_process'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

export type Runner = (command: string, args: string[]) => Promise<RunResult>

export const runCommand = (command: string, args: string[], timeout = 10_000): Promise<RunResult> =>
  new Promise((resolve) => {
    execFile(command, args, { timeout, maxBuffer: 8_000_000, windowsHide: true }, (err, stdout, stderr) => {
      const code = !err ? 0 : typeof err.code === 'number' ? err.code : 1
      resolve({ code, stdout: String(stdout), stderr: String(stderr) || (err ? err.message : '') })
    })
  })

export type OsaError = 'denied' | 'notInstalled' | 'cancelled' | 'failed'

export function parseOsaError(stderr: string): OsaError {
  if (/\(-1743\)/.test(stderr)) return 'denied'
  if (/\(-1728\)|Can[’']t get application/.test(stderr)) return 'notInstalled'
  if (/\(-128\)/.test(stderr)) return 'cancelled'
  return 'failed'
}
