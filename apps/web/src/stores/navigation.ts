import { defineStore } from 'pinia'
import { nextTick, ref, shallowRef, watch, type Ref } from 'vue'
import {
  cleanRecent,
  cleanSpots,
  MAX_BOOKMARKS,
  MAX_EDITS,
  mergeEdit,
  pushRecent,
  samePath,
  snippet,
  toggleSpot,
  trailLeave,
  trailStep,
  trailVisit,
  type NoteSpot,
  type RecentFile,
  type Spot,
  type Trail,
} from '../lib/navigation'
import { useWorkspaceStore } from './workspace'

const BOOKMARKS = 'ccm.bookmarks'
const RECENT = 'ccm.recentFiles'
const EDITS = 'ccm.recentEdits'
// Pane switches fire visits (the old pane's line, the new pane's jump); none of them is a new place while stepping.
const QUIET_MS = 600
const SAME_TICK_MS = 100

function persisted<T>(key: string, clean: (raw: unknown) => T[]): Ref<T[]> {
  let start: T[] = []
  try {
    start = clean(JSON.parse(localStorage.getItem(key) ?? '[]'))
  } catch {
    start = []
  }
  const list = ref(start) as Ref<T[]>
  watch(list, (v) => {
    try {
      localStorage.setItem(key, JSON.stringify(v))
    } catch {
      // storage full or blocked: the list still works until reload
    }
  })
  return list
}

export type NavTab = 'recent' | 'edits' | 'bookmarks'

/** Bookmarks (F11), recent files / edit locations (Ctrl+E) and the back / forward trail of file panes. */
export const useNavigationStore = defineStore('navigation', () => {
  const workspace = useWorkspaceStore()
  const bookmarks = persisted<NoteSpot>(BOOKMARKS, (raw) => cleanSpots(raw, MAX_BOOKMARKS))
  const recent = persisted<RecentFile>(RECENT, cleanRecent)
  const edits = persisted<NoteSpot>(EDITS, (raw) => cleanSpots(raw, MAX_EDITS))
  const trail = shallowRef<Trail>({ spots: [], pos: -1 })
  const picker = ref<NavTab | null>(null)
  let quietUntil = 0
  let visitedAt = 0

  const linesOf = (path: string): number[] => bookmarks.value.filter((b) => samePath(b.path, path)).map((b) => b.line)

  function toggleBookmark(spot: Spot, text: string): boolean {
    const before = bookmarks.value.length
    bookmarks.value = toggleSpot(bookmarks.value, { ...spot, text: snippet(text), at: Date.now() })
    return bookmarks.value.length > before
  }

  const removeBookmark = (b: NoteSpot): void => {
    bookmarks.value = bookmarks.value.filter((x) => x !== b)
  }

  function opened(path: string, cwd?: string): void {
    recent.value = pushRecent(recent.value, { path, at: Date.now(), ...(cwd ? { cwd } : {}) })
  }

  function edited(spot: Spot, text: string): void {
    const head = edits.value[0]
    const next = { ...spot, text: snippet(text), at: Date.now() }
    if (head && samePath(head.path, next.path) && head.line === next.line && head.text === next.text) return
    edits.value = mergeEdit(edits.value, next)
  }

  function visit(spot: Spot): void {
    if (Date.now() < quietUntil) return
    trail.value = trailVisit(trail.value, spot)
    visitedAt = Date.now()
  }

  function leave(spot: Spot): void {
    if (Date.now() < quietUntil) return
    trail.value = trailLeave(trail.value, spot, Date.now() - visitedAt < SAME_TICK_MS)
  }

  async function go(spot: Spot): Promise<void> {
    const open = workspace.panes.find((p) => p.kind === 'file' && p.path && samePath(p.path, spot.path))
    // Same line twice is no change for FilePane's `line` watcher.
    if (open && open.line === spot.line) {
      open.line = undefined
      await nextTick()
    }
    workspace.openFile(spot.path, spot.line, spot.cwd ? { cwd: spot.cwd } : {})
  }

  function step(dir: 1 | -1): boolean {
    const next = trailStep(trail.value, dir)
    const spot = next?.spots[next.pos]
    if (!next || !spot) return false
    trail.value = next
    quietUntil = Date.now() + QUIET_MS
    void go(spot)
    return true
  }

  return { bookmarks, recent, edits, trail, picker, linesOf, toggleBookmark, removeBookmark, opened, edited, visit, leave, go, step }
})
