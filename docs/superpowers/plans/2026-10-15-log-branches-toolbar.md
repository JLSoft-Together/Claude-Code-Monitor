# Git Log Branches Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The IntelliJ / Android Studio (New UI) Branches toolbar in the Git Log: Show/Hide Branches, New Branch, Update Selected, Delete Branch, Compare with Current, Search, Fetch, Mark/Unmark Favorite, Navigate Log to Selected Branch, More (Group by folder, Show tags), Expand All, Collapse All.

**Architecture:** Desktop gains a small, validated `preview/branches.ts` (create, delete plan + run, fetch, fast-forward update; errors sanitized) behind the Log's `repoOf` check; branch delete always goes through a native confirm in main that shows the exact git command, like the Extensions tab. The log query gains `notRef` for Compare with Current. On the web side, the refs tree model gets favorites / group-by-folder / show-tags options and expandable ids; a vertical `LogRefsToolbar.vue` strip drives `LogRefsTree` and `LogPane`, which now separates the **selected** ref (toolbar target, roving focus) from the **branch filter** (click).

**Tech Stack:** Vue 3 + Tailwind v4 + vue-i18n + lucide icons (apps/web), Electron main + preload + `execGit` (apps/desktop), `@ccm/shared` types, Vitest (real temp git repos on desktop), CDP E2E.

**Spec:** User request 2026-10-15, item 5 + screenshot of the Branches panel toolbar, with the user's description: Show/Hide Branches; New Branch (+) from the selected branch or commit; Update Selected (pull/fetch the selected branches from the remote); Delete Branch (local or remote); Compare with Current (commits / diff between the selected branch and the current one); Search (find a branch by name); Fetch (all remotes); Mark/Unmark as Favorite (favorites stay on top); Navigate Log to Selected Branch (jump to its tip commit); More (⋮: Group By, show tags, …); Expand All; Collapse All. Prior: `.planning/PLAN-v30-git-log.md` (Log was read-only). Siblings split from the same request: `2026-10-15-sidebar-width.md`, `2026-10-15-jetbrains-split-diff.md`, `2026-10-15-diff-arrow-files.md`, `2026-10-15-explorer-context-menu.md`, `2026-10-15-attachments-removal.md`.

## Rulings (decided while planning — confirm or overrule before execution)

