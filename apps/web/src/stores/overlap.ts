import { defineStore } from 'pinia'
import { computed, shallowRef, watch } from 'vue'
import { overlapHits, rootKey, type CheckoutChanges, type OverlapHit } from '../lib/overlap'
import { hasOverlap, overlapFiles } from '../lib/preview'
import { useTerminalsStore } from './terminals'
import { isTerm, presetOf, useWorkspaceStore, workCwd } from './workspace'

const GAP_MS = 5000
const MAX_DIRS = 12

/**
 * Overlap radar: files changed against the main branch per agent checkout, compared across the worktrees of
 * one repo. Rescans only when an agent turn ends or the set of agent folders changes (no polling).
 */
export const useOverlapStore = defineStore('overlap', () => {
  const workspace = useWorkspaceStore()
  const terminals = useTerminalsStore()
  const checkouts = shallowRef<CheckoutChanges[]>([])
  const hits = computed(() => overlapHits(checkouts.value))
  let busy = false
  let again = false
  let last = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const agentDirs = computed(() => {
    const seen = new Map<string, string>()
    for (const p of workspace.panes) {
      const dir = isTerm(p) && presetOf(p) !== 'shell' && p.state === 'running' ? workCwd(p) : undefined
      if (dir && !seen.has(rootKey(dir))) seen.set(rootKey(dir), dir)
    }
    return [...seen.values()].slice(0, MAX_DIRS)
  })

  async function scan(force = false): Promise<void> {
    if (!hasOverlap) return
    const dirs = agentDirs.value
    if (dirs.length < 2) {
      checkouts.value = []
      return
    }
    if (busy) return void (again = true)
    const wait = last + GAP_MS - Date.now()
    if (!force && wait > 0) {
      timer ??= setTimeout(() => {
        timer = null
        void scan()
      }, wait)
      return
    }
    busy = true
    last = Date.now()
    const results = await Promise.all(dirs.map((d) => overlapFiles(d)))
    busy = false
    const byRoot = new Map<string, CheckoutChanges>()
    for (const r of results) if (r.ok && !byRoot.has(rootKey(r.root))) byRoot.set(rootKey(r.root), { root: r.root, common: r.common, branch: r.branch, files: r.files })
    checkouts.value = [...byRoot.values()]
    if (again) {
      again = false
      void scan()
    }
  }

  /** Hits for the checkout that holds `cwd` (deepest root wins: a worktree can sit inside the main one). */
  function hitsFor(cwd: string | undefined): OverlapHit[] {
    if (!cwd) return []
    const k = rootKey(cwd)
    const own = checkouts.value.filter((c) => k === rootKey(c.root) || k.startsWith(`${rootKey(c.root)}\\`)).sort((a, b) => b.root.length - a.root.length)[0]
    return own ? (hits.value.get(rootKey(own.root)) ?? []) : []
  }

  const working = computed(() => terminals.list.filter((t) => t.status === 'working').map((t) => t.id))
  watch(working, (now, before) => {
    if (before?.some((id) => !now.includes(id))) void scan()
  })
  watch(() => agentDirs.value.map(rootKey).join('|'), () => void scan(), { immediate: true })

  return { checkouts, hits, scan, hitsFor }
})
