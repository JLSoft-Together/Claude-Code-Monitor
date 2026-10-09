import { execFile } from 'node:child_process'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
}

export type Runner = (command: string, args: string[]) => Promise<RunResult>

export const runCommand: Runner = (command, args) =>
  new Promise((resolve) => {
    execFile(command, args, { timeout: 10_000, maxBuffer: 8_000_000, windowsHide: true }, (err, stdout, stderr) => {
      const code = !err ? 0 : typeof err.code === 'number' ? err.code : 1
      resolve({ code, stdout: String(stdout), stderr: String(stderr) || (err ? err.message : '') })
    })
  })

export type OsaError = 'denied' | 'notInstalled' | 'cancelled' | 'failed'

export function parseOsaError(stderr: string): OsaError {
  if (/\(-1743\)/.test(stderr)) return 'denied'
  if (/\(-128\)/.test(stderr)) return 'cancelled'
  if (/\(-(2700|10814)\)|Can[’']t get application/.test(stderr)) return 'notInstalled'
  return 'failed'
}
