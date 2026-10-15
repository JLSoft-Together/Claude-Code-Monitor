# v35 Explorer context menu

Full plan: `docs/superpowers/plans/2026-10-15-explorer-context-menu.md`. Audit: `.planning/AUDIT-2026-10-15-pending-plans.md` (explorer-context-menu).

**Goal:** right-click / keyboard menu on Explorer rows, a minimal subset of Android Studio's Project view menu.

## Rulings
1. Items: New ▸ File… / Folder…, Copy Path/Reference ▸ Absolute / From Project Root / File Name, Rename… (Shift+F6), Delete… (Delete; ⌘⌫ on macOS), Open in Right Split (Shift+Enter), Open In ▸ Explorer|Finder / Terminal, Run…, Git ▸ Show Diff (repo only), Reload from Disk.
2. Out: Cut/Copy/Paste of files, Find Usages, Refactor, Local History, Compare With, … (see full plan).
3. Delete = OS trash (`shell.trashItem`) after an in-app confirm, never `rm`. Root row: no rename / delete.
4. Rename never overwrites; case-only rename allowed (bigint `ino`/`dev` + names equal ignoring case — plain-number NTFS ids collide). Open viewers follow.
5. Open In ▸ Terminal: shell tab in the folder (row itself for a folder, else its parent).

## Audit decisions applied
- `explorerRoot` (= `PreviewIpc.resolveDir`, shared with Run + Layout) unchanged; new channels on the last CHANNELS line.
- EPERM / EBUSY / EACCES → `error: 'busy'`, own en/vi status ("in use — stop the run / close the viewer").
- Folder rename remaps `file` path and `run` / `changes` / `log` `cwd` / `root` (`renamedPanePatches`); terminals keep their cwd (the shell is already there). Tab `project` is not remapped (multi-project v38 owns it).
- `.agent-monitor/run/` (shared run configs) and `.agent-monitor` itself: rename / delete stay enabled, but the menu item, the rename dialog and the trash confirm show "Shared run configuration: the Run pane loses it." Disabling would block legit clean-ups; a hint is enough.
- "Run…" on the root row, folders and pubspec.yaml / build.gradle(.kts) / settings.gradle(.kts) → `workspace.openRun(dir)`; decided by row name only, shown only when `desktop.runDetect` exists (`hasRun`).
- vi "Delete…" = "Chuyển vào thùng rác…" (says what happens, sidesteps the xoá / xóa split).

## Pieces
Desktop `preview/explorer.ts` `renameEntry` / `trashEntry`, IPC `ccm:rename-entry` / `ccm:trash-entry`, `trashFn`, preload. Web `lib/preview.ts`, store `rename` / `trash`, `tree.ts` `movedPath` / `renamedPanePatches`, `lib/menu.ts` + `ui/ContextMenu.vue`, `lib/explorer/contextMenu.ts`, `CreateEntryDialog` rename mode + hint, `DiscardConfirm.confirmLabel`, `ExplorerPanel.onAction`, `WorkspaceView` events.

## Tests
`apps/desktop/test/explorer.test.ts`, `apps/web/src/stores/explorer.test.ts`, `lib/explorer/explorer.test.ts`, `lib/menu.test.ts`, `lib/explorer/contextMenu.test.ts`; E2E `apps/desktop/e2e/explorer-menu.cjs` (in `run.cjs`). No version bump (one bump for the whole batch).

## Deviations
- Rename keeps a check-then-act race (TOCTOU): `renameEntry` lstat's the destination, then `fs.rename`; an entry created there in between is overwritten on POSIX (Windows refuses). Accepted: local single-user tool, no atomic no-replace rename in Node.
- Review fixes: fs failures named by code (`fsFailure`: EPERM/EBUSY → busy, EACCES → denied, ENOENT → missing, EEXIST/ENOTEMPTY → exists); names with `< > : " | ? *` refused (`character`); `.git` gets a Rename/Delete hint; trashing closes file viewers on that path; menu closes on outside scroll / trigger pointerdown, clamps inside the window and scrolls when taller.
