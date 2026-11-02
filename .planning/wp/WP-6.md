## WP-6: Màn phụ clean (Lịch sử, Thống kê, Devices, Extensions, Git Log toolbar)
- Luật chung (áp mọi màn trong phạm vi):
  - Trang = tiêu đề + 1 câu mô tả ngắn + tối đa 1 nút chính (tô accent) góc phải tiêu đề; nút khác là nút phụ.
  - Không lồng thẻ trong thẻ: section dùng tiêu đề + đường kẻ (`border-line`); chỉ phần tử tách biệt thật (ô tìm, biểu đồ, thẻ item trong lưới) có nền.
  - Màu trạng thái chỉ cho trạng thái (COLOR-SYSTEM); bỏ viền trái màu ở ô số.
  - Chữ phụ ≥ 11px; ghi chú dài → tooltip ⓘ.
  - Trạng thái trống có hành động (nút), không chỉ dòng chữ xám.
- Từng màn:
  1. History (history/HistoryView.vue + con): ô tìm + "Mọi dự án ▾" + khoảng ngày (segmented hoặc menu) lên đầu, không bọc thẻ; ghi chú quyền
     riêng tư thành ⓘ cạnh ô tìm; "Hôm nay": 3 ô số Working/Waiting/Idle → 1 dòng tóm tắt cạnh tiêu đề ("làm 1m 26s · chờ 2m 41s · rảnh 20s");
     mỗi session 1 dòng: StatusIcon + tên + thanh thời gian + % (bỏ dòng % riêng). "Tổng kết ngày" thành nút phụ (trang không có hành động chính khác
     thì giữ accent — chọn 1, ghi report).
  2. Usage/Thống kê (usage/UsageView.vue + ProjectTable): 1 hàng chọn khoảng thời gian; ≤ 4 số chính 1 hàng; tiêu đề mỗi khối nói kết luận khi có
     dữ liệu (vd "Tuần này dùng nhiều nhất: <project>"), không bịa số.
  3. Devices (devices/DevicesView.vue): danh sách thiết bị là nội dung chính; các lối ghép (mã, QR, Wi-Fi, discover) gom vào 1 nút "Thêm thiết bị"
     (menu hoặc dialog có sẵn); trống → hướng dẫn 1 câu + nút "Thêm thiết bị". Không đổi logic adb.
  4. Extensions (extensions/ExtensionsView.vue): segmented MCP / Plugin / Khác giữ; scope global/project giữ; thẻ trong lưới cùng chiều cao; nút "Cài"
     chỉ trên thẻ chưa cài, thẻ đã cài hiện trạng thái + menu ⋯.
  5. Git Log (workspace/log/LogRefsToolbar.vue, 15 nút): khi mở hiện Fetch, Update(pull/ff), Push, Tìm; tạo nhánh / xoá / so sánh / favorite /
     navigate / expand all / collapse all / group-by / tags → menu ⋯. Xoá vẫn qua confirm native như cũ. Graph/LogTable không đổi.
- Thêm (từ WP-1): DevicesView.vue:64 nút mở Settings → `ui.settingsPage = 'integrations'` rồi `ui.settingsOpen = true`.
- Phạm vi file: components/history/**, components/usage/**, components/devices/DevicesView.vue (+ component trình bày con nếu cần, không đổi
  lib/devices.ts / stores/devices.ts), components/extensions/ExtensionsView.vue (+ thẻ con), components/workspace/log/LogRefsToolbar.vue,
  i18n/ui-v79-pages.ts (mới), e2e/unit selector bị đổi. Cấm: WorkspaceView, TermPane, LogPane header (WP-4), AppHeader, en.ts/vi.ts/index.ts, stores/*.
- Phụ thuộc: không | Song song: WP-4, WP-5 | Worktree: không
- Skill: frontend-design, ui-ux-pro-max. Model: sonnet.
- Tiêu chí nghiệm thu:
  - [ ] Mỗi màn: ≤ 1 nút accent; không thẻ lồng thẻ; không chữ < 11px (Grep `text-\[(9|10)px\]` trong phạm vi = 0).
  - [ ] Mọi hành động cũ còn (liệt kê đi đâu), đặc biệt LogRefsToolbar.
  - [ ] Trạng thái trống Devices / Extensions / History có nút.
  - [ ] typecheck web sạch; vitest + src/i18n pass; e2e selector đổi đã sửa (devices, github-accounts, v74–v77 e2e có thể chạm log/extension).
- Lệnh test: `npm run typecheck -w @ccm/web`; vitest liên quan.
- Nhìn thấy được: có. History/Usage/Extensions xem được ở dev CCM_PORT=4318 (xem brief WP-2); Devices/Log cần app desktop → CHƯA NHÌN.
- Báo cáo: `.planning/wp/WP-6-report.md`

## Nhật ký
- 2026-11-03 WP-6: xong 5 màn + test (1593 pass); nhìn History/Usage; Devices/Extensions/Log CHƯA NHÌN. Report: WP-6-report.md
