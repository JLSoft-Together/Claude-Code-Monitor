import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { isAgentSessionId, isPtyPreset, type PtyPreset } from '@ccm/shared'
import { rootKey } from './preview/paths'

export const LAYOUTS_FILE = 'layouts.json'
export const MAX_PER_PROJECT = 20
const MAX_PANES = 32
const MAX_TABS = 16
const MAX_NAME = 80
const MAX_TEXT = 4096

export type LayoutPaneKind = 'term' | 'browser' | 'file' | 'changes'

export interface LayoutPane {
  kind: LayoutPaneKind
  preset?: PtyPreset
  cwd?: string
  url?: string
  path?: string
  line?: number
  /** Agent session to resume; only stored when the user asked for it. */
  resume?: string
}

export type LayoutTree = { pane: string } | { dir: 'row' | 'col'; ratio: number; a: LayoutTree; b: LayoutTree }

export interface SavedLayout {
  id: string
  project: string
  name: string
  updatedAt: string
  openOnStart?: boolean
  panes: Record<string, LayoutPane>
  tabs: { root: LayoutTree; focus?: string }[]
}

const str = (v: unknown, max = MAX_TEXT): v is string => typeof v === 'string' && v.length > 0 && v.length <= max
const isAbs = (v: unknown): v is string => str(v) && path.isAbsolute(v)

function cleanTree(n: unknown, panes: Record<string, LayoutPane>, depth = 0): LayoutTree | null {
  if (!n || typeof n !== 'object' || depth > 12) return null
  const node = n as Record<string, unknown>
  if ('pane' in node) return str(node.pane, 64) && panes[node.pane] ? { pane: node.pane } : null
  if (node.dir !== 'row' && node.dir !== 'col') return null
  const a = cleanTree(node.a, panes, depth + 1)
  const b = cleanTree(node.b, panes, depth + 1)
  const ratio = typeof node.ratio === 'number' && Number.isFinite(node.ratio) ? Math.min(0.85, Math.max(0.15, node.ratio)) : 0.5
  // An unusable pane drops out; its sibling takes the split's place.
  return a && b ? { dir: node.dir, ratio, a, b } : (a ?? b)
}

const leavesOf = (n: LayoutTree): string[] => ('pane' in n ? [n.pane] : [...leavesOf(n.a), ...leavesOf(n.b)])

