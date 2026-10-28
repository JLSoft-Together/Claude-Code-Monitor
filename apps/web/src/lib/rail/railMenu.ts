import { compactEntry, type CompactState } from '../compactHandoff'
import type { MenuEntry } from '../menu'

const M = 'workspace.rail.menu.'

export const NEW_CHOICES = ['claude', 'codex', 'shell', 'browser'] as const
export type NewChoice = (typeof NEW_CHOICES)[number]

export interface ProjectMenuCtx {
  mac: boolean
  /** Folder the menu acts on (checkout path, else the header's); null = Home cluster or unknown. */
  dir: string | null
  home: boolean
  /** Has open tabs (not only remembered). */
  live: boolean
  /** A pane of this checkout can anchor the Explorer / Mission Control. */
  anchored: boolean
  viewers: { file: boolean; changes: boolean; log: boolean }
  scripts: boolean
  run: boolean
  /** null: no layouts bridge. */
  layouts: Array<{ id: string; name: string; openOnStart?: boolean }> | null
  explorer: boolean
  /** Desktop `ccm:reveal` exists (OS file manager). */
  reveal: boolean
  canUp: boolean
  canDown: boolean
  collapsed: boolean
}

type T = (key: string, params?: Record<string, unknown>) => string

/** Header / checkout line menu; ids: `new:<choice|file|changes|log>`, `layout:<id>`, plain ids otherwise. */
export function projectMenu(ctx: ProjectMenuCtx, t: T): MenuEntry[] {
  const noDir = !ctx.dir
  const newKids: MenuEntry[] = NEW_CHOICES.map((c) => ({ id: `new:${c}`, label: t(c === 'browser' ? 'workspace.open.browser' : `workspace.preset.${c}`) }))
  if (ctx.viewers.file) newKids.push({ id: 'new:file', label: t('workspace.open.openFile') })
  if (ctx.viewers.changes && ctx.dir) newKids.push({ id: 'new:changes', label: t('workspace.open.changes') })
  if (ctx.viewers.log && ctx.dir) newKids.push({ id: 'new:log', label: t('workspace.log.open') })
  const entries: MenuEntry[] = []
  if (ctx.dir || ctx.home) entries.push({ id: 'new', label: t(`${M}newTab`), children: newKids })
  if (ctx.run && ctx.dir) entries.push({ id: 'run', label: t('run.open') })
  if (ctx.scripts && ctx.dir) entries.push({ id: 'scripts', label: t('workspace.scripts.open') })
  if (ctx.explorer && ctx.dir) entries.push({ id: 'plan', label: t('workspace.plan.open') })
  if (ctx.layouts && ctx.dir) {
    const kids: MenuEntry[] = [{ id: 'layout-save', label: t('workspace.layouts.save') }]
    if (ctx.layouts.length) kids.push({ id: 'layout-manage', label: t('workspace.layouts.manage') }, { separator: true })
    for (const l of ctx.layouts) kids.push({ id: `layout:${l.id}`, label: l.name, hint: l.openOnStart ? t('workspace.layouts.onStart') : undefined })
    entries.push({ id: 'layouts', label: t(`${M}layouts`), children: kids })
  }
  if (entries.length) entries.push({ separator: true })
  const unanchored = ctx.anchored ? undefined : t(`${M}noPane`)
  if (ctx.explorer) entries.push({ id: 'explorer', label: t(`${M}showExplorer`), disabled: !ctx.anchored || noDir, hint: unanchored })
  entries.push({ id: 'mission', label: t(`${M}mission`), shortcut: ctx.mac ? '⇧⌘O' : 'Ctrl+Shift+O', disabled: !ctx.live })
  entries.push({ id: 'copy-path', label: t(`${M}copyPath`), disabled: noDir })
  if (ctx.reveal) entries.push({ id: 'reveal', label: t(`${M}${ctx.mac ? 'finder' : 'fileManager'}`), disabled: noDir })
  entries.push(
    { separator: true },
    { id: 'move-up', label: t(`${M}moveUp`), shortcut: ctx.mac ? '⌥↑' : 'Alt+↑', disabled: !ctx.canUp },
    { id: 'move-down', label: t(`${M}moveDown`), shortcut: ctx.mac ? '⌥↓' : 'Alt+↓', disabled: !ctx.canDown },
    { id: 'toggle', label: t(`${M}${ctx.collapsed ? 'expand' : 'collapse'}`), shortcut: ctx.collapsed ? '→' : '←' },
    { separator: true },
  )
  if (ctx.live) entries.push({ id: 'close-project', label: t('workspace.rail.closeProject') })
  else entries.push({ id: 'forget', label: t(`${M}forget`) })
  return entries
}

