## WP-3: Workspace rail gọn
- Mục tiêu (rail khi sidebar mở: WorkspaceSidebar + workspace/rail/*):
  1. Mỗi mục 1 dòng. Cluster head (dự án): folder mark + tên + nhánh git canh phải cùng dòng (bỏ dòng checkout riêng khi chỉ có 1
     checkout; nhiều checkout/worktree thì vẫn liệt kê nhưng mỗi checkout 1 dòng thấp). Row (pane/session): PaneIcon có badge trạng thái
     + tên + thời gian/activity tail canh phải + diff chip nhỏ. Dòng thứ 2 ("Claude · Đang chạy · 2 subagent · 6m 05s", "Sẵn sàng")
     chuyển thành tooltip (title + aria-describedby / sr-only), CHỈ hiện thành dòng 2 khi đang chờ chủ nhân hoặc lỗi (cần chú ý).
     Row min-h ~28px thay 40px.
  2. Nhóm dự án: "Đang có agent" (cluster có pane đang chạy/đang chờ) lên đầu, rồi "Đã mở" (còn lại). Dự án đóng/không pane nằm cuối
     gộp thành 1 dòng "＋ N dự án khác" bấm để mở rộng (nhớ trạng thái localStorage `ccm.rail.othersOpen`, try/catch). Thứ tự trong từng
     nhóm giữ như hiện tại (kéo thả rail vẫn chạy — useRailDrag).
  3. Đầu rail: ô lọc nhỏ (lọc tên dự án/session, Esc xoá) + nút mở project dạng icon (+) có tooltip "Mở project (Ctrl+Alt+P)" thay nút
     dashed chữ to. Nút collapse-others giữ (icon).
  4. Chữ: bỏ mọi `text-[10px]`/`text-[9px]` trong rail → tối thiểu 11px.
  5. Rail thu gọn (RailColumn) chỉ chỉnh chữ/size nếu lệch; không đổi hành vi.
- Phạm vi file: components/workspace/WorkspaceSidebar.vue, components/workspace/rail/**, components/workspace/RailColumn.vue (nếu ở
  chỗ khác thì đúng file đó), composables/useRailDrag.ts (chỉ nếu bắt buộc), i18n/ui-v79-rail.ts (mới), e2e/unit selector bị đổi.
  Cấm: WorkspaceView.vue, TermPane.vue, en.ts / vi.ts / index.ts, stores/ui.ts (cần state mới → localStorage cục bộ hoặc "Hot file cần thêm"),
  stores/workspace.ts trừ khi chỉ thêm getter thuần (ghi rõ trong report).
- Phụ thuộc: không | Song song: WP-1, WP-2 | Worktree: không
- Skill: frontend-design, ui-ux-pro-max. Model: sonnet.
- Tiêu chí nghiệm thu:
  - [ ] Ảnh chủ nhân (14 dự án, 3 dự án có session): rail dài ≤ ~60% số dòng cũ; dự án có agent ở trên cùng.
  - [ ] Mọi thông tin dòng 2 cũ vẫn đọc được qua tooltip + screen reader; dòng cần chú ý vẫn hiện 2 dòng.
  - [ ] Kéo thả rail, đóng pane (X hover), menu dự án, nút "new in", RunBadge, needs badge, peer badge vẫn chạy.
  - [ ] Ô lọc lọc đúng, Esc xoá, không phá phím tắt rail hiện có.
  - [ ] typecheck web sạch; vitest rail/workspace + src/i18n pass; e2e selector đổi đã sửa.
- Lệnh test: `npm run typecheck -w @ccm/web`; vitest test có sẵn cho rail (Grep `rail` trong apps/web/src/**/*.test.ts).
- Nhìn thấy được: có (WP-8 chụp; WP này ghi CHƯA NHÌN — Workspace cần app desktop, không chạy được ở dev).
- Báo cáo: `.planning/wp/WP-3-report.md`

## Nhật ký
- WP-3: audit xong; viết railView.ts + test; sửa RailRow/GroupHead/ClusterView/Sidebar, i18n ui-v79-rail.ts, e2e tier2/rail; typecheck sạch, vitest rail+i18n 127/127 pass; report đã ghi. CHƯA NHÌN: WP-8 chụp.
