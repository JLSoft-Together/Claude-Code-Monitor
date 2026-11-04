import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'

function subscribe(channel: string, handler: (payload: unknown) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: unknown): void => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

// Owner pause (2026-11-03): without CCM_DEEPSEEK_FEATURE=1 main registers no DeepSeek IPC and the page gets no DeepSeek bridge.
const deepseek =
  ipcRenderer.sendSync('ccm:deepseek-enabled') === true
    ? {
      deepseekStatus: (fresh?: boolean): Promise<unknown> => ipcRenderer.invoke('ccm:deepseek-status', fresh === true),
      deepseekCheckUpdate: (): Promise<unknown> => ipcRenderer.invoke('ccm:deepseek-check-update'),
      deepseekUpdate: (): Promise<unknown> => ipcRenderer.invoke('ccm:deepseek-update'),
      deepseekInstall: (): Promise<unknown> => ipcRenderer.invoke('ccm:deepseek-install'),
      deepseekCancel: (): Promise<unknown> => ipcRenderer.invoke('ccm:deepseek-cancel'),
      deepseekLogin: (key: string): Promise<unknown> => ipcRenderer.invoke('ccm:deepseek-login', key),
      deepseekLogout: (): Promise<unknown> => ipcRenderer.invoke('ccm:deepseek-logout'),
      deepseekTelemetry: (on: boolean): Promise<unknown> => ipcRenderer.invoke('ccm:deepseek-telemetry', on),
      deepseekSync: (): Promise<unknown> => ipcRenderer.invoke('ccm:deepseek-sync'),
      onDeepSeek: (handler: (event: unknown) => void): (() => void) => subscribe('ccm:deepseek-event', handler),
    }
    : {}

