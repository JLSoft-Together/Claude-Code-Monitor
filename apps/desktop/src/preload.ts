import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

function subscribe(channel: string, handler: (payload: unknown) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: unknown): void => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

// Sandboxed preload: only this narrow surface reaches the page. The main process re-checks the caller's origin.
contextBridge.exposeInMainWorld('ccmDesktop', {
  platform: process.platform,
  ptyEndpoint: (): Promise<unknown> => ipcRenderer.invoke('ccm:pty-endpoint'),
  pickFolder: (): Promise<unknown> => ipcRenderer.invoke('ccm:pick-folder'),
  logs: (action: 'copy' | 'save', report: string): Promise<unknown> => ipcRenderer.invoke('ccm:logs', action, report),
  /** Toast click: the page answers whether a workspace pane holds that session. */
  onFocus: (handler: (terminalId: string) => boolean): void => {
    ipcRenderer.on('ccm:focus', (_event, terminalId: unknown) => {
      ipcRenderer.send('ccm:focus-reply', typeof terminalId === 'string' && handler(terminalId))
    })
  },
  onSelect: (handler: (terminalId: string) => void): void => {
    ipcRenderer.on('ccm:select', (_event, terminalId: unknown) => {
      if (typeof terminalId === 'string') handler(terminalId)
    })
  },
  previewUrl: (path: string): Promise<unknown> => ipcRenderer.invoke('ccm:preview-url', path),
  readFile: (path: string): Promise<unknown> => ipcRenderer.invoke('ccm:read-file', path),
  watch: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:watch', root),
  unwatch: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:unwatch', root),
  pickFile: (kind: 'html' | 'any'): Promise<unknown> => ipcRenderer.invoke('ccm:pick-file', kind),
  openExternal: (url: string): Promise<unknown> => ipcRenderer.invoke('ccm:open-external', url),
  reveal: (path: string): Promise<unknown> => ipcRenderer.invoke('ccm:reveal', path),
  openPath: (path: string): Promise<unknown> => ipcRenderer.invoke('ccm:open-path', path),
  requestAccess: (path: string): Promise<unknown> => ipcRenderer.invoke('ccm:request-access', path),
  forgetGrants: (): Promise<unknown> => ipcRenderer.invoke('ccm:forget-grants'),
  onPreviewChanged: (handler: (change: unknown) => void): (() => void) => subscribe('ccm:preview-changed', handler),
  changesStatus: (dir: string): Promise<unknown> => ipcRenderer.invoke('ccm:changes-status', dir),
  changesDiff: (root: string, path: string): Promise<unknown> => ipcRenderer.invoke('ccm:changes-diff', { root, path }),
  // `hunk` stays undefined (not null) for a whole-file discard: the handler branches on `hunk !== undefined`.
  changesDiscard: (root: string, path: string, hunk?: string): Promise<unknown> => ipcRenderer.invoke('ccm:changes-discard', { root, path, hunk }),
  changesWatch: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:changes-watch', root),
  changesUnwatch: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:changes-unwatch', root),
  onChangesUpdated: (handler: (change: unknown) => void): (() => void) => subscribe('ccm:changes-updated', handler),
  listFiles: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:list-files', root),
  clipboardImage: (pngDataUrl: string): Promise<unknown> => ipcRenderer.invoke('ccm:clipboard-image', pngDataUrl),
  captureGuest: (webContentsId: number): Promise<unknown> => ipcRenderer.invoke('ccm:capture-guest', webContentsId),
  /** Workspace chords pressed while a <webview> guest has focus; the page re-dispatches them. */
  onForwardKey: (handler: (key: unknown) => void): (() => void) => subscribe('ccm:forward-key', handler),
})
