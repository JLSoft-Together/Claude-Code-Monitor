import type { MenuEntry } from '../menu'
import type { TreeRow } from './tree'

export type ExplorerAction =
  | 'new-file'
  | 'new-folder'
  | 'copy-abs'
  | 'copy-rel'
  | 'copy-name'
  | 'rename'
  | 'trash'
  | 'open-split'
  | 'reveal'
  | 'terminal'
  | 'run'
  | 'show-diff'
  | 'reload'
  | 'compare-select'
  | 'compare-clear'
  | 'compare-with'
  | 'compare-clipboard'
  | 'apk-size'

export interface ExplorerMenuCtx {
  mac: boolean
  /** The project is a git repo: the Git submenu shows. */
  repo: boolean
  /** The row is a changed file: Show Diff is enabled. */
  changed: boolean
  /** The Run pane exists (desktop `runDetect`): "Run…" shows on runnable rows. */
  run?: boolean
  /** Files can be read for a compare: the Compare group shows on file rows, `selected` = file picked first. */
  compare?: { selected: { path: string; name: string } | null; self: boolean }
  /** The APK / AAB size analyzer exists (desktop `apkAnalyze`): "Analyze size" shows on .apk / .aab rows. */
  apk?: boolean
}

const M = 'workspace.explorer.menu.'

const RUN_FILES = new Set(['pubspec.yaml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'])

/** Rows that offer "Run…", decided by name only (no detect per row): folders and Flutter / Gradle project files. */
export const isRunnableRow = (row: Pick<TreeRow, 'name' | 'directory' | 'depth' | 'outOfRoot'>): boolean =>
  row.depth === 0 || (row.directory && !row.outOfRoot) || RUN_FILES.has(row.name.toLowerCase())

/** Shared run configurations live in `<repo>/.agent-monitor/run/` (v31): renaming or deleting them changes the Run pane's list. */
export const isRunConfigPath = (p: string): boolean => /[\\/]\.agent-monitor[\\/]run(?:[\\/]|$)/i.test(p) || /[\\/]\.agent-monitor$/i.test(p)

/** `.git` itself or anything inside it: git's own data. */
export const isGitDataPath = (p: string): boolean => /[\\/]\.git(?:[\\/]|$)/i.test(p)

/** i18n key of the caveat shown on Rename / Delete for `p`, if it is one the user should think twice about. */
export function riskHintKey(p: string): string | null {
  if (isGitDataPath(p)) return `${M}gitHint`
  return isRunConfigPath(p) ? `${M}runConfigHint` : null
}

/** Row menu: a small subset of Android Studio's Project view menu (see .planning/PLAN-v35-explorer-context-menu.md rulings). */
export function explorerMenu(row: TreeRow, ctx: ExplorerMenuCtx, t: (key: string, params?: Record<string, string>) => string): MenuEntry[] {
  const isRoot = row.depth === 0
  const hintKey = isRoot ? null : riskHintKey(row.path)
  const configHint = hintKey ? t(hintKey) : undefined
  const entries: MenuEntry[] = [
    { id: 'new', label: t(`${M}new`), children: [{ id: 'new-file', label: t(`${M}newFile`) }, { id: 'new-folder', label: t(`${M}newFolder`) }] },
    { separator: true },
    {
      id: 'copy-ref',
      label: t(`${M}copyRef`),
      children: [{ id: 'copy-abs', label: t(`${M}copyAbs`) }, { id: 'copy-rel', label: t(`${M}copyRel`) }, { id: 'copy-name', label: t(`${M}copyName`) }],
    },
    { separator: true },
    { id: 'rename', label: t(`${M}rename`), shortcut: ctx.mac ? '⇧F6' : 'Shift+F6', disabled: isRoot, hint: configHint },
    { id: 'trash', label: t(`${M}trash`), shortcut: ctx.mac ? '⌘⌫' : 'Delete', disabled: isRoot, hint: configHint },
    { separator: true },
    { id: 'open-split', label: t(`${M}openSplit`), shortcut: ctx.mac ? '⇧↩' : 'Shift+Enter', disabled: row.directory || row.outOfRoot },
    { id: 'open-in', label: t(`${M}openIn`), children: [{ id: 'reveal', label: t(`${M}${ctx.mac ? 'finder' : 'explorer'}`) }, { id: 'terminal', label: t(`${M}terminal`) }] },
  ]
  if (ctx.run && isRunnableRow(row)) entries.push({ id: 'run', label: t(`${M}run`) })
  if (ctx.apk && !row.directory && /\.(apk|aab)$/i.test(row.name)) entries.push({ id: 'apk-size', label: t('apkSize.menu') })
  if (ctx.compare && !row.directory) {
    const { selected, self } = ctx.compare
    entries.push({ separator: true }, self ? { id: 'compare-clear', label: t(`${M}compareClear`) } : { id: 'compare-select', label: t(`${M}compareSelect`) })
    if (selected && !self) entries.push({ id: 'compare-with', label: t(`${M}compareWith`, { name: selected.name }) })
    entries.push({ id: 'compare-clipboard', label: t(`${M}compareClipboard`) })
  }
  if (ctx.repo) {
    entries.push({ separator: true }, { id: 'git', label: t(`${M}git`), children: [{ id: 'show-diff', label: t(`${M}showDiff`), shortcut: ctx.mac ? '⌥⌘D' : 'Ctrl+D', disabled: !ctx.changed }] })
  }
  entries.push({ separator: true }, { id: 'reload', label: t(`${M}reload`) })
  return entries
}

export type ExplorerKey = 'rename' | 'trash' | 'open-split' | 'menu'

/** Tree shortcuts (JetBrains keymap): Shift+F6 rename, Delete (⌘⌫ on macOS) delete, Shift+Enter right split, ContextMenu / Shift+F10 menu. */
export function explorerKey(e: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>, mac: boolean): ExplorerKey | null {
  const noMods = !e.ctrlKey && !e.altKey && !e.metaKey
  if (e.key === 'F6' && e.shiftKey && noMods) return 'rename'
  if (mac ? e.key === 'Backspace' && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey : e.key === 'Delete' && noMods && !e.shiftKey) return 'trash'
  if (e.key === 'Enter' && e.shiftKey && noMods) return 'open-split'
  if ((e.key === 'ContextMenu' && noMods && !e.shiftKey) || (e.key === 'F10' && e.shiftKey && noMods)) return 'menu'
  return null
}
