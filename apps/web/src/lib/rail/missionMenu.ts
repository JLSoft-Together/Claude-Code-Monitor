import { compactEntry, type CompactState } from '../compactHandoff'
import type { MenuEntry } from '../menu'

type T = (key: string, params?: Record<string, unknown>) => string

const A = 'workspace.tabActions.'

export interface MissionMenuTarget {
  key: string
  title: string
}

export interface CardMenuCtx {
  mac: boolean
  panes: number
  targets: readonly MissionMenuTarget[]
}

export interface TileMenuCtx {
  mac: boolean
  alone: boolean
  targets: readonly MissionMenuTarget[]
  compact?: CompactState | null
}

function moveEntry(id: string, targets: readonly MissionMenuTarget[], t: T): MenuEntry {
  if (!targets.length) return { id, label: t(`${A}moveTo`), disabled: true, hint: t(`${A}noTargets`) }
  return { id, label: t(`${A}moveTo`), children: targets.map((x) => ({ id: `${id}:${x.key}`, label: x.title || x.key })) }
}

const enterKey = (mac: boolean): string => (mac ? '↩' : 'Enter')

export function cardMenu(ctx: CardMenuCtx, t: T): MenuEntry[] {
  return [
    { id: 'open', label: t(`${A}open`), shortcut: enterKey(ctx.mac) },
    { id: 'rename', label: t(`${A}rename`), shortcut: 'F2' },
    { id: 'ungroup', label: t(`${A}ungroup`), disabled: ctx.panes < 2 },
    moveEntry('merge', ctx.targets, t),
    { separator: true },
    { id: 'close', label: t(`${A}close`) },
  ]
}

export function tileMenu(ctx: TileMenuCtx, t: T): MenuEntry[] {
  return [
    { id: 'focus', label: t('workspace.rail.menu.focus'), shortcut: enterKey(ctx.mac) },
    moveEntry('move', ctx.targets, t),
    { id: 'detach', label: t(`${A}moveOut`), disabled: ctx.alone },
    ...(ctx.compact ? [{ separator: true } as MenuEntry, ...compactEntry(ctx.compact, t)] : []),
    { separator: true },
    { id: 'close-pane', label: t(`${A}closePane`) },
  ]
}

export function menuPick(id: string): { action: string; target: string | null } {
  const at = id.indexOf(':')
  return at < 0 ? { action: id, target: null } : { action: id.slice(0, at), target: id.slice(at + 1) || null }
}
