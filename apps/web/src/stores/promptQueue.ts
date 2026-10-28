import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import { addItem, editItem, emptyQueue, moveItem, parseQueue, QUEUE_STORAGE_PREFIX, removeItem, serializeQueue, setPaused, takeNext, type PromptQueue, type QueueItem } from '../lib/promptQueue'

let seq = 0
const newId = () => `${Date.now().toString(36)}-${(++seq).toString(36)}`

/** Prompt queue per agent pane, kept in sessionStorage by pane key (a reload keeps it, a new window starts empty). */
export const usePromptQueueStore = defineStore('promptQueue', () => {
  const queues = shallowRef<Record<string, PromptQueue>>({})

  function get(paneKey: string): PromptQueue {
    const hit = queues.value[paneKey]
    if (hit) return hit
    let raw: string | null = null
    try {
      raw = sessionStorage.getItem(QUEUE_STORAGE_PREFIX + paneKey)
    } catch {
      raw = null
    }
    const q = parseQueue(raw)
    queues.value = { ...queues.value, [paneKey]: q }
    return q
  }

  function put(paneKey: string, q: PromptQueue): void {
    queues.value = { ...queues.value, [paneKey]: q }
    try {
      const raw = serializeQueue(q)
      if (raw) sessionStorage.setItem(QUEUE_STORAGE_PREFIX + paneKey, raw)
      else sessionStorage.removeItem(QUEUE_STORAGE_PREFIX + paneKey)
    } catch {
      // Storage blocked or full: the queue still works for this page.
    }
  }

  const add = (paneKey: string, text: string) => put(paneKey, addItem(get(paneKey), text, newId()))
  const edit = (paneKey: string, id: string, text: string) => put(paneKey, editItem(get(paneKey), id, text))
  const remove = (paneKey: string, id: string) => put(paneKey, removeItem(get(paneKey), id))
  const move = (paneKey: string, id: string, delta: number) => put(paneKey, moveItem(get(paneKey), id, delta))
  const pause = (paneKey: string, paused: boolean) => put(paneKey, setPaused(get(paneKey), paused))
  const clear = (paneKey: string) => put(paneKey, emptyQueue())

  function take(paneKey: string): QueueItem | null {
    const r = takeNext(get(paneKey))
    if (!r) return null
    put(paneKey, r.queue)
    return r.item
  }

  return { queues, get, add, edit, remove, move, pause, clear, take }
})
