<!-- 3.3.0 (Telegram topic map, links that follow the session's life, topic icons), release 2026-11-05. -->
# English

## Telegram
- A session's topic link now ends with the session: when Claude quits, the pane closes or `/clear` starts a new session id, the topic is freed and gets one silent note with ↩️ Resume and 🔗 buttons to connect another session. 📌 Keep holds a link through the end of a session and follows `/clear` and resume.
- A session that ended while Orrery was off is freed a few minutes after start, once restored panes had time to come back.
- New Topics tab with a Topic map: one block per topic with its project and sessions, open / closed state, move to another topic, keep, test into that topic, show the pane, disconnect, and "Disconnect n closed sessions". Filter by name and by Not delivering / Open / Closed; row buttons show on hover.
- A topic the bot can no longer post to (deleted, or rights lost) is marked "Not delivering" until the next good send.
- `where` in a topic tells what it is connected to, with a ✂️ Disconnect button.
- Optional: each topic icon follows its sessions — ⚡ working, ❓ waiting for you, ✔ idle (needs the Manage topics right).
- Setup strip at the top of Settings › Telegram (Bot · Group · Topics · Paired · Receiving); each step opens its tab. The ✈ mark on a tab or rail row opens its Telegram link.
- Fixes: one session per topic, a link follows a renamed pane, and a pane whose agent quit no longer hides its session from `resume`.

# Tiếng Việt

## Telegram
- Link topic của session giờ kết thúc cùng session: Claude thoát, đóng pane hay `/clear` sang session id mới thì topic tự được ngắt, kèm một tin không chuông có nút ↩️ Resume và 🔗 nối session khác. 📌 Giữ để link ở lại sau khi session kết thúc và đi theo `/clear`, resume.
- Session đã chết lúc Orrery tắt được ngắt vài phút sau khi mở app, sau khi các pane khôi phục kịp chạy lại.
- Tab Topic mới với Bản đồ topic: mỗi topic một khối gồm project và các session, trạng thái mở / đóng, chuyển sang topic khác, giữ, gửi thử vào đúng topic, mở pane, ngắt, và "Ngắt n session đã đóng". Lọc theo tên và theo Lỗi gửi / Đang mở / Đã đóng; nút trên dòng hiện khi rê chuột.
- Topic mà bot không gửi được nữa (bị xoá, mất quyền) được đánh dấu "Không gửi được" tới lần gửi thành công sau.
- Lệnh `where` trong topic cho biết topic đang nối với gì, kèm nút ✂️ Ngắt.
- Tuỳ chọn: icon mỗi topic đổi theo session — ⚡ đang làm, ❓ chờ bạn, ✔ rảnh (bot cần quyền Quản lý topic).
- Dải bước đầu trang Cài đặt › Telegram (Bot · Group · Topic · Đã ghép · Nhận lệnh), bấm bước nào mở tab đó. Dấu ✈ trên tab / dòng rail mở hộp nối Telegram.
- Sửa lỗi: mỗi topic một session, link đi theo khi đổi tên pane, pane có agent đã thoát không còn che session khỏi `resume`.
