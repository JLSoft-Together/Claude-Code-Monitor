## WP-8: Gộp toast + script đo bundle / khởi động
1. 5 cơ chế toast hiện có: BreakToast, PhoneFailToast, UndoToast (WorkspaceView ~2379), `agentNotice` <p> (WorkspaceView ~2571-2579), ui.ts openResult /
   windowResult timers (~258-262). Gộp về 1 store `stores/toasts.ts` (push({ kind, text, action?, timeoutMs, id? }), dedupe theo id) + 1 component
   `ToastHost.vue` mount 1 lần ở App.vue (vị trí, chồng tối đa 3, aria-live polite, không cướp focus, Esc đóng cái trên cùng, hover dừng đếm).
   Giữ hành vi từng loại (Undo có nút Hoàn tác + thời gian cũ; BreakToast có nút; PhoneFail có nút mở Settings › Thông báo). Xoá component/state cũ không dùng.
2. `scripts/measure.mjs`: build web (hoặc đọc dist có sẵn) → in kích thước từng chunk JS/CSS + tổng gzip; tuỳ chọn `--startup` chạy app dev build qua
   CDP (như e2e/cdp.cjs) đo thời gian tới khi `#app` mount + first snapshot (lấy performance.now từ page), 3 lần lấy trung vị. Ghi kết quả
   `docs/perf/<version>.json` (thêm thư mục). Chạy 1 lần lấy số nền cho 3.0.0+v80.
- Phạm vi: stores/toasts.ts (mới), components/ToastHost.vue (mới), App.vue, BreakToast/PhoneFailToast/UndoToast (gộp/xoá), WorkspaceView.vue (chỉ chỗ
  UndoToast + agentNotice), stores/ui.ts (chỉ openResult/windowResult), scripts/measure.mjs, docs/perf/, i18n/ui-v80-toast.ts nếu cần, e2e bị đổi selector.
  Cấm: apps/desktop pty/** (WP-4/5 sắp chạy), en.ts/vi.ts.
- Model: sonnet. Build + e2e liên quan (v52-polish undo, v76 phone, whats-new, p-*): `.planning/wp/build.lock`, CCM_E2E_DBG=9453 CCM_E2E_PORT=4390, KHÔNG 4317.
- Báo cáo `.planning/wp80/WP-8-report.md`.

## Nhật ký
