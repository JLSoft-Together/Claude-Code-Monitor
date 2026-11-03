import { nextTick, ref, toRaw, watch, type ComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { flashKind, type FlashKind, type TabSignal } from '../../../lib/tabStrip'
import { usePaneInfo } from '../../../composables/usePaneInfo'
import { useWorkspaceStore, type Pane, type Tab } from '../../../stores/workspace'

const LABEL_FLASH_MS = 1700
const TAB_FLASH_MS = 1000
const FLASH_GAP_MS = 1500
export const FLASH_CLASS: Record<FlashKind, string> = { waiting: 'text-st-waiting', done: 'text-st-done', error: 'text-st-error' }

function settle<V>(map: { value: Record<string, V> }, key: string, value: V, ms: number): void {
  map.value = { ...map.value, [key]: value }
  setTimeout(() => {
    if (toRaw(map.value[key]) !== value) return
    const rest = { ...map.value }
    delete rest[key]
    map.value = rest
  }, ms)
}

export interface TabFlashRenameDeps {
  visibleTabs: ComputedRef<Tab[]>
  visibleTabKeys: ComputedRef<string[]>
  tabNames: ComputedRef<Map<string, string>>
  tabState: (tab: Tab) => { status: TabSignal['status'] } | null
  tabAttention: (tab: Tab) => Pane['attention']
  tabButton: (key: string) => HTMLElement | null
  announce: (text: string) => void
}

/** Tab label highlight on rename, status flash on a tab that needs attention, and inline rename. */
export function useTabFlashRename(deps: TabFlashRenameDeps) {
  const { visibleTabs, visibleTabKeys, tabNames, tabState, tabAttention, tabButton, announce } = deps
  const { t } = useI18n()
  const workspace = useWorkspaceStore()
  const info = usePaneInfo()

  const labelFlash = ref<Record<string, number>>({})
  function highlightLabel(key: string): void {
    settle(labelFlash, key, (labelFlash.value[key] ?? 0) + 1, LABEL_FLASH_MS)
  }
  watch(
    () => [...tabNames.value],
    (now, before) => {
      const prev = new Map(before ?? [])
      for (const [key, name] of now) if (prev.has(key) && prev.get(key) !== name) highlightLabel(key)
    },
  )

  const tabFlash = ref<Record<string, { n: number; kind: FlashKind }>>({})
  const lastFlash = new Map<string, { kind: FlashKind; at: number }>()
  watch(
    () => visibleTabs.value.map((tab): [string, TabSignal] => [tab.key, { status: tabState(tab)?.status, attention: tabAttention(tab) }]),
    (now, before) => {
      const prev = new Map(before ?? [])
      const at = performance.now()
      for (const [key, signal] of now) {
        const old = prev.get(key)
        const kind = old ? flashKind(old, signal) : null
        if (!kind) continue
        const last = lastFlash.get(key)
        if (last?.kind === kind && at - last.at < FLASH_GAP_MS) continue
        lastFlash.set(key, { kind, at })
        settle(tabFlash, key, { n: (tabFlash.value[key]?.n ?? 0) + 1, kind }, TAB_FLASH_MS)
      }
    },
  )

  const renaming = ref<string | null>(null)
  const renameWidth = ref(160)
  let renameFrom: { key: string; name?: string } | null = null

  function startRename(tab: Tab): void {
    if (renaming.value === tab.key) return
    renameWidth.value = Math.min(260, Math.max(140, tabButton(tab.key)?.offsetWidth ?? 0))
    renameFrom = { key: tab.key, name: tab.name }
    renaming.value = tab.key
  }

  async function onRenameDone(key: string, saved: boolean): Promise<void> {
    const from = renameFrom?.key === key ? renameFrom : null
    renameFrom = null
    renaming.value = null
    const tab = workspace.tabs.find((x) => x.key === key)
    if (saved && tab && from) {
      if (tab.name !== from.name) announce(t(tab.name ? 'workspace.tabName.renamed' : 'workspace.tabName.reset', { name: info.tabTitle(tab) }))
      highlightLabel(key)
    }
    await nextTick()
    const focused = document.activeElement
    if (!focused || focused === document.body) tabButton(key)?.focus()
  }

  watch(visibleTabKeys, (keys) => {
    if (!renaming.value || keys.includes(renaming.value)) return
    renaming.value = null
    renameFrom = null
  })

  return { labelFlash, tabFlash, renaming, renameWidth, startRename, onRenameDone }
}
