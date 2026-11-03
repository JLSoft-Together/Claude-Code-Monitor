## WP-7: Dự báo hạn mức + thiết bị mặc định theo dự án
1. Dự báo hạn mức: PlanLimits đã có `fullAt` / `pctPerHour` / `beforeReset` (PlanLimits.vue ~37-55). Hiện trong HeaderStatusPopover (v79) dòng
   "Hết lúc 14:20 nếu dùng như hiện tại" cho cửa sổ có rủi ro (risk), và trên nút Hạn mức một chấm cảnh báo khi dự báo chạm 100% trước giờ reset.
   Khi mở agent mới (LaunchPicker / open_session / Workspace "+") mà dự báo chạm 100% trong < 30 phút: hiện cảnh báo inline 1 dòng (không chặn).
   Không bịa số: chỉ khi dữ liệu forecast có thật.
2. Thiết bị mặc định theo dự án: Run nhớ thiết bị chọn gần nhất cho từng project (stores/run.ts đã có devices / settings — xem có sẵn chưa); mở dự án
   (hoặc mở Run pane) thì chọn lại thiết bị đó nếu đang online; Devices: nếu thiết bị đó là thiết bị đã nhớ có auto-connect thì thử kết nối khi mở dự án
   (dùng hàm connect sẵn có trong stores/devices.ts, không poll).
- Phạm vi: components/HeaderStatusPopover.vue, PlanLimits.vue, lib/headerStatus.ts (+test), chỗ LaunchPicker hiện cảnh báo, stores/run.ts (chỉ phần nhớ
  thiết bị), stores/devices.ts (chỉ gọi connect), i18n/ui-v80-limits.ts (mới). Cấm: App.vue (WP-3), apps/desktop pty/** (WP-1), en.ts/vi.ts.
- Model: sonnet. Test: typecheck web, vitest liên quan. Build/e2e chỉ nếu cần, dùng `.planning/wp/build.lock`, CCM_E2E_DBG=9448 CCM_E2E_PORT=4395.
- Báo cáo `.planning/wp80/WP-7-report.md`.

## Nhật ký
