import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AwakeMode, AwakeState } from '@ccm/shared'
import { awakeState, hasAwake, onAwake, setAwakeMode } from '../lib/capture'

/** Keep-awake state pushed by the desktop main process (v76 R3). */
export const useAwakeStore = defineStore('awake', () => {
  const state = ref<AwakeState | null>(null)
  let started = false

  function start(): void {
    if (started || !hasAwake) return
    started = true
    onAwake((s) => (state.value = s))
    void awakeState().then((s) => {
      if (s) state.value = s
    })
  }

  async function setMode(mode: AwakeMode): Promise<void> {
    const s = await setAwakeMode(mode)
    if (s) state.value = s
  }

  return { state, start, setMode }
})
