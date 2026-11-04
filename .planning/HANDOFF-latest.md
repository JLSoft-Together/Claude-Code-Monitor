# HANDOFF — Orrery / Telegram v82–v84 (2026-11-04 23:26)

Đọc file này là làm tiếp được. Trả lời tiếng Việt, gọi user là "chủ nhân", xưng "con".
File này thay `HANDOFF-2026-11-03-v80.md` (và nội dung tạm trong `HANDOFF-latest.md` viết lúc 23:20).
Nhật ký: `D:/work/web/claude-code-monitor/.planning/PROGRESS-2026-11-04-telegram-review.md` (cuối file là mới nhất).

## 1. Đang ở đâu

- Project `D:/work/web/claude-code-monitor` (Orrery, Electron), branch `master`, **đã push lên `origin/master`** lúc 23:30 (chủ nhân bảo, để test máy khác):
  `7c76076` contract + collector · `1491352` desktop · `c98b5f0` web UI · `2580eeb` Settings resize · `6d34d93` docs/plan · `948da72` QA.
- Working tree: chỉ còn `?? .planning/RELEASE-v2.3.0.md` (của chủ nhân, có từ trước — không đụng) và
  `?? docs/qa/telegram-2026-11-04/05-stop-photo.png` (cố ý không commit: có mô tả ảnh cá nhân).
- Kiểm tra cuối (chạy thật 2026-11-04 ~23:05): `npm run typecheck` sạch; Vitest shared 538 · collector 393 (+1 skip) ·
  desktop 1208 · web 1692 pass.
- QA thật với bot: `docs/qa/telegram-2026-11-04/RESULT.md` — 16/17 ĐẠT; #16 `@bot stop` CHƯA CHẮC.
- **Đang chạy**: không. Bản dev QA đã tắt (2026-11-04), thư mục tạm `C:/Users/dauph/AppData/Local/Temp/orrery-qa-tg` đã xoá
  (token mã hoá + owner ghép mất theo; QA lại phải dán token, quét, gán topic, ghép lại). Không còn subagent nào chạy.
- Bị chặn: không. Chờ chủ nhân trả lời (mục 3).

## 2. Phiên này đã làm

- **Pull** lên 3.1.1 (`c933adc`); cài thiếu dependency `yaml` bằng `npm install`.
- **v82 Telegram**: báo xong việc / chờ / xin quyền vào topic theo project; token sealed safeStorage; quét group + topic qua
  `getUpdates` (Bot API không có list topic); tạo topic; MCP `telegram_send` (tóm tắt + file ≤ 50 MB), `telegram_notify`;
  slash command `/bot-tele-send-notify`. Nhận lệnh `@bot …` chỉ từ tài khoản đã ghép (mã 6 số), `/bot-tele-receive`.
  Code: `packages/shared/src/telegram.ts`, `apps/desktop/src/telegram/*`, `apps/collector/src/toast.ts` `onTelegram`,
  `transcript.ts` `reply_text`/`prompt`, web `TelegramSettings.vue`, `TelegramToggle.vue`, `useTelegramInbound.ts`,
  `stores/workspace.ts` `telegram*`, `TermPane.vue` `typeKeys`.
- **v83**: nút Cho phép / Từ chối (phím `1` / Esc), Tiếp tục / Chạy test / Xem diff, `stop`, `screen`, file từ Telegram →
  `<project>/.orrery/telegram/`, cảnh báo hạn mức / ổ đầy / build lỗi, tổng kết ngày, giờ yên lặng.
- **v84**: `new`, `resume`, `run [config]`, `all`, `last`, tin ghim trạng thái, `run.log` khi build lỗi, sức khoẻ bot.
- **Settings**: cửa sổ to hơn, kéo góc đổi kích thước (`lib/dialogSize.ts`, key `ccm.settings.size`).
- **Review + sửa** (manager-work-agent): WP-1/WP-2 review → WP-3a/3b sửa → soát lại. Chi tiết `.planning/wp/tg/`.
- Docs §11an, §11an-b, §11an-c, §11an-d trong `docs/claude-code-integration.md`; CLAUDE.md thêm ngoại lệ thứ 3 (gửi prompt từ Telegram).

