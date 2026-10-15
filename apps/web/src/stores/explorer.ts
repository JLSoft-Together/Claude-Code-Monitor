import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'
import type { EntryNameProblem } from '@ccm/shared'
import { flattenTree, isHidden, movedPath, openDirectories, parentDirectory, rootName, toggleExpanded, type DirEntry } from '../lib/explorer/tree'
import {
  createEntry as createEntryIpc,
  listDir,
  onPreviewChanged,
  renameEntry as renameEntryIpc,
  trashEntry as trashEntryIpc,
  unwatchRoot,
  watchRoot,
} from '../lib/preview'
import { dirKey } from './favorites'

/** Tree state of one project root; kept per window while the app runs (not persisted). */
export interface RootState {
  expanded: ReadonlySet<string>
  rootExpanded: boolean
  showHidden: boolean
  /** Keyed by the folder path as requested (children use the paths main returned). */
  listings: ReadonlyMap<string, readonly DirEntry[]>
  errors: ReadonlyMap<string, true>
  focused: string | null
}

export type ExplorerView = 'files' | 'changes'

/** One transient line under the header; the component translates `key`. */
export interface ExplorerStatus {
  key: 'createFailed' | 'exists' | 'invalid' | 'denied' | 'shownHidden' | 'renameFailed' | 'renameInvalid' | 'trashFailed' | 'missing' | 'busy' | 'copied'
  name: string
  reason?: EntryNameProblem
  failed: boolean
}

const VIEW_KEY = 'ccm.workspace.explorerView'
/** Coalesces a burst of watcher events (already debounced 150 ms in main) into one re-list per folder. */
export const TREE_REFRESH_MS = 100

const fresh = (): RootState => ({ expanded: new Set(), rootExpanded: true, showHidden: false, listings: new Map(), errors: new Map(), focused: null })

function readView(): ExplorerView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'changes' ? 'changes' : 'files'
  } catch {
    return 'files'
  }
}

