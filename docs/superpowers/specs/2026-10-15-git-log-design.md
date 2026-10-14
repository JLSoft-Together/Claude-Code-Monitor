# Git Log pane (v30) — design

Date: 2026-10-15. Status: approved in brainstorming, pending spec review.

## Goal

A read-only Git Log for a project in the Workspace, modelled on IntelliJ's Git › Log window (reference screenshot from the owner): branch/tag tree on the left, commit history with a multi-lane graph in the middle, the selected commit's changed files and details on the right, and a diff of any file in that commit.

Decisions taken with the owner:

- **Read-only.** No checkout, branch create/delete, cherry-pick, revert, reset, fetch/pull/push. Copy actions only.
- **New Workspace pane kind `log`**, one per repo (like `changes`), opened from the Changes pane, the Explorer › Changes header, Ctrl+K and the terminal context menu.
- **First release includes everything:** multi-lane graph, filters (Branch, User, Date, Paths, Text/hash), file diff inside a commit, branch/tag tree with branch filtering.
- **Approach A:** the desktop returns raw `git log` rows; the page computes graph lanes. Filtering by branch keeps the graph; filtering by user / date / text / paths shows a flat list (dots only), as IntelliJ does.

## 1. Desktop (`apps/desktop/src/preview/log.ts` + IPC)

Pure helpers + git commands through the existing `execGit` (`GIT_LITERAL_PATHSPECS=1`, `core.quotePath=false`, no colour).

| Function | git | Result |
|---|---|---|
| `refs(root)` | `for-each-ref --format=… refs/heads refs/remotes refs/tags`, `symbolic-ref -q HEAD`, `rev-parse HEAD` | `{ head: { branch: string \| null, hash: string \| null }, local: LocalRef[], remotes: { name, refs: RemoteRef[] }[], tags: TagRef[] }`; `LocalRef` carries `upstream`, `ahead`, `behind` (from `%(upstream:track)`) |
| `log(root, query)` | `log --topo-order -z --format=%H%x00%P%x00%an%x00%ae%x00%at%x00%D%x00%s --skip=N -n 500` (+ filter args) | `{ commits: LogCommit[], more: boolean }` |
| `commit(root, hash)` | `show -s --format=<hash, parents, author, email, author time, committer, committer email, commit time, body>` + `diff-tree -r -z -M --root --name-status --numstat` (first parent) | `CommitDetail` with `files: { path, origPath?, kind, added?, removed?, binary? }[]` |
| `contains(root, hash)` | `branch -a --contains <hash> --format=%(refname)` | `string[]` (called on demand only) |
| `commitDiff(root, hash, path, opts)` | `diff <first parent or empty tree> <hash> -U1000000 -M -- <path>` (+ whitespace flags of `diffArgs`) | same shape as `ChangesDiff` (`partial` past 3 MB → 3-line context), so `DiffView` is reused |

`LogQuery` (sanitised like `cleanDiffOptions`; unknown values dropped):

- `branch: string | null` — must be a ref name returned by `refs()`; null = `--all`.
- `author: string | null` → `--author=<value>` (regex-escaped unless the regex toggle is on).
- `since / until: number | null` (epoch seconds) → `--since=@<n>` / `--until=@<n>`.
- `text: string | null`, `regex: boolean`, `matchCase: boolean` → `--grep=<value>` + `-i` unless `matchCase` + `--fixed-strings` unless `regex`. A 4–40 hex `text` also resolves `rev-parse --verify -q <text>^{commit}` and that commit is put first.
- `paths: string[]` — repo-relative, each through `safeRepoPath`, passed after `--`.
- `skip: number` (multiple of 500).

Every page-supplied string goes after `=` or `--`, never as its own argument. Hashes must match `^[0-9a-f]{4,40}$` and then `rev-parse --verify <hash>^{commit}`.

IPC in `preview/ipc.ts`, same frame check and repo registration as `ccm:changes-status` (`repoOf` / `allowedPath` → `toplevel` → `repos`):

- `ccm:log-refs(dir)`, `ccm:log-page(root, query)`, `ccm:log-commit(root, hash)`, `ccm:log-contains(root, hash)`, `ccm:log-diff(root, hash, path, opts)`.
- Preload + `lib/preview.ts` wrappers `logRefs`, `logPage`, `logCommit`, `logContains`, `logDiff`, `hasLog`.

Auto refresh: `GitDirWatcher` also reacts to `packed-refs`, `FETCH_HEAD`, `ORIG_HEAD` and anything under `refs/` (recursive watch where supported, else `refs/heads` + `refs/remotes` directories), 200 ms debounce, existing `changes-updated` event.

Errors reuse `ChangesError` (`not-repo`, `no-git`, `denied`, `failed`, `missing`). Timeouts 20 s; capped output → `more: true` and the parsed rows so far.

## 2. Web logic (pure, unit-tested)

**`lib/commitGraph.ts`** — IntelliJ-style lanes, incremental across pages.

