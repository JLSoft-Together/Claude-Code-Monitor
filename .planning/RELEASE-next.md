# Release (số version: chủ nhân đặt) — changelog chờ

Khi bump: đổi tên file thành `RELEASE-<x>.md`, thêm mục mới đầu `apps/web/src/lib/changelog.ts` (≤ 100 ký tự/dòng), notes GitHub = phần Tiếng Việt.

## English
- Telegram: link a session or project to a topic by picking it from a list; the topic named like the project is suggested
- Telegram: session links show live state (working, waiting for you, idle, closed); new "Waiting for you" filter
- Telegram: running projects without a topic are listed with a one-click connect
- Telegram: drag projects and sessions onto a topic, a free topic or Disconnect, with Undo
- Telegram: sign in with your Telegram account to list every topic of your groups (messages still go through the bot)
- Telegram: groups and topics show at once from the last scan
- Telegram: open any topic in the Telegram app, search topics by name, connect every running project to its same-name topic at once, and move a project off a deleted topic in one click
- Agents can list sibling sessions, type a message into another one and close panes they opened (Orrery MCP: list_sessions, send_to_session, close_session)
- claude or codex typed in a Workspace shell pane now gets the Orrery tools and a session id (Settings › Editor & Terminal switch)
- Closing or reopening a session that never took a turn starts a fresh one instead of failing to resume
- Telegram: tap ✈ on a tab or rail row to open its topic in Telegram (also in the menu)
- Telegram: Esc and "last 20 lines" buttons under waiting, question and permission messages
- Telegram: new bot commands /compact, /close (owner only) and /focus; /new asks which project in General or a shared topic
- Telegram: one pinned status message per topic, a send-health line for every topic, and Telegram rate limits are waited out
- Telegram: plan-limit alerts go to the topic of the running project instead of every chat
- Telegram: photos sent from the phone are attached to the Claude pane like a pasted image, the caption is the prompt
- Compact now sends /compact and the resume line itself after the handoff (Settings › Editor & Terminal switch, on by default); typing, cancelling or waiting over 10 minutes stops it

## Tiếng Việt
- Telegram: nối session hoặc project vào topic bằng cách chọn trong danh sách, gợi ý sẵn topic trùng tên project
- Telegram: liên kết session hiện trạng thái live (đang chạy, chờ bạn, rảnh, đã đóng); thêm bộ lọc "Đang chờ bạn"
- Telegram: liệt kê project đang chạy chưa có topic, nối 1 chạm
- Telegram: kéo-thả project và session vào topic, topic trống hoặc Ngắt, có Hoàn tác
- Telegram: đăng nhập tài khoản Telegram để thấy đủ mọi topic của group (tin nhắn vẫn do bot gửi)
- Telegram: danh sách group và topic hiện ngay từ lần quét trước
- Telegram: mở topic trong app Telegram, tìm topic theo tên, nối hàng loạt project vào topic trùng tên, chuyển project khỏi topic đã xoá bằng 1 chạm
- Agent liệt kê được session cùng project, gõ sẵn tin vào session khác và đóng pane do mình mở (MCP Orrery: list_sessions, send_to_session, close_session)
- Gõ claude hoặc codex trong pane shell của Workspace giờ cũng có công cụ Orrery và session id (công tắc Cài đặt › Trình soạn thảo & Terminal)
- Đóng / mở lại session chưa có lượt chat nào sẽ chạy mới thay vì lỗi resume
- Telegram: bấm ✈ trên tab hoặc hàng rail để mở topic trong Telegram (có cả trong menu)
- Telegram: nút Esc và "20 dòng cuối" dưới tin chờ, hỏi và xin quyền
- Telegram: lệnh bot mới /compact, /close (chỉ chủ nhân) và /focus; /new hỏi chọn project ở General hoặc topic dùng chung
- Telegram: 1 tin ghim trạng thái cho mỗi topic, dòng sức khoẻ gửi tin cho từng topic, tự chờ khi Telegram giới hạn tốc độ
- Telegram: cảnh báo hạn mức gửi vào topic của project đang chạy thay vì mọi chat
- Telegram: ảnh gửi từ điện thoại được đính vào pane Claude như dán ảnh, chú thích là prompt
- Compact tự gửi /compact và dòng làm tiếp sau khi handoff xong (công tắc Cài đặt › Trình soạn thảo & Terminal, mặc định bật); gõ tay, huỷ hoặc chờ quá 10 phút thì dừng
