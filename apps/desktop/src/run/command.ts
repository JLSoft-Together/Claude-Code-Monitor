import { existsSync } from 'node:fs'
import path from 'node:path'
import type { AndroidRunConfig, CustomRunConfig, EnvIssue, FlutterRunConfig, RunCommandPreview, RunConfig, RunProject } from '@ccm/shared'
import { expandArgs, quoteForDisplay, type SubstituteVars } from './args'
import { substVars } from './proc'

export interface FlutterArgvCtx extends SubstituteVars {
  /** Resolved `flutter` executable (FVM / setting / PATH). */
  flutterFile: string
}

const resolveDevice = (cfg: { device: string }, picked: string | null | undefined): string | null => (cfg.device !== 'selected' ? cfg.device : picked || null)

/** `flutter run --machine -d <device> -t <entrypoint> [--flavor f] --<mode> <args>`; `-d` omitted without a device. */
export function flutterArgv(cfg: FlutterRunConfig, deviceId: string | null, ctx: FlutterArgvCtx): string[] {
  const device = resolveDevice(cfg, deviceId)
  return [
    ctx.flutterFile,
    'run',
    '--machine',
    ...(device ? ['-d', device] : []),
    '-t',
    cfg.entrypoint,
    ...(cfg.flavor ? ['--flavor', cfg.flavor] : []),
    `--${cfg.mode}`,
    ...expandArgs(cfg.args, ctx),
  ]
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

export function androidGradleArgs(cfg: AndroidRunConfig, vars?: SubstituteVars): string[] {
  const extra = vars ? expandArgs(cfg.args, vars) : expandArgs(cfg.args, { projectDir: cfg.cwd, workspaceDir: cfg.cwd, env: cfg.env })
  return [`${cfg.module}:assemble${cap(cfg.variant)}`, '--console=plain', ...extra]
}

export function customArgv(cfg: CustomRunConfig, vars?: SubstituteVars): string[] {
  return expandArgs(cfg.command, vars ?? { projectDir: cfg.cwd, workspaceDir: cfg.cwd, env: cfg.env })
}

export interface PreviewCtx {
  /** flutter for `flutter`, gradlew for `android`; unused for `custom`. */
  executable: string
  deviceId: string | null
  workspaceDir: string
  env: Record<string, string | undefined>
  /** Detected project at cfg.cwd, when known: enables flavor / module checks. */
  project?: RunProject | null
  exists?: (p: string) => boolean
}

/** Every `--dart-define-from-file=x` / `--dart-define-from-file x` value, in order. */
export function defineFiles(argv: readonly string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (a.startsWith('--dart-define-from-file=')) out.push(a.slice('--dart-define-from-file='.length))
    else if (a === '--dart-define-from-file' && argv[i + 1] !== undefined) out.push(argv[++i]!)
  }
  return out.filter(Boolean)
}

/** argv/command are for display: ${env:NAME} values are masked; validation uses the real values. */
export function previewCommand(cfg: RunConfig, ctx: PreviewCtx): RunCommandPreview {
  const exists = ctx.exists ?? existsSync
  const vars = substVars(cfg.cwd, ctx.workspaceDir, ctx.env, cfg.env)
  const shown: SubstituteVars = { ...vars, maskEnv: true }
  const errors: EnvIssue[] = []
  let argv: string[]
  if (cfg.type === 'flutter') {
    argv = flutterArgv(cfg, ctx.deviceId, { ...shown, flutterFile: ctx.executable })
    if (!exists(path.resolve(cfg.cwd, cfg.entrypoint))) errors.push({ code: 'entrypoint-missing', detail: cfg.entrypoint })
    for (const f of defineFiles(expandArgs(cfg.args, vars))) if (!exists(path.resolve(cfg.cwd, f))) errors.push({ code: 'define-file-missing', detail: f })
    const p = ctx.project
    if (cfg.flavor && p?.kind === 'flutter' && p.flavors.length && !p.flavors.includes(cfg.flavor)) errors.push({ code: 'flavor-unknown', detail: cfg.flavor })
    if (!resolveDevice(cfg, ctx.deviceId)) errors.push({ code: 'device-missing' })
  } else if (cfg.type === 'android') {
    argv = [ctx.executable, ...androidGradleArgs(cfg, shown)]
    const p = ctx.project
    if (p?.kind === 'android' && !p.modules.some((m) => m.path === cfg.module)) errors.push({ code: 'module-unknown', detail: cfg.module })
    if (!resolveDevice(cfg, ctx.deviceId)) errors.push({ code: 'device-missing' })
  } else {
    argv = customArgv(cfg, shown)
    if (!argv.length) errors.push({ code: 'command-empty' })
  }
  return { argv, command: quoteForDisplay(argv), errors }
}