export interface RowMenuCtx {
  /** Row stands for a whole tab without agent / run panes (✕ closes the tab). */
  tabRow: boolean
  cwd: string | null
  explorer: boolean
  /** Agent row: offers "Show session in Monitor". */
  agent: boolean
  /** Linked monitor terminal (agent process seen by the collector). */
  linked: boolean
  /** Other panes in the same tab. */
  others: number
  targets: Array<{ key: string; title: string }>
  compact?: CompactState | null
}

const splitKids = (dir: 'row' | 'col', t: T): MenuEntry[] =>
  NEW_CHOICES.map((c) => ({ id: `split:${dir}:${c}`, label: t(c === 'browser' ? 'workspace.open.browser' : `workspace.preset.${c}`) }))

/** Session / pane row menu; split ids `split:<row|col>:<choice>`. */
export function rowMenu(ctx: RowMenuCtx, t: T): MenuEntry[] {
  const entries: MenuEntry[] = [
    { id: 'focus', label: t(`${M}focus`) },
    { separator: true },
    { id: 'split-right', label: t(`${M}splitRight`), children: splitKids('row', t) },
    { id: 'split-down', label: t(`${M}splitDown`), children: splitKids('col', t) },
    { separator: true },
    { id: 'rename-tab', label: t('workspace.railGroup.renameTab'), shortcut: 'F2' },
    {
      id: 'move-to',
      label: t('workspace.tabActions.moveTo'),
      disabled: !ctx.targets.length,
      hint: ctx.targets.length ? undefined : t('workspace.tabActions.noTargets'),
      children: ctx.targets.length ? ctx.targets.map((x) => ({ id: `move-to:${x.key}`, label: x.title })) : undefined,
    },
    { id: 'move-out', label: t('workspace.tabActions.moveOut'), disabled: ctx.tabRow || ctx.others === 0 },
    { separator: true },
    { id: 'copy-cwd', label: t(`${M}copyCwd`), disabled: !ctx.cwd },
  ]
  if (ctx.explorer) entries.push({ id: 'explorer', label: t(`${M}showExplorer`), disabled: !ctx.cwd })
  if (ctx.agent) entries.push({ id: 'monitor', label: t(`${M}showInMonitor`), disabled: !ctx.linked, hint: ctx.linked ? undefined : t(`${M}notLinked`) })
  const compact = compactEntry(ctx.compact, t)
  if (compact.length) entries.push({ separator: true }, ...compact)
  entries.push(
    { separator: true },
    { id: 'close', label: t(`${M}${ctx.tabRow ? 'closeTab' : 'close'}`) },
    { id: 'close-others', label: t(`${M}closeOthers`), disabled: ctx.tabRow || ctx.others === 0 },
  )
  return entries
}

export function groupMenu(ctx: { folded: boolean }, t: T): MenuEntry[] {
  return [
    { id: 'open', label: t('workspace.tabActions.open') },
    { id: 'rename', label: t('workspace.tabActions.rename'), shortcut: 'F2' },
    ctx.folded ? { id: 'unfold', label: t('workspace.tabActions.unfold'), shortcut: '→' } : { id: 'fold', label: t('workspace.tabActions.fold'), shortcut: '←' },
    { id: 'ungroup', label: t('workspace.tabActions.ungroup') },
    { separator: true },
    { id: 'close', label: t('workspace.tabActions.close') },
  ]
}

/** Right-click on the rail's empty space. */
export function emptyMenu(ctx: { open: boolean; any: boolean }, t: T): MenuEntry[] {
  const entries: MenuEntry[] = []
  if (ctx.open) entries.push({ id: 'open-project', label: t('workspace.rail.openProject') })
  if (ctx.any) {
    if (entries.length) entries.push({ separator: true })
    entries.push({ id: 'collapse-all', label: t(`${M}collapseAll`) }, { id: 'expand-all', label: t(`${M}expandAll`) })
  }
  return entries
}

/** ContextMenu / Shift+F10 opens the rail menu on the focused header, checkout line or row. */
export const isMenuKey = (e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>): boolean =>
  !e.ctrlKey && !e.altKey && !e.metaKey && ((e.key === 'ContextMenu' && !e.shiftKey) || (e.key === 'F10' && e.shiftKey))
