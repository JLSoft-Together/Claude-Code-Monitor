import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef } from 'vue'
import type { PeerLink, PeerLinkKind, PeerLinkPatch } from '@ccm/shared'
import { now } from '../lib/format'
import { applyPatch } from '../lib/patch'

export const SENT_MS = 4_000
export const RECEIVED_MS = 8_000
export const BOTH_MS = 30_000
export const WARM_MS = 15 * 60_000
export const COORDINATING_MIN = 2
export const FRESH_MS = 10_000
const PULSE_KEEP = 32
const NOTE_KEEP = 64

export type PeerDir = 'out' | 'in' | 'both'

export interface PeerPulse {
  key: number
  linkId: string
  kind: PeerLinkKind
  from: string
  to: string
  n: number
  agentId?: string
  at: number
}

export interface PeerRecent {
  dir: PeerDir
  kind: PeerLinkKind
  others: string[]
  n: number
  at: number
  until: number
}

export interface PeerRole {
  sentTo: string[]
  heardFrom: string[]
  openedBy: string | null
  opened: string[]
  coordinating: number
}

interface Note {
  from: string
  to: string
  kind: PeerLinkKind
  n: number
  at: number
}

export function peerLinkId(a: string, b: string): string {
  return a < b ? `${a}>${b}` : `${b}>${a}`
}

export function openedLinkId(by: string, to: string): string {
  return `opened:${by}>${to}`
}

export function otherEnd(link: Pick<PeerLink, 'a' | 'b'>, terminalId: string): string | null {
  if (link.a === terminalId) return link.b
  if (link.b === terminalId) return link.a
  return null
}

function sent(link: PeerLink, terminalId: string): number {
  return link.a === terminalId ? link.ab : link.b === terminalId ? link.ba : 0
}

function heard(link: PeerLink, terminalId: string): number {
  return link.a === terminalId ? link.ba : link.b === terminalId ? link.ab : 0
}

function windowOf(note: Note, self: string): number {
  if (note.kind === 'opened') return note.to === self ? RECEIVED_MS : 0
  return note.from === self ? SENT_MS : RECEIVED_MS
}

function latestOf(notes: readonly Note[]): Note {
  return notes.reduce((x, y) => (y.at >= x.at ? y : x))
}

export function recentFor(notes: readonly Note[], terminalId: string, at: number): PeerRecent | null {
  const mine = notes.filter((n) => n.from === terminalId || n.to === terminalId)
  const live = mine.filter((n) => n.at + windowOf(n, terminalId) > at)
  const wide = mine.filter((n) => n.kind === 'message' && n.at + RECEIVED_MS > at)
  const latestLive = live.length ? latestOf(live) : null
  if (latestLive?.kind === 'opened') {
    const opened = live.filter((n) => n.kind === 'opened' && n.to === terminalId)
    return { dir: 'in', kind: 'opened', others: unique(opened.map((n) => n.from)), n: 1, at: latestLive.at, until: latestLive.at + RECEIVED_MS }
  }
  if (wide.length) {
    const newest = latestOf(wide)
    const other = newest.from === terminalId ? newest.to : newest.from
    const withOther = mine.filter((n) => n.kind === 'message' && n.at > at - BOTH_MS && (n.from === other || n.to === other))
    if (withOther.some((n) => n.from === terminalId) && withOther.some((n) => n.to === terminalId)) {
      return {
        dir: 'both',
        kind: 'message',
        others: [other],
        n: withOther.reduce((s, n) => s + n.n, 0),
        at: newest.at,
        until: newest.at + RECEIVED_MS,
      }
    }
  }
  if (!latestLive) return null
  const latest = latestLive
  const dir: PeerDir = latest.from === terminalId ? 'out' : 'in'
  const same = live.filter((n) => n.kind === 'message' && (dir === 'out' ? n.from === terminalId : n.to === terminalId))
  const ordered = [...same].sort((x, y) => y.at - x.at)
  return {
    dir,
    kind: 'message',
    others: unique(ordered.map((n) => (dir === 'out' ? n.to : n.from))),
    n: same.reduce((s, n) => s + n.n, 0),
    at: latest.at,
    until: latest.at + windowOf(latest, terminalId),
  }
}

function fresh(link: PeerLink): boolean {
  return Date.now() - Date.parse(link.lastAt) < FRESH_MS
}

function unique(ids: string[]): string[] {
  return [...new Set(ids)]
}

