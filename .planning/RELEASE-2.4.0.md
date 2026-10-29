## Workspace & editor
- What's new dialog after each update; open it again from Settings or Ctrl+K.
- Explorer gets Search, TODO and Checks views; Replace in files with a per-line preview you tick.
- Editor: Outline, Go to Symbol, bookmarks, recent files and edits, back / forward.
- Local History for files saved in the app, and Format on demand with a diff before applying.
- JSON / YAML tree view, a log viewer (levels, filter, follow) for large `.log` files.
- Send requests from `.http` / `.rest` files, with environments and a response view.
- Split preview beside the Markdown editor that follows its scroll; inline colour swatches with a picker.
- Drop-down shell terminal on `` Ctrl+` ``.
- Project notes (Ctrl+Alt+N) kept outside the repo, and a Plan board for `.planning` checklists.
- Errors from a shell terminal go to Problems.
- Ctrl+K developer tools: JWT, Base64, URL, timestamp, count, UUID.
- Compare any two files, or a file with the clipboard; `.env` check against `.env.example`; scan for missing, extra and untranslated i18n keys (Android, Flutter ARB, JSON locales).

## Git
- Stage, commit and blame in the app.
- Merge conflicts solved block by block.
- Changed images compare against HEAD in Changes.
- Checkpoints per agent turn, and Turn review to keep or drop each hunk.
- Compare and merge worktrees.

## Run & devices
- Device screenshot from the Devices tab or the Run pane, attached to an agent pane.
- Inspect views on the screenshot: id, text, bounds; Find in files or fill into an agent.
- Test UI on a device: dark mode, font size, display size, app language, animations off, then Restore all.
- Open the project's deep links and exported activities on a device, or type a URI.
- The Run pane catches Android and Flutter crashes and ANRs; frames in your project open the file.
- Fill a crash into the agent: exception, project frames and the log before it, with secrets masked.

## Agents
- Prompt library, and a prompt queue per agent pane that fills the input when a turn ends.
- An inbox of what needs you.
- A warning when several agents edit the same file.
- Permission prompts per project: repeated asks grouped into allow rules you tick.
- Ticked rules are written to `settings.local.json` only after a confirm that shows the exact diff.
- Background context of a session: first-reply tokens and the size of CLAUDE.md, memory and skills.

## Monitor
- New optional hook bridge: session cards and the map show when an agent is compacting and how many tools were denied.
- History has an activity heatmap by day and hour.
- In a narrow window the Sessions panel opens as a bottom sheet.

## Notes
- The hook bridge is off until you turn it on in **Quick setup**; the permission prompts advisor, compacting and denied-tool signals need it. If you turned it on in a pre-release build, turn it off and on again so it also records permission prompts.
- Windows: `Orrery-Setup-2.4.0.exe` (installer) or `Orrery-Portable-2.4.0.exe`. The exe is not code-signed: on the SmartScreen warning choose **More info → Run anyway**.
- macOS: `Orrery-2.4.0-arm64.dmg` (Apple Silicon) or `Orrery-2.4.0-x64.dmg` (Intel). The app is not notarized: open it once, then **System Settings → Privacy & Security → Open Anyway**.
