import { computed, nextTick, ref, watch, type ComputedRef, type Ref } from 'vue'
import type { Agent, TerminalSession } from '@ccm/shared'
import { treeOrder } from '../../lib/layout'
import { searchText } from '../../lib/mapText'
import { useTerminalsStore } from '../../stores/terminals'
import { useUiStore } from '../../stores/ui'

export interface MapFindDeps {
  sessionsOrder: ComputedRef<string[]>
  finishedByTerminal: ComputedRef<Record<string, Agent[]>>
  textLabels: Ref<Parameters<typeof searchText>[2]>
  cursorId: Ref<string | null>
  tabStop: ComputedRef<string | null>
  unfoldTo: (id: string) => boolean
  zoomTo: (id: string) => Promise<void>
  moveCursor: (id: string) => void
}

/** Find: matches in session / tree order, including agents inside folded subtrees (unfolded on the way there). */
export function useMapFind(deps: MapFindDeps) {
  const { sessionsOrder, finishedByTerminal, textLabels, cursorId, tabStop, unfoldTo, zoomTo, moveCursor } = deps
  const ui = useUiStore()
  const terminals = useTerminalsStore()
  const findOpen = ref(false)
  const query = ref('')
  const matchIndex = ref(0)
  const findInput = ref<HTMLInputElement | null>(null)

  const matchList = computed<string[]>(() => {
    const q = query.value.trim().toLowerCase()
    if (!findOpen.value || !q) return []
    const out: string[] = []
    for (const tid of sessionsOrder.value) {
      const list = finishedByTerminal.value[tid]
      if (!list?.length) continue
      const term: TerminalSession | undefined = terminals.byId[tid]
      const main = list.find((a) => a.role === 'main')
      const ordered = [...(main ? [main] : []), ...treeOrder(list).map((x) => x.agent)]
      for (const a of ordered) if (searchText(a, term, textLabels.value).includes(q)) out.push(a.id)
    }
    return out
  })
  const matches = computed(() => (findOpen.value && query.value.trim() ? new Set(matchList.value) : null))
  const currentMatch = computed(() => matchList.value[matchIndex.value] ?? null)

  function goToMatch(): void {
    const id = currentMatch.value
    if (!id) return
    cursorId.value = id
    unfoldTo(id)
    void zoomTo(id)
  }
  watch(query, () => {
    matchIndex.value = 0
    goToMatch()
  })
  function stepMatch(dir: 1 | -1): void {
    const n = matchList.value.length
    if (!n) return
    matchIndex.value = (matchIndex.value + dir + n) % n
    goToMatch()
  }
  async function openFind(): Promise<void> {
    if (ui.mapView !== 'map') return
    findOpen.value = true
    await nextTick()
    findInput.value?.focus()
    findInput.value?.select()
  }
  function closeFind(refocus = true): void {
    findOpen.value = false
    if (!refocus) return
    const id = currentMatch.value ?? tabStop.value
    query.value = ''
    if (id) moveCursor(id)
  }
  function onFindKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') stepMatch(e.shiftKey ? -1 : 1)
    else if (e.key === 'Escape') closeFind()
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') stepMatch(e.key === 'ArrowDown' ? 1 : -1)
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  return { findOpen, query, matchIndex, findInput, matchList, matches, currentMatch, stepMatch, openFind, closeFind, onFindKey }
}
