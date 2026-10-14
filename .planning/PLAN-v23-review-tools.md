# PLAN v23 — review tools in Workspace (2026-10-14)

Owner picked (2026-10-14): Changes/diff tab, dev server detection, Browser → agent, Quick open + terminal find. Ships in the same build as v20–v22. Ideas list: `IDEAS-v23.md`.

Rule: nothing types into a terminal by itself — inserts land in the input line, owner presses Enter. Monitoring stays read-only.

## 1. Changes tab

- Pane/tab `kind: 'changes'` per worktree root (git toplevel of pane cwd). Label "Changes (N)", glyph GitCompare, color ink-muted.
- Desktop `preview/changes.ts` (absolute git via existing `pty/git.ts` finder):
  - `status(root)` → `git status --porcelain=v2 -z --untracked-files=all` → `{ path, origPath?, x, y, kind: modified|added|deleted|renamed|untracked|conflict, staged }`.
  - `diff(root, path)` → unified diff vs HEAD (`git diff HEAD -- path`; untracked → `--no-index /dev/null path`), size cap 1 MB.
  - `discardFile(root, path)` → tracked: `git restore --source=HEAD --staged --worktree -- path`; untracked: move to OS trash (`shell.trashItem`), never `rm`.
  - `discardHunk(root, path, hunkPatch)` → `git apply -R --whitespace=nowarn` with patch via stdin; check `--check` first.
  - Live: RootWatcher (v21) → debounce → push `ccm:changes-updated(root)`.
- IPC: `ccm:changes-status`, `ccm:changes-diff`, `ccm:changes-discard` (file | hunk); root must be an allowed root; paths must stay inside root.
- Web `ChangesPane.vue`: left list grouped (Changed / Untracked / Conflicts) with +/− counts (diff-add/diff-del), right diff view — inline default, side-by-side toggle, shiki highlight on well, hunk headers with "Discard hunk", file header with "Discard file", "Open file" (file tab at first changed line). Discard always confirms (alertdialog, destructive red), and lists what will be lost. Keyboard: ↑↓ files, J/K hunks.

## 2. Dev server detection

- `lib/devServer.ts`: parse pty output (ANSI stripped, line buffered) for `http(s)://(localhost|127.0.0.1|0.0.0.0|[::1]):port(/path)` near markers (Local:, ready, listening, Server running). Dedupe per pane.
- Pane header chip "localhost:5173 ↗" (Globe) — click opens/reuses browser tab for that URL; Ctrl/⌘+click in terminal works anyway (fileLinks).
- Remember last URL per project (localStorage `ccm.workspace.devUrl`), offered in `+` → Browser.
- No auto-open (owner opens with one click).

## 3. Browser → agent

- Toolbar menu "Send to agent" (target = linked Claude/Codex pane in same tab, else picker):
  - **Screenshot**: `webview.capturePage()` (visible / device frame) → desktop IPC writes PNG to clipboard → paste into target terminal via existing image paste path. Toast "Screenshot ready — press Enter in the terminal".
  - **Console errors**: collect `console-message` level ≥ warning + page errors (last 50, sanitized, truncated) → list in a popover; "Insert" puts a compact block into the target terminal input (bracketed paste, no Enter).
  - **Pick element**: inject picker into the guest (`executeJavaScript`, highlight on hover, Esc cancels) → returns css selector, tag/classes, text snippet ≤200 chars, outerHTML ≤600 chars, page URL → inserted as a short block.
- Insert API: workspace store `insertInto(paneKey, text)` → TermPane writes bracketed paste to pty (same as paste).

## 4. Quick open + terminal find

- Quick open Ctrl/⌘+P (workspace visible): desktop `listFiles(root)` → `git ls-files -co --exclude-standard` (fallback walk with ignore of node_modules/.git/dist, cap 50k) cached per root, invalidated by watcher. Fuzzy match (`lib/fuzzy.ts`, subsequence + boundary bonus), recent files first. Enter → file tab; Ctrl/⌘+Enter → split. `:line` suffix supported.
- Terminal find Ctrl/⌘+F when a terminal pane is focused (Ctrl+F is readline forward-char in shells → only Ctrl+Shift+F on Windows/Linux, ⌘F on mac): `@xterm/addon-search`, find bar in pane header, count, prev/next, case/regex toggles, Esc closes.

## Order

New modules first (no edits to existing files), then integrate with v21 phase 2b in one pass.
