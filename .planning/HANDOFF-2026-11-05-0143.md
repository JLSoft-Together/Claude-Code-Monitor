# HANDOFF — Orrery / Telegram QA + v85 (2026-11-05 01:43)

Đọc file này là làm tiếp được. Trả lời tiếng Việt, gọi user là "chủ nhân", xưng "con". File này thay `HANDOFF-2026-11-04-2326.md`.
Nhật ký: `.planning/PROGRESS-2026-11-05-telegram.md` (cuối file là mới nhất).

## 1. Đang ở đâu
- Project `F:/work/web/Claude-Code-Monitor` (máy F:), branch `master`, HEAD `3785f92` = `origin/master` (đã pull).
- **CHƯA commit** toàn bộ việc phiên này (~35 file sửa + mới: `apps/desktop/src/telegram/mtproto.ts`,
  `apps/web/src/components/workspace/TelegramLinkDialog.vue`, `.planning/PLAN-v85-telegram-big-files.md`,
  `docs/qa/telegram-2026-11-04/08-stop-interrupted.png`, `package-lock.json` + `apps/desktop/package.json` (dep `telegram@2.26.22`)).
  Không phải của phiên này, đừng đụng: `.planning/HANDOFF-2026-11-01-v76.md` (M), `bg_native_ad_cta.xml`, `git-gui.bat`, `spikes/`, `docs/qa/v79|v80/`.
- Kiểm cuối (chạy thật 2026-11-05 01:40): `npm run typecheck` sạch; desktop 1213/1213; web 1692/1692 (`npm test -w @ccm/desktop|web`).
- **Đang chạy**: bản dev QA (electron `node_modules/electron`, task nền) cổng 4319, CDP 9333, dữ liệu
  `C:/Users/dauph/AppData/Local/Temp/orrery-qa-tg/{ud,data}` (token sealed, owner Doan Vũ, topic #63 → `F:\work\android\WeJoy\last-war`,
  khoá File lớn api_id 22439739 sealed). Script CDP: `C:/Users/dauph/AppData/Local/Temp/orrery-qa-tg/qa.cjs` (`node qa.cjs eval "<js>"`, `shot <png>`, `targets`).
  Có 1 pane Claude test ở last-war (con mở, rảnh).
- **Hook toàn cục đang trỏ bản dev**: `~/.claude/settings.json` hook-bridge = `C:/Users/dauph/AppData/Local/Temp/orrery-qa-tg/data/bin/hook-bridge.mjs`.
  Tắt bản dev xong PHẢI trả về `C:/Users/dauph/AppData/Local/ccm/bin/hook-bridge.mjs` (bản cài).
- Bị chặn: không. Chờ chủ nhân QA tay (mục 3).

## 2. Phiên này đã làm (chi tiết: docs §11an-e, `.code_index/_meta.md` dòng 2026-11-05)
- **Lệnh bot**: `all` trống → help; help gom nhóm; `new` khi đã có session hỏi `➕`/`📨`; nhiều session → nút chọn cho `stop`/`last`/tin thường
  (`notifier.pickMarkup`, kinds `nw`/`np`/`lt`); tên pane = alias/title session + `#n` (`shared uniquePaneNames`).
- **Prompt từ Telegram** có dòng cuối nhắc `telegram_send` (`actions.viaTelegram`), trừ lệnh trần `/x /y`, `/compact …`, `/clear`.
- **v85 File lớn ≤ 2 GB**: `telegram/mtproto.ts` `createBigUploader` (GramJS, `getInputEntity`, `topMsgId`, session sealed `mtSession`),
  `telegram_send` > 50 MB → tin "⏫ đang gửi" + upload nền, MCP trả `uploading`. Settings: `api_id` + `api_hash` sealed. QA thật đạt (60 MB).
- **Settings**: trang riêng `telegram` (`settings/index.ts`, `SettingsMenu.vue`), 3 tab (`TelegramSettings.vue`, key `ccm.telegram.tab`).
- **Kết nối theo session / project**: rail `rowMenu` id `telegram-link` → `ui.telegramLink` → `TelegramLinkDialog.vue`.
  `sessionRoutes` (Claude session id) trong `telegram.json`; trang đẩy pane↔session↔terminal qua `ccm:telegram-panes` (`useTelegramInbound` `paneLinks`);
  notifier `setPanes` / `sessionRouteOf`: báo cáo + `telegram_send` + tin trong topic của session đi thẳng session đó; session chưa mở → `sessionClosed`.