export const usePeersStore = defineStore('peers', () => {
  const byId = reactive<Record<string, PeerLink>>({})
  const opened = shallowRef<PeerLink[]>([])
  const pulses = shallowRef<PeerPulse[]>([])
  const notes = shallowRef<Note[]>([])
  const clock = ref(Date.now())
  let seq = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const list = computed<PeerLink[]>(() => [...Object.values(byId), ...opened.value])

  const coarse = computed(() => Math.floor(now.value / 15_000))

  const warm = computed<PeerLink[]>((prev) => {
    const cutoff = coarse.value * 15_000 - WARM_MS
    const next = list.value.filter((l) => l.kind === 'opened' || Date.parse(l.lastAt) > cutoff)
    return prev && prev.length === next.length && next.every((l, i) => l === prev[i]) ? prev : next
  })

  function linksOf(terminalId: string): PeerLink[] {
    return warm.value.filter((l) => l.a === terminalId || l.b === terminalId)
  }

  function roleOf(terminalId: string): PeerRole {
    const sentTo: string[] = []
    const heardFrom: string[] = []
    const openedTo: string[] = []
    let openedBy: string | null = null
    for (const l of linksOf(terminalId)) {
      if (l.kind === 'opened') {
        if (l.a === terminalId) openedTo.push(l.b)
        else openedBy = l.a
        continue
      }
      const other = otherEnd(l, terminalId)!
      if (sent(l, terminalId) > 0) sentTo.push(other)
      if (heard(l, terminalId) > 0) heardFrom.push(other)
    }
    return { sentTo, heardFrom, openedBy, opened: openedTo, coordinating: sentTo.length >= COORDINATING_MIN ? sentTo.length : 0 }
  }

  const recent = computed<Record<string, PeerRecent>>(() => {
    const at = clock.value
    const out: Record<string, PeerRecent> = {}
    const ids = new Set<string>()
    for (const n of notes.value) {
      ids.add(n.from)
      ids.add(n.to)
    }
    for (const id of ids) {
      const r = recentFor(notes.value, id, at)
      if (r) out[id] = r
    }
    return out
  })

  function recentOf(terminalId: string | null | undefined): PeerRecent | null {
    return terminalId ? (recent.value[terminalId] ?? null) : null
  }

  function schedule(): void {
    if (timer) clearTimeout(timer)
    timer = null
    const at = Date.now()
    clock.value = at
    let next = Infinity
    for (const n of notes.value) {
      for (const end of [n.at + SENT_MS, n.at + RECEIVED_MS]) if (end > at) next = Math.min(next, end)
    }
    if (next !== Infinity) timer = setTimeout(schedule, next - at + 16)
  }

  function note(link: PeerLink, from: string, to: string, n: number, agentId?: string): void {
    if (n <= 0) return
    const at = Date.now()
    notes.value = [...notes.value.filter((x) => x.at > at - BOTH_MS), { from, to, kind: link.kind, n, at }].slice(-NOTE_KEEP)
    pulses.value = [...pulses.value, { key: ++seq, linkId: link.id, kind: link.kind, from, to, n, agentId, at }].slice(-PULSE_KEEP)
    schedule()
  }

  function pulseNew(link: PeerLink): void {
    const first = link.lastDir === 'ab' ? 'ba' : 'ab'
    for (const dir of [first, link.lastDir] as const) {
      const n = dir === 'ab' ? link.ab : link.ba
      const [from, to] = dir === 'ab' ? [link.a, link.b] : [link.b, link.a]
      note(link, from, to, n, dir === link.lastDir ? link.lastAgentId : undefined)
    }
  }

  function replaceAll(links: PeerLink[]): void {
    for (const id of Object.keys(byId)) delete byId[id]
    for (const l of links) if (l.kind === 'message') byId[l.id] = { ...l }
  }

  function upsert(link: PeerLink, quiet = false): void {
    if (link.kind !== 'message') return
    const existed = byId[link.id]
    if (existed) {
      patch(link, quiet)
      return
    }
    byId[link.id] = { ...link }
    if (!quiet && fresh(link)) pulseNew(link)
  }

  function patch(p: PeerLinkPatch, quiet = false): void {
    const current = byId[p.id]
    if (!current) return
    const ab = current.ab
    const ba = current.ba
    applyPatch(current, p)
    if (quiet || !fresh(current)) return
    const delta = { ab: current.ab - ab, ba: current.ba - ba }
    const first = current.lastDir === 'ab' ? 'ba' : 'ab'
    for (const dir of [first, current.lastDir] as const) {
      const [from, to] = dir === 'ab' ? [current.a, current.b] : [current.b, current.a]
      note(current, from, to, delta[dir], dir === current.lastDir ? current.lastAgentId : undefined)
    }
  }

  function remove(id: string): void {
    delete byId[id]
  }

  function dropTerminal(terminalId: string): void {
    for (const l of Object.values(byId)) if (l.a === terminalId || l.b === terminalId) delete byId[l.id]
  }

  function setOpened(links: PeerLink[], quiet = false): void {
    const known = new Set(opened.value.map((l) => l.id))
    opened.value = links.map((l) => ({ ...l, kind: 'opened' as const }))
    if (quiet) return
    for (const l of opened.value) if (!known.has(l.id)) note(l, l.a, l.b, 1)
  }

  return { byId, list, warm, pulses, recent, linksOf, roleOf, recentOf, replaceAll, upsert, patch, remove, dropTerminal, setOpened }
})
