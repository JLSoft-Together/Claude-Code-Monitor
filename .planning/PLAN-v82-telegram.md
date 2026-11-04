# PLAN v82 — Telegram: báo kết quả session vào topic theo project

Ngày: 2026-11-04 · Nguồn: `C:\Users\dauph\docs\telegram-bot-claude-code.md`

## Mục tiêu

Chủ nhân không ngồi máy → session Orrery xong việc thì bot báo vào đúng topic của project trong
group Telegram (forum topics), kèm tóm tắt kết quả và file (apk, log) nếu agent gửi.

## Chủ nhân đã chốt (2026-11-04)

| Điểm | Chốt |
|------|------|
| Nội dung | **Cả hai**: agent gọi `notify_owner` → gửi tóm tắt của agent; không gọi → gửi câu trả lời cuối trong transcript (tuỳ chọn, mặc định tắt, qua `maskSecrets`) |
| Khi gửi | Chỉ khi bật bằng slash command `/bot-tele-send-notify on` (`off` để tắt); không phụ thuộc máy rảnh |
| Phạm vi bật | **Toàn app**: gõ ở session nào cũng bật/tắt cho mọi session; có nút cùng trạng thái trên thanh trên |
| Project chưa gán topic | **Bỏ qua** |
| Đợt 1 | Tin nhắn + gửi file |
| Chiều nhận lệnh (Tele → session) | Giai đoạn 2 (mục "Giai đoạn 2" bên dưới): tag `@bot` trong topic → gửi tin vào session tương ứng. Chủ nhân duyệt 2026-11-04, ngoại lệ thứ 3 của "không gửi prompt" |
| Config bot | Trong Settings: chủ nhân chỉ nhập token; Orrery quét group / topic, kiểm bot admin, tạo topic mới cho project |

## Liệt kê topic (đã kiểm Bot API)

- Bot API **không có** method liệt kê forum topic (`getForumTopics` chỉ có ở MTProto, cần login tài khoản user → không dùng).
- Thay thế: `getUpdates` (chỉ khi chủ nhân bấm Quét) → `my_chat_member` / tin nhắn cho biết group bot đã vào;
  tin trong topic có `message_thread_id` + `reply_to_message.forum_topic_created.name` → tên topic. Update chỉ giữ 24 h:
  topic chưa thấy → nhắn 1 tin vào topic rồi quét lại.
- `getChat` (title, `is_forum`), `getChatMember(chat, bot)` → admin + `can_manage_topics`.
- Bot có `can_manage_topics` → `createForumTopic(name = tên project)` → gán route luôn.
- Link mời riêng `t.me/+…` bot không resolve được → chọn group từ kết quả quét.

## Không cần cài

Bot API gọi bằng `fetch` HTTPS từ desktop main. Không Bun, không plugin Channels.

## Chủ nhân chuẩn bị

1. `@BotFather` → `/newbot` → token (nhập vào Settings Orrery, không dán vào chat).
2. Add bot vào group, cho admin.
3. Mỗi topic: Copy Message Link `t.me/c/<chat>/<thread>/<msg>` → dán vào bảng Project ↔ Topic.

## Thiết kế

### Shared (`packages/shared/src/phone.ts`, file mới `telegram.ts`)
- `PHONE_CHANNELS` thêm `telegram`? → Không: Telegram là **kênh riêng** chạy song song ntfy/Discord
  (điều kiện gửi khác: theo công tắc, không theo máy rảnh). File mới `telegram.ts`:
  `TelegramState` (enabled, configured, keychain, botName, routes[{project, label, topicTitle?}],
  lastReply, lastError), `TelegramPatch`, `parseTopicLink(link) → {chatId: '-100…', threadId}`,
  `sanitizeTelegramPatch`.
- `PhoneEpisodeMessage` thêm `project?: string` (gốc git hoặc `cwd`, collector có sẵn) và
  `reply?: string` (câu trả lời cuối, chỉ khi bật tuỳ chọn).

### Collector
- `toast.ts` `phone(...)`: đính `project` từ `TerminalSession.cwd` (gốc git nếu có).
- Sự kiện `done` cho Telegram: không áp ngưỡng `LONG_JOB_MS` cố định → ngưỡng riêng (mặc định 1 phút,
  chỉnh ở Settings) để task ngắn khi rời máy vẫn được báo.
