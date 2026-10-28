import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'

function subscribe(channel: string, handler: (payload: unknown) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: unknown): void => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

// Sandboxed preload: only this narrow surface reaches the page. The main process re-checks the caller's origin.
contextBridge.exposeInMainWorld('ccmDesktop', {
  platform: process.platform,
  titleBar: process.platform === 'darwin' ? 'mac' : 'overlay',
  ptyEndpoint: (): Promise<unknown> => ipcRenderer.invoke('ccm:pty-endpoint'),
  pickFolder: (near?: string): Promise<unknown> => ipcRenderer.invoke('ccm:pick-folder', near),
  setWindowBackground: (color: string): Promise<unknown> => ipcRenderer.invoke('ccm:window-bg', color),
  setAppearance: (look: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:appearance', look),
  zoomApp: (action: 'in' | 'out' | 'reset' | 'get'): Promise<unknown> => ipcRenderer.invoke('ccm:zoom', action),
  loginItem: (on?: boolean): Promise<unknown> => ipcRenderer.invoke('ccm:login-item', on),
  statusLineState: (): Promise<unknown> => ipcRenderer.invoke('ccm:statusline-state'),
  enableStatusLine: (): Promise<unknown> => ipcRenderer.invoke('ccm:statusline-enable'),
  hooksState: (): Promise<unknown> => ipcRenderer.invoke('ccm:hooks-state'),
  setHooks: (on: boolean): Promise<unknown> => ipcRenderer.invoke('ccm:hooks-set', on),
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
  editorDirty: (files: unknown, autoSave?: boolean): void => ipcRenderer.send('ccm:editor-dirty', files, autoSave === true),
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
  search: (dir: string, query: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:search', { dir, query }),
  gitStage: (root: string, paths: string[], hunk?: string): Promise<unknown> => ipcRenderer.invoke('ccm:git-stage', { root, paths, hunk }),
  gitUnstage: (root: string, paths: string[]): Promise<unknown> => ipcRenderer.invoke('ccm:git-unstage', { root, paths }),
  gitCanAmend: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:git-can-amend', root),
  gitCommit: (root: string, message: string, amend: boolean): Promise<unknown> => ipcRenderer.invoke('ccm:git-commit', { root, message, amend }),
  gitCommitCancel: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:git-commit-cancel', root),
  checkRun: (dir: string, check: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:check-run', { dir, check }),
  checkCancel: (dir: string): Promise<unknown> => ipcRenderer.invoke('ccm:check-cancel', dir),
  wtCompare: (dir: string, branch: string): Promise<unknown> => ipcRenderer.invoke('ccm:wt-compare', { dir, branch }),
  wtMerge: (dir: string, branch: string, mode: 'ff' | 'squash', keep?: boolean): Promise<unknown> => ipcRenderer.invoke('ccm:wt-merge', { dir, branch, mode, keep }),
  mergeState: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:git-merge-state', root),
  wtDiff: (dir: string, a: string, b: string): Promise<unknown> => ipcRenderer.invoke('ccm:wt-diff', { dir, a, b }),
  wtFileDiff: (dir: string, a: string, b: string, path: string): Promise<unknown> => ipcRenderer.invoke('ccm:wt-file-diff', { dir, a, b, path }),
  wtTake: (dir: string, from: string, path: string): Promise<unknown> => ipcRenderer.invoke('ccm:wt-take', { dir, from, path }),
  overlapFiles: (dir: string): Promise<unknown> => ipcRenderer.invoke('ccm:overlap-files', dir),
  overlapDryRun: (dir: string, a: string, b: string): Promise<unknown> => ipcRenderer.invoke('ccm:overlap-dryrun', { dir, a, b }),
  mergeAbort: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:git-merge-abort', root),
  gitBlame: (file: string): Promise<unknown> => ipcRenderer.invoke('ccm:git-blame', file),
  commandsList: (dir: string): Promise<unknown> => ipcRenderer.invoke('ccm:commands-list', dir),
  notesRead: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:notes-read', root),
  notesWrite: (root: string, text: string): Promise<unknown> => ipcRenderer.invoke('ccm:notes-write', { root, text }),
  cpState: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:cp-state', root),
  cpSet: (root: string, on: boolean): Promise<unknown> => ipcRenderer.invoke('ccm:cp-set', { root, on }),
  cpTake: (root: string, label: string): Promise<unknown> => ipcRenderer.invoke('ccm:cp-take', { root, label }),
  cpDiff: (root: string, id: string, to?: string): Promise<unknown> => ipcRenderer.invoke('ccm:cp-diff', { root, id, to }),
  cpFileDiff: (root: string, from: string, to: string, path: string): Promise<unknown> => ipcRenderer.invoke('ccm:cp-file-diff', { root, from, to, path }),
  cpRevertHunk: (root: string, path: string, patch: string): Promise<unknown> => ipcRenderer.invoke('ccm:cp-revert-hunk', { root, path, patch }),
  cpRestore: (root: string, id: string, paths: string[]): Promise<unknown> => ipcRenderer.invoke('ccm:cp-restore', { root, id, paths }),
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
  gitPushPreview: (root: string, ref: string, remote?: string, branch?: string): Promise<unknown> => ipcRenderer.invoke('ccm:git-push-preview', { root, ref, remote, branch }),
  gitPush: (root: string, ref: string, remote: string, branch: string, setUpstream: boolean): Promise<unknown> =>
    ipcRenderer.invoke('ccm:git-push', { root, ref, remote, branch, setUpstream }),
  ghRepoAccount: (root: string, remote: string): Promise<unknown> => ipcRenderer.invoke('ccm:gh-repo-account', { root, remote }),
  ghRepoAccountSet: (root: string, choice: string): Promise<unknown> => ipcRenderer.invoke('ccm:gh-repo-account-set', { root, choice }),
  ghAccounts: (): Promise<unknown> => ipcRenderer.invoke('ccm:gh-accounts'),
  ghAccountAdd: (token: string): Promise<unknown> => ipcRenderer.invoke('ccm:gh-account-add', token),
  ghAccountRemove: (id: string): Promise<unknown> => ipcRenderer.invoke('ccm:gh-account-remove', id),
  ghAccountDefault: (id: string): Promise<unknown> => ipcRenderer.invoke('ccm:gh-account-default', id),
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
  devSnapshot: (): Promise<unknown> => ipcRenderer.invoke('ccm:dev-snapshot'),
  devHold: (on: boolean): Promise<unknown> => ipcRenderer.invoke('ccm:dev-hold', on),
  devConnect: (address: string): Promise<unknown> => ipcRenderer.invoke('ccm:dev-connect', address),
  devPair: (address: string, code: string): Promise<unknown> => ipcRenderer.invoke('ccm:dev-pair', address, code),
  devDisconnect: (ids: string[]): Promise<unknown> => ipcRenderer.invoke('ccm:dev-disconnect', ids),
  devConnectMany: (ids: string[]): Promise<unknown> => ipcRenderer.invoke('ccm:dev-connect-many', ids),
  devToWifi: (id: string): Promise<unknown> => ipcRenderer.invoke('ccm:dev-to-wifi', id),
  devRemove: (ids: string[]): Promise<unknown> => ipcRenderer.invoke('ccm:dev-remove', ids),
  devAlias: (id: string, alias: string | null): Promise<unknown> => ipcRenderer.invoke('ccm:dev-alias', id, alias),
  devAutoConnect: (on: boolean): Promise<unknown> => ipcRenderer.invoke('ccm:dev-auto-connect', on),
  devDiscover: (): Promise<unknown> => ipcRenderer.invoke('ccm:dev-discover'),
  devQrStart: (): Promise<unknown> => ipcRenderer.invoke('ccm:dev-qr-start'),
  devQrCancel: (id: string): Promise<unknown> => ipcRenderer.invoke('ccm:dev-qr-cancel', id),
  onDevEvent: (handler: (event: unknown) => void): (() => void) => subscribe('ccm:dev-event', handler),
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
