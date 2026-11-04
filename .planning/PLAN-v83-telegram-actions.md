# PLAN v83 — Telegram: nút hành động, dừng, ảnh màn hình, tổng kết ngày, cảnh báo, file từ Telegram, giờ yên lặng

Ngày: 2026-11-04 · Nối tiếp `PLAN-v82-telegram.md` · Chủ nhân duyệt cả 8 mục (#8 có công tắc + giờ trong Settings).

Mọi hành động từ Telegram chỉ chạy khi **đang nhận lệnh** (`/bot-tele-receive on`) và chỉ từ **tài khoản đã ghép**;
người khác bấm nút → `answerCallbackQuery` "không có quyền", không làm gì.

## 1. Duyệt quyền từ Telegram

- Tin `permission` của session Claude có inline keyboard `✅ Cho phép` / `❌ Từ chối` (chỉ khi đang nhận lệnh).
- `callback_data` = `ap:<k>` / `dn:<k>`, `k` = khoá ngắn trong main → `{terminalId, cwd, chatId}` (500 gần nhất).
- Bấm → trang kiểm session vẫn `waiting` + `waitReason` = permission → pane `typeKeys`: cho phép = `1`, từ chối = Esc.
  TermPane ghi thẳng vào PTY rồi xoá. Sai trạng thái → `state` ("session không còn chờ duyệt").
- Sau khi bấm: `editMessageReplyMarkup` bỏ nút + bot trả lời "Đã cho phép / Đã từ chối".
- Phím chọn `1` / Esc theo hộp thoại quyền của Claude Code 2.1.x — chủ nhân thử tay lần đầu (docs ghi rõ).

## 2. Nút nhanh dưới tin xong việc

`▶️ Tiếp tục` (gửi "Tiếp tục."), `🧪 Chạy test` (gửi "Chạy test của project và báo kết quả."), `📄 Xem diff`
(main chạy `git diff HEAD` ở cwd session, bỏ file bí mật theo `SECRET_FILE_GLOBS`, gửi `changes.diff` ≤ 50 MB; sạch → "không
có thay đổi"). Hai nút đầu đi đường `send` của v82 (prefill + submit khi idle).

## 3. `@bot stop`

Bot trả lời nút xác nhận `⏹ Dừng <tên>`; bấm → Esc vào pane khi session `working`. Session chọn như `send`.

## 4. Ảnh màn hình máy Android

`@bot screen [serial]` → `deviceManager` máy online đầu tiên (hoặc đúng serial) → `screencap` → `sendPhoto` vào topic.

## 5. Tổng kết cuối ngày

Settings: bật/tắt + giờ gửi (mặc định 21:00). Main đếm theo project từ episode nhận được (xong việc, tổng phút làm,
lần chờ, lần xin quyền, lỗi build). Đến giờ → mỗi group 1 tin (General): bảng từng project. Đếm lại từ đầu ngày mới.

## 6. Cảnh báo hạn mức / ổ đầy / build lỗi

Bật/tắt trong Settings (mặc định bật). Hạn mức + ổ đầy: episode `phone` `limit` / `disk` từ collector → General mỗi
group. Build / run lỗi: `RunManager` session `failed` → topic theo `session.cwd` ("❌ <config> lỗi: <code>", detail đã
mask), mỗi session 1 lần.

## 7. Ảnh / voice / file từ Telegram vào session

Tin có ảnh / voice / audio / document, reply vào tin bot hoặc caption có `@bot` → `getFile` (≤ 20 MB, giới hạn Bot API)
→ lưu `<project>/.orrery/telegram/<giờ>-<tên>` (thêm `.orrery/` vào `.git/info/exclude` nếu là repo) → gửi prompt
"Chủ nhân gửi <loại> qua Telegram: <đường dẫn>" + caption. Không chuyển giọng nói thành chữ (không gọi LLM / dịch vụ ngoài).

## 8. Giờ yên lặng Telegram

Settings: bật/tắt + từ / đến (mặc định 23:00–07:00, qua nửa đêm được). Trong giờ yên lặng chỉ gửi cảnh báo (#6) và
trả lời lệnh chủ nhân gửi; bỏ xong việc / chờ / xin quyền / tổng kết ngày.

## Kiểm thử

Vitest desktop: callback chỉ owner, map khoá, quiet hours qua nửa đêm, tổng kết, cảnh báo, run failed 1 lần, tải file
(Bot API giả), diff bỏ file bí mật. Web: `typeKeys` chỉ khi đúng trạng thái. Docs §11an cập nhật.
