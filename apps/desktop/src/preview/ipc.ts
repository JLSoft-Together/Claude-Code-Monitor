import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { BrowserWindow, Dialog, IpcMain, IpcMainInvokeEvent, Session, Shell, WebContents } from 'electron'
import { discardFile, discardHunk, diff as changesDiff, GitDirWatcher, status as changesStatus, toplevel } from './changes'
import { electronClipboardImage, writeClipboardImage, type ClipboardImageDeps } from './clipboardImage'
import { createEntry, listDir } from './explorer'
import { readFileForView } from './files'
import { detectScripts } from './scripts'
import { workspaceChord } from './keys'
import { GrantStore } from './grants'
import { FileListCache } from './listFiles'
import { realOrNull, realRoots, rootKey, rootOf } from './paths'
import type { PreviewServer } from './server'
import type { RootWatcher } from './watch'

export const PREVIEW_PARTITION = 'persist:ccm-preview'
const PREVIEW_PERMISSIONS = new Set(['clipboard-sanitized-write'])

// shell.openPath runs these instead of opening them in an editor.
const EXECUTABLE_EXT = new Set([
  'exe', 'com', 'bat', 'cmd', 'msi', 'msp', 'scr', 'pif', 'cpl', 'msc', 'lnk', 'url', 'reg', 'inf', 'hta', 'jar', 'appref-ms',
  'ps1', 'psm1', 'psd1', 'vbs', 'vbe', 'js', 'jse', 'wsf', 'wsh', 'py', 'pyw', 'pl', 'rb',
  'app', 'command', 'tool', 'sh', 'bash', 'zsh', 'pkg', 'dmg', 'workflow', 'terminal', 'scpt', 'applescript',
])

