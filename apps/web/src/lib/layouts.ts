import { isTerm, primaryPaneKey, type Pane, type Tab } from '../stores/workspace'
import type { LayoutDraft, LayoutPane } from './projects'
import { leaves } from './splitLayout'

export interface CaptureOptions {
  project: string
  name: string
  /** Store agent session ids so opening continues those conversations; off = agents start fresh. */
  resume: boolean
  id?: string
  openOnStart?: boolean
}

function specOf(pane: Pane, resume: boolean): LayoutPane {
  if (isTerm(pane)) {
    const id = resume && pane.preset !== 'shell' ? (pane.agentSessionId ?? pane.resume) : undefined
    return { kind: 'term', preset: pane.preset, cwd: pane.cwd, resume: id }
  }
  if (pane.kind === 'browser') return { kind: 'browser', url: pane.url ?? '', cwd: pane.cwd }
  if (pane.kind === 'file') return { kind: 'file', path: pane.path, line: pane.line, cwd: pane.cwd }
  return { kind: 'changes', cwd: pane.root ?? pane.cwd }
}

/** Tabs whose naming pane belongs to the project, with split trees and ratios; no output, no prompts. */
export function captureLayout(tabs: readonly Tab[], panes: readonly Pane[], inProject: (pane: Pane) => boolean, opts: CaptureOptions): LayoutDraft | null {
  const byKey = new Map(panes.map((p) => [p.key, p]))
  const paneOf = (k: string): Pane | undefined => byKey.get(k)
  const picked = tabs.filter((t) => {
    const primary = paneOf(primaryPaneKey(t.root, paneOf))
    return !!primary && inProject(primary)
  })
  if (!picked.length) return null
  const specs: Record<string, LayoutPane> = {}
  for (const tab of picked) for (const key of leaves(tab.root)) specs[key] = specOf(byKey.get(key)!, opts.resume)
  return {
    id: opts.id,
    project: opts.project,
    name: opts.name.trim(),
    openOnStart: opts.openOnStart || undefined,
    panes: specs,
    tabs: picked.map((t) => ({ root: t.root, focus: t.focus })),
  }
}

export const layoutCounts = (l: Pick<LayoutDraft, 'panes' | 'tabs'>): { tabs: number; agents: number } => ({
  tabs: l.tabs.length,
  agents: Object.values(l.panes).filter((p) => p.kind === 'term' && p.preset !== 'shell').length,
})
