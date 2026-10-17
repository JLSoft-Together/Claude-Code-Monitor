/** A GitHub account added with a personal access token (v58). The token itself never leaves main. */
export interface GhAccount {
  id: string
  login: string
  name: string | null
  /** Classic token scopes (`X-OAuth-Scopes`); null for a fine-grained token, which reports none. */
  scopes: string[] | null
  addedAt: number
  isDefault: boolean
}

export type GhAccountError = 'invalid' | 'network' | 'no-keychain' | 'not-found' | 'cancelled' | 'denied' | 'failed'

export type GhAccountsResult = { ok: true; accounts: GhAccount[] } | { ok: false; error: GhAccountError; detail?: string }

/** Per repo: `auto` picks the account that can push (default first), `system` = Git Credential Manager, else an account id. */
export type GhRepoChoice = string

export type GhAccess = 'push' | 'read' | 'none' | 'unknown'

/** Which account git network commands of one repo + remote use. `github: false` = not an https github.com remote. */
export type GhRepoAccount =
  | { github: false }
  | { github: true; owner: string; repo: string; choice: GhRepoChoice; account: { id: string; login: string } | null; access: GhAccess }

/** New classic token page with the scopes git push needs (`workflow` for repos with GitHub Actions files). */
export const GH_TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=repo,workflow,read:org&description=Orrery'

/** `owner/repo` of a github.com remote URL; `https` false for SSH forms, where a token does not apply. */
export function githubRepoOf(url: string): { owner: string; repo: string; https: boolean } | null {
  const s = url.trim()
  const m =
    /^https:\/\/(?:[^@/\s]+@)?github\.com(?::443)?\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(s) ??
    /^(?:ssh:\/\/)?(?:[\w.-]+@)?(?:ssh\.)?github\.com[:/](?:443\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(s)
  if (!m) return null
  return { owner: m[1]!, repo: m[2]!, https: /^https:/i.test(s) }
}
