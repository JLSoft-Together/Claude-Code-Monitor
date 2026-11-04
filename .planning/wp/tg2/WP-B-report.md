## WP-B — DONE
**Đã đổi**
- packages/shared/src/telegram.ts: action `tail` (TelegramInbound + Result), `TELEGRAM_TAIL_DEFAULT/MAX`, `parseInbound` kẹp lines 1..80, `parseInboundResult` bỏ ký tự điều khiển, cắt 20k.
- apps/desktop/src/telegram/inbound.ts: Command `tail`, `commandOf`, help en/vi, `COMMAND_MENU`, `tailHtml` (mask -> cắt giữ phần cuối ≤3500 -> escape -> `<pre>`, thêm mask token bot).
- apps/desktop/src/telegram/notifier.ts: `syncCommands` (setMyCommands scope all_group_chats, default en + `vi` nếu app vi; `commandsHash` trong telegram.json, reset khi đổi token, lỗi im lặng), nhánh `tail` (reply/topic/1 pane/nút `tl`), callback `tl`, `tailText`, `SESSION_BOUND` thêm tail.
- apps/desktop/src/telegram/actions.ts: ActionKind `tl` (📜), ACTION_RE, LABELS, text pick 'tail'.
- apps/web/src/composables/useTelegramInbound.ts: handler `tail` đọc buffer; apps/web/src/lib/paneSnapshots.ts: `hasSnapshot` + sửa comment đầu file.
- Test: apps/desktop/test/telegram-tail.test.ts (mới), apps/web/src/composables/telegramTail.test.ts (mới); telegram-actions/inbound.test.ts: fetch mock bỏ qua `setMyCommands` (vì `sent[last]` bị chen).
**Lý do nguồn dữ liệu**: dùng `registerSnapshot` có sẵn của TermPane (xterm buffer, plain text) — PTY host main không giữ scrollback dạng text, nên ít code nhất. Text đi IPC chỉ khi owner gõ tail, main mask.
**Tiêu chí 5/5**: setMyCommands 1 lần/bật lại không gọi/lỗi API không hỏng state; `/status@orrery_bot` (commandOf đã hiểu sẵn, thêm test); tail 1 pane `<pre>` + mask sk-ant & token bot, nhiều pane -> nút, `tail 500` -> 80; test web handler; typecheck + test pass.
**Audit**: diff chỉ trong phạm vi; không đụng TelegramSettings.vue.
**Review**: pane không có buffer/đóng -> `gone`; 0/âm/chữ -> 30/1/send thường (`tail the log` vẫn gửi vào agent); text rỗng -> "màn hình trống"; HTML trong output bị escape, không vỡ `&amp;` khi cắt; secret mask trước khi cắt.
**Test**: `npm test -w @ccm/desktop -- test/telegram` -> 85 pass/0 fail; `npm test -w @ccm/web` -> 1697 pass/0 fail; `npm run typecheck` sạch.
**Hot file cần thêm**: không. Lưu ý: `/status` trần (không `@bot`) trong group vẫn bị bỏ qua (commandOf cần mention/reply) — Telegram menu chèn `@bot` khi nhiều bot; chưa đổi để tránh bắt nhầm lệnh bot khác.
**Ngoài phạm vi**: chưa cập nhật `.code_index/_meta.md` và docs §11an (nên để main làm); chưa QA thật trên Telegram.
**Commit đề xuất**: ✨ Telegram: "/" command menu via setMyCommands and a `tail` command that sends the last masked terminal lines of a session
