# PLAN v43 — context menu cho rail Projects (2026-10-15)

Mục tiêu: chuột phải / ContextMenu / Shift+F10 trên rail Workspace (header dự án, dòng checkout, dòng session/pane, khoảng trống). Dùng lại menu v35 (`ui/ContextMenu.vue` + `lib/menu.ts`). Trạng thái: **xong**.

## Item
- Dự án (header + checkout; checkout dùng `checkout.path`): Tab mới ▸ (Claude / Codex / Shell / Browser / Mở file… / Changes / Log — viewer chỉ khi bridge có), Run… (`hasRun` + `runnable`), Chạy script…, Bố cục ▸ (Lưu…, Quản lý…, các layout đã lưu), Hiện trong panel Explorer (activate pane của checkout → `showExplorer`), Mở Mission Control, Sao chép đường dẫn, Hiện trong File Explorer / Finder (`ccm:reveal` sẵn có, `hasReveal`), Chuyển lên / xuống (như Alt+↑/↓), Thu gọn / Mở rộng, Đóng dự án (cùng flow run confirm) hoặc Bỏ khỏi danh sách (dự án chỉ được nhớ).
- Session/pane: Chuyển tới, Chia sang phải / xuống ▸ preset (`splitActive`), Sao chép thư mục làm việc (`workCwd`), Hiện trong panel Explorer, Xem phiên trong Monitor (agent row có `terminalId`: `ui.setView('monitor')` + `focusTerminal`), Đóng (như ✕), Đóng các pane khác trong tab.
- Khoảng trống: Mở Project…, Thu gọn / Mở rộng tất cả.

## Bỏ qua (không có action sẵn)
Đổi tên tab (store không có title tab/pane), Chuyển sang tab mới (không có action move pane), Khởi động lại / Mở lại (restart nằm trong `TermPane`, không có action store).

## Code
`lib/rail/railMenu.ts` (`projectMenu`, `rowMenu`, `emptyMenu`, `isMenuKey`) + test; `WorkspaceSidebar.vue` (mở menu, xử lý pick, status "Đã sao chép"); `RailClusterView.vue` / `RailRow.vue` (`@contextmenu`, `data-checkout-key`, `data-row-key`); `WorkspaceView.sideEvents` thêm `split` / `explorer` / `mission`; `lib/preview.ts` `hasReveal`; i18n `workspace.rail.menu.*`.
Layout + Run detect được lấy trước khi mở menu (tối đa 400 ms) để chiều cao menu không đổi sau khi đo.

## Test
`lib/rail/railMenu.test.ts`; E2E `apps/desktop/e2e/rail.cjs` (chuột phải header, Shift+F10 + Esc trả focus, Copy path, Split right, Close project, khoảng trống, flyout cột thu gọn).
