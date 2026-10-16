import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'

function subscribe(channel: string, handler: (payload: unknown) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: unknown): void => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

// Sandboxed preload: only this narrow surface reaches the page. The main process re-checks the caller's origin.
contextBridge.exposeInMainWorld('ccmDesktop', {
  platform: process.platform,
  ptyEndpoint: (): Promise<unknown> => ipcRenderer.invoke('ccm:pty-endpoint'),
  pickFolder: (near?: string): Promise<unknown> => ipcRenderer.invoke('ccm:pick-folder', near),
  setWindowBackground: (color: string): Promise<unknown> => ipcRenderer.invoke('ccm:window-bg', color),
  setAppearance: (look: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:appearance', look),
  zoomApp: (action: 'in' | 'out' | 'reset' | 'get'): Promise<unknown> => ipcRenderer.invoke('ccm:zoom', action),
  loginItem: (on?: boolean): Promise<unknown> => ipcRenderer.invoke('ccm:login-item', on),
  statusLineState: (): Promise<unknown> => ipcRenderer.invoke('ccm:statusline-state'),
  enableStatusLine: (): Promise<unknown> => ipcRenderer.invoke('ccm:statusline-enable'),
  grantFolder: (): Promise<unknown> => ipcRenderer.invoke('ccm:grant-folder'),
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
  onPaneOpen: (handler: (req: unknown) => unknown): void => {
    ipcRenderer.on('ccm:pane-open', (_event, req: unknown) => {
      const id = typeof req === 'object' && req !== null && typeof (req as { id?: unknown }).id === 'string' ? (req as { id: string }).id : null
      if (id === null) return
      const reply = (result: unknown): void => {
        try {
          ipcRenderer.send('ccm:pane-open-reply', id, result)
        } catch {
          ipcRenderer.send('ccm:pane-open-reply', id, { ok: false, error: 'failed' })
        }
      }
      void Promise.resolve()
        .then(() => handler(req))
        .then(reply, () => reply({ ok: false, error: 'failed' }))
    })
  },
  previewUrl: (path: string): Promise<unknown> => ipcRenderer.invoke('ccm:preview-url', path),
  readFile: (path: string): Promise<unknown> => ipcRenderer.invoke('ccm:read-file', path),
  fileWrite: (req: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:file-write', req),
  editorDirty: (files: unknown): void => ipcRenderer.send('ccm:editor-dirty', files),
  /** Quit → "Save": the page saves every unsaved editor and answers whether all of them made it. */
  onEditorSaveAll: (handler: () => Promise<boolean>): void => {
    ipcRenderer.on('ccm:editor-save-all', (_event, id: unknown) => {
      void handler().then(
        (ok) => ipcRenderer.send('ccm:editor-save-reply', id, ok === true),
        () => ipcRenderer.send('ccm:editor-save-reply', id, false),
      )
    })
  },
  watch: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:watch', root),
  unwatch: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:unwatch', root),
  pickFile: (kind: 'html' | 'any', near?: string): Promise<unknown> => ipcRenderer.invoke('ccm:pick-file', kind, near),
  openExternal: (url: string): Promise<unknown> => ipcRenderer.invoke('ccm:open-external', url),
  reveal: (path: string): Promise<unknown> => ipcRenderer.invoke('ccm:reveal', path),
  openPath: (path: string): Promise<unknown> => ipcRenderer.invoke('ccm:open-path', path),
  requestAccess: (path: string): Promise<unknown> => ipcRenderer.invoke('ccm:request-access', path),
  forgetGrants: (): Promise<unknown> => ipcRenderer.invoke('ccm:forget-grants'),
  fullAccess: (on?: boolean | 'first'): Promise<unknown> => ipcRenderer.invoke('ccm:full-access', on),
  onPreviewChanged: (handler: (change: unknown) => void): (() => void) => subscribe('ccm:preview-changed', handler),
  changesStatus: (dir: string): Promise<unknown> => ipcRenderer.invoke('ccm:changes-status', dir),
  changesDiff: (root: string, path: string, opts?: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:changes-diff', { root, path, opts }),
  changesFile: (path: string): Promise<unknown> => ipcRenderer.invoke('ccm:changes-file', path),
  logRefs: (dir: string): Promise<unknown> => ipcRenderer.invoke('ccm:log-refs', dir),
  logPage: (root: string, query: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:log-page', { root, query }),
  logCommit: (root: string, hash: string): Promise<unknown> => ipcRenderer.invoke('ccm:log-commit', { root, hash }),
  logContains: (root: string, hash: string): Promise<unknown> => ipcRenderer.invoke('ccm:log-contains', { root, hash }),
  logDiff: (root: string, hash: string, path: string, opts?: unknown, origPath?: string): Promise<unknown> =>
    ipcRenderer.invoke('ccm:log-diff', { root, hash, path, opts, origPath }),
  gitBranchCreate: (root: string, name: string, base: string, checkout: boolean): Promise<unknown> => ipcRenderer.invoke('ccm:git-branch-create', { root, name, base, checkout }),
  gitBranchDelete: (root: string, ref: string): Promise<unknown> => ipcRenderer.invoke('ccm:git-branch-delete', { root, ref }),
  gitFetch: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:git-fetch', root),
  gitBranchUpdate: (root: string, ref: string): Promise<unknown> => ipcRenderer.invoke('ccm:git-branch-update', { root, ref }),
  // `hunk` stays undefined (not null) for a whole-file discard: the handler branches on `hunk !== undefined`.
  changesDiscard: (root: string, path: string, hunk?: string): Promise<unknown> => ipcRenderer.invoke('ccm:changes-discard', { root, path, hunk }),
  changesWatch: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:changes-watch', root),
  changesUnwatch: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:changes-unwatch', root),
  onChangesUpdated: (handler: (change: unknown) => void): (() => void) => subscribe('ccm:changes-updated', handler),
  listFiles: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:list-files', root),
  listDir: (root: string, dir: string): Promise<unknown> => ipcRenderer.invoke('ccm:list-dir', { root, dir }),
  createEntry: (root: string, parent: string, name: string, kind: 'file' | 'directory'): Promise<unknown> =>
    ipcRenderer.invoke('ccm:create-entry', { root, parent, name, kind }),
  renameEntry: (root: string, path: string, name: string): Promise<unknown> => ipcRenderer.invoke('ccm:rename-entry', { root, path, name }),
  trashEntry: (root: string, path: string): Promise<unknown> => ipcRenderer.invoke('ccm:trash-entry', { root, path }),
  clipboardImage: (pngDataUrl: string): Promise<unknown> => ipcRenderer.invoke('ccm:clipboard-image', pngDataUrl),
  clipboardImageFile: (file: string): Promise<unknown> => ipcRenderer.invoke('ccm:clipboard-image-file', file),
  pickFiles: (): Promise<unknown> => ipcRenderer.invoke('ccm:pick-files'),
  // Dropped File → absolute path (File.path is gone since Electron 32); '' for files that have none.
  pathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },
  captureGuest: (webContentsId: number): Promise<unknown> => ipcRenderer.invoke('ccm:capture-guest', webContentsId),
  captureRect: (rect: { x: number; y: number; width: number; height: number }): Promise<unknown> => ipcRenderer.invoke('ccm:capture-rect', rect),
  projectRoot: (dir: string, remembered?: boolean): Promise<unknown> => ipcRenderer.invoke('ccm:project-root', dir, remembered === true),
  scripts: (dir: string): Promise<unknown> => ipcRenderer.invoke('ccm:scripts', dir),
  layoutsList: (project: string): Promise<unknown> => ipcRenderer.invoke('ccm:layouts-list', project),
  layoutsSave: (layout: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:layouts-save', layout),
  layoutsDelete: (project: string, id: string): Promise<unknown> => ipcRenderer.invoke('ccm:layouts-delete', project, id),
  layoutsStart: (project: string, id: string | null): Promise<unknown> => ipcRenderer.invoke('ccm:layouts-start', project, id),
  extStatus: (dir?: string): Promise<unknown> => ipcRenderer.invoke('ccm:ext-status', dir),
  extMcp: (dir?: string, fresh?: boolean): Promise<unknown> => ipcRenderer.invoke('ccm:ext-mcp', dir, fresh),
  extInstall: (req: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:ext-install', req),
  extRemove: (req: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:ext-remove', req),
  extSource: (req: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:ext-source', req),
  extLogin: (name: string, dir?: string): Promise<unknown> => ipcRenderer.invoke('ccm:ext-login', name, dir),
  runDetect: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:run-detect', root),
  runEnv: (dir: string, kind: 'flutter' | 'android'): Promise<unknown> => ipcRenderer.invoke('ccm:run-env', dir, kind),
  runDevices: (): Promise<unknown> => ipcRenderer.invoke('ccm:run-devices'),
  runEmulators: (): Promise<unknown> => ipcRenderer.invoke('ccm:run-emulators'),
  runLaunchEmulator: (id: string, source: 'flutter' | 'adb'): Promise<unknown> => ipcRenderer.invoke('ccm:run-launch-emulator', id, source),
  runConfigs: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:run-configs', root),
  runConfigSave: (root: string, cfg: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:run-config-save', root, cfg),
  runConfigDelete: (root: string, id: string): Promise<unknown> => ipcRenderer.invoke('ccm:run-config-delete', root, id),
  runConfigImport: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:run-config-import', root),
  runPreview: (root: string, cfg: unknown, deviceId: string | null): Promise<unknown> => ipcRenderer.invoke('ccm:run-preview', root, cfg, deviceId),
  runStart: (req: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:run-start', req),
  runStop: (sessionId: string): Promise<unknown> => ipcRenderer.invoke('ccm:run-stop', sessionId),
  runReload: (sessionId: string, full: boolean): Promise<unknown> => ipcRenderer.invoke('ccm:run-reload', sessionId, full),
  runPubGet: (dir: string): Promise<unknown> => ipcRenderer.invoke('ccm:run-pub-get', dir),
  runSessions: (): Promise<unknown> => ipcRenderer.invoke('ccm:run-sessions'),
  runSettings: (): Promise<unknown> => ipcRenderer.invoke('ccm:run-settings'),
  runSettingsSet: (next: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:run-settings-set', next),
  runHold: (root: string, key: string, on: boolean): Promise<unknown> => ipcRenderer.invoke('ccm:run-hold', root, key, on),
  runConfigAutoImport: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:run-config-auto-import', root),
  runToolchain: (dir: string, kind: 'flutter' | 'android'): Promise<unknown> => ipcRenderer.invoke('ccm:run-toolchain', dir, kind),
  runTemplates: (): Promise<unknown> => ipcRenderer.invoke('ccm:run-templates'),
  runTemplatesSet: (next: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:run-templates-set', next),
  runProjectSdkSet: (dir: string, sdk: string | null): Promise<unknown> => ipcRenderer.invoke('ccm:run-project-sdk-set', dir, sdk),
  onRunEvent: (handler: (event: unknown) => void): (() => void) => subscribe('ccm:run-event', handler),
  layoutStatus: (): Promise<unknown> => ipcRenderer.invoke('ccm:layout-status'),
  layoutDownload: (): Promise<unknown> => ipcRenderer.invoke('ccm:layout-download'),
  layoutRender: (req: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:layout-render', req),
  layoutModelStatus: (req: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:layout-model-status', req),
  layoutModelRefresh: (req: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:layout-model-refresh', req),
  layoutModelPick: (req: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:layout-model-pick', req),
  layoutWarmup: (req: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:layout-warmup', req),
  drawableRender: (req: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:drawable-render', req),
  onLayoutEvent: (handler: (event: unknown) => void): (() => void) => subscribe('ccm:layout-event', handler),
  fwpScan: (path: string, withEntries?: boolean): Promise<unknown> => ipcRenderer.invoke('ccm:fwp-scan', path, withEntries !== false),
  fwpStart: (root: string, deviceId: string, flavor?: string | null): Promise<unknown> => ipcRenderer.invoke('ccm:fwp-start', root, deviceId, flavor ?? null),
  fwpShow: (id: string): Promise<unknown> => ipcRenderer.invoke('ccm:fwp-show', id),
  fwpStop: (): Promise<unknown> => ipcRenderer.invoke('ccm:fwp-stop'),
  fwpGet: (): Promise<unknown> => ipcRenderer.invoke('ccm:fwp-get'),
  onFwpState: (handler: (snapshot: unknown) => void): (() => void) => subscribe('ccm:fwp-state', handler),
  /** Workspace chords pressed while a <webview> guest has focus; the page re-dispatches them. */
  onForwardKey: (handler: (key: unknown) => void): (() => void) => subscribe('ccm:forward-key', handler),
})
