import type { ChildProcess } from 'node:child_process'
import { expandArgs } from './args'
import { runBeforeLaunch, runStep, stopChild } from './before'
import { substVars } from './proc'
import { BadArgError, resolveCommand, withArgs, type ResolvedCommand } from './resolve'
import type { RunnerFactory } from './types'

const STOP_GRACE_MS = 3_000

export const createCustomRunner: RunnerFactory = (ctx) => {
  let child: ChildProcess | null = null
  let stopping = false
  let ended = false
  const resolve = (cmd: string) => resolveCommand(cmd, ctx.config.cwd, { ...ctx.env, ...ctx.config.env }, ctx.platform)
  const cancel = (): void => {
    ended = true
    ctx.hooks.state('cancelled')
  }

  return {
    async start() {
      const { config, hooks } = ctx
      if (config.type !== 'custom') return hooks.fail({ code: 'spawn' })
      if (config.beforeLaunch.length) {
        hooks.state('before-launch')
        const ok = await runBeforeLaunch(ctx, resolve, (c) => (child = c), () => stopping)
        if (stopping) return cancel()
        if (!ok) return hooks.fail({ code: 'before-launch' })
      }
      const argv = expandArgs(config.command, substVars(config.cwd, ctx.root, ctx.env, config.env))
      let cmd: ResolvedCommand
      try {
        const head = argv[0] ? resolve(argv[0]) : null
        if (!head) return hooks.fail({ code: 'spawn', detail: argv[0] ?? '' })
        cmd = withArgs(head, argv.slice(1))
      } catch (e) {
        return hooks.fail({ code: e instanceof BadArgError ? 'bad-arg' : 'spawn' })
      }
      if (stopping) return cancel()
      hooks.state('running')
      const step = runStep(ctx, cmd.file, cmd.args, { verbatim: cmd.verbatim, stream: 'app' })
      child = step.child
      const ok = await step.done
      child = null
      ended = true
      if (stopping || ok) hooks.state('stopped')
      else hooks.fail({ code: 'exit' })
    },
    async stop() {
      if (stopping || ended) return
      stopping = true
      const c = child
      if (!c) return
      ctx.hooks.state('stopping')
      // Batch shims and their grandchildren ignore a plain signal on Windows; the tree has to go at once.
      stopChild(c)
      if (c.exitCode !== null || c.signalCode !== null) return
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, STOP_GRACE_MS)
        const done = (): void => {
          clearTimeout(timer)
          resolve()
        }
        c.once('exit', done)
        c.once('close', done)
      })
    },
    kill() {
      stopping = true
      stopChild(child, true)
    },
  }
}