// Sandboxed preload: only this narrow surface reaches the page. The main process re-checks the caller's origin.
contextBridge.exposeInMainWorld('ccmDesktop', {
  platform: process.platform,
  titleBar: process.platform === 'darwin' ? 'mac' : 'overlay',
  ptyEndpoint: (): Promise<unknown> => ipcRenderer.invoke('ccm:pty-endpoint'),
  pickFolder: (near?: string): Promise<unknown> => ipcRenderer.invoke('ccm:pick-folder', near),
  setWindowBackground: (color: string): Promise<unknown> => ipcRenderer.invoke('ccm:window-bg', color),
  setAppearance: (look: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:appearance', look),
  setLocale: (locale: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:locale', locale),
  zoomApp: (action: 'in' | 'out' | 'reset' | 'get'): Promise<unknown> => ipcRenderer.invoke('ccm:zoom', action),
  loginItem: (on?: boolean): Promise<unknown> => ipcRenderer.invoke('ccm:login-item', on),
  runState: (): Promise<unknown> => ipcRenderer.invoke('ccm:run-state'),
  dirsExist: (paths: string[]): Promise<unknown> => ipcRenderer.invoke('ccm:dirs-exist', paths),
  promptsExport: (text: string): Promise<unknown> => ipcRenderer.invoke('ccm:prompts-export', text),
  promptsImport: (): Promise<unknown> => ipcRenderer.invoke('ccm:prompts-import'),
  statusLineState: (): Promise<unknown> => ipcRenderer.invoke('ccm:statusline-state'),
  enableStatusLine: (): Promise<unknown> => ipcRenderer.invoke('ccm:statusline-enable'),
  hooksState: (): Promise<unknown> => ipcRenderer.invoke('ccm:hooks-state'),
  setHooks: (on: boolean): Promise<unknown> => ipcRenderer.invoke('ccm:hooks-set', on),
  grantFolder: (): Promise<unknown> => ipcRenderer.invoke('ccm:grant-folder'),
  logs: (action: 'copy' | 'save', report: string): Promise<unknown> => ipcRenderer.invoke('ccm:logs', action, report),
  update: {
    state: (): Promise<unknown> => ipcRenderer.invoke('ccm:update-state'),
    check: (): Promise<unknown> => ipcRenderer.invoke('ccm:update-check'),
    download: (): Promise<unknown> => ipcRenderer.invoke('ccm:update-download'),
    cancel: (): Promise<unknown> => ipcRenderer.invoke('ccm:update-cancel'),
    install: (): Promise<unknown> => ipcRenderer.invoke('ccm:update-install'),
    skip: (version: string): Promise<unknown> => ipcRenderer.invoke('ccm:update-skip', version),
    setAutoCheck: (on: boolean): Promise<unknown> => ipcRenderer.invoke('ccm:update-auto', on),
    openPage: (): Promise<unknown> => ipcRenderer.invoke('ccm:update-page'),
    reveal: (): Promise<unknown> => ipcRenderer.invoke('ccm:update-reveal'),
    onState: (handler: (state: unknown) => void): (() => void) => subscribe('ccm:update-event', handler),
  },
  backup: {
    export: (): Promise<unknown> => ipcRenderer.invoke('ccm:backup-export'),
    pick: (): Promise<unknown> => ipcRenderer.invoke('ccm:backup-pick'),
    apply: (token: string, sections: string[]): Promise<unknown> => ipcRenderer.invoke('ccm:backup-apply', token, sections),
    relaunch: (): Promise<unknown> => ipcRenderer.invoke('ccm:backup-relaunch'),
  },
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
  onTelegramInbound: (() => {
    let current: ((req: unknown) => unknown) | null = null
    ipcRenderer.on('ccm:telegram-inbound', (_event, req: unknown) => {
      const id = typeof req === 'object' && req !== null && typeof (req as { id?: unknown }).id === 'string' ? (req as { id: string }).id : null
      if (id === null) return
      const reply = (result: unknown): void => {
        try {
          ipcRenderer.send('ccm:telegram-inbound-reply', id, result)
        } catch {
          ipcRenderer.send('ccm:telegram-inbound-reply', id, { ok: false, error: 'unavailable' })
        }
      }
      if (!current) return reply({ ok: false, error: 'unavailable' })
      const handler = current
      void Promise.resolve()
        .then(() => handler(req))
        .then(reply, () => reply({ ok: false, error: 'unavailable' }))
    })
    return (handler: (req: unknown) => unknown): void => {
      current = handler
    }
  })(),
  /** v80 MCP tools (notify_owner, open_in_workspace, who_is_editing); one handler, the last one set wins. */
  onMcpCall: (() => {
    let current: ((call: unknown) => unknown) | null = null
    ipcRenderer.on('ccm:mcp-call', (_event, call: unknown) => {
      const id = typeof call === 'object' && call !== null && typeof (call as { id?: unknown }).id === 'string' ? (call as { id: string }).id : null
      if (id === null) return
      const reply = (result: unknown): void => {
        try {
          ipcRenderer.send('ccm:mcp-reply', id, result)
        } catch {
          ipcRenderer.send('ccm:mcp-reply', id, { ok: false, error: 'failed' })
        }
      }
      if (!current) return reply({ ok: false, error: 'unavailable' })
      const handler = current
      void Promise.resolve()
        .then(() => handler(call))
        .then(reply, () => reply({ ok: false, error: 'failed' }))
    })
    return (handler: (call: unknown) => unknown): void => {
      current = handler
    }
  })(),
  previewUrl: (path: string): Promise<unknown> => ipcRenderer.invoke('ccm:preview-url', path),
  readFile: (path: string): Promise<unknown> => ipcRenderer.invoke('ccm:read-file', path),
  logRead: (req: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:log-read', req),
  httpSend: (req: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:http-send', req),
  httpCancel: (id: string): Promise<unknown> => ipcRenderer.invoke('ccm:http-cancel', id),
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
  gitShowImage: (root: string, path: string): Promise<unknown> => ipcRenderer.invoke('ccm:git-show-image', { root, path }),
  search: (dir: string, query: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:search', { dir, query }),
  replaceFiles: (dir: string, req: { query: unknown; replacement: string; files: unknown }): Promise<unknown> => ipcRenderer.invoke('ccm:replace-files', { ...req, dir }),
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
  lhList: (file: string): Promise<unknown> => ipcRenderer.invoke('ccm:lh-list', file),
  envCheck: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:env-check', root),
  permRead: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:perm-read', root),
  ctxSources: (cwd: string): Promise<unknown> => ipcRenderer.invoke('ccm:ctx-sources', cwd),
  memoryDoctor: (cwd: string): Promise<unknown> => ipcRenderer.invoke('ccm:memory-doctor', cwd),
  permAllow: (root: string, rules: string[]): Promise<unknown> => ipcRenderer.invoke('ccm:perm-allow', { root, rules }),
  sensitiveDeny: (req: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:sensitive-deny', req),
  i18nScan: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:i18n-scan', root),
  envReveal: (root: string, file: string, key: string): Promise<unknown> => ipcRenderer.invoke('ccm:env-reveal', { root, file, key }),
  lhRead: (file: string, id: string): Promise<unknown> => ipcRenderer.invoke('ccm:lh-read', { path: file, id }),
  formatText: (file: string, text: string): Promise<unknown> => ipcRenderer.invoke('ccm:format', { path: file, text }),
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
  ...deepseek,
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
  devScreencap: (id: string): Promise<unknown> => ipcRenderer.invoke('ccm:dev-screencap', id),
  devUiDump: (id: string): Promise<unknown> => ipcRenderer.invoke('ccm:dev-uidump', id),
  devRecStart: (id: string): Promise<unknown> => ipcRenderer.invoke('ccm:dev-rec-start', id),
  devRecStop: (id: string): Promise<unknown> => ipcRenderer.invoke('ccm:dev-rec-stop', id),
  devRecCancel: (id: string): Promise<unknown> => ipcRenderer.invoke('ccm:dev-rec-cancel', id),
  devRecSave: (token: string, name: string): Promise<unknown> => ipcRenderer.invoke('ccm:dev-rec-save', token, name),
  devRecDiscard: (token: string): Promise<unknown> => ipcRenderer.invoke('ccm:dev-rec-discard', token),
  devUiRead: (id: string, pkg: string | null): Promise<unknown> => ipcRenderer.invoke('ccm:dev-ui-read', id, pkg),
  devUiSet: (id: string, change: unknown, pkg: string | null): Promise<unknown> => ipcRenderer.invoke('ccm:dev-ui-set', id, change, pkg),
  devUiRestore: (id: string, pkg: string | null): Promise<unknown> => ipcRenderer.invoke('ccm:dev-ui-restore', id, pkg),
  devManifest: (dir: string): Promise<unknown> => ipcRenderer.invoke('ccm:dev-manifest', dir),
  devLaunch: (id: string, target: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:dev-launch', id, target),
  avdList: (): Promise<unknown> => ipcRenderer.invoke('ccm:avd-list'),
  avdStart: (name: string, mode: string): Promise<unknown> => ipcRenderer.invoke('ccm:avd-start', name, mode),
  avdStop: (name: string): Promise<unknown> => ipcRenderer.invoke('ccm:avd-stop', name),
  resKill: (targets: unknown): Promise<unknown> =>
    Array.isArray(targets) && targets.length <= 50 ? ipcRenderer.invoke('ccm:res-kill', targets) : Promise.resolve({ ok: false, error: 'invalid' }),
  awakeState: (): Promise<unknown> => ipcRenderer.invoke('ccm:awake-state'),
  awakeMode: (mode: string): Promise<unknown> => ipcRenderer.invoke('ccm:awake-mode', mode),
  onAwake: (handler: (state: unknown) => void): (() => void) => subscribe('ccm:awake-event', handler),
  captureGet: (): Promise<unknown> => ipcRenderer.invoke('ccm:capture-get'),
  capturePick: (): Promise<unknown> => ipcRenderer.invoke('ccm:capture-pick'),
  captureSet: (patch: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:capture-set', patch),
  captureShot: (req: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:capture-shot', req),
  captureOpen: (): Promise<unknown> => ipcRenderer.invoke('ccm:capture-open'),
  phoneState: (): Promise<unknown> => ipcRenderer.invoke('ccm:phone-state'),
  phoneSet: (patch: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:phone-set', patch),
  phoneTest: (): Promise<unknown> => ipcRenderer.invoke('ccm:phone-test'),
  onPhone: (handler: (event: unknown) => void): (() => void) => subscribe('ccm:phone-event', handler),
  telegramState: (): Promise<unknown> => ipcRenderer.invoke('ccm:telegram-state'),
  telegramSet: (patch: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:telegram-set', patch),
  telegramRouteSet: (input: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:telegram-route-set', input),
  telegramRouteRemove: (project: string): Promise<unknown> => ipcRenderer.invoke('ccm:telegram-route-remove', project),
  telegramTest: (project?: string): Promise<unknown> => ipcRenderer.invoke('ccm:telegram-test', project),
  telegramInstallCommand: (): Promise<unknown> => ipcRenderer.invoke('ccm:telegram-command'),
  telegramDiscover: (): Promise<unknown> => ipcRenderer.invoke('ccm:telegram-discover'),
  telegramCreateTopic: (input: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:telegram-create-topic', input),
  telegramPair: (on: boolean): Promise<unknown> => ipcRenderer.invoke('ccm:telegram-pair', on),
  telegramUnpair: (): Promise<unknown> => ipcRenderer.invoke('ccm:telegram-unpair'),
  telegramInstallReceive: (): Promise<unknown> => ipcRenderer.invoke('ccm:telegram-receive-command'),
  onTelegram: (handler: (event: unknown) => void): (() => void) => subscribe('ccm:telegram-event', handler),
  agentDataState: (): Promise<unknown> => ipcRenderer.invoke('ccm:agentdata-state'),
  agentDataScan: (): Promise<unknown> => ipcRenderer.invoke('ccm:agentdata-scan'),
  agentDataCancel: (): Promise<unknown> => ipcRenderer.invoke('ccm:agentdata-cancel'),
  agentDataClean: (req: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:agentdata-clean', req),
  agentDataStrip: (req: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:agentdata-strip', req),
  agentDataMove: (agent: string): Promise<unknown> => ipcRenderer.invoke('ccm:agentdata-move', { agent }),
  agentDataUndo: (agent: string): Promise<unknown> => ipcRenderer.invoke('ccm:agentdata-undo', { agent }),
  agentDataDeleteOriginal: (agent: string): Promise<unknown> => ipcRenderer.invoke('ccm:agentdata-delete-original', { agent }),
  agentDataDiscard: (agent: string): Promise<unknown> => ipcRenderer.invoke('ccm:agentdata-discard', { agent }),
  onAgentData: (handler: (progress: unknown) => void): (() => void) => subscribe('ccm:agentdata-event', handler),
  buildScan: (roots: string[]): Promise<unknown> => ipcRenderer.invoke('ccm:build-scan', roots),
  buildClean: (req: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:build-clean', req),
  buildCancel: (): Promise<unknown> => ipcRenderer.invoke('ccm:build-cancel'),
  onBuild: (handler: (progress: unknown) => void): (() => void) => subscribe('ccm:build-event', handler),
  diskState: (): Promise<unknown> => ipcRenderer.invoke('ccm:disk-state'),
  diskRefresh: (): Promise<unknown> => ipcRenderer.invoke('ccm:disk-refresh'),
  diskSet: (warnGb: number): Promise<unknown> => ipcRenderer.invoke('ccm:disk-set', { warnGb }),
  diskProjects: (dirs: string[]): Promise<unknown> => ipcRenderer.invoke('ccm:disk-projects', dirs),
  diskOpen: (mount: string): Promise<unknown> => ipcRenderer.invoke('ccm:disk-open', mount),
  onDisk: (handler: (state: unknown) => void): (() => void) => subscribe('ccm:disk-event', handler),
  appDataList: (id: string, pkg: string): Promise<unknown> => ipcRenderer.invoke('ccm:appdata-list', id, pkg),
  appDataDbOpen: (id: string, pkg: string, name: string): Promise<unknown> => ipcRenderer.invoke('ccm:appdata-db-open', id, pkg, name),
  appDataDbRows: (handle: string, table: string, page: number): Promise<unknown> => ipcRenderer.invoke('ccm:appdata-db-rows', handle, table, page),
  appDataDbQuery: (handle: string, sql: string): Promise<unknown> => ipcRenderer.invoke('ccm:appdata-db-query', handle, sql),
  appDataDbClose: (handle: string): Promise<unknown> => ipcRenderer.invoke('ccm:appdata-db-close', handle),
  appDataPrefsRead: (id: string, pkg: string, name: string): Promise<unknown> => ipcRenderer.invoke('ccm:appdata-prefs-read', id, pkg, name),
  appDataPrefsWrite: (id: string, pkg: string, name: string, edit: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:appdata-prefs-write', id, pkg, name, edit),
  appDataPrefsRestore: (id: string, pkg: string, name: string): Promise<unknown> => ipcRenderer.invoke('ccm:appdata-prefs-restore', id, pkg, name),
  perfHistory: (pkg: string): Promise<unknown> => ipcRenderer.invoke('ccm:perf-history', pkg),
  perfClear: (pkg: string): Promise<unknown> => ipcRenderer.invoke('ccm:perf-clear', pkg),
  perfReset: (id: string, pkg: string): Promise<unknown> => ipcRenderer.invoke('ccm:perf-reset', id, pkg),
  perfMeasure: (id: string, pkg: string, device: string): Promise<unknown> => ipcRenderer.invoke('ccm:perf-measure', id, pkg, device),
  perfCold: (id: string, pkg: string, device: string): Promise<unknown> => ipcRenderer.invoke('ccm:perf-cold', id, pkg, device),
  devFsList: (id: string, scope: unknown, dir: string): Promise<unknown> => ipcRenderer.invoke('ccm:devfs-list', id, scope, dir),
  devFsMkdir: (id: string, scope: unknown, dir: string, name: string): Promise<unknown> => ipcRenderer.invoke('ccm:devfs-mkdir', id, scope, dir, name),
  devFsDelete: (id: string, scope: unknown, path: string, dir: boolean): Promise<unknown> => ipcRenderer.invoke('ccm:devfs-delete', id, scope, path, dir),
  devFsPull: (id: string, req: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:devfs-pull', id, req),
  devFsPush: (id: string, req: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:devfs-push', id, req),
  devFsCancel: (transfer: string): Promise<unknown> => ipcRenderer.invoke('ccm:devfs-cancel', transfer),
  devFsOpen: (local: string, mode: 'open' | 'reveal'): Promise<unknown> => ipcRenderer.invoke('ccm:devfs-open', local, mode),
  onDevFsProgress: (handler: (event: unknown) => void): (() => void) => subscribe('ccm:devfs-progress', handler),
  apkPick: (near: string | null): Promise<unknown> => ipcRenderer.invoke('ccm:apk-pick', near),
  apkAnalyze: (req: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:apk-analyze', req),
  apkCompare: (req: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:apk-compare', req),
  releaseCheck: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:release-check', root),
  releaseMark: (req: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:release-mark', req),
  releaseVerify: (req: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:release-verify', req),
  releaseRemember: (req: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:release-remember', req),
  libsCheck: (req: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:libs-check', req),
  libsVulns: (req: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:libs-vulns', req),
  hooksList: (dir: string | null): Promise<unknown> => ipcRenderer.invoke('ccm:hooks-list', dir),
  hooksToggle: (req: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:hooks-toggle', req),
  hooksTest: (req: unknown): Promise<unknown> => ipcRenderer.invoke('ccm:hooks-test', req),
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
