## WP-1 verify — kiểm các fix của WP-3a (review chỉ đọc, working tree 2026-11-04)

Cách kiểm: đọc lại code hiện tại (git diff + file chưa track). Không chạy build. Không chạy lại test, chỉ tin số test WP-3a đã báo.

| # | Kết quả | Bằng chứng (file:line) | Ghi chú |
|---|---|---|---|
| 1 Cho phép gắn đúng lần xin quyền | FIXED, còn rủi ro PLAUSIBLE | notifier.ts:1059-1062 (entry mang `since`/`tool`, nút ap/dn chỉ gắn khi có `since`), notifier.ts:650-651 (gửi since/tool), useTelegramInbound.ts:23-29 `keysReady`, :77-80 | Còn rủi ro: `since` = `statusUpdatedAt` trong registry của Claude Code (tracker.ts:604). Nếu hai lần xin quyền liền nhau (vd 2 lệnh Bash trong cùng một message) mà status không rời `waiting` và Claude Code không cập nhật `statusUpdatedAt`, thì `since` vẫn khớp. `tool` chỉ so tên tool (`Bash` = `Bash`), nên vẫn có thể duyệt nhầm lệnh thứ hai. Chưa kiểm được trên CLI thật. Nên thử tay 1 lần: 2 lệnh Bash cần duyệt trong 1 lượt, xem `statusSince` có đổi không. Cách mạnh hơn: so thêm id của tool_use đang chờ. |
| typeKeys chỉ báo ok sau khi ghi thật | FIXED | TermPane.vue:988-996 (chỉ xoá `typeKeys` sau `conn.write`), workspace.ts:864-885 `telegramTyped`, useTelegramInbound.ts:80 | Hết hạn 1,5 s thì xoá phím, không ghi trễ. Đã tính PTY mở lại hoặc pane bị unmount: trả `unavailable`, không báo ok sai. Timeout 5 s của `askPageTelegram` lớn hơn 1,5 s nên ổn. |
| 2 reply cũ / prompt xoá reply | FIXED | transcript.ts:197 (signal `prompt`: user không phải tool_result, không isMeta), :344-352 | `lastReply` chỉ lấy text của đúng message end_turn. Tác dụng phụ chấp nhận được: bản ghi user không meta giữa phiên (lệnh slash, compact summary) cũng xoá reply. |
| 3 Caption build lỗi | FIXED | notifier.ts:826-834 + api.ts `quote()` | Cắt detail trước khi escape / bọc tag; caption ≤ 1024, text ≤ 4096; mask qua `clean` trong `quote`. |
| 4 `.orrery/` không neo | FIXED | host.ts:42-46 | Repo cũ đã có dòng `/.orrery/` sẽ được thêm dòng `.orrery/` (trùng nhưng vô hại). |
| 5 Diff nhiều file | FIXED | host.ts:9, 26, 30 (pathspec `.` + `:(exclude,glob,icase)**/<glob>`) | `**/` khớp cả gốc repo. Dòng lệnh giờ có độ dài cố định. |
| 6 Tổng kết sau restart | FIXED | notifier.ts:848-854 (`summaryDay` lưu trong file, mở app sau giờ gửi mà chưa có số đếm thì bỏ qua) | Mở app sau giờ gửi mà đã có hoạt động thì vẫn gửi bản số đếm thiếu. Chấp nhận được. |
| 7 Đổi token → vòng poll mới | FIXED | notifier.ts:337 + :354, :446 | Vòng cũ dừng ở lần kiểm `pollRun !== run` kế tiếp. Request cũ dùng token cũ nên không gây 409. |
| 8 `$'` trong replace | FIXED | notifier.ts:532 (hàm thay thế) | |
| 9 pins {chatId,messageId} | FIXED | notifier.ts:124-137 (đọc được dạng cũ), :792-806, :899, :908, :913-921 (`dropPin` + `unpinChatMessage`) | |
| 10 Giới hạn thử mã ghép | FIXED, có regression nhỏ | notifier.ts:465-471 | **[low] REGRESSION:** đếm sai chung cho mọi người gửi, không theo `fromId`. Người lạ biết username bot chỉ cần gửi 5 mã sai (`@bot pair 000000`) trong lúc chủ nhân đang ghép là mã bị huỷ, chủ nhân phải bấm Ghép lại (DoS lúc ghép, không chiếm được quyền). Sửa: đếm theo `fromId`, hoặc huỷ theo tổng nhưng chỉ đếm người lạ sau N lần. |
| 11 Spam người lạ | FIXED | notifier.ts:596-601 (broadcast ≤ 1/s), :615-618 (trả lời "không có quyền" ≤ 5/phút) | |
| 13 Entity trong popup | FIXED | notifier.ts:603-605 | Thứ tự unescape đúng (`&amp;` thay cuối cùng). |
| 14 resume busy | FIXED, có regression nhỏ | inbound.ts:179 (`busy` không có panes → `t.open`) | **[low] REGRESSION:** `telegramKeys` trả `busy` (phím trước còn chờ, workspace.ts:859) và cũng không có panes → popup callback hiện "Session đó đang mở rồi", sai nghĩa. `all` đã xử lý riêng (notifier.ts:515). Sửa: trang trả `busy` kèm `panes: [info(pane)]` cho keys, hoặc thêm mã lỗi riêng. |
| Nested topics | FIXED | notifier.ts:582-594 `asker` gắn `nested` cho mọi request (pinTick, stop, callback); web `owns` / `telegramOwns` (useTelegramInbound.ts:21, workspace.ts:833) | Không thấy lỗi. |
| Confirm `telegram_receive on` | FIXED | mcpDesk.ts:115-131; main.ts:868-873 (nút mặc định / huỷ = Huỷ); host.ts:492 `deskReplyMs` = 600 s cho `telegram_receive` | Kiểm lại owner sau khi hỏi; `confirm-open` dùng chung khoá với free_port; `off` / `status` không hỏi. |

### Tổng

- 13/13 mục đã sửa đều FIXED.
- 2 regression low: #10 (người lạ có thể huỷ mã ghép) và #14 (keys `busy` hiện sai câu).
- Mục 1 còn 1 rủi ro PLAUSIBLE: hai lần xin quyền liền nhau cùng tên tool mà `statusSince` không đổi. Cần thử tay trên Claude Code 2.1.289.
- Không thấy regression nào ở typeKeys, nested, transcript, caption, pins, summaryDay, poll và confirm.
- Chưa sửa và vẫn mở (ngoài danh sách đã giao cho WP-3a): 12 (diff bỏ qua file untracked), 15 (glob bí mật của người dùng), 16 (onUpdate chặn tuần tự), 17 (album).
