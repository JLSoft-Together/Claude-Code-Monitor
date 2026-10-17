import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { BrowserWindow, Dialog, IpcMain, IpcMainInvokeEvent, Session, Shell, WebContents } from 'electron'
import { commonDir, discardFile, discardHunk, diff as changesDiff, fileDiff, GitDirWatcher, status as changesStatus, toplevel, type ChangesError } from './changes'
import { electronClipboardImage, writeClipboardImage, writeClipboardImageFile, type ClipboardImageDeps } from './clipboardImage'
import { createEntry, listDir, renameEntry, trashEntry } from './explorer'
import { readFileForView } from './files'
import { writeTextFile } from './fileWrite'
import { detectScripts } from './scripts'
import { workspaceChord } from './keys'
import { filesystemRoots, FullAccess, GrantStore } from './grants'
import { FileListCache } from './listFiles'
import { createBranch, deletePlan, fetchAll, pushBranch, pushPreview, remoteUrl, runDelete, updateBranch, type GitAuth } from './branches'
import { branchesContaining, commitDetail, commitDiff, listRefs, logPage } from './log'
import { realOrNull, realRoots, rootKey, rootOf } from './paths'
import { existingDir } from '../pick-start'
import type { GitHubAccounts } from '../github/accounts'
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
  /** Native yes/no showing the exact git commands; the page cannot delete a branch without it. */
  confirmGit?: (req: { title: string; commands: string[]; force?: boolean }) => Promise<boolean>
  /** OS trash for discarded untracked / added files; defaults to `shell.trashItem` when the shell passed in has it. */
  trash?: (path: string) => Promise<void>
  /** nativeImage decode + PNG clipboard write; defaults to Electron's own, loaded on first use. */
  clipboardImage?: ClipboardImageDeps
  /** Folders the user allowed; persisted by the app (`preview-grants.json`). In-memory when omitted. */
  grants?: GrantStore
  /** Settings switch: every folder readable. Off and in-memory when omitted. */
  fullAccess?: FullAccess
  /** Native yes/no before turning full access on; the page cannot enable it itself. */
  confirmFullAccess?: () => Promise<boolean>
  /** GitHub accounts (Settings): push / fetch / pull of a github.com https remote use the repo's account token. */
  github?: GitHubAccounts
}

export interface PreviewIpc {
  /** Lets a folder the user chose elsewhere (e.g. a native picker) be read too. */
  grant: (dir: string) => void
  /** A known repo toplevel or allowed folder (real path), else null â€” the gate other features reuse. */
  resolveDir: (dir: unknown) => Promise<string | null>
  dispose: () => void
}

const CHANNELS = [
  'ccm:preview-url', 'ccm:read-file', 'ccm:watch', 'ccm:unwatch', 'ccm:pick-file', 'ccm:open-external', 'ccm:reveal', 'ccm:open-path', 'ccm:request-access',
  'ccm:changes-status', 'ccm:changes-diff', 'ccm:changes-file', 'ccm:changes-discard', 'ccm:changes-watch', 'ccm:changes-unwatch', 'ccm:list-files', 'ccm:clipboard-image', 'ccm:clipboard-image-file', 'ccm:pick-files', 'ccm:capture-guest', 'ccm:forget-grants', 'ccm:full-access',
  'ccm:log-refs', 'ccm:log-page', 'ccm:log-commit', 'ccm:log-contains', 'ccm:log-diff', 'ccm:git-branch-create', 'ccm:git-branch-delete', 'ccm:git-fetch', 'ccm:git-branch-update', 'ccm:git-push-preview', 'ccm:git-push', 'ccm:gh-repo-account', 'ccm:gh-repo-account-set',
  'ccm:project-root', 'ccm:scripts', 'ccm:list-dir', 'ccm:create-entry', 'ccm:rename-entry', 'ccm:trash-entry',
  'ccm:file-write',
]

type Subs = Map<number, { contents: WebContents; roots: Map<string, { root: string; refs: number }> }>

