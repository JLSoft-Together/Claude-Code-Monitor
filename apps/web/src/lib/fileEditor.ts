import { desktop } from './desktop'
import type { FileView } from './preview'

/** v42 editor limits (plan): bigger files stay view only. */
export const MAX_EDIT_BYTES = 2 * 1024 * 1024
export const MAX_EDIT_LINES = 50_000

export type EditBlock = 'large' | 'lines' | 'encoding' | 'kind' | 'unavailable'

/** Why a viewed file cannot be edited; null = editable. */
export function editBlock(view: FileView | null, lineCount: number, canWrite: boolean): EditBlock | null {
  if (!canWrite) return 'unavailable'
  if (!view || view.kind !== 'text') return 'kind'
  if (view.invalidUtf8) return 'encoding'
  if (view.size > MAX_EDIT_BYTES) return 'large'
  if (lineCount > MAX_EDIT_LINES) return 'lines'
  return null
}

export type DiskChange = 'ignore' | 'reload' | 'conflict'

/**
 * What a watcher event means for an open editor: our own save echoes back with the mtime we stored (ignore),
 * a clean buffer follows the disk (reload), unsaved edits are never overwritten (conflict notice).
 */
export function diskChangeAction(next: Pick<FileView, 'kind' | 'mtimeMs'> | null, knownMtime: number | null, dirty: boolean): DiskChange {
  if (!next) return 'ignore'
  if (next.kind === 'text' && knownMtime !== null && Math.abs(next.mtimeMs - knownMtime) < 0.5) return 'ignore'
  return dirty ? 'conflict' : 'reload'
}

const plain = (e: KeyboardEvent): boolean => !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey

/** `E` on a focused viewer (not while typing anywhere) enters edit mode. */
export const isEditKey = (e: KeyboardEvent): boolean => plain(e) && (e.code === 'KeyE' || e.key === 'e' || e.key === 'E')

export const isSaveKey = (e: KeyboardEvent, mac: boolean): boolean =>
  (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) && !e.altKey && !e.shiftKey && e.code === 'KeyS'

/**
 * Workspace chords the editor keeps while it has focus. Alt+↑/↓ move the current line (VS Code / CodeMirror);
 * Alt+←/→ still move pane focus, every other chord (tabs, split, close, quick open) still reaches the workspace.
 */
export function editorKeepsKey(e: KeyboardEvent, mac: boolean): boolean {
  if (mac) return false
  return e.altKey && !e.ctrlKey && !e.metaKey && (e.code === 'ArrowUp' || e.code === 'ArrowDown')
}

export const inEditor = (target: EventTarget | null): boolean => !!(target as Element | null)?.closest?.('.cm-editor')

/** Dirty file panes the main process lists in its quit dialog. */
export interface DirtyFile {
  name: string
  path: string
}

interface EditorBridge {
  editorDirty?: (files: DirtyFile[]) => void
  onEditorSaveAll?: (handler: () => Promise<boolean>) => void
}

const bridge = desktop as unknown as EditorBridge | undefined

export const reportDirty = (files: DirtyFile[]): void => bridge?.editorDirty?.(files)
export const onSaveAllRequest = (handler: () => Promise<boolean>): void => bridge?.onEditorSaveAll?.(handler)
