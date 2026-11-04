# QA Telegram v82–v84 + review fixes — 2026-11-04

Bản dev (build từ `master` sau WP-3a/3b), Windows 11, chạy song song bản cài: `--user-data-dir` + `CCM_DATA_DIR` tạm,
cổng 4319, CDP 9333. Bot `@PoorDog_JinVu_Bot`, group "Test Bot group" (forum), topic "Orrery" (#8) → project
`D:\work\web\claude-code-monitor`. Claude Code 2.1.289. Chủ nhân nhắn lệnh từ Telegram Desktop, main kiểm phía Orrery qua CDP.

| # | Mục | Kết quả | Bằng chứng |
|---|-----|---------|-----------|
| 1 | Lưu token (Settings), `getMe` ra tên bot | ĐẠT | state `configured`, `bot` |
| 2 | Quét group / topic | ĐẠT sau khi tag bot (tin thường không tới bot khi privacy on — đúng như docs) | discover: forum, bot admin, can_manage_topics, topic Orrery |
| 3 | Gán topic + gửi thử | ĐẠT | chủ nhân thấy tin thử |
| 4 | Ghép tài khoản bằng mã | ĐẠT (lần 1 mã hết hạn 5 phút trước khi gửi — đúng thiết kế) | owner = Doan Vũ |
| 5 | Chip "Đang nhận lệnh" + "Tele bật" trên thanh trên | ĐẠT | `03-new-pane.png` |
| 6 | `@bot status` (chưa có pane / có pane) | ĐẠT | chủ nhân xác nhận câu trả lời |
| 7 | `@bot new` mở pane Claude đúng project | ĐẠT | `03-new-pane.png` |
| 8 | Gửi prompt → prefill + submit, tin "đã xong" có 3 nút | ĐẠT | `04-prompt-sent.png` |
| 9 | `@bot last` | ĐẠT | chủ nhân xác nhận "ok" |
| 10 | Nút 📄 Xem diff (repo sạch) | ĐẠT | chủ nhân xác nhận |
| 11 | Ảnh + caption `@bot` → lưu `.orrery/telegram/`, đường dẫn vào session, `.orrery/` không hiện trong `git status` | ĐẠT | `05-stop-photo.png` (không commit: có mô tả ảnh cá nhân) |
| 12 | `@bot screen` khi không có máy Android | ĐẠT (trả lời không có máy) | chủ nhân xác nhận |
| 13 | Tin ghim trạng thái | ĐẠT | chủ nhân thấy tin ghim |
| 14 | ✅ Cho phép → phím `1` duyệt đúng hộp xin quyền Write | ĐẠT | `07-permission.png` (Wrote …qa-perm.txt) |
| 15 | ❌ Từ chối → Esc | ĐẠT | `07-permission.png` (User rejected write) |
| 16 | `@bot stop` + nút ⏹ | CHƯA CHẮC — agent xong (2 s) trước khi bấm; chờ chủ nhân cho biết câu bot trả lời | `05-stop-photo.png` |
| 17 | Tin "đã xong" của session ngoài Orrery (session main chạy trong bản cài) | ĐẠT theo thiết kế: session luôn `working` khi có agent nền → không có episode | activity store |

Chưa test trên app (đã có unit test): giờ yên lặng, tổng kết ngày, cảnh báo hạn mức / ổ đầy / build lỗi + `run.log`,
`@bot run`, `@bot resume`, `@bot all`, gửi file > 20 MB, nhóm topic con, MCP `telegram_send` / `telegram_receive` (confirm).