export const useExplorerStore = defineStore('explorer', () => {
  const root = ref<string | null>(null)
  const state = shallowRef<RootState>(fresh())
  const view = ref<ExplorerView>(readView())
  const status = ref<ExplorerStatus | null>(null)
  /** Row to focus once it renders (after a create). */
  const pendingFocus = ref<string | null>(null)
  const saved = new Map<string, RootState>()
  const generation = new Map<string, number>()
  let watched: string | null = null
  let offChanged: (() => void) | null = null
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  const dirty = new Set<string>()

  const rows = computed(() => (root.value ? flattenTree(root.value, state.value.listings, state.value.expanded, state.value.showHidden, state.value.rootExpanded) : []))
  const openDirs = computed(() => (root.value ? openDirectories(rows.value, root.value) : []))

  const patch = (next: Partial<RootState>): void => {
    state.value = { ...state.value, ...next }
  }

  function setView(next: ExplorerView): void {
    view.value = next
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // storage unavailable
    }
  }

  /** Switches the tree to `next` (null keeps the current root); each root keeps its own expansion. */
  function setRoot(next: string | null): void {
    if (!next || (root.value && dirKey(next) === dirKey(root.value))) return
    if (root.value) saved.set(dirKey(root.value), state.value)
    root.value = next
    state.value = saved.get(dirKey(next)) ?? fresh()
    status.value = null
    pendingFocus.value = null
    if (offChanged) setWatch(next)
    void refresh()
  }

  function setWatch(next: string | null): void {
    if (watched === next) return
    if (watched) void unwatchRoot(watched)
    watched = next
    if (next) void watchRoot(next)
  }

  /** The panel is on screen: watch the root and follow file events. */
  function attach(): void {
    if (offChanged) return
    offChanged = onPreviewChanged((c) => onChanged(c.paths))
    setWatch(root.value)
    if (root.value) void refresh()
  }

  function detach(): void {
    offChanged?.()
    offChanged = null
    setWatch(null)
    if (refreshTimer) clearTimeout(refreshTimer)
    refreshTimer = null
    dirty.clear()
  }

  async function loadListing(dir: string): Promise<void> {
    const at = root.value
    if (!at) return
    const genKey = `${dirKey(at)}\0${dir}`
    const gen = (generation.get(genKey) ?? 0) + 1
    generation.set(genKey, gen)
    const entries = await listDir(at, dir)
    if (generation.get(genKey) !== gen || root.value !== at) return
    const listings = new Map(state.value.listings)
    const errors = new Map(state.value.errors)
    if (entries) {
      listings.set(dir, entries)
      errors.delete(dir)
    } else errors.set(dir, true)
    patch({ listings, errors })
  }

  /** Loads a folder unless it is cached and its last read worked. */
  function ensureListing(dir: string): Promise<void> {
    return state.value.listings.has(dir) && !state.value.errors.has(dir) ? Promise.resolve() : loadListing(dir)
  }

  function refresh(): Promise<void> {
    return Promise.all(openDirs.value.map(loadListing)).then(() => undefined)
  }

  function toggle(dir: string): void {
    if (root.value && dir === root.value) return toggleRoot()
    const expanded = toggleExpanded(state.value.expanded, dir)
    patch({ expanded })
    if (expanded.has(dir)) void ensureListing(dir)
  }

  function expand(dir: string): void {
    if (root.value && dir === root.value) {
      if (!state.value.rootExpanded) toggleRoot()
      return
    }
    if (!state.value.expanded.has(dir)) toggle(dir)
  }

  function toggleRoot(): void {
    patch({ rootExpanded: !state.value.rootExpanded })
    if (state.value.rootExpanded && root.value) void ensureListing(root.value)
  }

  function collapseAll(): void {
    patch({ expanded: new Set() })
  }

  function setShowHidden(on: boolean): void {
    patch({ showHidden: on })
  }

  function setFocused(path: string | null): void {
    if (state.value.focused !== path) patch({ focused: path })
  }

  /** Watcher paths → re-list each on-screen folder holding (or being) a changed path. */
  function onChanged(paths: readonly string[]): void {
    const open = new Map(openDirs.value.map((d) => [dirKey(d), d]))
    for (const p of paths) {
      for (const k of [dirKey(parentDirectory(p)), dirKey(p)]) {
        const d = open.get(k)
        if (d) dirty.add(d)
      }
    }
    if (!dirty.size || refreshTimer) return
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      const dirs = [...dirty]
      dirty.clear()
      for (const d of dirs) void loadListing(d)
    }, TREE_REFRESH_MS)
  }

  /** New file/folder in `parent`; on success the parent is open, listed again and the row is focused. Returns the new path. */
  async function create(parent: string, name: string, kind: 'file' | 'directory'): Promise<string | null> {
    const at = root.value
    if (!at) return null
    const res = await createEntryIpc(at, parent, name, kind)
    if (root.value !== at) return null
    if (!res.ok) {
      const key = res.error === 'invalid' || res.error === 'exists' || res.error === 'denied' ? res.error : 'createFailed'
      status.value = { key, name, reason: res.error === 'invalid' ? res.reason : undefined, failed: true }
      return null
    }
    status.value = null
    if (isHidden(name) && !state.value.showHidden) {
      setShowHidden(true)
      status.value = { key: 'shownHidden', name, failed: false }
    }
    expand(parent)
    await loadListing(parent)
    pendingFocus.value = res.path
    setFocused(res.path)
    return res.path
  }

  /** Renames `path` to `name`; open folders under it follow, the parent is listed again and the row focused. Returns the new path. */
  async function rename(path: string, name: string): Promise<string | null> {
    const at = root.value
    if (!at) return null
    const res = await renameEntryIpc(at, path, name)
    if (root.value !== at) return null
    if (!res.ok) {
      const key =
        res.error === 'invalid' ? 'renameInvalid' : res.error === 'exists' || res.error === 'denied' || res.error === 'missing' || res.error === 'busy' ? res.error : 'renameFailed'
      status.value = { key, name: res.error === 'missing' || res.error === 'busy' ? rootName(path) : name, reason: res.error === 'invalid' ? res.reason : undefined, failed: true }
      return null
    }
    status.value = null
    const moved = [...state.value.expanded].map((p) => movedPath(p, path, res.path))
    patch({ expanded: new Set([...state.value.expanded].map((p, i) => moved[i] ?? p)) })
    await Promise.all([parentDirectory(path), ...moved.filter((p): p is string => !!p)].map(loadListing))
    pendingFocus.value = res.path
    setFocused(res.path)
    return res.path
  }

  /** Moves `path` to the OS trash and lists its folder again. */
  async function trash(path: string): Promise<boolean> {
    const at = root.value
    if (!at) return false
    const res = await trashEntryIpc(at, path)
    if (root.value !== at) return false
    if (!res.ok) {
      const key = res.error === 'denied' || res.error === 'missing' || res.error === 'busy' || res.error === 'exists' ? res.error : 'trashFailed'
      status.value = { key, name: rootName(path), failed: true }
      return false
    }
    status.value = null
    await loadListing(parentDirectory(path))
    return true
  }

  function clearStatus(): void {
    status.value = null
  }

  return {
    root,
    state,
    view,
    status,
    pendingFocus,
    rows,
    openDirs,
    setView,
    setRoot,
    attach,
    detach,
    loadListing,
    ensureListing,
    refresh,
    toggle,
    expand,
    toggleRoot,
    collapseAll,
    setShowHidden,
    setFocused,
    onChanged,
    create,
    rename,
    trash,
    clearStatus,
  }
})
