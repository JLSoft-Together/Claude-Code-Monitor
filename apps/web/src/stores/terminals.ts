import { defineStore } from 'pinia'
import { computed, reactive } from 'vue'
import { normalizeTerminalStatus, type TerminalPatch, type TerminalSession } from '@ccm/shared'
import { applyPatch } from '../lib/patch'

export const useTerminalsStore = defineStore('terminals', () => {
  const byId = reactive<Record<string, TerminalSession>>({})

  const list = computed(() =>
    Object.values(byId).sort(
      (a, b) =>
        Number(a.status === 'stale') - Number(b.status === 'stale') ||
        (a.startedAt ?? '').localeCompare(b.startedAt ?? '') ||
        a.id.localeCompare(b.id),
    ),
  )

  const live = computed(() => list.value.filter((t) => t.status !== 'stale'))

  function sanitize(t: TerminalSession): TerminalSession {
    return { ...t, status: normalizeTerminalStatus(t.status), title: t.title || t.id }
  }

  function replaceAll(items: TerminalSession[]): void {
    for (const id of Object.keys(byId)) delete byId[id]
    for (const t of items) byId[t.id] = sanitize(t)
  }

  function upsert(t: TerminalSession): void {
    byId[t.id] = sanitize(t)
  }

  function patch(p: TerminalPatch): void {
    const current = byId[p.id]
    if (!current) return
    applyPatch(current, p)
    current.status = normalizeTerminalStatus(current.status)
  }

  function remove(id: string): void {
    delete byId[id]
  }

  return { byId, list, live, replaceAll, upsert, patch, remove }
})
