## WP-9: Trang trước/sau v79 + ảnh release (web-design + stageshow)
- Mục tiêu: 1 file HTML (skill `web-design`, quy trình + check.py ĐẠT) so sánh trước/sau từng màn v79: Monitor, Workspace (1 pane, split), rail,
  thanh trên cùng + popover Hạn mức, Settings (3–4 trang tiêu biểu + tìm kiếm), History, Devices, Extensions, Git Log toolbar.
  Ảnh "sau" = ảnh thật `docs/qa/v79/*.png` của WP-8. Ảnh "trước": chụp từ bản HEAD (git worktree tạm ở scratchpad, build + chụp bằng cùng script
  v79-shots) nếu làm được; không thì dựng faux UI bằng skill `stageshow` theo ảnh/wireframe cũ, ghi rõ "minh hoạ" dưới ảnh.
- Thêm 3–5 ảnh stageshow cho release 2.7.0 (What's new / README): Settings sidebar, Monitor nhóm "Cần chủ nhân", header popover Hạn mức,
  Workspace header gọn. Lưu `docs/qa/v79/release/*.png`.
- Thay ảnh README (cùng tên file): docs/screenshots/monitor.png, workspace.png, changes.png, run-pane.png, whats-new.png bằng ảnh v79 thật
  (crop gọn, ≤ ~150 KB/ảnh, theme tối như cũ); thiếu ảnh thật màn nào thì chụp thêm bằng apps/desktop/e2e/v79-shots.cjs hoặc dựng stageshow.
- KHÔNG build lại / chạy e2e trong lúc main đang chạy E2E full (kiểm `.planning/wp/build.lock`; main tạo lock tới khi E2E xong) — chụp thêm thì đợi lock biến mất rồi tạo lock của bạn.
- Đầu ra: `docs/qa/v79/v79-before-after.html` (main publish artifact).
- Phụ thuộc: WP-8 | Model: sonnet | Skill: web-design, stageshow, frontend-design.
- Báo cáo: `.planning/wp/WP-9-report.md`

## Nhật ký