function cleanPane(v: unknown): LayoutPane | null {
  if (!v || typeof v !== 'object') return null
  const p = v as Record<string, unknown>
  const cwd = isAbs(p.cwd) ? p.cwd : undefined
  switch (p.kind) {
    case 'term':
      if (!isPtyPreset(p.preset)) return null
      return { kind: 'term', preset: p.preset, cwd, resume: p.preset !== 'shell' && isAgentSessionId(p.resume) ? p.resume : undefined }
    case 'browser':
      if (p.url !== undefined && p.url !== '' && !(str(p.url) && (/^https?:\/\//i.test(p.url) || path.isAbsolute(p.url)))) return null
      return { kind: 'browser', url: typeof p.url === 'string' ? p.url : '', cwd }
    case 'file':
      if (!isAbs(p.path)) return null
      return { kind: 'file', path: p.path, line: typeof p.line === 'number' && p.line > 0 ? Math.floor(p.line) : undefined, cwd }
    case 'changes':
      return cwd ? { kind: 'changes', cwd } : null
    default:
      return null
  }
}

/** Drops anything malformed; null when nothing usable is left. Never trusts the page's shape. */
export function cleanLayout(v: unknown): Omit<SavedLayout, 'id' | 'updatedAt'> & { id?: string } | null {
  if (!v || typeof v !== 'object') return null
  const l = v as Record<string, unknown>
  if (!isAbs(l.project) || typeof l.name !== 'string') return null
  const name = l.name.trim().slice(0, MAX_NAME)
  if (!name) return null
  const panes: Record<string, LayoutPane> = {}
  const raw = l.panes && typeof l.panes === 'object' ? Object.entries(l.panes as Record<string, unknown>) : []
  for (const [k, p] of raw.slice(0, MAX_PANES)) {
    const pane = cleanPane(p)
    if (pane && str(k, 64)) panes[k] = pane
  }
  const tabs: SavedLayout['tabs'] = []
  const used = new Set<string>()
  for (const t of Array.isArray(l.tabs) ? l.tabs.slice(0, MAX_TABS) : []) {
    const root = cleanTree((t as { root?: unknown })?.root, panes)
    if (!root) continue
    const keys = leavesOf(root)
    if (keys.some((k) => used.has(k))) continue
    keys.forEach((k) => used.add(k))
    const focus = (t as { focus?: unknown }).focus
    tabs.push({ root, focus: typeof focus === 'string' && keys.includes(focus) ? focus : keys[0] })
  }
  if (!tabs.length) return null
  for (const k of Object.keys(panes)) if (!used.has(k)) delete panes[k]
  return { id: str(l.id, 64) ? l.id : undefined, project: l.project, name, openOnStart: l.openOnStart === true || undefined, panes, tabs }
}

/** Case-insensitive on win32; follows symlinks when the folder still exists. */
export function projectKey(project: string): string {
  let real = project
  try {
    real = realpathSync.native(project)
  } catch {
    // folder gone: its layouts stay reachable by the path they were saved under
  }
  return rootKey(real)
}

export type SaveResult = { ok: true; layout: SavedLayout } | { ok: false; error: 'invalid' | 'limit' }

/** `<dataDir>/layouts.json`: named tab sets per project. No scrollback, no output, never prompts. */
export class LayoutStore {
  private list: SavedLayout[] = []

  constructor(private readonly file?: string) {
    if (!file) return
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as unknown
      for (const item of Array.isArray(raw) ? raw : []) {
        const clean = cleanLayout(item)
        const it = item as Partial<SavedLayout>
        if (clean && clean.id) this.list.push({ ...clean, id: clean.id, updatedAt: typeof it.updatedAt === 'string' ? it.updatedAt : new Date(0).toISOString() })
      }
    } catch {
      // missing or unreadable: start empty
    }
  }

  forProject(project: string): SavedLayout[] {
    const key = projectKey(project)
    return this.list.filter((l) => projectKey(l.project) === key).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  /** New when `id` is unknown; same id = rename / overwrite. One "open on start" per project. */
  save(input: unknown): SaveResult {
    const clean = cleanLayout(input)
    if (!clean) return { ok: false, error: 'invalid' }
    const key = projectKey(clean.project)
    const same = this.list.filter((l) => projectKey(l.project) === key)
    const existing = clean.id ? same.find((l) => l.id === clean.id) : undefined
    if (!existing && same.length >= MAX_PER_PROJECT) return { ok: false, error: 'limit' }
    const layout: SavedLayout = { ...clean, id: existing?.id ?? randomUUID(), updatedAt: new Date().toISOString() }
    if (layout.openOnStart) for (const l of same) if (l.id !== layout.id) delete l.openOnStart
    this.list = existing ? this.list.map((l) => (l === existing ? layout : l)) : [...this.list, layout]
    this.write()
    return { ok: true, layout }
  }

  /** Flag only, so "open on start" can be switched without resending the tab set. */
  setOpenOnStart(project: string, id: string | null): boolean {
    const key = projectKey(project)
    let found = id === null
    for (const l of this.list) {
      if (projectKey(l.project) !== key) continue
      if (l.id === id) {
        l.openOnStart = true
        found = true
      } else delete l.openOnStart
    }
    if (found) this.write()
    return found
  }

  delete(project: string, id: string): boolean {
    const key = projectKey(project)
    const before = this.list.length
    this.list = this.list.filter((l) => !(l.id === id && projectKey(l.project) === key))
    if (this.list.length === before) return false
    this.write()
    return true
  }

  private write(): void {
    if (!this.file) return
    try {
      mkdirSync(path.dirname(this.file), { recursive: true })
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.list, null, 2))
      renameSync(tmp, this.file)
    } catch {
      // read-only data dir: layouts last until quit
    }
  }
}

const LAYOUT_CHANNELS = ['ccm:layouts-list', 'ccm:layouts-save', 'ccm:layouts-delete', 'ccm:layouts-start']

export function registerLayoutsIpc(deps: { ipcMain: IpcMain; isAppFrame: (event: IpcMainInvokeEvent) => boolean; store: LayoutStore }): () => void {
  const { ipcMain, isAppFrame, store } = deps
  ipcMain.handle('ccm:layouts-list', (event, project: unknown) => (isAppFrame(event) && isAbs(project) ? store.forProject(project) : []))
  ipcMain.handle('ccm:layouts-save', (event, layout: unknown) => (isAppFrame(event) ? store.save(layout) : { ok: false, error: 'invalid' }))
  ipcMain.handle('ccm:layouts-delete', (event, project: unknown, id: unknown) => isAppFrame(event) && isAbs(project) && str(id, 64) && store.delete(project, id))
  ipcMain.handle('ccm:layouts-start', (event, project: unknown, id: unknown) =>
    isAppFrame(event) && isAbs(project) && (id === null || str(id, 64)) && store.setOpenOnStart(project, id as string | null),
  )
  return () => {
    for (const ch of LAYOUT_CHANNELS) ipcMain.removeHandler(ch)
  }
}
