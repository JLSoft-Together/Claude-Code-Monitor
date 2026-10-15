# PLAN v39 — resizable Workspace sidebar (2026-10-15)

Goal: drag the width of the Workspace sidebar (Projects | Explorer), keyboard nudges, double-click reset, persisted width. Task plan: `docs/superpowers/plans/2026-10-15-sidebar-width.md`. Status: done (no version bump; app bumps once for the whole batch).

## Pieces
- `apps/web/src/lib/sideWidth.ts`: `clampSideWidth` (200–560, stage keeps ≥ 480 px of the window), `readSideWidth` / `writeSideWidth` (`ccm.workspace.sideWidth`, try/catch).
- `components/workspace/SideResizer.vue`: separator in the aside's right 12 px gap; drag (pointer capture), ←/→ 16 px, Home/End, double-click reset; strings `panel.resize` / `panel.resizeHint`, label `workspace.side.panel`.
- `WorkspaceView.vue`: aside `:style` width (stored preference clamped to the current window), stage `pointer-events-none` while dragging. v38 rail: the closed sidebar is a 52 px avatar column that overrides the width; SideResizer only when open.
- `RunBadge.vue` `compact` (icon only + sr-only text) so the header fits at 200 px.

## Rulings
1. Width 200–560, default 240 (old `w-60`); the stage keeps ≥ 480 px.
2. Width sits on the `<aside>`, so it covers Projects and Explorer and survives the v38 rail.
3. Same interaction as the Monitor `PanelSplitter`.

Tests: `lib/sideWidth.test.ts`; E2E `apps/desktop/e2e/sidebar.cjs` (in `run.cjs`).

## Follow-up (2026-10-15, plan-gaps)
- Kéo sidebar làm Split của XML layout / widget preview (FilePane) lật stacked ↔ side-by-side liên tục quanh 720 px. Sửa: hysteresis `lib/sideWidth.ts` `nextStacked` (stacked khi < 700, side-by-side lại khi > 760) + chỉ áp sau khi bề rộng đứng yên 180 ms (đo lần đầu áp ngay). Không cần cờ "đang kéo" từ `WorkspaceView`: trong lúc kéo width đổi liên tục nên timer luôn bị huỷ. Test `sideWidth.test.ts`.
