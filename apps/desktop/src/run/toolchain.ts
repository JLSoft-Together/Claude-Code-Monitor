import { execFile } from 'node:child_process'
import path from 'node:path'
import type { AndroidEnv, EnvIssue, ToolchainCheck, ToolchainReport, ToolchainStatus } from '@ccm/shared'
import { machineJsonArray } from './flutter/devices'
import { flutterSpawn, type SpawnSpec } from './flutter/env'
import { runEnv } from './proc'

export interface ToolchainExec {
  /** Never through a shell; resolves even on a non-zero exit (doctor exits 1 when a validator fails). */
  (spec: SpawnSpec, timeoutMs: number): Promise<{ stdout: string; stderr: string; timedOut: boolean } | null>
}

export const defaultToolchainExec: ToolchainExec = (spec, timeoutMs) =>
  new Promise((resolve) => {
    execFile(
      spec.file,
      spec.args,
      { timeout: timeoutMs, windowsHide: true, shell: false, maxBuffer: 2 * 1024 * 1024, env: runEnv(process.env), windowsVerbatimArguments: spec.windowsVerbatimArguments === true },
      (err, stdout, stderr) => {
        const timedOut = !!err && (err as { killed?: boolean }).killed === true
        if (err && !timedOut && !stdout && !stderr) resolve(null)
        else resolve({ stdout: String(stdout), stderr: String(stderr), timedOut })
      },
    )
  })

const DOCTOR_TIMEOUT = 180_000
const TOOL_TIMEOUT = 20_000

const STATUS: Record<string, ToolchainStatus> = { installed: 'ok', partial: 'warning', notAvailable: 'error', missing: 'error' }
const MESSAGE_STATUS: Record<string, ToolchainStatus> = { information: 'ok', hint: 'warning', error: 'error' }

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** `flutter doctor --machine` (newer SDKs): `[{ name|title, type|status, statusInfo, messages: [{ message, type }] }]`. */
export function parseDoctorMachine(stdout: string): ToolchainCheck[] | null {
  const list = machineJsonArray(stdout)
  if (!list) return null
  const checks: ToolchainCheck[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const v = raw as Record<string, unknown>
    const name = str(v.name) || str(v.title) || str(v.validatorName)
    if (!name) continue
    const messages = (Array.isArray(v.messages) ? v.messages : []).flatMap((m) => {
      const msg = m as Record<string, unknown> | null
      const text = str(msg?.message)
      return text ? [{ status: MESSAGE_STATUS[str(msg?.type)] ?? 'ok', text }] : []
    })
    checks.push({ name, status: STATUS[str(v.type) || str(v.status)] ?? 'warning', summary: str(v.statusInfo), messages })
  }
  return checks.length ? checks : null
}

const MARK: Record<string, ToolchainStatus> = { '✓': 'ok', '√': 'ok', '!': 'warning', '-': 'warning', '✗': 'error', X: 'error', x: 'error', '☠': 'error' }
const BULLET: Record<string, ToolchainStatus> = { '•': 'ok', '✓': 'ok', '√': 'ok', '!': 'warning', '✗': 'error', X: 'error', '☠': 'error' }

/** `flutter doctor -v` text: `[✓] Name (summary)` / `[!] Name - summary` rows, indented `• ! ✗` messages below. */
export function parseDoctorText(stdout: string): ToolchainCheck[] {
  const checks: ToolchainCheck[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const head = /^\[(.)\]\s+(.+)$/.exec(line)
    if (head) {
      const title = head[2]!.trim()
      const paren = /^(.*?)\s+\((.*)\)\s*$/.exec(title)
      const dash = /^(.*?)\s+-\s+(.*)$/.exec(title)
      const [name, summary] = paren ? [paren[1]!, paren[2]!] : dash ? [dash[1]!, dash[2]!] : [title, '']
      checks.push({ name, status: MARK[head[1]!] ?? 'warning', summary, messages: [] })
      continue
    }
    const item = /^\s+([•✓√!✗X☠])\s+(.+)$/.exec(line)
    const last = checks.at(-1)
    if (item && last) last.messages.push({ status: BULLET[item[1]!] ?? 'ok', text: item[2]!.trim() })
  }
  return checks
}

export interface FlutterToolchainOpts {
  sdk: string | null
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  exec: ToolchainExec
  mask: (text: string) => string
  now?: () => number
}

const report = (kind: ToolchainReport['kind'], checks: ToolchainCheck[], error: EnvIssue | null, now: () => number): ToolchainReport => ({ kind, checks, error, at: now() })

