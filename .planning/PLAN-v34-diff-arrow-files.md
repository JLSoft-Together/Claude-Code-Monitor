# v34 — ← / → đổi file trong diff

Goal: ở Changes pane và Log (diff mode), ← / → không modifier = file trước / sau (thay vì F7 hai lần ở change cuối).

- `fileStepKey(e)` trong `apps/web/src/lib/changesView.ts` (1 / -1 / 0; có Ctrl/⌘/Alt/Shift → 0).
- `ChangesPane.onKey`: `stepFile(dir, land, focus)`; từ diff → focus về `section` gốc (diff unmount khi file mới đang tải). Bỏ qua khi ở tree list (← / → gập/mở thư mục) và trong `[role=toolbar],[role=radiogroup]` (audit 2026-10-15).
- `LogPane.onKey`: bỏ qua trong `[role=tree],[role=toolbar],[role=menu],[role=dialog]`; nút prev/next ghi `(←)` / `(→)`.
- Rulings: (1) ← / → đổi file ở diff + flat list + Log diff; (2) tree list giữ ← / → cho thư mục, refs tree của Log giữ của nó; (3) có modifier thì không đổi gì (Alt+← / → vẫn đổi pane, Shift chọn text); (4) ← / → không còn cuộn ngang diff (Shift+wheel / scrollbar vẫn được); `[ ]`, F7, J/K giữ nguyên.
- Chốt ruling 4 (gaps 2026-10-15): bản trước cho ← / → cuộn ngang khi vùng diff tràn (`inSidewaysScroller`) — đã bỏ. ← / → luôn đổi file kể cả khi diff tràn ngang, trừ khi focus ở ô nhập / contenteditable. Cuộn ngang bằng phím: Shift+← / → (`scrollSideways` trong `lib/changesView.ts`, 40 px; bỏ qua khi đang có vùng chọn text để Shift+mũi tên vẫn mở rộng vùng chọn). Áp cho Changes pane và Log diff. E2E `diff.cjs`: new.md tràn ngang, Shift+→ cuộn, ← trên scroller đổi file.
- Test `apps/web/src/lib/reviewTools.test.ts` (`fileStepKey`); E2E `apps/desktop/e2e/diff.cjs` (→ / ← từ diff, focus, Alt+→, ← hai lần trong tree vì tree đi theo cursor).
- Plan gốc: `docs/superpowers/plans/2026-10-15-diff-arrow-files.md`. Không bump version theo plan (bump một lần cuối đợt).