- **Người lạ**: câu cố định (state `stranger {enabled,text}`, `{owner}`), ≤ 5/phút `strangerLimit`, không vào session, không tốn token.
- **Tên topic**: `notifier.learn` học từ poll, state `routes[].where` / `sessionRoutes[].where` = "Group › Topic".
- Docs §11an-e, `PLAN-v85`, `DECISIONS.md` (2 dòng 2026-11-05), `RESULT.md` #16 ĐẠT + #18–#25.

## 3. Việc tiếp (theo thứ tự)
1. QA tay với chủ nhân trên bản dev (đang chạy):
   - `@PoorDog_JinVu_Bot status` trong #63 → Settings › Telegram phải hiện "Test Bot group › <tên topic>" thay "#63".
   - Tạo topic mới → Copy Message Link → chuột phải session ở rail › Kết nối Telegram… › Chỉ session này → tin trong topic mới vào đúng pane.
   - Tài khoản khác tag bot → câu "Xin lỗi bạn, tôi chỉ trả lời chủ nhân…".
   - `@bot new` 2 lần → lần 2 hỏi nút (#23); `/hand-off`, `/compact` gõ nguyên văn.
   Xong → ghi vào `docs/qa/telegram-2026-11-04/RESULT.md` (#26+).
2. Đề xuất commit (chờ chủ nhân bảo "commit"), tách:
   `🐛 Telegram: grouped help, bare all, new asks which session, session pick buttons, prompts say they came from Telegram` ·
   `✨ Telegram large files up to 2 GB over MTProto` · `💄 Telegram settings page with tabs` ·
   `✨ Connect a session or project to a Telegram topic from the rail; answer strangers; topic names` · `✅ QA notes`.
3. Tắt bản dev: tìm PID `powershell "(Get-CimInstance Win32_Process -Filter \"Name='electron.exe'\" | ? { $_.CommandLine -like '*orrery-qa-tg*' -and $_.CommandLine -notlike '*--type=*' }).ProcessId"` → `taskkill //T //F //PID <pid>`
   (KHÔNG `taskkill /IM electron.exe` — bị chặn, đụng app khác), rồi trả hook (mục 1).
4. Xoá file test ở project khác: `F:/work/android/WeJoy/last-war/test-60mb.bin` (hỏi chủ nhân trước).
5. Còn mở từ trước: diff gồm file untracked, glob bí mật người dùng, lệnh nặng chặn poll, album ảnh (`.planning/wp/tg/WP-*-report.md`).
Chờ chủ nhân: (a) commit khi nào — mặc định: chưa; (b) câu người lạ ghi "Jin Vũ" cứng? — mặc định: lấy tên tài khoản đã ghép, sửa được trong Settings.

## 4. Quyết định và ràng buộc
- **Chủ nhân đã chốt**: GramJS trong app cho file lớn (không Local Bot API server); `new` hỏi trước khi mở thêm; người lạ được trả lời câu cố định;
  Telegram thành trang Settings riêng; kết nối được cả session lẫn project.
- Bot KHÔNG liệt kê được topic (Bot API không có, MTProto `BOT_METHOD_INVALID`) — đừng đề xuất lại.
- Không tự commit/push. Không chạy bản dev ở 4317. Build để QA được phép (DECISIONS 2026-11-04).
- Token bot từng lộ trong chat (phiên 2026-11-04) → nhắc chủ nhân `/revoke` ở BotFather.
- Quirk: shell này rewrite `grep` → `rg` (ngoặc `(` phải escape, dùng `grep -F` hoặc Grep tool); chèn code qua `node -e` dễ hỏng `\x..`/`\n` —
  dùng Edit tool hoặc `String.fromCharCode`; file vừa CRLF vừa LF. Đường dẫn Windows qua CDP eval: dùng `/`.

## 5. File cần đọc lại
1. `.planning/PROGRESS-2026-11-05-telegram.md`
2. `docs/qa/telegram-2026-11-04/RESULT.md`
3. `docs/claude-code-integration.md` §11an-e, `.planning/PLAN-v85-telegram-big-files.md`, `.planning/DECISIONS.md`
4. `.code_index/_meta.md` (2 dòng 2026-11-05)
