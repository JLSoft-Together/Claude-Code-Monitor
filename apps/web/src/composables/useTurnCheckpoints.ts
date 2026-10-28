import { watch } from 'vue'
import { hasCheckpoints } from '../lib/preview'
import { displayTitle } from '../lib/title'
import { useCheckpointsStore } from '../stores/checkpoints'
import { useTerminalsStore } from '../stores/terminals'

/**
 * A session turning busy (turn starts) or settling (turn ends) snapshots its repo, for repos with checkpoints
 * on. Only status edges are watched; the snapshot runs in the main process.
 */
export function useTurnCheckpoints(): void {
  if (!hasCheckpoints) return
  const terminals = useTerminalsStore()
  const checkpoints = useCheckpointsStore()
  const last = new Map<string, string>()
  watch(
    () => terminals.list.map((t) => `${t.id}\u0000${t.status}`).join('\u0001'),
    () => {
      for (const t of terminals.list) {
        const prev = last.get(t.id)
        last.set(t.id, t.status)
        if (!t.cwd || prev === undefined || prev === t.status) continue
        if (t.status === 'working') void checkpoints.take(t.cwd, `before:${displayTitle(t)}`)
        else if (prev === 'working' && (t.status === 'idle' || t.status === 'waiting')) void checkpoints.take(t.cwd, `after:${displayTitle(t)}`)
      }
    },
  )
}
