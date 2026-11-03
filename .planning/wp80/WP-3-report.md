# WP-3 report: lazy app-level dialogs

## Dialog table
| Component | Decision | Why |
|---|---|---|
| RecapDialog | lazy (`ui.recapOpen`) | opened only by menu / palette |
| DiagnosticsDialog | lazy (`ui.diagnosticsOpen`) | same; its 5 s poll starts only on open |
| ResourcesDialog | lazy (`res.open`) | 400 lines, opened by top-bar / palette |
| ShortcutsDialog | lazy (`ui.shortcutsOpen`) | `?` / palette |
| UpdateDialog | lazy (`update.dialogOpen`) | store (`useUpdateStore().start()`) stays in App; dialog only reads the flag |
| DevToolsDialog, BuildCleanDialog | already lazy | unchanged |
| CommandPalette | keep eager | owns the global Ctrl+K keydown listener |
| QuickSetup | keep eager | opens itself at first launch (`ui.setupOpen = true` in setup) and guides wait on that flag |
| OnboardingTour | keep eager | offers the guide by itself per view, resize/scroll listeners |
| WhatsNewDialog | keep eager | offers itself 1.2 s after launch (`offer()`) |
| BreakToast, PhoneFailToast, ZoomHud | keep eager | timer / event driven, 40-85 lines |

Mechanism: new `apps/web/src/lib/lazyOverlay.ts` (`lazyOverlay(load, open)`): `defineAsyncComponent` + a `mounted` latch. The chunk is prefetched in `requestIdleCallback` (timeout 4 s), so the first open is instant and the enter transition still runs; if opened earlier it mounts at once. The component stays mounted after the first open, so leave Transition and focus return are unchanged. Each of the 5 dialogs got `{ immediate: true }` on its open-watch so the focus / load logic runs when it mounts with the flag already true. No store changed.

## Measurements (`npm run build -w @ccm/web`)
- Main chunk `index-*.js`: 1,615,557 B before -> 1,566,600 B after (-48,957 B, -3.0 %). The 5 dialogs plus their lib code (markdown, resources, update) became separate chunks loaded on idle.
- performance.mark mount time: not measured (no marks present).

## Tests
- `npm run typecheck -w @ccm/web`: clean.
- vitest web (all): 597 files, 1596 tests pass, 0 fail.
- E2E (CCM_E2E_DBG=9447, CCM_E2E_PORT=4396, build.lock held): whats-new 20 pass, v74 69 pass, v75 90 pass, v76 83 pass, v25 31 pass, 0 FAIL. v77a / p-* not run.

## Files
apps/web/src/App.vue, apps/web/src/lib/lazyOverlay.ts (new), components/{RecapDialog,DiagnosticsDialog,ResourcesDialog,ShortcutsDialog,UpdateDialog}.vue (immediate watch only).

## Changelog lines
- en: Faster start: rarely used dialogs (recap, diagnostics, resources, shortcuts, update) load in the background.
- vi: Khởi động nhanh hơn: các hộp thoại ít dùng (tóm tắt, chẩn đoán, tài nguyên, phím tắt, cập nhật) tải ngầm khi rảnh.

## Index lines
- web.md: `lib/lazyOverlay.ts` `lazyOverlay(load, open)` idle-prefetched async dialog with mounted latch; used in App.vue for Recap / Diagnostics / Resources / Shortcuts / Update dialogs.
- web.md: those 5 dialogs' open-watch is `immediate` (they can mount with the flag already true).

## Commit message (proposed)
perf(web): lazy-load recap, diagnostics, resources, shortcuts and update dialogs with idle prefetch
