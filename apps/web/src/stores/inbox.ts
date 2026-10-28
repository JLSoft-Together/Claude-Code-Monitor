import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { quietFor } from '../lib/attention'
import { now } from '../lib/format'
import { inboxItems, pruneDismissed } from '../lib/inbox'
import { useAttentionStore } from './attention'
import { useChecksStore } from './checks'
import { useSettingsStore } from './settings'
import { useTerminalsStore } from './terminals'
import { useWorkspaceStore } from './workspace'

const KEY = 'ccm.inbox'

function read(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    return Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === 'string').slice(0, 500))
  } catch {
    return {}
  }
}

/** Agents that need the owner, most urgent first; derived from state already in memory (no extra fetches). */
export const useInboxStore = defineStore('inbox', () => {
  const terminals = useTerminalsStore()
  const attention = useAttentionStore()
  const checks = useChecksStore()
  const settings = useSettingsStore()
  const workspace = useWorkspaceStore()
  const open = ref(false)
  const dismissed = ref<Record<string, string>>(read())

  const minute = computed(() => Math.floor(now.value / 60_000))
  const stuck = computed(() => {
    const at = minute.value * 60_000
    return new Set(terminals.live.filter((x) => quietFor(x, at, settings.stuckMinutes) !== null).map((x) => x.id))
  })
  const failedRoots = computed(() =>
    Object.values(checks.runs)
      .filter((r) => !r.running && r.result?.ok && r.result.errors.some((e) => e.severity === 'error'))
      .map((r) => r.root),
  )
  const doneUnseen = computed(() => new Set(workspace.panes.filter((p) => p.attention === 'done' && p.terminalId).map((p) => p.terminalId!)))

  const items = computed(() =>
    inboxItems({ terminals: terminals.live, loops: attention.loops, stuck: stuck.value, failedRoots: failedRoots.value, doneUnseen: doneUnseen.value, dismissed: dismissed.value }),
  )

  function dismiss(id: string): void {
    const item = items.value.find((i) => i.id === id)
    if (item) dismissed.value = { ...pruneDismissed(dismissed.value, new Set(terminals.live.map((x) => x.id))), [id]: item.stamp }
  }

  watch(
    dismissed,
    (v) => {
      try {
        localStorage.setItem(KEY, JSON.stringify(v))
      } catch {
        // storage blocked: dismissals last until reload
      }
    },
    { deep: true },
  )

  return { open, items, dismiss }
})
