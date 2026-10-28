export interface Spot {
  path: string
  line: number
  cwd?: string
}

/** A bookmark or an edit location; `text` = the line as it was (trimmed, capped). */
export interface NoteSpot extends Spot {
  text: string
  at: number
}

export interface RecentFile {
  path: string
  cwd?: string
  at: number
}

export const MAX_BOOKMARKS = 300
export const MAX_RECENT = 50
export const MAX_EDITS = 50
export const MAX_TRAIL = 100
const TRAIL_NEAR = 5
const EDIT_NEAR = 3
const TEXT_MAX = 160

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
export const samePath = (a: string, b: string): boolean => norm(a) === norm(b)
export const snippet = (line: string): string => line.trim().slice(0, TEXT_MAX)

export function pushRecent(list: readonly RecentFile[], file: RecentFile, cap = MAX_RECENT): RecentFile[] {
  return [file, ...list.filter((f) => !samePath(f.path, file.path))].slice(0, cap)
}

/** Adds the bookmark, or removes it when that line already has one. */
export function toggleSpot(list: readonly NoteSpot[], spot: NoteSpot, cap = MAX_BOOKMARKS): NoteSpot[] {
  const at = list.findIndex((b) => b.line === spot.line && samePath(b.path, spot.path))
  if (at >= 0) return list.filter((_, i) => i !== at)
  return [spot, ...list].slice(0, cap)
}

/** Typing on nearby lines of the same file moves the newest edit location instead of adding one per keystroke. */
export function mergeEdit(list: readonly NoteSpot[], spot: NoteSpot, cap = MAX_EDITS): NoteSpot[] {
  const rest = list.filter((e) => !(samePath(e.path, spot.path) && Math.abs(e.line - spot.line) <= EDIT_NEAR))
  return [spot, ...rest].slice(0, cap)
}

export interface Trail {
  spots: Spot[]
  pos: number
}

const near = (a: Spot, b: Spot): boolean => samePath(a.path, b.path) && Math.abs(a.line - b.line) <= TRAIL_NEAR

/** Browser-style history: a visit near the current spot replaces it; elsewhere it drops the forward part and appends. */

export function trailVisit(trail: Trail, spot: Spot, cap = MAX_TRAIL): Trail {
  const cur = trail.spots[trail.pos]
  if (cur && near(cur, spot)) {
    const spots = trail.spots.slice()
    spots[trail.pos] = spot
    return { spots, pos: trail.pos }
  }
  const spots = [...trail.spots.slice(0, trail.pos + 1), spot].slice(-cap)
  return { spots, pos: spots.length - 1 }
}

/**
 * The pane left behind reports its line. When the new place was already recorded in the same tick
 * (`fresh`), the old spot belongs behind it, not after it.
 */
export function trailLeave(trail: Trail, spot: Spot, fresh: boolean, cap = MAX_TRAIL): Trail {
  const cur = trail.spots[trail.pos]
  if (!fresh || !cur || near(cur, spot)) return trailVisit(trail, spot, cap)
  const prev = trail.spots[trail.pos - 1]
  const spots = trail.spots.slice(0, trail.pos + 1)
  if (prev && near(prev, spot)) {
    spots[trail.pos - 1] = spot
    return { spots, pos: trail.pos }
  }
  spots.splice(trail.pos, 0, spot)
  const out = spots.slice(-cap)
  return { spots: out, pos: out.length - 1 }
}

export function trailStep(trail: Trail, step: 1 | -1): Trail | null {
  const pos = trail.pos + step
  return pos >= 0 && pos < trail.spots.length ? { spots: trail.spots, pos } : null
}

/** Drops entries whose shape no longer fits (storage written by another version or edited by hand). */
export function cleanSpots(raw: unknown, cap: number): NoteSpot[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((s): s is NoteSpot => !!s && typeof s.path === 'string' && Number.isInteger(s.line) && s.line > 0 && typeof s.text === 'string' && typeof s.at === 'number')
    .map((s) => ({ path: s.path, line: s.line, text: snippet(s.text), at: s.at, ...(typeof s.cwd === 'string' ? { cwd: s.cwd } : {}) }))
    .slice(0, cap)
}

export function cleanRecent(raw: unknown): RecentFile[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((s): s is RecentFile => !!s && typeof s.path === 'string' && typeof s.at === 'number')
    .map((s) => ({ path: s.path, at: s.at, ...(typeof s.cwd === 'string' ? { cwd: s.cwd } : {}) }))
    .slice(0, MAX_RECENT)
}
