import type { IpcMain, IpcMainEvent, WebContents } from 'electron'

/** Unsaved file editors per page (v42); quit asks before dropping them. */
export interface DirtyFile {
  name: string
  path: string
}

export interface EditorTracker {
  files: () => DirtyFile[]
  /** v62: every page holding unsaved editors has auto save on, so quit saves them instead of asking. */
  autoSave: () => boolean
  /** Asks every page holding unsaved editors to save them; true only when all of them did. */
  saveAll: (timeoutMs?: number) => Promise<boolean>
  dispose: () => void
}

const MAX_FILES = 200

export function cleanDirty(raw: unknown): DirtyFile[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, MAX_FILES).flatMap((f): DirtyFile[] => {
    const o = (f ?? {}) as Record<string, unknown>
    return typeof o.path === 'string' && typeof o.name === 'string' ? [{ name: o.name.slice(0, 200), path: o.path.slice(0, 1024) }] : []
  })
}

export function createEditorTracker(deps: { ipcMain: IpcMain; isAppSender: (event: IpcMainEvent) => boolean }): EditorTracker {
  const byPage = new Map<number, { contents: WebContents; files: DirtyFile[]; autoSave: boolean }>()
  let seq = 0
  const pending = new Map<number, (ok: boolean) => void>()

  const onDirty = (event: IpcMainEvent, raw: unknown, autoSave?: unknown): void => {
    if (!deps.isAppSender(event)) return
    const contents = event.sender
    const files = cleanDirty(raw)
    if (!files.length) {
      byPage.delete(contents.id)
      return
    }
    if (!byPage.has(contents.id)) {
      const id = contents.id
      contents.once('destroyed', () => byPage.delete(id))
      contents.on('did-navigate', () => byPage.delete(id))
    }
    byPage.set(contents.id, { contents, files, autoSave: autoSave === true })
  }
  const onReply = (event: IpcMainEvent, id: unknown, ok: unknown): void => {
    if (!deps.isAppSender(event) || typeof id !== 'number') return
    pending.get(id)?.(ok === true)
  }
  deps.ipcMain.on('ccm:editor-dirty', onDirty)
  deps.ipcMain.on('ccm:editor-save-reply', onReply)

  function askPage(contents: WebContents, timeoutMs: number): Promise<boolean> {
    if (contents.isDestroyed()) return Promise.resolve(false)
    const id = ++seq
    return new Promise((resolve) => {
      const timer = setTimeout(() => done(false), timeoutMs)
      const done = (ok: boolean): void => {
        clearTimeout(timer)
        pending.delete(id)
        resolve(ok)
      }
      pending.set(id, done)
      contents.send('ccm:editor-save-all', id)
    })
  }

  return {
    files: () => [...byPage.values()].flatMap((p) => p.files),
    autoSave: () => byPage.size > 0 && [...byPage.values()].every((p) => p.autoSave),
    saveAll: async (timeoutMs = 15_000) => {
      const pages = [...byPage.values()]
      const results = await Promise.all(pages.map((p) => askPage(p.contents, timeoutMs)))
      return results.every(Boolean)
    },
    dispose: () => {
      deps.ipcMain.removeListener('ccm:editor-dirty', onDirty)
      deps.ipcMain.removeListener('ccm:editor-save-reply', onReply)
      for (const done of pending.values()) done(false)
    },
  }
}
