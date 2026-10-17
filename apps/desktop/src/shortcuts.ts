import path from 'node:path'

export interface ShortcutInfo {
  target: string
  appUserModelId?: string
}

export interface ShortcutDeps {
  list(dir: string): string[]
  read(file: string): ShortcutInfo | null
  exists(file: string): boolean
  remove(file: string): void
}

/** Deletes `.lnk` files in `dir` that carry `appId` but point at an exe that is gone; returns the removed paths. */
export function removeDeadShortcuts(dir: string, appId: string, deps: ShortcutDeps): string[] {
  const removed: string[] = []
  let names: string[]
  try {
    names = deps.list(dir)
  } catch {
    return removed
  }
  for (const name of names) {
    if (path.extname(name).toLowerCase() !== '.lnk') continue
    const file = path.join(dir, name)
    try {
      const link = deps.read(file)
      if (!link || link.appUserModelId !== appId || !link.target || deps.exists(link.target)) continue
      deps.remove(file)
      removed.push(file)
    } catch {
      // Unreadable or locked shortcut: leave it.
    }
  }
  return removed
}
