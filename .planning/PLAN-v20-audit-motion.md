# PLAN v20 — audit fixes + motion (2026-10-14)

Source: 3 read-only subagent audits after v2.0.0 (`6e7fe01`). Unverified items marked (?).

## A. Collector + desktop fixes

| # | Sev | Where | Fix |
|---|-----|-------|-----|
| A1 | High | `collector/launcher.ts` spawn `wt.exe`/`powershell.exe` with `cwd` = favorite dir | Absolute paths (Windows search cwd before PATH → repo file hijack). Same for `process.ts`, `codex/processes.ts`, `focus.ts` |
| A2 | High | `server.ts` `maxPayload: 4096` vs `favorite.reorder` 100×1024 | Raise to 128 KB |
| A3 | High | `store.ts` `flush()` listeners no try/catch | Per-listener try/catch so WS broadcast never skipped |
| A4 | High | `pty/host.ts` shutdown async `taskkill` + exit 300 ms | Sync taskkill on shutdown → no orphan agents |
| A5 | Med | `main.ts` `openLink` focus without `k` | Require non-empty `k` before showMain/paneHandles |
| A6 | Med | `index.ts` shutdown skips Toaster/Snooze JsonFile flush | Flush them; `usage.stop()` save without awaiting scan |
| A7 | Med | `toast.ts` key regenerated per start | Persist key in `CCM_DATA_DIR` (old toasts keep working) |
| A8 | Med | `monitor.ts`, `codex/monitor.ts` watcher error | Close + drop dead watcher |
| A9 | Med | `main.ts` log mask | Wider pattern (`sk-`, `ghp_`, `AKIA`, base64 `/`), home path → `~` |
| A10 | Med | `index.ts` `uncaughtException` swallowed | Log + exit(1) (host restarts) |
| A11 | Low | `supervisor.ts` respawn during quit | `stopped` guard |
| A12 | Low | `main.ts` `ccm:logs` save unguarded | try/catch → `{ ok:false }` |
| A13 | Low | `toast.ts` `accepts()` `===` | `timingSafeEqual` |
| A14 | Low | `favorites.ts` `keyOf` lowercases on mac | win32 only |
| A15 | Low | dead code: `snoozePage` HTML, `page.opening/opened` strings, dev toast link fallback, `isCollectorAt`, folder-pick WS path (?), stale `_meta.md` lines | Remove |

## B. Web fixes

| # | Where | Fix |
|---|-------|-----|
| B1 | `WorkspaceView` keys/attention in compact mode | Gate on real visibility |
| B2 | `usePaneInfo.isBusy` plain shell (npm run dev) | Confirm close for any running shell |
| B3 | close-confirm alertdialog | Tab trap + focus restore to pane |
| B4 | return to Workspace | Focus active pane |
| B5 | `TermPane.paste()` `clipboard.read` reject kills text paste | Separate try → `readText` |
| B6 | `workspaceKeys` Ctrl+Alt+digit = AltGr | Skip when `AltGraph` |
| B7 | `openMenu()` with 0 tabs | Focus inline picker |
| B8 | WorktreeMenu Esc while loading/error; SplitMenu Tab / tab switch | Focus root; close on Tab/hidden |
| B9 | `WorkspaceSidebar` aria id from path | Index id |
| B10 | `SavedPane` drops `resume`/`agentSessionId` | Persist |
| B11 | tablist roles; shortcuts dialog lacks Workspace group | `role=presentation`; add group |
| B12 | dead `closeTab`/`liveCount`; `killById` no timeout | Remove / timeout |

## C. Motion

Tokens (`style.css`): `--ease-out-quint` (keep), `--ease-spring` `cubic-bezier(.34,1.32,.64,1)`, `--ease-exit` `cubic-bezier(.4,0,1,1)`; `--ccm-dur-press 100 / fast 150 / base 220 / slow 300`. Enter base/slow quint|spring, exit fast ease-exit, transform/opacity only.

1. Reduced motion: keep fades, drop translate/scale (HIG); fix quota/token badge never showing; Agent Map camera duration 0.
2. Menus/popovers (SplitMenu, WorktreeMenu, launch menu, PlanLimits, AppSelect): shared `ccm-menu` enter+exit, origin at trigger.
3. Dialogs (Diagnostics, Recap, Shortcuts, CommandPalette, close-confirm, Settings): one pattern, sheet scales out.
4. Monitor ↔ Workspace: stacked crossfade, no layout push.
5. Lists: leave `position:absolute` → siblings slide up.
6. Workspace tabs: TransitionGroup + sliding pill.
7. Split/close pane + sidebar toggle: View Transitions morph (xterm fits once).
8. Agent Map: node move transition, fade-out before remove.
9. TermPane: state chip crossfade, dim when exited, attention ring on pane/tab/sidebar dot.
10. Stale banner absolute (no header jump).
11. Press feedback `.ccm-btn` .985 / plain .95; SegmentedControl sliding thumb; ToggleSwitch stretch.
12. Layout-prop cleanup: OnboardingTour, PlanLimits/UsageModels width → scaleX; easing sweep.

## Verify
typecheck + tests; E2E p2–p6/split; screenshots of menus/tabs/split via CDP.
