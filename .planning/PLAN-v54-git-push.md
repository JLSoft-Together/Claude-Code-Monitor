# Plan v54 — Git Push UI (Log Branches toolbar + Explorer Changes)

## Context
The Workspace git surface (Git Log pane §11s, Explorer → Changes) can create / update / fetch / delete branches but has no way to push. Owner wants a push GUI that fits the existing design system (Apple HIG, `ccm-sheet` dialogs, Branches toolbar icon buttons). Owner decisions (2026-10-17):
- Entry points: **Push…** on the Log Branches toolbar **and** a `↑N` push button next to the branch name in Explorer → Changes; both open the same dialog.
- Confirm: **in-app dialog only** (IntelliJ-style: outgoing commits + target + exact git command shown; clicking Push runs it). No native confirm.
- Still **no force push** (docs §11s "Never: force push" stays). Non-fast-forward → error suggests Update / Fetch first.

## Backend (apps/desktop)

**`src/preview/branches.ts`** — add, reusing `execGit`, `failed`, `sanitizeGitError`, `validRef`, `LOCAL` / `NET`, `checkBranchName`, `parseLog` + `LOG_FORMAT` from `log.ts`:
- `pushPreview(root, ref, remote?, branch?)` (read-only, LOCAL timeout): `ref` must be `refs/heads/<local>`; remotes from `git remote`; defaults from `for-each-ref --format=%(upstream:remotename)%1f%(upstream:remoteref)%1f%(push:remotename) <ref>` (fallback: `origin` or the only remote, branch = local name). Remote-tracking ref `refs/remotes/<remote>/<branch>` exists? → outgoing = `log -z --format=LOG_FORMAT -n 101 <ref> --not <remoteRef>`; else (new remote branch) `log … <ref> --not --remotes=<remote>`. Returns `{ ok, local, remotes, remote, branch, upstream: boolean (target is the configured upstream), exists, commits (≤100), more, args }` where `args` = the exact push argv for display.
- `pushArgs(local, remote, branch, setUpstream)` → `['push', '--porcelain', ...(setUpstream ? ['-u'] : []), remote, 'refs/heads/<local>:refs/heads/<branch>']`. Validation: remote must be in the `git remote` list and not start with `-`; branch passes `checkBranchName` + `check-ref-format --branch`. Never `--force*`, `--delete`, `--mirror`, `--all`.
- `pushBranch(root, ref, remote, branch, setUpstream)` (NET 120 s, killTree) → `BranchOpResult`. Push-specific stderr/stdout classification before `failed()`: `! [rejected] … (non-fast-forward|fetch first)` → `non-ff`; `! [remote rejected]` (protected branch, pre-receive hook) → new `remote-rejected` with sanitized detail; auth/timeout via existing `failed()`. Success detail = `Everything up-to-date` vs pushed (from `--porcelain` lines `=` / ` ` / `*`).

**`packages/shared/src/gitBranch.ts`**: add `'remote-rejected' | 'no-remote' | 'nothing'` to `BranchOpError`; add `PushPreview` type (shared by main + web).

**`src/preview/ipc.ts`**: `ccm:git-push-preview` `{root, ref, remote?, branch?}` and `ccm:git-push` `{root, ref, remote, branch, setUpstream}`, both via `logRepo(event, root)` like `ccm:git-fetch`; add both to the channel list (line ~89). Main rebuilds argv itself — the page never sends a command.

**`src/preload.ts`**: `gitPushPreview`, `gitPush` next to `gitFetch` (line ~83).

**`src/preview/changes.ts`** `parseStatusV2`: also read `# branch.upstream` and `# branch.ab +A -B` (already in the `--branch` output, no extra git call) → `ChangesStatus` gains `upstream: string | null; ahead: number; behind: number` (mirror type in `apps/web/src/lib/preview.ts`).

## Frontend (apps/web)

**`lib/preview.ts`**: bridge types + `gitPushPreview`, `gitPush` wrappers (same `noBranchOps` fallback as `gitFetch`; gated by `hasBranchOps`).

**New `components/workspace/log/PushDialog.vue`** — self-loading, modelled on `NewBranchDialog.vue` (Teleport, `ccm-scrim` + `ccm-sheet`, `ccm-dialog` transition + `retireOverlay`, focus trap, Esc, restore focus). Props `request: { root: string; ref: string } | null`; emits `done: [res, label]`, `close`.
- Header: `ArrowUpFromLine` icon, title "Push commits", subtitle `main → origin/main` (truncate + title tooltip).
- Target row: remote via `AppSelect` (hidden when one remote), remote branch `ccm-field` mono input (validated by `checkBranchName`, inline error like NewBranchDialog). Changing either re-runs the preview (debounced, seq-guarded like `diffSeq`).
- Checkbox "Set upstream (-u)" — shown and default-on when the local branch has no upstream or the target differs from it.
- Outgoing list (scroll, max-h ~240px, `ccm-scroll`): rows `short hash (mono, ink-faint) · subject (truncate) · author · relative time`; "New branch on origin" badge when `!exists`; "+ more not shown" when `more`; empty state "Nothing to push — {branch} is up to date with {target}" and Push disabled.
- Footer: exact command in mono `text-2xs text-ink-faint` (`git push -u origin refs/heads/main:refs/heads/main`), `ccm-btn` Cancel, `ccm-btn ccm-btn-primary` "Push N commits" (spinner `LoaderCircle` while running; dialog stays open, inputs disabled; error shows inline in `text-st-error` with git detail and keeps the dialog open so the user can retry / change target; success closes and emits `done`).
- Colours only via tokens per `.planning/COLOR-SYSTEM.md` (accent fill vs `accent-ink`, `st-error` for failure, `success` for the done notice); all strings via i18n.

