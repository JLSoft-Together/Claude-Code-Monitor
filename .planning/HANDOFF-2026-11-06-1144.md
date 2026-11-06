# HANDOFF — Orrery / Telegram UX nối topic (2026-11-06 11:44)

Đọc file này là làm tiếp được. Trả lời tiếng Việt, gọi user là "chủ nhân", xưng "con"; chủ nhân hay nhắn qua Telegram → xong việc báo bằng MCP `telegram_send`.
File này thay `HANDOFF-2026-11-06-1135.md`. Nhật ký: `.planning/PROGRESS-2026-11-06-telegram-ux.md`.

## 1. Đang ở đâu
- `F:/work/web/Claude-Code-Monitor`, branch `master`, HEAD `6f9a778` (3.3.0). **CHƯA commit** toàn bộ việc phiên này (chủ nhân chưa bảo).
- Mục tiêu đợt: tối ưu UI/UX setup + quản lý liên kết session/project ↔ topic Telegram. Code xong, chủ nhân đang QA tay trên bản dev.
- Kiểm cuối (chạy thật 2026-11-06 11:2x–11:4x): `npm run typecheck` sạch (5 workspace); desktop **1272/1272**; web **1703/1703**; `npm run build -w @ccm/web` OK.
  Kéo-thả qua CDP đạt trên bản map cũ; **chưa chạy lại trên giao diện cây** (chủ nhân đang dùng cửa sổ dev).
  Đăng nhập tài khoản thật đạt: chủ nhân login (Doan Vũ) → Quét thấy Test Bot group 8 topic, AI-wejoy 8 topic.
- **Đang chạy** (task nền của session cũ, có thể đã chết theo session): Vite `CCM_PORT=4319 npm run dev -w @ccm/web` cổng 5173 + Electron dev
  `apps/desktop/stage --dev-url=http://127.0.0.1:5173`, collector 4319, CDP 9333, dữ liệu `C:/Users/dauph/AppData/Local/Temp/orrery-qa-tg/{ud,data}`
  (bot token, api_id, **phiên tài khoản Telegram của chủ nhân** sealed trong `data/telegram.json`; receiving tắt để không tranh poll với app cài).
  Kiểm: `netstat -ano | grep -E ":4319 |:5173 |:9333 " | grep LISTEN`.
- Hook toàn cục **không bị đổi** (vẫn `C:/Users/dauph/AppData/Local/ccm/bin/hook-bridge.mjs`). Backup: `C:/Users/dauph/AppData/Local/Temp/orrery-qa-tg/claude-settings.backup-2026-11-06.json`.
- Bị chặn: không. Chờ chủ nhân chốt sau QA.

## 2. Phiên này đã làm (chi tiết docs §11an-i, `.code_index/_meta.md` dòng 2026-11-06)
- **Trạng thái live** session (`composables/useTelegramLinks.ts` `useSessionLive`: `paneState` + `stateWord`/`waitDisplay`) trên bản đồ, hộp ✈, danh sách project.
- **Hộp ✈** `workspace/TelegramLinkDialog.vue`: mặc định "Cả project", danh sách topic dạng radio (mũi tên + Enter), topic trùng tên (`lib/telegram.ts` `suggestTopic`) lên đầu + chọn sẵn, "Đang dùng: …" + nút "Chiếm topic", Gửi thử, dán link là phụ.
- **Tab Topic** `TelegramSettings.vue`: cây Group ▸ Topic (`tree`/`TreeChat`/`TreeTopic`, thu gọn `collapsed` lưu localStorage `ccm.telegram.collapsed`, `hideEmpty`, Thu gọn/Mở hết), lọc "Đang chờ bạn", nhãn "Topic không còn" (`topicGone`, chỉ khi đã login tài khoản), "Gửi thử lại", mục "Project đang chạy chưa có topic" (`unrouted`, nút "Nối #topic").
- **Kéo-thả** (HTML5 DnD) row project/session/unrouted → topic trong cây hoặc ô Ngắt; toast Hoàn tác 6 s. `onDragStart` set `dragging` sau 1 task (Chromium huỷ drag khi bố cục đổi trong dragstart).
- **Danh sách nhớ sẵn**: `notifier.discover(cached)` (known + quyền bot), store `ensureChats` (hiện ngay, quét live 1 lần/lần mở app).
- **Đăng nhập tài khoản chỉ để quét topic**: `apps/desktop/src/telegram/userScan.ts` (GramJS user: sendCode/signIn/checkPassword, getDialogs + `channels.GetForumTopics`, logOut), `notifier.user` + `scanAsUser`, IPC `ccm:telegram-user` (`sanitizeTelegramUser`), preload `telegramUser`, `main.ts` `createUserScanner`; UI `components/TelegramAccountScan.vue` (Kết nối › Group và topic). Session sealed `userSession`/`userName`.
- Tài liệu: docs §11an-i; `.planning/PLAN-2026-11-06-telegram-topic-ux.md`; changelog chờ `.planning/RELEASE-next.md`; ảnh QA `docs/qa/telegram-2026-11-06/01..06-*.png`.

