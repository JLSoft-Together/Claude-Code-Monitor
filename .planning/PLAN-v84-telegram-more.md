# PLAN v84 — Telegram: mở / resume session, chạy app, tin ghim trạng thái, gửi nhiều session, câu trả lời cuối, log build lỗi, sức khoẻ bot

Ngày: 2026-11-04 · Nối tiếp v82 / v83 · Chủ nhân duyệt cả 8 mục. Tất cả chỉ khi đang nhận lệnh và chỉ tài khoản đã ghép
(trừ #4, #7, #8 là chiều gửi đi).

1. **`@bot new <prompt>`** — trang mở pane Claude mới ở thư mục project của topic (`workspace.open('claude', project)`),
   `prefill` + `prefillSubmit` = prompt (gửi khi agent sẵn sàng). Không prompt → chỉ mở pane.
2. **`@bot resume`** — trang liệt kê session Claude đã kết thúc của project (terminals có `endedAt` + `claudeSessionId`,
   chưa mở lại trong pane; tối đa 8, mới nhất trước) → bot gửi nút từng session → bấm → `workspace.open('claude', cwd, id)`
   (`claude --resume`).
3. **`@bot run [tên config]`** — main lấy Run config của project (`RunManager.configs`), bỏ config cần trust (file chia
   sẻ / import: hộp xác nhận chỉ có trên máy), khớp tên (không tên + 1 config → nó; nhiều → nút chọn). Thiết bị: config ghim
   sẵn hoặc máy ready đầu tiên. Khi session sang `running` → chờ 8 s → chụp màn hình máy → gửi ảnh; `failed` → #7.
4. **Tin ghim trạng thái** — Settings bật/tắt (mặc định tắt). Mỗi route 1 tin (`sendMessage` + `pinChatMessage`, cần quyền
   ghim; không có thì để không ghim), `tick` mỗi phút hỏi trang `status` rồi `editMessageText` khi nội dung đổi: từng pane
   — trạng thái, tool đang chạy, bao lâu. `message_id` lưu trong `telegram.json`; tin bị xoá → tạo lại.
5. **`@bot all <nội dung>`** — gửi vào mọi pane agent đang chạy của project không có prefill chờ; trả lời danh sách đã gửi.
6. **`@bot last`** — câu trả lời cuối của session (reply vào tin báo / pane duy nhất). Main giữ `reply` từ episode xong việc
   gần nhất mỗi terminal (bộ nhớ, ≤ 3000) kể cả khi `includeReply` tắt; luôn qua `maskSecrets`.
7. **Log khi build lỗi** — main giữ 200 dòng log cuối mỗi run session (đã mask bởi RunManager); tin build lỗi kèm `run.log`.
8. **Sức khoẻ bot** — state `health {lastSentAt, lastReceivedAt, lastPollAt, errorsToday, sentToday}`; Settings hiện.

Kiểm thử: Vitest desktop cho từng lệnh với Bot API giả + trang giả; web `workspace` new / all / resume list.
