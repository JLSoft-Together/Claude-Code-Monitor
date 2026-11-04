<!-- 3.2.0 (v82–v85 Telegram bot + 2026-11-05 follow-ups), release 2026-11-05. -->
# English

## Telegram (Settings › Telegram, off by default)
- Your own bot in a Telegram group with topics: each project, or a single session, reports to its topic when work is done, when it waits for you, asks for a permission or asks a question. Optional pinned status per topic, end-of-day summary and a digest that edits one "done" message per session a day.
- Command your sessions from the phone: `status`, `new`, `stop`, `last`, `tail` (last terminal lines, masked), `resume`, `run`, `all`, `screen`, with the "/" command menu. Buttons allow / deny a tool, approve a plan, answer Claude's AskUserQuestion, continue, run tests, show the diff and pick a session.
- Photos, files and albums you send are saved into the project and handed to the session. Agents send files back with the `telegram_send` tool, up to 2 GB when Large files is on (your `api_id` / `api_hash`, sealed in the OS keychain).
- Connect a topic to a session or a whole project from the right-click menu of the rail or the tab bar, or with the buttons the bot offers in a topic that is not connected yet. Replying to a bot message reaches that session, even after a restart or a resume.
- Only the paired account commands the bot. You can add members with view or full access (tool approval, topic links and pairing stay yours); others get a fixed reply you can edit. Commands sent while Orrery was off are listed with Run all / Skip instead of running on their own. Two apps polling the same bot are detected and one stops with a Retry button.
- Everything that leaves the machine is masked (tokens, home path, env). Nothing calls an LLM: the bot only types what you send.

## Settings
- The Settings window opens larger and can be resized from its corner; the size is remembered.

## Internal
- The MTProto client (GramJS) ships as its own bundle and loads only for large files, so the main process bundle is half the size.

# Tiếng Việt

## Telegram (Cài đặt › Telegram, mặc định tắt)
- Bot riêng của bạn trong group Telegram có topic: mỗi dự án, hoặc riêng một session, báo vào topic của nó khi xong việc, khi chờ bạn, xin quyền hoặc hỏi. Tuỳ chọn tin ghim trạng thái theo topic, tổng kết cuối ngày và gom báo xong (mỗi session một tin trong ngày, sửa dần).
- Ra lệnh từ điện thoại: `status`, `new`, `stop`, `last`, `tail` (dòng cuối terminal, đã che bí mật), `resume`, `run`, `all`, `screen`, có menu lệnh "/". Nút cho phép / từ chối tool, duyệt plan, trả lời câu hỏi AskUserQuestion của Claude, tiếp tục, chạy test, xem diff và chọn session.
- Ảnh, file, album bạn gửi được lưu vào dự án và chuyển cho session. Agent gửi file về bằng tool `telegram_send`, tới 2 GB khi bật File lớn (`api_id` / `api_hash` của bạn, cất trong keychain).
- Nối topic với một session hoặc cả dự án từ menu chuột phải ở rail hoặc thanh tab, hoặc bằng nút bot đưa ra trong topic chưa nối. Reply tin của bot là vào đúng session đó, kể cả sau khi khởi động lại hay resume.
- Chỉ tài khoản đã ghép ra lệnh được. Có thể thêm thành viên quyền xem hoặc đầy đủ (duyệt tool, nối topic, ghép bot vẫn chỉ bạn); người khác nhận câu trả lời cố định, sửa được. Lệnh gửi lúc Orrery tắt được liệt kê với Chạy hết / Bỏ qua, không tự chạy. Hai app cùng nhận lệnh một bot thì một bên dừng, có nút Thử lại.
- Mọi thứ rời máy đều che bí mật (token, đường dẫn home, env). Không gọi LLM: bot chỉ gõ đúng những gì bạn gửi.

## Cài đặt
- Cửa sổ Cài đặt mở to hơn, kéo giãn ở góc, nhớ kích thước.

## Nội bộ
- Client MTProto (GramJS) đóng gói riêng, chỉ nạp khi gửi file lớn, bundle main nhỏ còn một nửa.
