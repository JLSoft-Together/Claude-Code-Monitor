import type { GhAccountsResult, GhRepoAccount, GhRepoChoice } from '@ccm/shared'
import { desktop } from './desktop'

/** v58 GitHub accounts bridge: the page sends a token once (add) and never reads one back. */
interface GitHubBridge {
  ghAccounts?: () => Promise<GhAccountsResult>
  ghAccountAdd?: (token: string) => Promise<GhAccountsResult>
  ghAccountRemove?: (id: string) => Promise<GhAccountsResult>
  ghAccountDefault?: (id: string) => Promise<GhAccountsResult>
  ghRepoAccount?: (root: string, remote: string) => Promise<GhRepoAccount>
  ghRepoAccountSet?: (root: string, choice: GhRepoChoice) => Promise<boolean>
}

const bridge = desktop as unknown as GitHubBridge | undefined
const unavailable: GhAccountsResult = { ok: false, error: 'denied' }

export const hasGitHub = typeof bridge?.ghAccounts === 'function'
export const ghAccounts = (): Promise<GhAccountsResult> => bridge?.ghAccounts?.() ?? Promise.resolve(unavailable)
export const ghAccountAdd = (token: string): Promise<GhAccountsResult> => bridge?.ghAccountAdd?.(token) ?? Promise.resolve(unavailable)
export const ghAccountRemove = (id: string): Promise<GhAccountsResult> => bridge?.ghAccountRemove?.(id) ?? Promise.resolve(unavailable)
export const ghAccountDefault = (id: string): Promise<GhAccountsResult> => bridge?.ghAccountDefault?.(id) ?? Promise.resolve(unavailable)
export const ghRepoAccount = (root: string, remote: string): Promise<GhRepoAccount> =>
  bridge?.ghRepoAccount?.(root, remote) ?? Promise.resolve({ github: false })
export const ghRepoAccountSet = (root: string, choice: GhRepoChoice): Promise<boolean> => bridge?.ghRepoAccountSet?.(root, choice) ?? Promise.resolve(false)
