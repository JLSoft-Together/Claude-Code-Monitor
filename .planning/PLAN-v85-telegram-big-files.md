# PLAN v85 — Telegram: gửi file lớn (tới 2 GB) qua MTProto

Ngày: 2026-11-05 · Nối v82–v84 · Chủ nhân chốt: "có nút bật trong Settings là xong", chọn GramJS trong app.

## Vì sao

Bot API cloud chỉ cho bot upload ≤ 50 MB/file. APK/AAB release của chủ nhân thường < 500 MB. Mọi đường > 50 MB đều
cần `api_id` + `api_hash` (my.telegram.org) — Telegram bắt buộc, không né được. Máy không có Docker/WSL nên không chạy
Local Bot API Server; chọn MTProto trong main process (npm `telegram` = GramJS) đăng nhập bằng chính token bot.

- GramJS `telegram@2.26.22` ghim cứng: đã archived nhưng ổn định, nhiều người dùng. Fork `teleproto` một người duy trì,
  release liên tục → rủi ro chuỗi cung ứng cao hơn trong app giữ token bot. Đổi sang fork khi GramJS hỏng với layer mới.
- Bot qua MTProto upload được tới 2000 MB, gửi vào group bằng `InputPeerChannel(id, accessHash 0)` (bot được dùng hash 0),
  vào topic bằng `topMsgId`.

## Phạm vi

1. Settings → Telegram: mục "File lớn (tới 2 GB)": công tắc + `api_id` + `api_hash` (dán 1 lần, `api_hash` sealed
   safeStorage như token, không gửi lại trang), hướng dẫn 3 bước + link my.telegram.org. Xoá được.
2. `telegram_send` với file > 50 MB: công tắc bật + đủ khoá + ≤ 2000 MB → gửi ngay tin "⏫ đang gửi <file> (N MB)", trả
   MCP `ok` + `uploading` (không chờ upload — tránh timeout 200 s của MCP), upload nền; lỗi → tin báo lỗi kèm đường dẫn.
   Tắt / thiếu khoá / > 2000 MB → như cũ (chỉ báo đường dẫn).
3. Session MTProto (StringSession) sealed trong `telegram.json`, dùng lại → không đăng nhập bot mỗi lần (flood limit).
   Đổi token / khoá → xoá session. Client mở khi cần, đóng sau 2 phút rảnh.
4. Một upload mỗi lúc (hàng đợi); `workers` 4.

## Không làm

Nhận file > 20 MB từ Telegram (chiều vào), run.log / diff qua MTProto (đều nhỏ).

## Kiểm thử

Vitest desktop: patch hợp lệ / sai, file lớn → `uploading` + gọi uploader giả đúng chat/topic/caption, lỗi uploader → tin lỗi,
tắt → link như cũ. QA thật: APK > 50 MB vào topic #63.
