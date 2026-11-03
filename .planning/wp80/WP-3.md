## WP-3: Dialog cấp app mount lazy
- App.vue (153-166) mount sẵn 14 overlay: CommandPalette, RecapDialog, DevToolsDialog, DiagnosticsDialog, ResourcesDialog, BuildCleanDialog, QuickSetup,
  OnboardingTour, WhatsNewDialog, UpdateDialog, BreakToast, PhoneFailToast, ShortcutsDialog, ZoomHud. Chuyển cái nào chỉ cần khi mở sang
  `defineAsyncComponent` + `v-if` theo cờ mở trong store (giữ cái cần lắng nghe phím tắt / sự kiện ngay khi khởi động — kiểm từng cái, ghi lý do).
  Lần mở đầu không được giật: prefetch khi idle (requestIdleCallback) nếu hợp. Giữ Transition / focus trả về.
- Đo: kích thước chunk chính trước/sau (`npm run build -w @ccm/web`, đọc dist/assets) và thời gian mount (performance.mark nếu có sẵn). Ghi số thật.
- Phạm vi: apps/web/src/App.vue, các dialog đó (chỉ nếu cần đổi cách mở), stores liên quan (chỉ thêm cờ, ghi rõ), e2e bị ảnh hưởng.
  Cấm: desktop pty/** (WP-1, WP-2). Model: sonnet. Build web + e2e liên quan được (dùng `.planning/wp/build.lock`, CCM_E2E_DBG=9447 CCM_E2E_PORT=4396).
- Tiêu chí: mọi dialog mở được như cũ (e2e whats-new, v74, v75, v76, v77a, p-* liên quan pass); chunk chính nhỏ hơn; typecheck + vitest web pass.
- Báo cáo `.planning/wp80/WP-3-report.md`.

## Nhật ký
