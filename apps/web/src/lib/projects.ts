import type { PtyPreset } from '@ccm/shared'
import type { LayoutNode } from './splitLayout'

/** Mirrors `apps/desktop/src/preview/scripts.ts`. */
export type ScriptSource = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'make' | 'just' | 'cargo' | 'python'

export interface ScriptItem {
  name: string
  detail?: string
  run: string
}

export interface ScriptGroup {
  source: ScriptSource
  file: string
  items: ScriptItem[]
}

export interface ScriptsResult {
  dir: string
  groups: ScriptGroup[]
}

/** Mirrors `apps/desktop/src/layouts.ts`. */
export interface LayoutPane {
  kind: 'term' | 'browser' | 'file' | 'changes' | 'log' | 'run'
  preset?: PtyPreset
  cwd?: string
  url?: string
  path?: string
  line?: number
  resume?: string
}

export interface SavedLayout {
  id: string
  project: string
  name: string
  updatedAt: string
  openOnStart?: boolean
  panes: Record<string, LayoutPane>
  tabs: { root: LayoutNode; focus?: string }[]
}

export type LayoutDraft = Omit<SavedLayout, 'id' | 'updatedAt'> & { id?: string }
export type SaveLayoutResult = { ok: true; layout: SavedLayout } | { ok: false; error: 'invalid' | 'limit' | 'unavailable' }

interface ProjectBridge {
  projectRoot?: (dir: string, remembered?: boolean) => Promise<unknown>
  scripts?: (dir: string) => Promise<ScriptsResult | null>
  layoutsList?: (project: string) => Promise<SavedLayout[]>
  layoutsSave?: (layout: LayoutDraft) => Promise<SaveLayoutResult>
  layoutsDelete?: (project: string, id: string) => Promise<boolean>
  layoutsStart?: (project: string, id: string | null) => Promise<boolean>
}

const bridge = (window as unknown as { ccmDesktop?: ProjectBridge }).ccmDesktop

export const hasScripts = typeof bridge?.scripts === 'function'
export const hasLayouts = typeof bridge?.layoutsList === 'function'

export interface ProjectRootInfo {
  root: string
  /** False when the folder is not in a git repo (root = the folder itself). */
  repo: boolean
  /** Shared `.git` dir: equal for a repo's main checkout and all its worktrees. */
  common?: string
}

/** `remembered`: a rail folder with no pane; the host answers read-only facts instead of refusing it. */
export async function projectRootInfo(dir: string, remembered = false): Promise<ProjectRootInfo | null> {
  const v = await (bridge?.projectRoot?.(dir, remembered) ?? Promise.resolve(null)).catch(() => null)
  if (typeof v === 'string') return { root: v, repo: true }
  if (!v || typeof v !== 'object') return null
  const { root, repo, common } = v as Partial<ProjectRootInfo>
  return typeof root === 'string' ? { root, repo: repo === true, common: typeof common === 'string' ? common : undefined } : null
}

export const projectRoot = async (dir: string): Promise<string | null> => (await projectRootInfo(dir))?.root ?? null
export const scriptsIn = (dir: string): Promise<ScriptsResult | null> => bridge?.scripts?.(dir) ?? Promise.resolve(null)
export const listLayouts = (project: string): Promise<SavedLayout[]> => bridge?.layoutsList?.(project) ?? Promise.resolve([])
/** Plain JSON copy: split trees come from reactive store state, and IPC cannot clone a Proxy. */
export async function saveLayout(layout: LayoutDraft): Promise<SaveLayoutResult> {
  if (!bridge?.layoutsSave) return { ok: false, error: 'unavailable' }
  try {
    return await bridge.layoutsSave(JSON.parse(JSON.stringify(layout)) as LayoutDraft)
  } catch {
    return { ok: false, error: 'invalid' }
  }
}
export const deleteLayout = (project: string, id: string): Promise<boolean> => bridge?.layoutsDelete?.(project, id) ?? Promise.resolve(false)
export const setStartLayout = (project: string, id: string | null): Promise<boolean> => bridge?.layoutsStart?.(project, id) ?? Promise.resolve(false)

const RECENT_KEY = 'ccm.workspace.recentScripts'
const RECENT_MAX = 12
const RECENT_DIRS = 30

const recentKey = (dir: string): string => dir.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()

function readRecent(): Record<string, string[]> {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '{}') as unknown
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string[]>) : {}
  } catch {
    return {}
  }
}

/** Last run commands (the `run` line) per folder, newest first. */
export function recentScripts(dir: string): string[] {
  const list = readRecent()[recentKey(dir)]
  return Array.isArray(list) ? list.filter((r) => typeof r === 'string') : []
}

export function rememberScript(dir: string, run: string): void {
  const all = readRecent()
  const key = recentKey(dir)
  const list = [run, ...(all[key] ?? []).filter((r) => r !== run)].slice(0, RECENT_MAX)
  delete all[key]
  const next: Record<string, string[]> = { [key]: list, ...all }
  for (const k of Object.keys(next).slice(RECENT_DIRS)) delete next[k]
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    // storage unavailable
  }
}
