# WP-12 report

File đã sửa:
- README.md: 134 dòng cũ -> 121 dòng mới (tiếng Việt, chủ yếu bullet, nhóm Giám sát / Workspace / Git / Run và thiết bị / Preview / Tiện ích / Cài đặt; ảnh giữ nguyên tên file). Bỏ bảng "Lỗi thường gặp" chi tiết, gộp thành một dòng Chẩn đoán; rút gọn phần cài đặt và status line.
- .planning/RELEASE-3.0.0.md: mới, en + vi, 5 nhóm (Settings, Monitor, Workspace, Thanh trên cùng, Màn khác), 12 bullet mỗi ngôn ngữ.
- apps/web/src/lib/changelog.ts: thêm mục 3.0.0 (2026-11-03), 10 dòng en + vi, mỗi dòng <= 100 ký tự.
- apps/desktop/package.json và package-lock.json (workspace apps/desktop): version 2.6.1 -> 3.0.0. Không còn chỗ khác giữ 2.6.1 (APP_VERSION lấy từ apps/desktop/package.json qua vite define).

Test: vitest changelog.test.ts + src/i18n -> 5 file, 10/10 pass. Typecheck web không chạy lại (chỉ thêm data vào changelog.ts, cùng kiểu Release).

Nguồn changelog: WP-1..7, 10, 11 (WP-1 và WP-2 ghi nhận dòng đã gộp). Dòng "Thay đổi cách đọc" gộp vào bullet thanh trên (Hạn mức hiện % còn lại thấp nhất; Dim / Phím tắt / Hướng dẫn vào ⋯).
