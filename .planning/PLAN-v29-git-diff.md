# PLAN v29 — Android Studio style git diff (2026-10-15)

Source: `Plan Git Diff Viewer cho IDE TypeScript.md` (repo root). Owner picked: **read-only** (no editor: rollback = `git apply -R` behind a confirm, no "edit inside the diff"), **upgrade the Changes pane** instead of a new `diff` pane kind, scope **phases 1–3** (no staging / history / 3-way). Base = HEAD.

## Why git is the diff engine
`git diff` already applies autocrlf / filters / renames / binary detection, and a rollback patch built from its own lines (`DiffLine.raw`, CR kept) has the same bytes the existing Discard hunk path (`discardHunk`: `git apply -R --check` first) accepts. So: no jsdiff, no "base content" IPC. Full-file view = `git diff -U1000000` (cap 3 MB, then falls back to 3-line context, `partial`).

## Pieces
- Desktop `preview/changes.ts`: `diff(root, rel, {context: 3|'full', whitespace: none|eol|all|all-blank})` (`cleanDiffOptions`, `diffArgs`), `fileDiff(abs, repoRoot)`; ipc `ccm:changes-diff` takes `opts`, new `ccm:changes-file(path)` (allowedPath, registers the repo like `changes-status`).
- Web `lib/diffBlocks.ts` (pure): `changeBlocks` (IntelliJ Range: 0-based half-open `line1/line2`, `vcsLine1/vcsLine2`, added/deleted/modified; one git hunk may hold several blocks), `blockAt`, `blockPatch` (one block for `git apply -R`: ±3 current-side lines, neighbouring additions become context, their deletions dropped; leading/trailing context rules of `git apply` hold because line numbers are real), `wordDiff` (token LCS over the whole block, null past 250k cells), `foldRows` (collapse unchanged, MIN_FOLD 3).
- Changes pane: options popover (collapse + 3/5/10 context lines, whitespace, words/lines), `ccm.workspace.diffOpts` (migrates `diffLayout`), list ↔ folder tree (`lib/changesTree.ts`, `ccm.workspace.changesTree`), F7/Shift+F7 across blocks then files (warn first), J/K alias, `[ ]` files (Alt+←/→ is pane focus here), F4 open at the block, revert per block (inline ↶ / split »), disabled with a reason when whitespace ≠ none. `select` prop ← store `openChanges(cwd, {select})` (runtime `Pane.select`).
- File viewer: `useFileChanges` (`changesFile`, re-read on `changes-updated` while active and after the viewer reloads), gutter bar / triangle on the line-number column, `HunkPopup` (old text with word marks, prev/next, Rollback → DiscardConfirm, Show diff, Copy), minimap bars or `ChangeRuler` when the minimap is off, toolbar `+N −M` = Show diff.
- Explorer: status read while the Explorer is visible (Files too); names coloured by kind + letter + sr text, folders above a change get `diff-mod` + dot; Ctrl+D / ⌘⌥D (⌘D splits) on a changed row → Changes on that file.
- v33 (2026-10-15): split view rebuilt JetBrains style (no filler rows, curved gutter, synced scroll); see PLAN-v33-split-diff.md.
- Colour `diff-mod` / `-soft` / `-well` (style.css, every themes.css palette, themes.test contrast); `KIND_CLASS` modified/renamed use it.

## Out of scope
Changelists, staging (file / hunk / line), commit history diff, 3-way merge, folder / binary diff, editing in the viewer.

## Tests
`lib/diffBlocks.test.ts`, `lib/changesTree.test.ts`, `apps/desktop/test/changes.test.ts` (opts, fileDiff, block revert LF + CRLF), E2E `apps/desktop/e2e/diff.cjs` (22 checks).
