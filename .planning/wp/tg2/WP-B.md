## WP-B: menu lệnh "/" + lệnh tail
- Mục tiêu:
  1. Khi bật Nhận lệnh (và khi token đổi), gọi Bot API `setMyCommands` một lần (scope `all_group_chats`, `language_code` theo locale app + mặc định en) với các lệnh hiện có của `inbound.ts` `commandOf` (status, new, stop, last, tail, resume, run, all, screen, help). Lỗi thì bỏ qua im lặng (không chặn nhận lệnh). Không gọi lại nếu danh sách không đổi (nhớ hash trong `telegram.json`).
     Lưu ý: trong group, Telegram gửi `/status@bot_name` — `commandOf` phải hiểu dạng này như mention (kiểm có sẵn chưa; thiếu thì thêm + test).
  2. Lệnh mới `tail` (`@bot tail` hoặc `/tail`, tuỳ chọn số dòng `tail 50`, mặc định 30, tối đa 80): trả các dòng cuối của terminal session (chọn session như `last`: reply / topic session / 1 pane / nút chọn `pickMarkup`). Text plain từ buffer xterm (không ANSI), che bí mật bằng masker/`maskSecrets`, bọc `<pre>`, cắt ≤ 3500 ký tự (giữ phần cuối). Không tốn token, không gửi gì vào pane.
     Nguồn dữ liệu: trang (renderer) giữ xterm buffer → thêm action inbound mới `tail` vào contract `TelegramInbound` / `TelegramInboundResult` (`packages/shared/src/telegram.ts`, `parseInbound` / `parseInboundResult`), xử lý ở `apps/web/src/composables/useTelegramInbound.ts` (tìm cách đọc buffer từ TermPane/xterm đã có — grep `buffer.active` / `serialize` trong `apps/web/src`). Nếu PTY host đã giữ scrollback ở main thì dùng main thay vì trang — chọn đường ít code hơn, ghi lý do.
  3. Help (`inbound.ts` TEXT help) thêm dòng `tail`.
- Phạm vi file: `apps/desktop/src/telegram/*.ts`, `packages/shared/src/telegram.ts`, `apps/web/src/composables/useTelegramInbound.ts`, file web nhỏ cần để đọc buffer terminal (ghi rõ), `apps/desktop/test/telegram-*.test.ts`, test web tương ứng. Cấm đụng TelegramSettings.vue.
- Skill: `.code_index/_meta.md` (2026-11-05), docs §11an-c/e.
- Tiêu chí nghiệm thu:
  - [ ] Test: bật receiving → `setMyCommands` gọi 1 lần với đủ lệnh; bật lại không gọi lại; lỗi API không làm hỏng state.
  - [ ] Test: `/status@orrery_bot` trong group được hiểu là `status`.
  - [ ] Test: `tail` 1 pane → `<pre>` có dòng cuối, secret (vd `sk-ant-…`, token bot) bị che; nhiều pane → nút chọn; `tail 500` → 80 dòng.
  - [ ] Test web: handler `tail` trả đúng dòng cuối từ buffer giả.
  - [ ] typecheck sạch; test desktop telegram + web pass.
- Nhìn thấy được: không (chỉ Telegram) — main QA trên bản dev.
- Báo cáo: `.planning/wp/tg2/WP-B-report.md`