## 3. Việc tiếp (theo thứ tự)
1. Kiểm bản dev còn sống (lệnh netstat ở §1). Chết thì dựng lại:
   `cd F:/work/web/Claude-Code-Monitor && CCM_PORT=4319 npm run dev -w @ccm/web -- --port 5173 --strictPort` (nền) và
   `cd apps/desktop && node build.mjs && Q=C:/Users/dauph/AppData/Local/Temp/orrery-qa-tg; CCM_PORT=4319 CCM_DATA_DIR=$Q/data CCM_TOAST=0 ../../node_modules/.bin/electron stage --dev-url=http://127.0.0.1:5173 --user-data-dir=$Q/ud --remote-debugging-port=9333` (nền).
   Sau đó kiểm hook không đổi: `diff -q ~/.claude/settings.json <backup>`.
2. Chạy lại kéo-thả tự động trên cây (khi chủ nhân không dùng cửa sổ dev): mở Settings › Telegram › Topic qua
   `node C:/Users/dauph/AppData/Local/Temp/orrery-qa-tg/qa5173.cjs eval "<js>"` (pinia `ui.settingsPage='telegram'; ui.settingsOpen=true`, bấm tab Topic),
   rồi `node C:/Users/dauph/AppData/Local/Temp/orrery-qa-tg/drop-tree.cjs` (kéo last-war → topic "AI Cleaner" → Hoàn tác). Xong khi "after …#<id AI Cleaner>" và "undone …#63".
3. Chờ chủ nhân góp ý UI → sửa tiếp trên bản dev (Vite HMR; sửa main/preload thì `node build.mjs` + khởi động lại Electron dev, chỉ kill process có commandline chứa `orrery-qa-tg`).
4. Chủ nhân bảo "commit" → message đề xuất (KHÔNG trailer): `✨ Telegram: topic tree, picker, live session state, drag and drop, account topic scan`.
   Chỉ add file phiên này (danh sách: `git status`, trừ các file ở §4 "đừng đụng").
5. Chủ nhân bảo "tắt dev" → kill cây process `orrery-qa-tg` (electron trong `node_modules`) + dừng Vite 5173; KHÔNG đụng app cài; kiểm lại hook.
6. Release khi chủ nhân đặt số version: `.planning/RELEASE-next.md` → đổi tên, quy trình trong memory `next-release-notes`.
Còn chờ chủ nhân:
- (a) Có giữ mục "Project đang chạy chưa có topic" song song với cây không — mặc định: giữ.
- (b) Bỏ hẳn hộp chọn topic AppSelect trên từng row (cây + kéo-thả đã đủ)? — mặc định: giữ (đường bàn phím).

## 4. Quyết định và ràng buộc
- **Chủ nhân đã chốt**: topic do chủ nhân tự tạo, thường 1 project = 1 topic (đừng đề xuất lại tạo topic theo session / "mỗi session 1 topic"). Tài khoản Telegram **chỉ để quét group + topic**, mọi tin vẫn bot gửi (đừng đề xuất đọc lịch sử / read receipt / tạo group tự động trừ khi chủ nhân hỏi).
- Git: không tự commit/push; không trailer attribution. Đừng đụng: `bg_native_ad_cta.xml`, `git-gui.bat`, `spikes/`, `docs/qa/v79|v80/`, `apps/*/.vitest/`.
- Bản dev dùng chung bot với app cài: không bật "Nhận lệnh" ở bản dev; mỗi lần quét live = 1 lần 409 cho poll của app cài (tự hồi).
- Quirk: Vite dev phải có `CCM_PORT=<cổng collector dev>` (không thì "Mất kết nối"). Heredoc bash qua tool có thể nuốt `\'` → script Python dài viết bằng Write rồi chạy. `rtk grep` có lúc treo/làm hỏng output → dùng tool Grep hoặc `rtk proxy grep`.
- CDP: drag bị intercept mà không thả sẽ kẹt chuột → luôn `Input.dispatchDragEvent` `dragCancel`/`drop` (script đã có).

## 5. File cần đọc lại
`.planning/PLAN-2026-11-06-telegram-topic-ux.md` → docs `docs/claude-code-integration.md` §11an-i → `.code_index/_meta.md` (dòng 2026-11-06) → `.planning/PROGRESS-2026-11-06-telegram-ux.md`.
