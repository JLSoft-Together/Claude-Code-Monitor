# v62 — Auto save (VS Code `files.autoSave`)

Owner decisions (2026-10-22): four modes `off | afterDelay | onFocusChange | onWindowChange`, delay 500 / 1000 / 2000 / 5000 ms (default 1000), **off** by default; with auto save on, closing a pane or quitting saves instead of asking, and asks only when a save fails.

## Invariants
- Auto save goes through `FilePane.vue` `save()` with `knownMtime`: a file an agent changed on disk returns `conflict`, the conflict bar opens and auto save stops until Reload / Keep mine. It never overwrites.
- Text typed while a save is running stays dirty (`markSaved(text)`), and the next trigger saves it.
- Auto saves are quiet: no Saving… / Saved flash; the ● going away says it. Errors still show the edit notice.
- `onFocusChange` also fires on window blur (as VS Code); `onWindowChange` only on window blur / document hidden.
- Switching the mode never saves at once.

## Wiring
- `apps/web/src/lib/autoSave.ts`: modes, delays, `firesOn(mode, trigger)`.
- `stores/settings.ts`: `autoSave` (`ccm.autoSave`), `autoSaveDelay` (`ccm.autoSaveDelay`).
- `FilePane.vue`: edit debounce in `onEditorChange`, `focusout` outside the pane, `props.active` → false, `finishEdit`, window `blur` / `visibilitychange`.
- Close: `WorkspaceView.vue` / `MissionControl.vue` `closePanes` call `workspace.saveFiles` first; failed panes keep the Save / Don't save / Cancel sheet.
- Quit: `reportDirty(files, autoSave)` → preload `editorDirty` → `editors.ts` `autoSave()`; `main.ts` `confirmUnsaved` runs `saveAll` first and shows the dialog only if that fails.
- UI: Settings → Appearance (next to Minimap), Save button tooltip names the mode.
