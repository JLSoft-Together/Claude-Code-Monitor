import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { UpdateState } from '@ccm/shared'
import { updateAvailable, updateBridge } from '../lib/update'

/** Mirrors the desktop updater; the page never downloads on its own, every step is a click. */
export const useUpdateStore = defineStore('update', () => {
  const state = ref<UpdateState | null>(null)
  const dialogOpen = ref(false)
  const manualCheck = ref(false)
  let started = false

  const available = computed(() => updateAvailable(state.value))

  function apply(next: UpdateState | null | undefined): void {
    if (next && typeof next === 'object') state.value = next
  }

  function start(): void {
    if (started || !updateBridge) return
    started = true
    updateBridge.onState(apply)
    void updateBridge.state().then(apply)
  }

  /** Manual check opens the dialog on a hit, even for a skipped version. */
  async function check(): Promise<void> {
    if (!updateBridge) return
    manualCheck.value = true
    try {
      const next = await updateBridge.check()
      apply(next)
      if (next?.phase === 'available' && next.release) dialogOpen.value = true
    } finally {
      manualCheck.value = false
    }
  }

  const call = async (fn: (() => Promise<UpdateState | null>) | undefined): Promise<void> => apply(await fn?.())

  return {
    state,
    dialogOpen,
    manualCheck,
    available,
    start,
    check,
    download: () => call(updateBridge?.download),
    cancel: () => call(updateBridge?.cancel),
    install: () => call(updateBridge?.install),
    setAutoCheck: (on: boolean) => call(updateBridge && (() => updateBridge!.setAutoCheck(on))),
    skip: async () => {
      const v = state.value?.release?.version
      if (v && updateBridge) apply(await updateBridge.skip(v))
      dialogOpen.value = false
    },
    openPage: () => void updateBridge?.openPage(),
    reveal: () => void updateBridge?.reveal(),
  }
})
