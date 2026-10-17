import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { githubRepoOf, type GhAccess, type GhAccount, type GhAccountError, type GhRepoAccount, type GhRepoChoice } from '@ccm/shared'
import { rootKey } from '../preview/paths'

export const GH_ACCOUNTS_FILE = 'github-accounts.json'
const MAX_ACCOUNTS = 20
const MAX_REPOS = 500
const ACCESS_TTL_MS = 10 * 60_000
const API = 'https://api.github.com'

/** OS keychain encryption (Electron `safeStorage`); tokens are stored only through it. */
export interface TokenCrypt {
  available: () => boolean
  encrypt: (plain: string) => Buffer
  decrypt: (data: Buffer) => string
}

export type FetchFn = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{
  status: number
  headers: { get: (name: string) => string | null }
  json: () => Promise<unknown>
}>

interface Stored {
  id: string
  login: string
  name: string | null
  scopes: string[] | null
  addedAt: number
  token: string
}

interface FileShape {
  accounts: Stored[]
  defaultId: string | null
  repos: Record<string, GhRepoChoice>
}

export type AddResult = { ok: true; account: GhAccount } | { ok: false; error: GhAccountError; detail?: string }

/** Classic `ghp_` / fine-grained `github_pat_` / OAuth `gho_` etc.: one line of token characters, nothing else. */
const TOKEN = /^[A-Za-z0-9_]{20,255}$/

/**
 * Basic auth for github.com only, through git's env config (git >= 2.31): the token never sits in argv, and the
 * empty URL-scoped helper drops Git Credential Manager for github.com so a refused token fails instead of opening
 * a GCM window or falling back to another stored account.
 */
export function gitAuthEnv(token: string, base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const start = Number.parseInt(base.GIT_CONFIG_COUNT ?? '', 10)
  const n = Number.isInteger(start) && start > 0 ? start : 0
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64')
  return {
    GIT_CONFIG_COUNT: String(n + 2),
    [`GIT_CONFIG_KEY_${n}`]: 'credential.https://github.com.helper',
    [`GIT_CONFIG_VALUE_${n}`]: '',
    [`GIT_CONFIG_KEY_${n + 1}`]: 'http.https://github.com/.extraHeader',
    [`GIT_CONFIG_VALUE_${n + 1}`]: `Authorization: Basic ${basic}`,
  }
}

const isChoice = (v: unknown): v is GhRepoChoice => typeof v === 'string' && v.length > 0 && v.length <= 64

/**
 * GitHub accounts added by token (Settings → GitHub accounts) and the account each repo uses for push / fetch /
 * pull. Tokens are encrypted with the OS keychain and only ever handed to git through `gitAuthEnv`.
 */
export class GitHubAccounts {
  private data: FileShape = { accounts: [], defaultId: null, repos: {} }
  private readonly access = new Map<string, { at: number; value: GhAccess }>()

  constructor(
    private readonly opts: {
      file?: string
      crypt: TokenCrypt
      fetch: FetchFn
      now?: () => number
      timeoutMs?: number
    },
  ) {
    if (!opts.file) return
    try {
      const raw = JSON.parse(readFileSync(opts.file, 'utf8')) as Partial<FileShape>
      const accounts = (Array.isArray(raw.accounts) ? raw.accounts : []).filter(
        (a): a is Stored => !!a && typeof a.id === 'string' && typeof a.login === 'string' && typeof a.token === 'string',
      )
      const repos: Record<string, GhRepoChoice> = {}
      for (const [k, v] of Object.entries(raw.repos ?? {})) if (isChoice(v)) repos[k] = v
      const defaultId = accounts.some((a) => a.id === raw.defaultId) ? raw.defaultId! : (accounts[0]?.id ?? null)
      this.data = { accounts: accounts.slice(0, MAX_ACCOUNTS), defaultId, repos }
    } catch {
      // missing or unreadable: no accounts
    }
  }

  private get now(): number {
    return (this.opts.now ?? Date.now)()
  }

  list(): GhAccount[] {
    return this.data.accounts.map((a) => ({ id: a.id, login: a.login, name: a.name, scopes: a.scopes, addedAt: a.addedAt, isDefault: a.id === this.data.defaultId }))
  }

  has(id: string): boolean {
    return this.data.accounts.some((a) => a.id === id)
  }

