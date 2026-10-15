import { wordDiff } from './diffBlocks'
import { tokenizePacked } from './highlightCore'
import type { WorkerReply, WorkerRequest } from './highlight'

const cancelled = new Set<number>()
// Typed by hand: the DOM and WebWorker libs cannot share one tsconfig.
const scope = self as unknown as { onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null; postMessage(msg: WorkerReply, transfer?: Transferable[]): void }

scope.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data
  if (msg.op === 'cancel') {
    cancelled.add(msg.id)
    return
  }
  // Queued behind a long tokenize and already superseded: skip the work.
  if (cancelled.delete(msg.id)) return scope.postMessage({ id: msg.id, result: null } satisfies WorkerReply)
  if (msg.op === 'wordDiff') {
    const result = msg.pairs.map((p) => wordDiff(p.old, p.new, p.mode))
    scope.postMessage({ id: msg.id, result } satisfies WorkerReply)
    return
  }
  const packed = await tokenizePacked(msg.code, msg.lang)
  if (cancelled.delete(msg.id) || !packed) return scope.postMessage({ id: msg.id, result: null } satisfies WorkerReply)
  scope.postMessage({ id: msg.id, result: packed } satisfies WorkerReply, [packed.counts.buffer, packed.toks.buffer])
}
