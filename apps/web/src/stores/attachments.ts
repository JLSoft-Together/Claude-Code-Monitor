import { defineStore } from 'pinia'
import { ref, watch } from 'vue'
import { baseName, imageToken, isImagePath, type PromptScan } from '../lib/promptAttachments'

/**
 * Attachments tray of each terminal pane: files and images on their way into the agent's prompt, and what the
 * prompt holds now (read back from the screen). Runtime only: never saved, never logged; thumbnails stay in memory.
 */
export type AttachmentState = 'staged' | 'inserting' | 'inserted' | 'sent' | 'failed'

export interface Attachment {
  id: string
  kind: 'image' | 'file'
  name: string
  source: 'paste' | 'drop' | 'pick' | 'terminal'
  /** Absolute path (dropped / picked files). */
  path?: string
  /** PNG data URL of an image that has no file (clipboard, browser drop); dropped once inserted. */
  data?: string
  /** Small preview (≤ 96 px) of `data`. */
  thumb?: string
  view?: string
  /** What the prompt shows: `[Image #3]`, `@src/a.ts`. */
  token?: string
  state: AttachmentState
  /** Token seen in the prompt at least once: its disappearance then means removed or sent. */
  seen?: boolean
  /** Image paste key sent at (ms): the next new `[Image #N]` in the prompt is this one. */
  awaiting?: number
  error?: string
  at: number
}

export type NewAttachment = Pick<Attachment, 'kind' | 'name' | 'source' | 'path' | 'data' | 'thumb' | 'view'>

let seq = 0
const AUTO_KEY = 'ccm.workspace.autoInsert'

function readAuto(): boolean {
  try {
    return localStorage.getItem(AUTO_KEY) !== '0'
  } catch {
    return true
  }
}

export function fromPath(path: string, source: Attachment['source']): NewAttachment {
  return { kind: isImagePath(path) ? 'image' : 'file', name: baseName(path), source, path }
}

export const useAttachmentsStore = defineStore('attachments', () => {
  const byPane = ref<Record<string, Attachment[]>>({})
  const open = ref<Record<string, boolean>>({})
  const autoInsert = ref(readAuto())
  /** Bumped when a pane has work: TermPane runs the inserts (it owns the PTY). */
  const insertSeq = ref(0)

  watch(autoInsert, (on) => {
    try {
      localStorage.setItem(AUTO_KEY, on ? '1' : '0')
    } catch {
      return
    }
  })

  const list = (pane: string): Attachment[] => byPane.value[pane] ?? []
  const live = (pane: string): Attachment[] => list(pane).filter((a) => a.state !== 'sent')
  const sent = (pane: string): Attachment[] => list(pane).filter((a) => a.state === 'sent')

  function set(pane: string, items: Attachment[]): void {
    byPane.value = { ...byPane.value, [pane]: items }
  }

  function patch(pane: string, id: string, fields: Partial<Attachment>): void {
    set(
      pane,
      list(pane).map((a) => (a.id === id ? { ...a, ...fields } : a)),
    )
  }

  function add(pane: string, items: NewAttachment[], insert = autoInsert.value): Attachment[] {
    const made = items.map((it): Attachment => ({ ...it, id: `att-${++seq}`, state: insert ? 'inserting' : 'staged', at: Date.now() }))
    set(pane, [...list(pane), ...made])
    open.value = { ...open.value, [pane]: true }
    if (insert) insertSeq.value++
    return made
  }

  function insert(pane: string, ids?: string[]): void {
    set(
      pane,
      list(pane).map((a) => (a.state === 'staged' && (!ids || ids.includes(a.id)) ? { ...a, state: 'inserting' as const } : a)),
    )
    insertSeq.value++
  }

  function remove(pane: string, id: string): void {
    set(
      pane,
      list(pane).filter((a) => a.id !== id),
    )
  }

  function clearSent(pane: string): void {
    set(
      pane,
      list(pane).filter((a) => a.state !== 'sent'),
    )
  }

  function toggle(pane: string, on = !open.value[pane]): void {
    open.value = { ...open.value, [pane]: on }
  }

  function drop(pane: string): void {
    const { [pane]: _gone, ...rest } = byPane.value
    byPane.value = rest
    const { [pane]: _o, ...openRest } = open.value
    open.value = openRest
  }

  /**
   * Fold one screen read into the tray. `submitted` = Enter was pressed since the previous read: tokens that left
   * the prompt were sent, not removed. Tokens nobody put there (typed / pasted in the terminal) get a row too,
   * except `editing`: the mention ending at the cursor, still being typed or erased one Backspace at a time.
   */
  function reconcile(pane: string, scan: PromptScan, submitted: boolean, pendingPaste: NewAttachment | null, editing: string | null = null): { boundPaste: boolean } {
    if (!scan.found) return { boundPaste: false }
    const present = new Set([...scan.images.map(imageToken), ...scan.files])
    let items = list(pane)
    // A submit moves the previous "last sent" out of the way.
    if (submitted && items.some((a) => a.seen && a.token && !present.has(a.token) && a.state === 'inserted')) items = items.filter((a) => a.state !== 'sent')
    const known = new Set(items.filter((a) => a.state !== 'sent' && a.token).map((a) => a.token!))
    const fresh = scan.images.map(imageToken).filter((tk) => !known.has(tk))
    let boundPaste = false
    items = items.flatMap((a): Attachment[] => {
      if (a.state === 'sent' || a.state === 'staged' || a.state === 'failed') return [a]
      if (a.kind === 'image' && !a.token) {
        const tk = a.awaiting ? fresh.shift() : undefined
        return tk ? [{ ...a, token: tk, state: 'inserted', seen: true, data: undefined, awaiting: undefined }] : [a]
      }
      if (!a.token) return [a]
      if (present.has(a.token)) return [{ ...a, state: 'inserted', seen: true }]
      if (!a.seen) return [a]
      return submitted ? [{ ...a, state: 'sent' }] : []
    })
    for (const tk of fresh) {
      const base = pendingPaste && !boundPaste ? pendingPaste : { kind: 'image' as const, name: tk, source: 'terminal' as const }
      boundPaste ||= !!pendingPaste
      items.push({ ...base, id: `att-${++seq}`, token: tk, state: 'inserted', seen: true, at: Date.now() })
    }
    const tokens = new Set(items.filter((a) => a.state !== 'sent').map((a) => a.token))
    for (const f of scan.files) {
      if (!tokens.has(f) && f !== editing) items.push({ id: `att-${++seq}`, kind: 'file', name: baseName(f.slice(1).replace(/^"|"$/g, '')), source: 'terminal', token: f, state: 'inserted', seen: true, at: Date.now() })
    }
    set(pane, items)
    return { boundPaste }
  }

  return { byPane, open, autoInsert, insertSeq, list, live, sent, add, insert, remove, patch, clearSent, toggle, drop, reconcile }
})
