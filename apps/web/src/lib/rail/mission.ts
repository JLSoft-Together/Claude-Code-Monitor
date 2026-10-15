import { tabProject, type Pane, type Tab } from '../../stores/workspace'
import type { RunBadge } from '../runUi'
import { boxes, type Box } from '../splitLayout'
import { needsUser, type RailCluster, type RailRow, type RailState } from './railModel'
import { spaceIndexes, spaceLabel } from './spaces'

export interface MissionWindow {
  paneKey: string
  box: Box
  /** Agent / run / tab row state; null for panes the rail does not track (a shell beside an agent). */
  state: RailState | null
  run: RunBadge | null
  title: string
}
export interface MissionSpace {
  tabKey: string
  label: string
  current: boolean
  needs: number
  failed: number
  windows: MissionWindow[]
}
export interface MissionGroup {
  key: string
  name: string
  spaces: MissionSpace[]
}

function rowFor(rows: readonly RailRow[], paneKey: string): RailRow | undefined {
  return rows.find((r) => r.key === paneKey) ?? rows.find((r) => r.key.startsWith('tab:') && r.paneKey === paneKey)
}

/** Every live project with its tabs (unscoped, unlike the strip) and each tab's panes as boxes. */
export function missionShelf(
  clusters: readonly RailCluster[],
  tabs: readonly Tab[],
  activeTabKey: string | null,
  folderOf: (t: Tab) => string,
  titleOf: (paneKey: string) => string,
  paneOf: (key: string) => Pick<Pane, 'kind' | 'cwd'> | undefined,
): MissionGroup[] {
  const idx = spaceIndexes(tabs, (t) => tabProject(t, paneOf))
  return clusters
    .filter((c) => c.live)
    .map((c) => {
      const rows = c.checkouts.flatMap((k) => k.rows)
      const spaces = c.tabKeys.flatMap((key): MissionSpace[] => {
        const tab = tabs.find((t) => t.key === key)
        if (!tab) return []
        const mine = rows.filter((r) => r.tabKey === key)
        return [
          {
            tabKey: key,
            label: spaceLabel(folderOf(tab), idx.get(key) ?? null),
            current: key === activeTabKey,
            needs: mine.filter((r) => needsUser(r.state)).length,
            failed: mine.filter((r) => r.state === 'failed').length,
            windows: [...boxes(tab.root)].map(([paneKey, box]) => {
              const row = rowFor(mine, paneKey)
              return { paneKey, box, state: row?.state ?? null, run: row?.run ?? null, title: titleOf(paneKey) }
            }),
          },
        ]
      })
      return { key: c.key, name: c.name, spaces }
    })
}

/** FLIP: the transform that puts an element laid out at `from` exactly over `to` (transform-origin 0 0). */
export function flipTransform(
  from: { left: number; top: number; width: number; height: number },
  to: { left: number; top: number; width: number; height: number },
): string {
  const sx = to.width / from.width
  const sy = to.height / from.height
  return `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${+sx.toFixed(4)}, ${+sy.toFixed(4)})`
}