1. **The Log is no longer strictly read-only** (overrides v30 by the user's request): the toolbar may create a branch (optionally switching to it), fast-forward branches, fetch, and delete a branch. Never: force-push, non-fast-forward update, reset, deleting the current branch, deleting tags, checking out an existing branch.
2. **Delete only after a native confirm in main** showing the exact command (`git branch -d -- <name>` / `git push <remote> --delete <branch>`); an unmerged local branch needs a second native confirm for `-D`. The page cannot skip it.
3. **Update Selected = fast-forward only**: the current branch via `git pull --ff-only`, another tracked local branch via `git fetch <remote> <branch>:refs/heads/<local>` (git refuses non-fast-forward). Branches without upstream are refused.
4. **Fetch = `git fetch --all`** (no prune); network commands time out after 120 s; `GIT_TERMINAL_PROMPT=0` stays, so a missing credential fails instead of hanging.
5. **Compare with Current** = the log filtered to commits reachable from the selected branch and not from HEAD (`git log <ref> --not HEAD`), with Swap and Show all. No two-branch file diff.
6. **Star = favorite** (JetBrains). The v30 star meant "has upstream"; tracking now shows as the ↑↓ counts and in the row tooltip. Favorites are per repo in `localStorage` (`ccm.workspace.logFavorites`), default `main` / `master` when the repo has none stored; they float to the top of their section.
7. **Vertical strip** at the left edge of the Log pane (as in the screenshot); it stays visible when the branch tree is hidden; its first button is Show/Hide Branches (moved from the Log header).
8. **Selection vs filter**: the focused row of the refs tree is the toolbar's target; clicking a ref still filters the log to it (v30 behaviour).

## Global Constraints

- All UI strings via vue-i18n, `en` and `vi` with key parity (the parity test in `apps/web/src/stores/workspace.test.ts` must stay green). Native dialog strings in `apps/desktop/src/strings.ts` (`en` and `vi`).
- All colours via theme tokens (`.planning/COLOR-SYSTEM.md`): favorite star `favorite`, fetch icon `accent-ink`, errors `st-error-soft` (destructive / failure), never colour alone (icon + text).
- git runs only through `execGit` (`GIT_TERMINAL_PROMPT=0`, no pager, literal pathspecs). Page-supplied names / refs reach git only after validation (`checkBranchName` + `git check-ref-format --branch`, `REF`, `rev-parse --verify`) and after `--` where git accepts it. Error details shown in the UI are one stderr line with credentials stripped from URLs (`sanitizeGitError`).
- Storage keys keep the `ccm.` prefix: `ccm.workspace.logFavorites` (`{ [pathKey(repo)]: string[] }`, ≤ 200 refs), `ccm.workspace.logRefsView` (`{ group: boolean; tags: boolean }`).
- Reduced motion: spinners use `motion-reduce:animate-none`.
- No new npm dependency.
- Commits: gitmoji style, message ends with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Tests: `npm test -w @ccm/web -- <file>`, `npm test -w @ccm/desktop -- <file>`, `npm run typecheck`. E2E needs `npm run build -w @ccm/web && npm run build -w @ccm/desktop`, then `node apps/desktop/e2e/log.cjs`.
- After each task, add 1–2 lines per change to `.code_index/` (`web.md` / `desktop.md` / `_meta.md`); Task 7 does the final pass.

## Review Focus

1. **Git error text with a credential URL** (`https://user:token@host/repo.git`) from fetch / push → the token never reaches the page. Pinned in Task 2 (`sanitizeGitError` test).
2. **Delete aimed at the current branch, a tag, or a crafted ref** (`refs/heads/../x`) → refused before any confirm. Pinned in Task 2 (`deletePlan` tests).
3. **Unmerged local branch** → first delete reports `not-merged`; only a second, explicit confirm runs `-D`. Pinned in Task 2 (runDelete test) and Task 3 (IPC confirm test).
4. **Update of a diverged branch** (local commits + remote commits) → refused as `non-ff`, nothing rewritten. Pinned in Task 2 (non-ff test).
5. **Cancel on the native confirm** → nothing runs, the branch is still there. Pinned in Task 3 (IPC cancel test).

---

### Task 1: Shared branch types and name check

**Files:**
- Create: `packages/shared/src/gitBranch.ts`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces:

```ts
export type BranchNameProblem = 'empty' | 'space' | 'dash' | 'dots' | 'char' | 'slash' | 'lock' | 'long'
export function checkBranchName(name: unknown): { ok: true } | { ok: false; reason: BranchNameProblem }
export type BranchOpError = 'denied' | 'invalid' | 'exists' | 'not-merged' | 'current' | 'conflict' | 'no-upstream' | 'non-ff' | 'auth' | 'timeout' | 'cancelled' | 'failed'
export type BranchOpResult = { ok: true; detail?: string } | { ok: false; error: BranchOpError; detail?: string }
```

(Tested through the desktop tests in Task 2 — `packages/shared` has no test runner.)

- [ ] **Step 1: Implement** — `packages/shared/src/gitBranch.ts`

```ts
export type BranchNameProblem = 'empty' | 'space' | 'dash' | 'dots' | 'char' | 'slash' | 'lock' | 'long'

/** Quick check mirroring `git check-ref-format --branch` (main runs git's own check too). */
export function checkBranchName(name: unknown): { ok: true } | { ok: false; reason: BranchNameProblem } {
  if (typeof name !== 'string' || !name) return { ok: false, reason: 'empty' }
  if (name.length > 200) return { ok: false, reason: 'long' }
  if (/\s/.test(name)) return { ok: false, reason: 'space' }
  if (name.startsWith('-')) return { ok: false, reason: 'dash' }
  if (name.includes('..') || name.includes('@{') || name === '@') return { ok: false, reason: 'dots' }
  if (/[\x00-\x1f\x7f~^:?*[\\]/.test(name)) return { ok: false, reason: 'char' }
  if (name.startsWith('/') || name.endsWith('/') || name.includes('//') || name.endsWith('.') || /(^|\/)\./.test(name)) return { ok: false, reason: 'slash' }
  if (/\.lock(\/|$)/.test(name)) return { ok: false, reason: 'lock' }
  return { ok: true }
}

export type BranchOpError = 'denied' | 'invalid' | 'exists' | 'not-merged' | 'current' | 'conflict' | 'no-upstream' | 'non-ff' | 'auth' | 'timeout' | 'cancelled' | 'failed'

/** `detail`: one sanitized line of git's stderr (no credentials). */
export type BranchOpResult = { ok: true; detail?: string } | { ok: false; error: BranchOpError; detail?: string }
```

`packages/shared/src/index.ts`: add `export * from './gitBranch'`.

- [ ] **Step 2: Run** `npm run typecheck` — Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/gitBranch.ts packages/shared/src/index.ts
git commit -m "✨ Shared branch name check and branch operation results

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 2: Desktop branch operations

**Files:**
- Create: `apps/desktop/src/preview/branches.ts`, `apps/desktop/test/branches.test.ts`
- Modify: `apps/desktop/src/preview/log.ts:9` (export `REF`)

**Interfaces:**
- Consumes: `execGit` (`preview/gitExec.ts`), `REF` (`preview/log.ts`), Task 1 types.
- Produces:

```ts
export function sanitizeGitError(stderr: string): string
export async function createBranch(root: string, name: unknown, base: unknown, checkout: unknown): Promise<BranchOpResult>
export async function deletePlan(root: string, ref: unknown, force: boolean): Promise<{ ok: true; args: string[]; remote: boolean; label: string } | { ok: false; error: BranchOpError }>
export async function runDelete(root: string, args: string[]): Promise<BranchOpResult>
export async function fetchAll(root: string): Promise<BranchOpResult>
export async function updateBranch(root: string, ref: unknown): Promise<BranchOpResult>
```

`deletePlan` validates and returns the exact argv (shown in the native confirm, Task 3) — `runDelete` executes it.

- [ ] **Step 1: Write the failing tests** — `apps/desktop/test/branches.test.ts`

```ts
import { execFileSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkBranchName } from '@ccm/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createBranch, deletePlan, fetchAll, runDelete, sanitizeGitError, updateBranch } from '../src/preview/branches'

const tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'ccm-branches-')))
const origin = path.join(tmp, 'origin.git')
const repo = path.join(tmp, 'repo')
const other = path.join(tmp, 'other')
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim()

beforeAll(() => {
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', origin])
  execFileSync('git', ['clone', '-q', origin, repo])
  git(repo, 'checkout', '-q', '-b', 'main')
  writeFileSync(path.join(repo, 'a.txt'), '1\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-q', '-m', 'one')
  git(repo, 'push', '-q', '-u', 'origin', 'main')
  git(repo, 'branch', 'side')
  git(repo, 'push', '-q', '-u', 'origin', 'side')
  execFileSync('git', ['clone', '-q', origin, other])
})
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

describe('checkBranchName', () => {
  it('accepts normal names and rejects git-invalid ones', () => {
    expect(checkBranchName('feature/x-1')).toEqual({ ok: true })
    for (const bad of ['', 'a b', '-x', 'a..b', 'a~1', 'x.lock', 'a/', '.hidden', 'a//b', 'a:b']) expect(checkBranchName(bad).ok).toBe(false)
  })
})

describe('sanitizeGitError', () => {
  it('strips credentials from URLs and keeps one line', () => {
    expect(sanitizeGitError("fatal: unable to access 'https://bob:ghp_SECRET@github.com/o/r.git/': 403\nmore")).toBe("fatal: unable to access 'https://github.com/o/r.git/': 403")
  })
})

describe('createBranch', () => {
  it('creates from a ref, optionally switching to it', async () => {
    expect(await createBranch(repo, 'feat/a', 'refs/heads/main', false)).toEqual({ ok: true })
    expect(git(repo, 'branch', '--show-current')).toBe('main')
    expect(await createBranch(repo, 'feat/b', 'HEAD', true)).toEqual({ ok: true })
    expect(git(repo, 'branch', '--show-current')).toBe('feat/b')
    git(repo, 'checkout', '-q', 'main')
  })
  it('refuses bad names, unknown bases and existing branches', async () => {
    expect(await createBranch(repo, '-x', 'HEAD', false)).toMatchObject({ ok: false, error: 'invalid' })
    expect(await createBranch(repo, 'ok', 'refs/heads/nope', false)).toMatchObject({ ok: false, error: 'invalid' })
    expect(await createBranch(repo, 'ok', '--orphan', false)).toMatchObject({ ok: false, error: 'invalid' })
    expect(await createBranch(repo, 'feat/a', 'HEAD', false)).toMatchObject({ ok: false, error: 'exists' })
  })
})

describe('delete', () => {
  it('plans exact commands, refuses the current branch and tags', async () => {
    expect(await deletePlan(repo, 'refs/heads/feat/a', false)).toEqual({ ok: true, args: ['branch', '-d', '--', 'feat/a'], remote: false, label: 'feat/a' })
    expect(await deletePlan(repo, 'refs/heads/feat/a', true)).toMatchObject({ args: ['branch', '-D', '--', 'feat/a'] })
    expect(await deletePlan(repo, 'refs/remotes/origin/side', false)).toEqual({ ok: true, args: ['push', 'origin', '--delete', 'side'], remote: true, label: 'origin/side' })
    expect(await deletePlan(repo, 'refs/heads/main', false)).toEqual({ ok: false, error: 'current' })
    expect(await deletePlan(repo, 'refs/tags/v1', false)).toEqual({ ok: false, error: 'denied' })
    expect(await deletePlan(repo, 'refs/heads/../x', false)).toEqual({ ok: false, error: 'denied' })
  })
  it('reports an unmerged branch so the user can force it', async () => {
    git(repo, 'checkout', '-q', 'feat/a')
    writeFileSync(path.join(repo, 'b.txt'), 'b\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'two')
    git(repo, 'checkout', '-q', 'main')
    const soft = await deletePlan(repo, 'refs/heads/feat/a', false)
    expect(soft.ok && (await runDelete(repo, soft.args))).toMatchObject({ ok: false, error: 'not-merged' })
    const hard = await deletePlan(repo, 'refs/heads/feat/a', true)
    expect(hard.ok && (await runDelete(repo, hard.args))).toEqual({ ok: true })
  })
})

describe('fetch / update', () => {
  it('fetches and fast-forwards the current and a non-current branch', async () => {
    writeFileSync(path.join(other, 'a.txt'), '2\n')
    git(other, 'commit', '-q', '-am', 'remote main')
    git(other, 'push', '-q', 'origin', 'main')
    git(other, 'checkout', '-q', 'side')
    writeFileSync(path.join(other, 's.txt'), 's\n')
    git(other, 'add', '-A')
    git(other, 'commit', '-q', '-m', 'remote side')
    git(other, 'push', '-q', 'origin', 'side')
    expect(await fetchAll(repo)).toEqual({ ok: true })
    expect(await updateBranch(repo, 'refs/heads/main')).toEqual({ ok: true })
    expect(git(repo, 'rev-parse', 'main')).toBe(git(other, 'rev-parse', 'main'))
    expect(await updateBranch(repo, 'refs/heads/side')).toEqual({ ok: true })
    expect(git(repo, 'rev-parse', 'side')).toBe(git(other, 'rev-parse', 'side'))
  })
  it('refuses branches without upstream and non-fast-forward updates', async () => {
    expect(await updateBranch(repo, 'refs/heads/feat/b')).toEqual({ ok: false, error: 'no-upstream' })
    git(repo, 'checkout', '-q', 'side')
    writeFileSync(path.join(repo, 'local.txt'), 'l\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'local side')
    git(repo, 'checkout', '-q', 'main')
    git(other, 'checkout', '-q', 'side')
    writeFileSync(path.join(other, 's2.txt'), 's2\n')
    git(other, 'add', '-A')
    git(other, 'commit', '-q', '-m', 'remote side 2')
    git(other, 'push', '-q', 'origin', 'side')
    expect(await updateBranch(repo, 'refs/heads/side')).toMatchObject({ ok: false, error: 'non-ff' })
  })
})
```

- [ ] **Step 2: Run** `npm test -w @ccm/desktop -- test/branches.test.ts` — Expected: FAIL (`Cannot find module '../src/preview/branches'`).

- [ ] **Step 3: Implement**

`log.ts:9`: `export const REF = …` (add `export`).

`apps/desktop/src/preview/branches.ts`:

```ts
import { checkBranchName, type BranchOpError, type BranchOpResult } from '@ccm/shared'
import { execGit, type GitExecResult } from './gitExec'
import { REF } from './log'

const LOCAL = 20_000
const NET = { timeoutMs: 120_000 }

/** First stderr line, with `user:token@` removed from URLs: git prints remote URLs it failed on. */
export function sanitizeGitError(stderr: string): string {
  const line = stderr.split(/\r?\n/).find((l) => l.trim()) ?? ''
  return line.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s]*@/gi, '$1').slice(0, 300)
}

function failed(res: GitExecResult, fallback: BranchOpError = 'failed'): BranchOpResult {
  if (res.code === null && res.stderr !== 'git not found') return { ok: false, error: 'timeout' }
  const s = res.stderr
  const error: BranchOpError = /not fully merged/i.test(s)
    ? 'not-merged'
    : /already exists/i.test(s)
      ? 'exists'
      : /Authentication failed|could not read Username|Permission denied|403/i.test(s)
        ? 'auth'
        : /non-fast-forward|Not possible to fast-forward|rejected/i.test(s)
          ? 'non-ff'
          : /would be overwritten|conflict/i.test(s)
            ? 'conflict'
            : fallback
  return { ok: false, error, detail: sanitizeGitError(s) }
}

const validRef = (ref: unknown): ref is string => typeof ref === 'string' && (ref === 'HEAD' || (REF.test(ref) && !ref.includes('..') && !ref.endsWith('.lock')))

async function currentBranch(root: string): Promise<string | null> {
  const res = await execGit(root, ['symbolic-ref', '-q', '--short', 'HEAD'], { timeoutMs: LOCAL })
  return res.code === 0 ? res.stdout.trim() || null : null
}

/** New branch `name` at `base` (a listed ref, `HEAD` or a commit hash); `checkout` switches to it (`git switch -c`). */
export async function createBranch(root: string, name: unknown, base: unknown, checkout: unknown): Promise<BranchOpResult> {
  if (!checkBranchName(name).ok) return { ok: false, error: 'invalid' }
  const fmt = await execGit(root, ['check-ref-format', '--branch', name as string], { timeoutMs: LOCAL })
  if (fmt.code !== 0) return { ok: false, error: 'invalid' }
  const baseOk = validRef(base) || (typeof base === 'string' && /^[0-9a-f]{4,40}$/.test(base))
  if (!baseOk) return { ok: false, error: 'invalid' }
  const verify = await execGit(root, ['rev-parse', '--verify', '-q', `${base as string}^{commit}`], { timeoutMs: LOCAL })
  if (verify.code !== 0) return { ok: false, error: 'invalid' }
  const start = verify.stdout.trim()
  const res =
    checkout === true
      ? await execGit(root, ['switch', '-c', name as string, start], { timeoutMs: LOCAL })
      : await execGit(root, ['branch', '--', name as string, start], { timeoutMs: LOCAL })
  return res.code === 0 ? { ok: true } : failed(res)
}

/**
 * Exact git argv for deleting `ref`: local `branch -d|-D -- <name>`, remote `push <remote> --delete <branch>`.
 * Never the current branch, never tags. The caller shows `args` in a native confirm before `runDelete`.
 */
export async function deletePlan(root: string, ref: unknown, force: boolean): Promise<{ ok: true; args: string[]; remote: boolean; label: string } | { ok: false; error: BranchOpError }> {
  if (!validRef(ref) || ref === 'HEAD' || ref.startsWith('refs/tags/')) return { ok: false, error: 'denied' }
  if (ref.startsWith('refs/heads/')) {
    const name = ref.slice('refs/heads/'.length)
    if ((await currentBranch(root)) === name) return { ok: false, error: 'current' }
    return { ok: true, args: ['branch', force ? '-D' : '-d', '--', name], remote: false, label: name }
  }
  const short = ref.slice('refs/remotes/'.length)
  const remotes = (await execGit(root, ['remote'], { timeoutMs: LOCAL })).stdout.split(/\r?\n/).filter(Boolean)
  const remote = remotes.filter((r) => short.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0]
  const branch = remote ? short.slice(remote.length + 1) : ''
  if (!remote || !branch || branch === 'HEAD' || !checkBranchName(branch).ok) return { ok: false, error: 'denied' }
  return { ok: true, args: ['push', remote, '--delete', branch], remote: true, label: short }
}

export async function runDelete(root: string, args: string[]): Promise<BranchOpResult> {
  const res = await execGit(root, args, args[0] === 'push' ? NET : { timeoutMs: LOCAL })
  return res.code === 0 ? { ok: true } : failed(res)
}

/** `git fetch --all` (no prune): new branches and commits from every remote. */
export async function fetchAll(root: string): Promise<BranchOpResult> {
  const res = await execGit(root, ['fetch', '--all', '--no-write-fetch-head'], NET)
  return res.code === 0 ? { ok: true } : failed(res)
}

/**
 * Update Selected (fast-forward only): the current branch via `pull --ff-only`; another tracked local branch via
 * `fetch <remote> <branch>:refs/heads/<local>`, which git refuses when it is not a fast-forward.
 */
export async function updateBranch(root: string, ref: unknown): Promise<BranchOpResult> {
  if (!validRef(ref) || !ref.startsWith('refs/heads/')) return { ok: false, error: 'denied' }
  const local = ref.slice('refs/heads/'.length)
  const up = await execGit(root, ['for-each-ref', '--format=%(upstream:remotename)%1f%(upstream:remoteref)', ref], { timeoutMs: LOCAL })
  const [remote, remoteRef] = up.stdout.trim().split('\x1f')
  if (!remote || !remoteRef?.startsWith('refs/heads/')) return { ok: false, error: 'no-upstream' }
  const res =
    (await currentBranch(root)) === local
      ? await execGit(root, ['pull', '--ff-only', '--no-rebase'], NET)
      : await execGit(root, ['fetch', remote, `${remoteRef}:${ref}`], NET)
  return res.code === 0 ? { ok: true } : failed(res, 'non-ff')
}
```

- [ ] **Step 4: Run** `npm test -w @ccm/desktop -- test/branches.test.ts` — Expected: PASS (9 tests). If git prints `Not possible to fast-forward` only in newer versions, the `failed(res, 'non-ff')` fallback still returns `non-ff`.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/preview/branches.ts apps/desktop/src/preview/log.ts apps/desktop/test/branches.test.ts
git commit -m "✨ Desktop branch operations: create, delete plan, fetch, fast-forward update

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 3: Branch IPC with a native confirm for delete

**Files:**
- Modify: `apps/desktop/src/preview/ipc.ts` (deps, CHANNELS, handlers), `apps/desktop/src/main.ts:597-620`, `apps/desktop/src/strings.ts`, `apps/desktop/src/preload.ts`, `apps/web/src/lib/preview.ts`
- Test: `apps/desktop/test/branches.test.ts` (append IPC block)

**Interfaces:**
- Consumes: Task 2.
- Produces: deps field `confirmGit?: (req: { title: string; commands: string[]; force?: boolean }) => Promise<boolean>` on `PreviewIpcDeps`; IPC `ccm:git-branch-create {root,name,base,checkout}`, `ccm:git-branch-delete {root,ref}`, `ccm:git-fetch root`, `ccm:git-branch-update {root,ref}` → `BranchOpResult`; preload/web `gitBranchCreate(root, name, base, checkout)`, `gitBranchDelete(root, ref)`, `gitFetch(root)`, `gitBranchUpdate(root, ref)`, `hasBranchOps`.

Delete flow in main: plan (`-d`) → native confirm with the command → run; on `not-merged`, a second native confirm with the `-D` command (`force: true` wording) → run. Cancel at any step returns `{ ok: false, error: 'cancelled' }`.

- [ ] **Step 1: Write the failing test** — append to `apps/desktop/test/branches.test.ts`:

```ts
import { registerPreviewIpc } from '../src/preview/ipc'
import type { PreviewServer } from '../src/preview/server'
import type { RootWatcher } from '../src/preview/watch'

describe('branch IPC', () => {
  type Handler = (event: unknown, ...args: unknown[]) => unknown
  const handlers = new Map<string, Handler>()
  const asked: string[][] = []
  let answer = true
  registerPreviewIpc({
    ipcMain: { handle: (ch: string, fn: Handler) => handlers.set(ch, fn), removeHandler: (ch: string) => handlers.delete(ch) } as never,
    isAppFrame: () => true,
    server: { tokensUnder: () => [] } as unknown as PreviewServer,
    watcher: { listen: () => undefined, add: () => true, remove: () => undefined } as unknown as RootWatcher,
    shell: {} as never,
    dialog: {} as never,
    getWindow: () => null,
    getRoots: () => [repo],
    confirmAccess: async () => false,
    confirmGit: async (req) => {
      asked.push(req.commands)
      return answer
    },
  })
  const call = (ch: string, arg: unknown) => Promise.resolve(handlers.get(ch)!({ sender: { id: 1 } }, arg))

  it('asks before deleting and runs nothing when cancelled', async () => {
    git(repo, 'branch', 'tmp-del')
    answer = false
    expect(await call('ccm:git-branch-delete', { root: repo, ref: 'refs/heads/tmp-del' })).toEqual({ ok: false, error: 'cancelled' })
    expect(asked.at(-1)).toEqual(['git branch -d -- tmp-del'])
    expect(git(repo, 'branch', '--list', 'tmp-del')).toContain('tmp-del')
    answer = true
    expect(await call('ccm:git-branch-delete', { root: repo, ref: 'refs/heads/tmp-del' })).toEqual({ ok: true })
  })

  it('creates without a confirm and refuses unknown roots', async () => {
    expect(await call('ccm:git-branch-create', { root: repo, name: 'ipc-new', base: 'HEAD', checkout: false })).toEqual({ ok: true })
    expect(await call('ccm:git-branch-create', { root: tmp, name: 'x', base: 'HEAD', checkout: false })).toEqual({ ok: false, error: 'denied' })
  })
})
```

- [ ] **Step 2: Run** `npm test -w @ccm/desktop -- test/branches.test.ts` — Expected: FAIL (no handler for `ccm:git-branch-delete`).

- [ ] **Step 3: Implement**

`ipc.ts`:
- Deps interface: `/** Native yes/no showing the exact git commands; the page cannot delete a branch without it. */ confirmGit?: (req: { title: string; commands: string[]; force?: boolean }) => Promise<boolean>`.
- CHANNELS: add `'ccm:git-branch-create', 'ccm:git-branch-delete', 'ccm:git-fetch', 'ccm:git-branch-update',`.
- Import `createBranch, deletePlan, fetchAll, runDelete, updateBranch` from `./branches`.
- Handlers (after the log handlers; `logRepo`/`denied` are already in scope):

```ts
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
    if (!(await deps.confirmGit({ title: plan.label, commands: [`git ${plan.args.join(' ')}`] }))) return { ok: false, error: 'cancelled' }
    const res = await runDelete(repo, plan.args)
    if (res.ok || res.error !== 'not-merged' || plan.remote) return res
    const force = await deletePlan(repo, ref, true)
    if (!force.ok) return force
    if (!(await deps.confirmGit({ title: force.label, commands: [`git ${force.args.join(' ')}`], force: true }))) return { ok: false, error: 'cancelled' }
    return runDelete(repo, force.args)
  })

  ipcMain.handle('ccm:git-fetch', async (event, root: unknown) => {
    const repo = await logRepo(event, root)
    return repo ? fetchAll(repo) : denied
  })

  ipcMain.handle('ccm:git-branch-update', async (event, req: unknown) => {
    const { root, ref } = (req ?? {}) as { root?: unknown; ref?: unknown }
    const repo = await logRepo(event, root)
    return repo ? updateBranch(repo, ref) : denied
  })
```

`strings.ts` (en, then the same keys in vi):

```ts
  gitDeleteTitle: (name: string) => `Delete branch ${name}?`,
  gitForceTitle: (name: string) => `${name} is not fully merged. Delete it anyway?`,
  gitDeleteDetail: (commands: string[]) => `Agent Monitor will run:\n\n${commands.join('\n')}\n\nCommits only on this branch can be lost.`,
  gitDeleteConfirm: 'Delete',
  gitDeleteCancel: 'Cancel',
```

```ts
  gitDeleteTitle: (name) => `Xoá nhánh ${name}?`,
  gitForceTitle: (name) => `${name} chưa được merge hết. Vẫn xoá?`,
  gitDeleteDetail: (commands) => `Agent Monitor sẽ chạy:\n\n${commands.join('\n')}\n\nCác commit chỉ có trên nhánh này có thể bị mất.`,
  gitDeleteConfirm: 'Xoá',
  gitDeleteCancel: 'Huỷ',
```

`main.ts` in `registerPreviewIpc({ … })` after `confirmAccess`:

```ts
    confirmGit: async (req) => {
      const opts: Electron.MessageBoxOptions = {
        type: 'warning',
        message: req.force ? t.gitForceTitle(req.title) : t.gitDeleteTitle(req.title),
        detail: t.gitDeleteDetail(req.commands),
        buttons: [t.gitDeleteConfirm, t.gitDeleteCancel],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      }
      const { response } = mainWindow ? await dialog.showMessageBox(mainWindow, opts) : await dialog.showMessageBox(opts)
      return response === 0
    },
```

`preload.ts` (after `logDiff`):

```ts
  gitBranchCreate: (root: string, name: string, base: string, checkout: boolean): Promise<unknown> => ipcRenderer.invoke('ccm:git-branch-create', { root, name, base, checkout }),
  gitBranchDelete: (root: string, ref: string): Promise<unknown> => ipcRenderer.invoke('ccm:git-branch-delete', { root, ref }),
  gitFetch: (root: string): Promise<unknown> => ipcRenderer.invoke('ccm:git-fetch', root),
  gitBranchUpdate: (root: string, ref: string): Promise<unknown> => ipcRenderer.invoke('ccm:git-branch-update', { root, ref }),
```

`apps/web/src/lib/preview.ts` — `PreviewBridge` gains the four optional methods typed `Promise<BranchOpResult>` (import `type BranchOpResult` from `@ccm/shared`), and:

```ts
const noBranchOps: BranchOpResult = { ok: false, error: 'denied' }
export const hasBranchOps = typeof bridge?.gitFetch === 'function'
export const gitBranchCreate = (root: string, name: string, base: string, checkout: boolean): Promise<BranchOpResult> => bridge?.gitBranchCreate?.(root, name, base, checkout) ?? Promise.resolve(noBranchOps)
export const gitBranchDelete = (root: string, ref: string): Promise<BranchOpResult> => bridge?.gitBranchDelete?.(root, ref) ?? Promise.resolve(noBranchOps)
export const gitFetch = (root: string): Promise<BranchOpResult> => bridge?.gitFetch?.(root) ?? Promise.resolve(noBranchOps)
export const gitBranchUpdate = (root: string, ref: string): Promise<BranchOpResult> => bridge?.gitBranchUpdate?.(root, ref) ?? Promise.resolve(noBranchOps)
```

- [ ] **Step 4: Run** `npm test -w @ccm/desktop && npm run typecheck` — Expected: PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/preview/ipc.ts apps/desktop/src/main.ts apps/desktop/src/strings.ts apps/desktop/src/preload.ts apps/web/src/lib/preview.ts apps/desktop/test/branches.test.ts
git commit -m "✨ Branch IPC; deleting a branch needs a native confirm with the git command

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 4: Compare with Current — `notRef` in the log query

**Files:**
- Modify: `packages/shared/src/gitlog.ts:42-54`, `apps/desktop/src/preview/log.ts:77-104`, `apps/web/src/lib/logQuery.ts:6-49`
- Test: `apps/desktop/test/log.test.ts` (append), `apps/web/src/lib/logQuery.test.ts` (append)

**Interfaces:**
- Produces: `LogQuery.notRef: string | null` (desktop + shared); `LogFilters.notRef: string | null` (web), `emptyFilters().notRef === null`; `graphMode` → `'flat'` and `hasFilters` → true when `notRef` is set.

- [ ] **Step 1: Write the failing tests**

`apps/desktop/test/log.test.ts`:

```ts
describe('notRef (Compare with Current)', () => {
  it('excludes commits reachable from notRef', () => {
    const q = cleanLogQuery({ branch: 'refs/heads/feature', notRef: 'HEAD' }, '/r')
    expect(q.notRef).toBe('HEAD')
    expect(logArgs(q).slice(-4)).toEqual(['refs/heads/feature', '--not', 'HEAD', '--'])
  })
  it('drops notRef without a branch or when invalid', () => {
    expect(cleanLogQuery({ notRef: 'HEAD' }, '/r').notRef).toBeNull()
    expect(cleanLogQuery({ branch: 'HEAD', notRef: '--all' }, '/r').notRef).toBeNull()
  })
})
```

Existing exact expectations gain the new field: every `toEqual` on a whole `cleanLogQuery(…)` result in `apps/desktop/test/log.test.ts` adds `notRef: null`.

`apps/web/src/lib/logQuery.test.ts`:

```ts
describe('notRef', () => {
  it('passes through and forces the flat list', () => {
    const f = { ...emptyFilters(), branch: 'refs/heads/feature', notRef: 'HEAD' }
    expect(toQuery(f, NOW).notRef).toBe('HEAD')
    expect(toQuery({ ...f, branch: null }, NOW).notRef).toBeNull()
    expect(graphMode(f)).toBe('flat')
    expect(hasFilters({ ...emptyFilters(), notRef: 'HEAD' })).toBe(true)
  })
})
```

The first test (`'maps empty filters to the full history'`, line 8) gains `notRef: null` in its expected object.

- [ ] **Step 2: Run** `npm test -w @ccm/desktop -- test/log.test.ts && npm test -w @ccm/web -- src/lib/logQuery.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

`gitlog.ts` `LogQuery`: add `/** With \`branch\`: hide commits reachable from this ref (\`git log <branch> --not <notRef>\`). */ notRef: string | null`.

`log.ts` `cleanLogQuery`: factor the branch validation into `const refOk = (v: unknown): v is string => typeof v === 'string' && (v === 'HEAD' || (REF.test(v) && !v.includes('..') && !v.endsWith('.lock')))`; `const branch = refOk(o.branch) ? o.branch : null`; `const notRef = branch && refOk(o.notRef) && o.notRef !== branch ? o.notRef : null`; include `notRef` in the returned object. `logArgs`: replace the push of refs with

```ts
  args.push(...(q.branch ? [q.branch, ...(q.notRef ? ['--not', q.notRef] : [])] : ['--branches', '--remotes', '--tags', 'HEAD']), '--', ...q.paths)
```

`logQuery.ts`: `LogFilters.notRef: string | null` (doc: `/** Compare with Current: commits in \`branch\` not in this ref. */`); `emptyFilters` adds `notRef: null`; `toQuery` returns `notRef: f.branch ? f.notRef : null`; `graphMode` condition adds `|| f.notRef`; `hasFilters` adds `|| f.notRef`.

- [ ] **Step 4: Run** `npm test -w @ccm/desktop && npm test -w @ccm/web && npm run typecheck` — Expected: PASS; clean.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/gitlog.ts apps/desktop/src/preview/log.ts apps/desktop/test/log.test.ts apps/web/src/lib/logQuery.ts apps/web/src/lib/logQuery.test.ts
git commit -m "✨ Log query: commits in a branch but not in another (Compare with Current)

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 5: Refs tree model — favorites, group by folder, show tags, folder ids

**Files:**
- Create: `apps/web/src/lib/refPrefs.ts`, `apps/web/src/lib/refPrefs.test.ts`
- Modify: `apps/web/src/lib/gitRefs.ts:63-126`, `apps/web/src/lib/gitRefs.test.ts` (append)

**Interfaces:**
- Produces:

```ts
// gitRefs.ts
export interface RefTreeOpts { favorites: ReadonlySet<string>; group: boolean; tags: boolean }
export function refTree(refs: RefsOk, filter: string, collapsed: ReadonlySet<string>, opts?: RefTreeOpts): RefRow[]   // RefRow 'ref' gains `favorite: boolean`
export function expandableIds(refs: RefsOk, opts?: RefTreeOpts): string[]
// refPrefs.ts
export const FAVORITES_KEY = 'ccm.workspace.logFavorites'
export const REFS_VIEW_KEY = 'ccm.workspace.logRefsView'
export function readFavorites(repo: string, refs: RefsOk): Set<string>
export function writeFavorites(repo: string, favs: ReadonlySet<string>): void
export function readRefsView(): { group: boolean; tags: boolean }
export function writeRefsView(v: { group: boolean; tags: boolean }): void
```

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/src/lib/gitRefs.test.ts` (reuse the file's existing `RefsOk` fixture builder; the sample below builds its own):

```ts
import { expandableIds, refTree } from './gitRefs'

const R = {
  ok: true as const,
  root: '/r',
  head: { branch: 'main', hash: 'a'.repeat(40) },
  local: [
    { ref: 'refs/heads/main', name: 'main', hash: 'a', upstream: 'origin/main', ahead: 0, behind: 0, gone: false },
    { ref: 'refs/heads/feature/x', name: 'feature/x', hash: 'b', upstream: null, ahead: 0, behind: 0, gone: false },
    { ref: 'refs/heads/zeta', name: 'zeta', hash: 'c', upstream: null, ahead: 0, behind: 0, gone: false },
  ],
  remotes: [{ name: 'origin', refs: [{ ref: 'refs/remotes/origin/main', name: 'origin/main', hash: 'a' }] }],
  tags: [{ ref: 'refs/tags/v1', name: 'v1', hash: 'a' }],
  me: null,
}
const names = (rows: ReturnType<typeof refTree>) => rows.map((r) => (r.kind === 'ref' ? r.name : r.kind === 'folder' ? `[${r.name}]` : `#${r.section}`))

describe('refTree options', () => {
  it('floats favorites to the top of their section and flags them', () => {
    const rows = refTree(R as never, '', new Set(), { favorites: new Set(['refs/heads/zeta']), group: true, tags: true })
    expect(names(rows).slice(0, 5)).toEqual(['#head', '#local', 'zeta', 'main', '[feature]'])
    expect(rows.find((r) => r.kind === 'ref' && r.name === 'zeta')).toMatchObject({ favorite: true })
  })
  it('lists full names without folders when grouping is off', () => {
    expect(names(refTree(R as never, '', new Set(), { favorites: new Set(), group: false, tags: true }))).toContain('feature/x')
    expect(names(refTree(R as never, '', new Set(), { favorites: new Set(), group: false, tags: true }))).not.toContain('[feature]')
  })
  it('hides the Tags section when tags are off', () => {
    expect(names(refTree(R as never, '', new Set(), { favorites: new Set(), group: true, tags: false }))).not.toContain('#tags')
  })
  it('lists every expandable id for Collapse All', () => {
    expect(expandableIds(R as never).sort()).toEqual(['local', 'local/feature', 'remote', 'remote/origin', 'tags'].sort())
  })
})
```

`apps/web/src/lib/refPrefs.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { FAVORITES_KEY, readFavorites, readRefsView, writeFavorites, writeRefsView } from './refPrefs'

const refs = { local: [{ ref: 'refs/heads/main' }, { ref: 'refs/heads/dev' }] } as never

describe('refPrefs', () => {
  beforeEach(() => localStorage.clear())
  it('defaults favorites to main / master that exist', () => {
    expect([...readFavorites('/r', refs)]).toEqual(['refs/heads/main'])
  })
  it('stores favorites per repo, an empty set included', () => {
    writeFavorites('/r', new Set())
    expect([...readFavorites('/r', refs)]).toEqual([])
    writeFavorites('/r', new Set(['refs/heads/dev']))
    expect([...readFavorites('/r', refs)]).toEqual(['refs/heads/dev'])
    expect(JSON.parse(localStorage.getItem(FAVORITES_KEY)!)).toHaveProperty(['/r'])
  })
  it('remembers the view options', () => {
    expect(readRefsView()).toEqual({ group: true, tags: true })
    writeRefsView({ group: false, tags: false })
    expect(readRefsView()).toEqual({ group: false, tags: false })
  })
})
```

- [ ] **Step 2: Run** `npm test -w @ccm/web -- src/lib/gitRefs.test.ts src/lib/refPrefs.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement**

`gitRefs.ts`:
- `RefRow` `'ref'` variant and `Leaf` gain `favorite: boolean`; every place that builds a `Leaf` sets `favorite: opts.favorites.has(<ref>)`.
- `export interface RefTreeOpts { favorites: ReadonlySet<string>; group: boolean; tags: boolean }` and `const DEFAULT_OPTS: RefTreeOpts = { favorites: new Set(), group: true, tags: true }`.
- `nest(…)` gains a `group: boolean` parameter: when `!group`, every leaf is "direct" with `leaf = l.name.slice(strip.length)`. Sort direct leaves favorites first, keeping their order otherwise:

```ts
  const direct: Leaf[] = []
  // …existing split; when !group push every leaf to direct…
  direct.sort((a, b) => Number(b.favorite) - Number(a.favorite))
```

- `refTree(refs, filter, collapsed, opts = DEFAULT_OPTS)` passes `opts.group` to `nest`, sets `favorite` on leaves, and wraps the tags section in `if (opts.tags) section('tags', …)`.
- Add:

```ts
/** Ids of every section and folder (Collapse All collapses them, Expand All clears the set). */
export function expandableIds(refs: RefsOk, opts: RefTreeOpts = DEFAULT_OPTS): string[] {
  const all = refTree(refs, '', new Set(), opts)
  return all.filter((r) => r.kind === 'folder' || (r.kind === 'section' && r.section !== 'head')).map((r) => r.id)
}
```

`refPrefs.ts`:

```ts
import type { RefsOk } from './gitRefs'
import { pathKey } from './changesView'

export const FAVORITES_KEY = 'ccm.workspace.logFavorites'
export const REFS_VIEW_KEY = 'ccm.workspace.logRefsView'

function readJson<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null
  } catch {
    return null
  }
}
function writeJson(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    // preference only
  }
}

/** Favorite refs of a repo; never set yet → `main` / `master` when they exist (IntelliJ default). */
export function readFavorites(repo: string, refs: RefsOk): Set<string> {
  const all = readJson<Record<string, string[]>>(FAVORITES_KEY)
  const mine = all && typeof all === 'object' ? all[pathKey(repo)] : undefined
  if (Array.isArray(mine)) return new Set(mine.filter((r) => typeof r === 'string'))
  return new Set(refs.local.map((l) => l.ref).filter((r) => r === 'refs/heads/main' || r === 'refs/heads/master'))
}

export function writeFavorites(repo: string, favs: ReadonlySet<string>): void {
  const all = readJson<Record<string, string[]>>(FAVORITES_KEY) ?? {}
  all[pathKey(repo)] = [...favs].slice(0, 200)
  writeJson(FAVORITES_KEY, all)
}

export function readRefsView(): { group: boolean; tags: boolean } {
  const v = readJson<{ group?: unknown; tags?: unknown }>(REFS_VIEW_KEY)
  return { group: v?.group !== false, tags: v?.tags !== false }
}

export function writeRefsView(v: { group: boolean; tags: boolean }): void {
  writeJson(REFS_VIEW_KEY, v)
}
```

(The `refPrefs` test uses `'/r'`; `pathKey('/r')` is `'/r'` on Windows CI as it has no drive letter, so `toHaveProperty(['/r'])` holds.)

- [ ] **Step 4: Run** `npm test -w @ccm/web && npm run typecheck` — Expected: PASS; clean (existing `refTree` tests keep passing with the default options).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/gitRefs.ts apps/web/src/lib/gitRefs.test.ts apps/web/src/lib/refPrefs.ts apps/web/src/lib/refPrefs.test.ts
git commit -m "✨ Refs tree: favorites first, group by folder, hide tags, expandable ids

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

### Task 6: Branches toolbar strip, new-branch sheet and Log wiring

**Files:**
- Create: `apps/web/src/components/workspace/log/LogRefsToolbar.vue`, `apps/web/src/components/workspace/log/NewBranchDialog.vue`
- Modify: `log/LogRefsTree.vue`, `log/LogPane.vue:276-302`, `log/LogTable.vue:82,131`, `apps/web/src/composables/useGitLog.ts`, `apps/web/src/i18n/workspace-log.ts`, `apps/desktop/e2e/log.cjs`

**Interfaces:**
- Consumes: Tasks 1–5 (`BranchOpResult`, `checkBranchName`, `gitBranchCreate/Delete/Update`, `gitFetch`, `hasBranchOps`, `LogFilters.notRef`, `refTree` opts, `expandableIds`, `readFavorites/writeFavorites/readRefsView/writeRefsView`).
- Produces:
  - `LogRefsToolbar` props `{ open: boolean; selected: RefRow | null; busy: 'fetch' | 'update' | null; view: { group: boolean; tags: boolean }; canWrite: boolean }`, emits `toggle`, `newBranch`, `update`, `remove`, `compare`, `search`, `fetch`, `favorite`, `navigate`, `view: [{ group: boolean; tags: boolean }]`, `expandAll`, `collapseAll`. DOM `[data-refs-toolbar]`, buttons `[data-refs-action=<emit name>]`.
  - `LogRefsTree` new props `{ repo: string; favorites: ReadonlySet<string>; view: { group: boolean; tags: boolean } }`, `v-model:collapsed` (`Set<string>`), emits `select: [row: RefRow | null]` (focused row = toolbar target) in addition to `pick`; expose `focusSearch()`.
  - `LogTable` expose `scrollToHash(hash: string): boolean`.
  - `useGitLog` `reveal(hash: string, maxPages = 10): Promise<boolean>` (loads pages until the commit is listed, then selects it).
  - `NewBranchDialog` props `{ request: { base: string; baseLabel: string } | null }`, emits `create: [name: string, checkout: boolean]`, `close`.

- [ ] **Step 1: `useGitLog.reveal`** — add before `return` and include in the returned object:

```ts
  /** Navigate Log to a commit: load pages until it is listed (at most `maxPages`), then select it. */
  async function reveal(hash: string, maxPages = 10): Promise<boolean> {
    for (let i = 0; i <= maxPages; i++) {
      if (commits.value.some((c) => c.hash === hash)) {
        select(hash)
        return true
      }
      if (!more.value) return false
      await loadMore()
    }
    return false
  }
```

- [ ] **Step 2: `LogTable.scrollToHash`** — next to `scrollToIndex` (line 82):

```ts
function scrollToHash(hash: string): boolean {
  const i = props.commits.findIndex((c) => c.hash === hash)
  if (i < 0) return false
  scrollToIndex(i)
  return true
}
```

(If rows are indexed through `rows`/`flatRows` rather than `commits`, use the same array `scrollToIndex` indexes.) `defineExpose({ focus: () => scroller.value?.focus(), scrollToHash })`.

- [ ] **Step 3: `LogRefsToolbar.vue`**

```vue
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDownToLine, Check, ChevronsDownUp, ChevronsUpDown, Columns2, Crosshair, EllipsisVertical, LoaderCircle, PanelLeft, Plus, RefreshCw, Search, Star, Trash2 } from 'lucide-vue-next'
import type { RefRow } from '../../../lib/gitRefs'

const props = defineProps<{ open: boolean; selected: RefRow | null; busy: 'fetch' | 'update' | null; view: { group: boolean; tags: boolean }; canWrite: boolean }>()
const emit = defineEmits<{
  toggle: []
  newBranch: []
  update: []
  remove: []
  compare: []
  search: []
  fetch: []
  favorite: []
  navigate: []
  view: [v: { group: boolean; tags: boolean }]
  expandAll: []
  collapseAll: []
}>()
const { t } = useI18n()

const target = computed(() => (props.selected?.kind === 'ref' ? props.selected : null))
const isLocal = computed(() => target.value?.refKind === 'local')
const isBranch = computed(() => target.value?.refKind === 'local' || target.value?.refKind === 'remote')
/** More (⋮) popover: two checkboxes, fixed next to the button (teleported out of the pane's overflow). */
const more = ref<{ left: number; top: number } | null>(null)
const moreBtn = ref<HTMLButtonElement | null>(null)
const moreEl = ref<HTMLElement | null>(null)

const B = 'inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-inner text-ink-muted hover:bg-fill hover:text-ink disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent aria-pressed:text-accent-ink'
const ROW = 'flex h-7 w-full cursor-pointer items-center gap-2 rounded-inner px-2 text-left text-xs text-ink hover:bg-fill focus-visible:bg-accent focus-visible:text-on-accent focus-visible:outline-none'
const L = (k: string): string => t(`workspace.log.branches.${k}`)

function onOutside(e: PointerEvent): void {
  const target = e.target as Node
  if (!moreEl.value?.contains(target) && !moreBtn.value?.contains(target)) closeMore(false)
}
async function toggleMore(): Promise<void> {
  if (more.value) return closeMore(true)
  const r = moreBtn.value!.getBoundingClientRect()
  more.value = { left: Math.min(r.right + 4, window.innerWidth - 220), top: Math.min(r.top, window.innerHeight - 90) }
  document.addEventListener('pointerdown', onOutside, true)
  await nextTick()
  moreEl.value?.querySelector<HTMLElement>('[role=menuitemcheckbox]')?.focus()
}
function closeMore(refocus: boolean): void {
  more.value = null
  document.removeEventListener('pointerdown', onOutside, true)
  if (refocus) moreBtn.value?.focus()
}
function onMoreKey(e: KeyboardEvent): void {
  const items = [...(moreEl.value?.querySelectorAll<HTMLElement>('[role=menuitemcheckbox]') ?? [])]
  const at = items.indexOf(document.activeElement as HTMLElement)
  if (e.key === 'Escape' || e.key === 'Tab') closeMore(true)
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
  else return
  e.preventDefault()
  e.stopPropagation()
}
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside, true))
</script>

<template>
  <div class="flex w-8 shrink-0 flex-col items-center gap-0.5 border-r border-line py-1" role="toolbar" aria-orientation="vertical" :aria-label="L('toolbar')" data-refs-toolbar>
    <button type="button" :class="B" :aria-pressed="open" :title="t(open ? 'workspace.log.refs.hide' : 'workspace.log.refs.show')" :aria-label="t(open ? 'workspace.log.refs.hide' : 'workspace.log.refs.show')" data-refs-action="toggle" @click="emit('toggle')">
      <PanelLeft :size="15" aria-hidden="true" />
    </button>
    <template v-if="open">
      <span class="my-0.5 h-px w-4 bg-line" aria-hidden="true" />
      <button type="button" :class="B" :disabled="!canWrite" :title="L('new')" :aria-label="L('new')" data-refs-action="newBranch" @click="emit('newBranch')"><Plus :size="15" aria-hidden="true" /></button>
      <button type="button" :class="B" :disabled="!canWrite || !isLocal || !!busy" :title="L('update')" :aria-label="L('update')" data-refs-action="update" @click="emit('update')">
        <LoaderCircle v-if="busy === 'update'" :size="15" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <ArrowDownToLine v-else :size="15" aria-hidden="true" />
      </button>
      <button type="button" :class="B" :disabled="!canWrite || !isBranch || !!target?.current" :title="L('delete')" :aria-label="L('delete')" data-refs-action="remove" @click="emit('remove')"><Trash2 :size="15" aria-hidden="true" /></button>
      <button type="button" :class="B" :disabled="!isBranch || !!target?.current" :title="L('compare')" :aria-label="L('compare')" data-refs-action="compare" @click="emit('compare')"><Columns2 :size="15" aria-hidden="true" /></button>
      <button type="button" :class="B" :title="L('search')" :aria-label="L('search')" data-refs-action="search" @click="emit('search')"><Search :size="15" aria-hidden="true" /></button>
      <button type="button" :class="B" :disabled="!canWrite || !!busy" :title="L('fetch')" :aria-label="L('fetch')" data-refs-action="fetch" @click="emit('fetch')">
        <LoaderCircle v-if="busy === 'fetch'" :size="15" class="animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <RefreshCw v-else :size="15" class="text-accent-ink" aria-hidden="true" />
      </button>
      <button type="button" :class="B" :disabled="!isBranch" :aria-pressed="!!target?.favorite" :title="L(target?.favorite ? 'unfavorite' : 'favorite')" :aria-label="L(target?.favorite ? 'unfavorite' : 'favorite')" data-refs-action="favorite" @click="emit('favorite')">
        <Star :size="15" :class="target?.favorite ? 'fill-current text-favorite' : ''" aria-hidden="true" />
      </button>
      <button type="button" :class="B" :disabled="!target" :title="L('navigate')" :aria-label="L('navigate')" data-refs-action="navigate" @click="emit('navigate')"><Crosshair :size="15" aria-hidden="true" /></button>
      <button ref="moreBtn" type="button" :class="B" :title="L('more')" :aria-label="L('more')" aria-haspopup="menu" :aria-expanded="!!more" data-refs-action="more" @click="toggleMore"><EllipsisVertical :size="15" aria-hidden="true" /></button>
      <span class="my-0.5 h-px w-4 bg-line" aria-hidden="true" />
      <button type="button" :class="B" :title="L('expandAll')" :aria-label="L('expandAll')" data-refs-action="expandAll" @click="emit('expandAll')"><ChevronsUpDown :size="15" aria-hidden="true" /></button>
      <button type="button" :class="B" :title="L('collapseAll')" :aria-label="L('collapseAll')" data-refs-action="collapseAll" @click="emit('collapseAll')"><ChevronsDownUp :size="15" aria-hidden="true" /></button>
    </template>
    <Teleport to="body">
      <Transition name="ccm-menu">
        <div
          v-if="more"
          ref="moreEl"
          class="ccm-menu fixed z-50 flex w-52 flex-col p-1"
          style="--ccm-origin: left top"
          :style="{ left: `${more.left}px`, top: `${more.top}px` }"
          role="menu"
          :aria-label="L('more')"
          data-refs-more
          @keydown="onMoreKey"
        >
          <button type="button" role="menuitemcheckbox" :aria-checked="view.group" :class="ROW" data-refs-view="group" @click="emit('view', { ...view, group: !view.group })">
            <Check :size="13" class="shrink-0" :class="view.group ? '' : 'invisible'" aria-hidden="true" />{{ L('groupByFolder') }}
          </button>
          <button type="button" role="menuitemcheckbox" :aria-checked="view.tags" :class="ROW" data-refs-view="tags" @click="emit('view', { ...view, tags: !view.tags })">
            <Check :size="13" class="shrink-0" :class="view.tags ? '' : 'invisible'" aria-hidden="true" />{{ L('showTags') }}
          </button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
```

- [ ] **Step 4: `NewBranchDialog.vue`** — a teleported sheet in the `CreateEntryDialog` style:

```vue
<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { GitBranchPlus, X } from 'lucide-vue-next'
import { checkBranchName } from '@ccm/shared'
import { retireOverlay } from '../../../lib/motion'

const props = defineProps<{ request: { base: string; baseLabel: string } | null }>()
const emit = defineEmits<{ create: [name: string, checkout: boolean]; close: [] }>()
const { t } = useI18n()
const name = ref('')
const checkout = ref(true)
const touched = ref(false)
const input = ref<HTMLInputElement | null>(null)
const check = computed(() => checkBranchName(name.value))
const problem = computed(() => (touched.value && !check.value.ok ? t(`workspace.log.branches.name.${check.value.reason}`) : null))

watch(
  () => props.request,
  async (req) => {
    if (!req) return
    name.value = ''
    checkout.value = true
    touched.value = false
    await nextTick()
    input.value?.focus()
  },
)

function submit(): void {
  touched.value = true
  if (check.value.ok) emit('create', name.value, checkout.value)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="ccm-dialog" @before-leave="(el) => retireOverlay(el.firstElementChild!)">
      <div v-if="request" class="ccm-scrim fixed inset-0 z-50 flex items-start justify-center px-3 pt-[12vh]" @mousedown.self="emit('close')">
        <div role="dialog" aria-modal="true" aria-labelledby="log-new-branch" class="ccm-sheet flex w-full max-w-[420px] flex-col overflow-hidden" data-new-branch @keydown.esc.stop="emit('close')">
          <header class="flex items-center gap-2 border-b border-line px-4 py-3">
            <GitBranchPlus :size="16" class="shrink-0 text-ink-muted" aria-hidden="true" />
            <div class="min-w-0 flex-1">
              <h2 id="log-new-branch" class="truncate text-sm font-semibold text-ink">{{ t('workspace.log.branches.newTitle') }}</h2>
              <p class="truncate text-xs text-ink-faint" :title="request.baseLabel">{{ t('workspace.log.branches.from', { base: request.baseLabel }) }}</p>
            </div>
            <button type="button" class="ccm-btn-plain shrink-0" :aria-label="t('workspace.explorer.create.cancel')" @click="emit('close')"><X :size="14" aria-hidden="true" /></button>
          </header>
          <form class="flex flex-col gap-2 px-4 py-3" novalidate @submit.prevent="submit">
            <label class="flex flex-col gap-1 text-xs font-medium text-ink-muted">
              {{ t('workspace.explorer.create.name') }}
              <input ref="input" v-model="name" type="text" spellcheck="false" autocomplete="off" class="ccm-field h-8 font-mono text-sm" :aria-invalid="!!problem" aria-describedby="log-new-branch-problem" data-new-branch-name @input="touched = true" />
            </label>
            <p id="log-new-branch-problem" class="min-h-4 text-xs text-st-error" role="status">{{ problem ?? '' }}</p>
            <label class="flex items-center gap-2 text-xs text-ink"><input v-model="checkout" type="checkbox" data-new-branch-checkout />{{ t('workspace.log.branches.checkout') }}</label>
            <div class="flex justify-end gap-2">
              <button type="button" class="ccm-btn" @click="emit('close')">{{ t('workspace.explorer.create.cancel') }}</button>
              <button type="submit" class="ccm-btn ccm-btn-primary" :disabled="!check.ok" data-new-branch-submit>{{ t('workspace.log.branches.create') }}</button>
            </div>
          </form>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
```

- [ ] **Step 5: `LogRefsTree.vue`**

- Props: `{ refs: RefsOk | null; branch: string | null; favorites: ReadonlySet<string>; view: { group: boolean; tags: boolean } }`; `const collapsed = defineModel<Set<string>>('collapsed', { required: true })` replaces the local `collapsed` ref; emits add `select: [row: RefRow | null]`.
- `rows` → `refTree(props.refs, filter.value, collapsed.value, { favorites: props.favorites, group: props.view.group, tags: props.view.tags })`.
- `watch(focusId, () => emit('select', rows.value.find((r) => r.id === focusId.value) ?? null))` and also emit when `rows` changes (favorite toggled): `watch(rows, () => emit('select', rows.value.find((r) => r.id === focusId.value) ?? null))`.
- `const searchEl = ref<HTMLInputElement | null>(null)` on the `<input>`; `defineExpose({ focusSearch: () => { searchEl.value?.focus(); searchEl.value?.select() } })`.
- Icons: `Star v-else-if="r.tracked"` → `Star v-else-if="r.favorite" … class="shrink-0 fill-current text-favorite" :aria-label="t('workspace.log.branches.favorite')"`; the row `title` becomes `r.kind === 'ref' ? [r.name, r.tracked ? t('workspace.log.refs.tracked') : ''].filter(Boolean).join(' · ') : undefined`.

- [ ] **Step 6: `LogPane.vue` wiring**

Imports: `LogRefsToolbar`, `NewBranchDialog`, `expandableIds`, `type RefRow` from `../../../lib/gitRefs`, `readFavorites, writeFavorites, readRefsView, writeRefsView` from `../../../lib/refPrefs`, `gitBranchCreate, gitBranchDelete, gitBranchUpdate, gitFetch, hasBranchOps` from `../../../lib/preview`, `type BranchOpResult` from `@ccm/shared`.

State:

```ts
const refsTree = ref<InstanceType<typeof LogRefsTree> | null>(null)
const selectedRef = ref<RefRow | null>(null)
const refsCollapsed = ref<Set<string>>(new Set())
const refsView = ref(readRefsView())
watch(refsView, writeRefsView, { deep: true })
const favorites = ref<Set<string>>(new Set())
watch(log.refs, (r) => {
  if (r && log.root.value) favorites.value = readFavorites(log.root.value, r)
}, { immediate: true })
const branchBusy = ref<'fetch' | 'update' | null>(null)
const branchNotice = ref<{ text: string; failed: boolean } | null>(null)
const newBranch = ref<{ base: string; baseLabel: string } | null>(null)

function report(res: BranchOpResult, okKey: string, name = ''): void {
  if (res.ok) branchNotice.value = { text: t(`workspace.log.branches.done.${okKey}`, { name }), failed: false }
  else if (res.error !== 'cancelled') branchNotice.value = { text: [t(`workspace.log.branches.error.${res.error}`, { name }), res.detail].filter(Boolean).join(' — '), failed: true }
  void log.reload()
}

function selRef(): Extract<RefRow, { kind: 'ref' }> | null {
  return selectedRef.value?.kind === 'ref' ? selectedRef.value : null
}

function askNewBranch(): void {
  const r = selRef()
  const commit = log.selected.value
  newBranch.value = r ? { base: r.ref, baseLabel: r.name } : commit ? { base: commit, baseLabel: commit.slice(0, 8) } : { base: 'HEAD', baseLabel: 'HEAD' }
}
async function createBranch(name: string, checkout: boolean): Promise<void> {
  const req = newBranch.value
  newBranch.value = null
  if (req && log.root.value) report(await gitBranchCreate(log.root.value, name, req.base, checkout), checkout ? 'createdSwitched' : 'created', name)
}
async function updateSelected(): Promise<void> {
  const r = selRef()
  if (!r || !log.root.value) return
  branchBusy.value = 'update'
  report(await gitBranchUpdate(log.root.value, r.ref), 'updated', r.name)
  branchBusy.value = null
}
async function deleteSelected(): Promise<void> {
  const r = selRef()
  if (r && log.root.value) report(await gitBranchDelete(log.root.value, r.ref), 'deleted', r.name)
}
async function fetchAll(): Promise<void> {
  if (!log.root.value) return
  branchBusy.value = 'fetch'
  report(await gitFetch(log.root.value), 'fetched')
  branchBusy.value = null
}
function compareSelected(): void {
  const r = selRef()
  if (r) log.setFilters({ branch: r.ref, notRef: 'HEAD' })
}
function toggleFavorite(): void {
  const r = selRef()
  if (!r || !log.root.value) return
  const next = new Set(favorites.value)
  if (next.has(r.ref)) next.delete(r.ref)
  else next.add(r.ref)
  favorites.value = next
  writeFavorites(log.root.value, next)
}
async function navigateTo(): Promise<void> {
  const r = selRef()
  const refs = log.refs.value
  if (!r || !refs) return
  const hash = [...refs.local, ...refs.remotes.flatMap((g) => g.refs), ...refs.tags].find((x) => x.ref === r.ref)?.hash
  if (hash && (await log.reveal(hash)) && table.value?.scrollToHash(hash)) return
  branchNotice.value = { text: t('workspace.log.branches.notLoaded', { name: r.name }), failed: true }
}
```

(Check the shared `LogRef` field name for the tip hash — `hash` in `RefsResult` refs; use whatever `parseRefLines` sets.)

Template — remove the `PanelLeft` toggle button from the header (lines 282-284). Replace the refs block (lines 299-302):

```vue
      <LogRefsToolbar
        :open="cols.refsOpen"
        :selected="selectedRef"
        :busy="branchBusy"
        :view="refsView"
        :can-write="hasBranchOps && !!log.root.value"
        @toggle="cols.refsOpen = !cols.refsOpen"
        @new-branch="askNewBranch"
        @update="updateSelected"
        @remove="deleteSelected"
        @compare="compareSelected"
        @search="refsTree?.focusSearch()"
        @fetch="fetchAll"
        @favorite="toggleFavorite"
        @navigate="navigateTo"
        @view="(v) => (refsView = v)"
        @expand-all="refsCollapsed = new Set()"
        @collapse-all="log.refs.value && (refsCollapsed = new Set(expandableIds(log.refs.value, { favorites, ...refsView })))"
      />
      <template v-if="cols.refsOpen">
        <LogRefsTree
          ref="refsTree"
          v-model:collapsed="refsCollapsed"
          class="shrink-0"
          :style="{ width: `${refsW}px` }"
          :refs="log.refs.value"
          :branch="log.filters.value.branch"
          :favorites="favorites"
          :view="refsView"
          @pick="(name) => log.setFilters({ branch: name, notRef: null })"
          @select="(row) => (selectedRef = row)"
        />
        <!-- existing refs resizer div stays here -->
      </template>
```

Above the table area (inside the `v-else` table column, before `LogFilterBar`), the compare + notice strips:

```vue
          <p v-if="log.filters.value.notRef && log.filters.value.branch" class="flex shrink-0 items-center gap-2 border-b border-line bg-accent-soft px-3 py-1 text-xs text-ink" role="status" data-log-compare>
            <span class="min-w-0 flex-1 truncate">{{ t('workspace.log.branches.comparing', { a: log.filters.value.branch.replace(/^refs\/(heads|remotes)\//, ''), b: log.filters.value.notRef }) }}</span>
            <button type="button" class="ccm-btn-plain h-6 px-2 text-xs" data-log-compare-swap @click="log.setFilters({ branch: log.filters.value.notRef, notRef: log.filters.value.branch })">{{ t('workspace.log.branches.swap') }}</button>
            <button type="button" class="ccm-btn-plain h-6 px-2 text-xs" @click="log.setFilters({ notRef: null })">{{ t('workspace.log.branches.clear') }}</button>
          </p>
          <p v-if="branchNotice" class="flex shrink-0 items-center gap-2 border-b border-line px-3 py-1 text-xs text-ink" :class="branchNotice.failed ? 'bg-st-error-soft' : 'bg-fill'" role="status" data-log-branch-notice>
            <span class="min-w-0 flex-1 truncate" :title="branchNotice.text">{{ branchNotice.text }}</span>
            <button type="button" class="shrink-0 cursor-pointer text-ink-faint hover:text-ink" :aria-label="t('workspace.explorer.status.dismiss')" @click="branchNotice = null"><X :size="12" aria-hidden="true" /></button>
          </p>
```

(`swap` puts HEAD as `branch` and the branch as `notRef` — `cleanLogQuery` accepts `HEAD` as branch.) Add `<NewBranchDialog :request="newBranch" @create="createBranch" @close="newBranch = null" />` at the end of the section; import `X` from `lucide-vue-next` if not already.

- [ ] **Step 7: i18n** — `workspace-log.ts` inside `log` (en):

```ts
    branches: {
      toolbar: 'Branches',
      new: 'New Branch…',
      update: 'Update Selected (fast-forward)',
      delete: 'Delete Branch…',
      compare: 'Compare with Current',
      search: 'Search branches',
      fetch: 'Fetch',
      favorite: 'Mark as Favorite',
      unfavorite: 'Unmark as Favorite',
      navigate: 'Navigate Log to Selected Branch',
      more: 'More',
      groupByFolder: 'Group by Folder',
      showTags: 'Show Tags',
      expandAll: 'Expand All',
      collapseAll: 'Collapse All',
      newTitle: 'New branch',
      from: 'From {base}',
      checkout: 'Switch to the new branch',
      create: 'Create',
      comparing: 'Commits in {a} that are not in {b}',
      swap: 'Swap',
      clear: 'Show all',
      notLoaded: 'The tip of {name} is not in the loaded history.',
      done: { created: 'Created {name}.', createdSwitched: 'Created {name} and switched to it.', updated: 'Updated {name}.', deleted: 'Deleted {name}.', fetched: 'Fetched all remotes.' },
      error: {
        denied: 'Not allowed here.',
        invalid: 'Not a valid branch name or start point.',
        exists: '{name} already exists.',
        'not-merged': '{name} is not fully merged.',
        current: 'The current branch can’t be deleted.',
        conflict: 'Local changes would be overwritten.',
        'no-upstream': '{name} has no upstream branch.',
        'non-ff': '{name} can’t be fast-forwarded.',
        auth: 'The remote refused the credentials.',
        timeout: 'git took too long.',
        cancelled: 'Cancelled.',
        failed: 'git failed.',
      },
      name: { empty: 'Type a name.', space: 'No spaces.', dash: 'Can’t start with “-”.', dots: 'No “..” or “@{”.', char: 'No ~ ^ : ? * [ \\ or control characters.', slash: 'Bad “/” or “.” placement.', lock: 'Can’t end with “.lock”.', long: 'Too long.' },
    },
```

vi:

```ts
    branches: {
      toolbar: 'Nhánh',
      new: 'Tạo nhánh…',
      update: 'Cập nhật nhánh chọn (fast-forward)',
      delete: 'Xoá nhánh…',
      compare: 'So với nhánh hiện tại',
      search: 'Tìm nhánh',
      fetch: 'Fetch',
      favorite: 'Đánh dấu yêu thích',
      unfavorite: 'Bỏ yêu thích',
      navigate: 'Nhảy log tới nhánh đang chọn',
      more: 'Thêm',
      groupByFolder: 'Nhóm theo thư mục',
      showTags: 'Hiện tag',
      expandAll: 'Mở rộng tất cả',
      collapseAll: 'Thu gọn tất cả',
      newTitle: 'Nhánh mới',
      from: 'Từ {base}',
      checkout: 'Chuyển sang nhánh mới',
      create: 'Tạo',
      comparing: 'Commit có trong {a} nhưng không có trong {b}',
      swap: 'Đảo chiều',
      clear: 'Hiện tất cả',
      notLoaded: 'Commit đầu của {name} chưa nằm trong lịch sử đã tải.',
      done: { created: 'Đã tạo {name}.', createdSwitched: 'Đã tạo và chuyển sang {name}.', updated: 'Đã cập nhật {name}.', deleted: 'Đã xoá {name}.', fetched: 'Đã fetch mọi remote.' },
      error: {
        denied: 'Không được phép ở đây.',
        invalid: 'Tên nhánh hoặc điểm bắt đầu không hợp lệ.',
        exists: '{name} đã tồn tại.',
        'not-merged': '{name} chưa được merge hết.',
        current: 'Không thể xoá nhánh hiện tại.',
        conflict: 'Thay đổi chưa commit sẽ bị ghi đè.',
        'no-upstream': '{name} không có nhánh upstream.',
        'non-ff': '{name} không fast-forward được.',
        auth: 'Remote từ chối thông tin đăng nhập.',
        timeout: 'git chạy quá lâu.',
        cancelled: 'Đã huỷ.',
        failed: 'git lỗi.',
      },
      name: { empty: 'Nhập tên.', space: 'Không có dấu cách.', dash: 'Không bắt đầu bằng “-”.', dots: 'Không có “..” hoặc “@{”.', char: 'Không có ~ ^ : ? * [ \\ hay ký tự điều khiển.', slash: 'Sai vị trí “/” hoặc “.”.', lock: 'Không kết thúc bằng “.lock”.', long: 'Quá dài.' },
    },
```

- [ ] **Step 8: E2E** — append to `apps/desktop/e2e/log.cjs` `run()` before its final checks (the fixture already has `feature/x`; use its `DIR`/`W` helpers):

```js
  // Branches toolbar.
  check('vertical branches toolbar is shown', await evaluate(`!!document.querySelector('[data-refs-toolbar] [data-refs-action=newBranch]')`))
  await evaluate(`document.querySelector('[data-log-refs] [data-ref="refs/heads/feature/x"]').focus()`)
  await evaluate(`document.querySelector('[data-refs-action=favorite]').click()`)
  await sleep(200)
  check('star marks the branch favorite and floats it up', await evaluate(`(() => { const rows = [...document.querySelectorAll('[data-log-refs] [role=treeitem]')]; const fav = rows.findIndex((r) => r.dataset.ref === 'refs/heads/feature/x'); return fav >= 0 && fav <= 3 && JSON.stringify(Object.values(JSON.parse(localStorage.getItem('ccm.workspace.logFavorites')))).includes('feature/x') })()`))
  await evaluate(`document.querySelector('[data-refs-action=compare]').click()`)
  await waitFor(`!!document.querySelector('[data-log-compare]')`, 4000, 'compare').catch(() => {})
  check('Compare with Current filters to commits not in HEAD', await evaluate(`!!document.querySelector('[data-log-compare]')`))
  await evaluate(`document.querySelector('[data-log-compare] button:last-child').click()`)
  await evaluate(`document.querySelector('[data-refs-action=newBranch]').click()`)
  await waitFor(`!!document.querySelector('[data-new-branch-name]')`, 3000, 'new branch').catch(() => {})
  await evaluate(`(() => { const i = document.querySelector('[data-new-branch-name]'); i.value = 'toolbar-e2e'; i.dispatchEvent(new Event('input')); document.querySelector('[data-new-branch-checkout]').click(); document.querySelector('[data-new-branch-submit]').click() })()`)
  await waitFor(`!!document.querySelector('[data-log-refs] [data-ref="refs/heads/toolbar-e2e"]')`, 6000, 'branch listed').catch(() => {})
  check('New Branch creates a branch without switching', await evaluate(`!!document.querySelector('[data-log-refs] [data-ref="refs/heads/toolbar-e2e"]')`) && execFileSync('git', ['branch', '--show-current'], { cwd: DIR, encoding: 'utf8' }).trim() !== 'toolbar-e2e')
  await evaluate(`document.querySelector('[data-refs-action=collapseAll]').click()`)
  await sleep(150)
  check('Collapse All leaves only section rows', await evaluate(`[...document.querySelectorAll('[data-log-refs] [role=treeitem]')].every((r) => r.getAttribute('aria-level') === '1')`))
  await evaluate(`document.querySelector('[data-refs-action=expandAll]').click()`)
  await evaluate(`document.querySelector('[data-refs-action=more]').click()`)
  await waitFor(`!!document.querySelector('[data-refs-more]')`, 2000, 'more').catch(() => {})
  await evaluate(`document.querySelector('[data-refs-view=group]').click()`)
  await sleep(150)
  check('More › Group by Folder off lists feature/x by its full name', await evaluate(`[...document.querySelectorAll('[data-log-refs] [role=treeitem]')].some((r) => r.dataset.ref === 'refs/heads/feature/x' && r.textContent.includes('feature/x'))`))
  await evaluate(`document.querySelector('[data-refs-view=group]').click()`)
```

(Delete is not driven in E2E: the native confirm cannot be clicked through CDP; Task 3's unit test covers it. If `log.cjs` does not import `execFileSync`, add it to its `require('node:child_process')`.)

- [ ] **Step 9: Verify** — `npm run typecheck && npm test -w @ccm/web && npm test -w @ccm/desktop && npm run build -w @ccm/web && npm run build -w @ccm/desktop && node apps/desktop/e2e/log.cjs` — Expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/components/workspace/log apps/web/src/composables/useGitLog.ts apps/web/src/i18n/workspace-log.ts apps/desktop/e2e/log.cjs
git commit -m "✨ Git Log Branches toolbar: new, update, delete, compare, fetch, favorites, navigate

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```


### Task 7: Index, plan note, version

**Files:**
- Create: `.planning/PLAN-v36-log-branches-toolbar.md`
- Modify: `.planning/PLAN-v30-git-log.md` (one line), `.code_index/web.md`, `.code_index/desktop.md`, `.code_index/protocol.md`, `.code_index/_meta.md`, `apps/desktop/package.json`

- [ ] **Step 1:** `.planning/PLAN-v36-log-branches-toolbar.md` — 12–18 lines: Goal, pieces (`@ccm/shared` `gitBranch.ts`, `preview/branches.ts`, IPC + `confirmGit` + strings, `LogQuery.notRef`, `refTree` options + `refPrefs`, `LogRefsToolbar` / `NewBranchDialog`, `useGitLog.reveal`, `LogTable.scrollToHash`), the 8 Rulings above, Out of scope (force push, tag delete, checkout of existing branches, two-branch file diff), tests (`branches.test.ts`, `log.test.ts`, `logQuery.test.ts`, `gitRefs.test.ts`, `refPrefs.test.ts`, `e2e/log.cjs`), link to this plan.
- [ ] **Step 2:** `.planning/PLAN-v30-git-log.md` — under Rulings add: `- v36 (2026-10-15): the Branches toolbar adds create / fast-forward update / fetch / delete (native confirm); see PLAN-v36-log-branches-toolbar.md.`
- [ ] **Step 3:** `.code_index/` — `web.md` v30 section: `LogRefsToolbar` strip (toggle moved from the header), `NewBranchDialog`, `refPrefs` (favorites per repo, view), `refTree(…, { favorites, group, tags })` + `expandableIds`, `LogRefsTree` `v-model:collapsed` + `select` (toolbar target) vs `pick` (filter), `useGitLog.reveal`, `LogTable.scrollToHash`, `LogFilters.notRef` + compare strip. `desktop.md`: `preview/branches.ts` (createBranch, deletePlan/runDelete, fetchAll, updateBranch, sanitizeGitError), IPC `ccm:git-branch-create|delete|update`, `ccm:git-fetch`, `confirmGit` in main + strings. `protocol.md`: `@ccm/shared` `checkBranchName`, `BranchOpResult`, `LogQuery.notRef`. `_meta.md`: one line with the paths.
- [ ] **Step 4:** bump `apps/desktop/package.json` `version` one minor above `master`'s at merge time.
- [ ] **Step 5: Verify** — `npm run typecheck && npm test && npm run build -w @ccm/web && npm run build -w @ccm/desktop && node apps/desktop/e2e/log.cjs` — Expected: all PASS.
- [ ] **Step 6: Commit**

```bash
git add .planning/PLAN-v36-log-branches-toolbar.md .planning/PLAN-v30-git-log.md .code_index apps/desktop/package.json
git commit -m "📝 Branches toolbar plan note, code index and version

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