export function registerPreviewIpc(deps: PreviewIpcDeps): PreviewIpc {
  const { ipcMain, isAppFrame, server, watcher, shell, dialog } = deps
  const grants = deps.grants ?? new GrantStore()
  const full = deps.fullAccess ?? new FullAccess()
  // webContents id -> watched root key -> { root, refs }; released when the page navigates or closes.
  const subs: Subs = new Map()
  const changeSubs: Subs = new Map()
  // repo toplevel key -> { root, from }: a toplevel may sit above the pane cwd it was found from; it stays usable while `from` is allowed.
  const repos = new Map<string, { root: string; from: string }>()
  const fileLists = new FileListCache()
  const gitDirs = new GitDirWatcher((root) => notifyChanges(root))
  const hooked = new WeakSet<WebContents>()
  const asking = new Map<string, Promise<boolean>>()

  /** OS trash: injected for tests, else Electron's `shell.trashItem`. */
  const trashFn = (): ((p: string) => Promise<void>) | null => {
    const shellTrash = (deps.shell as Partial<Shell>).trashItem
    return deps.trash ?? (shellTrash ? (p: string) => shellTrash.call(deps.shell, p) : null)
  }

  const allowedRoots = async (fresh = false): Promise<string[]> =>
    realRoots([...(await deps.getRoots(fresh)), ...grants.list(), ...(full.get() ? filesystemRoots() : [])])

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

  /**
   * Remembered rail folder without a pane: toplevel + common dir only, so it groups by repo. Grants nothing and
   * registers no repo, so Changes / Log / scripts there stay refused until a pane opens (docs Â§11t).
   */
  async function rootFacts(dir: unknown): Promise<{ root: string; repo: boolean; common?: string } | null> {
    if (typeof dir !== 'string' || dir.length > 1024 || !path.isAbsolute(dir)) return null
    const real = await realOrNull(dir)
    if (!real || !(await fs.stat(real).catch(() => null))?.isDirectory()) return null
    const top = await toplevel(real)
    if ('error' in top) return { root: real, repo: false }
    const common = await commonDir(top.root)
    return { root: top.root, repo: true, ...(common ? { common } : {}) }
  }

  /** Known repo for `dir`, else its toplevel registered once the folder is allowed (Changes and Log panes). */
  async function registerRepo(dir: unknown): Promise<string | { error: ChangesError }> {
    const known = await repoOf(dir)
    if (known) return known
    const ok = (await allowedPath(dir)) ?? (await allowedPath(dir, true))
    if (!ok) return { error: 'denied' }
    const top = await toplevel(ok.real)
    if ('error' in top) return top
    repos.set(rootKey(top.root), { root: top.root, from: ok.real })
    return top.root
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

  // Same folders the viewer and the Explorer reach: allowed roots plus repo toplevels found from an allowed folder.
  async function writeRoots(): Promise<string[]> {
    const roots = await allowedRoots()
    for (const { root, from } of repos.values()) if (rootOf(from, roots)) roots.push(root)
    return roots
  }

  ipcMain.handle('ccm:file-write', async (event, req: unknown) => {
    if (!isAppFrame(event)) return { ok: false, error: 'denied' }
    return writeTextFile(req, await writeRoots())
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

  // `near`: the focused terminal's folder; the dialog opens there.
  ipcMain.handle('ccm:pick-file', async (event, kind: unknown, near: unknown) => {
    if (!isAppFrame(event)) return null
    const filters = kind === 'html' ? [{ name: 'HTML', extensions: ['html', 'htm'] }] : []
    const win = deps.getWindow()
    const opts: Electron.OpenDialogOptions = { properties: ['openFile'], filters, defaultPath: existingDir(near) }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const file = res.canceled ? undefined : res.filePaths[0]
    if (!file) return null
    grants.add(path.dirname(file))
    return file
  })

  // Attachments tray "Add filesâ€¦": paths only go into the agent's prompt as @mentions, nothing is read here.
  ipcMain.handle('ccm:pick-files', async (event) => {
    if (!isAppFrame(event)) return []
    const win = deps.getWindow()
    const opts: Electron.OpenDialogOptions = { properties: ['openFile', 'multiSelections'] }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? [] : res.filePaths.slice(0, 50)
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
    const repo = await registerRepo(dir)
    return typeof repo === 'string' ? changesStatus(repo) : { ok: false, error: repo.error }
  })

  ipcMain.handle('ccm:changes-diff', async (event, req: unknown) => {
    const { root, path: rel, opts } = (req ?? {}) as { root?: unknown; path?: unknown; opts?: unknown }
    const repo = isAppFrame(event) ? await repoOf(root) : null
    if (!repo) return { ok: false, error: 'denied' }
    return changesDiff(repo, rel, opts)
  })

  // File viewer gutter: the file must be readable here; its repo is registered so a rollback can name it.
  ipcMain.handle('ccm:changes-file', async (event, file: unknown) => {
    if (!isAppFrame(event)) return { ok: false, error: 'denied' }
    const ok = await allowedPath(file)
    if (!ok || !(await fs.stat(ok.real).catch(() => null))?.isFile()) return { ok: false, error: 'denied' }
    return fileDiff(ok.real, async (dir) => {
      const known = await repoOf(dir)
      if (known) return { root: known }
      const top = await toplevel(dir)
      if ('root' in top) repos.set(rootKey(top.root), { root: top.root, from: ok.real })
      return top
    })
  })

  ipcMain.handle('ccm:log-refs', async (event, dir: unknown) => {
    if (!isAppFrame(event)) return { ok: false, error: 'denied' }
    const repo = await registerRepo(dir)
    return typeof repo === 'string' ? listRefs(repo) : { ok: false, error: repo.error }
  })

  const logRepo = async (event: IpcMainInvokeEvent, root: unknown): Promise<string | null> => (isAppFrame(event) ? repoOf(root) : null)
  const denied = { ok: false, error: 'denied' } as const
  const authOf = (repo: string): GitAuth | undefined => {
    const gh = deps.github
    if (!gh) return undefined
    return async (remote) => {
      const url = await remoteUrl(repo, remote)
      return url ? gh.envFor(repo, url) : undefined
    }
  }

  ipcMain.handle('ccm:log-page', async (event, req: unknown) => {
    const { root, query } = (req ?? {}) as { root?: unknown; query?: unknown }
    const repo = await logRepo(event, root)
    return repo ? logPage(repo, query) : denied
  })
  ipcMain.handle('ccm:log-commit', async (event, req: unknown) => {
    const { root, hash } = (req ?? {}) as { root?: unknown; hash?: unknown }
    const repo = await logRepo(event, root)
    return repo ? commitDetail(repo, hash) : denied
  })
  ipcMain.handle('ccm:log-contains', async (event, req: unknown) => {
    const { root, hash } = (req ?? {}) as { root?: unknown; hash?: unknown }
    const repo = await logRepo(event, root)
    return repo ? branchesContaining(repo, hash) : denied
  })
  ipcMain.handle('ccm:log-diff', async (event, req: unknown) => {
    const { root, hash, path: rel, opts, origPath } = (req ?? {}) as { root?: unknown; hash?: unknown; path?: unknown; opts?: unknown; origPath?: unknown }
    const repo = await logRepo(event, root)
    return repo ? commitDiff(repo, hash, rel, opts, origPath) : denied
  })

  ipcMain.handle('ccm:git-branch-create', async (event, req: unknown) => {
    const { root, name, base, checkout } = (req ?? {}) as { root?: unknown; name?: unknown; base?: unknown; checkout?: unknown }
    const repo = await logRepo(event, root)
    return repo ? createBranch(repo, name, base, checkout) : denied
  })
  ipcMain.handle('ccm:git-branch-delete', async (event, req: unknown) => {
    const { root, ref } = (req ?? {}) as { root?: unknown; ref?: unknown }
    const repo = await logRepo(event, root)
    if (!repo || !deps.confirmGit) return denied
    const plan = await deletePlan(repo, ref, false)
    if (!plan.ok) return plan
    if (!(await deps.confirmGit({ title: plan.label, commands: [`git ${plan.args.join(' ')}`] }).catch(() => false))) return { ok: false, error: 'cancelled' }
    const res = await runDelete(repo, plan.args, authOf(repo))
    if (res.ok || res.error !== 'not-merged' || plan.remote) return res
    const force = await deletePlan(repo, ref, true)
    if (!force.ok) return force
    if (!(await deps.confirmGit({ title: force.label, commands: [`git ${force.args.join(' ')}`], force: true }).catch(() => false))) return { ok: false, error: 'cancelled' }
    return runDelete(repo, force.args, authOf(repo))
  })
  ipcMain.handle('ccm:git-fetch', async (event, root: unknown) => {
    const repo = await logRepo(event, root)
    return repo ? fetchAll(repo, authOf(repo)) : denied
  })
  ipcMain.handle('ccm:git-branch-update', async (event, req: unknown) => {
    const { root, ref } = (req ?? {}) as { root?: unknown; ref?: unknown }
    const repo = await logRepo(event, root)
    return repo ? updateBranch(repo, ref, authOf(repo)) : denied
  })
  ipcMain.handle('ccm:git-push-preview', async (event, req: unknown) => {
    const { root, ref, remote, branch } = (req ?? {}) as { root?: unknown; ref?: unknown; remote?: unknown; branch?: unknown }
    const repo = await logRepo(event, root)
    return repo ? pushPreview(repo, ref, remote, branch) : denied
  })
  ipcMain.handle('ccm:git-push', async (event, req: unknown) => {
    const { root, ref, remote, branch, setUpstream } = (req ?? {}) as { root?: unknown; ref?: unknown; remote?: unknown; branch?: unknown; setUpstream?: unknown }
    const repo = await logRepo(event, root)
    return repo ? pushBranch(repo, ref, remote, branch, setUpstream, authOf(repo)) : denied
  })
  ipcMain.handle('ccm:gh-repo-account', async (event, req: unknown) => {
    const { root, remote } = (req ?? {}) as { root?: unknown; remote?: unknown }
    const repo = await logRepo(event, root)
    if (!repo || !deps.github) return { github: false }
    const url = await remoteUrl(repo, remote)
    return url ? deps.github.resolve(repo, url) : { github: false }
  })
  ipcMain.handle('ccm:gh-repo-account-set', async (event, req: unknown) => {
    const { root, choice } = (req ?? {}) as { root?: unknown; choice?: unknown }
    const repo = await logRepo(event, root)
    return !!repo && !!deps.github && deps.github.setChoice(repo, choice)
  })

  ipcMain.handle('ccm:changes-discard', async (event, req: unknown) => {
    const { root, path: rel, hunk } = (req ?? {}) as { root?: unknown; path?: unknown; hunk?: unknown }
    const repo = isAppFrame(event) ? await repoOf(root) : null
    if (!repo) return { ok: false, error: 'denied' }
    if (hunk !== undefined) return discardHunk(repo, rel, hunk)
    const trash = trashFn()
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
  // The Explorer panel may ask for a pane spawned a moment ago, missing from the cached census: re-ask once.
  const explorerRoot = async (root: unknown): Promise<string | null> =>
    (await repoOf(root)) ?? ((await allowedPath(root)) ?? (await allowedPath(root, true)))?.real ?? null

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

  ipcMain.handle('ccm:rename-entry', async (event, req: unknown) => {
    const { root, path: target, name } = (req ?? {}) as { root?: unknown; path?: unknown; name?: unknown }
    const real = isAppFrame(event) ? await explorerRoot(root) : null
    if (!real) return { ok: false, error: 'denied' }
    const res = await renameEntry(real, target, name)
    if (res.ok) fileLists.invalidate(real)
    return res
  })

  ipcMain.handle('ccm:trash-entry', async (event, req: unknown) => {
    const { root, path: target } = (req ?? {}) as { root?: unknown; path?: unknown }
    const real = isAppFrame(event) ? await explorerRoot(root) : null
    if (!real) return { ok: false, error: 'denied' }
    const trash = trashFn()
    if (!trash) return { ok: false, error: 'failed' }
    const res = await trashEntry(real, target, trash)
    if (res.ok) fileLists.invalidate(real)
    return res
  })

  let clipboardImpl: Promise<ClipboardImageDeps> | null = null
  const imageClipboard = (): Promise<ClipboardImageDeps> => (clipboardImpl ??= deps.clipboardImage ? Promise.resolve(deps.clipboardImage) : electronClipboardImage())

  ipcMain.handle('ccm:clipboard-image-file', async (event, file: unknown) => {
    if (!isAppFrame(event)) return false
    try {
      return await writeClipboardImageFile(file, await imageClipboard())
    } catch {
      return false
    }
  })

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
  ipcMain.handle('ccm:project-root', async (event, dir: unknown, remembered?: unknown) => {
    if (!isAppFrame(event)) return null
    // A pane spawned a moment ago is missing from the cached census: re-ask once before giving up.
    const ok = (await allowedPath(dir)) ?? (await allowedPath(dir, true))
    if (!ok) return remembered === true ? rootFacts(dir) : null
    const top = await toplevel(ok.real)
    if ('error' in top) return { root: ok.real, repo: false }
    repos.set(rootKey(top.root), { root: top.root, from: ok.real })
    const common = await commonDir(top.root)
    return { root: top.root, repo: true, ...(common ? { common } : {}) }
  })

  ipcMain.handle('ccm:scripts', async (event, dir: unknown) => {
    if (!isAppFrame(event)) return null
    const real = (await repoOf(dir)) ?? (await allowedPath(dir))?.real
    if (!real || !(await fs.stat(real).catch(() => null))?.isDirectory()) return null
    return detectScripts(real).catch(() => null)
  })

  // No argument reads; true asks natively first, false turns it off at once; 'first' asks only while never decided.
  let confirming: Promise<boolean> | null = null
  ipcMain.handle('ccm:full-access', async (event, on: unknown) => {
    if (!isAppFrame(event)) return null
    if (on === false) full.set(false)
    const ask = (on === true || (on === 'first' && !full.asked())) && !full.get()
    if (ask) {
      confirming ??= (deps.confirmFullAccess?.() ?? Promise.resolve(false)).catch(() => false).finally(() => (confirming = null))
      const yes = await confirming
      if (yes || !full.asked()) full.set(yes)
    }
    return full.get()
  })

  ipcMain.handle('ccm:forget-grants', (event) => {
    if (!isAppFrame(event)) return false
    grants.clear()
    return true
  })

  return {
    grant: (dir) => grants.add(dir),
    resolveDir: explorerRoot,
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