- State: `lanes: (string | null)[]` (the hash each lane waits for) + colour per lane.
- Per commit in `--topo-order`: its lane = first lane waiting for it, else a new lane (branch tip). Other lanes waiting for it end on the node (merge-in edges). First parent inherits the node's lane; further parents take a lane already waiting for that parent, else the first free slot, else a new lane (merge-out edges). Trailing empty lanes are trimmed.
- Row output: `{ lane: number, color: number, edges: { from: number, to: number, color: number, kind: 'straight' | 'merge' | 'fork' }[] }` (top half + bottom half of the row), enough to draw one row as SVG.
- `extend(state, page)` returns the new state and rows; computing pages one by one equals computing them at once.
- At most 30 visible lanes; lanes beyond are drawn in the last column.
- Colours: lane index → `agent-*` tokens rotated (COLOR-SYSTEM); no hard-coded colours.

**`lib/gitRefs.ts`** — branch tree (HEAD / Local / Remote › `<remote>` / Tags, `a/b` names nested as folders), filter by the "Branch or tag" field, parse `%D` into labels (`HEAD -> main`, `origin/main`, `tag: v1`), merge a local and its remote on the same commit into one `origin & main` pill.

**`lib/logQuery.ts`** — filter UI state → `LogQuery`, date presets (last 24 h, 7 days, 30 days, custom range), `graphMode(query)` = graph when only `branch` is set (or nothing), flat otherwise.

**`composables/useGitLog(root)`** — refs, pages, selected hash, detail cache (LRU 50). Filter changes debounced 250 ms; a sequence number drops stale replies. Next page loads when the list scrolls near the end. `onChangesUpdated(root)` reloads refs and the first page, keeping the selection when the commit is still listed.

**Store `workspace`** — `PaneKind` gains `'log'`; `openLog(cwd, { split?, select?: hash })` reuses the repo's pane (like `openChanges`); `addSpec` / last-workspace restore handle the kind.

## 3. UI (`components/workspace/LogPane.vue` and children)

Three resizable columns (widths in `ccm.workspace.logCols`); no horizontal page scroll; long text truncates with a tooltip.

1. **`LogRefsTree.vue`** — "Branch or tag" field; tree HEAD (Current Branch) / Local / Remote / Tags; tag icon on the current branch, star on tracked branches, ↑↓ counts for ahead/behind. Click a branch → Branch filter; click again → clear. Collapsible from the pane's left strip.
2. **`LogTable.vue`** — filter bar: Text/hash field with `.*` (regex) and `Aa` (match case) toggles, Branch, User (authors seen so far + "me" from `git config user.name`), Date (presets), Paths (pick files/folders in the repo), Refresh. Virtual list, 24 px rows: graph SVG | ref pills + subject | author | date (`Intl.DateTimeFormat`, app locale). HEAD commit bold. Keys: ↑↓ PgUp PgDn Home End, Ctrl+C / ⌘C copies the hash.
3. Right column, split vertically (resizable):
   - **`LogCommitFiles.vue`** — changed files as a folder tree (reuses `lib/changesTree.ts`), M/A/D/R letters + `diff-*` colours, file count.
   - **`LogCommitDetails.vue`** — full message, short hash (click to copy), author + email, date, committer when different, "In N branches: …  Show all" (calls `contains` on click).

**Diff:** double-click / Enter on a file swaps the middle + right area for `DiffView` (parent ↔ commit), with ← back (Esc), the file name, `[` `]` for previous/next file of the commit, F7 / Shift+F7 for changes; layout / whitespace / words share `ccm.workspace.diffOpts` with Changes. No revert buttons.

**Context menus (read-only):** commit → Copy hash, Copy message, Show diff; file → Show diff, Open current version (file viewer, when the file still exists), Copy path.

**Entry points:** "Log" button in the Changes pane toolbar and the Explorer › Changes header, Ctrl+K "Git log", terminal context menu (pane cwd).

**Empty / error states:** not a repo, git missing, access denied (`AccessPrompt`), repo without commits, no commit matches (with "Clear filters").

**Rules:** strings in `i18n/workspace-log.ts` (en + vi, spread like `workspace-diff.ts`); colours via tokens only — local ref pill `accent` / `accent-ink`, remote `ink-muted`, tag `warning`, lanes `agent-*`; status = icon + text + colour; content surfaces opaque, blur only on popovers. Load `frontend-design:frontend-design` and `ui-ux-pro-max:ui-ux-pro-max` before UI work.

## 4. Tests, performance, scope

Tests:

- `apps/desktop/test/log.test.ts` on a temp repo built in the test (branches, merge, tag, fake remote via `update-ref`, rename, root commit): `refs`, `log` (paging, each filter, hash search), `commit`, `contains`, `commitDiff` (root commit vs empty tree, binary, 3 MB cap), rejection of bad hash / ref / path.
- `lib/commitGraph.test.ts`: linear, fork, 2- and 3-parent merges, long parallel branches, free-slot reuse, `extend` across page boundaries equals one pass, 30-lane cap.
- `lib/gitRefs.test.ts`, `lib/logQuery.test.ts`.
- E2E `apps/desktop/e2e/log.cjs` (added to `run.cjs`): open from Changes, graph rendered, Branch / User / Text filters, commit selection shows files + details, diff open + Esc back, auto refresh after a new commit.

Performance: 500-commit pages, virtual rows, graph extended per page, detail cache, `contains` on demand, no polling (watcher). Target: first page of a 50k-commit repo under 1 s.

Out of scope: any write operation (see Goal), blame, compare two arbitrary commits, file history from the viewer, stash.

Docs: `.planning/PLAN-v30-git-log.md`, docs §11s (git commands, limits), `.code_index/{desktop,web,protocol,_meta}.md`; version 2.5.0.
