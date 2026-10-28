import { defineStore } from 'pinia'
import { ref } from 'vue'
import { cpSet, cpState, cpTake, type Checkpoint } from '../lib/preview'
import { dirKey } from './favorites'

export interface CpRoot {
  root: string
  on: boolean
  list: Checkpoint[]
}

const TAKE_GAP_MS = 4_000

/** Per-repo checkpoint state; repos are found from a pane / session cwd once and cached. */
export const useCheckpointsStore = defineStore('checkpoints', () => {
  const roots = ref<Record<string, CpRoot>>({})
  const cwdRoot = new Map<string, string | null>()
  const lastTake = new Map<string, number>()

  async function refresh(dir: string): Promise<CpRoot | null> {
    const res = await cpState(dir)
    cwdRoot.set(dirKey(dir), res.ok ? res.root : null)
    if (!res.ok) return null
    const entry = { root: res.root, on: res.on, list: res.list }
    roots.value = { ...roots.value, [dirKey(res.root)]: entry }
    return entry
  }

  async function rootFor(cwd: string): Promise<CpRoot | null> {
    const key = dirKey(cwd)
    if (!cwdRoot.has(key)) return refresh(cwd)
    const root = cwdRoot.get(key)
    return root ? (roots.value[dirKey(root)] ?? null) : null
  }

  async function setOn(dir: string, on: boolean): Promise<void> {
    await cpSet(dir, on)
    await refresh(dir)
  }

  /** Snapshot for a turn edge of a session in `cwd`; no-op unless that repo has checkpoints on. */
  async function take(cwd: string, label: string): Promise<void> {
    const r = await rootFor(cwd)
    if (!r?.on) return
    const key = dirKey(r.root)
    const now = Date.now()
    if (now - (lastTake.get(key) ?? 0) < TAKE_GAP_MS) return
    lastTake.set(key, now)
    const res = await cpTake(r.root, label)
    if (res.ok && res.id) await refresh(r.root)
  }

  return { roots, refresh, rootFor, setOn, take }
})
