import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import { promptSearchTerms, type OpenResult, type PromptSearchDays, type PromptSearchDone, type PromptSearchHit, type PromptSearchProgress } from '@ccm/shared'

export type PromptSearchPhase = 'idle' | 'running' | PromptSearchDone['state']

/** Results live only while the History search is open; nothing is persisted. */
export const usePromptSearchStore = defineStore('promptSearch', () => {
  const query = ref('')
  const days = ref<PromptSearchDays>(30)
  const project = ref<string | null>(null)
  const searchId = ref<string | null>(null)
  const phase = ref<PromptSearchPhase>('idle')
  const filesDone = ref(0)
  const filesTotal = ref(0)
  const hits = shallowRef<PromptSearchHit[]>([])
  const terms = ref<string[]>([])
  const openResults = ref<Record<string, OpenResult>>({})

  function begin(id: string): void {
    searchId.value = id
    phase.value = 'running'
    filesDone.value = 0
    filesTotal.value = 0
    hits.value = []
    openResults.value = {}
    terms.value = promptSearchTerms(query.value)
  }

  function applyProgress(p: PromptSearchProgress): void {
    if (p.searchId !== searchId.value) return
    filesDone.value = p.filesDone
    filesTotal.value = p.filesTotal
    if (p.hits?.length) hits.value = [...hits.value, ...p.hits]
  }

  function applyDone(d: PromptSearchDone): void {
    if (d.searchId !== searchId.value) return
    filesDone.value = d.filesDone
    filesTotal.value = d.filesTotal
    phase.value = d.state
  }

  function applyOpen(p: { searchId: string; sessionId: string; result: OpenResult }): void {
    if (p.searchId !== searchId.value) return
    openResults.value = { ...openResults.value, [p.sessionId]: p.result }
  }

  function clear(): void {
    searchId.value = null
    phase.value = 'idle'
    hits.value = []
    terms.value = []
    filesDone.value = 0
    filesTotal.value = 0
  }

  const running = computed(() => phase.value === 'running')

  return { query, days, project, searchId, phase, filesDone, filesTotal, hits, terms, openResults, running, begin, applyProgress, applyDone, applyOpen, clear }
})
