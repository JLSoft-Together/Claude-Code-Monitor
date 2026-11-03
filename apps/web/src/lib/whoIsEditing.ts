import type { FileEditor, PtyPreset } from '@ccm/shared'
import { rootKey, type CheckoutChanges } from './overlap'

export interface EditorPane {
  name: string
  agent: PtyPreset
  status?: string
  /** The pane's working folder. */
  dir: string
  lastActivityAt?: string
}

/** Deepest checkout holding `dir`: a worktree can sit inside the main one. */
export function checkoutOf(dir: string, checkouts: readonly CheckoutChanges[]): CheckoutChanges | undefined {
  const k = rootKey(dir)
  return checkouts.filter((c) => k === rootKey(c.root) || k.startsWith(`${rootKey(c.root)}\\`)).sort((a, b) => b.root.length - a.root.length)[0]
}

const relOf = (file: string, root: string): string | null => {
  const k = rootKey(file)
  const r = rootKey(root)
  return k.startsWith(`${r}\\`) ? file.replace(/\\/g, '/').slice(root.replace(/[\\/]+$/, '').length + 1) : null
}

const joinRel = (root: string, rel: string): string => {
  const sep = root.includes('\\') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${sep}${rel.split('/').join(sep)}`
}

/**
 * who_is_editing (v80): other agent panes whose checkout (a worktree of the same repo, or the caller's own folder)
 * has `file` among its changes against the main branch — the same data the Overlap radar compares.
 */
export function whoIsEditing(file: string, callerDir: string, others: readonly EditorPane[], checkouts: readonly CheckoutChanges[]): { repo: boolean; editors: FileEditor[] } {
  const mine = checkoutOf(callerDir, checkouts)
  const rel = mine ? relOf(file, mine.root) : null
  if (!mine || !rel) return { repo: false, editors: [] }
  const want = rel.toLowerCase()
  const has = (c: CheckoutChanges): boolean => c.files.some((f) => f.toLowerCase() === want)
  const editors: FileEditor[] = []
  for (const p of others) {
    const co = checkoutOf(p.dir, checkouts)
    if (!co) continue
    const same = rootKey(co.root) === rootKey(mine.root)
    if (!same && (!co.common || !mine.common || rootKey(co.common) !== rootKey(mine.common))) continue
    if (!has(co)) continue
    editors.push({
      name: p.name,
      agent: p.agent,
      ...(p.status ? { status: p.status } : {}),
      branch: co.branch,
      root: co.root,
      sameCheckout: same,
      file: same ? file : joinRel(co.root, rel),
      ...(p.lastActivityAt ? { lastActivityAt: p.lastActivityAt } : {}),
    })
  }
  return { repo: true, editors }
}