## 3. Việc tiếp (theo thứ tự)

1. Hỏi chủ nhân câu trả lời của bot sau khi bấm ⏹ (QA #16). Lỗi → test lại: nhắn `@PoorDog_JinVu_Bot` một việc chạy lâu có tool,
   rồi `@… stop` + bấm ⏹; kiểm pane hiện "Interrupted". Xong → cập nhật `docs/qa/telegram-2026-11-04/RESULT.md` + commit.
2. (Xong) Bản dev đã tắt, thư mục tạm đã xoá. Hook trong `~/.claude/settings.json` mà bản dev ghi đè đã trả về `C:/Users/dauph/AppData/Local/ccm/bin/hook-bridge.mjs` (backup `settings.json.bak-qa-tg`).
3. Đợt sau (đã ghi trong `.planning/wp/tg/WP-1-report.md`, `WP-2-report.md`): #12 diff gồm file untracked, #15 glob bí mật
   người dùng, #16 lệnh nặng chặn vòng poll, #17 album ảnh; cài handler nhận lệnh ngoài Workspace; `new`/`resume` không cướp focus.
4. Chưa test trên app (có unit test): giờ yên lặng, tổng kết ngày, cảnh báo + `run.log`, `run` / `resume` / `all`, confirm MCP `telegram_receive`.
5. Máy khác: `git pull` → `npm install` → `npm run desktop` (hoặc `npm run dist:win`) để test.

Chờ chủ nhân trả lời:
- (a) Kết quả nút ⏹ — mặc định: ghi "CHƯA CHẮC".
- (b) Xoá ảnh test `D:/work/web/claude-code-monitor/.orrery/telegram/20261104-232053-photo.jpg`? — mặc định: giữ (đã git-exclude).

## 4. Quyết định và ràng buộc

- **Chủ nhân đã chốt**: commit từng phần cho cả phiên, message emoji như repo, không trailer; push chỉ khi chủ nhân bảo (lần này đã bảo).
- `.planning/DECISIONS.md` 2026-11-04: MCP `telegram_receive on` phải qua confirm native; cho phép tự test bằng bản dev.
- Telegram: nhận lệnh mặc định tắt, tự tắt khi khởi động lại; chỉ tài khoản đã ghép; người lạ bị bỏ qua im lặng.
- Không build để verify (CLAUDE.md global) — chỉ build khi chủ nhân cho phép (đợt này đã cho cho QA).
- Không chạy bản dev trên cổng 4317 (bản cài của chủ nhân giữ; session này chạy trong bản cài).
- Quirk: bản dev chạy với `CCM_DATA_DIR` tạm vẫn cài hook-bridge vào `~/.claude/settings.json` toàn cục → tắt/xoá bản dev phải trả hook về bản cài.
- **Token bot đã lộ trong chat** → chủ nhân cần `/revoke` ở BotFather rồi dán token mới vào Settings.
- Quirk: `.planning/wp/WP-*.md` là brief của đợt cũ (đã track) — brief Telegram để ở `.planning/wp/tg/`. PowerShell `.Replace` không khớp
  file CRLF khi dùng `` `n `` — dùng Edit tool. Terminal xterm vẽ canvas: đọc chữ trong pane bằng ảnh chụp, không bằng DOM.

## 5. File cần đọc lại

1. `.planning/PROGRESS-2026-11-04-telegram-review.md`
2. `docs/qa/telegram-2026-11-04/RESULT.md`
3. `.planning/PLAN-v82-telegram.md`, `PLAN-v83-telegram-actions.md`, `PLAN-v84-telegram-more.md`, `PLAN-2026-11-04-telegram-review.md`
4. `.planning/wp/tg/*-report.md`, `WP-1-verify.md`
5. `docs/claude-code-integration.md` §11an–§11an-d, `.code_index/_meta.md` (dòng 2026-11-04)
