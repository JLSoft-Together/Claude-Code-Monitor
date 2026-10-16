import { compactEntry, type CompactState } from './compactHandoff'
import type { MenuEntry } from './menu'

type T = (key: string, params?: Record<string, unknown>) => string

export interface TabMenuCtx {
  active: boolean
  panes: number
  targets: ReadonlyArray<{ key: string; name: string }>
  others: number
  compact?: CompactState | null
  zoomed?: boolean
  zoomKeys?: string
  dim?: boolean
}

const A = 'workspace.tabActions.'
const MOVE = 'move:'

export function tabMenu(ctx: TabMenuCtx, t: T): MenuEntry[] {
  const entries: MenuEntry[] = []
  if (!ctx.active) entries.push({ id: 'open', label: t(`${A}open`) })
  entries.push({ id: 'rename', label: t(`${A}rename`), shortcut: 'F2' })
  if (ctx.panes > 1) entries.push({ id: 'ungroup', label: t(`${A}ungroup`) })
  entries.push(
    ctx.targets.length
      ? { id: 'move', label: t(`${A}moveTo`), children: ctx.targets.map((x) => ({ id: `${MOVE}${x.key}`, label: x.name })) }
      : { id: 'move', label: t(`${A}moveTo`), disabled: true, hint: t(`${A}noTargets`) },
  )
  if (ctx.panes > 1) {
    entries.push(
      { separator: true },
      ctx.zoomed
        ? { id: 'unzoom', label: t('workspace.zoom.unzoom'), shortcut: ctx.zoomKeys }
        : { id: 'zoom', label: t('workspace.zoom.zoom'), shortcut: ctx.zoomKeys },
    )
    if (ctx.dim !== undefined) entries.push({ id: 'dim', label: t(ctx.dim ? 'workspace.dim.toggleOn' : 'workspace.dim.menu') })
  }
  const compact = compactEntry(ctx.compact, t)
  if (compact.length) entries.push({ separator: true }, ...compact)
  entries.push({ separator: true }, { id: 'close', label: t(`${A}close`) }, { id: 'close-others', label: t(`${A}closeOthers`), disabled: ctx.others < 1 })
  return entries
}

export const moveTargetOf = (id: string): string | null => (id.startsWith(MOVE) && id.length > MOVE.length ? id.slice(MOVE.length) : null)
