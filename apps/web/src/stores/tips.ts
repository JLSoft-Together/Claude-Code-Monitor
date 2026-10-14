import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { TIP_WINDOW_MS, parseTipState, shouldTip, type TipAction, type TipState } from '../lib/tips'

const KEY = 'ccm.tips'

function load(): TipState {
  try {
    return parseTipState(localStorage.getItem(KEY))
  } catch {
    return parseTipState(null)
  }
}

/** "Use shortcut X" tips in the workspace: mouse uses count, one keyboard use retires the tip. */
export const useTipsStore = defineStore('tips', () => {
  const state = ref<TipState>(load())
  const current = ref<TipAction | null>(null)
  const uses = new Map<TipAction, number[]>()
  let lastTipAt = -Infinity

  watch(
    state,
    (value) => {
      try {
        localStorage.setItem(KEY, JSON.stringify(value))
      } catch {
        return
      }
    },
    { deep: true },
  )

  function mouse(action: TipAction): void {
    const now = Date.now()
    const list = [...(uses.get(action) ?? []).filter((at) => now - at <= TIP_WINDOW_MS), now]
    uses.set(action, list)
    if (!shouldTip(state.value, action, list, now, lastTipAt)) return
    current.value = action
    lastTipAt = now
    uses.set(action, [])
    state.value.shown[action] = (state.value.shown[action] ?? 0) + 1
  }

  function key(action: TipAction): void {
    if (!state.value.learned.includes(action)) state.value.learned.push(action)
    if (current.value === action) current.value = null
  }

  function dismiss(): void {
    current.value = null
  }

  function setOff(off: boolean): void {
    state.value.off = off
    if (off) current.value = null
  }

  return { state, current, mouse, key, dismiss, setOff }
})
