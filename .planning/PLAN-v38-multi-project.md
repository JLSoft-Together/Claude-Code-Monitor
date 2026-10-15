# PLAN v38 — multi-project Workspace: Agent rail, Spaces, Mission Control, Needs-you (2026-10-15, app 2.6.0)

Goal: work on several projects at once the way SpaceVibe Deck does (`src/spacevibe-deck/docs/internals/agent-rail.md`, `mission-control.md`). Task plan: `docs/superpowers/plans/2026-10-15-multi-project-workspace.md`. Status: done (M1–M4, 2026-10-15). No version bump here: the app bumps once for the whole batch (2.5.0 → 2.6.0).

## Why
Two to four Claude terminals on one project look identical in today's sidebar (one flat row per pane), worktrees fold only by the `<repo>-wt/<branch>` folder name, the tab strip mixes every project, and the "N need you" chip only jumps to the next pane.

## Pieces
- M1 Agent rail: project › checkout › session tree (`lib/rail/railModel.ts` `buildRail`), clusters keyed by git common dir (`ccm:project-root` returns `common`), per-checkout ordinals (`Claude`, `Claude 2`), state badge on the agent icon, header needs count, close project, remembered projects from `workspace.recentDirs`, manual order (`ccm.workspace.railOrder`, drag + Alt+↑/↓), collapsed avatar column.
- M2 Spaces: `Tab.project` fixed at creation; strip, Ctrl+Alt+1–9 and Ctrl+Tab scoped to the active tab's project; `folder N` naming for tabs sharing a folder.
- M3 Mission Control: Ctrl+Shift+O / ⌘⇧O overlay over the stage, shelf of every project's tabs, pane windows showing the last 14 rows read from the mounted xterm buffer (memory only), FLIP zoom, keyboard navigation.
- M4 Needs-you list: the attention chip opens a listbox of failed then asked panes, oldest first.

## Rulings (from the user, 2026-10-15)
- All four parts are in scope; each milestone ships on its own.
- Rows show the session name only (alias > Claude's own name) and `Agent · <state>`. No first prompt, no assistant sentence: the collector stores no message text and session contents never reach the frontend.
- A tab's project is fixed for its life (Deck's `workspacePath`); a `cd` never moves it. Tabs saved before v38 fall back to their naming pane's starting folder.

## Out of scope
Deck's slide animation between spaces (conflicts with per-pane view transitions), Deck's launch page, model pills on rows, session tails.

## Owner adjustments applied (audit 2026-10-15)
- Project headers keep `RunBadge` (icon-only `compact` when the aside is narrow) and ProjectMenu "Run…"; ProjectMenu gains "Close project" (rail only).
- Rows and Mission Control use `PaneIcon`; run panes get their own row / window with the run state (`runOf` → `runState`): Building / Running → working, Run failed → failed and counts as "needs you".
- Close project with a live run → confirm dialog; on confirm the runs are stopped, then the panes close.
- Header actions (new tab, scripts, Run…, layouts) use the checkout's own path, never a worktree's main checkout.
- Explorer preview slot is per project; `captureLayout` picks tabs by `Tab.project`; `loadLast` / `loadSaved` keep `project` only when it is an absolute path.
- Alt+↑/↓ on a rail header is not swallowed by the pane-focus chord.
- The aside (with the Projects | Explorer tablist and the v39 `SideResizer`) stays in `WorkspaceView`; closed = 52 px avatar column, tablist hidden.

## Deviations
- `WorkspaceView.paneProject` (Explorer root, layouts) no longer folds a worktree into its main checkout by folder name: the Explorer of a worktree tab shows that worktree.
- Checkout lines show only for several checkouts, a branch, a worktree or a remembered project (a lone plain folder had a line that only repeated its name).
- Old sidebar row ages are gone (rows are two lines: name + `Agent · state`).
- Tour step for Mission Control (optional in the task plan) not added.

## Deliberately not ported
Session sentence / first prompt (ruling 2); Deck's slide animation between spaces (fights per-pane view transitions); Deck's launch page (LaunchPicker / SplitMenu cover it; a checkout line opens a tab there); model pill on rows.

Tests: `apps/web/src/lib/rail/rail.test.ts`, `stores/workspace.test.ts` (tab project), `lib/workspaceKeys.test.ts`, `apps/desktop/test/commonDir.test.ts`, `test/preview-ipc.test.ts`; E2E `apps/desktop/e2e/rail.cjs` (+ `tier2.cjs` rail selectors).
