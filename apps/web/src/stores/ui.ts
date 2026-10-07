import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('ui', () => {
  const selectedAgentId = ref<string | null>(null)
  const focusedTerminalId = ref<string | null>(null)
  const focusRequest = ref(0)
  const layoutRequest = ref(0)

  function selectAgent(id: string | null): void {
    selectedAgentId.value = id
  }

  function focusTerminal(id: string): void {
    focusedTerminalId.value = id
    focusRequest.value++
  }

  function resetLayout(): void {
    layoutRequest.value++
  }

  return { selectedAgentId, focusedTerminalId, focusRequest, layoutRequest, selectAgent, focusTerminal, resetLayout }
})
