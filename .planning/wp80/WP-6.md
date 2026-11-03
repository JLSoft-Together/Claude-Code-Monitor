## WP-6: Móc nối — hàng chờ review, History → Tiếp tục, agent xong → Run reload
1. Hàng chờ review: theo từng dự án, danh sách file agent đã sửa từ lần chủ nhân "đã xem" cuối (nguồn: git status/diff sẵn có của Changes + mốc
   thời gian lưu localStorage theo project, try/catch). Hiện ở Changes pane (nhóm "Chưa xem" lên đầu, nút "Đánh dấu đã xem") và badge số ở
   Monitor thẻ session / rail dự án nếu rẻ (không poll mới; dùng sự kiện hiện có). Bấm file mở diff như cũ.
2. History → Tiếp tục: kết quả tìm session cũ và danh sách đã kết thúc có nút "Tiếp tục" mở pane `--resume <uuid>` trong Workspace của đúng dự án
   (dùng đường resume sẵn có của agent-monitor://open resume=… / undo close). Không gửi prompt.
3. Agent xong → Run reload (tuỳ chọn, mặc định tắt): công tắc trong Run pane ("Tự reload khi agent xong"); khi session agent của dự án chuyển sang
   Rảnh sau khi Đang chạy và Run đang chạy app → gọi reload sẵn có (hot reload Flutter / restart Android theo hành vi nút hiện tại). Debounce,
   không reload khi agent lỗi.
- Phạm vi: components/workspace/ChangesPane.vue (+ lib mới), components/history/**, components/workspace/RunPane.vue / RunBar.vue, stores/run.ts
  (chỉ phần reload tự động), i18n/ui-v80-links.ts (mới), test. Cấm: App.vue (WP-3), apps/desktop pty/** + bất kỳ file web nào WP-1 đang sửa
  (chạy `rtk proxy git status --porcelain` lúc bắt đầu, file web lạ đã sửa mà không thuộc v80 WP-7 thì coi là của WP-1 → đừng đụng), en.ts/vi.ts.
- Model: sonnet. Test: typecheck web, vitest. Build/e2e nếu cần: `.planning/wp/build.lock`, CCM_E2E_DBG=9449 CCM_E2E_PORT=4394.
- Báo cáo `.planning/wp80/WP-6-report.md`.

## Nhật ký
