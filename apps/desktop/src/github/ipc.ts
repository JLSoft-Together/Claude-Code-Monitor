import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { GhAccountsResult } from '@ccm/shared'
import type { GitHubAccounts } from './accounts'

export interface GitHubIpcDeps {
  ipcMain: IpcMain
  isAppFrame: (event: IpcMainInvokeEvent) => boolean
  store: GitHubAccounts
  /** Native yes/no before an account and its token are forgotten. */
  confirmRemove: (event: IpcMainInvokeEvent, login: string) => Promise<boolean>
}

const CHANNELS = ['ccm:gh-accounts', 'ccm:gh-account-add', 'ccm:gh-account-remove', 'ccm:gh-account-default']

/** Settings → GitHub accounts. The page sends a token once (add); every answer lists accounts without tokens. */
export function registerGitHubIpc(deps: GitHubIpcDeps): () => void {
  const { ipcMain, isAppFrame, store } = deps
  const denied: GhAccountsResult = { ok: false, error: 'denied' }
  const listed = (): GhAccountsResult => ({ ok: true, accounts: store.list() })

  ipcMain.handle('ccm:gh-accounts', (event) => (isAppFrame(event) ? listed() : denied))
  ipcMain.handle('ccm:gh-account-add', async (event, token: unknown): Promise<GhAccountsResult> => {
    if (!isAppFrame(event)) return denied
    const res = await store.add(token)
    return res.ok ? listed() : res
  })
  ipcMain.handle('ccm:gh-account-remove', async (event, id: unknown): Promise<GhAccountsResult> => {
    if (!isAppFrame(event)) return denied
    const account = store.list().find((a) => a.id === id)
    if (!account) return { ok: false, error: 'not-found' }
    if (!(await deps.confirmRemove(event, account.login).catch(() => false))) return { ok: false, error: 'cancelled' }
    store.remove(account.id)
    return listed()
  })
  ipcMain.handle('ccm:gh-account-default', (event, id: unknown): GhAccountsResult => {
    if (!isAppFrame(event)) return denied
    return store.setDefault(id) ? listed() : { ok: false, error: 'not-found' }
  })

  return () => {
    for (const ch of CHANNELS) ipcMain.removeHandler(ch)
  }
}
