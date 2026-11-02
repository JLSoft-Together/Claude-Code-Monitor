## WP-4: Workspace header pane chung + thanh tab gọn
- Mục tiêu:
  1. Một component header pane chung (mở rộng `ViewPaneControls.vue` hoặc tạo `workspace/PaneHeader.vue`) dùng cho TermPane, FilePane,
     ChangesPane, LogPane, RunPane, BrowserPane. Trái: icon/StatusIcon + tên + (chữ trạng thái CHỈ khi đang chờ chủ nhân / lỗi / đã kết thúc).
     Phải: tối đa 3 nút hiện (thường: phóng to, chia, ⋯) + đóng. Mọi nút khác của từng loại pane vào menu ⋯ (PaneMore). Hành động đã có
     nút hiện thì KHÔNG lặp trong ⋯ và ngược lại (bỏ trùng find/wrap/edit/save/diff/refresh/log/restart/scripts…). Phím tắt giữ nguyên.
     Ngoại lệ hợp lý được giữ hiện: Save khi file dirty, Stop/Start của Run, ô địa chỉ Browser, LogRefsToolbar dọc (WP-6 lo).
  2. TermPane header (TermPane.vue ~1035-1332, ~23 thứ): còn tên preset/session + chip trạng thái phiên khi cần chú ý + ContextGauge nhỏ +
     ⋯ + chia + phóng to + đóng. cwd, worktree/branch, diff, DevServerChip, OverlapChip, activity title, compact-suggest, compact step,
     peer, LimitResumeChip, PromptQueueButton, attach, restart, scan, scripts → ⋯ hoặc tooltip của tên. Chip nào là cảnh báo đang hoạt
     động (LimitResumeChip khi đang giới hạn, compact step đang chạy, OverlapChip khi có chồng chéo, peer đang nhắn) thì vẫn hiện khi
     active, ẩn khi không.
  3. Tab chỉ có 1 pane (không split): ẩn header pane. Thông tin chuyển lên phải thanh tab: ⑂ branch + diff +/− + ContextGauge (đối với
     agent) + ⋯ của pane đó + chia. Khi split ≥ 2 pane: header pane mỏng (h-7) hiện lại cho từng pane.
  4. Thanh tab (WorkspaceView.vue 1907-2163): bỏ ResourcesButton ở đây (WP-5 đưa vào popover Hạn mức ở header app). Help "?" + DimToggle
     vào menu "+"/⋯ cuối thanh tab hoặc giữ 1 nút ⋯. Nút close X của tab chỉ hiện khi hover/focus/tab active.
  5. Trạng thái agent hiện ở 2 nơi chính: rail (WP-3) và tab (StatusIcon). Header pane chỉ ghi chữ khi cần chú ý.
- Phạm vi file: components/workspace/WorkspaceView.vue (chỉ tab row + chỗ render header theo số pane), TermPane.vue (header), FilePane.vue,
  ChangesPane.vue, LogPane.vue (chỉ phần header, không LogRefsToolbar), RunPane.vue / RunBar.vue (header), BrowserToolbar.vue (header controls),
  ViewPaneControls.vue, PaneMore.vue, workspace/PaneHeader.vue (mới, nếu tạo), i18n/ui-v79-pane.ts (mới), e2e/unit selector bị đổi.
  Cấm: rail/**, WorkspaceSidebar (WP-3 xong), en.ts/vi.ts/index.ts, stores/ui.ts, AppHeader, App.vue, log/LogRefsToolbar (WP-6).
- Phụ thuộc: WP-3 xong (cùng thư mục workspace) | Song song: WP-5, WP-6 | Worktree: không
- Skill: frontend-design, ui-ux-pro-max. Model: sonnet.
- Tiêu chí nghiệm thu:
  - [ ] TermPane header ở ≥ 420px: ≤ 4 nút icon hiện + chip chỉ khi active; mọi hành động cũ còn (liệt kê nút → chỗ mới).
  - [ ] Không hành động nào xuất hiện cả ở nút hiện lẫn ⋯ cùng pane.
  - [ ] 1 pane: không có header pane, branch/diff/context/⋯ nằm phải thanh tab; split: header mỏng hiện lại; zoom pane đúng như cũ.
  - [ ] Header container-query collapse hiện có (`@max-[...]`) vẫn đúng ở pane hẹp; không tràn ngang.
  - [ ] typecheck web sạch; vitest workspace + src/i18n pass; e2e selector đổi đã sửa (Grep `data-` trong e2e cho TermPane/FilePane).
- Lệnh test: `npm run typecheck -w @ccm/web`; vitest test workspace liên quan.
- Nhìn thấy được: có (WP-8 chụp; ghi CHƯA NHÌN).
- Báo cáo: `.planning/wp/WP-4-report.md`

## Nhật ký
- 01:36 TermPane header rewritten (Teleport to tab bar when lone, thin when multi); paneHead.ts headMode/statusWordShown + tests
- RunPane dup release-check button removed; FilePane/ChangesPane visible buttons trimmed; WorkspaceView tab row (Resources removed, close X hover, dim+help in ⋯, bar slot+provide)
- BrowserToolbar: only back/fwd/reload+address+handoff(active)+⋯
- e2e selectors updated (data-pane-of :is, ⋯ menu entries, dim in menu)
- 01:41 typecheck 0, vitest 30/30, report written
