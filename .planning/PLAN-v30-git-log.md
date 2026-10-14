# PLAN v30 — read-only Git Log pane (2026-10-15, app 2.5.0)

Goal: an IntelliJ / Android Studio style history of the project's repo inside the workspace, next to the v29 Changes pane. **Read-only**: no checkout, branch, reset, cherry-pick, revert, fetch, pull, push or stash; copy actions only. Desktop only, no WebSocket events.

## Why
Seeing what an agent committed (and on which branch) without leaving the app. Plain `git` is the engine, like v29: every command goes through `execGit` (literal pathspecs, no colour, no pager), page-supplied strings reach git only after `=` or `--`, hashes match `^[0-9a-f]{4,40}$` and are verified with `rev-parse --verify -q <hash>^{commit}`, branch refs match `^refs/(heads|remotes|tags)/` or `HEAD`, paths go through `safeRepoPath`.

## Pieces
- Shared `packages/shared/src/gitlog.ts`: `LOG_PAGE = 500`, `LogQuery`, `LogCommit`, refs / detail / diff result types, error codes.
- Desktop `preview/log.ts`: `listRefs`, `logPage`, `commitDetail`, `branchesContaining`, `commitDiff`, parsers (`parseLog`, `parseRefLines`, `parseTrack`, `parseNameStatus`), `cleanLogQuery`, `logArgs`. Merge commits are compared with their first parent (plain `diff-tree` prints nothing for a merge). IPC `ccm:log-refs|page|commit|contains|diff` (preload `logRefs` ...); `registerRepo` in `preview/ipc.ts` registers the repo like the Changes pane. The git-dir watcher (`GIT_DIR_FILES`, `refs/` watched recursively) also reacts to `packed-refs`, `FETCH_HEAD`, `ORIG_HEAD`; the page reloads only when HEAD or a ref hash changed.
- Web pure/composable: `lib/commitGraph.ts` (incremental lane assignment, `MAX_LANES = 30`, wider lanes drawn in the last column), `lib/gitRefs.ts` (refs tree), `lib/logQuery.ts` (filters to query, graph vs flat), `lib/diffOpts.ts` (diff options shared by Changes and Log), `composables/useGitLog.ts` (paging, race-safe loads, refresh).
- Components `components/workspace/log/*`: `LogPane` (columns, resizers, per-file diff with F7 / `[ ]` / Esc), `LogRefsTree` (roving tabindex), `LogFilterBar` + `LogFilterMenu` (text/hash with regex + match case, Branch, User, Date, Paths), `LogTable` (virtual rows, graph cell, ref pills, context menu with copy hash), `LogGraphCell`, `LogCommitDetails` ("In N branches" on demand), `LogCommitFiles` (tree, roving tabindex).
- Pane kind `log` (`openLog`, layouts, PaneIcon `GitGraph`). Entry points: Changes toolbar (`data-changes-log`), Explorer › Changes header, Ctrl+K, `+` new-tab menu (`LaunchPicker`). i18n `i18n/workspace-log.ts` (en + vi) merged into `workspace.log`.
- Narrow panes: the table is a container; author hides below 24rem and date below 34rem, both shrink with an ellipsis, the message column keeps a minimum width and ref pills truncate inside it.
- Graph is drawn with no filter or only the Branch filter; User / Date / Text / Paths give a flat list (dots only).

## Rulings (deviations from the spec)
- Lane colours use the categorical `model-1..8` tokens, not `agent-*`: `.planning/COLOR-SYSTEM.md` reserves `agent-*` for agent kinds.
- `TermPane` has no context menu, so the spec's "terminal context menu" entry became a row in the `+` new-tab menu.
- Local ref pill `accent` / `accent-ink`, remote `ink-muted`, tag `warning`, file kinds `diff-*` via `KIND_CLASS`.

## Out of scope
Any write operation, stash list, remote fetch, blame, compare two commits, graph of other repos, editing.

## Tests
`lib/commitGraph.test.ts`, `lib/gitRefs.test.ts`, `lib/logQuery.test.ts`, `composables/useGitLog.test.ts`, `stores/workspace.test.ts` (openLog), desktop log parser / args / real-repo tests, E2E `apps/desktop/e2e/log.cjs` (17 checks, narrow-pane widths 300 / 460 / 640 px; also in `run.cjs`).
