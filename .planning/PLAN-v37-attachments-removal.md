# v37 — Attachments removal (Backspace + any order)

Full plan: `docs/superpowers/plans/2026-10-15-attachments-removal.md`. Audit: `.planning/AUDIT-2026-10-15-pending-plans.md` (attachments-removal).

- **Goal:** the pane's Attachments tray follows Backspace in the prompt, and × removes any item, not only the last.
- **Ghost-row cause:** each Backspace on `@package.json` left `@package.jso`, `@package.js`… which the scan added as new "terminal" rows. Fix: `cursorToken` names the mention ending at the cursor; `attachments.reconcile(…, editing)` gives it no row until a space follows.
- **`eraseKeys`** (replaces `eraseCount`): ← to just after the token (+ its space), Backspaces (1 per `[Image #N]`, 1 per mention char, + space), → back.
- **Queued erase:** `usePaneAttachments.remove` chains erases (`erasing`), each from a fresh screen read, one key per write (12 ms gap), ESC O D/C when xterm `applicationCursorKeysMode`. `idle()` gates tray inserts and TermPane's `insertRequest` watcher so a paste never lands between erase keys (audit).
- **`@file:line[:col]`** (Run pane "Send to agent", `lib/runUi.ts` `errorPrompt`, also quoted `@"a b.dart":12:5`) is a place, not an attachment: `scanPrompt` skips it (owner decision 2026-10-15).
- **Rulings:** (1) ghost rows are the Backspace bug; (2) removal moves the cursor with arrow keys, only on the user's click, never Enter; (3) tokens on another row / after the cursor / with wide chars before the cursor keep the "remove it in the terminal" notice (reworded); (4) one key per write, 12 ms gap, `ESC [ D` or `ESC O D`.
- **Tests:** `lib/promptAttachments.test.ts`, `stores/attachments.test.ts`, `composables/usePaneAttachments.test.ts`; E2E `apps/desktop/e2e/v25.cjs` (Backspace, any-order removal, no ghost rows) — needs a build, not run yet. Docs §11p item 4.
- No app version bump (bumped once for the whole batch).
