export interface QueueItem {
  id: string
  text: string
}

export interface PromptQueue {
  items: QueueItem[]
  paused: boolean
}

export const QUEUE_STORAGE_PREFIX = 'ccm.promptQueue.'
export const QUEUE_MAX_ITEMS = 50
export const QUEUE_MAX_TEXT = 20_000

export function emptyQueue(): PromptQueue {
  return { items: [], paused: false }
}

export function addItem(q: PromptQueue, text: string, id: string): PromptQueue {
  const clean = text.trim().slice(0, QUEUE_MAX_TEXT)
  if (!clean || q.items.length >= QUEUE_MAX_ITEMS) return q
  return { ...q, items: [...q.items, { id, text: clean }] }
}

export function editItem(q: PromptQueue, id: string, text: string): PromptQueue {
  const clean = text.trim().slice(0, QUEUE_MAX_TEXT)
  if (!clean) return removeItem(q, id)
  return { ...q, items: q.items.map((it) => (it.id === id ? { ...it, text: clean } : it)) }
}

export function removeItem(q: PromptQueue, id: string): PromptQueue {
  return { ...q, items: q.items.filter((it) => it.id !== id) }
}

/** Moves an item by `delta` places, clamped to the ends. */
export function moveItem(q: PromptQueue, id: string, delta: number): PromptQueue {
  const from = q.items.findIndex((it) => it.id === id)
  if (from < 0) return q
  const to = Math.max(0, Math.min(q.items.length - 1, from + delta))
  if (to === from) return q
  const items = [...q.items]
  items.splice(to, 0, ...items.splice(from, 1))
  return { ...q, items }
}

export function setPaused(q: PromptQueue, paused: boolean): PromptQueue {
  return { ...q, paused }
}

export function takeNext(q: PromptQueue): { item: QueueItem; queue: PromptQueue } | null {
  const [item, ...rest] = q.items
  return item ? { item, queue: { ...q, items: rest } } : null
}

/** A turn has ended when the agent goes from working to idle; `waiting` is a permission prompt, never filled. */
export function turnEnded(prev: string | undefined, now: string | undefined): boolean {
  return prev === 'working' && now === 'idle'
}

export function shouldAutoFill(q: PromptQueue, prev: string | undefined, now: string | undefined): boolean {
  return !q.paused && q.items.length > 0 && turnEnded(prev, now)
}

export function parseQueue(raw: string | null | undefined): PromptQueue {
  if (!raw) return emptyQueue()
  try {
    const v = JSON.parse(raw) as { items?: unknown; paused?: unknown }
    const items = Array.isArray(v.items)
      ? v.items
          .filter((it): it is QueueItem => !!it && typeof (it as QueueItem).id === 'string' && typeof (it as QueueItem).text === 'string' && !!(it as QueueItem).text.trim())
          .slice(0, QUEUE_MAX_ITEMS)
          .map((it) => ({ id: it.id, text: it.text.slice(0, QUEUE_MAX_TEXT) }))
      : []
    return { items, paused: v.paused === true }
  } catch {
    return emptyQueue()
  }
}

export function serializeQueue(q: PromptQueue): string | null {
  return q.items.length || q.paused ? JSON.stringify(q) : null
}
