import { canExpand, isVisible, type Listings } from './tree'

/**
 * Next move to show one file's row (ported from spacevibe-deck `files/tree-reveal.ts`). Revealing is a loop:
 * open a folder, wait for its listing, ask again. Paths are matched against listed entries, never against
 * the root's spelling (main returns real paths; the root key may not be one).
 */
export type RevealStep = { kind: 'done' } | { kind: 'open-root' } | { kind: 'expand'; directory: string } | { kind: 'wait' } | { kind: 'none' }

export interface RevealState {
  target: string
  root: string
  listings: Listings
  expanded: ReadonlySet<string>
  rootExpanded: boolean
  showHidden: boolean
  /** Folders whose last listing failed. */
  errors: ReadonlyMap<string, unknown>
}

const norm = (p: string): string => p.replace(/\\/g, '/')
const onPath = (entry: string, target: string): boolean => target === entry || target.startsWith(`${entry}/`)

export function nextRevealStep(state: RevealState): RevealStep {
  const { root, listings, expanded, showHidden, errors } = state
  const target = norm(state.target)
  // Case-insensitive on Windows paths: a terminal link may differ in case from the listing.
  const fold = /^[A-Za-z]:/.test(state.target) ? (p: string) => norm(p).toLowerCase() : norm
  const t = fold(target)
  let closed: RevealStep | null = state.rootExpanded ? null : { kind: 'open-root' }
  let dir = root
  const walked = new Set<string>()
  for (;;) {
    const listing = listings.get(dir)
    if (!listing) {
      if (errors.has(dir)) return { kind: 'none' }
      return dir === root ? { kind: 'wait' } : (closed ?? { kind: 'wait' })
    }
    const entry = listing.find((e) => isVisible(e, showHidden) && onPath(fold(e.path), t))
    if (!entry) return { kind: 'none' }
    if (fold(entry.path) === t) return closed ?? { kind: 'done' }
    if (!canExpand(entry) || walked.has(entry.path)) return { kind: 'none' }
    walked.add(entry.path)
    if (!closed && !expanded.has(entry.path)) closed = { kind: 'expand', directory: entry.path }
    dir = entry.path
  }
}
