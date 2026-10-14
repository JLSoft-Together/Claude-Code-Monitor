/**
 * "Open on start" bookkeeping for one window: which panes were already looked at and which projects
 * already had their first terminal. Panes from restore or a layout are `adopt`ed: never a project's first.
 */
export function createStartGuard(started: Iterable<string> = [], persist?: (projects: string[]) => void) {
  const seenPanes = new Set<string>()
  const projects = new Set(started)

  return {
    adopt(paneKeys: Iterable<string>): void {
      for (const k of paneKeys) seenPanes.add(k)
    },
    /** True once for a pane nobody adopted: the caller then checks its project. */
    take(paneKey: string): boolean {
      if (seenPanes.has(paneKey)) return false
      seenPanes.add(paneKey)
      return true
    },
    /** True once per project; later calls (and projects marked by adopted panes) answer false. */
    claim(projectKey: string): boolean {
      if (projects.has(projectKey)) return false
      projects.add(projectKey)
      persist?.([...projects])
      return true
    },
    mark(projectKey: string): void {
      if (projects.has(projectKey)) return
      projects.add(projectKey)
      persist?.([...projects])
    },
  }
}

export type StartGuard = ReturnType<typeof createStartGuard>
