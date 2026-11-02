## WP-7: Dọn + nhãn trạng thái tiếng Việt
- Mục tiêu:
  1. Xoá `components/SessionBar.vue` (không còn importer — Grep xác nhận lại) và state `barMin` / `barDock` trong stores/ui.ts (+ storage key,
     migrate an toàn: key cũ bỏ qua), test liên quan.
  2. Nhãn trạng thái locale vi tiếng Việt hết, nhất quán toàn app: `status.*` (working → "Đang chạy", waiting → "Đang chờ", idle → "Rảnh",
     completed → "Xong", error → "Lỗi", cancelled → "Đã huỷ", stale giữ "Đã đóng", các key khác theo cùng giọng) và các chỗ lặp như
     `stats.working/waiting/errors`, History legend. Grep vi.ts + mọi `i18n/*.ts` (khối vi) tìm 'Working' / 'Waiting' / 'Idle' / 'Error' /
     'Completed' / 'Cancelled' còn tiếng Anh dùng làm nhãn trạng thái. en giữ nguyên. Không đổi tên agent/tool (Explore, Plan…).
  2b. Xoá khối CSS `.ccm-side-*` không còn dùng trong apps/web/src/style.css (Grep xác nhận); thêm dòng Ctrl+, / ⌘, "Mở cài đặt" vào lib/shortcuts.ts (bảng phím tắt).
  2c. Xoá DimToggle.vue + key `wsHelp.button` nếu không còn dùng (WP-4 bỏ); tip lần đầu của Dim chuyển thành tip của mục Dim trong ⋯ thanh tab nếu cơ chế tip cho phép, không thì bỏ và ghi report.
  2d. Dòng tóm tắt History dùng `history.worked` / `history.waited` (WP-6): đổi nhãn vi phải còn đọc đúng trong câu đó.
  3. Kiểm chữ tràn sau khi đổi (nhãn VI dài hơn): pill/chip có `truncate` hoặc `whitespace-nowrap` hợp lý.
- Phạm vi file: components/SessionBar.vue (xoá), stores/ui.ts, i18n/vi.ts và khối vi trong i18n/*.ts (main giao quyền sở hữu hot file i18n cho WP này,
  sau khi main đã đăng ký file ui-v79-* của WP-1..6), test/e2e có so chuỗi 'Waiting'… (Grep apps/desktop/e2e + apps/web/src *.test.ts).
- Phụ thuộc: WP-1..6 xong | Song song: không | Worktree: không
- Model: sonnet.
- Tiêu chí: [ ] SessionBar + barMin/barDock hết, typecheck sạch · [ ] không còn nhãn trạng thái tiếng Anh trong vi (liệt kê key đã đổi) ·
  [ ] i18n parity test pass · [ ] e2e/unit so chuỗi đã cập nhật.
- Lệnh test: `npm run typecheck -w @ccm/web`; vitest `src/i18n` + `stores/ui` + test có chuỗi trạng thái.
- Nhìn thấy được: có (WP-8). Báo cáo: `.planning/wp/WP-7-report.md`

## Nhật ký