export const isWebUrl = (url: unknown): url is string => {
  if (typeof url !== 'string') return false
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export const isLoopbackUrl = (url: string): boolean => {
  try {
    const { protocol, hostname } = new URL(url)
    return (protocol === 'http:' || protocol === 'https:') && (hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]')
  } catch {
    return false
  }
}

export const isExecutablePath = (file: string): boolean => EXECUTABLE_EXT.has(path.extname(file).slice(1).toLowerCase())

export interface PreviewIpcDeps {
  ipcMain: IpcMain
  /** Same gate as the other ccm:* handlers: top-level frame on the app origin, collector owned. */
  isAppFrame: (event: IpcMainInvokeEvent) => boolean
  server: PreviewServer
  watcher: RootWatcher
  /** Folders the page may read/serve from: live pane cwds. Picked files add their folder on top. */
  getRoots: (fresh?: boolean) => readonly string[] | Promise<readonly string[]>
  shell: Pick<Shell, 'openExternal' | 'showItemInFolder' | 'openPath'>
  dialog: Pick<Dialog, 'showOpenDialog'>
  getWindow: () => BrowserWindow | null
  /** Native yes/no for a folder outside every root; the page cannot grant itself access. */
  confirmAccess: (folder: string) => Promise<boolean>
  /** OS trash for discarded untracked / added files; defaults to `shell.trashItem` when the shell passed in has it. */
  trash?: (path: string) => Promise<void>
  /** nativeImage decode + PNG clipboard write; defaults to Electron's own, loaded on first use. */
  clipboardImage?: ClipboardImageDeps
  /** Folders the user allowed; persisted by the app (`preview-grants.json`). In-memory when omitted. */
  grants?: GrantStore
}

export interface PreviewIpc {
  /** Lets a folder the user chose elsewhere (e.g. a native picker) be read too. */
  grant: (dir: string) => void
  dispose: () => void
}

const CHANNELS = [
  'ccm:preview-url', 'ccm:read-file', 'ccm:watch', 'ccm:unwatch', 'ccm:pick-file', 'ccm:open-external', 'ccm:reveal', 'ccm:open-path', 'ccm:request-access',
  'ccm:changes-status', 'ccm:changes-diff', 'ccm:changes-discard', 'ccm:changes-watch', 'ccm:changes-unwatch', 'ccm:list-files', 'ccm:clipboard-image', 'ccm:capture-guest', 'ccm:forget-grants',
  'ccm:project-root', 'ccm:scripts', 'ccm:list-dir', 'ccm:create-entry',
]

type Subs = Map<number, { contents: WebContents; roots: Map<string, { root: string; refs: number }> }>

export function registerPreviewIpc(deps: PreviewIpcDeps): PreviewIpc {
  const { ipcMain, isAppFrame, server, watcher, shell, dialog } = deps
  const grants = deps.grants ?? new GrantStore()
  // webContents id -> watched root key -> { root, refs }; released when the page navigates or closes.
  const subs: Subs = new Map()
  const changeSubs: Subs = new Map()
  // repo toplevel key -> { root, from }: a toplevel may sit above the pane cwd it was found from; it stays usable while `from` is allowed.
  const repos = new Map<string, { root: string; from: string }>()
  const fileLists = new FileListCache()
  const gitDirs = new GitDirWatcher((root) => notifyChanges(root))
  const hooked = new WeakSet<WebContents>()
  const asking = new Map<string, Promise<boolean>>()

  const allowedRoots = async (fresh = false): Promise<string[]> => realRoots([...(await deps.getRoots(fresh)), ...grants.list()])

  async function allowedPath(p: unknown, fresh = false): Promise<{ real: string; roots: string[] } | null> {
    if (typeof p !== 'string' || !path.isAbsolute(p)) return null
    const roots = await allowedRoots(fresh)
    const real = await realOrNull(p)
    return real && rootOf(real, roots) ? { real, roots } : null
  }

  function notifyChanges(root: string): void {
    const key = rootKey(root)
    for (const sub of changeSubs.values()) if (sub.roots.has(key) && !sub.contents.isDestroyed()) sub.contents.send('ccm:changes-updated', { root })
  }

  async function repoOf(root: unknown): Promise<string | null> {
    if (typeof root !== 'string' || !path.isAbsolute(root)) return null
    const real = await realOrNull(root)
    const repo = real && repos.get(rootKey(real))
    return repo && (await allowedPath(repo.from)) ? repo.root : null
  }

  watcher.listen((root, changed) => {
    fileLists.invalidate(root)
    notifyChanges(root)
    const key = rootKey(root)
    const tokens = server.tokensUnder(root)
    for (const sub of subs.values()) {
      if (!sub.roots.has(key) || sub.contents.isDestroyed()) continue
      sub.contents.send('ccm:preview-changed', { root, tokens, paths: changed })
    }
  })

  function release(id: number): void {
    const sub = subs.get(id)
    if (sub) {
      subs.delete(id)
      for (const { root, refs } of sub.roots.values()) for (let i = 0; i < refs; i++) watcher.remove(root)
    }
    const csub = changeSubs.get(id)
    if (csub) {
      changeSubs.delete(id)
      for (const { root, refs } of csub.roots.values()) {
        for (let i = 0; i < refs; i++) {
          watcher.remove(root)
          gitDirs.remove(root)
        }
      }
    }
  }

  function subscriber(contents: WebContents, map: Subs = subs) {
    let sub = map.get(contents.id)
    if (!sub) {
      sub = { contents, roots: new Map() }
      map.set(contents.id, sub)
    }
    if (!hooked.has(contents)) {
      hooked.add(contents)
      const id = contents.id
      contents.once('destroyed', () => release(id))
      // A reload re-subscribes from scratch; drop what the old page held.
      contents.on('did-navigate', () => release(id))
    }
    return sub
  }

  ipcMain.handle('ccm:preview-url', async (event, target: unknown) => {
    if (!isAppFrame(event)) return null
    const ok = await allowedPath(target)
    if (!ok) return null
    const res = await server.urlFor(ok.real, ok.roots)
    return res && { ...res, origin: server.origin }
  })

  ipcMain.handle('ccm:read-file', async (event, target: unknown) => {
    if (!isAppFrame(event) || typeof target !== 'string') return null
    return readFileForView(target, await allowedRoots())
  })

  ipcMain.handle('ccm:watch', async (event, root: unknown) => {
    if (!isAppFrame(event)) return false
    const ok = await allowedPath(root)
    if (!ok || !(await fs.stat(ok.real).catch(() => null))?.isDirectory()) return false
    if (!watcher.add(ok.real)) return false
    const sub = subscriber(event.sender)
    const key = rootKey(ok.real)
    const held = sub.roots.get(key)
    if (held) held.refs++
    else sub.roots.set(key, { root: ok.real, refs: 1 })
    return true
  })

  ipcMain.handle('ccm:unwatch', async (event, root: unknown) => {
    if (!isAppFrame(event) || typeof root !== 'string') return false
    const real = (await realOrNull(root)) ?? root
    const sub = subs.get(event.sender.id)
    const key = rootKey(real)
    const held = sub?.roots.get(key)
    if (!sub || !held) return false
    if (--held.refs <= 0) sub.roots.delete(key)
    watcher.remove(held.root)
    return true
  })

  ipcMain.handle('ccm:pick-file', async (event, kind: unknown) => {
    if (!isAppFrame(event)) return null
    const filters = kind === 'html' ? [{ name: 'HTML', extensions: ['html', 'htm'] }] : []
    const win = deps.getWindow()
    const opts: Electron.OpenDialogOptions = { properties: ['openFile'], filters }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const file = res.canceled ? undefined : res.filePaths[0]
    if (!file) return null
    grants.add(path.dirname(file))
    return file
  })

  ipcMain.handle('ccm:open-external', async (event, url: unknown) => {
    if (!isAppFrame(event) || !isWebUrl(url)) return false
    await shell.openExternal(url)
    return true
  })

  ipcMain.handle('ccm:reveal', async (event, target: unknown) => {
    if (!isAppFrame(event)) return false
    const ok = await allowedPath(target)
    if (!ok) return false
    shell.showItemInFolder(ok.real)
    return true
  })

  ipcMain.handle('ccm:open-path', async (event, target: unknown) => {
    if (!isAppFrame(event)) return 'denied'
    const ok = await allowedPath(target)
    if (!ok || isExecutablePath(ok.real)) return 'denied'
    const error = await shell.openPath(ok.real)
    return error || 'ok'
  })

  ipcMain.handle('ccm:request-access', async (event, target: unknown) => {
    if (!isAppFrame(event) || typeof target !== 'string' || !path.isAbsolute(target)) return false
    if (await allowedPath(target)) return true
    const real = await realOrNull(target)
    const stat = real && (await fs.stat(real).catch(() => null))
    if (!real || !stat) return false
    const folder = stat.isDirectory() ? real : path.dirname(real)
    // A whole drive / filesystem root is never offered.
    if (path.dirname(folder) === folder) return false
    const key = rootKey(folder)
    let answer = asking.get(key)
    if (!answer && rootOf(folder, await realRoots([...grants.list()]))) return true
    answer ??= asking.get(key)
    if (!answer) {
      answer = deps.confirmAccess(folder).catch(() => false)
      asking.set(key, answer)
      void answer.then((ok) => {
        asking.delete(key)
        if (ok) grants.add(folder)
      })
    }
    return answer
  })

  ipcMain.handle('ccm:changes-status', async (event, dir: unknown) => {
    if (!isAppFrame(event)) return { ok: false, error: 'denied' }
    const known = await repoOf(dir)
    if (known) return changesStatus(known)
    const ok = await allowedPath(dir)
    if (!ok) return { ok: false, error: 'denied' }
    const top = await toplevel(ok.real)
    if ('error' in top) return { ok: false, error: top.error }
    repos.set(rootKey(top.root), { root: top.root, from: ok.real })
    return changesStatus(top.root)
  })

  ipcMain.handle('ccm:changes-diff', async (event, req: unknown) => {
    const { root, path: rel } = (req ?? {}) as { root?: unknown; path?: unknown }
    const repo = isAppFrame(event) ? await repoOf(root) : null
    if (!repo) return { ok: false, error: 'denied' }
    return changesDiff(repo, rel)
  })

  ipcMain.handle('ccm:changes-discard', async (event, req: unknown) => {
    const { root, path: rel, hunk } = (req ?? {}) as { root?: unknown; path?: unknown; hunk?: unknown }
    const repo = isAppFrame(event) ? await repoOf(root) : null
    if (!repo) return { ok: false, error: 'denied' }
    if (hunk !== undefined) return discardHunk(repo, rel, hunk)
    const shellTrash = (deps.shell as Partial<Shell>).trashItem
    const trash = deps.trash ?? (shellTrash ? (p: string) => shellTrash.call(deps.shell, p) : null)
    if (!trash) return { ok: false, error: 'failed', detail: 'no trash' }
    const res = await discardFile(repo, rel, { trash })
    fileLists.invalidate(repo)
    return res
  })

  ipcMain.handle('ccm:changes-watch', async (event, root: unknown) => {
    const repo = isAppFrame(event) ? await repoOf(root) : null
    if (!repo || !watcher.add(repo)) return false
    void gitDirs.add(repo)
    const sub = subscriber(event.sender, changeSubs)
    const key = rootKey(repo)
    const held = sub.roots.get(key)
    if (held) held.refs++
    else sub.roots.set(key, { root: repo, refs: 1 })
    return true
  })

  ipcMain.handle('ccm:changes-unwatch', async (event, root: unknown) => {
    if (!isAppFrame(event) || typeof root !== 'string') return false
    const real = (await realOrNull(root)) ?? root
    const sub = changeSubs.get(event.sender.id)
    const key = rootKey(real)
    const held = sub?.roots.get(key)
    if (!sub || !held) return false
    if (--held.refs <= 0) sub.roots.delete(key)
    watcher.remove(held.root)
    gitDirs.remove(held.root)
    return true
  })

  ipcMain.handle('ccm:list-files', async (event, root: unknown) => {
    if (!isAppFrame(event)) return null
    const dir = (await repoOf(root)) ?? (await allowedPath(root))?.real
    if (!dir || !(await fs.stat(dir).catch(() => null))?.isDirectory()) return null
    return fileLists.get(dir).catch(() => null)
  })

  /** Explorer root: a known repo toplevel, else an allowed folder (real path). */
  const explorerRoot = async (root: unknown): Promise<string | null> => (await repoOf(root)) ?? (await allowedPath(root))?.real ?? null

  ipcMain.handle('ccm:list-dir', async (event, req: unknown) => {
    const { root, dir } = (req ?? {}) as { root?: unknown; dir?: unknown }
    const real = isAppFrame(event) ? await explorerRoot(root) : null
    return real ? listDir(real, dir) : null
  })

  ipcMain.handle('ccm:create-entry', async (event, req: unknown) => {
    const { root, parent, name, kind } = (req ?? {}) as { root?: unknown; parent?: unknown; name?: unknown; kind?: unknown }
    const real = isAppFrame(event) ? await explorerRoot(root) : null
    if (!real) return { ok: false, error: 'denied' }
    const res = await createEntry(real, parent, name, kind)
    if (res.ok) fileLists.invalidate(real)
    return res
  })

  let clipboardImpl: Promise<ClipboardImageDeps> | null = null
  const imageClipboard = (): Promise<ClipboardImageDeps> => (clipboardImpl ??= deps.clipboardImage ? Promise.resolve(deps.clipboardImage) : electronClipboardImage())

  ipcMain.handle('ccm:clipboard-image', async (event, dataUrl: unknown) => {
    if (!isAppFrame(event)) return false
    try {
      return await writeClipboardImage(dataUrl, await imageClipboard())
    } catch {
      return false
    }
  })

  // Screenshot of a <webview> guest straight to the clipboard: only a guest this page itself hosts.
  ipcMain.handle('ccm:capture-guest', async (event, id: unknown) => {
    if (!isAppFrame(event) || typeof id !== 'number' || !Number.isInteger(id)) return false
    try {
      const { webContents } = await import('electron')
      const guest = webContents.fromId(id)
      if (!guest || guest.isDestroyed() || guest.getType() !== 'webview' || guest.hostWebContents?.id !== event.sender.id) return false
      const image = await guest.capturePage()
      if (image.isEmpty()) return false
      await (await imageClipboard()).writePng(image.toPNG())
      return true
    } catch {
      return false
    }
  })

  // Git toplevel of an allowed folder (else the folder itself): groups sidebar rows and roots the scripts menu.
  ipcMain.handle('ccm:project-root', async (event, dir: unknown) => {
    if (!isAppFrame(event)) return null
    // A pane spawned a moment ago is missing from the cached census: re-ask once before giving up.
    const ok = (await allowedPath(dir)) ?? (await allowedPath(dir, true))
    if (!ok) return null
    const top = await toplevel(ok.real)
    if ('error' in top) return { root: ok.real, repo: false }
    repos.set(rootKey(top.root), { root: top.root, from: ok.real })
    return { root: top.root, repo: true }
  })

  ipcMain.handle('ccm:scripts', async (event, dir: unknown) => {
    if (!isAppFrame(event)) return null
    const real = (await repoOf(dir)) ?? (await allowedPath(dir))?.real
    if (!real || !(await fs.stat(real).catch(() => null))?.isDirectory()) return null
    return detectScripts(real).catch(() => null)
  })

  ipcMain.handle('ccm:forget-grants', (event) => {
    if (!isAppFrame(event)) return false
    grants.clear()
    return true
  })

  return {
    grant: (dir) => grants.add(dir),
    dispose: () => {
      for (const ch of CHANNELS) ipcMain.removeHandler(ch)
      for (const id of new Set([...subs.keys(), ...changeSubs.keys()])) release(id)
      gitDirs.closeAll()
      fileLists.clear()
    },
  }
}

const lockedSessions = new WeakSet<Session>()

function lockPreviewSession(ses: Session): void {
  if (lockedSessions.has(ses)) return
  lockedSessions.add(ses)
  ses.setPermissionRequestHandler((_contents, permission, callback) => callback(PREVIEW_PERMISSIONS.has(permission)))
  ses.setPermissionCheckHandler((_contents, permission) => PREVIEW_PERMISSIONS.has(permission))
  ses.setDevicePermissionHandler(() => false)
}

function hardenGuest(guest: WebContents, openExternal: (url: string) => void, mac: boolean): void {
  guest.setWindowOpenHandler(({ url }) => {
    if (isLoopbackUrl(url)) void guest.loadURL(url)
    else if (isWebUrl(url)) openExternal(url)
    return { action: 'deny' }
  })
  const webOnly = (event: { preventDefault: () => void }, url: string): void => {
    if (!isWebUrl(url)) event.preventDefault()
  }
  guest.on('will-navigate', webOnly)
  guest.on('will-redirect', webOnly)
  // Focus sits inside the guest, so the window's own F5 / F12 handler never sees these keys.
  guest.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const chord = workspaceChord(input, mac)
    if (chord) {
      event.preventDefault()
      const host = guest.hostWebContents
      if (host && !host.isDestroyed()) host.send('ccm:forward-key', chord)
      return
    }
    const key = input.key.toLowerCase()
    const mod = input.control || input.meta
    if (key === 'f5' || (mod && key === 'r')) guest.reloadIgnoringCache()
    else if (key === 'f12') guest.toggleDevTools()
    else return
    event.preventDefault()
  })
}

/** Call on every window that may host `<webview>`: guests get no preload/node, run sandboxed in the preview partition. */
export function hardenWebviews(contents: WebContents, opts: { previewSession: Session; openExternal: (url: string) => void; mac?: boolean }): void {
  lockPreviewSession(opts.previewSession)
  contents.on('will-attach-webview', (event, prefs, params) => {
    delete prefs.preload
    delete (prefs as { preloadURL?: string }).preloadURL
    prefs.nodeIntegration = false
    prefs.nodeIntegrationInSubFrames = false
    prefs.contextIsolation = true
    prefs.sandbox = true
    prefs.webSecurity = true
    prefs.allowRunningInsecureContent = false
    if (params.partition !== PREVIEW_PARTITION || !isWebUrl(params.src)) event.preventDefault()
  })
  contents.on('did-attach-webview', (_event, guest) => hardenGuest(guest, opts.openExternal, opts.mac ?? process.platform === 'darwin'))
}