function masked(checks: ToolchainCheck[], mask: (t: string) => string): ToolchainCheck[] {
  return checks.map((c) => ({
    ...c,
    name: mask(c.name),
    summary: mask(c.summary),
    messages: c.messages.map((m) => ({ ...m, text: mask(m.text), ...(m.issue?.detail ? { issue: { ...m.issue, detail: mask(m.issue.detail) } } : {}) })),
  }))
}

/** Explicit "Check toolchain" only: `flutter doctor --machine`, then `doctor -v` when the SDK has no machine output. */
export async function flutterToolchain(opts: FlutterToolchainOpts): Promise<ToolchainReport> {
  const now = opts.now ?? Date.now
  if (!opts.sdk) return report('flutter', [], { code: 'flutter-missing' }, now)
  for (const args of [['doctor', '--machine'], ['doctor', '-v']]) {
    let spec: SpawnSpec
    try {
      spec = flutterSpawn(opts.sdk, args, opts.platform, opts.env)
    } catch {
      return report('flutter', [], { code: 'bad-arg' }, now)
    }
    const res = await opts.exec(spec, DOCTOR_TIMEOUT)
    if (!res) return report('flutter', [], { code: 'doctor-failed' }, now)
    if (res.timedOut) return report('flutter', [], { code: 'doctor-failed', detail: 'timeout' }, now)
    const checks = args[1] === '--machine' ? parseDoctorMachine(res.stdout) : parseDoctorText(res.stdout)
    if (checks?.length) return report('flutter', masked(checks, opts.mask), null, now)
  }
  return report('flutter', [], { code: 'doctor-failed' }, now)
}

export interface AndroidToolchainOpts {
  env: AndroidEnv
  platform: NodeJS.Platform
  exec: ToolchainExec
  mask: (text: string) => string
  now?: () => number
}

const firstLine = (text: string): string => text.split(/\r?\n/).find((l) => l.trim())?.trim() ?? ''
const issuesOf = (env: AndroidEnv, prefix: string): { status: ToolchainStatus; text: string; issue: EnvIssue }[] =>
  env.issues.filter((i) => i.code.startsWith(prefix)).map((i) => ({ status: i.code.endsWith('-unverified') ? 'warning' : 'error', text: i.code, issue: i }))

/** Android plan §3 checks from the resolved env plus `java -version` / `adb version` output. */
export async function androidToolchain(opts: AndroidToolchainOpts): Promise<ToolchainReport> {
  const { env, platform, mask } = opts
  const now = opts.now ?? Date.now
  const exe = (name: string): string => (platform === 'win32' ? `${name}.exe` : name)
  const p = platform === 'win32' ? path.win32 : path.posix
  const checks: ToolchainCheck[] = []

  const java = env.jdk ? p.join(env.jdk, 'bin', exe('java')) : null
  const javaOut = java ? await opts.exec({ file: java, args: ['-version'] }, TOOL_TIMEOUT) : null
  const jdkIssues = issuesOf(env, 'jdk-')
  checks.push({
    name: 'jdk',
    status: !env.jdk ? 'error' : jdkIssues.some((i) => i.status === 'error') ? 'error' : jdkIssues.length ? 'warning' : 'ok',
    summary: javaOut ? firstLine(`${javaOut.stderr}\n${javaOut.stdout}`) : env.jdkVersion ? `Java ${env.jdkVersion}` : '',
    messages: [...(env.jdk ? [{ status: 'ok' as const, text: env.jdk }] : []), ...(env.jdkNote ? [{ status: 'ok' as const, text: env.jdkNote }] : []), ...jdkIssues],
  })

  checks.push({ name: 'sdk', status: env.sdk ? 'ok' : 'error', summary: env.sdk ?? '', messages: issuesOf(env, 'sdk-') })

  const adbOut = env.adb ? await opts.exec({ file: env.adb, args: ['version'] }, TOOL_TIMEOUT) : null
  checks.push({
    name: 'adb',
    status: env.adb && adbOut ? 'ok' : 'error',
    summary: adbOut ? firstLine(adbOut.stdout) : '',
    messages: env.adb ? [{ status: 'ok', text: env.adb }] : [],
  })

  checks.push({ name: 'emulator', status: env.emulator ? 'ok' : 'warning', summary: env.emulator ?? '', messages: [] })
  checks.push({ name: 'gradlew', status: env.gradlew && !issuesOf(env, 'gradlew-').length ? 'ok' : 'error', summary: '', messages: issuesOf(env, 'gradlew-') })

  return report('android', masked(checks, mask), null, now)
}
