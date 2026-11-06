# PLAN — Telegram: UX nối session ↔ topic (2026-11-06)

Yêu cầu chủ nhân (qua Telegram): tối ưu UI/UX chỗ setup và quản lý session link với topic, cập nhật trạng thái hiện tại, dễ dùng, trực quan cho end user. Chi tiết kỹ thuật: docs §11an-i.

## Quyết định chủ nhân đã chốt
- Topic do chủ nhân **tự tạo**, thường **1 project = 1 topic** → bỏ tạo topic theo session / "mỗi session 1 topic"; mặc định nối theo project, gợi ý topic trùng tên.
- Có **kéo-thả** (gesture), phải tự hiểu được cách dùng (tay nắm ⋮⋮ luôn hiện, dòng hướng dẫn, ô topic trống luôn hiện).
- **Đăng nhập tài khoản Telegram chỉ để quét group + topic**; mọi tin nhắn vẫn do bot gửi. Không làm: đọc lịch sử, read receipt, tìm tin, tạo group tự động.

## Đã làm
1. Trạng thái live session (đang chạy / chờ bạn / rảnh / đã đóng) trên bản đồ topic + header hộp ✈; bấm tên mở pane.
2. Hộp ✈: chọn topic từ danh sách (radio, phím mũi tên + Enter), "đang dùng: …" + nút "Chiếm topic", gửi thử, dán link là phương án phụ; mặc định "Cả project", topic trùng tên lên đầu + chọn sẵn.
3. Tab Topic: "Project đang chạy chưa có topic" (nút "Nối #topic" trùng tên), lọc "Đang chờ bạn", topic lỗi có "Gửi thử lại", ô chọn topic ghi ai đang dùng, form thêm project tự chọn topic trùng tên.
4. Danh sách group/topic hiện ngay từ bộ nhớ (`discover(cached)`), quét live 1 lần mỗi lần mở app.
5. Kéo-thả: project / session / project chưa có topic → khối topic, chip topic trống, ô Ngắt; toast Hoàn tác 6 s. Sửa lỗi Chromium huỷ drag khi bố cục đổi trong `dragstart`.
6. Đăng nhập tài khoản (SĐT → mã → mật khẩu 2 lớp) để quét đủ topic (`userScan.ts`, `notifier.user`, `TelegramAccountScan.vue`).

## Còn lại
- Chủ nhân QA tay trên bản dev: đăng nhập thật + Quét, kéo-thả, hộp ✈.
- Sau khi chủ nhân chốt: commit (chỉ khi được bảo), dòng changelog vào `apps/web/src/lib/changelog.ts` khi bump version (dòng chờ ở `RELEASE-next.md`).
