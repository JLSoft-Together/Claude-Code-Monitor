## WP-9: XONG (với ghi chú)

### File tạo
- `docs/qa/v79/v79-before-after.html` (850 KB, 1 file, font nhúng). Section: Monitor, Thanh trên, Workspace (rail + thanh tab/header pane + split), Settings (+ tìm), Màn phụ (Lịch sử, Devices, Extensions, Git Log toolbar). Mỗi màn: ảnh Trước | Sau + 2-4 bullet.
- Ảnh "trước": (a) THẬT = ảnh cũ trong README HEAD (monitor, workspace/rail/thanh tab, lấy bằng `git show HEAD:docs/screenshots/*`), ghi "Ảnh cũ (README bản 2.4)"; (b) FAUX stageshow, ghi "Minh hoạ bản cũ": Settings sheet, header 13 mục, Devices, Git Log 15 nút. Lịch sử và Extensions chỉ có ảnh sau + bullet (không dựng faux trước).
- Ảnh "sau": thật từ docs/qa/v79 (10-settings-notify, 11, 14, 16 (đã che serial), 17, 20, 21 crop, 22 crop, 08 crop, 01, WP-11/03). Prompt terminal chứa tên user Windows đã thay bằng `PS F:\orrery-demo\alpha-app>`.
- `docs/qa/v79/release/`: r-settings.png, r-monitor.png (nhóm Cần chủ nhân), r-limits.png (popover Hạn mức, số liệu mẫu), r-wsheader.png (thanh tab 1 pane) — stageshow, 1920 px. `docs/qa/v79/before/`: b-settings, b-header, b-devices, b-gitlog.

### Ảnh README đã thay (cùng tên, PNG palette)
- docs/screenshots/monitor.png (74 KB, = 01-monitor-open-vi-dark)
- docs/screenshots/workspace.png (13 KB, = WP-11/03, đã thay path)
- docs/screenshots/changes.png (33 KB, = 22-git-log-toolbar)
- GIỮ NGUYÊN run-pane.png và whats-new.png: chưa có ảnh thật v79 (Run pane cần fixture Flutter, What's new cần dialog); build.lock còn nên không chụp. Việc cho main sau E2E: chụp 2 ảnh này (hoặc báo con dựng).
- Lưu ý: ảnh workspace/changes mới là fixture trống (terminal rỗng), kém phong phú hơn ảnh cũ; có thể chụp lại bằng fixture acme-shop.

### check.py
`python -X utf8 scripts/check.py docs/qa/v79/v79-before-after.html` -> ĐẠT (desktop 1256 ok, mobile 492 ok, không tràn ngang, cuộn ok, Be Vietnam Pro ok).

### Khác
- Đã xoá `examples/_work-v79*` khỏi skill stageshow, tắt dev server 5173. Không đụng cổng 4317, không build, không git, không sửa code app.
- Nguồn dựng/ảnh trung gian: scratchpad `%TEMP%\v79w\` (prep.py, build.py).