- `reply`: lấy text assistant cuối của lượt vừa xong từ tailer transcript, chỉ khi
  `telegram.includeReply` bật; cắt 3000 ký tự.
- Gộp: nếu agent đã `notify_owner` trong lượt đó thì sự kiện `done` không gửi `reply` (tránh 2 tin).

### Desktop (`apps/desktop/src/telegram/`)
- `send.ts`: `buildMessage` (`sendMessage` với `chat_id`, `message_thread_id`, `parse_mode` HTML,
  escape), `buildDocument` (multipart `sendDocument`), cắt 4096 / caption 1024, `getMe` kiểm token.
- `notifier.ts` `TelegramNotifier`: file `telegram.json` trong userData, token + chat_id sealed
  safeStorage (dùng `TokenCrypt` như `phone/notifier.ts`), routes project → threadId;
  `handle(episode)` chỉ gửi khi `enabled` + project có route; dedupe theo `episode`; rate limit theo
  topic (≤ 20/phút/group, ≤ 60/giờ tổng); `onFailure` → toast trong app.
- `ipc.ts`: get/set/test/route add/remove; trang không bao giờ nhận lại token.
- `main.ts`: collector `onMessage` `phone` → cả `PhoneNotifier` lẫn `TelegramNotifier`.

### MCP `orrery` (`apps/desktop/src/pty/mcpTools/`)
- `notify_owner` giữ nguyên (200 ký tự, Inbox / toast / phone).
- `telegramNotify.ts` tool `telegram_notify {state: on|off|status}` (desk call) → bật/tắt toàn app, trả trạng
  thái + danh sách project đã gán.
- `telegramSend.ts` tool `telegram_send {text ≤ 3000, file?}` (desk call): tóm tắt kết quả + file vào topic của project
  pane; file phải nằm trong project của pane, ≤ 50 MB (lớn hơn → gửi đường dẫn + dung lượng), chặn tên file bí mật
  (`SECRET_FILE_GLOBS`), chỉ khi Telegram bật; rate limit theo pane. Gửi trong lúc làm việc → sự kiện xong việc của
  lượt đó không gửi thêm (tránh 2 tin).

### Slash command
- `~/.claude/commands/bot-tele-send-notify.md`: nhận `$ARGUMENTS` on|off|status → gọi
  `mcp__orrery__telegram_notify`. Orrery cài file này từ Settings → Telegram (nút "Cài lệnh", confirm
  native), giống cách v81 sync rule.
- Rule đề xuất cho CLAUDE.md (chủ nhân tự thêm hoặc nút "Thêm rule"): "Telegram đang bật → xong task
  gọi `notify_owner` tóm tắt kết quả; có file build thì `send_file`".

### Web
- Settings → Thông báo → mục **Telegram**: token (write-only), nút Thử (`getMe` + gửi thử vào topic
  đầu), công tắc "Gửi câu trả lời cuối", ngưỡng xong việc, bảng Project ↔ Topic (dropdown project đã
  thấy trong Monitor/Workspace + ô dán link topic, nút Thử từng dòng).
- Thanh trên: nút trạng thái Telegram (bật/tắt, icon + text), đồng bộ với slash command.
- i18n `en` / `vi`, theme tokens, motion khi bật/tắt (rule ui-motion).

### Docs / index
- `docs/claude-code-integration.md` §11an: luồng, secret, giới hạn Bot API, ngoại lệ nội dung
  (`reply` ra ngoài chỉ khi chủ nhân bật).
- `.code_index/` desktop / collector / protocol / web / features / `_meta`.

## Hard rule cần giữ

- Không gửi prompt vào session (chỉ đọc + gửi ra Telegram).
- Nội dung ra ngoài: tên project, trạng thái, thời gian, tóm tắt agent tự viết; `reply` chỉ khi bật,
  luôn qua `maskSecrets`. Không token / path home / env.
- Token không log, không về trang.

## Kiểm thử

- Vitest: `parseTopicLink`, `sanitizeTelegramPatch`, `buildMessage` (escape HTML, cắt 4096),
  `TelegramNotifier` (route / bỏ qua / dedupe / rate / off), `send_file` (path ngoài project, > 50MB,
  file nhạy cảm), collector đính `project` + `reply`.