**`LogRefsToolbar.vue`**: new button after Update — `ArrowUpFromLine`, `data-refs-action="push"`, title "Push…", `aria-busy`; enabled when `canWrite && !busy` and target is a local branch or (no selection and HEAD is on a branch). `busy` union gains `'push'`. New emit `push`.

**`LogPane.vue`**: `push = ref<{root, ref} | null>`; `askPush()` = selected local ref else `refs/heads/<head.branch>`; mount `<PushDialog>`; on `done` → existing `report(res, 'pushed', label)` (branch notice + `log.reload()`).

**`ExplorerChanges.vue`** header row: when `ok && hasBranchOps && ok.branch`, a button after the branch name using the same 18px header-button classes: `ArrowUpFromLine` + `tabular` ahead count when `ahead > 0` (`text-accent-ink`), plain icon otherwise; tooltip "Push… (N commits ahead of origin/main)" / "Push…". Emits `push: [root, branch]`. **`ExplorerPanel.vue`** hosts its own `PushDialog` and shows the result through its existing notice/toast pattern (check `ExplorerPanel.vue` for the current one; fall back to a small inline status line in the Changes header) and calls `changes.refresh`.

**i18n** `i18n/workspace-log.ts` (en + vi) under `log.branches`: `push`, `pushTitle`, `pushTarget`, `remote`, `remoteBranch`, `setUpstream`, `newRemoteBranch`, `outgoing` (plural), `moreNotShown`, `nothing`, `command`, `pushN` (plural), `pushing`, `done.pushed`, `done.upToDate`, `error.remote-rejected`, `error.no-remote`, `error.nothing`, `error.non-ff` hint "Update or fetch first.". Explorer tooltip strings under `workspace.explorer.changesView` in `en.ts` / `vi.ts`.

## Docs / index
- `docs/claude-code-integration.md` §11s table: add **Push** row (`push --porcelain [-u] <remote> refs/heads/<b>:refs/heads/<rb>`, in-app dialog with outgoing commits + exact command, 120 s, never force) and the preview read commands; note the `branch.ab` / `branch.upstream` status fields.
- `.planning/PLAN-v54-git-push.md` (copy of this plan), `.code_index/desktop.md` (branches.ts push fns, IPC channels), `.code_index/web.md` (PushDialog, toolbar/Explorer entry), `.code_index/_meta.md` one line.

## Tests
- `apps/desktop/test/branches.test.ts` (real bare-remote repos, existing helpers): preview defaults with/without upstream, outgoing list for existing vs new remote branch, push success + `-u` sets upstream, non-ff rejected → `non-ff`, invalid remote / branch / `-`-prefixed → `invalid`/`denied`, argv never contains `--force`; IPC `ccm:git-push` outside a repo → `denied`.
- `apps/desktop/test/changes.test.ts`: `parseStatusV2` reads `branch.ab` / `branch.upstream`.
- Web unit test for any pure helper extracted (e.g. `lib/push.ts` label / default-upstream logic) next to existing `lib/*.test.ts`.
- E2E: extend `apps/desktop/e2e/` log script (existing branch-toolbar E2E) — open Push dialog, check outgoing list + command text, push to a local bare remote, see notice.

## Verification
1. `npm run typecheck` and `npm test` (all workspaces).
2. `npm run desktop`, open a repo with a local bare remote: commit → Explorer Changes shows `↑1` → dialog lists the commit, command line correct → Push → notice, count clears, Log refs show branch even with remote. Repeat from Log toolbar with a non-current branch, a new branch (`-u` checked, "new branch" badge), and a diverged remote (non-ff error kept in dialog). Check light/dark + one extra theme, Vietnamese strings, keyboard-only flow (Tab trap, Esc, Enter submits).
3. `npm run e2e -w @ccm/desktop` after building web + desktop.

## As built (2026-10-17)
- `pushArgs` lives in `packages/shared/src/gitBranch.ts`: main runs it with validated parts, the dialog uses it only to show the command, so `PushPreview` carries no `args` and toggling "Track as upstream" needs no new preview.
- Tests: `apps/desktop/test/branches-push.test.ts` (own bare remote; pre-receive hook for `remote-rejected`), E2E `apps/desktop/e2e/push.cjs` (added to `e2e/run.cjs`).
- Non-ff text names the remote branch: "{target} has commits that aren’t here yet. Update or fetch, then push again."
