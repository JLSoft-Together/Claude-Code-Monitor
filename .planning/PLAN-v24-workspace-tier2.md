# PLAN v24 — sidebar sessions, project layouts, scripts menu (2026-10-14)

Owner picked IDEAS-v23 items 7, 8, 9. Ship as 2.2.0.

## 7. Sidebar like the SpaceVibe reference

- Per project (folder group, git toplevel name): rows = panes/tabs of that project. Each row: status glyph (spinner working, StatusIcon waiting/done/error, idle dot → glyph), title, age, agent glyph (PresetIcon / PaneIcon, agent colors).
- Title: agent panes → linked session's live task title (collector data already linked via `useWorkspaceLinks` / session title / last activity summary — use what exists, never invent); shell → running command or cwd tail; browser → host; file → filename; changes → "Changes (N)".
- Age: time since last activity (relative, ticks every 30 s, tabular nums).
- Active row = tab containing focused pane (accent-soft + accent-ink). Click → activate tab + focus pane. Rows of other tabs in a split show once per pane.
- Project header: folder glyph + name, collapse chevron, `+` on hover (new tab in that folder → launch menu with cwd preset).
- Keyboard: ↑↓ rows, Enter activates, ←→ collapse. Status = glyph + text (sr) + color.

## 8. Layouts per project

- "Save layout…" (tab context / `+` menu / sidebar project menu): saves the current tab set of that project — per tab: split tree with pane kinds (agent preset, shell, browser url/path, file path, changes) and ratios; no scrollback, no session ids (agents start fresh, unless owner ticks "resume agent sessions" which stores `resume` ids).
- Store: desktop data dir `layouts.json` via IPC (`ccm:layouts-list/save/delete`), keyed by project root (realpath, case-insensitive win32), name, updatedAt. Max 20 per project.
- Open: sidebar project menu → Layouts → name → opens tabs (dedupe: reuse identical browser/file tabs). "Open on start" flag per project (one layout) — restores when the project is first opened in a session, never auto-launches agents without the flag.
- Manage: rename, overwrite, delete (confirm).

## 9. Scripts menu

- Detect in project root (and pane live cwd): `package.json` scripts (npm/pnpm/yarn/bun by lockfile), `Makefile` targets (simple `^name:` not starting with `.`), `justfile` recipes, `Cargo.toml` (build/test/run), `pyproject` scripts if trivial — read via desktop IPC `ccm:scripts(dir)` with size caps; no execution during detection.
- UI: toolbar button (Play glyph) in terminal pane header + sidebar project menu + Quick open prefix `>` . List grouped by source, fuzzy filter, shows command. Enter → new shell tab (or split with Ctrl/⌘+Enter) in that dir running the command (typed into the new shell + Enter — owner's explicit action). Recent scripts first.
- Dev scripts (`dev`, `start`, `serve`, `preview`) → after launch, dev server chip appears as usual.

## Tests

Unit: scripts parsers, layouts store, sidebar row model. E2E `e2e/tier2.cjs`: sidebar rows + click, save/open layout, scripts list + run `npm run hello` in fixture.