  private async api(token: string, route: string): Promise<{ status: number; body: unknown; scopes: string | null } | null> {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? 10_000)
    try {
      const res = await this.opts.fetch(`${API}${route}`, {
        headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'User-Agent': 'Orrery', 'X-GitHub-Api-Version': '2022-11-28' },
        signal: ctrl.signal,
      })
      const body = res.status === 200 ? await res.json().catch(() => null) : null
      return { status: res.status, body, scopes: res.headers.get('x-oauth-scopes') }
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }

  /** Checks the token against `GET /user`; the same login again replaces that account's token. */
  async add(token: unknown): Promise<AddResult> {
    const tok = typeof token === 'string' ? token.trim() : ''
    if (!TOKEN.test(tok)) return { ok: false, error: 'invalid' }
    if (!this.opts.crypt.available()) return { ok: false, error: 'no-keychain' }
    const res = await this.api(tok, '/user')
    if (!res) return { ok: false, error: 'network' }
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'invalid' }
    const user = res.body as { login?: unknown; name?: unknown } | null
    if (res.status !== 200 || typeof user?.login !== 'string') return { ok: false, error: 'failed', detail: `HTTP ${res.status}` }
    const scopes = res.scopes === null ? null : res.scopes.split(',').map((s) => s.trim()).filter(Boolean)
    let sealed: string
    try {
      sealed = this.opts.crypt.encrypt(tok).toString('base64')
    } catch {
      return { ok: false, error: 'no-keychain' }
    }
    const login = user.login
    const same = this.data.accounts.find((a) => a.login.toLowerCase() === login.toLowerCase())
    if (!same && this.data.accounts.length >= MAX_ACCOUNTS) return { ok: false, error: 'failed', detail: `max ${MAX_ACCOUNTS}` }
    const entry: Stored = { id: same?.id ?? randomUUID(), login, name: typeof user.name === 'string' && user.name ? user.name : null, scopes, addedAt: this.now, token: sealed }
    this.data.accounts = same ? this.data.accounts.map((a) => (a.id === same.id ? entry : a)) : [...this.data.accounts, entry]
    this.data.defaultId ??= entry.id
    this.forgetAccess(entry.id)
    this.save()
    return { ok: true, account: this.list().find((a) => a.id === entry.id)! }
  }

  remove(id: unknown): boolean {
    if (typeof id !== 'string' || !this.has(id)) return false
    this.data.accounts = this.data.accounts.filter((a) => a.id !== id)
    if (this.data.defaultId === id) this.data.defaultId = this.data.accounts[0]?.id ?? null
    for (const [k, v] of Object.entries(this.data.repos)) if (v === id) delete this.data.repos[k]
    this.forgetAccess(id)
    this.save()
    return true
  }

  setDefault(id: unknown): boolean {
    if (typeof id !== 'string' || !this.has(id)) return false
    this.data.defaultId = id
    this.save()
    return true
  }

  choiceOf(root: string): GhRepoChoice {
    const c = this.data.repos[rootKey(root)]
    return c === 'system' || (c && this.has(c)) ? c : 'auto'
  }

  setChoice(root: string, choice: unknown): boolean {
    if (!isChoice(choice) || (choice !== 'auto' && choice !== 'system' && !this.has(choice))) return false
    const key = rootKey(root)
    delete this.data.repos[key]
    if (choice !== 'auto') this.data.repos[key] = choice
    const keys = Object.keys(this.data.repos)
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_REPOS))) delete this.data.repos[k]
    this.save()
    return true
  }

  private token(id: string): string | null {
    const a = this.data.accounts.find((x) => x.id === id)
    if (!a) return null
    try {
      return this.opts.crypt.decrypt(Buffer.from(a.token, 'base64'))
    } catch {
      return null
    }
  }

  private forgetAccess(id: string): void {
    for (const k of this.access.keys()) if (k.startsWith(`${id}\n`)) this.access.delete(k)
  }

  /** `GET /repos/{owner}/{repo}` as that account: 200 → push / read by `permissions`, 404 / 403 → none. Cached 10 min. */
  async accessOf(id: string, owner: string, repo: string): Promise<GhAccess> {
    const key = `${id}\n${owner}/${repo}`.toLowerCase()
    const hit = this.access.get(key)
    if (hit && this.now - hit.at < ACCESS_TTL_MS) return hit.value
    const token = this.token(id)
    if (!token) return 'unknown'
    const res = await this.api(token, `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`)
    const value: GhAccess = !res
      ? 'unknown'
      : res.status === 200
        ? (res.body as { permissions?: { push?: unknown } } | null)?.permissions?.push === true
          ? 'push'
          : 'read'
        : res.status === 404 || res.status === 403 || res.status === 401
          ? 'none'
          : 'unknown'
    if (value !== 'unknown') this.access.set(key, { at: this.now, value })
    return value
  }

  /** Account for `remoteUrl` of `root`: the repo's pinned choice, else the best access (default account first). */
  async resolve(root: string, remoteUrl: string): Promise<GhRepoAccount> {
    const gh = githubRepoOf(remoteUrl)
    if (!gh || !gh.https) return { github: false }
    const { owner, repo } = gh
    const choice = this.choiceOf(root)
    const view = (id: string | null, access: GhAccess): GhRepoAccount => {
      const a = id ? this.data.accounts.find((x) => x.id === id) : undefined
      return { github: true, owner, repo, choice, account: a ? { id: a.id, login: a.login } : null, access }
    }
    if (choice === 'system') return view(null, 'unknown')
    if (choice !== 'auto') return view(choice, await this.accessOf(choice, owner, repo))
    const ordered = [...this.data.accounts].sort((a, b) => Number(b.id === this.data.defaultId) - Number(a.id === this.data.defaultId))
    if (!ordered.length) return view(null, 'unknown')
    const found = await Promise.all(ordered.map(async (a) => ({ id: a.id, access: await this.accessOf(a.id, owner, repo) })))
    const best = found.find((f) => f.access === 'push') ?? found.find((f) => f.access === 'read')
    if (best) return view(best.id, best.access)
    // Offline (every probe unknown): the default account; nobody has access: Git Credential Manager as before.
    return found.every((f) => f.access === 'unknown') ? view(ordered[0]!.id, 'unknown') : view(null, 'none')
  }

  /** Env for git network commands on `remoteUrl`, or undefined to leave git's own credentials in charge. */
  async envFor(root: string, remoteUrl: string): Promise<Record<string, string> | undefined> {
    const r = await this.resolve(root, remoteUrl)
    if (!r.github || !r.account) return undefined
    const token = this.token(r.account.id)
    return token ? gitAuthEnv(token) : undefined
  }

  private save(): void {
    const file = this.opts.file
    if (!file) return
    try {
      mkdirSync(path.dirname(file), { recursive: true })
      const tmp = `${file}.tmp`
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), { mode: 0o600 })
      renameSync(tmp, file)
    } catch {
      // read-only data dir: accounts last until quit
    }
  }
}