- E2E `apps/desktop/e2e/v82-telegram.cjs` với Bot API giả (override URL như `phone` `override`).
- Chủ nhân test thật: gửi thử vào topic A, chạy 1 session project A → tin vào A, project C chưa gán
  → không có tin.

## Giai đoạn 2 — chat từ Telegram vào session (`@bot …`) — đã code 2026-11-04 (lệnh nhanh `stop` chưa làm)

Luồng: chủ nhân nhắn `@bot <nội dung>` trong topic A (hoặc reply vào tin báo của bot) → Orrery gửi nội dung vào session
của project A.

- **Cờ bật (chủ nhân chốt 2026-11-04)**: mặc định TẮT. Chỉ bật bằng slash command riêng `/bot-tele-receive on|off|status`
  (MCP `telegram_receive`, file `~/.claude/commands/bot-tele-receive.md` cài từ Settings như lệnh gửi), hoặc công tắc
  trong Settings. Tách khỏi `/bot-tele-send-notify`. Khởi động lại app → cờ về tắt (an toàn). Đang bật thì
  thanh trên hiện badge "Đang nhận lệnh Telegram".
- **Chỉ chủ nhân gửi được (chống spam)**: allowlist Telegram user id; chưa ghép ai → không nhận lệnh nào. Tin từ người
  khác: bỏ qua im lặng (không trả lời, không ghi Inbox từng tin), chỉ đếm số lần trong Settings.
- **Nhận update**: desktop main long-poll `getUpdates` (timeout 50 s) chỉ khi Telegram bật + cờ nhận lệnh bật. Là consumer duy nhất của bot: Quét group dùng cache của poller khi đang poll. Không dùng chung bot với plugin
  Channels (Telegram chỉ cho 1 consumer).
- **Lọc**: chỉ chat có route; tin có entity `mention` = `@<bot>` hoặc reply vào tin của bot; bỏ tin của bot khác.
- **Ghép tài khoản chủ nhân**: Settings bấm "Ghép" → hiện mã 6 số (hết hạn 5 phút) → chủ nhân nhắn `@bot pair <mã>`
  trong group (hoặc DM bot) → lưu `from.id` + tên. Bỏ ghép trong Settings.
- **Chọn session**:
  1. Reply vào tin báo của bot → đúng session đã báo (main lưu `message_id → terminalId / paneKey`, 500 tin gần nhất).
  2. Tag bot thường → pane Workspace của project đó: pane đang chờ chủ nhân trước, rồi pane idle mới nhất. Nhiều
     session cùng project → bot trả lời danh sách ngắn, chủ nhân reply chọn.
  3. Không có pane Workspace (session chạy ở terminal ngoài Orrery) → bot báo "không gửi được, session không mở trong
     Orrery". Orrery chỉ ghi được vào PTY của chính nó.
- **Gửi vào pane**: dùng đường PTY host như hàng đợi prompt v70 (`lib/promptQueue.ts`): pane idle / đang chờ →
  gõ + Enter; đang làm → xếp hàng, gửi khi chuyển idle; bot trả lời "đã gửi" / "đã xếp hàng". Câu trả lời của agent sau
  lượt đó đi về topic theo luồng báo xong việc (tôn trọng includeReply).
- **Lệnh nhanh**: `@bot status` (danh sách session project + trạng thái), `@bot stop` (Esc vào pane, confirm bằng
  reply "yes"), `@bot pair <mã>`.
- **An toàn**: cắt 2000 ký tự, bỏ ký tự điều khiển / ESC sequence; rate limit 10 lệnh / phút / topic; Inbox của Orrery
  ghi mỗi lệnh nhận từ Telegram (ai, topic, pane); một công tắc tắt toàn bộ chiều nhận; docs §11an ghi ngoại lệ.
- **Kiểm thử**: Bot API giả trả `getUpdates`; unit lọc mention / allowlist / chọn pane / làm sạch text; E2E gửi vào pane
  idle và pane đang chạy (xếp hàng).

## Thứ tự

1. Shared types + parse link → 2. Desktop notifier + IPC → 3. Collector `project` / `reply` →
4. MCP `telegram_notify` + `notify_owner` nới → 5. `send_file` → 6. Settings UI + nút thanh trên →
7. Slash command + nút cài → 8. Docs + index + E2E.
