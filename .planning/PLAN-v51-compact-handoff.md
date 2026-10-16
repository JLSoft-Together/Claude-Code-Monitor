# v51 — "Compact" from the context menu (handoff → /compact → resume)

Owner request (2026-10-16): a context-menu option "Compact" on a session asks that agent to write a handoff
(what it is doing, how far it got, what comes next) into an md file, then stop so the session can be compacted;
after compacting it reads the file and continues. Slash commands (`/compact`, `/clear`) are typed into the TUI,
the model cannot run them itself, so the app types them into the pane.

## Decisions (owner, 2026-10-16)

- Picking "Compact" **sends** the handoff prompt (paste + Enter). Deliberate exception to the "prefill only,
  never submit" rule of v49 / browser handoff: only on the owner's own click, only while the session is idle
  (disabled while working, while waiting on a permission / question, or when the pane is not linked).
- After the handoff: `/compact` is **typed but not submitted**; the owner presses Enter. When the compaction is
  seen (`TerminalSession.compactions` grows, from the transcript's `compact_boundary`), "Read `<file>` and
  continue." is **prefilled, not submitted**.
- File: `<session cwd>/.planning/HANDOFF-YYYY-MM-DD-HHmm.md` (local time).

## Flow (runtime only, never persisted)

`Pane.compact = { step, file, base, worked, missing? }`

1. `writing`: prompt sent. Effective status `working` / `waiting` → `worked`. Back to `idle` after work → check
   the file (`desktop.readFile`): `text` → step `compact`, type `/compact`; `missing` → keep waiting, chip says no
   file yet (the agent may have asked a question); unreadable / no bridge → go on.
2. `compact`: `/compact` typed. `compactions > base` → prefill the resume line, flow ends.
3. Any step: `compactions > base` (owner compacted by hand) → resume prefill. Menu item becomes "Cancel compact"
   while a flow runs; closing the pane drops it.

## Surfaces

- Menus: rail row (agent rows), strip tab (agent pane of the tab: primary if an agent, else the first agent
  pane), Mission Control tile. Shared entry builder `lib/compactHandoff.ts` `compactEntry`.
- TermPane header chip `[data-compact-step]` (writing / no file yet / ready to compact), crossfade; live region
  announces each step.
- Prompt text follows the UI language (`workspace.compact.prompt` / `resume`).

## Files

`lib/compactHandoff.ts` (+test), `composables/useCompact.ts`, `stores/workspace.ts` (`Pane.compact`,
`Pane.prefillSubmit`), `TermPane.vue` (typed slash prefill, submit, chip), menus `railMenu.ts`, `tabMenu.ts`,
`missionMenu.ts` + handlers, `i18n/workspace-v51.ts`, E2E `apps/desktop/e2e/v51-compact.cjs` (shell pane posing as
an agent; no tokens spent), docs §11x, CLAUDE.md principle note.
