import type { ChildProcess } from 'node:child_process'
import path from 'node:path'
import { expandArgs } from './args'
import { lineSplitter } from './parse'
import { killTree, substVars } from './proc'
import { withArgs, type ResolvedCommand } from './resolve'
import type { RunContext } from './types'

/** After 'exit', a grandchild that inherited the pipes can hold 'close' back indefinitely. */
const EXIT_GRACE_MS = 1_500

export interface StepHandle {
  done: Promise<boolean>
  child: ChildProcess | null
}

/** Runs one shell-free command in `cwd`, streaming both pipes into the build log. Resolves true on exit 0. */
export function runStep(ctx: RunContext, file: string, args: string[], opts: { verbatim?: boolean; stream?: 'build' | 'app' } = {}): StepHandle {
  let child: ChildProcess
  try {
    child = ctx.spawn({ file, args, cwd: ctx.config.cwd, env: ctx.config.env, verbatim: opts.verbatim })
  } catch {
    return { done: Promise.resolve(false), child: null }
  }
  const stream = opts.stream ?? 'build'
  const out = lineSplitter((text) => ctx.hooks.log({ stream, text }))
  const err = lineSplitter((text) => ctx.hooks.log({ stream, text }))
  child.stdout?.on('data', out.push)
  child.stderr?.on('data', err.push)
  const done = new Promise<boolean>((resolve) => {
    let settled = false
    let exitTimer: NodeJS.Timeout | null = null
    let exitCode: number | null = null
    const finish = (code: number | null): void => {
      if (settled) return
      settled = true
      if (exitTimer) clearTimeout(exitTimer)
      out.flush()
      err.flush()
      resolve(code === 0)
    }
    child.once('error', () => {
      if (settled) return
      settled = true
      if (exitTimer) clearTimeout(exitTimer)
      resolve(false)
    })
    child.once('exit', (code) => {
      exitCode = code
      exitTimer = setTimeout(() => finish(code), EXIT_GRACE_MS)
    })
    child.once('close', (code) => finish(code ?? exitCode))
  })
  return { done, child }
}

/**
 * `beforeLaunch` entries: argv[0] resolved by the caller-provided `resolve` (PATH / .cmd shims);
 * returns false at the first failure. `cancelled()` is polled between steps.
 */
export async function runBeforeLaunch(
  ctx: RunContext,
  resolve: (cmd: string) => ResolvedCommand | null,
  track: (child: ChildProcess | null) => void,
  cancelled: () => boolean,
): Promise<boolean> {
  const vars = substVars(ctx.config.cwd, ctx.root, ctx.env, ctx.config.env)
  for (const line of ctx.config.beforeLaunch) {
    if (cancelled()) return false
    const argv = expandArgs(line, vars)
    const head = argv[0]
    if (!head) continue
    let full: ResolvedCommand
    try {
      const spec = resolve(head)
      if (!spec) {
        ctx.hooks.log({ stream: 'build', text: `${path.basename(head)}: not found` })
        return false
      }
      full = withArgs(spec, argv.slice(1))
    } catch {
      ctx.hooks.log({ stream: 'build', text: `${line}: an argument contains a line break or NUL` })
      return false
    }
    ctx.hooks.log({ stream: 'build', text: `> ${line}` })
    const step = runStep(ctx, full.file, full.args, { verbatim: full.verbatim })
    track(step.child)
    const ok = await step.done
    track(null)
    if (!ok) return false
  }
  return true
}

export function stopChild(child: ChildProcess | null, sync = false): void {
  if (child) killTree(child, sync)
}
