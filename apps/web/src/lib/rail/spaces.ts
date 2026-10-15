import { dirKey } from '../../stores/favorites'
import type { Tab } from '../../stores/workspace'
import type { RailCluster } from './railModel'

/** Tabs drawn on the strip and counted by Ctrl+Alt+1–9 / cycling: the active tab's project only, in open order. */
export function projectTabKeys(clusters: readonly RailCluster[], tabs: readonly Pick<Tab, 'key'>[], activeTabKey: string | null): string[] {
  const all = tabs.map((t) => t.key)
  const owner = activeTabKey ? clusters.find((c) => c.tabKeys.includes(activeTabKey)) : undefined
  return owner ? all.filter((k) => owner.tabKeys.includes(k)) : all
}

/** 1-based index among tabs opened on the same folder; null when a folder has one tab. */
export function spaceIndexes(tabs: readonly Tab[], projectOf: (t: Tab) => string | undefined): Map<string, number | null> {
  const groups = new Map<string, string[]>()
  for (const t of tabs) {
    const p = projectOf(t)
    const k = p ? dirKey(p) : '~'
    groups.set(k, [...(groups.get(k) ?? []), t.key])
  }
  const out = new Map<string, number | null>()
  for (const keys of groups.values()) keys.forEach((k, i) => out.set(k, keys.length > 1 ? i + 1 : null))
  return out
}

export const spaceLabel = (folder: string, index: number | null): string => (index === null ? folder : `${folder} ${index}`)
