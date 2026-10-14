# PLAN v31 — multi-project Workspace: Agent rail, Spaces, Mission Control, Needs-you (2026-10-15, app 2.6.0)

Goal: work on several projects at once the way SpaceVibe Deck does (`src/spacevibe-deck/docs/internals/agent-rail.md`, `mission-control.md`). Task plan: `docs/superpowers/plans/2026-10-15-multi-project-workspace.md`. Status: planned, not started.

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
- A tab's project is fixed for its life (Deck's `workspacePath`); a `cd` never moves it. Tabs saved before v31 fall back to their naming pane's starting folder.

## Out of scope
Deck's slide animation between spaces (conflicts with per-pane view transitions), Deck's launch page, model pills on rows, session tails.
