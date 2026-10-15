import type { ChildProcess } from 'node:child_process'
import { lineSplitter, machineRequest, parseMachineLine } from '../parse'

export type MachineReply = { result?: unknown; error?: unknown }

export interface MachineClient {
  request: (method: string, params: Record<string, unknown>) => Promise<MachineReply>
  /** Emit a trailing stdout line without newline (call on child `close`). */
  flush: () => void
  /** Settles every pending request with `{ error: 'exited' }`; later requests get `not-running`. */
  dispose: () => void
}

export interface MachineHandlers {
  onEvent: (event: string, params: Record<string, unknown>) => void
  onText: (line: string) => void
}

/** JSON-RPC over the stdio of `flutter run --machine` / `flutter daemon`. */
export function createMachineClient(child: ChildProcess, handlers: MachineHandlers): MachineClient {
  const pending = new Map<number, (r: MachineReply) => void>()
  let nextId = 1
  let disposed = false

  const out = lineSplitter((line) => {
    const msg = parseMachineLine(line)
    if (msg.kind === 'event') return handlers.onEvent(msg.event, msg.params)
    if (msg.kind === 'response') {
      const resolve = pending.get(msg.id)
      pending.delete(msg.id)
      resolve?.({ result: msg.result, error: msg.error })
      return
    }
    handlers.onText(line)
  })
  child.stdout?.on('data', out.push)

  return {
    request(method, params) {
      const stdin = child.stdin
      if (disposed || !stdin || stdin.destroyed) return Promise.resolve({ error: 'not-running' })
      const id = nextId++
      return new Promise((resolve) => {
        pending.set(id, resolve)
        stdin.write(machineRequest(id, method, params))
      })
    },
    flush: out.flush,
    dispose() {
      disposed = true
      for (const resolve of pending.values()) resolve({ error: 'exited' })
      pending.clear()
    },
  }
}
