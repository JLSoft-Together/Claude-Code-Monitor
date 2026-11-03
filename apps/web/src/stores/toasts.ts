import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { Component } from 'vue'
import type { ArtName } from '../components/ArtImage.vue'

export type ToastKind = 'info' | 'warning' | 'undo' | 'break' | 'phoneFail'
export type ToastDismissReason = 'timeout' | 'close' | 'esc'

export interface ToastAction {
  label: string
  run: () => void
  primary?: boolean
  keys?: string
  title?: string
  icon?: Component
  attrs?: Record<string, string>
}

export interface ToastInput {
  id?: string
  kind: ToastKind
  text: string
  title?: string
  detail?: string
  meta?: string
  actions?: ToastAction[]
  art?: ArtName
  icon?: Component
  timeoutMs?: number
  attrs?: Record<string, string>
  dismissAttrs?: Record<string, string>
  onDismiss?: (reason: ToastDismissReason) => void
}

export interface Toast extends ToastInput {
  id: string
  timeoutMs: number
}

export const MAX_VISIBLE = 3
export const DEFAULT_TIMEOUT_MS = 6000

export const useToastsStore = defineStore('toasts', () => {
  const list = ref<Toast[]>([])
  const held = new Set<string>()
  const timers = new Map<string, number>()
  let seq = 0

  // Oldest at the top of the stack, newest nearest the corner; the overflow waits its turn instead of piling up.
  const visible = computed(() => list.value.slice(-MAX_VISIBLE))

  function clearTimer(id: string): void {
    const timer = timers.get(id)
    if (timer === undefined) return
    window.clearTimeout(timer)
    timers.delete(id)
  }

  function sync(): void {
    const shown = new Set(visible.value.map((t) => t.id))
    for (const id of [...timers.keys()]) if (!shown.has(id) || held.has(id)) clearTimer(id)
    for (const toast of visible.value) {
      if (toast.timeoutMs <= 0 || held.has(toast.id) || timers.has(toast.id)) continue
      timers.set(
        toast.id,
        window.setTimeout(() => dismiss(toast.id, 'timeout'), toast.timeoutMs),
      )
    }
  }

  function push(input: ToastInput): string {
    const id = input.id ?? `toast-${++seq}`
    const toast: Toast = { ...input, id, timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS }
    const at = list.value.findIndex((t) => t.id === id)
    clearTimer(id)
    if (at < 0) list.value = [...list.value, toast]
    else {
      const next = list.value.slice()
      next[at] = toast
      list.value = next
    }
    sync()
    return id
  }

  function dismiss(id: string, reason: ToastDismissReason = 'close'): void {
    const toast = list.value.find((t) => t.id === id)
    if (!toast) return
    clearTimer(id)
    held.delete(id)
    list.value = list.value.filter((t) => t.id !== id)
    sync()
    toast.onDismiss?.(reason)
  }

  // Programmatic removal for state that went away on its own (a closed pane came back): the owner already knows, so no callback.
  function remove(id: string): void {
    if (!list.value.some((t) => t.id === id)) return
    clearTimer(id)
    held.delete(id)
    list.value = list.value.filter((t) => t.id !== id)
    sync()
  }

  function hold(id: string, on: boolean): void {
    if (on) held.add(id)
    else held.delete(id)
    clearTimer(id)
    sync()
  }

  function dismissTop(reason: ToastDismissReason = 'esc'): boolean {
    const top = visible.value.at(-1)
    if (!top) return false
    dismiss(top.id, reason)
    return true
  }

  return { list, visible, push, dismiss, remove, hold, dismissTop }
})
